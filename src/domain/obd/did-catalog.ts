// What a DID is, and how much we know about it. Three things are kept apart:
// that a module answers a DID (a 62 proves only that), that we understand the
// answer (a decoder from a source we may use), and that the decoder was checked
// on a car. Each entry says how far it got (`evidence`):
//
//   standard   the assignment comes from a standard (ISO 14229-1); the format may
//              still be the manufacturer's
//   candidate  a DID worth asking, from an inventory; no meaning, no decoder
//   decoded    a decoder from a source with a license we may use, not yet tried
//   validated  the decoder matched the car (e.g. the odometer against the dashboard)
//
// Only the standard identification DIDs live here. Candidates come from the
// lab knowledge (server/tools, data/ext: not versioned) and stay "to validate";
// manufacturer measurements are not added without a source, a license, a
// decoder definition and a check on a car.

export type DidEvidence = 'standard' | 'candidate' | 'decoded' | 'validated';

export type DidCatalogSource = 'ISO 14229-1';

export interface DidCatalogEntry {
  readonly did: string;
  readonly name: string;
  readonly description: string;
  readonly appliesTo: 'uds_ecu';
  readonly privacy: 'public' | 'vehicle_identifier' | 'serial_identifier';
  readonly source: DidCatalogSource;
  readonly sourceLicense: 'not_reproduced';
  readonly evidence: DidEvidence;
  readonly decoder: 'ascii' | 'vin' | 'session_type' | 'vendor_defined';
}

export const UDS_IDENTIFICATION_CATALOG: readonly DidCatalogEntry[] = [
  {
    did: 'F186',
    name: 'Diagnostic session',
    description: 'Current diagnostic session; meaning depends on the ECU session state.',
    appliesTo: 'uds_ecu',
    privacy: 'public',
    source: 'ISO 14229-1',
    sourceLicense: 'not_reproduced',
    evidence: 'standard',
    decoder: 'session_type',
  },
  {
    did: 'F187',
    name: 'Spare part number',
    description: 'ECU manufacturer spare-part identifier; exact encoding is manufacturer-defined.',
    appliesTo: 'uds_ecu',
    privacy: 'public',
    source: 'ISO 14229-1',
    sourceLicense: 'not_reproduced',
    evidence: 'standard',
    decoder: 'vendor_defined',
  },
  {
    did: 'F189',
    name: 'ECU software version',
    description: 'ECU software-version identifier; exact encoding is manufacturer-defined.',
    appliesTo: 'uds_ecu',
    privacy: 'public',
    source: 'ISO 14229-1',
    sourceLicense: 'not_reproduced',
    evidence: 'standard',
    decoder: 'vendor_defined',
  },
  {
    did: 'F18C',
    name: 'ECU serial number',
    description: 'Unique ECU serial; do not share as a public vehicle fact.',
    appliesTo: 'uds_ecu',
    privacy: 'serial_identifier',
    source: 'ISO 14229-1',
    sourceLicense: 'not_reproduced',
    evidence: 'standard',
    decoder: 'vendor_defined',
  },
  {
    did: 'F190',
    name: 'Vehicle identification number',
    description: 'Vehicle VIN; its value must remain private and must not enter shared scan output.',
    appliesTo: 'uds_ecu',
    privacy: 'vehicle_identifier',
    source: 'ISO 14229-1',
    sourceLicense: 'not_reproduced',
    evidence: 'standard',
    decoder: 'vin',
  },
];

export function didCatalogEntry(did: string): DidCatalogEntry | null {
  const normalized = did.replace(/\s+/g, '').toUpperCase();
  return UDS_IDENTIFICATION_CATALOG.find((entry) => entry.did === normalized) ?? null;
}

// ── Candidates (from the lab knowledge) ─────────────────────────────────────

// What the inventory's sample showed for the DID — not what a real module does:
//   positive   the sample has a 62 answer      negative   only a 7F 22 refusal
//   mixed      both, in different records      ambiguous  neither recognisable
//   weak       listed near signal names, no request seen (low confidence)
export type CandidateSample = 'positive' | 'mixed' | 'weak' | 'ambiguous' | 'negative';

export interface DidCandidate {
  readonly did: string;
  readonly sample: CandidateSample;
  // The lab's label for the inventory it came from.
  readonly source: string;
}

// Most promising first: a DID the sample saw answered is likelier to answer here.
const SAMPLE_ORDER: readonly CandidateSample[] = ['positive', 'mixed', 'weak', 'ambiguous', 'negative'];

// The DIDs to ask, in order, from `from` on (the cursor of a cut run): each DID
// once, the standard identification ones left out (mode "control" reads them).
export function candidatePlan(
  candidates: readonly DidCandidate[],
  from: string | null = null,
): { readonly dids: readonly string[]; readonly byDid: ReadonlyMap<string, DidCandidate> } | { readonly error: string } {
  const byDid = new Map<string, DidCandidate>();
  for (const c of [...candidates].sort((a, b) => SAMPLE_ORDER.indexOf(a.sample) - SAMPLE_ORDER.indexOf(b.sample))) {
    const did = c.did.toUpperCase();
    if (!/^[0-9A-F]{4}$/.test(did) || byDid.has(did) || didCatalogEntry(did)) continue;
    byDid.set(did, { ...c, did });
  }
  const all = [...byDid.keys()];
  if (all.length === 0) return { error: 'El laboratorio no tiene DIDs candidatos para esta marca.' };
  if (from == null) return { dids: all, byDid };
  const at = all.indexOf(from.toUpperCase());
  if (at < 0) return { error: `${from} no está entre los candidatos: seguí con el cursor que devolvió el sondeo anterior.` };
  return { dids: all.slice(at), byDid };
}
