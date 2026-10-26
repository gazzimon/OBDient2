// A conversation as a file the driver can share (to report a wrong answer).
// Everything the model saw and did — messages, tool calls and results,
// summary, notes, timings — except what identifies the car or its driver:
// - the photos themselves (large, and personal): each one is a marker;
// - the VIN serial, the adapter's MAC, e-mails (domain/privacy/redact.ts);
// - the town the state block names on every message, and the exact position of
//   the places it found (rounded to ~1 km).
// What is left is what is needed to see why an answer was wrong.

import type { ApiMessage } from '@/domain/ports/llm.port';
import { coarseCoord, redactText } from '@/domain/privacy/redact';
import type { ChatItem, Conversation } from './conversation';

export const EXPORT_VERSION = 2;

function withoutPhotos(m: ApiMessage): ApiMessage {
  if (m.role !== 'user' || !Array.isArray(m.content)) return m;
  return {
    ...m,
    content: m.content.map((p) => (p.type === 'image_url' ? { type: 'text' as const, text: '[foto]' } : p)),
  };
}

function withBlurredPlaces(item: ChatItem): ChatItem {
  if (item.kind !== 'tool' || !item.places) return item;
  return { ...item, places: item.places.map((p) => ({ ...p, lat: coarseCoord(p.lat), lng: coarseCoord(p.lng) })) };
}

// "[estado: … · sin navegación · en Posadas, Misiones]" → without the town.
const STATE_TOWN = /(\[estado:[^\]]*?) · en [^\]]*\]/g;

export function exportConversation(c: Conversation, exportedAt: number, app: string): string {
  const json = JSON.stringify(
    {
      kind: 'obdient2-conversation',
      v: EXPORT_VERSION,
      redacted: true,
      app,
      exportedAt: new Date(exportedAt).toISOString(),
      title: c.title,
      createdAt: new Date(c.createdAt).toISOString(),
      updatedAt: new Date(c.updatedAt).toISOString(),
      summary: c.summary ?? null,
      items: c.items.map(withBlurredPlaces),
      api: c.api.map(withoutPhotos),
      stats: c.stats,
      notes: c.notes ?? [],
    },
    null,
    1,
  );
  return redactText(json.replace(STATE_TOWN, '$1]'));
}

// chat-20261020-0915.json
export function exportFileName(c: Conversation): string {
  const d = new Date(c.updatedAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `chat-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}
