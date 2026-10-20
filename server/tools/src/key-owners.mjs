// Read side of server/auth/src/key-owners.mjs: the email behind an account
// key (SHA-256 → email), for the driver of each tracked position. Re-read when
// the file changes (a new login).

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

export function keyOwnerLookup(file) {
  let mtime = -1;
  let map = {};
  return (key) => {
    try {
      const m = statSync(file).mtimeMs;
      if (m !== mtime) {
        map = JSON.parse(readFileSync(file, 'utf8'));
        mtime = m;
      }
    } catch {
      return null;
    }
    return map[createHash('sha256').update(key).digest('hex')] ?? null;
  };
}
