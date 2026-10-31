import { batteryVerdict, ecuLabel, readinessVerdict } from '@/domain/diagnosis/views';
import { MONITOR_LABEL } from '@/domain/obd/capture-digest';

const label = (id: keyof typeof MONITOR_LABEL) => MONITOR_LABEL[id];

describe('Monitores: ¿pasa la VTV?', () => {
  it('check engine on: does not pass', () => {
    expect(readinessVerdict({ milOn: true, dtcCount: 5, complete: ['misfire'], incomplete: [] }, label)).toMatchObject({ tone: 'bad', title: 'No pasa la VTV' });
  });

  it('monitors pending: may not pass, and which ones', () => {
    const v = readinessVerdict({ milOn: false, dtcCount: 0, complete: ['misfire', 'fuel_system'], incomplete: ['catalyst', 'evap_system'], distSinceClear: { value: 12.4, unit: 'km' } }, label);
    expect(v).toMatchObject({ tone: 'warn', title: 'Puede no pasar: 2 de 4 monitores listos' });
    expect(v.detail).toContain('catalizador, evaporativo (EVAP)');
    expect(v.detail).toContain('12 km');
  });

  it('all complete and the light off: ready', () => {
    expect(readinessVerdict({ milOn: false, dtcCount: 0, complete: ['misfire', 'catalyst'], incomplete: [] }, label).tone).toBe('ok');
  });
});

describe('Batería', () => {
  it('engine off: charged, low, flat', () => {
    expect(batteryVerdict(12.6, false)).toMatchObject({ tone: 'ok', title: '12,6 V: batería bien' });
    expect(batteryVerdict(12.1, false).tone).toBe('warn');
    expect(batteryVerdict(11.7, false).tone).toBe('bad');
  });

  it('engine running: the alternator', () => {
    expect(batteryVerdict(14.1, true).tone).toBe('ok');
    expect(batteryVerdict(12.5, true)).toMatchObject({ tone: 'bad', detail: expect.stringContaining('alternador') });
    expect(batteryVerdict(15.4, true).tone).toBe('bad');
  });

  it('says when it does not know whether the engine runs', () => {
    expect(batteryVerdict(12.6, null).detail).toContain('sin saber si el motor está en marcha');
  });
});

describe('ecuLabel', () => {
  it('engine and gearbox by their OBD reply IDs, the rest by ID', () => {
    expect(ecuLabel('7e8')).toBe('Motor · 7E8');
    expect(ecuLabel('18DAF118')).toBe('Caja · 18DAF118');
    expect(ecuLabel('7EA')).toBe('ECU 7EA');
    expect(ecuLabel(null)).toBe('sin dato de la ECU');
  });
});
