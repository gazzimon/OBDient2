// ASCII-only base64 for BLE payloads. React Native has no Buffer and ble-plx
// moves bytes as base64 strings; AT commands and hex responses are plain ASCII.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function asciiToBase64(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 3) {
    const b0 = text.charCodeAt(i) & 0xff;
    const hasB1 = i + 1 < text.length;
    const hasB2 = i + 2 < text.length;
    const b1 = hasB1 ? text.charCodeAt(i + 1) & 0xff : 0;
    const b2 = hasB2 ? text.charCodeAt(i + 2) & 0xff : 0;
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += hasB1 ? ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += hasB2 ? ALPHABET[b2 & 0x3f] : '=';
  }
  return out;
}

export function base64ToAscii(encoded: string): string {
  const clean = encoded.replace(/=+$/, '');
  let out = '';
  let bits = 0;
  let acc = 0;
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >> bits) & 0xff);
    }
  }
  return out;
}
