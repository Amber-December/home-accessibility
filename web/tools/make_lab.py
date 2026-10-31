"""Build the 实验室 data set: a few WSR homes from an E1 import run.

For every home in SCENES it copies scene_ir.json and occupancy.npz into web/lab/<scene>/, writes a small preview
JPEG and writes web/lab/index.json with one row per home. web/tools/make_lab.cjs then runs B's engine and the plan
search on every home and fills in the outcomes.

    python web/tools/make_lab.py [--run $HA_OUTPUTS/runs/E1/<run>] [-j 6] [--index-only]
    node web/tools/make_lab.cjs
"""
import argparse
import json
import os
import pathlib
import shutil
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
    return scene


def row(scene, summary):
    """One home for the lab page; make_lab.cjs adds score, runs, na_reason and plans."""
    return {"id": scene, "hero": HERO.get(scene), "area_m2": summary["area"], "rooms": summary["rooms_list"],
            "ir": f"lab/{scene}/scene_ir.json", "preview": f"lab/{scene}/preview.jpg"}


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
    (OUT / "index.json").write_text(json.dumps({
        "source": "WorldSimReady-Home 户型，经 src/ha/ir 导入为 Scene IR",
        "generator": "web/tools/make_lab.py（户型导入）+ web/tools/make_lab.cjs（仿真引擎和方案搜索）",
        "homes": rows}, ensure_ascii=False, separators=(",", ":")))
    print("wrote", len(rows), "homes; now run node web/tools/make_lab.cjs")

if __name__ == "__main__":
    main()
