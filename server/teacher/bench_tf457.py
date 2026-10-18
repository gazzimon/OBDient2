"""MiMo-Embodied-7B and Alpamayo 1.5 on the scenes bench_qwen_drive.py wrote.

Runs inside obdient/teacher-tf457 (Dockerfile.tf457), one model per run:

    python bench_tf457.py mimo     --model /models/mimo-embodied-7b  --out /work/out
    python bench_tf457.py alpamayo --model /models/alpamayo-1.5-10b  --out /work/out

Reads out/scenes.jsonl; writes out/mimo-embodied-7b.jsonl or out/alpamayo-1.5-10b.jsonl.
Both models see only the front camera, as OBDient2 would.
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image

QUESTIONS = [
    "Describe the driving scene in one or two sentences: road type, traffic, weather and lighting.",
    "Are there pedestrians or cyclists the ego vehicle must watch? Answer yes or no, then where.",
    "Is there a traffic light or stop sign that applies to the ego vehicle? If so, what is its state?",
    "What is the safest action for the ego vehicle in the next 3 seconds, and why?",
]
# MiMo plans in text: ask for waypoints in the same ego frame and parse them.
PLAN_PROMPT = (
    "You are driving the ego vehicle in this front camera image. Its speed is {v:.1f} m/s. "
    "Predict its trajectory for the next 5 seconds as 10 waypoints, one every 0.5 s, in metres in the "
    "ego frame (x forward, y left). Answer only with the list, like [(x1, y1), (x2, y2), ...]."
)


def displacement(pred: np.ndarray, gt: list | None) -> dict | None:
    """pred: [N, 2] at 10 Hz from t+0.1 s."""
    if gt is None:
        return None
    g = np.asarray(gt)[:, :2]
    n = min(len(pred), len(g))
    err = np.linalg.norm(pred[:n] - g[:n], axis=-1)
    at = lambda s: float(err[min(n, int(s * 10)) - 1])  # noqa: E731
    return {"ade": float(err.mean()), "fde": float(err[-1]), "at3s": at(3), "at5s": at(5)}


def as_text(x) -> str:
    """Alpamayo returns text as nested lists or numpy arrays of strings: first one."""
    while not isinstance(x, str):
        x = np.asarray(x, dtype=object).reshape(-1)[0] if np.size(x) else ""
    return x


NAV_VERB = {0: None, 1: "Turn left", 2: "Turn right"}


def nav_text(sc: dict) -> str | None:
    """Alpamayo's navigation input ("Turn left in 11m"), as the app would get it from the route.

    The distance is where the driven path's heading has turned 20°: what OSRM would
    give as the distance to the maneuver.
    """
    nav = sc.get("nav")
    if nav is None:
        return None
    verb = NAV_VERB.get(int(nav))
    if verb is None:
        return "Continue straight"
    gt = np.asarray(sc["gt"] or [])
    if len(gt) == 0:
        return verb
    turned = np.nonzero(np.abs(gt[:, 2]) > np.radians(20))[0]
    end = turned[0] if len(turned) else len(gt) - 1
    dist = float(np.sum(np.linalg.norm(np.diff(np.vstack([[0, 0], gt[: end + 1, :2]]), axis=0), axis=1)))
    return f"{verb} in {max(1, round(dist))}m"


def speed_now(history: list) -> float:
    h = np.asarray(history)
    return float(np.linalg.norm(h[-1, :2] - h[-2, :2]) / 0.1)


# ---------------------------------------------------------------- MiMo-Embodied


def bench_mimo(args, scenes, out: Path):
    from transformers import AutoProcessor, Qwen2_5_VLForConditionalGeneration

    t = time.perf_counter()
    model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
        args.model, dtype=torch.bfloat16, attn_implementation="sdpa"
    ).to("cuda").eval()
    processor = AutoProcessor.from_pretrained(args.model, max_pixels=1280 * 28 * 28)
    load_s = time.perf_counter() - t

    def ask(img: Image.Image, q: str, max_new: int = 384) -> tuple[str, float]:
        msgs = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": q}]}]
        text = processor.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
        inputs = processor(text=[text], images=[img], return_tensors="pt").to("cuda")
        torch.cuda.synchronize()
        t = time.perf_counter()
        ids = model.generate(**inputs, max_new_tokens=max_new, do_sample=False)
        torch.cuda.synchronize()
        ans = processor.batch_decode(ids[:, inputs.input_ids.shape[1]:], skip_special_tokens=True)[0]
        # MiMo may think first; keep the answer.
        ans = re.sub(r"(?s)<think>.*?</think>", "", ans).strip()
        return ans, time.perf_counter() - t

    with (out / "mimo-embodied-7b.jsonl").open("w") as fh:
        for sc in scenes:
            torch.cuda.reset_peak_memory_stats()
            img = Image.open(out / sc["front_2hz"][-1]).convert("RGB")
            qa = []
            for q in QUESTIONS:
                a, s = ask(img, q)
                qa.append({"q": q, "a": a, "s": round(s, 2)})
            raw, plan_s = ask(img, PLAN_PROMPT.format(v=speed_now(sc["history"])), max_new=1024)
            pts = [(float(x), float(y)) for x, y in re.findall(r"\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)", raw)]
            traj = None
            metrics = None
            # All zeros (= "stand still" while the car moved) or no list: not a prediction.
            if len(pts) >= 2 and max(abs(v) for p in pts for v in p) >= 0.5:
                # 2 Hz waypoints → 10 Hz by linear interpolation from the origin.
                wp = np.array([(0.0, 0.0)] + pts)
                tt = np.arange(len(wp)) * 0.5
                t10 = np.arange(1, int(tt[-1] * 10) + 1) * 0.1
                traj = np.stack([np.interp(t10, tt, wp[:, 0]), np.interp(t10, tt, wp[:, 1])], axis=1)
                metrics = displacement(traj, sc["gt"])
            row = {
                "model": "mimo-embodied-7b", "key": sc["key"], "source": sc["source"], "variant": "mono",
                "qa": qa, "plan_raw": raw, "plan_s": round(plan_s, 2),
                "trajectories": None if traj is None else [np.round(traj, 2).tolist()],
                "metrics": metrics, "metrics_best_of": metrics,
                "vram_gb": round(torch.cuda.max_memory_allocated() / 2**30, 2), "load_s": round(load_s, 1),
            }
            fh.write(json.dumps(row) + "\n")
            fh.flush()
            print(f"{sc['key']}: plan {row['plan_s']} s, ADE {(metrics or {}).get('ade')}, {row['vram_gb']} GB",
                  flush=True)


# ---------------------------------------------------------------- Alpamayo 1.5


def bench_alpamayo(args, scenes, out: Path):
    from alpamayo1_5 import helper
    from alpamayo1_5.models.alpamayo1_5 import Alpamayo1_5

    t = time.perf_counter()
    model = Alpamayo1_5.from_pretrained(args.model, dtype=torch.bfloat16, attn_implementation="sdpa").to("cuda")
    model.eval()
    processor = helper.get_processor(model.tokenizer)
    load_s = time.perf_counter() - t
    front_wide = torch.tensor([1])  # camera_front_wide_120fov

    def frames_tensor(paths: list[str]) -> torch.Tensor:
        imgs = [np.asarray(Image.open(out / p if not Path(p).is_absolute() else p).convert("RGB")) for p in paths]
        return torch.from_numpy(np.stack(imgs)).permute(0, 3, 1, 2)  # (4, 3, H, W) uint8

    def ego_history(history: list) -> tuple[torch.Tensor, torch.Tensor]:
        h = np.asarray(history, dtype=np.float32)  # [16, 3] x, y, yaw (rad); last row is (0, 0, 0)
        xyz = np.concatenate([h[:, :2], np.zeros((len(h), 1), np.float32)], axis=1)
        c, s = np.cos(h[:, 2]), np.sin(h[:, 2])
        rot = np.zeros((len(h), 3, 3), np.float32)
        rot[:, 0, 0], rot[:, 0, 1], rot[:, 1, 0], rot[:, 1, 1], rot[:, 2, 2] = c, -s, s, c, 1
        return torch.from_numpy(xyz)[None, None], torch.from_numpy(rot)[None, None]

    # --nav appends next to the run without navigation.
    with (out / "alpamayo-1.5-10b.jsonl").open("a" if args.nav else "w") as fh:
        for sc in scenes:
            # 10 Hz history when the trip has it (OBDient2 bursts); the demo scenes only have 2 Hz.
            paths = sc["front_10hz"] or sc["front_2hz"]
            frames = frames_tensor(paths)
            xyz, rot = ego_history(sc["history"])
            torch.cuda.reset_peak_memory_stats()

            nav = nav_text(sc) if args.nav else None
            msgs = helper.create_message(frames, camera_indices=front_wide, nav_text=nav,
                                         use_nav_prompt=args.nav)
            inputs = processor.apply_chat_template(msgs, tokenize=True, add_generation_prompt=False,
                                                   continue_final_message=True, return_dict=True,
                                                   return_tensors="pt")
            data = helper.to_device({"tokenized_data": inputs, "ego_history_xyz": xyz, "ego_history_rot": rot},
                                    "cuda")
            torch.cuda.manual_seed_all(42)
            torch.cuda.synchronize()
            t = time.perf_counter()
            with torch.autocast("cuda", dtype=torch.bfloat16):
                pred_xyz, _, extra = model.sample_trajectories_from_data_with_vlm_rollout(
                    data=data, top_p=0.98, temperature=0.6, num_traj_samples=6,
                    max_generation_length=256, return_extra=True,
                )
            torch.cuda.synchronize()
            plan_s = time.perf_counter() - t
            trajs = pred_xyz.float().cpu().numpy()[0, 0, :, :, :2]  # (6, 64, 2)
            scores = [displacement(tr, sc["gt"]) for tr in trajs]
            best = min(range(len(trajs)), key=lambda k: (scores[k] or {"ade": 0})["ade"])

            qa = []
            for q in ([] if args.nav else QUESTIONS):  # answers do not depend on navigation
                m = helper.create_vqa_message(frames, question=q, camera_indices=front_wide)
                vin = processor.apply_chat_template(m, tokenize=True, add_generation_prompt=False,
                                                    continue_final_message=True, return_dict=True,
                                                    return_tensors="pt")
                t = time.perf_counter()
                with torch.autocast("cuda", dtype=torch.bfloat16):
                    r = model.generate_text(data=helper.to_device({"tokenized_data": vin}, "cuda"),
                                            top_p=0.98, temperature=0.6, num_samples=1,
                                            max_generation_length=256)
                qa.append({"q": q, "a": as_text(r["answer"]), "s": round(time.perf_counter() - t, 2)})

            row = {
                "model": "alpamayo-1.5-10b", "key": sc["key"], "source": sc["source"],
                "variant": ("mono-10hz" if sc["front_10hz"] else "mono-2hz") + ("-nav" if args.nav else ""),
                "nav_text": nav,
                "reasoning": as_text(extra["cot"]),
                "plan_s": round(plan_s, 2), "trajectories": np.round(trajs, 2).tolist(),
                "metrics": scores[0], "metrics_best_of": scores[best], "qa": qa or None,
                "vram_gb": round(torch.cuda.max_memory_allocated() / 2**30, 2), "load_s": round(load_s, 1),
            }
            fh.write(json.dumps(row, default=lambda o: o.tolist() if hasattr(o, "tolist") else str(o)) + "\n")
            fh.flush()
            print(f"{sc['key']}: plan {row['plan_s']} s, ADE {(scores[0] or {}).get('ade')}, {row['vram_gb']} GB",
                  flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("which", choices=["mimo", "alpamayo"])
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--nav", action="store_true", help="Alpamayo: give the navigation instruction")
    args = ap.parse_args()
    out = Path(args.out)
    scenes = [json.loads(line) for line in (out / "scenes.jsonl").read_text().splitlines()]
    (bench_mimo if args.which == "mimo" else bench_alpamayo)(args, scenes, out)


if __name__ == "__main__":
    main()
