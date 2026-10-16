// Tests for hexFrame.ts — shared mode-01 response tokenizing/header-anchoring
// (PLAN-005 Fase 0). Pure functions, no mocks needed.

import { tokenizeHexBytes, extractPidPayload } from '@/core/utils/hexFrame';

describe('tokenizeHexBytes', () => {
  it('splits a space-separated response into uppercase byte tokens', () => {
    expect(tokenizeHexBytes('41 0c 1a f8')).toEqual(['41', '0C', '1A', 'F8']);
  });

  it('re-splits a concatenated response into 2-char bytes', () => {
    expect(tokenizeHexBytes('410C1AF8')).toEqual(['41', '0C', '1A', 'F8']);
  });

  it('strips prompt and CR/LF noise', () => {
    expect(tokenizeHexBytes('41 0C 1A F8\r\n>')).toEqual(['41', '0C', '1A', 'F8']);
  });

  it('returns an empty array for empty input', () => {
    expect(tokenizeHexBytes('')).toEqual([]);
  });

  it('leaves non-hex text whole instead of cutting it into fake bytes', () => {
    expect(tokenizeHexBytes('NODATA')).toEqual(['NODATA']);
    expect(tokenizeHexBytes('?')).toEqual(['?']);
  });

  it('re-splits every run when spaces are off and two ECUs answer (ATS0)', () => {
    expect(tokenizeHexBytes('410D32\r410D33')).toEqual(['41', '0D', '32', '41', '0D', '33']);
    expect(extractPidPayload('0D', '410D32\r410D33')).toEqual(['32', '41', '0D', '33']);
  });
});

describe('extractPidPayload', () => {
  it('extracts data bytes following the "41 <pid>" header at position 0', () => {
    expect(extractPidPayload('0C', '41 0C 1A F8')).toEqual(['1A', 'F8']);
  });

  it('anchors on the header even with a leading stray fragment', () => {
    // e.g. an unstripped echo fragment or adapter noise ahead of the real frame.
    expect(extractPidPayload('0D', 'JUNK 41 0D 3C')).toEqual(['3C']);
  });

  it('takes the first matching frame when multiple ECUs answer the same PID', () => {
    // Two ECUs both answer RPM on one line (headers off) — first frame wins,
    // since live-data values have no defined merge rule (unlike the supported-
    // PIDs bitmask, which ORs because "supported" is monotonic).
    const raw = '41 0C 1A F8 41 0C 00 00';
    expect(extractPidPayload('0C', raw)).toEqual(['1A', 'F8', '41', '0C', '00', '00']);
  });

  it('handles a concatenated response', () => {
    expect(extractPidPayload('0C', '410C1AF8')).toEqual(['1A', 'F8']);
  });

  it('is case-insensitive on the pid hex argument', () => {
    expect(extractPidPayload('0c', '41 0C 1A F8')).toEqual(['1A', 'F8']);
  });

  it('returns an empty array when the header is not present', () => {
    expect(extractPidPayload('0C', 'NO DATA')).toEqual([]);
    expect(extractPidPayload('0C', '')).toEqual([]);
  });

  it('does not match a different pid on the same base header', () => {
    expect(extractPidPayload('0D', '41 0C 1A F8')).toEqual([]);
  });
});
