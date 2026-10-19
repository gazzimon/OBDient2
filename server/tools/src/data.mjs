// Where the jobs leave their data and the server reads it:
// ~/.local/share/obdient/tools/{fuel,dollar,cars}.json. Writes are atomic
// (temp file + rename), reads are cached until the file changes.

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DATA_DIR = process.env.TOOLS_DATA ?? join(homedir(), '.local/share/obdient/tools');

export function writeData(name, value) {
  mkdirSync(DATA_DIR, { recursive: true });
  const file = join(DATA_DIR, `${name}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(value));
  renameSync(`${file}.tmp`, file);
}

const cache = new Map(); // name → { mtime, value }

export function readData(name, dir = DATA_DIR) {
  const file = join(dir, `${name}.json`);
  let mtime;
  try {
    mtime = statSync(file).mtimeMs;
  } catch {
    return null;
  }
  const hit = cache.get(file);
  if (hit && hit.mtime === mtime) return hit.value;
  const value = JSON.parse(readFileSync(file, 'utf8'));
  cache.set(file, { mtime, value });
  return value;
}
