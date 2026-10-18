// Adapter response → complete messages, one per ECU answer (M2.1).
//
// What the adapter prints depends on the bus and on two settings (ELM327
// datasheet, "Multiline Responses"; ISO 15765-2 for the CAN frames):
//
//   CAN, headers off (ATH0, CAF1): a single frame is just its data; a longer
//     answer is a length line and numbered segments:
//         014
//         0: 49 02 01 31 44 34
//         1: 47 50 30 30 52 35 35
//   CAN, headers on (ATH1): every frame with its CAN ID and PCI byte:
//         7E8 10 14 49 02 01 31 44 34      first frame, 0x014 bytes
//         7E8 21 47 50 30 30 52 35 35      consecutive frame 1
//   J1850 / ISO 9141 / KWP: one message per line; with headers, three header
//     bytes (priority, target, source) before the data and a checksum after.
//
// Works with spaces on or off (ATS1/ATS0) and needs the response one line per
// frame, as TransportCommandPort delivers it. With headers off and two ECUs
// answering at once their segments can interleave; each segment goes to the
// oldest open message waiting for that segment number, which rebuilds the
// datasheet's mixed-up example correctly, but only headers make it certain.
//
// Not handled yet: STCSEGR 1 (the STN strips the PCI bytes itself).

export interface FrameFormat {
  // ATH1: lines carry the CAN ID or the legacy header.
  readonly headers: boolean;
  readonly can: boolean;
}

export interface EcuMessage {
  // CAN ID ("7E8", "18DAF110") or legacy source address ("10"); null when
  // headers are off and the sender is unknown.
  readonly ecu: string | null;
  readonly bytes: readonly number[];
  // False when frames were missing: the bytes are what arrived, in order.
  readonly complete: boolean;
}

interface Building {
  ecu: string | null;
  bytes: number[];
  length: number;
  next: number; // next segment / sequence number, 0–F
  complete: boolean;
  broken: boolean;
}

export function readMessages(response: string, format: FrameFormat): EcuMessage[] {
  const built: Building[] = [];
  for (const raw of response.split('\n')) {
    const line = raw.replace(/\s/g, '').toUpperCase();
    if (line === '') continue;
    if (format.can && format.headers) canFrame(line, built);
    else if (format.can) canSegment(line, built);
    else legacyLine(line, format.headers, built);
  }
  return built.map(({ ecu, bytes, length, complete, broken }) => ({
    ecu,
    bytes: complete ? bytes.slice(0, length) : bytes,
    complete: complete && !broken,
  }));
}

// CAN with headers: route each frame by its ID, assemble by PCI.
function canFrame(line: string, built: Building[]): void {
  if (!/^[0-9A-F]+$/.test(line) || line.length < 5) return;
  // 11-bit IDs print as 3 hex digits, 29-bit as 8; data comes in whole bytes.
  const idLength = line.length % 2 === 1 ? 3 : 8;
  const ecu = line.slice(0, idLength);
  const frame = bytesOf(line.slice(idLength));
  if (!frame || frame.length === 0) return;
  const pci = frame[0]!;
  switch (pci >> 4) {
    case 0: {
      const length = pci & 0x0f;
      const data = frame.slice(1, 1 + length);
      built.push({ ecu, bytes: data, length, next: 0, complete: data.length === length, broken: false });
      return;
    }
    case 1: {
      const length = ((pci & 0x0f) << 8) | (frame[1] ?? 0);
      const data = frame.slice(2);
      built.push({ ecu, bytes: data, length, next: 1, complete: data.length >= length, broken: false });
      return;
    }
    case 2: {
      const open = built.find((m) => m.ecu === ecu && !m.complete && !m.broken);
      if (!open) return;
      if ((pci & 0x0f) !== open.next) {
        open.broken = true; // a frame was lost: what follows would be misplaced
        return;
      }
      append(open, frame.slice(1));
      return;
    }
    default:
      return; // 3 = flow control, our own side of the conversation
  }
}

// CAN without headers: "014" opens a message, "n:" lines fill it, anything
// else in hex is a single-frame answer.
function canSegment(line: string, built: Building[]): void {
  if (/^[0-9A-F]{3}$/.test(line)) {
    built.push({ ecu: null, bytes: [], length: parseInt(line, 16), next: 0, complete: false, broken: false });
    return;
  }
  const seg = /^([0-9A-F]):([0-9A-F]*)$/.exec(line);
  if (seg) {
    const n = parseInt(seg[1]!, 16);
    const data = bytesOf(seg[2]!);
    const open = built.find((m) => !m.complete && !m.broken && m.next === n);
    if (open && data) append(open, data);
    return;
  }
  const data = bytesOf(line);
  if (data) built.push({ ecu: null, bytes: data, length: data.length, next: 0, complete: true, broken: false });
}

// J1850, ISO 9141, KWP: one message per line.
function legacyLine(line: string, headers: boolean, built: Building[]): void {
  const data = bytesOf(line);
  if (!data) return;
  if (!headers) {
    built.push({ ecu: null, bytes: data, length: data.length, next: 0, complete: true, broken: false });
    return;
  }
  if (data.length < 5) return;
  const body = data.slice(3, -1); // drop priority/target/source and the checksum
  built.push({ ecu: hex(data[2]!), bytes: body, length: body.length, next: 0, complete: true, broken: false });
}

function append(m: Building, data: number[]): void {
  m.bytes.push(...data);
  m.next = (m.next + 1) & 0x0f;
  if (m.bytes.length >= m.length) m.complete = true;
}

function bytesOf(hexText: string): number[] | null {
  if (hexText.length % 2 !== 0 || !/^[0-9A-F]*$/.test(hexText)) return null;
  const out: number[] = [];
  for (let i = 0; i < hexText.length; i += 2) out.push(parseInt(hexText.slice(i, i + 2), 16));
  return out;
}

function hex(b: number): string {
  return b.toString(16).toUpperCase().padStart(2, '0');
}

export interface NegativeAnswer {
  readonly ecu: string | null;
  // Negative response code (ISO 14229-1 annex A.1): 0x22 conditions not
  // correct, 0x31 request out of range, 0x11/0x12 not supported…
  readonly code: number;
}

export interface ServiceAnswers {
  readonly positive: readonly EcuMessage[];
  readonly negative: readonly NegativeAnswer[];
}

// Splits the messages that answer one service (mode 03 → 43, 09 → 49, …) into
// positive answers and refusals (7F <service> <code>). Anything else on the
// line — another ECU's unrelated traffic — is left out. "Response pending"
// (code 0x78) never gets here: the command port waits through it.
export function answersTo(messages: readonly EcuMessage[], service: number): ServiceAnswers {
  const positive: EcuMessage[] = [];
  const negative: NegativeAnswer[] = [];
  for (const m of messages) {
    if (m.bytes[0] === service + 0x40) positive.push(m);
    else if (m.bytes[0] === 0x7f && m.bytes[1] === service && m.bytes.length >= 3) {
      negative.push({ ecu: m.ecu, code: m.bytes[2]! });
    }
  }
  return { positive, negative };
}
