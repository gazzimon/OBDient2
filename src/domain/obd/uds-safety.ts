// Read-only safety boundary for the lab's free command tool and the module
// scan (ADR-0009; decision 2026-10-20). The agent may send ANY read command;
// the phone physically blocks anything that writes, erases, flashes, resets or
// unlocks a module — so a lab exploration cannot brick a car.
//
// Three kinds of command reach the adapter:
//   - AT…  adapter config (ELM): harmless to the car. Allowed, except the few
//          that permanently reprogram the adapter or change its baud rate.
//   - ST…  STN config: same rule.
//   - hex  a frame to the car. The first byte is the service. Only read
//          services pass (an allowlist — safer than listing every dangerous one).

export type CommandVerdict = { readonly ok: true; readonly kind: 'at' | 'st' | 'obd' | 'uds' } | { readonly ok: false; readonly reason: string };

// OBD-II modes that only read (01-0A). 04 clears emission DTCs → blocked.
// 08 controls on-board components (actuator) → blocked.
const OBD_READ_MODES = new Set([0x01, 0x02, 0x03, 0x05, 0x06, 0x07, 0x09, 0x0a]);

// UDS services that only read (ISO 14229). Everything else in a frame is blocked.
const UDS_READ_SERVICES = new Set([
  0x19, // ReadDTCInformation
  0x22, // ReadDataByIdentifier
  0x23, // ReadMemoryByAddress
  0x24, // ReadScalingDataByIdentifier
  0x2a, // ReadDataByPeriodicIdentifier
  0x3e, // TesterPresent
]);

// AT/ST that must never run: they rewrite the adapter for good or drop the link.
const BLOCKED_ADAPTER = [
  /^ATPP[0-9A-F]{2}(SV|ON)/, // program a parameter permanently
  /^AT(BRD|BI)/, // change UART baud / bypass init
  /^ST(S?BR|WBR|PBR)/, // STN baud rate
  /^STPPS/, // STN program parameters save
];

function normalize(command: string): string {
  return command.toUpperCase().replace(/\s+/g, '');
}

// Session control (10): only the default/diagnostic session (01), never the
// programming (02) or extended (03) sessions that unlock writes.
function sessionAllowed(bytes: number[]): boolean {
  return bytes[1] === 0x01;
}

export function classifyCommand(command: string): CommandVerdict {
  const c = normalize(command);
  if (!c) return { ok: false, reason: 'comando vacío' };

  if (c.startsWith('AT') || c.startsWith('ST')) {
    if (BLOCKED_ADAPTER.some((re) => re.test(c))) return { ok: false, reason: 'ese comando reprograma el adaptador o cambia su velocidad' };
    return { ok: true, kind: c.startsWith('AT') ? 'at' : 'st' };
  }

  // A data frame: must be whole hex bytes.
  if (!/^[0-9A-F]+$/.test(c) || c.length % 2 !== 0) return { ok: false, reason: 'no es un comando AT/ST ni una trama hexadecimal válida' };
  const bytes: number[] = [];
  for (let i = 0; i < c.length; i += 2) bytes.push(parseInt(c.slice(i, i + 2), 16));
  const service = bytes[0]!;

  if (OBD_READ_MODES.has(service)) return { ok: true, kind: 'obd' };
  if (service === 0x10) return sessionAllowed(bytes) ? { ok: true, kind: 'uds' } : { ok: false, reason: 'solo la sesión por defecto (10 01); las sesiones de programación habilitan escritura' };
  if (UDS_READ_SERVICES.has(service)) return { ok: true, kind: 'uds' };

  const svc = service.toString(16).padStart(2, '0').toUpperCase();
  return { ok: false, reason: `el servicio ${svc} no es de solo lectura (escribe, borra, flashea, reinicia o desbloquea un módulo)` };
}
