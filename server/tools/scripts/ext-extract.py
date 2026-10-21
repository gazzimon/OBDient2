#!/usr/bin/env python3
"""Builds data/ext/*.json for the lab knowledge base: per-make diagnostic
addresses from community sources the lab doesn't redistribute (GPL or no
license), so the output stays out of git (data/ext/ is ignored).

  python3 -I scripts/ext-extract.py <dir-with-clones>

expects, in <dir-with-clones>:
  ddt4all/                https://github.com/cedricp/ddt4all (GPL-3)         Renault/Dacia/Nissan
  arduino-psa-diag/       https://github.com/ludwig-v/arduino-psa-diag (GPL-3) Peugeot/Citroën/DS/Opel
  vag-uds-ids/            https://github.com/ConnorHowell/vag-uds-ids        VW/Audi/Seat/Skoda

Each source has one table for the whole group, not one per model, so it goes
in as "<make>/generico". Main modules (engine, gearbox, ABS, airbag, body,
cluster, steering, climate, gateway) come first: lookups and scans read them first.
"""

import json
import pathlib
import re
import subprocess
import sys

CORE = [
  ('engine', r'\b(ECM|INJ|ENGINCONTR|ENGINE\b|MOTOR\b)'),
  ('transmission', r'(TRANS|TCM|BOITEVIT|GEARBOX|\bAT\b|CVT)'),
  ('abs', r'(ABS|BRAKE|ABRASR|ESP|VDC)'),
  ('srs', r'(AIRBA|SRS)'),
  ('body', r'(UCH|BSI|BCM|BMF|BODY|CENTRALELECT)'),
  ('cluster', r'(METER|CLUSTER|COMBINE|TDB|INSTRU|DASHB)'),
  ('steering', r'(EPS|DIRECTN|STEER|POWERSTEER)'),
  ('hvac', r'(HVAC|CLIM|CLIMA|AIRCO)'),
  ('gateway', r'(GATEWAY|GATEW|CGW|DATABUS)'),
]


def rank(label):
  up = label.upper()
  for i, (_, rx) in enumerate(CORE):
    if re.search(rx, up):
      return i
  return len(CORE)


def module(req, rx, label, src):
  req, rx = req.upper(), rx.upper()
  bit29 = len(req) == 8
  return {
    'id': f'29:{req[4:6]}' if bit29 else f'11:{req}',
    'reqHeader': req,
    'rxHeader': rx,
    'label': label,
    'src': src,
  }


def ordered(mods):
  uniq = {}
  for m in mods:
    uniq.setdefault(m['id'], m)
  return sorted(uniq.values(), key=lambda m: (rank(m['label']), m['id']))


def commit(path):
  return subprocess.run(['git', '-C', str(path), 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout.strip()


def alliance(root):
  p = json.loads((root / 'src/ddt4all/resources/projects.json').read_text())['projects']['All']
  mods = []
  for dn, sn in (('dnat', 'snat'), ('dnat_ext', 'snat_ext')):
    for addr, req in p[dn].items():
      rx = p[sn].get(addr)
      name = p['addressing'].get(addr)
      if not rx or not name:
        continue
      short, long = name[0], name[1]
      label = short if short.lower() == long.lower() else f'{short} ({long})'
      mods.append(module(req, rx, label, 'ddt4all'))
  return ordered(mods)


def psa(root):
  mods = []
  for line in (root / 'ECU_LIST.md').read_text().splitlines():
    m = re.match(r'\|\s*([^|]+?)\s*\|[^|]*\|\s*>([0-9A-Fa-f]{3}):([0-9A-Fa-f]{3})\s*\|', line)
    if m:
      mods.append(module(m.group(2), m.group(3), m.group(1), 'arduino-psa-diag'))
  return ordered(mods)


def vag(root):
  mods = []
  for line in (root / 'readme.md').read_text().splitlines():
    m = re.match(r'\|\s*(LL_\w+)\s*\|\s*([0-9xXA-Fa-f/]+)\s*\|\s*([0-9xXA-Fa-f/]+)\s*\|', line)
    if not m:
      continue
    name = re.sub(r'^LL_|UDS$', '', m.group(1))
    reqs = [r[2:] for r in m.group(2).split('/')]
    rxs = [r[2:] for r in m.group(3).split('/')]
    for req, rx in zip(reqs, rxs):
      mods.append(module(req, rx, name, 'vag-uds-ids'))
  return ordered(mods)


def main(srcs):
  srcs = pathlib.Path(srcs)
  out = pathlib.Path(__file__).resolve().parent.parent / 'data/ext'
  out.mkdir(exist_ok=True)
  groups = [
    ('alliance', 'ddt4all', 'https://github.com/cedricp/ddt4all', 'GPL-3.0', alliance, ['renault', 'dacia', 'nissan']),
    ('psa', 'arduino-psa-diag', 'https://github.com/ludwig-v/arduino-psa-diag', 'GPL-3.0', psa, ['peugeot', 'citroen', 'ds', 'opel']),
    ('vag', 'vag-uds-ids', 'https://github.com/ConnorHowell/vag-uds-ids', 'sin licencia', vag, ['volkswagen', 'audi', 'seat', 'skoda']),
  ]
  for name, folder, repo, lic, fn, makes in groups:
    root = srcs / folder
    mods = fn(root)
    doc = {
      '_note': 'Generado por scripts/ext-extract.py; no se versiona. Tabla del grupo, no por modelo: se confirma con scan_modules.',
      'source': {'repo': repo, 'commit': commit(root), 'license': lic},
      'vehicles': [{'make': mk, 'model': 'generico', 'modules': mods} for mk in makes],
    }
    (out / f'{name}-seed.json').write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n')
    print(f'{name}: {len(mods)} módulos → {", ".join(makes)}')


if __name__ == '__main__':
  main(sys.argv[1])
