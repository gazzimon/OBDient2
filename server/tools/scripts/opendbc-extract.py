#!/usr/bin/env python3
"""Builds data/opendbc-seed.json for the lab knowledge base from a checkout of
commaai/opendbc (MIT): which diagnostic modules each car platform answers on,
at which request/response address.

  git clone --depth 1 https://github.com/commaai/opendbc.git /some/dir/opendbc
  python3 -I scripts/opendbc-extract.py /some/dir/opendbc > data/opendbc-seed.json

Static only (ast): opendbc's code is parsed, never imported or run.

Response address: opendbc's rule (uds.get_rx_addr_for_tx_addr) — 11-bit is
request + offset (0x8 unless the brand's FW query says otherwise, per ECU),
29-bit 18DAttF1 answers on 18DAF1tt. When a brand queries the same ECU with
both offsets, the default goes in rxHeader and the other in rxAlt.
"""

import ast
import json
import pathlib
import subprocess
import sys

SKIP_BRANDS = {'body', 'mock'}
TWO_WORD_MAKES = {'ALFA_ROMEO', 'LAND_ROVER', 'MERCEDES_BENZ', 'ASTON_MARTIN'}
LABELS = {
  'engine': 'PCM (motor)', 'transmission': 'TCM (caja)', 'abs': 'ABS', 'srs': 'airbag (SRS)',
  'eps': 'dirección (EPS)', 'fwdRadar': 'radar frontal', 'fwdCamera': 'cámara frontal',
  'gateway': 'gateway', 'combinationMeter': 'tablero (IPC)', 'hybrid': 'control híbrido',
  'body': 'carrocería (BCM)', 'hvac': 'climatización', 'epb': 'freno de mano eléctrico',
  'shiftByWire': 'selector de cambios', 'electricBrakeBooster': 'servofreno eléctrico',
  'adas': 'ADAS', 'cornerRadar': 'radar de esquina', 'parkingAdas': 'asistente de estacionamiento',
  'telematics': 'telemática', 'hud': 'HUD', 'dsu': 'DSU', 'vsa': 'VSA (estabilidad)',
  'programmedFuelInjection': 'PGM-FI (motor)', 'debug': 'debug', 'unknown': 'desconocido',
}


def offsets_by_ecu(values_py):
  """{ecu: set(rx_offset)} from the brand's FW query Requests; '*' = every ECU."""
  tree = ast.parse(values_py.read_text())
  consts = {}
  for n in ast.walk(tree):
    if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name):
      try:
        consts[n.targets[0].id] = ast.literal_eval(n.value)
      except ValueError:
        pass
  out = {}
  for n in ast.walk(tree):
    if not (isinstance(n, ast.Call) and getattr(n.func, 'id', '') == 'Request'):
      continue
    kw = {k.arg: k.value for k in n.keywords}
    off = 0x8
    if 'rx_offset' in kw:
      v = kw['rx_offset']
      off = consts.get(v.id) if isinstance(v, ast.Name) else ast.literal_eval(v)
    wl = kw.get('whitelist_ecus')
    ecus = [e.attr for e in wl.elts] if isinstance(wl, ast.List) else ['*']
    for e in ecus:
      out.setdefault(e, set()).add(off)
  return out


def rx_for(addr, off):
  if addr > 0x10000000:
    return (addr & 0xFFFF0000) | ((addr << 8) & 0xFF00) | ((addr >> 8) & 0xFF)
  rx = addr + off
  return rx if 0 <= rx <= 0x7FF else None


def header(addr):
  return f'{addr:08X}' if addr > 0x7FF else f'{addr:03X}'


def module(ecu, addr, sub, offs):
  bit29 = addr > 0x10000000
  offs = offs.get(ecu) or offs.get('*') or {0x8}
  custom = sorted(o for o in offs if o != 0x8)
  rx = rx_for(addr, 0x8 if 0x8 in offs else custom[0])
  if rx is None:
    return None
  m = {
    'id': f'29:{(addr >> 8) & 0xFF:02X}' if bit29 else f'11:{addr:03X}',
    'reqHeader': header(addr),
    'rxHeader': header(rx),
    'label': LABELS.get(ecu, ecu),
    'ecu': ecu,
    'src': 'opendbc',
  }
  if not bit29 and 0x8 in offs and custom and rx_for(addr, custom[0]) is not None:
    m['rxAlt'] = header(rx_for(addr, custom[0]))
  if sub is not None:  # extended addressing: first data byte selects the module
    m['id'] += f'.{sub:02X}'
    m['sub'] = f'{sub:02X}'
  return m


def make_model(platform):
  if platform.startswith('PSA_'):  # group prefix, the make comes next (PSA_PEUGEOT_208)
    platform = platform[4:]
  for two in TWO_WORD_MAKES:
    if platform.startswith(two + '_'):
      return two.replace('_', '-').lower(), platform[len(two) + 1:].replace('_', '-').lower()
  make, _, model = platform.partition('_')
  return make.lower(), model.replace('_', '-').lower()


def main(root):
  root = pathlib.Path(root)
  commit = subprocess.run(['git', '-C', str(root), 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout.strip()
  vehicles = []
  for fp in sorted((root / 'opendbc/car').glob('*/fingerprints.py')):
    brand = fp.parent.name
    if brand in SKIP_BRANDS:
      continue
    offs = offsets_by_ecu(fp.parent / 'values.py')
    for node in ast.walk(ast.parse(fp.read_text())):
      if not (isinstance(node, ast.Assign) and getattr(node.targets[0], 'id', '') == 'FW_VERSIONS'):
        continue
      for car, ecus in zip(node.value.keys, node.value.values):
        platform = car.attr
        mods = {}
        for k in ecus.keys:
          ecu, addr, sub = k.elts[0].attr, ast.literal_eval(k.elts[1]), ast.literal_eval(k.elts[2])
          m = module(ecu, addr, sub, offs)
          if m:
            mods[m['id']] = m
        make, model = make_model(platform)
        vehicles.append({'make': make, 'model': model, 'platform': platform, 'modules': sorted(mods.values(), key=lambda m: m['id'])})
  json.dump({
    '_note': 'Generado por scripts/opendbc-extract.py. Direcciones de diagnóstico por plataforma; se confirman con barridos reales (scan_modules).',
    'source': {'repo': 'https://github.com/commaai/opendbc', 'commit': commit, 'license': 'MIT', 'copyright': 'Copyright (c) 2020, Comma.ai, Inc.'},
    'vehicles': vehicles,
  }, sys.stdout, ensure_ascii=False, indent=1)
  sys.stdout.write('\n')


if __name__ == '__main__':
  main(sys.argv[1])
