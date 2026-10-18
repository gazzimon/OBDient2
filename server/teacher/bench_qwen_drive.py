"""Qwen-Drive-1.0-4B on driving frames: QA + trajectory, one camera vs three.

Runs inside obdient/teacher-qwen-drive (Dockerfile.qwen-drive), one GPU:

    python bench_qwen_drive.py --model /models/qwen-drive-1.0-4b \
        --demo /opt/qwen-drive/data/demo --samples /work/samples/samples.jsonl --out /work/out

Qwen-Drive plans from three front cameras. OBDient2 has one, so every scene
is also run with the single front camera standing in for the other two:
  tri        the scene's real three cameras (demo scenes only, the reference)
  mono-dup   the front frames copied into the left and right views
  mono-crop  left and right views cut from the front frame's edges
Comparing them against the trajectory actually driven says what one camera costs.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from qwen_drive import CameraFrame, DrivingScene, InferenceMode, QwenDriveForPlanning
from qwen_drive.benchmarks import read_scene_file
from qwen_drive.scene import CAMERA_VIEWS

FRONT, LEFT, RIGHT = CAMERA_VIEWS
QUESTIONS = [
    "Describe the driving scene in one or two sentences: road type, traffic, weather and lighting.",
    "Are there pedestrians or cyclists the ego vehicle must watch? Answer yes or no, then where.",
    "Is there a traffic light or stop sign that applies to the ego vehicle? If so, what is its state?",
    "What is the safest action for the ego vehicle in the next 3 seconds, and why?",
]
NUM_SAMPLES = 6


def crop_edge(frame: CameraFrame, side: str) -> CameraFrame:
    def load() -> Image.Image:
        img = frame.load()
        w, h = img.size
        box = (0, 0, int(w * 0.45), h) if side == "left" else (int(w * 0.55), 0, w, h)
        return img.crop(box)

    return CameraFrame(load, target_size=frame.target_size)


def mono(scene: DrivingScene, how: str) -> DrivingScene:
    front = list(scene.views[FRONT])
    if how == "mono-dup":
        views = {FRONT: front, LEFT: front, RIGHT: front}
    else:
        views = {
            FRONT: front,
            LEFT: [crop_edge(f, "left") for f in front],
            RIGHT: [crop_edge(f, "right") for f in front],
        }
    return DrivingScene(
        views=views,
        history=scene.history,
        history_velocity=scene.history_velocity,
        history_acceleration=scene.history_acceleration,
        ego_velocity=scene.ego_velocity,
        ego_acceleration=scene.ego_acceleration,
        driving_command=scene.driving_command,
        nav_command=scene.nav_command,
        instruction_text=scene.instruction_text,
        token=scene.token,
    )


def own_scene(s: dict, root: Path) -> tuple[DrivingScene, np.ndarray | None, list[str]]:
    """A sample from make_samples.py (one phone camera) as a DrivingScene."""
    dts = s["frame_dt"]
    # Qwen-Drive history frames: 2 Hz over 1.5 s → the frames nearest -1.5, -1.0, -0.5, 0 s.
    picks = [min(range(len(dts)), key=lambda i: abs(dts[i] - want)) for want in (-1.5, -1.0, -0.5, 0.0)]
    front = [CameraFrame(root / s["frames"][i]) for i in picks]
    hist = s["history"][-16:]
    xyh = np.array([[p["x"], p["y"], math.radians(p["yaw"])] for p in hist])
    v = np.array([p["v"] for p in hist])
    yaw_rate = np.gradient(xyh[:, 2], 0.1)
    vel = np.stack([v, np.zeros_like(v)], axis=1)  # body frame: all speed is forward
    acc = np.stack([np.gradient(v, 0.1), v * yaw_rate], axis=1)
    scene = DrivingScene(
        views={FRONT: front, LEFT: front, RIGHT: front},
        history=xyh,
        history_velocity=vel,
        history_acceleration=acc,
        ego_velocity=vel[-1].tolist(),
        ego_acceleration=acc[-1].tolist(),
        driving_command=[0, 0, 0, 1],  # unknown: the route is not used yet
        nav_command=0,
        token=s["id"],
    )
    fut = s.get("future")
    gt = np.array([[p["x"], p["y"], math.radians(p["yaw"])] for p in fut[1:]]) if fut else None
    # Alpamayo's history: the last 4 frames, 10 Hz.
    alpamayo = [str(root / s["frames"][i]) for i in range(len(dts)) if dts[i] >= -0.35]
    return scene, gt, alpamayo


def save_frames(scene: DrivingScene, out: Path, key: str) -> dict:
    """Current frame per view as JPEG for the report, plus the front history."""
    paths = {"front_history": []}
    for i, frame in enumerate(scene.views[FRONT]):
        p = out / "frames" / f"{key}-front-{i}.jpg"
        p.parent.mkdir(parents=True, exist_ok=True)
        frame.load().save(p, quality=90)
        paths["front_history"].append(str(p.relative_to(out)))
    for view, label in ((FRONT, "front"), (LEFT, "left"), (RIGHT, "right")):
        p = out / "frames" / f"{key}-{label}.jpg"
        p.parent.mkdir(parents=True, exist_ok=True)
        img = scene.views[view][-1].load()
        img.thumbnail((960, 960))
        img.save(p, quality=85)
        paths[label] = str(p.relative_to(out))
    return paths


def displacement(pred: np.ndarray, gt: np.ndarray | None) -> dict | None:
    if gt is None:
        return None
    n = min(len(pred), len(gt))
    err = np.linalg.norm(pred[:n, :2] - gt[:n, :2], axis=-1)
    at = lambda s: float(err[min(n, int(s * 10)) - 1])  # noqa: E731
    return {"ade": float(err.mean()), "fde": float(err[-1]), "at3s": at(3), "at5s": at(5)}


def run(model, scene: DrivingScene, gt, variant: str, qa: bool) -> dict:
    torch.cuda.synchronize()
    t = time.perf_counter()
    plan = model.run(InferenceMode.REASONING_PLANNING, scene=scene, num_samples=NUM_SAMPLES)
    torch.cuda.synchronize()
    plan_s = time.perf_counter() - t
    trajs = np.asarray(plan.trajectories)
    best = min(range(len(trajs)), key=lambda k: (displacement(trajs[k], gt) or {"ade": 0})["ade"])
    row = {
        "variant": variant,
        "plan_s": round(plan_s, 2),
        "reasoning": plan.reasoning,
        "trajectories": np.round(trajs[:, :, :2], 2).tolist(),
        "metrics": displacement(trajs[0], gt),
        "metrics_best_of": displacement(trajs[best], gt),
    }
    if qa:
        answers = []
        images = [scene.views[FRONT][-1].load()]
        for q in QUESTIONS:
            t = time.perf_counter()
            r = model.generate_text(images, q, max_new_tokens=384, temperature=0.01, top_k=1, top_p=0.001)
            answers.append({"q": q, "a": r.text, "s": round(time.perf_counter() - t, 2)})
        row["qa"] = answers
    return row


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", required=True)
    ap.add_argument("--planner", default=None, help="defaults to <model>/planner-rl")
    ap.add_argument("--demo", default=None, help="Qwen-Drive data/demo directory")
    ap.add_argument("--samples", default=None, help="samples.jsonl from make_samples.py")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    t = time.perf_counter()
    model = QwenDriveForPlanning.from_pretrained(
        args.model, planner=args.planner or f"{args.model}/planner-rl",
        dtype=torch.bfloat16, attn_implementation="sdpa",
    ).to("cuda").eval()
    load_s = time.perf_counter() - t

    jobs = []  # (key, source, scene, gt, variants, 10 Hz front frames or None)
    if args.demo:
        from qwen_drive.images import ImageArchive

        demo = Path(args.demo)
        archive = ImageArchive.open(demo / "frames.parquet")
        for smp in read_scene_file(demo / "planning_scenes.jsonl", image_archive=archive,
                                   num_history_points=model.config.num_history_points):
            gt = None if smp.future_trajectory is None else np.asarray(smp.future_trajectory)
            jobs.append((f"wod-{smp.token[:12]}", "waymo-demo", smp.scene, gt,
                         ["tri", "mono-dup", "mono-crop"], None))
    if args.samples:
        root = Path(args.samples).parent
        for line in Path(args.samples).read_text().splitlines():
            s = json.loads(line)
            scene, gt, hz10 = own_scene(s, root)
            jobs.append((s["id"].replace("/", "-"), "obdient2", scene, gt, ["mono-dup", "mono-crop"], hz10))

    # The same scenes, model-neutral, for bench_tf457.py (MiMo, Alpamayo).
    scenes_fh = (out / "scenes.jsonl").open("w")
    with (out / "qwen-drive-1.0-4b.jsonl").open("w") as fh:
        for key, source, scene, gt, variants, hz10 in jobs:
            frames = save_frames(scene, out, key)
            scenes_fh.write(json.dumps({
                "key": key, "source": source, "frames": frames,
                "front_2hz": frames["front_history"], "front_10hz": hz10,
                "history": np.round(np.asarray(scene.history, dtype=float), 4).tolist(),
                "gt": None if gt is None else np.round(gt.astype(float), 3).tolist(),
            }) + "\n")
            scenes_fh.flush()
            for variant in variants:
                sc = scene if variant == "tri" else mono(scene, variant)
                torch.cuda.reset_peak_memory_stats()
                row = run(model, sc, gt, variant, qa=variant == variants[0])
                row.update({
                    "model": "qwen-drive-1.0-4b", "key": key, "source": source, "frames": frames,
                    "history": np.round(np.asarray(scene.history)[:, :2], 2).tolist(),
                    "gt": None if gt is None else np.round(gt[:, :2], 2).tolist(),
                    "vram_gb": round(torch.cuda.max_memory_allocated() / 2**30, 2),
                    "load_s": round(load_s, 1),
                })
                fh.write(json.dumps(row) + "\n")
                fh.flush()
                m = row["metrics"] or {}
                print(f"{key} {variant}: {row['plan_s']} s, ADE {m.get('ade', float('nan')):.2f} m, "
                      f"{row['vram_gb']} GB", flush=True)
    if args.samples:
        shutil.copy(args.samples, out / "samples.jsonl")


if __name__ == "__main__":
    main()
