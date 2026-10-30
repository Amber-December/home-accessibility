"""Close a sharded E1 batch: merge summary-*.jsonl stats, check the import gate, write manifest.json.

  python scripts/finalize_import.py $HA_OUTPUTS/runs/E1/<run_id> --shards 4 --workers 6
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
from collections import Counter
from pathlib import Path

from ha import runlog

GATE = 0.95  # plan: >= 95 % of homes import without error


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("--shards", type=int, required=True)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--expected", type=int, default=500)
    a = ap.parse_args()
    run = Path(a.run)
    rows = [json.loads(line) for p in sorted(run.glob("summary*.jsonl")) for line in p.read_text().splitlines()]
    ok = [r for r in rows if r.get("ok")]
    clear = sorted(c for r in ok for c in r["door_clear"])
    stats = {
        "homes": len(rows), "unique_homes": len({r["scene"] for r in rows}), "imported": len(ok),
        "failed": [r["scene"] for r in rows if not r.get("ok")],
        "validate_errors": sum(bool(r["errors"]) for r in ok),
        "with_missing_refs": sum(r["missing_refs"] > 0 for r in ok),
        "with_warnings": sum(r["warnings"] > 0 for r in ok),
        "seconds_median": statistics.median(r["seconds"] for r in ok) if ok else None,
        "seconds_max": max((r["seconds"] for r in ok), default=None),
        "doors": len(clear), "door_kinds": dict(Counter(k for r in ok for k in r["door_kinds"])),
        "doors_below_080": sum(c < 0.80 for c in clear), "doors_zero_clear": sum(c <= 0 for c in clear),
        "door_clear_deciles": [clear[int(len(clear) * q / 10)] for q in range(1, 10)] if clear else [],
    }
    rate = len(ok) / a.expected
    gate = {"rule": f"imported / {a.expected} >= {GATE}", "value": round(rate, 4), "passed": rate >= GATE}
    code = {p.name: runlog.sha256_file(p) for p in sorted((runlog.REPO / "src/ha/ir").glob("*.py"))}
    (run / "batch_stats.json").write_text(json.dumps({"stats": stats, "gate": gate}, indent=1))
    runlog.write_manifest(run, experiment="E1", status="COMPLETED" if gate["passed"] else "GATE_FAILED",
                          params={"scenes": a.expected, "shards": a.shards, "workers_per_shard": a.workers,
                                  "all": True},
                          inputs={"wsr_scene_root": str(Path(os.environ.get("HA_DATA", "")) /
                                                        "World-SimReady-Home/raw/full/scene"),
                                  "code_sha256": code},
                          notes=json.dumps({"gate": gate, **{k: stats[k] for k in ("imported", "doors",
                                                                                   "doors_below_080")}}))
    print(json.dumps({"stats": stats, "gate": gate}, indent=1))


if __name__ == "__main__":
    main()
