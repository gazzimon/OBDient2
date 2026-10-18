#!/usr/bin/env python3
"""Builds the app's trouble-code base from OBDex (CC0), checked against SAE J2012.

    python3 scripts/build-dtc-base.py --obdex generic.min.json [--j2012 j2012-2007.json]

- OBDex (github.com/foerbsnavi/OBDex, data CC0-1.0): 9,533 generic codes with
  title, description, causes, symptoms and repair estimates. Download:
  https://foerbsnavi.github.io/OBDex/generic.min.json
- SAE J2012 (DEC2007) is copyrighted and never ships: it is only used here to
  check OBDex's titles. Its JSON comes from parsing the PDF the user has
  (docs/ROADMAP.md, base de conocimiento).

Each code gets a confidence:
  c  title agrees with J2012
  u  not in J2012 2007 (later revisions): unchecked
  l  body/chassis (B0/C0) not in J2012: OBDex disagrees with J2012 on ~25 % of
     the B0/C0 codes it can be checked against, so these are low confidence
Codes whose title contradicts J2012 are left out: no description beats a
wrong one. A contradiction is a low similarity, different cylinder/bank/sensor
numbers or A–H letters, or a reworded title with no part in common.

Output: assets/dtc/obdex.dtcdb (JSON; the extension makes Metro ship it as an
asset, loaded from disk on first use instead of parsed at app start).
"""

import argparse
import datetime
import difflib
import json
import re
import sys
from collections import Counter
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "assets" / "dtc" / "obdex.dtcdb"
SUMMARY_SENTENCES = 2
MAX_CAUSES = 4
MAX_SYMPTOMS = 3
# Below this, the OBDex title is taken to contradict J2012 (measured: real
# errors such as P2231 sit at 0.29; rewordings stay above 0.6).
CONFLICT_RATIO = 0.5


# OBDex abbreviates what J2012 spells out; compare the spelled-out form.
ABBREVIATIONS = {
    "egr": "exhaust gas recirculation",
    "air": "secondary air injection",
    "evap": "evaporative emission",
    "dpf": "diesel particulate filter",
    "maf": "mass air flow",
    "map": "manifold absolute pressure",
    "iat": "intake air temperature",
    "ect": "engine coolant temperature",
    "tcm": "transmission control module",
    "ecm": "engine control module",
    "pcm": "powertrain control module",
    "scr": "selective catalytic reduction",
    "vvt": "variable valve timing",
}


def norm(s: str) -> str:
    words = re.sub(r"[^a-z0-9 ]", " ", s.lower()).split()
    return " ".join(ABBREVIATIONS.get(w, w) for w in words)


GENERIC = set("""a an the of to with from and or for in on bank sensor circuit control system module
performance range low high open short intermittent erratic malfunction signal stuck off voltage
input output switch valve actuator code data invalid received lost communication""".split())


def designators(title: str) -> tuple[set, set]:
    """Numbers (cylinder, bank, sensor) and letters A–H that tell parts apart."""
    clean = title.replace("A/C", "AC")
    return set(re.findall(r"\b\d{1,2}\b", clean)), set(re.findall(r'(?<![\w/])"?([A-H])"?(?![\w/])', clean))


def contradicts(obdex: str, j2012: str) -> bool:
    """True when OBDex's title names a different code than J2012's."""
    ratio = difflib.SequenceMatcher(None, norm(obdex), norm(j2012)).ratio()
    if ratio < CONFLICT_RATIO:
        return True
    (on, ol), (jn, jl) = designators(obdex), designators(j2012)
    if on and jn and on != jn:  # cylinder 4 vs cylinder 5, bank 2 vs bank 1
        return True
    if ol and jl and ol != jl:  # sensor A vs sensor B, bus B vs bus E
        return True
    if ratio < 0.7:  # reworded: they must still name a common part
        ow = set(norm(obdex).split()) - GENERIC
        jw = set(norm(j2012).split()) - GENERIC
        return not (ow & jw)
    return False


def summary(text: str) -> str:
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return " ".join(sentences[:SUMMARY_SENTENCES])


def j2012_titles(path: Path) -> dict:
    data = json.loads(path.read_text())
    out = {}
    for code, v in data.items():
        desc = v["desc"]
        if "Reserved" in desc or "Manufacturer Controlled" in desc:
            continue
        # PDF parsing artefact: a title cut to its last words ("Range/Performance").
        if len(desc.split()) <= 2:
            continue
        title = desc + (" " + v["loc"] if v.get("loc") else "")
        # Footnote marks the PDF table leaves at the end: "Bank 2 Sensor 1 5", "Bank 1 b,8".
        title = re.sub(r"\s+[a-z](,\d+)*$", "", title)  # "b", "b,8"
        out[code] = re.sub(r"(\d)\s+\d{1,2}$", r"\1", title)  # "Sensor 1 5": a number after a number
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--obdex", required=True, type=Path)
    ap.add_argument("--j2012", type=Path)
    args = ap.parse_args()

    entries = json.loads(args.obdex.read_text())
    ref = j2012_titles(args.j2012) if args.j2012 else {}
    codes, stats, conflicts = {}, Counter(), []
    for e in entries:
        code = e["code"]
        title = e["title"]["en"]
        if code in ref:
            if contradicts(title, ref[code]):
                stats["conflict"] += 1
                conflicts.append(code)
                continue
            conf = "c"
        else:
            conf = "l" if code[:2] in ("B0", "C0") else "u"
        stats[conf] += 1
        rep = e.get("repair") or {}
        codes[code] = [
            title,
            summary(e["description"]["en"]),
            [[c["likelihood"][0], c["label"]["en"]] for c in e.get("common_causes", [])[:MAX_CAUSES]],
            [s["en"] for s in e.get("symptoms", [])[:MAX_SYMPTOMS]],
            [rep.get("difficulty"), rep.get("estimated_cost_eur")],
            conf,
        ]

    meta = {
        "source": "OBDex (https://github.com/foerbsnavi/OBDex), CC0-1.0",
        "built": datetime.date.today().isoformat(),
        "checkedAgainst": "SAE J2012 DEC2007 (titles only; not distributed)" if ref else None,
        "counts": dict(stats),
        "excluded": conflicts,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"meta": meta, "codes": codes}, ensure_ascii=False, separators=(",", ":")))
    print(f"{OUT}: {len(codes)} códigos, {OUT.stat().st_size / 1e6:.1f} MB")
    print(f"  coinciden con J2012: {stats['c']} · sin verificar: {stats['u']} · B0/C0 sin verificar: {stats['l']} · excluidos: {stats['conflict']}")
    if conflicts:
        print("  excluidos:", " ".join(conflicts))


if __name__ == "__main__":
    sys.exit(main())
