"""WSR home (USDZ + metadata JSON) -> Scene IR JSON + layered occupancy npz. See ha.ir.schema."""
from __future__ import annotations

import hashlib
import json
import re
import time
from pathlib import Path

import cv2
import numpy as np
from shapely.geometry import Polygon
from shapely.ops import unary_union

from . import occupancy as occ
from .doors import analyze_door, hull_xy
from .schema import FLOOR_KIND, SCHEMA, VERSION
from .usd_mesh import Geometry, lights, open_stage

ROOM_RE = re.compile(r"^[a-z][A-Za-z]*\d+$")
LIGHT_MAX_AREA = 25.0  # m^2; WSR has 100 x 100 m RectLight fill planes that are not real fixtures
SKIP_TYPES = {"door", "windows"}


def _r(v, nd=3):
    return [round(float(x), nd) for x in v]


def _poly_coords(g, nd=3):
    return [[round(x, nd), round(y, nd)] for x, y in g.exterior.coords]


def category_of(pid: str) -> str:
    parts = pid.split("_")
    return parts[1] if len(parts) > 1 and ROOM_RE.match(parts[0]) else parts[0]


def room_of(prim_path: str, pid: str, rooms: set[str]) -> str | None:
    seg = prim_path.split("/")
    if len(seg) > 2 and seg[2] in rooms:
        return seg[2]
    head = pid.split("_")[0]
    return head if head in rooms else None


def _xy_union(tris: np.ndarray):
    xy = tris[..., :2]
    e1, e2 = xy[:, 1] - xy[:, 0], xy[:, 2] - xy[:, 0]
    a = 0.5 * np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0])
    polys = [Polygon(t) for t in xy[a > 1e-6]]
    return unary_union(polys).buffer(0) if polys else None


def _polys(g, min_area=0.01):
    if g is None or g.is_empty:
        return []
    geoms = getattr(g, "geoms", [g])
    return [p for p in geoms if isinstance(p, Polygon) and p.area >= min_area]


def aabb_tris(aabb: dict) -> np.ndarray:
    lo, hi = np.array(aabb["min"], float), np.array(aabb["max"], float)
    c = np.array([[lo[0] if i & 1 == 0 else hi[0], lo[1] if i & 2 == 0 else hi[1], lo[2] if i & 4 == 0 else hi[2]]
                  for i in range(8)])
    faces = [(0, 1, 3), (0, 3, 2), (4, 6, 7), (4, 7, 5), (0, 4, 5), (0, 5, 1),
             (2, 3, 7), (2, 7, 6), (0, 2, 6), (0, 6, 4), (1, 5, 7), (1, 7, 3)]
    return c[np.array(faces)]


def parse_ground(name: str) -> tuple[str, str]:
    """`ground_<room>_<material>_<id>` -> (room, material)."""
    parts = name.split("_")
    return parts[1], "_".join(parts[2:-1])


def floor_kind(material: str) -> str:
    low = material.lower()
    for k, v in FLOOR_KIND.items():
        if k in low:
            return v
    return "unknown"


def import_rooms(stage, geo: Geometry):
    rooms, ground_tris = [], []
    gp = stage.GetPrimAtPath("/root/ground")
    by_room: dict[str, list] = {}
    for c in (gp.GetChildren() if gp else []):
        room, mat = parse_ground(c.GetName())
        t = geo.subtree_triangles(c)
        if len(t):
            by_room.setdefault(room, []).append((mat, t))
    for room, items in sorted(by_room.items()):
        t = np.concatenate([x[1] for x in items])
        mat = max(items, key=lambda x: len(x[1]))[0]
        g = _xy_union(t)
        ps = _polys(g)
        rooms.append({"id": room, "type": re.sub(r"\d+$", "", room), "floor_material": mat,
                      "floor_kind": floor_kind(mat), "floor_z": round(float(t[..., 2].max()), 3),
                      "area": round(float(sum(p.area for p in ps)), 2),
                      "polygons": [_poly_coords(p.simplify(0.005)) for p in ps]})
        ground_tris.append(t)
    return rooms, ground_tris


def filter_lights(recs: list[dict]):
    keep, drop = [], []
    for r in recs:
        (drop if r.get("area", 0) > LIGHT_MAX_AREA else keep).append(r)
    return keep, drop


def wall_outlines(spec: occ.GridSpec, mask: np.ndarray) -> list[list[list[float]]]:
    cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in cs:
        c = cv2.approxPolyDP(c, 0.7, True).reshape(-1, 2)
        if len(c) < 3:
            continue
        xy = np.stack([spec.x0 + (c[:, 0] + 0.5) * spec.res, spec.y0 + (c[:, 1] + 0.5) * spec.res], 1)
        out.append([_r(p) for p in xy])
    return out


def _product_tris(geo, stage, p, product_paths):
    prim = stage.GetPrimAtPath(p["prim_path"])
    if not prim or not prim.IsValid():
        return None, "prim not found"
    own = prim.GetPath()
    t = geo.subtree_triangles(prim, skip=lambda q: q.GetPath() != own and str(q.GetPath()) in product_paths)
    return t, None


def _footprint(tris):
    return hull_xy(tris[..., :2]) if len(tris) else None


def import_scene(scene_dir: Path, out_dir: Path) -> dict:
    """Write out_dir/{scene_ir.json, occupancy.npz}; returns the IR dict."""
    t0 = time.time()
    sid = scene_dir.name
    usdz, meta_path = scene_dir / f"{sid}.usdz", scene_dir / f"{sid}_metadata.json"
    meta = json.loads(meta_path.read_text())
    stage = open_stage(str(usdz))
    geo = Geometry(stage)
    warnings, missing = [], []

    rooms, ground_tris = import_rooms(stage, geo)
    room_ids = {r["id"] for r in rooms} | {c.GetName() for c in stage.GetPrimAtPath("/root").GetChildren()
                                           if ROOM_RE.match(c.GetName())}
    wall_prim = stage.GetPrimAtPath("/root/wall")
    wall_tris = geo.subtree_triangles(wall_prim) if wall_prim else np.zeros((0, 3, 3))
    if not len(wall_tris):
        warnings.append("no wall geometry")

    entities, labels = [(0, wall_tris)], ["wall"]

    def add(label, tris):
        labels.append(label)
        entities.append((len(labels) - 1, tris))
        return len(labels) - 1

    products = meta.get("products") or []
    product_paths = {p["prim_path"] for p in products if p.get("prim_path")}
    windows = []
    for p in (x for x in products if x.get("type") == "windows"):
        t, err = _product_tris(geo, stage, p, product_paths)
        aabb = p.get("world_aabb") or {}
        if (t is None or not len(t)) and aabb:
            t = aabb_tris(aabb)
        add(f"window:{p['id']}", t if t is not None else np.zeros((0, 3, 3)))
        windows.append({"id": p["id"], "rooms": [r for r in p["id"].split("_windows_")[0].split("_") if r],
                        "aabb": {"min": _r(aabb.get("min", [])), "max": _r(aabb.get("max", []))}})

    doors = []
    dp = stage.GetPrimAtPath("/root/door")
    for c in (dp.GetChildren() if dp else []):
        try:
            d = analyze_door(geo, c, keep_geometry=True)
        except Exception as e:  # keep importing; the door is reported and painted from its frame bbox later
            warnings.append(f"door {c.GetName()}: {type(e).__name__}: {e}")
            continue
        d["label"] = add(f"door:{c.GetName()}", d.pop("_tris"))
        doors.append(d)

    objects = []
    for p in products:
        # Doors are imported from /root/door above; some (the `_door_cabinet_` SKUs) come with type None.
        if p.get("type") in SKIP_TYPES or (p.get("prim_path") or "").startswith("/root/door/"):
            continue
        t, err = _product_tris(geo, stage, p, product_paths)
        aabb = p.get("world_aabb") or {}
        src = "mesh"
        if t is None or not len(t):
            missing.append({"id": p["id"], "prim_path": p.get("prim_path"), "reason": err or "no visible mesh",
                            "fallback": "aabb" if aabb else "none"})
            t, src = (aabb_tris(aabb), "aabb_fallback") if aabb else (np.zeros((0, 3, 3)), "none")
        sim = p.get("simulation") or {}
        fp = _footprint(t)
        objects.append({
            "id": p["id"], "category": category_of(p["id"]), "type": p.get("type") or "builtin",
            "room": room_of(p.get("prim_path", ""), p["id"], room_ids), "prim_path": p.get("prim_path"),
            "aabb": {"min": _r(aabb.get("min", [])), "max": _r(aabb.get("max", []))},
            "world_matrix": ((p.get("transform") or {}).get("world_matrix4x4")),
            "mass_kg": sim.get("mass_kg"), "has_collision": bool(sim.get("has_collision")),
            "joints": sim.get("joints") or [],
            "footprint": _poly_coords(fp) if fp is not None else [],
            "z_range": _r([t[..., 2].min(), t[..., 2].max()]) if len(t) else [],
            "geometry_source": src, "label": add(f"obj:{p['id']}", t)})

    # Geometry under room prims that no product claims (would otherwise be invisible to the planner).
    for c in stage.GetPrimAtPath("/root").GetChildren():
        if c.GetName() in room_ids:
            t = geo.subtree_triangles(c, skip=lambda q: str(q.GetPath()) in product_paths)
            if len(t):
                warnings.append(f"{c.GetName()}: {len(t)} triangles outside any product, painted as misc")
                add(f"misc:{c.GetName()}", t)

    allxy = [x[..., :2].reshape(-1, 2) for x in ground_tris + [wall_tris] if len(x)]
    allxy = np.concatenate(allxy)
    lo, hi = allxy.min(0), allxy.max(0)
    spec = occ.GridSpec.from_bounds(lo[0], lo[1], hi[0], hi[1])
    layers, floor_h, counts = occ.build_layers(spec, entities)
    room_grid = np.full((spec.height, spec.width), -1, np.int16)
    for i, t in enumerate(ground_tris):
        got = occ._local_fill(spec, t, np.full(len(t), 3))
        if got:
            r0, c0, m = got
            room_grid[r0:r0 + m.shape[0], c0:c0 + m.shape[1]][m > 0] = i
    out_dir.mkdir(parents=True, exist_ok=True)
    occ.save_npz(out_dir / "occupancy.npz", spec, layers, floor_h, labels, extra={"room": room_grid})
    for o in objects:
        o["layer_cells"] = counts.get(o["label"], {})
    for d in doors:
        d["layer_cells"] = counts.get(d["label"], {})

    light_recs, light_drop = filter_lights(lights(stage, geo))
    ir = {
        "schema": SCHEMA, "version": VERSION, "scene_id": sid,
        # paths relative to the WSR dataset root, so the IR carries no machine-specific path
        "source": {"usdz": f"scene/{sid}/{usdz.name}", "usdz_bytes": usdz.stat().st_size,
                   "metadata": f"scene/{sid}/{meta_path.name}",
                   "metadata_sha256": hashlib.sha256(meta_path.read_bytes()).hexdigest(),
                   "metadata_schema": f"{meta.get('schema')} {meta.get('schema_version')}"},
        "bounds": _r([lo[0], lo[1], hi[0], hi[1]]), "rooms": rooms,
        "walls": {"polygons": wall_outlines(spec, layers["body"] == 0)},
        "doors": doors, "windows": windows, "objects": objects,
        "lights": light_recs, "lights_excluded": light_drop,
        "occupancy": {"file": "occupancy.npz", "grid": spec.as_dict(), "layers": {**occ.LAYERS, "floor": occ.FLOOR_BAND},
                      "labels": len(labels), "room_index": [r["id"] for r in rooms]},
        "report": {"missing_refs": missing, "warnings": warnings,
                   "counts": {"rooms": len(rooms), "doors": len(doors), "windows": len(windows),
                              "objects": len(objects), "lights": len(light_recs), "lights_excluded": len(light_drop),
                              "triangles_wall": int(len(wall_tris)),
                              "triangles_total": int(sum(len(t) for _, t in entities))},
                   "seconds": round(time.time() - t0, 2)}}
    (out_dir / "scene_ir.json").write_text(json.dumps(ir, ensure_ascii=False))
    return ir
