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

  // The 2026-10-21 chat: the VIN as a pasted capture, as a tool result, in the
  // assistant's words and in the tool row, plus the town and the places' position.
  it('does not carry the VIN serial in any form, the town, or a precise position', () => {
    const vin = '8AGEA76C0RR000099';
    const capture = ['> 0902 (77 ms)', '  014', '  0:490201384147', '  1:45413736433052', '  2:52303030303939', '  = ECU ?: 49 02 01 38 41 47 45 41 37 36 43 30 52 52 30 30 30 30 39 39'].join('\n');
    const state = '[estado: adaptador conectado (ISO_15765_4_CAN_29BIT_500K), 21 PIDs soportados · auto detenido · sin navegación · en Posadas, Misiones]';
    const leaky: Conversation = {
      ...base,
      api: [
        { role: 'user', content: `${capture}\n\n${state}` },
        { role: 'assistant', content: `Lo que sí se ve en tu captura es el VIN: ${vin}.` },
        { role: 'tool', tool_call_id: 't1', content: JSON.stringify({ result: { vin, make: 'chevrolet' } }) },
      ],
      items: [
        { kind: 'tool', id: 't1', at: 1, name: 'read_vehicle_info', status: 'ok', detail: `VIN ${vin}, 21 PIDs soportados` },
        { kind: 'tool', id: 't2', at: 2, name: 'search_place', status: 'ok', detail: '5 resultados', places: [{ n: 2, name: 'Maná', detail: 'Avenida Uruguay 2677, Posadas', lat: -27.3749243, lng: -55.8984652, distanceKm: 0.8 }] },
      ],
    };
    const text = exportConversation(leaky, Date.UTC(2026, 9, 21, 21, 47), '0.1.0');
    expect(text).not.toMatch(/000043/);
    expect(text).not.toContain('303030303939');
    expect(text).not.toContain('30 30 30 30 39 39');
    expect(text).not.toContain('Posadas, Misiones]');
    expect(text).not.toContain('-27.3749243');
    expect(text).not.toContain('-55.8984652');
    const out = JSON.parse(text);
    expect(out.redacted).toBe(true);
    // What says what the car is stays, so the report is still useful.
    expect(text).toContain('8AGEA76C0RR••••••');
    expect(text).toContain('chevrolet');
    expect(out.items[1].places[0]).toMatchObject({ name: 'Maná', lat: -27.37, lng: -55.9 });
    expect(out.api[0].content).toContain('sin navegación]');
  });

  it('names the file by date', () => {
    expect(exportFileName(c)).toMatch(/^chat-20261020-\d{4}\.json$/);
  });
});
