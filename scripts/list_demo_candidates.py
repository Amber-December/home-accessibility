"""List demo-home candidates by criteria (plans/hackathon-plan.md §10 #2).

Reads an E1 import run (summary*.jsonl and each scene_ir.json). A candidate must support T1-T4: an entrance
door, a bed, a toilet and a sofa, plus at least one door below 0.80 m clear width. Each row also reports
fridge, eldersRoom and sliding-door flags so the team can filter for the demo storylines. Ranking prefers
clean imports, 60-120 m2, a narrow entrance, more narrow doors, and at least one sliding door as a bonus.
Writes demo_candidates.json into the run directory.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

THRESH = 0.80
SHOW = ("scene", "score", "area", "doors", "narrow", "min_clear", "entrance_clear", "fridge", "elders",
        "sliding", "bathrooms", "missing", "warnings")


def facts(run: Path, r: dict) -> dict | None:
    ir = json.loads((run / "scenes" / r["scene"] / "scene_ir.json").read_text())
    cats = {o["category"].lower() for o in ir["objects"]}
    doors = ir["doors"]
    entrance = [d for d in doors if len(d.get("rooms", [])) == 1]
    narrow = [d for d in doors if (d.get("clear_width") or 0) < THRESH]
    rooms = [x["type"] for x in ir["rooms"]]
    f = {"scene": r["scene"], "area": r["area"], "rooms": len(rooms), "doors": len(doors), "narrow": len(narrow),
         "min_clear": min((d.get("clear_width") or 0 for d in doors), default=None),
         "entrance_clear": entrance[0].get("clear_width") if entrance else None,
         "fridge": "refrigerator" in cats, "elders": "eldersRoom" in rooms,
         "bed": bool(cats & {"bed", "bedframe"}), "toilet": "toilet" in cats,
         "sofa": bool(cats & {"sofa", "lshapedsofa"}), "sliding": any(d["kind"] == "sliding" for d in doors),
         "bathrooms": rooms.count("bathroom"), "missing": r["missing_refs"], "warnings": r["warnings"],
         "preview": str(run / "scenes" / r["scene"] / "preview.png")}
    f["eligible"] = bool(entrance and f["bed"] and f["toilet"] and f["sofa"] and narrow)
    f["score"] = round((2 if f["missing"] == 0 else 0) + (1 if f["warnings"] == 0 else 0)
                       + (2 if 60 <= f["area"] <= 120 else 0) + (1 if f["sliding"] else 0)
                       + (1 if (f["entrance_clear"] or 1) < THRESH else 0) + min(f["narrow"], 3) * 0.5, 2)
    return f


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("run", help="E1 import run directory")
    ap.add_argument("--top", type=int, default=15)
    ap.add_argument("--fridge", choices=["yes", "no"], help="keep only homes with / without a refrigerator")
    ap.add_argument("--elders", action="store_true", help="keep only homes with an eldersRoom")
    ap.add_argument("--sliding", action="store_true", help="keep only homes with a sliding door")
    a = ap.parse_args()
    run = Path(a.run)
    rows = [json.loads(line) for p in sorted(run.glob("summary*.jsonl")) for line in p.read_text().splitlines()]
    ok = [r for r in rows if r.get("ok")]
    fs = [facts(run, r) for r in ok]
    el = [f for f in fs if f["eligible"]]
    if a.fridge:
        el = [f for f in el if f["fridge"] == (a.fridge == "yes")]
    if a.elders:
        el = [f for f in el if f["elders"]]
    if a.sliding:
        el = [f for f in el if f["sliding"]]
    filters = {"fridge": a.fridge, "elders": a.elders, "sliding": a.sliding}
    out = {"run": str(run), "homes": len(rows), "imported": len(ok), "eligible": len(el), "filters": filters,
           "stats": {"with_fridge": sum(f["fridge"] for f in fs), "with_elders_room": sum(f["elders"] for f in fs),
                     "with_sliding_door": sum(f["sliding"] for f in fs),
                     "with_narrow_door": sum(f["narrow"] > 0 for f in fs),
                     "entrance_below_080": sum((f["entrance_clear"] or 1) < THRESH for f in fs)},
           "candidates": sorted(el, key=lambda f: -f["score"])[:a.top]}
    (run / "demo_candidates.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(json.dumps(out["stats"]), out["imported"], "/", out["homes"], "eligible", out["eligible"])
    for f in out["candidates"]:
        print("  ", {x: f[x] for x in SHOW})


if __name__ == "__main__":
    main()
