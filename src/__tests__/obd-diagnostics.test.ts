import { readMessages } from '@/core/utils/obdFrames';
import {
  decodeDtc,
  dtcOwner,
  maskToPids,
  mergeMonitorStatus,
  parseDtcs,
  parseFreezeFrameDtc,
  parseFreezeFrameValue,
  parseMonitorStatus,
  parseVin,
  vinCheckDigitOk,
} from '@/core/utils/obdDiagnostics';

const CAN_H = { headers: true, can: true };
const CAN = { headers: false, can: true };
const read = (text: string, format = CAN_H) => readMessages(text, format);

describe('decodeDtc / dtcOwner (SAE J2012 §5)', () => {
  it('decodes the letter, the first digit and three hex digits', () => {
    expect(decodeDtc(0x01, 0x71)).toBe('P0171');
    expect(decodeDtc(0x03, 0x01)).toBe('P0301');
    expect(decodeDtc(0x41, 0x23)).toBe('C0123');
    expect(decodeDtc(0x92, 0x34)).toBe('B1234'); // J2012's own example, $9234
    expect(decodeDtc(0xc1, 0x00)).toBe('U0100');
    expect(decodeDtc(0x2a, 0x0f)).toBe('P2A0F');
  });

  it('tells standard codes from the carmaker ones', () => {
    expect(['P0171', 'P2096', 'B0001', 'C0035', 'U0100', 'P3400'].map(dtcOwner)).toEqual(Array(6).fill('standard'));
    expect(['P1101', 'B1234', 'B2AAA', 'C1000', 'U1000', 'U2100', 'P3000', 'P33FF'].map(dtcOwner)).toEqual(
      Array(8).fill('manufacturer'),
    );
    expect(dtcOwner('B3000')).toBe('reserved');
    expect(dtcOwner('U3000')).toBe('unspecified');
  });
});

describe('parseDtcs', () => {
  it('B35 car: "43 00" means no codes, and says which ECU answered', () => {
    const report = parseDtcs(read('18DAF111024300'), 0x03, true);
    expect(report).toEqual({ codes: [], ecus: ['18DAF111'], refusals: [], truncated: false });
  });

  it('CAN: the count byte, then the codes, from several ECUs', () => {
    const report = parseDtcs(read('7E8 06 43 02 01 71 03 01\n7E9 04 43 01 07 00'), 0x03, true);
    expect(report.codes.map((d) => `${d.ecu}:${d.code}`)).toEqual(['7E8:P0171', '7E8:P0301', '7E9:P0700']);
    expect(report.codes[0]).toEqual({ code: 'P0171', system: 'powertrain', owner: 'standard', ecu: '7E8' });
  });

  it('CAN multi-frame list without headers', () => {
    const text = '00A\n0:470401710301\n1:01024141000000';
    const report = parseDtcs(readMessages(text, CAN), 0x07, true);
    expect(report.codes.map((d) => d.code)).toEqual(['P0171', 'P0301', 'P0102', 'C0141']);
  });

  it('flags an answer that lost frames', () => {
    const report = parseDtcs(read('7E8 10 0B 43 04 01 71 03 01'), 0x03, true);
    expect(report.truncated).toBe(true);
    expect(report.codes.map((d) => d.code)).toEqual(['P0171', 'P0301']);
  });

  it('J1850/K-Line: three codes per line, 0000 is filler', () => {
    const report = parseDtcs(
      readMessages('43 01 33 00 00 00 00\n43 01 71 03 01 C1 00', { headers: false, can: false }),
      0x03,
      false,
    );
    expect(report.codes.map((d) => d.code)).toEqual(['P0133', 'P0171', 'P0301', 'U0100']);
  });

  it('keeps refusals apart (7F 0A 11: permanent codes not supported)', () => {
    const report = parseDtcs(read('7E8 03 7F 0A 11\n7E9 02 4A 00'), 0x0a, true);
    expect(report.refusals).toEqual([{ ecu: '7E8', code: 0x11 }]);
    expect(report.ecus).toEqual(['7E9']);
  });
});

describe('parseMonitorStatus (01 01)', () => {
  it('B35 car: light off, no codes, seven monitors, all complete', () => {
    const [s] = parseMonitorStatus(read('18DAF1110641010007E100'));
    expect(s).toEqual({
      ecu: '18DAF111',
      milOn: false,
      dtcCount: 0,
      ignition: 'spark',
      monitors: [
        { id: 'misfire', complete: true },
        { id: 'fuel_system', complete: true },
        { id: 'components', complete: true },
        { id: 'catalyst', complete: true },
        { id: 'oxygen_sensor', complete: true },
        { id: 'oxygen_sensor_heater', complete: true },
        { id: 'egr_vvt', complete: true },
      ],
    });
  });

  it('light on with two codes, catalyst and evap not complete (freshly cleared)', () => {
    const [s] = parseMonitorStatus(read('7E8 06 41 01 82 07 65 05'));
    expect(s!.milOn).toBe(true);
    expect(s!.dtcCount).toBe(2);
    expect(s!.monitors.filter((m) => !m.complete).map((m) => m.id)).toEqual(['catalyst', 'evap_system']);
  });

  it('diesel uses the compression-ignition monitor set', () => {
    const [s] = parseMonitorStatus(read('7E8 06 41 01 00 0F 4B 40'));
    expect(s!.ignition).toBe('compression');
    expect(s!.monitors.map((m) => `${m.id}${m.complete ? '' : '*'}`)).toEqual([
      'misfire',
      'fuel_system',
      'components',
      'nmhc_catalyst',
      'nox_aftertreatment',
      'boost_pressure',
      'particulate_filter*',
    ]);
  });

  it('merges ECUs: light from any, complete only if all agree', () => {
    const merged = mergeMonitorStatus(parseMonitorStatus(read('7E8 06 41 01 81 07 01 00\n7E9 06 41 01 00 07 01 01')));
    expect(merged!.milOn).toBe(true);
    expect(merged!.dtcCount).toBe(1);
    expect(merged!.monitors.find((m) => m.id === 'catalyst')).toEqual({ id: 'catalyst', complete: false });
    expect(mergeMonitorStatus([])).toBeNull();
  });
});

describe('freeze frame (mode 02)', () => {
  it('B35 car: "42 02 00 00 00" means no freeze frame stored', () => {
    expect(parseFreezeFrameDtc(read('18DAF111054202000000'))).toBeNull();
  });

  it('the code that stored it, and values with the live-data formulas', () => {
    expect(parseFreezeFrameDtc(read('7E8 05 42 02 00 01 71'))).toEqual({
      code: 'P0171',
      system: 'powertrain',
      owner: 'standard',
      ecu: '7E8',
    });
    expect(parseFreezeFrameValue(read('7E8 05 42 0C 00 0C 58'), 'RPM', 0x0c)).toBe(790);
    expect(parseFreezeFrameValue(read('7E8 04 42 05 00 83'), 'COOLANT_TEMP', 0x05)).toBe(91);
    expect(parseFreezeFrameValue(read('7E8 04 42 05 00 83'), 'RPM', 0x0c)).toBeNull();
  });
});

describe('maskToPids', () => {
  it('B35 car: mode 09 supports VIN, calibration, CVN, in-use performance, ECU name', () => {
    expect(maskToPids([0x55, 0x40, 0x02, 0x00], 0)).toEqual([0x02, 0x04, 0x06, 0x08, 0x0a, 0x17]);
  });
});

describe('parseVin', () => {
  it('B35 car, with and without headers, built in Argentina', () => {
    const withHeaders = parseVin(read('18DAF1111014490201384147\n18DAF1112145413736433052\n18DAF1112252303030303433'), true);
    const without = parseVin(readMessages('014\n0:490201384147\n1:45413736433052\n2:52303030303433', CAN), true);
    expect(withHeaders).toEqual({ vin: '8AGEA76C0RR000043', ecu: '18DAF111', wellFormed: true, checkDigitOk: false });
    expect(without!.vin).toBe(withHeaders!.vin);
  });

  it('J1850: chunks in order, leading filler dropped (ELM327 datasheet)', () => {
    const lines = '49 02 01 00 00 00 31\n49 02 03 30 30 52 35\n49 02 02 44 34 47 50\n49 02 04 35 42 31 32\n49 02 05 33 34 35 36';
    expect(parseVin(readMessages(lines, { headers: false, can: false }), false)!.vin).toBe('1D4GP00R55B123456');
  });

  it('check digit (position 9)', () => {
    expect(vinCheckDigitOk('1M8GDM9AXKP042788')).toBe(true);
    expect(vinCheckDigitOk('11111111111111111')).toBe(true);
    expect(vinCheckDigitOk('1M8GDM9A1KP042788')).toBe(false);
    expect(vinCheckDigitOk('1M8GDM9AXKP04278')).toBe(false);
  });
});
