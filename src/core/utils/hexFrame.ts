// Shared low-level hex-frame parsing for ELM327 mode-01 responses.
//
// PLAN-005 Fase 0: previously each caller re-tokenized and re-anchored raw
// adapter text on its own (supportedPids.ts had its own tokenizer; obdParser.ts
// blindly sliced off the first two tokens assuming they were the "41 <pid>"
// echo with no verification). That blind slice survives single-ECU 1-byte PIDs
// by luck but breaks the moment a second ECU answers on the same line or a PID
// spans more bytes than expected. This module is the single place that turns
// raw adapter text into a token stream and locates a mode-01 response header.

// Splits a raw adapter response into uppercase hex byte tokens, tolerating both
// space-separated ("41 0C 1A F8") and concatenated ("410C1AF8") responses, and
// stripping the prompt/CR/LF noise the ELM327 line may still carry.
export function tokenizeHexBytes(raw: string): string[] {
  const cleaned = raw.replace(/[\r\n>]/g, ' ').trim().toUpperCase();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  // Concatenated response (one long token) → re-split into 2-char bytes.
  const only = tokens[0];
  if (tokens.length === 1 && only !== undefined && only.length > 2 && only.length % 2 === 0) {
    return only.match(/.{2}/g) ?? [];
  }
  return tokens;
}

// Locates a mode-01 response header ("41 <pidHex>") anywhere in the token
// stream and returns the data bytes that immediately follow it. Anchoring on
// the header (rather than assuming position 0) means a stray echo fragment or
// a second ECU's frame ahead of the one we want doesn't corrupt the read.
//
// When the same PID is answered by multiple ECUs (functional broadcast), the
// FIRST matching frame wins — mode-01 live data doesn't have a defined merge
// rule the way the "PIDs supported" bitmask does (parseSupportedPidsMask ORs
// masks because "supported" is monotonic; a live value has no such property).
//
// Returns an empty array if the header never appears — callers already treat
// "missing byte" as a parse failure, so an empty array degrades the same way
// a short/garbled response always did.
export function extractPidPayload(pidHex: string, raw: string): string[] {
  return extractAfterHeader(raw, ['41', pidHex]);
}

// Mode 02 (freeze frame) answers with header "42 <pid> <frame>" — one byte more
// than mode 01, because the same PID can be stored for several frames. Frame 00
// is the one every vehicle stores and the only one most ever fill.
//
// Anchoring on all three bytes matters more here than in mode 01: asking for a
// PID the ECU has no frame for gets an answer for a DIFFERENT pid/frame on some
// adapters, and a two-byte anchor would happily read those bytes as ours.
export function extractFreezeFramePayload(
  pidHex: string,
  raw: string,
  frame = '00',
): string[] {
  return extractAfterHeader(raw, ['42', pidHex, frame]);
}

// Finds a header sequence anywhere in the token stream and returns what follows.
// Anchoring (rather than assuming position 0) means a stray echo fragment or a
// second ECU's frame ahead of the one we want doesn't corrupt the read.
function extractAfterHeader(raw: string, header: readonly string[]): string[] {
  const bytes = tokenizeHexBytes(raw);
  const target = header.map((h) => h.toUpperCase().padStart(2, '0'));

  for (let i = 0; i + target.length <= bytes.length; i++) {
    if (target.every((t, k) => bytes[i + k] === t)) {
      return bytes.slice(i + target.length);
    }
  }
  return [];
}
