// chat_search (2026-10-22): the assistant looks back at the saved conversations.
// Read only; the conversations stay on the phone and what is sent to the model
// is a few short lines with no coordinates (domain/assistant/chat-search.ts).

import { oldestDay, searchChats } from '@/domain/assistant/chat-search';
import type { Conversation } from '@/domain/assistant/conversation';
import type { ToolCall, ToolOutcome } from '@/domain/assistant/tools';

export class ChatSearchTools {
  constructor(
    private readonly deps: {
      readonly conversations: () => readonly Conversation[];
      // The one in progress: what was said in it is already in the history.
      readonly activeId: () => string | null;
      readonly now?: () => number;
    },
  ) {}

  execute(call: Extract<ToolCall, { name: 'chat_search' }>): ToolOutcome {
    const all = this.deps.conversations();
    const exclude = this.deps.activeId();
    const results = searchChats(all, call.query, { excludeId: exclude, now: this.deps.now?.() ?? Date.now() });
    const searched = all.filter((c) => c.id !== exclude).length;
    return {
      ok: true,
      data: {
        query: call.query,
        results,
        // How far back it can look: only the latest conversations are kept.
        searchedConversations: searched,
        oldest: oldestDay(all, exclude),
      },
      summary: results.length ? `${results.length} coincidencias en conversaciones anteriores` : 'Nada en las conversaciones guardadas',
    };
  }
}
