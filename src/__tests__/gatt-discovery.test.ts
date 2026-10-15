import { normalizeUuid, pickCharacteristics, type GattService } from '@/data/adapters/gatt-discovery';

const ch = (uuid: string, o: Partial<{ n: boolean; w: boolean; wn: boolean }> = {}) => ({
  uuid,
  isNotifiable: o.n ?? false,
  isWritableWithResponse: o.w ?? false,
  isWritableWithoutResponse: o.wn ?? false,
});

describe('normalizeUuid', () => {
  it('shortens Bluetooth-base UUIDs and lowercases the rest', () => {
    expect(normalizeUuid('0000FFF0-0000-1000-8000-00805F9B34FB')).toBe('fff0');
    expect(normalizeUuid('E7810A71-73AE-499D-8C15-FAA9AEF0C3F2')).toBe(
      'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    );
  });
});

describe('pickCharacteristics', () => {
  it('matches the FFF0 layout (notify FFF1, write FFF2)', () => {
    const services: GattService[] = [
      { uuid: '1800', characteristics: [ch('2a00', { w: true })] },
      {
        uuid: '0000fff0-0000-1000-8000-00805f9b34fb',
        characteristics: [
          ch('0000fff1-0000-1000-8000-00805f9b34fb', { n: true }),
          ch('0000fff2-0000-1000-8000-00805f9b34fb', { wn: true }),
        ],
      },
    ];
    expect(pickCharacteristics(services)).toEqual({
      serviceUuid: 'fff0',
      notifyUuid: 'fff1',
      writeUuid: 'fff2',
      writeWithResponse: false,
      source: 'known',
    });
  });

  it('matches the single-characteristic FFE0/FFE1 layout', () => {
    const services: GattService[] = [
      { uuid: 'ffe0', characteristics: [ch('ffe1', { n: true, w: true, wn: true })] },
    ];
    const pair = pickCharacteristics(services);
    expect(pair).toMatchObject({ notifyUuid: 'ffe1', writeUuid: 'ffe1', source: 'known' });
  });

  it('falls back to a structural search for unknown vendors', () => {
    const services: GattService[] = [
      { uuid: '180a', characteristics: [ch('2a29', {})] },
      { uuid: 'aaaa0001-0000-0000-0000-000000000000', characteristics: [
        ch('aaaa0002-0000-0000-0000-000000000000', { n: true }),
        ch('aaaa0003-0000-0000-0000-000000000000', { w: true }),
      ] },
    ];
    expect(pickCharacteristics(services)).toMatchObject({
      serviceUuid: 'aaaa0001-0000-0000-0000-000000000000',
      notifyUuid: 'aaaa0002-0000-0000-0000-000000000000',
      writeUuid: 'aaaa0003-0000-0000-0000-000000000000',
      writeWithResponse: true,
      source: 'heuristic',
    });
  });

  it('ignores generic services and returns null when no serial channel exists', () => {
    expect(
      pickCharacteristics([{ uuid: '1800', characteristics: [ch('2a00', { n: true, w: true })] }]),
    ).toBeNull();
    expect(pickCharacteristics([])).toBeNull();
  });
});
