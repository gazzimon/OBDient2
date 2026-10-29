#!/usr/bin/env python3
"""Builds a data/ext/*.json seed of DID candidates to validate, for the lab
knowledge base, from a DID inventory written in Markdown. The inventory and its
output stay out of git (data/ext/ is ignored): the source's label and terms are
given here, at run time, and travel only inside the output.

  python3 -I scripts/did-inventory-extract.py <inventory.md> --make ford \\
      --source "<label>" --license "<terms>" > data/ext/ford-did-candidates.json
  node scripts/seed-knowledge.mjs

What the inventory has to look like:
  ### <class> — <N>      followed by a ``` block of 4-hex-digit DIDs; the class
                         from the heading: "positiva y negativa" → mixed,
                         "positiva" → positive, "negativa" → negative,
                         "sin positivo" → ambiguous. N must match the block.
  ## Candidatos ...      a table whose first column lists `HHHH` DIDs → weak
                         (low confidence: no request seen).

A candidate is a DID worth asking, not a fact: no name, no decoder. What a real
module answers comes back from did_probe as observations (knowledge.mjs).
"""

import argparse
import json
import re
import sys

DID = re.compile(r'\b[0-9A-F]{4}\b')
TICKED_DID = re.compile(r'`([0-9A-F]{4})`')


def sample_of(heading):
  h = heading.lower()
  if 'positiva y negativa' in h:
    return 'mixed'
  if 'sin positivo' in h:
    return 'ambiguous'
  if 'positiva' in h:
    return 'positive'
  if 'negativa' in h:
    return 'negative'
  return None


def parse(text):
  """[(did, sample)] in the inventory's order; exits on a count that does not match."""
  out = []
  lines = text.splitlines()
  i = 0
  section = ''
  while i < len(lines):
    line = lines[i]
    if line.startswith('## '):
      section = line[3:].strip().lower()
    m = re.match(r'^### (.+?)\s+—\s+(\d+)\s*$', line)
    if m and sample_of(m.group(1)):
      sample, expected = sample_of(m.group(1)), int(m.group(2))
      j = i + 1
      while j < len(lines) and not lines[j].startswith('```'):
        j += 1
      k = j + 1
      while k < len(lines) and not lines[k].startswith('```'):
        k += 1
      dids = DID.findall(' '.join(lines[j + 1:k]))
      if len(dids) != expected:
        sys.exit(f'"{m.group(1)}": the heading says {expected}, the block has {len(dids)}')
      out += [(d, sample) for d in dids]
      i = k
    elif section.startswith('candidatos') and line.startswith('|') and TICKED_DID.search(line.split('|')[1]):
      out += [(d, 'weak') for d in TICKED_DID.findall(line.split('|')[1])]
    i += 1
  return out


def main():
  ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
  ap.add_argument('inventory')
  ap.add_argument('--make', required=True)
  ap.add_argument('--source', required=True, help='label kept with each candidate')
  ap.add_argument('--license', required=True, help='terms under which the lab may use the inventory')
  args = ap.parse_args()

  with open(args.inventory, encoding='utf-8') as f:
    found = parse(f.read())
  seen = {}
  for did, sample in found:
    if did in seen and seen[did] != sample:
      sys.exit(f'{did} is in two classes ({seen[did]}, {sample}): the inventory says they do not overlap')
    seen[did] = sample
  if not seen:
    sys.exit('no candidates found: check the inventory format (see --help)')

  counts = {}
  for sample in seen.values():
    counts[sample] = counts.get(sample, 0) + 1
  print(f'{len(seen)} candidates: {counts}', file=sys.stderr)

  json.dump({
    '_note': 'Generado por scripts/did-inventory-extract.py. DIDs candidatos a validar: no dicen qué mide cada uno ni qué módulo lo contesta.',
    'source': {'label': args.source, 'license': args.license, 'status': 'a validar'},
    'vehicles': [{
      'make': args.make.lower(),
      'model': 'generico',
      'note': f'candidatos a validar ({args.source})',
      'didCandidates': [{'did': d, 'sample': s, 'src': args.source} for d, s in seen.items()],
    }],
  }, sys.stdout, ensure_ascii=False, indent=1)
  print()


if __name__ == '__main__':
  main()
