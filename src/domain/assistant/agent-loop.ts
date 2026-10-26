// One user turn of the assistant (ADR-0007): ask the model, run the tools it
// asks for against the car, feed the results back, until it answers in text.
//
// Bounds, so a turn always ends:
// - at most MAX_MODEL_CALLS calls to the model; the last one cannot call tools;
// - at most MAX_TOOLS_PER_ROUND tool calls per answer (the rest are refused);
// - a round that comes back with no text and no tool call gets one closing
//   round (no tools, "answer with what you found"); only if that is empty too
//   is the answer built from the tool results, deterministically, and that
//   fallback is shown but never joins the history the model reads next.
//
// Tool calls run one at a time (the adapter has a single queue). Invalid ones
// are refused, never repaired. Destructive ones wait for the user's confirmation
// on screen. Reads repeated within MEMO_MS reuse the last result.

import type { ApiMessage, ApiToolCall, AssembledToolCall, LlmPort } from '@/domain/ports/llm.port';
import type { ConfirmationPort, VehicleToolsPort } from '@/domain/ports/vehicle-tools.port';
import { estimateChars, estimateTokens, textTokens, trimHistory } from './history';
import { redactText } from '@/domain/privacy/redact';
import { evaluatePolicy, TOOL_LEVEL } from './policy';
import { maxTokensFor, SYSTEM_PROMPT, userMessage, type AssistantContext } from './prompt';
import { INTERNAL_MARKER, MarkerFilter } from './stream-filter';
import { summaryMessages } from './summary';
import { parseToolCall, toolSchemas, type ToolCall, type ToolOutcome } from './tools';

// Going to a shop is web_search → search_place → set_destination → the answer: four
// calls with no room for one search that finds nothing (benchmark 2026-10-22: out of
// rounds, it answered with the tools' summaries). The fifth is that room.
export const MAX_MODEL_CALLS = 5;
export const MAX_TOOLS_PER_ROUND = 6;
export const MEMO_MS = 10_000;
// The model's window (vLLM --max-model-len, ADR-0006).
export const CONTEXT_TOKENS = 16_384;
// Kept free for what the turn itself adds: each round of tools costs ~300 tokens
// (measured 2026-10-21) and a page read or a text search, 1–3k. If it is not
// enough, the call fails with "context length" and is retried with less history.
export const TURN_RESERVE_TOKENS = 3_000;
// From the second round on the turn's own messages are counted, so only the next
// result needs room.
export const ROUND_RESERVE_TOKENS = 1_500;
const MIN_HISTORY_TOKENS = 1_000;
// One tool result is cut here: a page or a dump must not eat the window by
// itself. The 2026-10-21 chat had three searches and 27 raw replies.
export const MAX_TOOL_RESULT_TOKENS = 1_500;
const MIN_RESULT_TOKENS = 200;
// What an older result in the same turn is cut to when the window is short.
const COMPACT_RESULT_CHARS = 400;
// Said to the model on the closing round; not stored (the template wants the
// system message first, so it travels as a user message).
const CLOSING_INSTRUCTION =
  '[instrucción de la app] Ya no podés usar herramientas. Respondé ahora al usuario con lo que encontraste o mediste en este turno y citá el sitio si viene de la web. Si no apareció el dato, decilo claro y qué falta.';

// The provider said the prompt does not fit (new-api / vLLM: "This model's
// maximum context length is 16384 tokens…", HTTP 400; a gateway may answer 413
// or word it as too many tokens / a prompt too long).
const OVERFLOW_WORDS = /context.length|context_length|maximum context|too many (?:input )?tokens|prompt is too long|input is too long|reduce the length/i;
export function isContextOverflow(err: unknown): boolean {
  const e = err as { status?: unknown; message?: unknown } | null;
  return (e?.status === 400 || e?.status === 413) && OVERFLOW_WORDS.test(String(e.message ?? ''));
}

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
  // What older, already dropped turns said (M4), ahead of the history.
  readonly summary?: string | null;
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

// What one call to the model returned, to tell afterwards why a turn ended as it did.
export interface RoundStat {
  readonly finishReason: string | null;
  readonly contentChars: number;
  readonly reasoningChars: number;
  readonly toolCalls: number;
  // Estimated prompt size of this call (the server's count is not read).
  readonly promptTokensEst: number;
  readonly closing: boolean;
}

export interface TurnResult {
  // Everything this turn adds to the history, in API form.
  readonly messages: ApiMessage[];
  readonly rounds?: readonly RoundStat[];
  // The model itself answered (not the fallback built from the tools' lines):
  // only then are next questions proposed about it.
  readonly answered?: boolean;
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
  const summary = summaryMessages(opts.summary);
  const summaryTokens = summary.reduce((sum, m) => sum + estimateTokens(m), 0);

  const prompt = userMessage(opts.text, opts.context);
  const added: ApiMessage[] = [
    {
      role: 'user',
      content: opts.images?.length
        ? [{ type: 'text', text: prompt }, ...opts.images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))]
        : prompt,
    },
  ];

  // What fits is what is left of the window after the instructions, the tool
  // definitions (they grow with every tool), this question and the answer —
  // not a fixed number, which went stale when the tools did.
  const baseTokens = estimateChars(SYSTEM_PROMPT.length) + estimateChars(JSON.stringify(tools).length) + summaryTokens;
  const tokensOf = (messages: readonly ApiMessage[]) => messages.reduce((sum, m) => sum + estimateTokens(m), 0);
  // The first call leaves room for everything the turn may add; from the second
  // on the turn's own messages (`added`) are counted for real, so what a long
  // chain of tools adds is trimmed from the history instead of overflowing.
  let reserve = TURN_RESERVE_TOKENS;
  const historyBudget = (squeeze: number) =>
    Math.max(MIN_HISTORY_TOKENS, Math.floor((CONTEXT_TOKENS - maxTokensFor(opts.context) - baseTokens - tokensOf(added) - reserve) * squeeze));
  let squeeze = 1;
  let { kept, dropped } = trimHistory(opts.history, historyBudget(squeeze), { keepLast: false });
  const outcomes: ToolOutcome[] = [];
  const rounds: RoundStat[] = [];
  let closing = false;
  // Web searches of this turn (research and web_search), by their words.
  const searched = new Set<string>();
  let searches = 0;
  let answered = false;
  let clears = 0;
  let invalidCalls = 0;
  let modelCalls = 0;
  let text = '';

  const finish = (cancelled: boolean): TurnResult => ({
    messages: added,
    rounds,
    answered,
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
    const noTools = last || closing;
    if (round > 0) {
      reserve = ROUND_RESERVE_TOKENS;
      ({ kept, dropped } = trimHistory(opts.history, historyBudget(squeeze), { keepLast: false }));
      compactOldResults();
    }
    let result;
    const filter = new MarkerFilter();
    try {
      result = await opts.llm.complete(
        {
          // The one place everything the model reads passes through: the history
          // keeps what the owner saw (the full VIN), the model never gets its serial.
          messages: ((): ApiMessage[] => [
            { role: 'system', content: SYSTEM_PROMPT },
            ...summary,
            ...kept,
            ...added,
            ...(closing ? [{ role: 'user' as const, content: CLOSING_INSTRUCTION }] : []),
          ])().map(hidingVin),
          tools,
          toolChoice: noTools ? 'none' : 'auto',
          maxTokens: maxTokensFor(opts.context),
          thinking: opts.thinking ?? false,
        },
        {
          signal,
          onText: (delta) => {
            const shown = filter.push(delta);
            if (shown) emit({ type: 'text', delta: shown });
          },
        },
      );
      const rest = filter.flush();
      if (rest) emit({ type: 'text', delta: rest });
    } catch (err) {
      if (signal.aborted) return finish(true);
      // It still did not fit (the estimate is a guess): drop more of the oldest
      // turns and ask again, without the user seeing anything. If there is
      // nothing left to drop, it is a real error.
      if (isContextOverflow(err) && squeeze > 0.25) {
        const before = kept.length;
        squeeze /= 2;
        ({ kept, dropped } = trimHistory(opts.history, historyBudget(squeeze), { keepLast: false }));
        if (kept.length < before) {
          round -= 1;
          continue;
        }
      }
      throw err;
    }
    modelCalls += 1;
    const content = withoutMarkers(result.content);
    const calls = noTools ? [] : result.toolCalls;
    rounds.push({
      finishReason: result.finishReason,
      contentChars: result.content.length,
      reasoningChars: result.reasoningChars ?? 0,
      toolCalls: result.toolCalls.length,
      promptTokensEst: baseTokens + tokensOf(kept) + tokensOf(added),
      closing,
    });
    // Only an internal marker came back ("[INTENT: tool_call]", seen with
    // Qwen3.8 now and then): the model meant to call a tool. Ask again.
    if (calls.length === 0 && !content && INTERNAL_MARKER.test(result.content) && !last) continue;

    if (calls.length === 0) {
      // Tools ran and the model said nothing (2026-10-21: three searches, then an
      // empty call): ask once more, without tools, for the answer itself.
      if (!content && !noTools && added.length > 1) {
        closing = true;
        continue;
      }
      if (content) {
        text = content;
        answered = true;
        added.push({ role: 'assistant', content });
      } else {
        // Shown, but not kept: the model would read its own list of summaries
        // as the answer it gave, and copy it.
        text = fallbackAnswer(outcomes);
        emit({ type: 'text', delta: text });
        added.push({ role: 'assistant', content: UNANSWERED });
      }
      return finish(false);
    }

    const apiCalls: ApiToolCall[] = calls.map((c, i) => ({
      id: c.id || `call_${round}_${i}`,
      type: 'function',
      function: { name: c.name, arguments: c.arguments },
    }));
    added.push({ role: 'assistant', content: content || null, tool_calls: apiCalls });

    // Each result gets its share of what the window has left (the history can
    // still shrink to MIN_HISTORY_TOKENS), never more than MAX_TOOL_RESULT_TOKENS:
    // the latest batch is the one thing compactOldResults cannot cut.
    const free = CONTEXT_TOKENS - maxTokensFor(opts.context) - baseTokens - Math.min(tokensOf(kept), MIN_HISTORY_TOKENS) - tokensOf(added) - 300;
    const resultTokens = Math.min(MAX_TOOL_RESULT_TOKENS, Math.max(MIN_RESULT_TOKENS, Math.floor(free / Math.min(calls.length, MAX_TOOLS_PER_ROUND))));
    // Calls that do not touch the car (the adapter has one queue) run at the same
    // time: three web lookups in one round cost the time of the slowest.
    const together = calls.length > 1 && calls.every((c) => PARALLEL_SAFE.has(c.name)) && !signal.aborted;
    const ran = together ? await Promise.all(calls.map((c, i) => runOne(c, apiCalls[i]!.id, i))) : null;
    for (let i = 0; i < calls.length; i++) {
      const id = apiCalls[i]!.id;
      const outcome = ran
        ? ran[i]!
        : signal.aborted
          ? refusal('cancelled', 'El usuario detuvo la respuesta.')
          : await runOne(calls[i]!, id, i);
      if (outcome.ok) outcomes.push(outcome);
      added.push({ role: 'tool', tool_call_id: id, content: forModel(outcome, resultTokens) });
    }
    if (signal.aborted) return finish(true);
  }
  // Unreachable: the last round cannot call tools.
  return finish(false);

  // The turn's own tool results are the bulk of a long chain: when the window is
  // short, the older ones (not the latest batch) shrink to their first lines.
  function compactOldResults(): void {
    const room = CONTEXT_TOKENS - maxTokensFor(opts.context) - 200;
    const latestCalls = added.map((m) => m.role === 'assistant' && !!m.tool_calls).lastIndexOf(true);
    for (let i = 0; i < latestCalls && baseTokens + tokensOf(kept) + tokensOf(added) > room; i++) {
      const m = added[i]!;
      if (m.role === 'tool' && m.content.length > COMPACT_RESULT_CHARS) {
        added[i] = { ...m, content: `${m.content.slice(0, COMPACT_RESULT_CHARS)}…[recortado]` };
      }
    }
  }

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
    // The same search twice in a turn, or a third one, is refused with what to do
    // instead (2026-10-21: the same query twice, then no answer).
    if (call.name === 'research' || call.name === 'web_search') {
      const words = [call.query, call.name === 'research' ? call.queryEn : null].map(searchKey).filter(Boolean) as string[];
      if (words.some((w) => searched.has(w))) {
        return refuse(refusal('invalid_arguments', 'Ya buscaste eso en este turno. Usá lo que trajo; si no alcanzó, probá otra fuente (web_fetch con "focus" sobre una URL de "also") o decí que no apareció.'));
      }
      if (searches >= MAX_SEARCHES_PER_TURN) {
        return refuse(refusal('too_many_calls', `Ya hiciste ${MAX_SEARCHES_PER_TURN} búsquedas en este turno: respondé con lo que encontraste, o decí qué no apareció y qué se podría probar.`));
      }
      searches += 1;
      words.forEach((w) => searched.add(w));
    }
    const decision = evaluatePolicy(call, {
      moving: opts.context.moving,
      navigating: opts.context.navigating,
      labMode: opts.context.labMode,
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

function hidingVin(m: ApiMessage): ApiMessage {
  if (typeof m.content === 'string') {
    const content = redactText(m.content);
    return content === m.content ? m : ({ ...m, content } as ApiMessage);
  }
  if (m.role === 'user' && Array.isArray(m.content)) {
    return { ...m, content: m.content.map((p) => (p.type === 'text' ? { ...p, text: redactText(p.text) } : p)) };
  }
  return m;
}

// Searches per turn: a fact lookup needs one or two (research reads several pages
// by itself); more is the model searching for what is not there.
export const MAX_SEARCHES_PER_TURN = 2;

// Tools that do not use the adapter, safe to run at the same time.
const PARALLEL_SAFE: ReadonlySet<string> = new Set(['research', 'web_search', 'web_fetch', 'docs_search', 'knowledge_lookup', 'chat_search', 'dollar_rate', 'car_price', 'weather', 'fuel_prices', 'calculate']);

// "¿Odómetro  Tracker?" and "odómetro tracker" are the same search.
function searchKey(q: string | null): string | null {
  if (!q) return null;
  const k = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return k || null;
}

// Calls that act or whose answer changes by the second are never reused.
// read_fault_history changes with every read_dtcs/freeze frame (they record).
const NOT_REUSED: ReadonlySet<ToolCall['name']> = new Set(['sample_pids', 'read_fault_history', 'set_destination', 'start_navigation', 'route_status', 'stop_navigation', 'where_am_i', 'fuel_prices', 'log_service', 'read_service_log']);

// Only one-shot reads are reused; a sample measures over time.
function memoKey(call: ToolCall): string | null {
  if (TOOL_LEVEL[call.name] !== 'read' || NOT_REUSED.has(call.name)) return null;
  return JSON.stringify(call);
}

function refusal(error: Extract<ToolOutcome, { ok: false }>['error'], message: string): ToolOutcome {
  return { ok: false, error, message };
}

// What the model reads back: compact JSON.
function forModel(outcome: ToolOutcome, maxTokens: number): string {
  const json = JSON.stringify(outcome.ok ? { result: outcome.data } : { error: outcome.error, message: outcome.message });
  const tokens = textTokens(json);
  if (tokens <= maxTokens) return json;
  // Cut by the same estimate that counts it (a hex dump is ~1 token a character).
  const keep = Math.floor((json.length * maxTokens) / tokens);
  return `${json.slice(0, keep)}…[recortado: ${json.length - keep} caracteres más]`;
}

// When the model gives no text: the measurements, as they are.
// Bracketed planning tags the model sometimes leaks into the visible text
// (stream-filter.ts): "[INTENT: tool_call]", "[INTENT]", "[tool: run_adapter_bench]".

function withoutMarkers(text: string): string {
  return text.replace(INTERNAL_MARKER, '').trim();
}

// What the history keeps of a turn that ended without an answer.
const UNANSWERED = 'No pude armar la respuesta a esto.';

export function fallbackAnswer(outcomes: readonly ToolOutcome[]): string {
  const summaries = [...new Set(outcomes.flatMap((o) => (o.ok && o.summary ? [o.summary] : [])))];
  return summaries.length ? `No pude armar la respuesta completa. Esto es lo que consulté:\n${summaries.join('\n')}` : 'No pude armar la respuesta. Probá de nuevo.';
}
