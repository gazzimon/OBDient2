import type { EcuMessage } from '@/core/utils/obdFrames';
import {
  classifyReply,
  CONTROL_DIDS,
  confirmationText,
  didRequest,
  isIdentificationDid,
  isProbeCommand,
  listPlan,
  MAX_CALL_MS,
  MAX_DIDS_PER_CALL,
  moduleVerdict,
  newCodes,
  nextCursor,
  normalizeDid,
  ProbeGuard,
  rangePlan,
  sampleOf,
  startCheck,
  summarize,
  verdictText,
  type ProbeResult,
} from '@/domain/obd/did-probe';

const msg = (bytes: number[], ecu: string | null = '18DAF128', complete = true): EcuMessage => ({ ecu, bytes, complete });
const res = (outcome: ProbeResult['outcome'], did = 'F190'): ProbeResult => ({ did, outcome });

describe('what a probe may send', () => {
  it('lets through one DID read, TesterPresent and the stored codes', () => {
    for (const c of ['22F190', '22 f1 87', '3E00', '3E 00', '03']) expect(isProbeCommand(c)).toBe(true);
    expect(didRequest('F190')).toBe('22F190');
  });

  it('blocks everything that writes, unlocks, changes session or reads memory', () => {
    // 19, 23, 24 and 2A pass the free command tool; a probe has no use for them.
    for (const c of ['1001', '1003', '1002', '2701', '2702', '2EF190AA', '2F0101', '3101FF00', '1101', '2803', '8502', '14FFFFFF', '04', '1902FF', '23120000', '2A0100']) {
      expect(isProbeCommand(c)).toBe(false);
    }
    expect(isProbeCommand('22F1')).toBe(false); // not a whole DID
    expect(isProbeCommand('22F19001')).toBe(false); // two DIDs in one
    expect(isProbeCommand('')).toBe(false);
  });

  it('lets through the adapter settings that address a module, not the ones that reprogram it', () => {
    for (const c of ['ATSH18DA28F1', 'ATCRA18DAF128', 'STCSEGR 1', 'ATH1', 'STCFCPA 18DA28F1, 18DAF128']) expect(isProbeCommand(c)).toBe(true);
    for (const c of ['ATPP2CSV01', 'STSBR 115200', 'ATBRD10']) expect(isProbeCommand(c)).toBe(false);
  });
});

describe('what to read', () => {
  it('normalizes a DID and rejects what is not one', () => {
    expect(normalizeDid('0xf190')).toBe('F190');
    expect(normalizeDid(' f1 87 ')).toBe('F187');
    expect(normalizeDid('F19')).toBeNull();
    expect(normalizeDid('F190A')).toBeNull();
    expect(normalizeDid('ZZZZ')).toBeNull();
  });

  it('the control set is the standard identification DIDs', () => {
    expect(CONTROL_DIDS.every(isIdentificationDid)).toBe(true);
    expect(isIdentificationDid('F17F')).toBe(false);
    expect(isIdentificationDid('F1A0')).toBe(false);
  });

  it('a range is every DID in it, in order; the default one needs no extra confirmation', () => {
    const plan = rangePlan('F100', 'F1FF');
    expect(plan.ok && plan.dids.length).toBe(256);
    expect(plan.ok && plan.dids[0]).toBe('F100');
    expect(plan.ok && plan.dids[255]).toBe('F1FF');
    expect(plan.ok && plan.outsideDefault).toBe(false);
  });

  it('a range outside F100–F1FF is marked, and one past 512 DIDs or backwards is refused', () => {
    const outside = rangePlan('0100', '01FF');
    expect(outside.ok && outside.outsideDefault).toBe(true);
    expect(rangePlan('F100', 'F200').ok && true).toBe(true); // 257, inside the cap
    const big = rangePlan('0000', 'FFFF');
    expect(big.ok).toBe(false);
    expect(!big.ok && big.message).toContain(String(MAX_DIDS_PER_CALL));
    expect(rangePlan('F1FF', 'F100').ok).toBe(false);
    expect(rangePlan('F1', 'F2').ok).toBe(false);
  });

  it('a list drops repeats, refuses a bad DID and caps at 32', () => {
    const ok = listPlan(['f190', 'F190', 'F187']);
    expect(ok.ok && ok.dids).toEqual(['F190', 'F187']);
    expect(listPlan(['F190', 'nope']).ok).toBe(false);
    expect(listPlan([]).ok).toBe(false);
    const many = Array.from({ length: 33 }, (_, i) => (0x0100 + i).toString(16).padStart(4, '0'));
    expect(listPlan(many).ok).toBe(false);
    expect(listPlan(['0100']).ok && true).toBe(true);
  });
});

describe('how an answer is read', () => {
  it('62 with the DID is supported, with its length and a sample outside identification', () => {
    const r = classifyReply('0123', [msg([0x62, 0x01, 0x23, 0x00, 0x01, 0xe2, 0x40])]);
    expect(r).toEqual({ did: '0123', outcome: 'supported', length: 4, sample: '00 01 E2 40' });
  });

  it('an identification DID keeps its length and never its value', () => {
    const vin = [...'8AGEA76C0RR117525'].map((c) => c.charCodeAt(0));
    const r = classifyReply('F190', [msg([0x62, 0xf1, 0x90, ...vin])]);
    expect(r).toMatchObject({
      did: 'F190',
      outcome: 'supported',
      length: 17,
      catalog: { name: 'Vehicle identification number', privacy: 'vehicle_identifier' },
    });
    expect(JSON.stringify(r)).not.toContain('117525');
  });

  it('a value that is a VIN is not kept even outside the identification range', () => {
    const vin = [...'8AGEA76C0RR117525'].map((c) => c.charCodeAt(0));
    expect(sampleOf('0200', vin)).toBeUndefined();
    expect(sampleOf('0200', [0x41, ...vin])).toBeUndefined(); // a byte before it
    expect(sampleOf('0200', [1, 2, 3])).toBe('01 02 03');
    expect(sampleOf('0200', Array.from({ length: 20 }, (_, i) => i))?.split(' ')).toHaveLength(8);
    expect(sampleOf('0200', [])).toBeUndefined();
  });

  it('each 7F 22 reason has its own outcome', () => {
    const nrc = (code: number) => classifyReply('0123', [msg([0x7f, 0x22, code])]);
    expect(nrc(0x31)).toEqual({ did: '0123', outcome: 'unsupported', nrc: '31' });
    expect(nrc(0x33).outcome).toBe('locked');
    expect(nrc(0x22).outcome).toBe('needs_conditions');
    expect(nrc(0x11).outcome).toBe('service_refused');
    expect(nrc(0x12).outcome).toBe('service_refused');
    expect(nrc(0x7f).outcome).toBe('service_refused');
    expect(nrc(0x13).outcome).toBe('bad_request');
    expect(nrc(0x78).outcome).toBe('pending');
    expect(nrc(0x92)).toEqual({ did: '0123', outcome: 'other_refusal', nrc: '92' });
  });

  it('no message is silence; a cut multi-frame answer is incomplete, not silence', () => {
    expect(classifyReply('F190', []).outcome).toBe('silent');
    expect(classifyReply('F190', [msg([0x62, 0xf1, 0x90, 0x38], '18DAF128', false)]).outcome).toBe('incomplete');
    expect(classifyReply('F190', [msg([0x10, 0x14], '18DAF128', false)]).outcome).toBe('incomplete');
  });

  it('an answer for another DID is a mismatch, and another module\'s answer does not count', () => {
    expect(classifyReply('F190', [msg([0x62, 0xf1, 0x87, 0x01])]).outcome).toBe('mismatch');
    expect(classifyReply('F190', [msg([0x62, 0xf1, 0x90, 0x01], '18DAF160')], '18DAF128').outcome).toBe('silent');
    expect(classifyReply('F190', [msg([0x62, 0xf1, 0x90, 0x01], '18DAF128')], '18DAF128').outcome).toBe('supported');
    // Headers off: the sender is unknown, so the message is taken as this module's.
    expect(classifyReply('F190', [msg([0x62, 0xf1, 0x90, 0x01], null)], '18DAF128').outcome).toBe('supported');
  });
});

describe('does the link work', () => {
  it('any answer, even a refusal, proves it', () => {
    expect(moduleVerdict([res('unsupported'), res('silent', 'F187')])).toBe('link_ok');
    expect(moduleVerdict([res('supported')])).toBe('link_ok');
    expect(moduleVerdict([res('silent')], true)).toBe('link_ok'); // TesterPresent answered
  });

  it('only silence is a link problem, not a DID problem', () => {
    expect(moduleVerdict([res('silent'), res('silent', 'F187')])).toBe('link_silent');
    expect(moduleVerdict([res('silent')], false)).toBe('link_silent');
    expect(moduleVerdict([])).toBe('link_silent');
  });

  it('short answers that work with long ones that do not is the adapter', () => {
    expect(moduleVerdict([res('supported', 'F186'), res('incomplete')])).toBe('link_partial');
    expect(moduleVerdict([res('incomplete')])).toBe('link_partial');
  });

  it('the text names the 29-bit mix-up and CAN FD when silent', () => {
    expect(verdictText('link_silent', true)).toContain('18DA<módulo>F1');
    expect(verdictText('link_silent', true)).toContain('CAN FD');
    expect(verdictText('link_silent', false)).toContain('7E0');
    expect(verdictText('link_partial', true)).toContain('STCSEGR 1');
    expect(verdictText('link_ok', true)).toContain('ese DID no existe');
  });
});

describe('when to stop', () => {
  it('stops after 10 silent answers in a row, and an answer resets the count', () => {
    const guard = new ProbeGuard(() => 0);
    for (let i = 0; i < 9; i++) expect(guard.record(res('silent'))).toBeNull();
    expect(guard.record(res('unsupported'))).toBeNull();
    for (let i = 0; i < 9; i++) expect(guard.record(res('silent'))).toBeNull();
    expect(guard.record(res('silent'))).toBe('silent_streak');
  });

  it('stops at 60 s and when the battery drops below 11.5 V', () => {
    let t = 0;
    const guard = new ProbeGuard(() => t);
    expect(guard.record(res('supported'))).toBeNull();
    t = MAX_CALL_MS - 1;
    expect(guard.record(res('supported'))).toBeNull();
    t = MAX_CALL_MS;
    expect(guard.record(res('supported'))).toBe('time');
    expect(new ProbeGuard(() => 0).record(res('supported'), 11.4)).toBe('low_voltage');
    expect(new ProbeGuard(() => 0).record(res('supported'), 11.5)).toBeNull();
    expect(new ProbeGuard(() => 0).record(res('supported'), null)).toBeNull();
  });

  it('does not start under 12.0 V, but an adapter that cannot measure does not block', () => {
    expect(startCheck(12.0)).toBeNull();
    expect(startCheck(13.8)).toBeNull();
    expect(startCheck(11.9)).toContain('11.9');
    expect(startCheck(null)).toBeNull();
  });
});

describe('the rest', () => {
  it('the confirmation says what, where, how long and that it does not write', () => {
    const t = confirmationText('ABS (18DA28F1)', 256);
    expect(t).toContain('256 DIDs');
    expect(t).toContain('ABS (18DA28F1)');
    expect(t).toMatch(/~\d+ s/);
    expect(t).toContain('no escribe');
  });

  it('the cursor is the next DID to read, or null at the end', () => {
    expect(nextCursor(['F100', 'F101', 'F102'], 1)).toBe('F101');
    expect(nextCursor(['F100', 'F101'], 2)).toBeNull();
  });

  it('reports the codes that appeared while probing', () => {
    expect(newCodes(['P0171'], ['P0171', 'U0100'])).toEqual(['U0100']);
    expect(newCodes([], [])).toEqual([]);
  });

  it('counts outcomes', () => {
    const s = summarize([res('supported'), res('supported'), res('unsupported'), res('silent')]);
    expect(s.supported).toBe(2);
    expect(s.unsupported).toBe(1);
    expect(s.silent).toBe(1);
    expect(s.locked).toBe(0);
  });
});
