import { classifyCommand } from '@/domain/obd/uds-safety';
import { parseToolCall } from '@/domain/assistant/tools';
import { moduleAnswered, scanTargets } from '@/domain/obd/module-scan';

describe('classifyCommand — read-only boundary', () => {
  it('allows read UDS and OBD services and adapter config', () => {
    for (const c of ['19 02 FF', '1902FF', '22 F1 90', '3E 00', '10 01', '01 0C', '0902', 'ATSH 7E0', 'ATCRA 7E8', 'STPX H:7E0, D:1902', 'ATI', 'STDI']) {
      expect(classifyCommand(c).ok).toBe(true);
    }
  });

  it('blocks every write / erase / flash / reset / unlock service', () => {
    const blocked = ['2E F1 90 01', '2F AB CD', '31 01 FF 00', '34 00 44', '36 01', '37', '3D 00', '27 01', '28 03 01', '85 02', '11 01', '14 FF FF FF', '04'];
    for (const c of blocked) expect(classifyCommand(c).ok).toBe(false);
  });

  it('only the default session passes (not programming/extended)', () => {
    expect(classifyCommand('10 01').ok).toBe(true);
    expect(classifyCommand('10 02').ok).toBe(false);
    expect(classifyCommand('10 03').ok).toBe(false);
  });

  it('blocks adapter commands that reprogram it or change baud', () => {
    expect(classifyCommand('ATPP 2C SV 01').ok).toBe(false);
    expect(classifyCommand('STSBR 115200').ok).toBe(false);
    expect(classifyCommand('ATBRD 23').ok).toBe(false);
  });

  it('rejects garbage', () => {
    expect(classifyCommand('').ok).toBe(false);
    expect(classifyCommand('hola').ok).toBe(false);
    expect(classifyCommand('19 0').ok).toBe(false); // odd nibble count
  });
});

describe('module scan targets', () => {
  it('11-bit: 7E0-7E7 request, response +8', () => {
    const t = scanTargets(false);
    expect(t).toHaveLength(8);
    expect(t[0]).toMatchObject({ id: '11:7E0', reqHeader: '7E0', rxHeader: '7E8' });
    expect(t[1]!.rxHeader).toBe('7E9');
  });

  it('29-bit: 18DAttF1 request, 18DAF1tt response', () => {
    const t = scanTargets(true);
    const pcm = t.find((x) => x.id === '29:10')!;
    expect(pcm.reqHeader).toBe('18DA10F1');
    expect(pcm.rxHeader).toBe('18DAF110');
  });

  it('a 7F negative response still counts as a module that is there', () => {
    expect(moduleAnswered('7F 22 31')).toBe(true);
    expect(moduleAnswered('62 F1 90 31 46 41')).toBe(true);
    expect(moduleAnswered('NO DATA')).toBe(false);
    expect(moduleAnswered('CAN ERROR')).toBe(false);
  });
});


describe('new tool parsing', () => {
  it('web_fetch needs an http url', () => {
    expect(parseToolCall('web_fetch', '{"url":"https://github.com/x"}', [])).toMatchObject({ ok: true });
    expect(parseToolCall('web_fetch', '{"url":"ftp://x"}', [])).toMatchObject({ ok: false });
  });
  it('obd_command takes a command and optional header', () => {
    expect(parseToolCall('obd_command', '{"command":"1902FF","header":"18DA10F1"}', [])).toMatchObject({ ok: true, call: { header: '18DA10F1' } });
    expect(parseToolCall('obd_command', '{"command":"x"}', [])).toMatchObject({ ok: false });
  });
  it('scan_modules and knowledge_lookup', () => {
    expect(parseToolCall('scan_modules', '{}', [])).toMatchObject({ ok: true });
    expect(parseToolCall('knowledge_lookup', '{"make":"Ford","model":"Focus","year":2015}', [])).toMatchObject({ ok: true, call: { make: 'Ford', year: 2015 } });
  });
});

import { BUS_PRESET, protocolToPreset, respondersFrom } from '@/domain/obd/module-scan';

describe('multi-bus scan', () => {
  it('restores the car protocol with the right STN preset', () => {
    expect(protocolToPreset('ISO_15765_4_CAN_11BIT_500K')).toBe(33);
    expect(protocolToPreset('ISO_15765_4_CAN_29BIT_500K')).toBe(34);
    expect(protocolToPreset('ISO_15765_4_CAN_11BIT_250K')).toBe(35);
    expect(BUS_PRESET.MS.bit11).toBe(53);
    expect(BUS_PRESET.SW.bit29).toBe(64);
  });

  it('reads 11-bit responders from a functional broadcast', () => {
    const raw = '7E8 02 7E 00\n7E9 02 7E 00\n7EA 02 7E 00';
    const r = respondersFrom(raw, false);
    expect(r.map((x) => x.id)).toEqual(['11:7E0', '11:7E1', '11:7E2']);
    expect(r[0]!.rxHeader).toBe('7E8');
  });

  it('reads 29-bit responders (module = tt in 18DAF1tt)', () => {
    const raw = '18 DA F1 10 02 7E 00\n18DAF128 02 7E 00';
    const r = respondersFrom(raw, true);
    expect(r.map((x) => x.id)).toEqual(['29:10', '29:28']);
    expect(r[1]!.reqHeader).toBe('18DA28F1');
  });

  it('ignores noise lines', () => {
    expect(respondersFrom('NO DATA\nSEARCHING...\n>', false)).toEqual([]);
  });
});
