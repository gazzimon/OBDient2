"""Benchmark results → one self-contained HTML page (frames embedded).

    python3 build_report.py out/ report.html

Reads out/scenes.jsonl and every out/<model>.jsonl the benches wrote.
"""

import base64
import io
import json
import sys
from pathlib import Path

from PIL import Image

MODELS = {
    "qwen-drive-1.0-4b": "Qwen-Drive-1.0 4B",
    "mimo-embodied-7b": "MiMo-Embodied 7B",
    "alpamayo-1.5-10b": "Alpamayo 1.5 10B",
}


def thumb(path: Path, width: int = 720) -> str:
    img = Image.open(path).convert("RGB")
    img.thumbnail((width, width))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=72)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def main(out_dir: str, html_path: str) -> None:
    out = Path(out_dir)
    scenes = [json.loads(line) for line in (out / "scenes.jsonl").read_text().splitlines()]
    results = []
    for model in MODELS:
        f = out / f"{model}.jsonl"
        if f.exists():
            results += [json.loads(line) for line in f.read_text().splitlines() if line.strip()]
    data = {
        "models": MODELS,
        "scenes": [
            {
                "key": s["key"],
                "source": s["source"],
                "image": thumb(out / s["frames"]["front"]),
                "sides": [thumb(out / s["frames"][k], 360) for k in ("left", "right")],
                "history": [p[:2] for p in s["history"]],
                "gt": None if s["gt"] is None else [p[:2] for p in s["gt"]],
            }
            for s in scenes
        ],
        "results": [
            {k: r.get(k) for k in ("model", "key", "variant", "plan_s", "vram_gb", "load_s", "metrics",
                                   "metrics_best_of", "reasoning", "qa", "trajectories", "plan_raw")}
            for r in results
        ],
    }
    template = (Path(__file__).parent / "report.template.html").read_text()
    Path(html_path).write_text(template.replace("/*__DATA__*/null", json.dumps(data)))
    print(f"{html_path}: {len(scenes)} escenas, {len(results)} corridas, "
          f"{Path(html_path).stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main(*sys.argv[1:3])
