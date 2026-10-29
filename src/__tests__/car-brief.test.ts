import { userMessage, type AssistantContext } from '@/domain/assistant/prompt';
import type { FaultEvent } from '@/domain/faults/fault-history';
import { RETRY_DELAYS_MS, ReconnectPolicy } from '@/domain/obd/reconnect-policy';
import type { ApiMessage } from '@/domain/ports/llm.port';
import type { ServiceEntry } from '@/domain/service/service-log';
import { briefToSend, carBrief, carLabel, modelYear } from '@/domain/vehicle/car-brief';
import { linkStatus, type LinkInput } from '@/domain/obd/link-status';

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();
const NOW = day(2026, 10, 29);
const VIN = '8AGEA76C0RR000099';
const code = (c: string) => ({ code: c, ecu: '7E8', owner: 'standard' as const });

const FAULTS: FaultEvent[] = [
  { type: 'codes', kind: 'stored', vin: VIN, at: day(2026, 10, 12), lastSeenAt: day(2026, 10, 20), codes: [code('P0171')], distSinceClearKm: 40 },
  { type: 'cleared', vin: VIN, at: day(2026, 9, 20), ecus: ['7E8'], distSinceClearBeforeKm: 2197, codesBefore: [code('P0171'), code('P0301')] },
  { type: 'codes', kind: 'stored', vin: VIN, at: day(2026, 9, 1), lastSeenAt: day(2026, 9, 19), codes: [code('P0171'), code('P0301')], distSinceClearKm: 2190 },
  { type: 'codes', kind: 'stored', vin: VIN, at: day(2026, 6, 1), lastSeenAt: day(2026, 6, 2), codes: [code('P0171')], distSinceClearKm: 900 },
];
const SERVICES: ServiceEntry[] = [
  { id: 'a', at: day(2026, 9, 12), car: 'Onix', vin: VIN, item: 'Cambio de aceite [5W30]', km: 84300, note: null },
  { id: 'b', at: day(2026, 6, 1), car: 'Onix', vin: VIN, item: 'Filtro de aire', km: null, note: null },
  { id: 'c', at: day(2026, 1, 1), car: 'Onix', vin: VIN, item: 'Pastillas', km: 70000, note: null },
];

describe('car brief', () => {
  it('model year from the 10th character, never in the future; none for European VINs', () => {
    expect(modelYear(VIN, NOW)).toBe(2024);
    expect(modelYear('8AGEA76C0AR000099', NOW)).toBe(2010);
    expect(modelYear('8AGEA76C09R000099', NOW)).toBe(2009);
    expect(modelYear('WVWZZZ1KZAW000001', NOW)).toBeNull();
    expect(modelYear('8AGEA76C0OR000099', NOW)).toBeNull();
  });

  it('who the car is, its codes, the last clear and the service, with the VIN masked', () => {
    const b = carBrief({ vin: VIN, faults: FAULTS, services: SERVICES, baselineSessions: 14, now: NOW });
    expect(b).toBe(
      [
        '[auto conectado: Chevrolet, año 2024 según el VIN (VIN 8AGEA76C0RR••••••) · lo habitual aprendido en 14 conexiones',
        '- códigos guardados en la última lectura: P0171 (20/10/2026)',
        '- códigos que tuvo: P0171 ×3, P0301',
        '- último borrado de códigos: 20/09/2026, 2.197 km después del borrado anterior; tenía P0171, P0301',
        '- service: Cambio de aceite 5W30 12/09/2026 a 84.300 km; Filtro de aire 01/06/2026]',
      ].join('\n'),
    );
    expect(b).not.toContain('000099');
  });

  it('a new car and a car without VIN', () => {
    expect(carBrief({ vin: VIN, faults: [], services: [], baselineSessions: 1, now: NOW })).toBe(
      '[auto conectado: Chevrolet, año 2024 según el VIN (VIN 8AGEA76C0RR••••••) · lo habitual todavía en aprendizaje (1 de 3 conexiones)\n- sin códigos registrados en este teléfono]',
    );
    expect(carBrief({ vin: null, faults: FAULTS, services: SERVICES, baselineSessions: 0, now: NOW })).toBe(
      '[auto conectado: el auto no informa el VIN; no hay historial de este auto]',
    );
  });

  const sent = (text: string): ApiMessage[] => [
    { role: 'user', content: text },
    { role: 'assistant', content: 'ok' },
  ];

  it('goes once per conversation, again when it changes, and warns when the car is another', () => {
    const a = carBrief({ vin: VIN, faults: FAULTS, services: [], baselineSessions: 5, now: NOW });
    expect(briefToSend(a, [])).toBe(a);
    expect(briefToSend(a, sent(`hola\n\n${a}\n\n[estado: x]`))).toBeNull();
    // Same car, one more connection learnt: sent again, not a car change.
    const a2 = carBrief({ vin: VIN, faults: FAULTS, services: [], baselineSessions: 6, now: NOW });
    expect(briefToSend(a2, sent(`hola\n\n${a}`))).toBe(a2);
    const other = carBrief({ vin: '9BWAB45U0AT000001', faults: [], services: [], baselineSessions: 0, now: NOW });
    expect(briefToSend(other, sent(`hola\n\n${a}`))).toMatch(/^\[cambió el auto: .*\]\n\[auto conectado: Volkswagen/);
  });

  it('a brief that fell out of the recent messages is sent again', () => {
    const a = carBrief({ vin: VIN, faults: [], services: [], baselineSessions: 5, now: NOW });
    const long = [...sent(`hola\n\n${a}`), ...Array.from({ length: 5 }, () => sent('otra')).flat()];
    expect(briefToSend(a, long)).toBe(a);
  });

  it('rides between the text and the state block', () => {
    const ctx: AssistantContext = { connected: true, protocol: null, supportedPids: 4, moving: false, speedKmh: 0, navigating: false, labMode: false, car: '[auto conectado: x (VIN y)]' };
    expect(userMessage('¿y?', ctx)).toBe('¿y?\n\n[auto conectado: x (VIN y)]\n\n[estado: adaptador conectado, 4 PIDs soportados · auto detenido · sin navegación]');
    expect(userMessage('¿y?', ctx, sent('a\n\n[auto conectado: x (VIN y)]'))).not.toContain('auto conectado');
  });
});

describe('top bar', () => {
  const base: LinkInput = { state: 'disconnected', retrying: false, stoppedByUser: false, deviceName: null, rememberedName: 'OBDII B35', remembered: true, car: undefined, vinRead: false };
  it('says the adapter and the car, and what it is doing', () => {
    expect(linkStatus({ ...base, state: 'connected', deviceName: 'OBDII B35', vinRead: true, car: carLabel(VIN, NOW) })).toEqual({ tone: 'ok', text: 'OBDII B35 · Chevrolet 2024' });
    expect(linkStatus({ ...base, state: 'connected', deviceName: 'OBDII B35', vinRead: true, car: null }).text).toBe('OBDII B35 · auto sin VIN');
    expect(linkStatus({ ...base, state: 'connected', deviceName: 'OBDII B35' }).text).toBe('OBDII B35');
    expect(linkStatus({ ...base, retrying: true })).toEqual({ tone: 'busy', text: 'Buscando OBDII B35…' });
    expect(linkStatus({ ...base, retrying: true, stoppedByUser: true }).text).toBe('OBDII B35 desconectado');
    expect(linkStatus({ ...base, remembered: false, rememberedName: null })).toEqual({ tone: 'off', text: 'Sin adaptador · Conectar' });
  });
});

describe('reconnect policy', () => {
  it('waits longer after each failure, up to a minute, and a fresh reason starts over', () => {
    const p = new ReconnectPolicy();
    expect([p.nextDelay(), p.nextDelay(), p.nextDelay(), p.nextDelay(), p.nextDelay()]).toEqual([...RETRY_DELAYS_MS, 60_000]);
    expect(p.shouldTry()).toBe(true);
    expect(p.nextDelay()).toBe(5_000);
  });

  it('"Desconectar" stops it until the next connection', () => {
    const p = new ReconnectPolicy();
    p.userStopped();
    expect(p.shouldTry()).toBe(false);
    expect(p.nextDelay()).toBeNull();
    p.connected();
    expect(p.shouldTry()).toBe(true);
  });
});
