// Who owns each account key, for the lab's tracking (driver = email, decision
// 2026-10-20). Written here at login, read by obdient-tools: SHA-256 of the
// key → email. The key itself is never stored. File mode 600.

import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const keyHash = (key) => createHash('sha256').update(key).digest('hex');

export function keyOwners(file) {
  const read = () => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return {};
    }
  };
  const write = (map) => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(map), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  };
  return {
    remember(key, email) {
      const map = read();
      const h = keyHash(key);
      if (map[h] === email) return;
      // One entry per email: a new key replaces the old one.
      for (const [k, v] of Object.entries(map)) if (v === email) delete map[k];
      map[h] = email;
      write(map);
    },
    forget(email) {
      const map = read();
      const before = Object.keys(map).length;
      for (const [k, v] of Object.entries(map)) if (v === email) delete map[k];
      if (Object.keys(map).length !== before) write(map);
    },
  };
}
