"""E1: import WSR homes into Scene IR (+ occupancy npz, preview png).

  python scripts/run_import.py scene000000 scene000003      # selected homes
  python scripts/run_import.py --all --workers 8             # every downloaded home
  python scripts/run_import.py --all --shard 0/4             # one shard (parallel fan-out)

Writes $HA_OUTPUTS/runs/E1/<run_id>/{scenes/<id>/..., summary.jsonl, manifest.json}.
A failed home is recorded in summary.jsonl with its error; nothing is retried silently.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from ha import runlog

SCENES = Path(os.environ.get("HA_DATA", "")) / "World-SimReady-Home/raw/full/scene"


def one(scene: str, out_root: str) -> dict:
    from ha.ir.preview import render
    from ha.ir.schema import validate
    from ha.ir.wsr_import import import_scene
    t = time.time()
    try:
        ir = import_scene(SCENES / scene, Path(out_root) / "scenes" / scene)
        render(Path(out_root) / "scenes" / scene)
        doors = ir["doors"]
        return {"scene": scene, "ok": True, "errors": validate(ir), "seconds": round(time.time() - t, 1),
                **ir["report"]["counts"], "missing_refs": len(ir["report"]["missing_refs"]),
                "warnings": len(ir["report"]["warnings"]),
                "rooms_list": sorted(r["id"] for r in ir["rooms"]),
                "categories": sorted({o["category"] for o in ir["objects"]}),
                "door_clear": sorted(d.get("clear_width") or 0 for d in doors),
                "door_kinds": sorted(d["kind"] for d in doors),
                "area": round(sum(r["area"] for r in ir["rooms"]), 1)}
    except Exception as e:
        return {"scene": scene, "ok": False, "error": f"{type(e).__name__}: {e}",
                "trace": traceback.format_exc()[-2000:], "seconds": round(time.time() - t, 1)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scenes", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--shard", default="0/1", help="i/n: take every n-th home starting at i")
    ap.add_argument("--run-dir", help="reuse a run directory (shards of one batch write into the same run)")
    a = ap.parse_args()
    scenes = sorted(p.name for p in SCENES.iterdir() if (p / f"{p.name}.usdz").exists()) if a.all else a.scenes
    i, n = map(int, a.shard.split("/"))
    scenes = scenes[i::n]
    run_dir = Path(a.run_dir) if a.run_dir else runlog.new_run("E1", tag="all" if a.all else "")
    run_dir.mkdir(parents=True, exist_ok=True)
    summary = run_dir / (f"summary-{i}of{n}.jsonl" if n > 1 else "summary.jsonl")
    t0 = time.time()
    with summary.open("a") as f, ProcessPoolExecutor(max_workers=a.workers) as ex:
        futs = [ex.submit(one, s, str(run_dir)) for s in scenes]
        for k, fu in enumerate(as_completed(futs), 1):
            r = fu.result()
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
            f.flush()
            print(f"[{k}/{len(scenes)}] {r['scene']} {'ok' if r['ok'] else 'FAIL ' + r['error']} {r['seconds']}s",
                  flush=True)
    if n == 1:
        runlog.write_manifest(run_dir, experiment="E1",
                              params={"scenes": len(scenes), "workers": a.workers, "all": a.all},
                              inputs={"wsr_scene_root": str(SCENES)},
                              notes=f"wall time {time.time() - t0:.0f}s")
    print(run_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
