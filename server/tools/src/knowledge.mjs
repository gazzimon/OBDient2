// The lab's shared knowledge base (decision 2026-10-20): what each car supports
// — which modules answer, at which addresses, which DIDs/PIDs — so every agent
// reuses it and the next car of the same make starts knowing where to look.
// Common to all users (lab), a JSON file on the K16.
//
//   report  { make, model, year?, protocol?, modules:[{id,reqHeader,rxHeader,label,partNumber?}], dids?, pids?, note?,
//             didObservations?:[{did,reqHeader,rxHeader,outcome,nrc?}] }
//   lookup  { make?, model?, year?, candidates? }  → merged facts for that vehicle
//
// DIDs to validate: `didCandidates` ({did, sample, src}) come only from a seed
// (scripts/seed-knowledge.mjs, data/ext: not versioned), never from a report —
// they are an inventory to try, not a fact about any car. `didObservations` are
// the facts: which module answered which DID and how (did_probe, no value),
// counted per outcome. A lookup with `candidates: true` gives the make's
// candidates with the modules that answered each one so far; without it, only
// how many there are (the model's window is small).
//
// Keyed by make/model/year ("ford/focus/2015"); a bare make merges everything
// of that make.
//
// It is read by every user, so it never holds what names one car: a VIN sent
// with a report is ignored, one that comes inside a part number or a note is
// masked to its first 11 characters (what the car is, not which one), and a file
// written before this rule is cleaned when the server starts (purge).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_MODULES = 300; // a group table (data/ext) has up to ~210
const MAX_IDS = 400;
const MAX_CLOSE = 3;
const MAX_SAME_MAKE = 24;
const MAX_CANDIDATES = 600;
const MAX_ANSWERED = 40;
const SAMPLES = new Set(['positive', 'mixed', 'weak', 'ambiguous', 'negative']);
const OUTCOMES = new Set(['supported', 'unsupported', 'locked', 'needs_conditions', 'service_refused', 'bad_request', 'other_refusal', 'pending', 'incomplete', 'mismatch']);
const HEX_DID = /^[0-9A-F]{4}$/;
const HEX_ID = /^([0-9A-F]{3}|[0-9A-F]{8})$/;
const up = (v) => (typeof v === 'string' ? v.trim().toUpperCase() : '');

// What a seed may say about a DID to try: anything else is dropped.
function cleanCandidates(list) {
  return (Array.isArray(list) ? list : [])
    .map((c) => ({ did: up(c?.did), sample: c?.sample, src: typeof c?.src === 'string' ? c.src.slice(0, 80) : 'semilla' }))
    .filter((c) => HEX_DID.test(c.did) && SAMPLES.has(c.sample));
}

// What a car showed, as reported: a DID, who answered and how — never a value.
function cleanObservations(list) {
  return (Array.isArray(list) ? list : [])
    .map((o) => ({ did: up(o?.did), reqHeader: up(o?.reqHeader), rxHeader: up(o?.rxHeader), outcome: o?.outcome, nrc: up(o?.nrc) }))
    .filter((o) => HEX_DID.test(o.did) && HEX_ID.test(o.reqHeader) && HEX_ID.test(o.rxHeader) && OUTCOMES.has(o.outcome))
    .map(({ nrc, ...o }) => (/^[0-9A-F]{2}$/.test(nrc) ? { ...o, nrc } : o));
}

// Adds a report's observations to the stored ones: one entry per module and DID,
// with how many times each outcome was seen.
function mergeObservations(prev, added) {
  const byKey = new Map((prev ?? []).map((o) => [`${o.reqHeader}:${o.did}`, { ...o, outcomes: { ...o.outcomes } }]));
  for (const o of added) {
    const key = `${o.reqHeader}:${o.did}`;
    const cur = byKey.get(key) ?? { did: o.did, reqHeader: o.reqHeader, rxHeader: o.rxHeader, outcomes: {} };
    cur.outcomes[o.outcome] = (cur.outcomes[o.outcome] ?? 0) + 1;
    if (o.nrc) cur.lastNrc = o.nrc;
    byKey.set(key, cur);
  }
  return [...byKey.values()].slice(0, MAX_IDS);
}
const slug = (s) => String(s ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function vehicleKey({ make, model, year }) {
  return [slug(make), slug(model), String(year ?? '').match(/^(19|20)\d\d$/) ? String(year) : ''].filter(Boolean).join('/');
}

// A VIN (17 characters, with a digit and a letter, no I/O/Q) inside any text.
const VIN_IN_TEXT = /(?<![A-Z0-9])(?=[A-HJ-NPR-Z0-9]*\d)(?=[A-HJ-NPR-Z0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}(?![A-Z0-9])/gi;
export const maskVins = (text) => (typeof text === 'string' ? text.replace(VIN_IN_TEXT, (v) => `${v.slice(0, 11)}••••••`) : text);

// A vehicle record with nothing that names one car. Returns it, and whether it changed.
function scrubVehicle(v) {
  const before = JSON.stringify(v);
  const { vins: _vins, ...rest } = v;
  const clean = {
    ...rest,
    modules: (rest.modules ?? []).map((m) => (m.partNumber != null ? { ...m, partNumber: maskVins(m.partNumber) } : m)),
    notes: (rest.notes ?? []).map((n) => ({ ...n, note: maskVins(n.note) })),
  };
  return [clean, JSON.stringify(clean) !== before];
}

export function knowledgeStore(file) {
  const readRaw = () => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return { vehicles: {} };
    }
  };
  // Whatever is on disk, what the rest of the code sees has no VIN in it.
  const read = () => {
    const db = readRaw();
    for (const k of Object.keys(db.vehicles ?? {})) db.vehicles[k] = scrubVehicle(db.vehicles[k])[0];
    return db;
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
    // Rewrites the file without the VINs an earlier version stored. Run at start.
    purge() {
      const db = readRaw();
      let changed = 0;
      for (const k of Object.keys(db.vehicles ?? {})) {
        const [clean, did] = scrubVehicle(db.vehicles[k]);
        db.vehicles[k] = clean;
        if (did) changed += 1;
      }
      if (changed) write(db);
      return changed;
    },

    // Merge a discovery into the facts for its vehicle (and never lose old ones).
    // `seed`: the caller is the seed script, the only one that may add candidates.
    report(rec, { seed = false } = {}) {
      const key = vehicleKey(rec);
      if (!key) throw new Error('bad_vehicle');
      const db = read();
      const prev = db.vehicles[key] ?? { modules: [], dids: [], pids: [] };
      const next = {
        make: slug(rec.make),
        model: slug(rec.model) || prev.model || '',
        years: [...new Set([...(prev.years ?? []), ...(rec.year ? [String(rec.year)] : [])])],
        protocol: rec.protocol ?? prev.protocol ?? null,
        modules: uniqBy([...(prev.modules ?? []), ...(rec.modules ?? []).map((m) => (m?.partNumber != null ? { ...m, partNumber: maskVins(m.partNumber) } : m))], (m) => m.id, MAX_MODULES),
        dids: [...new Set([...(prev.dids ?? []), ...(rec.dids ?? [])])].slice(0, MAX_IDS),
        pids: [...new Set([...(prev.pids ?? []), ...(rec.pids ?? [])])].slice(0, MAX_IDS),
        didCandidates: uniqBy([...(prev.didCandidates ?? []), ...(seed ? cleanCandidates(rec.didCandidates) : [])], (c) => `${c.did}:${c.src}`, MAX_CANDIDATES),
        didObservations: mergeObservations(prev.didObservations, cleanObservations(rec.didObservations)),
        notes: [...(prev.notes ?? []), ...(rec.note ? [{ at: new Date().toISOString(), note: maskVins(String(rec.note).slice(0, 300)) }] : [])].slice(-20),
        updated: new Date().toISOString(),
      };
      db.vehicles[key] = next;
      write(db);
      return { key, modules: next.modules.length };
    },

    // Everything known for a vehicle: its exact key, close models, plus the
    // rest of the make condensed (each address once, with how many models use it).
    lookup(q) {
      const db = read();
      const key = vehicleKey(q);
      const makeSlug = slug(q.make);
      const modelSlug = slug(q.model);
      const exact = key ? db.vehicles[key] : null;
      const ofMake = Object.entries(db.vehicles).filter(([k, v]) => makeSlug && v.make === makeSlug && k !== key);
      // opendbc names platforms ("escape-mk4"); a VIN decodes to "escape".
      const close = exact || !modelSlug
        ? []
        : ofMake
            .filter(([, v]) => v.model && (v.model.startsWith(modelSlug) || modelSlug.startsWith(v.model)))
            .slice(0, MAX_CLOSE)
            .map(([k, v]) => ({ key: k, modules: v.modules, protocol: v.protocol }));
      const closeKeys = new Set(close.map((c) => c.key));
      const byId = new Map();
      for (const [k, v] of ofMake) {
        if (closeKeys.has(k)) continue;
        for (const m of v.modules ?? []) {
          const prev = byId.get(m.id);
          byId.set(m.id, prev ? { ...prev, seenIn: prev.seenIn + 1 } : { id: m.id, reqHeader: m.reqHeader, rxHeader: m.rxHeader, ...(m.rxAlt ? { rxAlt: m.rxAlt } : {}), ...(m.sub ? { sub: m.sub } : {}), label: m.label, seenIn: 1 });
        }
      }
      const sameMake = [...byId.values()].sort((a, b) => b.seenIn - a.seenIn).slice(0, MAX_SAME_MAKE);

      // DIDs: the make's candidates (from every record of it) and what cars answered.
      const records = [...(exact ? [exact] : []), ...ofMake.map(([, v]) => v)];
      const observed = records.flatMap((v) => v.didObservations ?? []);
      const answeredBy = new Map();
      for (const o of observed) {
        if (!o.outcomes?.supported) continue;
        answeredBy.set(o.did, [...new Set([...(answeredBy.get(o.did) ?? []), o.reqHeader])]);
      }
      const candidates = uniqBy(records.flatMap((v) => v.didCandidates ?? []), (c) => `${c.did}:${c.src}`, MAX_CANDIDATES);
      const dids = q.candidates
        ? { didCandidates: candidates.map((c) => ({ ...c, toValidate: true, ...(answeredBy.has(c.did) ? { answeredBy: answeredBy.get(c.did) } : {}) })) }
        : {
            ...(candidates.length ? { didCandidateCount: candidates.length } : {}),
            ...(answeredBy.size
              ? { didsAnswered: [...answeredBy.entries()].slice(0, MAX_ANSWERED).map(([did, modules]) => ({ did, modules, ...(candidates.some((c) => c.did === did) ? { toValidate: true } : {}) })) }
              : {}),
          };
      // The raw lists stay in the file: the model gets the condensed view above.
      const lean = (v) => {
        const { didCandidates: _c, didObservations: _o, ...rest } = v;
        return rest;
      };
      return { exact: exact ? { key, ...lean(exact) } : null, close, sameMake, ...dids };
    },
  };
}
