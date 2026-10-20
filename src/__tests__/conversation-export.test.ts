import { newConversation, type Conversation } from '@/domain/assistant/conversation';
import { exportConversation, exportFileName } from '@/domain/assistant/conversation-export';

const base = newConversation('c1', Date.UTC(2026, 9, 20, 12, 0));
const c: Conversation = {
  ...base,
  title: 'Batería',
  api: [
    {
      role: 'user',
      content: [
        { type: 'text', text: '¿qué es esta luz?' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
      ],
    },
    { role: 'assistant', content: 'Es el testigo de batería.' },
  ],
};

describe('exportConversation', () => {
  it('keeps what the model saw but not the photos', () => {
    const out = JSON.parse(exportConversation(c, Date.UTC(2026, 9, 20, 13, 0), '1.0.0'));
    expect(out.kind).toBe('obdient2-conversation');
    expect(out.title).toBe('Batería');
    expect(JSON.stringify(out)).not.toContain('base64');
    expect(out.api[0].content[1]).toEqual({ type: 'text', text: '[foto]' });
    expect(out.api[1].content).toBe('Es el testigo de batería.');
  });

  it('names the file by date', () => {
    expect(exportFileName(c)).toMatch(/^chat-20261020-\d{4}\.json$/);
  });
});
