// A conversation as a file the driver can share (to report a wrong answer).
// Everything the model saw and did — messages, tool calls and results,
// summary, notes, timings — except the photos themselves (large, and
// personal): each one is replaced by a marker.

import type { ApiMessage } from '@/domain/ports/llm.port';
import type { Conversation } from './conversation';

export const EXPORT_VERSION = 1;

function withoutPhotos(m: ApiMessage): ApiMessage {
  if (m.role !== 'user' || !Array.isArray(m.content)) return m;
  return {
    ...m,
    content: m.content.map((p) => (p.type === 'image_url' ? { type: 'text' as const, text: '[foto]' } : p)),
  };
}

export function exportConversation(c: Conversation, exportedAt: number, app: string): string {
  return JSON.stringify(
    {
      kind: 'obdient2-conversation',
      v: EXPORT_VERSION,
      app,
      exportedAt: new Date(exportedAt).toISOString(),
      title: c.title,
      createdAt: new Date(c.createdAt).toISOString(),
      updatedAt: new Date(c.updatedAt).toISOString(),
      summary: c.summary ?? null,
      items: c.items,
      api: c.api.map(withoutPhotos),
      stats: c.stats,
      notes: c.notes ?? [],
    },
    null,
    1,
  );
}

// chat-20261020-0915.json
export function exportFileName(c: Conversation): string {
  const d = new Date(c.updatedAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `chat-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}
