// A diagnostic capture pasted into the chat, decoded by the app (2026-10-25).
//
// The 2026-10-21 chat pasted two captures (~2.5k tokens of hex each) and the
// model read them by hand: it called 0131 the coolant temperature (it is the
// distance since codes were cleared, 47 km) and the mode 02 answers "distance"
// (they are the freeze frame). The app has the decoders the tools use; the model
// gets one line per request with what it means, ~150 tokens, and is told to use
// those values. What the app does not know is passed as bytes.

import { PID_DEFINITIONS, type PidId } from '@/core/constants/pids';
import { maskToPids, mergeMonitorStatus, parseDtcs, parseFreezeFrameDtc, parseMonitorStatus, type MonitorId } from '@/core/utils/obdDiagnostics';
import type { EcuMessage } from '@/core/utils/obdFrames';
import { parsePidBytes } from '@/core/utils/obdParser';

interface Entry {
  readonly command: string;
  readonly noData: boolean;
  readonly raw: string[];
  readonly messages: EcuMessage[];
}

export interface ParsedCapture {
  readonly before: string; // the driver's own words ahead of the capture, if any
  readonly adapter: string | null;
  readonly protocol: string | null;
  readonly entries: readonly Entry[];
}

// Also the report's names for the monitors (domain/report).
export const MONITOR_LABEL: Readonly<Record<MonitorId, string>> = {
  misfire: 'fallos de encendido',
  fuel_system: 'sistema de combustible',
  components: 'componentes',
  catalyst: 'catalizador',
  heated_catalyst: 'catalizador calefaccionado',
  evap_system: 'evaporativo (EVAP)',
  secondary_air: 'aire secundario',
  ac_refrigerant: 'refrigerante del aire',
  oxygen_sensor: 'sonda de oxígeno',
  oxygen_sensor_heater: 'calefactor de sonda',
  nmhc_catalyst: 'catalizador NMHC',
  nox_aftertreatment: 'postratamiento NOx',
  boost_pressure: 'presión de sobrealimentación',
  exhaust_gas_sensor: 'sensor de gases de escape',
  particulate_filter: 'filtro de partículas',
  egr_vvt: 'EGR/VVT',
};

// The words the driver needs for a few PIDs whose English name says little.
const PID_ES: Readonly<Record<string, string>> = {
  '0131': 'distancia desde el último borrado de códigos',
  '0121': 'distancia recorrida con la luz de falla encendida',
  '014D': 'tiempo con la luz de falla encendida',
  '014E': 'tiempo desde el último borrado de códigos',
};

const PID_BY_NUMBER = new Map<number, PidId>(
  (Object.keys(PID_DEFINITIONS) as PidId[]).filter((id) => /^01[0-9A-F]{2}$/.test(PID_DEFINITIONS[id].command)).map((id) => [parseInt(PID_DEFINITIONS[id].command.slice(2), 16), id]),
);

export function parseCapture(text: string): ParsedCapture | null {
  const at = text.search(/Captura de diagnóstico/);
  if (at < 0 || !/^> \S+/m.test(text)) return null;
  const before = text
    .slice(0, at)
    .split('\n')
    .filter((l) => l.trim() && !/^OBDient2 ·/.test(l.trim()))
    .join('\n')
    .trim();
  const byCommand = new Map<string, Entry>();
  let adapter: string | null = null;
  let protocol: string | null = null;
  let cur: Entry | null = null;
  for (const line of text.slice(at).split('\n')) {
    const head = /^Adaptador:\s*(.+)$/.exec(line) ?? null;
    if (head) adapter = head[1]!.trim();
    const proto = /^Protocolo:\s*(.+)$/.exec(line);
    if (proto) protocol = proto[1]!.trim();
    const cmd = /^> (\S+)(?: \(([^)]*)\))?/.exec(line);
    if (cmd) {
      const command = cmd[1]!.toUpperCase();
      const entry: Entry = { command, noData: /sin dato|sin respuesta/.test(cmd[2] ?? ''), raw: [], messages: [] };
      const prev = byCommand.get(command);
      // ATH0 and ATH1 rounds ask the same: keep the one that knows the ECU.
      if (!prev || prev.messages.every((m) => m.ecu == null)) byCommand.set(command, entry);
      cur = entry;
      continue;
    }
    if (!cur || !/^\s{2}/.test(line)) continue;
    const msg = /^\s+= ([^:]+):\s*(.*)$/.exec(line);
    if (msg) {
      const ecu = msg[1]!.trim() === 'ECU ?' ? null : msg[1]!.trim();
      const bytes = (msg[2]!.replace('(INCOMPLETO)', '').match(/\b[0-9A-F]{2}\b|\*\*/gi) ?? []).map((b) => (b === '**' ? -1 : parseInt(b, 16)));
      cur.messages.push({ ecu, bytes, complete: !/INCOMPLETO/.test(msg[2]!) });
    } else if (line.trim()) {
      cur.raw.push(line.trim());
    }
  }
  return { before, adapter, protocol, entries: [...byCommand.values()] };
}

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
const pidList = (pids: number[]) => (pids.length ? pids.map(hex2).join(' ') : 'ninguno');

function describe(e: Entry): string | null {
  const c = e.command;
  if (/^AT(H[01]|AMC|CTM1)$/.test(c)) return null; // settings, not data
  if (c === 'ATI' || c === 'AT@1' || c === 'ATDP') return `${c}: ${e.raw[0] ?? 'sin respuesta'}`;
  if (e.noData || e.messages.length === 0) return `${c}: sin respuesta`;
  const msgs = e.messages.filter((m) => m.bytes.every((b) => b >= 0) || c === '0902');
  const first = msgs[0];
  try {
    if (c === '0101') {
      const s = mergeMonitorStatus(parseMonitorStatus(msgs));
      if (!s) return `${c}: respuesta no reconocida`;
      const incomplete = s.monitors.filter((m) => !m.complete).map((m) => MONITOR_LABEL[m.id] ?? m.id);
      return `0101 (estado de monitores): luz de falla ${s.milOn ? 'ENCENDIDA' : 'apagada'}, ${s.dtcCount} código(s) confirmados; monitores incompletos: ${incomplete.length ? incomplete.join(', ') : 'ninguno'}`;
    }
    if (c === '03' || c === '07' || c === '0A') {
      const label = { '03': 'códigos guardados', '07': 'códigos pendientes', '0A': 'códigos permanentes' }[c];
      const r = parseDtcs(msgs, parseInt(c, 16) as 0x03 | 0x07 | 0x0a, true);
      return `${c} (${label}): ${r.codes.length ? r.codes.map((d) => d.code).join(', ') : 'ninguno'}`;
    }
    if (c === '0900' && first) return `0900 (pedidos de modo 09 que soporta): ${pidList(maskToPids(first.bytes.slice(2), 0))}`;
    if (c === '0902') return '0902 (VIN): presente; se comparte con el serial tapado (la app conoce el VIN completo)';
    if (/^02[0-9A-F]{2}00$/.test(c) && first) {
      const pid = parseInt(c.slice(2, 4), 16);
      if (pid === 0) return `${c} (freeze frame, PIDs guardados): ${pidList(maskToPids(first.bytes.slice(3), 0))}`;
      if (pid === 2) {
        const dtc = parseFreezeFrameDtc(msgs);
        return `${c} (freeze frame, código que lo guardó): ${dtc ? dtc.code : 'ninguno guardado'}`;
      }
      const id = PID_BY_NUMBER.get(pid);
      if (id && id !== 'VOLTAGE') {
        const v = parsePidBytes(id as Exclude<PidId, 'VOLTAGE'>, first.bytes.slice(3).map(hex2));
        return `${c} (freeze frame, ${PID_ES[`01${hex2(pid)}`] ?? PID_DEFINITIONS[id].name}): ${v} ${PID_DEFINITIONS[id].unit}`;
      }
    }
    if (/^01[0-9A-F]{2}$/.test(c) && first) {
      const pid = parseInt(c.slice(2), 16);
      if (pid % 0x20 === 0) return `${c} (PIDs soportados ${hex2(pid + 1)}–${hex2(pid + 0x20)}): ${pidList(maskToPids(first.bytes.slice(2), pid))}`;
      const id = PID_BY_NUMBER.get(pid);
      if (id && id !== 'VOLTAGE') {
        const v = parsePidBytes(id as Exclude<PidId, 'VOLTAGE'>, first.bytes.slice(2).map(hex2));
        return `${c} (${PID_ES[c] ?? PID_DEFINITIONS[id].name}): ${v} ${PID_DEFINITIONS[id].unit}`;
      }
    }
  } catch {
    // A decoder that does not take these bytes: they go as they are.
  }
  return `${c}: ${msgs.map((m) => `${m.ecu ?? 'ECU ?'} ${m.bytes.map((b) => (b < 0 ? '**' : hex2(b))).join(' ')}`).join(' | ')} (sin decodificar)`;
}

// The text the model gets instead of a pasted capture, or null when the text is not one.
export function captureDigest(text: string): string | null {
  const cap = parseCapture(text);
  if (!cap || cap.entries.length === 0) return null;
  const ecus = [...new Set(cap.entries.flatMap((e) => e.messages.map((m) => m.ecu)).filter((x): x is string => x != null))];
  const lines = cap.entries.map(describe).filter((l): l is string => l != null);
  return [
    cap.before,
    '[Captura de diagnóstico decodificada por la app. Usá estos valores; no decodifiques los bytes a mano.]',
    `Adaptador: ${cap.adapter ?? '?'} · Protocolo: ${cap.protocol ?? '?'} · ECU que respondieron: ${ecus.length ? ecus.join(', ') : 'sin encabezados'}`,
    ...lines.map((l) => `- ${l}`),
  ]
    .filter(Boolean)
    .join('\n');
}
