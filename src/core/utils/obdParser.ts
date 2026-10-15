// Converts raw ELM327 hex responses into real-world numeric values.
// Each formula mirrors the official OBD-II SAE J1979 specification.
// Input strings are the raw adapter response AFTER the echo/prompt has been
// stripped by the datasource layer, but BEFORE the mode/PID header bytes are
// removed — that stripping now happens here, anchored on the header, not by
// blindly skipping the first two tokens (PLAN-005 Fase 0).

import { PID_DEFINITIONS, type PidId } from '@/core/constants/pids';
import { extractPidPayload } from '@/core/utils/hexFrame';

// Derives the 2-char mode-01 PID hex ('0C', 'A6', ...) from a PID's command
// ('010C' → '0C'). Returns null for AT-command PIDs (VOLTAGE/ATRV) — those
// have no "41 <pid>" header to anchor on and are parsed from adapter text
// directly (see parseVoltage / the VOLTAGE branch in parsePidResponse).
function pidHexFor(pidId: PidId): string | null {
  const command = PID_DEFINITIONS[pidId].command;
  const hex = /^01([0-9A-Fa-f]{2})$/.exec(command)?.[1];
  return hex != null ? hex.toUpperCase() : null;
}

// Parses a single hex byte string into an integer
function byteToInt(hex: string): number {
  const value = parseInt(hex, 16);
  if (isNaN(value)) {
    throw new Error(`Invalid hex byte: "${hex}"`);
  }
  return value;
}

// --- Individual PID parsers ---
// Each takes the data bytes AFTER the "41 <pid>" header (already located and
// stripped by parsePidResponse via extractPidPayload) and applies its formula.

// 010C — Engine RPM: ((A*256)+B)/4 → rpm
function parseRpm(bytes: readonly string[]): number {
  const [a, b] = bytes;
  if (a === undefined || b === undefined) throw new Error('RPM: missing bytes');
  return (byteToInt(a) * 256 + byteToInt(b)) / 4;
}

// 010D — Vehicle Speed: A → km/h
function parseSpeed(bytes: readonly string[]): number {
  const [a] = bytes;
  if (a === undefined) throw new Error('SPEED: missing byte');
  return byteToInt(a);
}

// 0105 — Coolant Temperature: A-40 → °C
function parseCoolantTemp(bytes: readonly string[]): number {
  const [a] = bytes;
  if (a === undefined) throw new Error('COOLANT_TEMP: missing byte');
  return byteToInt(a) - 40;
}

// 0167 — Coolant Temperature Sensor 1/2: A = presence bits, B = sensor 1
// temp (B-40 → °C), C = sensor 2 (ignored, see PID_DEFINITIONS comment).
// Throws if bit0 of A says sensor 1 isn't actually fitted — a stale/garbage
// B byte is worse than a clear error.
function parseCoolantTempSensor1(bytes: readonly string[]): number {
  const [a, b] = bytes;
  if (a === undefined || b === undefined) throw new Error('COOLANT_TEMP_SENSOR1: missing bytes');
  const presence = byteToInt(a);
  if ((presence & 0x01) === 0) throw new Error('COOLANT_TEMP_SENSOR1: sensor 1 not fitted (presence bit unset)');
  return byteToInt(b) - 40;
}

// 0104 — Engine Load: A*100/255 → %
function parseEngineLoad(bytes: readonly string[]): number {
  const [a] = bytes;
  if (a === undefined) throw new Error('ENGINE_LOAD: missing byte');
  return (byteToInt(a) * 100) / 255;
}

// 0110 — Mass Air Flow: ((A*256)+B)/100 → g/s
function parseMaf(bytes: readonly string[]): number {
  const [a, b] = bytes;
  if (a === undefined || b === undefined) throw new Error('MAF: missing bytes');
  return (byteToInt(a) * 256 + byteToInt(b)) / 100;
}

// 0111 — Throttle Position: A*100/255 → %
function parseTps(bytes: readonly string[]): number {
  const [a] = bytes;
  if (a === undefined) throw new Error('TPS: missing byte');
  return (byteToInt(a) * 100) / 255;
}

// 010F — Intake Air Temperature: A-40 → °C
function parseIat(bytes: readonly string[]): number {
  const [a] = bytes;
  if (a === undefined) throw new Error('IAT: missing byte');
  return byteToInt(a) - 40;
}

// ATRV — Battery Voltage: parseFloat response string like "12.3V" → V
// Not a mode-01 PID — no "41 <pid>" header, parsed from adapter text directly.
function parseVoltage(response: string): number {
  const cleaned = response.replace(/[\r\n>V]/gi, '').trim();
  const value = parseFloat(cleaned);
  if (isNaN(value)) throw new Error(`VOLTAGE: unparseable response "${response}"`);
  return value;
}

// 0106/0107 — Fuel Trim: (A/128 - 1) * 100 → %
function parseFuelTrim(bytes: readonly string[]): number {
  const [a] = bytes;
  if (a === undefined) throw new Error('FUEL_TRIM: missing byte');
  return (byteToInt(a) / 128 - 1) * 100;
}

// 010E — Timing Advance: A/2 - 64 → °
function parseTimingAdvance(bytes: readonly string[]): number {
  const [a] = bytes;
  if (a === undefined) throw new Error('TIMING_ADVANCE: missing byte');
  return byteToInt(a) / 2 - 64;
}

// 010B — Intake Manifold Pressure: A → kPa
function parseIntakeMap(bytes: readonly string[]): number {
  const [a] = bytes;
  if (a === undefined) throw new Error('INTAKE_MAP: missing byte');
  return byteToInt(a);
}

// 0114/0115 — O2 Sensor: A*0.005 → V (voltage only, ignoring STFT byte B)
function parseO2Sensor(bytes: readonly string[]): number {
  const [a] = bytes;
  if (a === undefined) throw new Error('O2: missing byte');
  return byteToInt(a) * 0.005;
}

// 011F — Run Time Since Engine Start: (A*256)+B → seconds
function parseRunTime(bytes: readonly string[]): number {
  const [a, b] = bytes;
  if (a === undefined || b === undefined) throw new Error('RUN_TIME: missing bytes');
  return byteToInt(a) * 256 + byteToInt(b);
}

// 012F — Fuel Level: A*100/255 → %
function parseFuelLevel(bytes: readonly string[]): number {
  const [a] = bytes;
  if (a === undefined) throw new Error('FUEL_LEVEL: missing byte');
  return (byteToInt(a) * 100) / 255;
}

// 0133 — Barometric Pressure: A → kPa
function parseBarometric(bytes: readonly string[]): number {
  const [a] = bytes;
  if (a === undefined) throw new Error('BAROMETRIC: missing byte');
  return byteToInt(a);
}

// 013C — Catalyst Temperature: ((A*256)+B)/10 - 40 → °C
function parseCatalystTemp(bytes: readonly string[]): number {
  const [a, b] = bytes;
  if (a === undefined || b === undefined) throw new Error('CATALYST_TEMP: missing bytes');
  return (byteToInt(a) * 256 + byteToInt(b)) / 10 - 40;
}

// 0145/0146 — Relative TPS / Ambient Temp: A*100/255 → % | A-40 → °C
function parseRelativeTps(bytes: readonly string[]): number {
  const [a] = bytes;
  if (a === undefined) throw new Error('RELATIVE_TPS: missing byte');
  return (byteToInt(a) * 100) / 255;
}

function parseAmbientTemp(bytes: readonly string[]): number {
  const [a] = bytes;
  if (a === undefined) throw new Error('AMBIENT_TEMP: missing byte');
  return byteToInt(a) - 40;
}

// 01A6 — Odometer: ((A*2^24)+(B*2^16)+(C*2^8)+D)/10 -> km
// The only 4-byte PID the app reads. Present from roughly MY2019; on older
// cars the request simply goes unanswered, which is not an error.
function parseOdometer(bytes: readonly string[]): number {
  const [a, b, c, d] = bytes;
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw new Error('ODOMETER: missing bytes');
  }
  return (
    byteToInt(a) * 16777216 + byteToInt(b) * 65536 + byteToInt(c) * 256 + byteToInt(d)
  ) / 10;
}

// Known ELM327 non-data responses that indicate no sensor reading
const NO_DATA_RESPONSES = new Set([
  'NODATA',
  'NO DATA',
  'ERROR',
  'UNABLETOCONNECT',
  'UNABLE TO CONNECT',
  'BUSINIT',
  'BUS INIT',
  'CANERROR',
  'CAN ERROR',
  'STOPPED',
  'SEARCHING',
]);

// Returns true if the raw response is a known error/no-data string
export function isErrorResponse(raw: string): boolean {
  const normalized = raw.replace(/\s+/g, '').toUpperCase();
  for (const err of NO_DATA_RESPONSES) {
    if (normalized.includes(err.replace(/\s+/g, ''))) return true;
  }
  return false;
}

// Dispatches parsing to the correct formula based on PID id.
// Returns the numeric value rounded to 2 decimal places.
export function parsePidResponse(pidId: PidId, rawResponse: string): number {
  if (isErrorResponse(rawResponse)) {
    throw new Error(`No data from adapter for PID ${pidId}`);
  }

  // VOLTAGE is an AT command (ATRV), not a mode-01 PID — it has no "41 <pid>"
  // header to anchor on, so it's parsed from adapter text directly. Returning
  // early here narrows `pidId` to the remaining mode-01 PIDs for the rest of
  // this function, so the switch below stays exhaustive without a `default`
  // (a new PidId with no case still fails the build — see obdParser.ts history).
  if (pidId === 'VOLTAGE') {
    return Math.round(parseVoltage(rawResponse) * 100) / 100;
  }

  // Every remaining PidId is a mode-01 PID by construction (pidHexFor only
  // returns null for AT-command PIDs, and VOLTAGE was already handled above).
  const pidHex = pidHexFor(pidId);
  if (pidHex === null) {
    throw new Error(`${pidId}: no mode-01 command mapping (check PID_DEFINITIONS)`);
  }
  return parsePidBytes(pidId, extractPidPayload(pidHex, rawResponse));
}

// The formulas, applied to already-extracted data bytes.
//
// Split out from parsePidResponse so freeze frame (mode 02) can reuse them: the
// stored snapshot encodes each value EXACTLY like its live counterpart — only
// the frame header differs — so duplicating the formulas would be duplicating
// the part most likely to drift.
export function parsePidBytes(
  pidId: Exclude<PidId, 'VOLTAGE'>,
  bytes: readonly string[],
): number {
  let value: number;

  switch (pidId) {
    case 'RPM':
      value = parseRpm(bytes);
      break;
    case 'SPEED':
      value = parseSpeed(bytes);
      break;
    case 'COOLANT_TEMP':
      value = parseCoolantTemp(bytes);
      break;
    case 'COOLANT_TEMP_SENSOR1':
      value = parseCoolantTempSensor1(bytes);
      break;
    case 'ENGINE_LOAD':
      value = parseEngineLoad(bytes);
      break;
    case 'MAF':
      value = parseMaf(bytes);
      break;
    case 'TPS':
      value = parseTps(bytes);
      break;
    case 'IAT':
      value = parseIat(bytes);
      break;
    case 'FUEL_TRIM_SHORT':
    case 'FUEL_TRIM_LONG':
      value = parseFuelTrim(bytes);
      break;
    case 'TIMING_ADVANCE':
      value = parseTimingAdvance(bytes);
      break;
    case 'INTAKE_MAP':
      value = parseIntakeMap(bytes);
      break;
    case 'O2_B1S1':
    case 'O2_B1S2':
      value = parseO2Sensor(bytes);
      break;
    case 'RUN_TIME':
    // Same two-byte counter shape as RUN_TIME; only the unit differs, and
    // the unit lives in PID_DEFINITIONS.
    case 'DIST_SINCE_CLEAR':
    case 'TIME_SINCE_CLEAR':
    case 'DIST_WITH_MIL':
    case 'TIME_WITH_MIL':
      value = parseRunTime(bytes);
      break;
    case 'FUEL_LEVEL':
      value = parseFuelLevel(bytes);
      break;
    case 'BAROMETRIC':
      value = parseBarometric(bytes);
      break;
    case 'CATALYST_TEMP':
      value = parseCatalystTemp(bytes);
      break;
    case 'RELATIVE_TPS':
      value = parseRelativeTps(bytes);
      break;
    case 'AMBIENT_TEMP':
      value = parseAmbientTemp(bytes);
      break;
    case 'ODOMETER':
      value = parseOdometer(bytes);
      break;
  }

  return Math.round(value * 100) / 100;
}
