// One user turn of the assistant (ADR-0007): ask the model, run the tools it
// asks for against the car, feed the results back, until it answers in text.
//
// Bounds, so a turn always ends:
// - at most MAX_MODEL_CALLS calls to the model; the last one cannot call tools;
// - at most MAX_TOOLS_PER_ROUND tool calls per answer (the rest are refused);
// - if the model still ends up with no text, the answer is built from the
//   tool results, deterministically.
//
// Tool calls run one at a time (the adapter has a single queue). Invalid ones
// are refused, never repaired. Destructive ones wait for the user's confirmation
// on screen. Reads repeated within MEMO_MS reuse the last result.

import type { ApiMessage, ApiToolCall, AssembledToolCall, LlmPort } from '@/domain/ports/llm.port';
import type { ConfirmationPort, VehicleToolsPort } from '@/domain/ports/vehicle-tools.port';
import { trimHistory } from './history';
import { evaluatePolicy, TOOL_LEVEL } from './policy';
import { maxTokensFor, SYSTEM_PROMPT, userMessage, type AssistantContext } from './prompt';
import { parseToolCall, toolSchemas, type ToolCall, type ToolOutcome } from './tools';

export const MAX_MODEL_CALLS = 4;
export const MAX_TOOLS_PER_ROUND = 6;
export const MEMO_MS = 10_000;
// 16k context − system and tools (~1.4k) − answer (~0.6k) − margin.
export const HISTORY_BUDGET_TOKENS = 10_000;

export type AgentEvent =
  | { readonly type: 'text'; readonly delta: string }
  | { readonly type: 'tool_start'; readonly id: string; readonly call: ToolCall }
  | { readonly type: 'tool_end'; readonly id: string; readonly call: ToolCall; readonly outcome: ToolOutcome }
  // Not run: invalid, unknown, over the limit, refused by policy or by the user.
  | { readonly type: 'tool_refused'; readonly id: string; readonly name: string; readonly outcome: ToolOutcome };

// Results of recent reads, shared across turns of one conversation.
export class ToolMemo {
  private entries = new Map<string, { at: number; outcome: ToolOutcome }>();
  get(key: string, now: number): ToolOutcome | null {
    const e = this.entries.get(key);
    return e && now - e.at < MEMO_MS ? e.outcome : null;
  }
  set(key: string, outcome: ToolOutcome, now: number): void {
    this.entries.set(key, { at: now, outcome });
  }
}

export interface TurnOptions {
  readonly history: readonly ApiMessage[];
  readonly text: string;
  // Photos attached to this message (data URLs), e.g. a dashboard warning light.
  readonly images?: readonly string[];
  readonly context: AssistantContext;
  readonly llm: LlmPort;
  readonly vehicle: VehicleToolsPort;
  readonly confirmation: ConfirmationPort;
  // Successful clears earlier in this conversation (one per conversation).
  readonly clearsSoFar?: number;
  readonly memo?: ToolMemo;
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: AgentEvent) => void;
  readonly thinking?: boolean;
  readonly now?: () => number;
}

export interface TurnResult {
  // Everything this turn adds to the history, in API form.
  readonly messages: ApiMessage[];
  // The visible answer.
  readonly text: string;
  readonly cancelled: boolean;
  readonly modelCalls: number;
  // Calls the model got wrong (invalid or unknown): a quality signal.
  readonly invalidCalls: number;
  readonly clears: number;
  // Old messages left out of the context: candidates for a summary.
  readonly dropped: ApiMessage[];
}

export async function runTurn(opts: TurnOptions): Promise<TurnResult> {
  const now = opts.now ?? Date.now;
  const memo = opts.memo ?? new ToolMemo();
  const emit = opts.onEvent ?? (() => undefined);
  const signal = opts.signal ?? new AbortController().signal;
  const supported = opts.vehicle.supportedPids();
  const tools = toolSchemas(supported);
  const { kept, dropped } = trimHistory(opts.history, HISTORY_BUDGET_TOKENS);

  const prompt = userMessage(opts.text, opts.context);
  const added: ApiMessage[] = [
    {
      role: 'user',
      content: opts.images?.length
        ? [{ type: 'text', text: prompt }, ...opts.images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))]
        : prompt,
    },
  ];
  const outcomes: ToolOutcome[] = [];
  let clears = 0;
  let invalidCalls = 0;
  let modelCalls = 0;
  let text = '';

  const finish = (cancelled: boolean): TurnResult => ({
    messages: added,
    text,
    cancelled,
    modelCalls,
    invalidCalls,
    clears,
    dropped,
  });

  for (let round = 0; round < MAX_MODEL_CALLS; round++) {
    if (signal.aborted) return finish(true);
    const last = round === MAX_MODEL_CALLS - 1;
    let result;
    try {
      result = await opts.llm.complete(
        {
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...kept, ...added],
          tools,
          toolChoice: last ? 'none' : 'auto',
          maxTokens: maxTokensFor(opts.context),
          thinking: opts.thinking ?? false,
        },
        { signal, onText: (delta) => emit({ type: 'text', delta }) },
      );
    } catch (err) {
      if (signal.aborted) return finish(true);
      throw err;
    }
    modelCalls += 1;
    const content = withoutMarkers(result.content);
    const calls = last ? [] : result.toolCalls;
    // Only an internal marker came back ("[INTENT: tool_call]", seen with
    // Qwen3.8 now and then): the model meant to call a tool. Ask again.
    if (calls.length === 0 && !content && INTERNAL_MARKER.test(result.content) && !last) continue;

    if (calls.length === 0) {
      text = content || fallbackAnswer(outcomes);
      if (!content) emit({ type: 'text', delta: text });
      added.push({ role: 'assistant', content: text });
      return finish(false);
    }

    const apiCalls: ApiToolCall[] = calls.map((c, i) => ({
      id: c.id || `call_${round}_${i}`,
      type: 'function',
      function: { name: c.name, arguments: c.arguments },
    }));
    added.push({ role: 'assistant', content: content || null, tool_calls: apiCalls });

    for (let i = 0; i < calls.length; i++) {
      const id = apiCalls[i]!.id;
      const outcome = signal.aborted
        ? refusal('cancelled', 'El usuario detuvo la respuesta.')
        : await runOne(calls[i]!, id, i);
      if (outcome.ok) outcomes.push(outcome);
      added.push({ role: 'tool', tool_call_id: id, content: forModel(outcome) });
    }
    if (signal.aborted) return finish(true);
  }
  // Unreachable: the last round cannot call tools.
  return finish(false);

  async function runOne(raw: AssembledToolCall, id: string, index: number): Promise<ToolOutcome> {
    const refuse = (outcome: ToolOutcome): ToolOutcome => {
      emit({ type: 'tool_refused', id, name: raw.name, outcome });
      return outcome;
    };
    if (index >= MAX_TOOLS_PER_ROUND) {
      return refuse(refusal('too_many_calls', `Como máximo ${MAX_TOOLS_PER_ROUND} herramientas por respuesta.`));
    }
    const parsed = parseToolCall(raw.name, raw.arguments, supported);
    if (!parsed.ok) {
      invalidCalls += 1;
      return refuse(refusal(parsed.error, parsed.message));
    }
    const call = parsed.call;
    const decision = evaluatePolicy(call, {
      moving: opts.context.moving,
      navigating: opts.context.navigating,
      clearsThisConversation: (opts.clearsSoFar ?? 0) + clears,
    });
    if (decision.kind === 'deny') return refuse(refusal(decision.error, decision.message));
    if (decision.kind === 'confirm' && !(await opts.confirmation.confirm(call))) {
      return refuse(refusal('declined_by_user', 'El usuario no confirmó la acción.'));
    }

    const key = memoKey(call);
    const cached = key ? memo.get(key, now()) : null;
    emit({ type: 'tool_start', id, call });
    const outcome = cached ?? (await opts.vehicle.execute(call, signal));
    if (key && outcome.ok && !cached) memo.set(key, outcome, now());
    if (call.name === 'clear_dtcs' && outcome.ok) clears += 1;
    emit({ type: 'tool_end', id, call, outcome });
    return outcome;
  }
}

// Calls that act or whose answer changes by the second are never reused.
const NOT_REUSED: ReadonlySet<ToolCall['name']> = new Set(['sample_pids', 'set_destination', 'start_navigation', 'route_status', 'stop_navigation']);

// Only one-shot reads are reused; a sample measures over time.
function memoKey(call: ToolCall): string | null {
  if (TOOL_LEVEL[call.name] !== 'read' || NOT_REUSED.has(call.name)) return null;
  return JSON.stringify(call);
}

function refusal(error: Extract<ToolOutcome, { ok: false }>['error'], message: string): ToolOutcome {
  return { ok: false, error, message };
}

// What the model reads back: compact JSON.
function forModel(outcome: ToolOutcome): string {
  return JSON.stringify(outcome.ok ? { result: outcome.data } : { error: outcome.error, message: outcome.message });
}

// When the model gives no text: the measurements, as they are.
// Bracketed planning tags the model sometimes leaks into the visible text.
const INTERNAL_MARKER = /\[(?:INTENT|PLAN|THOUGHT|TOOL_CALL)[^\]\n]*\]/gi;

function withoutMarkers(text: string): string {
  return text.replace(INTERNAL_MARKER, '').trim();
}

export function fallbackAnswer(outcomes: readonly ToolOutcome[]): string {
  const summaries = outcomes.flatMap((o) => (o.ok && o.summary ? [o.summary] : []));
  return summaries.length ? summaries.join('\n') : 'No pude armar la respuesta. Probá de nuevo.';
}
