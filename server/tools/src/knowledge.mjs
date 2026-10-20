// The lab's shared knowledge base (decision 2026-10-20): what each car supports
// — which modules answer, at which addresses, which DIDs/PIDs — so every agent
// reuses it and the next car of the same make starts knowing where to look.
// Common to all users (lab), a JSON file on the K16.
//
//   report  { make, model, year?, vin?, protocol?, modules:[{id,reqHeader,rxHeader,label,partNumber?,vin?}], dids?, pids?, note? }
//   lookup  { make?, model?, year?, vin? }  → merged facts for that vehicle
//
// Keyed by make/model/year ("ford/focus/2015"); a bare make merges everything
// of that make. VIN, when present, pins the exact unit.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_MODULES = 64;
const MAX_IDS = 400;
const slug = (s) => String(s ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function vehicleKey({ make, model, year }) {
  return [slug(make), slug(model), String(year ?? '').match(/^(19|20)\d\d$/) ? String(year) : ''].filter(Boolean).join('/');
}

export function knowledgeStore(file) {
  const read = () => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return { vehicles: {} };
    }
  };
  const write = (db) => {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(db));
    renameSync(tmp, file);
  };

  const uniqBy = (arr, keyOf, cap) => {
    const seen = new Map();
    for (const x of arr) if (x && keyOf(x)) seen.set(keyOf(x), { ...seen.get(keyOf(x)), ...x });
    return [...seen.values()].slice(0, cap);
  };

  return {
    // Merge a discovery into the facts for its vehicle (and never lose old ones).
    report(rec) {
      const key = vehicleKey(rec);
      if (!key) throw new Error('bad_vehicle');
      const db = read();
      const prev = db.vehicles[key] ?? { modules: [], dids: [], pids: [] };
      const next = {
        make: slug(rec.make),
        model: slug(rec.model) || prev.model || '',
        years: [...new Set([...(prev.years ?? []), ...(rec.year ? [String(rec.year)] : [])])],
        vins: [...new Set([...(prev.vins ?? []), ...(rec.vin ? [rec.vin] : [])])].slice(0, 20),
        protocol: rec.protocol ?? prev.protocol ?? null,
        modules: uniqBy([...(prev.modules ?? []), ...(rec.modules ?? [])], (m) => m.id, MAX_MODULES),
        dids: [...new Set([...(prev.dids ?? []), ...(rec.dids ?? [])])].slice(0, MAX_IDS),
        pids: [...new Set([...(prev.pids ?? []), ...(rec.pids ?? [])])].slice(0, MAX_IDS),
        notes: [...(prev.notes ?? []), ...(rec.note ? [{ at: new Date().toISOString(), note: String(rec.note).slice(0, 300) }] : [])].slice(-20),
        updated: new Date().toISOString(),
      };
      db.vehicles[key] = next;
      write(db);
      return { key, modules: next.modules.length };
    },

    // Everything known for a vehicle: its exact key, plus the rest of the make.
    lookup(q) {
      const db = read();
      const key = vehicleKey(q);
      const makeSlug = slug(q.make);
      const exact = key ? db.vehicles[key] : null;
      const sameMake = Object.entries(db.vehicles)
        .filter(([k, v]) => makeSlug && v.make === makeSlug && k !== key)
        .map(([k, v]) => ({ key: k, modules: v.modules, protocol: v.protocol }));
      const byVin = q.vin ? Object.entries(db.vehicles).find(([, v]) => (v.vins ?? []).includes(q.vin)) : null;
      return { exact: exact ? { key, ...exact } : null, byVin: byVin ? { key: byVin[0], ...byVin[1] } : null, sameMake };
    },
  };
}
