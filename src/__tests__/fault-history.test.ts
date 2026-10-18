import { FaultHistory, MAX_EVENTS, type FaultHistoryStorage } from '@/domain/faults/fault-history';

function memory(initial: string | null = null): FaultHistoryStorage & { json: string | null } {
  const s = { json: initial, load: () => s.json, save: (j: string) => void (s.json = j) };
  return s;
}

const VIN = '8AGEA76C0RR117525';
const P0171 = { code: 'P0171', ecu: '18DAF111', owner: 'standard' } as const;
const P0301 = { code: 'P0301', ecu: '18DAF111', owner: 'standard' } as const;

describe('FaultHistory', () => {
  it('keeps changes: the same codes again only move "last seen" and the distance', () => {
    let t = 1000;
    const h = new FaultHistory(memory(), () => t);
    h.record({ type: 'codes', vin: VIN, kind: 'stored', codes: [P0171], distSinceClearKm: 100 });
    t = 2000;
    // Read again while moving: no ECU, same fault.
    h.record({ type: 'codes', vin: VIN, kind: 'stored', codes: [{ ...P0171, ecu: null }], distSinceClearKm: 130 });
    expect(h.list()).toEqual([
      { type: 'codes', vin: VIN, kind: 'stored', codes: [P0171], distSinceClearKm: 130, at: 1000, lastSeenAt: 2000 },
    ]);
    t = 3000;
    h.record({ type: 'codes', vin: VIN, kind: 'stored', codes: [P0171, P0301], distSinceClearKm: 150 });
    t = 4000;
    h.record({ type: 'codes', vin: VIN, kind: 'stored', codes: [], distSinceClearKm: 160 });
    expect(h.list().map((e) => (e.type === 'codes' ? e.codes.map((c) => c.code).join('+') || '∅' : e.type))).toEqual([
      '∅',
      'P0171+P0301',
      'P0171',
    ]);
  });

  it('pending and stored are tracked apart, and cars apart', () => {
    const h = new FaultHistory(memory());
    h.record({ type: 'codes', vin: VIN, kind: 'stored', codes: [P0171], distSinceClearKm: null });
    h.record({ type: 'codes', vin: VIN, kind: 'pending', codes: [P0171], distSinceClearKm: null });
    h.record({ type: 'codes', vin: 'OTHERCAR000000000', kind: 'stored', codes: [P0171], distSinceClearKm: null });
    expect(h.list(VIN)).toHaveLength(2);
    expect(h.list()).toHaveLength(3);
  });

  it('a clear remembers the codes on record and the distance before', () => {
    let t = 1;
    const h = new FaultHistory(memory(), () => t++);
    h.record({ type: 'codes', vin: VIN, kind: 'stored', codes: [P0171], distSinceClearKm: 2197 });
    h.record({ type: 'cleared', vin: VIN, ecus: ['18DAF111'], distSinceClearBeforeKm: 2197, codesBefore: [] });
    expect(h.lastClear(VIN)).toEqual({
      type: 'cleared',
      vin: VIN,
      ecus: ['18DAF111'],
      distSinceClearBeforeKm: 2197,
      codesBefore: [P0171],
      at: 2,
    });
    expect(h.lastClear('OTHERCAR000000000')).toBeNull();
  });

  it('skips a freeze frame identical to the last one', () => {
    const h = new FaultHistory(memory());
    const ff = { type: 'freeze_frame', vin: VIN, dtc: P0171, values: { RPM: { value: 790, unit: 'rpm' } } } as const;
    h.record(ff);
    h.record(ff);
    h.record({ ...ff, values: { RPM: { value: 800, unit: 'rpm' } } });
    expect(h.list()).toHaveLength(2);
  });

  it('survives a restart, a corrupt store, and stays bounded', () => {
    const store = memory();
    const h = new FaultHistory(store);
    for (let i = 0; i < MAX_EVENTS + 20; i++) {
      h.record({ type: 'cleared', vin: VIN, ecus: [], distSinceClearBeforeKm: i, codesBefore: [] });
    }
    const reopened = new FaultHistory(store);
    expect(reopened.list()).toHaveLength(MAX_EVENTS);
    expect(reopened.lastClear(VIN)?.distSinceClearBeforeKm).toBe(MAX_EVENTS + 19);
    expect(new FaultHistory(memory('{not json')).list()).toEqual([]);
  });
});
