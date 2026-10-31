"""Build the 实验室 data set: a few WSR homes from an E1 import run, each with a generated result.

For every home in SCENES it copies scene_ir.json and occupancy.npz into web/lab/<scene>/, writes a small preview
JPEG, runs make_mock.py --unlabeled on it, and finally writes web/lab/index.json with one summary row per home.
The results are make_mock.py output (disc planning, sample prices), not evaluator output.

    python web/tools/make_lab.py [--run $HA_OUTPUTS/runs/E1/<run>] [-j 6] [--index-only]
"""
import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "web/lab"
RUN = "runs/E1/20261030-075249-all-v3"
# H1-H3 plus homes spread over 27-138 m2 that have a bed, toilet, sofa, living room and bathroom and import cleanly.
SCENES = ["scene000064", "scene000021", "scene000104", "scene000460", "scene000058", "scene000173", "scene000262",
          "scene000141", "scene000405", "scene000293", "scene000158", "scene000121", "scene000333", "scene000376"]
HERO = {"scene000064": "H1", "scene000021": "H2", "scene000104": "H3"}


def build(src, scene):
    d = OUT / scene
    d.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src / "occupancy.npz", d / "occupancy.npz")
    ir = json.loads((src / "scene_ir.json").read_text())
    for k in ("usdz", "metadata"):  # local paths -> relative to the WSR download, as in tests/fixtures/H1
        ir["source"][k] = "scene/" + ir["source"][k].split("/scene/", 1)[-1]
    (d / "scene_ir.json").write_text(json.dumps(ir, ensure_ascii=False, separators=(",", ":")))
    im = Image.open(src / "preview.png").convert("RGB")
    im.thumbnail((360, 360))
    im.save(d / "preview.jpg", "JPEG", quality=80)
    subprocess.run([sys.executable, str(ROOT / "web/tools/make_mock.py"), "--src", str(d), "--out", str(d / "sim_result.json"),
                    "--unlabeled"], check=True, stdout=subprocess.DEVNULL)
    return scene


def outcome(runs):
    """{"persona/task": "ok" | fail code | "na"} for one variant."""
    return {f"{r['persona']}/{r['task']}": "na" if not r["applicable"] else "ok" if r["success"] else r["fail_code"]
            for r in runs}


def row(scene, summary):
    """One home for the lab page: baseline and every plan as outcome maps, so the page can filter without the runs."""
    res = json.loads((OUT / scene / "sim_result.json").read_text())
    return {
        "id": scene, "hero": HERO.get(scene), "area_m2": summary["area"], "rooms": summary["rooms_list"],
        "ir": f"lab/{scene}/scene_ir.json", "result": f"lab/{scene}/sim_result.json", "preview": f"lab/{scene}/preview.jpg",
        "score": res["baseline"]["score"], "runs": outcome(res["baseline"]["runs"]),
        "na_reason": {f"{r['persona']}/{r['task']}": r["reason"] for r in res["baseline"]["runs"] if not r["applicable"]},
        "plans": [{"id": p["id"], "title": p["title"], "cost_cny": p["cost_cny"], "rent_ok": p["rent_ok"], "wall": p["wall"],
                   "score": p["score"], "worse": bool(p["worse"]), "runs": outcome(p["runs"])} for p in res["plans"]],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", type=pathlib.Path, default=pathlib.Path(os.environ.get("HA_OUTPUTS", "")) / RUN)
    ap.add_argument("-j", type=int, default=6)
    ap.add_argument("--index-only", action="store_true", help="rewrite index.json from the existing results")
    args = ap.parse_args()
    summary = {}
    for f in sorted(args.run.glob("summary-*.jsonl")):
        for line in f.read_text().splitlines():
            r = json.loads(line)
            summary[r["scene"]] = r
    with ThreadPoolExecutor(args.j) as ex:
        for s in ex.map(lambda s: build(args.run / "scenes" / s, s), [] if args.index_only else SCENES):
            print("done", s, flush=True)
    rows = [row(s, summary[s]) for s in SCENES]
    first = json.loads((OUT / SCENES[0] / "sim_result.json").read_text())
    (OUT / "index.json").write_text(json.dumps({
        "source": "WorldSimReady-Home 户型，经 src/ha/ir 导入为 Scene IR",
        "generator": "web/tools/make_lab.py + web/tools/make_mock.py",
        "note": "结果由 make_mock.py 生成，不是评估器输出：判定是圆盘近似和粗略的终点检查，价格是样例价格表。",
        "personas": first["personas"], "tasks": first["tasks"],
        "homes": rows}, ensure_ascii=False, separators=(",", ":")))
    for r in rows:
        ok = list(r["runs"].values())
        print(r["id"], r["area_m2"], r["score"], f"{ok.count('ok')}/{len(ok) - ok.count('na')}", len(r["plans"]))


if __name__ == "__main__":
    main()
