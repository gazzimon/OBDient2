// One assistant turn with the user's account (M3): builds the model client
// with the account's key, runs the agent loop against the car, and sorts the
// ways it can fail into what the screen says.
//
// A 401 means the key was rotated or revoked: it is renewed with the account
// once and the turn is retried, but only if nothing reached the screen yet
// (no text, no tool), so a retry never runs a tool twice.

import { runTurn, ToolMemo, type AgentEvent, type TurnResult } from '@/domain/assistant/agent-loop';
import type { AssistantContext, Persona } from '@/domain/assistant/prompt';
import { nextQuestionsRequest, parseNextQuestions } from '@/domain/assistant/next-questions';
import { summaryRequest } from '@/domain/assistant/summary';
import type { ApiMessage, LlmPort } from '@/domain/ports/llm.port';
import type { ConfirmationPort, VehicleToolsPort } from '@/domain/ports/vehicle-tools.port';
import type { LlmCredentials } from '@/data/auth/account-service';
import { LlmHttpError } from '@/data/llm/openai-chat-client';
import { isContextOverflow } from '@/domain/assistant/agent-loop';

export type AssistantError =
  | 'no_account' // not signed in: the screen offers Google
  | 'unauthorized' // the key could not be renewed
  | 'disabled' // the account's key is disabled or out of quota
  | 'rate_limited'
  | 'timeout'
  | 'offline'
  | 'too_long' // the conversation does not fit the model's window (not a connection problem)
  | 'server';

export interface AccountCredentials {
  llmCredentials(): LlmCredentials | null;
  renewLlmKey(): Promise<LlmCredentials | null>;
}

export interface SendInput {
  readonly conversationId: string;
  readonly history: readonly ApiMessage[];
  readonly summary?: string | null;
  readonly clearsSoFar: number;
  readonly text: string;
  readonly images?: readonly string[];
  readonly context: AssistantContext;
  readonly confirmation: ConfirmationPort;
  readonly signal: AbortSignal;
  readonly onEvent: (e: AgentEvent) => void;
}

export type SendResult =
  | { readonly ok: true; readonly result: TurnResult }
  | { readonly ok: false; readonly error: AssistantError; readonly detail?: string };

export class AssistantService {
  // Recent reads per conversation (agent-loop's 10 s memo).
  private readonly memos = new Map<string, ToolMemo>();

  constructor(
    private readonly deps: {
      readonly account: AccountCredentials;
      readonly vehicle: VehicleToolsPort;
      readonly makeLlm: (credentials: LlmCredentials) => LlmPort;
      // The mechanic's instructions in the socios build; the driver's otherwise.
      readonly persona?: Persona;
    },
  ) {}

  async send(input: SendInput): Promise<SendResult> {
    const credentials = this.deps.account.llmCredentials();
    if (!credentials) return { ok: false, error: 'no_account' };
    let memo = this.memos.get(input.conversationId);
    if (!memo) this.memos.set(input.conversationId, (memo = new ToolMemo()));

    let shown = false;
    const run = (llm: LlmPort) =>
      runTurn({
        history: input.history,
        summary: input.summary ?? null,
        text: input.text,
        ...(input.images?.length ? { images: input.images } : {}),
        context: input.context,
        ...(this.deps.persona ? { persona: this.deps.persona } : {}),
        llm,
        vehicle: this.deps.vehicle,
        confirmation: input.confirmation,
        clearsSoFar: input.clearsSoFar,
        memo,
        signal: input.signal,
        onEvent: (e) => {
          shown = true;
          input.onEvent(e);
        },
      });

    try {
      return { ok: true, result: await run(this.deps.makeLlm(credentials)) };
    } catch (err) {
      if (!(err instanceof LlmHttpError && err.status === 401) || shown) return { ok: false, ...classify(err) };
    }
    const renewed = await this.deps.account.renewLlmKey().catch(() => null);
    if (!renewed) return { ok: false, error: 'unauthorized' };
    try {
      return { ok: true, result: await run(this.deps.makeLlm(renewed)) };
    } catch (err) {
      return { ok: false, ...classify(err) };
    }
  }

  async nextQuestions(history: readonly ApiMessage[], asked: string | null, summary: string | null = null): Promise<string[]> {
    const credentials = this.deps.account.llmCredentials();
    if (!credentials || history.length === 0) return [];
    try {
      const request = nextQuestionsRequest(history, { summary, audience: this.deps.persona?.audience ?? 'driver' });
      const r = await this.deps.makeLlm(credentials).complete(request);
      return parseNextQuestions(r.content, asked);
    } catch {
      return [];
    }
  }

  // A summary of turns that left the context (M4). Null if it fails: the turns
  // are then simply left out, as before.
  async summarize(previous: string | null, dropped: readonly ApiMessage[], signal?: AbortSignal): Promise<string | null> {
    const credentials = this.deps.account.llmCredentials();
    if (!credentials || dropped.length === 0) return null;
    try {
      const r = await this.deps.makeLlm(credentials).complete(summaryRequest(previous, dropped), signal ? { signal } : {});
      const text = r.content.trim();
      return text || null;
    } catch {
      return null;
    }
  }
}

function classify(err: unknown): { error: AssistantError; detail?: string } {
  if (err instanceof LlmHttpError) {
    if (err.status === 0) return { error: 'timeout' };
    if (err.status === 401) return { error: 'unauthorized' };
    if (err.status === 403) return { error: 'disabled' };
    if (err.status === 429) return { error: 'rate_limited' };
    if (isContextOverflow(err)) return { error: 'too_long' };
    return { error: 'server', detail: `HTTP ${err.status}` };
  }
  // fetch failing to connect: TypeError ("Network request failed").
  return { error: 'offline', detail: err instanceof Error ? err.message : String(err) };
}
