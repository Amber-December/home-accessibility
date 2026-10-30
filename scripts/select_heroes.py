"""E1 hero-home selection from an E1 batch run (reads summary*.jsonl and each scene_ir.json).

Slots (plan §3.1): H1 has no fridge (Lux3D S1 fills it), H2 has an eldersRoom, H3 has a fridge (S2 swap).
Every hero must support T1-T4: entrance door, bed, toilet, sofa; and have >= 1 door below 0.80 m clear width.
Ranking prefers clean imports, 60-120 m2, more distinct failure types, and at least one sliding door as a bonus.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

THRESH = 0.80


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
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("--top", type=int, default=5)
    a = ap.parse_args()
    run = Path(a.run)
    rows = [json.loads(line) for p in sorted(run.glob("summary*.jsonl")) for line in p.read_text().splitlines()]
    ok = [r for r in rows if r.get("ok")]
    fs = [facts(run, r) for r in ok]
    el = [f for f in fs if f["eligible"]]
    slots = {"H1_no_fridge": [f for f in el if not f["fridge"]],
             "H2_elders_room": [f for f in el if f["elders"]],
             "H3_fridge": [f for f in el if f["fridge"]]}
    out = {"run": str(run), "homes": len(rows), "imported": len(ok), "eligible": len(el),
           "stats": {"with_fridge": sum(f["fridge"] for f in fs), "with_elders_room": sum(f["elders"] for f in fs),
                     "with_sliding_door": sum(f["sliding"] for f in fs),
                     "with_narrow_door": sum(f["narrow"] > 0 for f in fs),
                     "entrance_below_080": sum((f["entrance_clear"] or 1) < THRESH for f in fs)},
           "candidates": {k: sorted(v, key=lambda f: -f["score"])[:a.top] for k, v in slots.items()}}
    (run / "hero_candidates.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(json.dumps(out["stats"]), out["imported"], "/", out["homes"], "eligible", out["eligible"])
    for k, v in out["candidates"].items():
        print(k)
        for f in v:
            print("  ", {x: f[x] for x in ("scene", "score", "area", "doors", "narrow", "min_clear", "entrance_clear",
                                           "sliding", "bathrooms", "missing", "warnings")})


if __name__ == "__main__":
    main()
