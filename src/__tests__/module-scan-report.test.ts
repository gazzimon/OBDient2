import { applyScanEvent, finishReport, initialScanState, knowledgeRecord, MAX_REPORTS_PER_CAR, ModuleScanLog, type ModuleScanReport, type ScanState } from '@/domain/obd/module-scan-report';
import type { ScanProgressEvent } from '@/domain/obd/module-scan';

const fold = (events: ScanProgressEvent[]): ScanState => events.reduce(applyScanEvent, initialScanState());
const brakes = { id: '11:713', reqHeader: '713', rxHeader: '77D', label: 'Frenos' };
const engine = { id: '11:7E0', reqHeader: '7E0', rxHeader: '7E8', label: 'Motor' };
const SCAN: ScanProgressEvent[] = [
  { type: 'scan-started', protocol: 'ISO_15765_4_CAN_11BIT_500K' },
  { type: 'bus-skipped', bus: 'MS', status: 'unavailable' },
  { type: 'bus-skipped', bus: 'SW', status: 'not-tested' },
  { type: 'bus-started', bus: 'HS', totalTargets: 3 },
  { type: 'target-checked', bus: 'HS', completed: 1, total: 3, targetId: '11:7E0', responded: true },
  { type: 'module-found', bus: 'HS', module: engine },
  { type: 'module-identified', bus: 'HS', moduleId: '11:7E0', source: null },
  { type: 'target-checked', bus: 'HS', completed: 2, total: 3, targetId: '11:7E1', responded: false },
  { type: 'target-checked', bus: 'HS', completed: 3, total: 3, targetId: '11:713', responded: true },
  { type: 'module-found', bus: 'HS', module: brakes },
  { type: 'module-identified', bus: 'HS', moduleId: '11:713', source: 'F187' },
  { type: 'bus-finished', bus: 'HS', modulesFound: 2 },
  { type: 'scan-finished', busesScanned: ['HS'], modulesFound: 2 },
];
const META = {
  at: 1000,
  vin: 'WVWZZZ1KZAW000001',
  make: 'volkswagen',
  model: null,
  protocol: 'ISO_15765_4_CAN_11BIT_500K',
  adapter: 'STN1040',
  path: 'stn' as const,
  makeAddresses: { status: 'loaded' as const, count: 1 },
  skipped: { otherWidth: 0, overLimit: 0 },
};

describe('module scan report: folded from the progress events', () => {
  it('keeps how far it looked: buses tried, silent addresses, who answered and how it was identified', () => {
    const s = fold(SCAN);
    expect(s.finished).toBe(true);
    expect(s.current).toBeNull();
    expect(s.buses).toEqual([
      { bus: 'HS', status: 'scanned', probed: 3, silent: ['11:7E1'] },
      { bus: 'MS', status: 'unavailable', probed: 0, silent: [] },
      { bus: 'SW', status: 'not-tested', probed: 0, silent: [] },
    ]);
    expect(s.modules.map((m) => [m.id, m.identitySource, m.identified])).toEqual([
      ['11:7E0', null, false],
      ['11:713', 'F187', true],
    ]);
  });

  it('live: where the sweep is; a bus the scan never reached stays "not tested"', () => {
    const s = fold(SCAN.slice(0, 5));
    expect(s.current).toEqual({ bus: 'HS', completed: 1, total: 3 });
    expect(s.finished).toBe(false);
    expect(fold([{ type: 'scan-started', protocol: 'x' }]).buses.every((b) => b.status === 'not-tested')).toBe(true);
  });

  it('the part numbers come from the scan, not the events; the warning is kept', () => {
    const s = fold([...SCAN.slice(0, 1), { type: 'lookup-warning', message: 'sin direcciones' }, ...SCAN.slice(1)]);
    const r = finishReport(s, META, new Map([['HS:11:713', '5Q0614517AB']]));
    expect(r).toMatchObject({ version: 1, warning: 'sin direcciones', make: 'volkswagen' });
    expect(r.modules.find((m) => m.id === '11:713')).toMatchObject({ partNumber: '5Q0614517AB', identified: true });
    expect(r.modules.find((m) => m.id === '11:7E0')).toMatchObject({ partNumber: null, identified: false });
  });

  it('for the lab: no VIN, a VIN as part number masked, nothing without a make', () => {
    const r = finishReport(fold(SCAN), META, new Map([['HS:11:7E0', META.vin]]));
    const rec = knowledgeRecord(r)!;
    expect(JSON.stringify(rec)).not.toContain('000001');
    expect(rec).not.toHaveProperty('vin');
    expect(knowledgeRecord({ ...r, make: null })).toBeNull();
  });
});

describe('ModuleScanLog', () => {
  const memory = () => {
    let saved: ModuleScanReport[] = [];
    return { load: () => saved, save: (r: readonly ModuleScanReport[]) => void (saved = [...r]) };
  };
  const report = (at: number, vin: string | null): ModuleScanReport => ({ ...finishReport(fold(SCAN), { ...META, at, vin }, new Map()) });

  it('newest first, a few per car, a car without VIN is one more', () => {
    const log = new ModuleScanLog(memory());
    for (let i = 1; i <= MAX_REPORTS_PER_CAR + 2; i++) log.add(report(i, 'A'));
    log.add(report(100, null));
    expect(log.forVin('A').map((r) => r.at)).toEqual([7, 6, 5, 4, 3]);
    expect(log.forVin(null)).toHaveLength(1);
    expect(log.latest()?.at).toBe(100);
  });
});
