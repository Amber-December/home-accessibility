"""统计已解压的 SAGE-10k 场景：房间数、房间类型、门宽、物体数和摆放类型。

用法：python scripts/sage_layout_stats.py [--out <json>]
只读 datasets/SAGE-10k/extracted/*/layout_*.json，不读网格。
"""
import argparse
import collections
import glob
import json
import os
import statistics


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    root = os.path.join(os.environ["HA_DATA"], "SAGE-10k", "extracted")
    rows = []
    for scene_dir in sorted(glob.glob(os.path.join(root, "*"))):
        jsons = glob.glob(os.path.join(scene_dir, "layout_*.json"))
        if len(jsons) != 1:
            continue
        L = json.load(open(jsons[0]))
        doors = [d for r in L["rooms"] for d in r["doors"]]
        rows.append({
            "scene": os.path.basename(scene_dir),
            "n_rooms": len(L["rooms"]),
            "room_types": [r["room_type"] for r in L["rooms"]],
            "total_area": L["total_area"],
            "n_objects": sum(len(r["objects"]) for r in L["rooms"]),
            "n_floor_objects": sum(1 for r in L["rooms"] for o in r["objects"] if o["place_id"] in ("floor", r["id"])),
            "door_widths": [d["width"] for d in doors if not d.get("opening")],
            "opening_widths": [d["width"] for d in doors if d.get("opening")],
            "door_types": [d["door_type"] for d in doors],
            "n_meshes": len(glob.glob(os.path.join(scene_dir, "objects", "*.ply"))),
        })

    print(f"scenes={len(rows)}")
    for r in rows:
        print(f"{r['scene']}  rooms={r['n_rooms']:2d} area={r['total_area']:6.1f}  objs={r['n_objects']:3d} "
              f"floor={r['n_floor_objects']:3d}  doors={[round(w, 2) for w in r['door_widths']]} "
              f"openings={[round(w, 2) for w in r['opening_widths']]}  types={sorted(set(r['room_types']))[:4]}")
    widths = [w for r in rows for w in r["door_widths"]]
    if widths:
        print(f"door width: n={len(widths)} min={min(widths):.2f} median={statistics.median(widths):.2f} max={max(widths):.2f}")
    print("multi-room scenes:", sum(r["n_rooms"] > 1 for r in rows))
    print("room types:", collections.Counter(t for r in rows for t in r["room_types"]).most_common(20))
    if args.out:
        json.dump(rows, open(args.out, "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
