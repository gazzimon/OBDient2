// Reassembles ELM327/STN responses from an arbitrary stream of text chunks.
//
// Bluetooth Classic let the native layer cut frames at the '>' prompt. BLE
// notifications are limited by the ATT MTU (20 bytes by default), so one
// response often arrives in several chunks. Framing therefore moves here.

const PROMPT = '>';

export class PromptFramer {
  private buffer = '';

  // Feeds a chunk and returns every response completed by it (prompt stripped).
  // Usually 0 or 1 items. Lines stay apart ('\n'): each one is a frame, an ECU
  // or a segment, and with spaces off (ATS0) that is the only boundary left.
  feed(chunk: string): string[] {
    // The ELM327 may slip NUL bytes into its output (datasheet, EUSART erratum).
    this.buffer += chunk.replace(/\0/g, '');
    const out: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf(PROMPT)) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      out.push(normalize(raw));
    }
    return out;
  }

  // Text received since the last prompt, for timeout diagnostics.
  pending(): string {
    return this.buffer;
  }

  reset(): void {
    this.buffer = '';
  }
}

// One line per adapter line, inner whitespace collapsed, blank lines dropped.
export function normalize(raw: string): string {
  return raw
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}
