"""Trip log + frames → samples for the teacher models.

    python3 make_samples.py trips/trip-20261018-101500.jsonl out/

One sample per burst of frames (domain/recording/frame-capture): the burst's
frames (oldest → newest, upright JPEGs), the ego history before the newest
frame and the trajectory actually driven after it. Both trajectories are in
the vehicle frame at the newest frame: x forward, y left, metres — the frame
Alpamayo and Qwen-Drive plan in.

Writes out/samples.jsonl and out/frames/<trip>/<t>.jpg.
"""

import json
import math
import sys
from pathlib import Path

from PIL import Image

HISTORY_S = 1.5  # 16 points at 10 Hz, as both planners take it
FUTURE_S = 6.4
STEP_S = 0.1
EARTH_R = 6371008.8

# VisionCamera Frame.orientation: how the pixel data is rotated relative to
# upright. PIL rotates counter-clockwise.
UPRIGHT_ROTATION = {"up": 0, "right": 90, "left": -90, "down": 180}


def load(path: Path):
    recs = []
    for line in path.read_text().splitlines():
        try:
            recs.append(json.loads(line))
        except json.JSONDecodeError:
            pass  # a crash can leave half a line
    return recs


def interp_state(states, t):
    """Fused state (lat, lng, hdg, spd) at time t (ms), linear between records."""
    if not states or t < states[0]["t"] or t > states[-1]["t"]:
        return None
    lo, hi = 0, len(states) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if states[mid]["t"] <= t:
            lo = mid
        else:
            hi = mid
    a, b = states[lo], states[hi]
    if b["t"] - a["t"] > 1000:
        return None  # gap in the log: no state
    w = 0 if b["t"] == a["t"] else (t - a["t"]) / (b["t"] - a["t"])
    dh = ((b["hdg"] - a["hdg"] + 540) % 360) - 180
    return {
        "lat": a["lat"] + w * (b["lat"] - a["lat"]),
        "lng": a["lng"] + w * (b["lng"] - a["lng"]),
        "hdg": (a["hdg"] + w * dh) % 360,
        "spd": a["spd"] + w * (b["spd"] - a["spd"]),
    }


def to_ego(origin, p):
    """Point p in the vehicle frame at origin: x forward, y left (m)."""
    lat0 = math.radians(origin["lat"])
    de = math.radians(p["lng"] - origin["lng"]) * math.cos(lat0) * EARTH_R
    dn = math.radians(p["lat"] - origin["lat"]) * EARTH_R
    h = math.radians(origin["hdg"])
    return (de * math.sin(h) + dn * math.cos(h), -de * math.cos(h) + dn * math.sin(h))


def track(states, origin, t0, t_from, t_to):
    pts = []
    n = round((t_to - t_from) / (STEP_S * 1000))
    for k in range(n + 1):
        t = t_from + k * STEP_S * 1000
        s = interp_state(states, t)
        if s is None:
            return None
        x, y = to_ego(origin, s)
        dh = ((s["hdg"] - origin["hdg"] + 540) % 360) - 180
        pts.append({"dt": round((t - t0) / 1000, 2), "x": round(x, 2), "y": round(y, 2),
                    "yaw": round(-dh, 1), "v": round(s["spd"], 2)})
    return pts


def main(log_path: str, out_dir: str):
    log = Path(log_path)
    out = Path(out_dir)
    recs = load(log)
    states = sorted((r for r in recs if r.get("k") == "st"), key=lambda r: r["t"])
    frames = sorted((r for r in recs if r.get("k") == "frm"), key=lambda r: r["t"])
    meta = next((r.get("meta", {}) for r in recs if r.get("k") == "hdr"), {})
    bursts = {}
    for f in frames:
        bursts.setdefault(f["b"], []).append(f)

    frame_out = out / "frames" / log.stem
    frame_out.mkdir(parents=True, exist_ok=True)
    n = 0
    with (out / "samples.jsonl").open("a") as fh:
        for burst, fs in sorted(bursts.items()):
            fs.sort(key=lambda f: f["i"])
            t0 = fs[-1]["t"]
            origin = interp_state(states, t0)
            if origin is None:
                continue
            history = track(states, origin, t0, t0 - HISTORY_S * 1000, t0)
            future = track(states, origin, t0, t0, t0 + FUTURE_S * 1000)
            paths = []
            for f in fs:
                src = log.parent / f["f"]
                if not src.exists():
                    break
                dst = frame_out / Path(f["f"]).name
                if not dst.exists():
                    img = Image.open(src)
                    rot = UPRIGHT_ROTATION.get(f.get("o", "up"), 0)
                    (img.rotate(rot, expand=True) if rot else img).save(dst, quality=92)
                paths.append(str(dst.relative_to(out)))
            if len(paths) != len(fs):
                continue
            fh.write(json.dumps({
                "id": f"{log.stem}/{t0}",
                "trip": log.stem,
                "t": t0,
                "frames": paths,
                "frame_dt": [round((f["t"] - t0) / 1000, 2) for f in fs],
                "speed_mps": round(origin["spd"], 2),
                "hfov_deg": meta.get("calibration", {}).get("hfovDeg"),
                "history": history,
                "future": future,  # None near the end of the trip
            }) + "\n")
            n += 1
    print(f"{log.name}: {n} muestras de {len(bursts)} ráfagas")


if __name__ == "__main__":
    main(*sys.argv[1:3])
