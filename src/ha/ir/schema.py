"""Scene IR format (ha.scene_ir v0.1): one JSON per home plus a layered occupancy npz.

Units: metres, Z up, world frame of the source USD stage. Polygons are [[x, y], ...] in world XY.

Top-level keys
  schema, version, scene_id, source{usdz, metadata, metadata_sha256}, bounds[xmin, ymin, xmax, ymax]
  rooms[]     id, type, floor_material, floor_kind, floor_z, area, polygons[]
  walls       polygons[] (outlines of the body-band wall mask, from the occupancy grid)
  doors[]     see ha.ir.doors.analyze_door: id, rooms[], kind, opening_width, clear_width, leaves[] ...
  windows[]   id, rooms[], aabb{min, max}
  objects[]   id, category, type, room, prim_path, aabb{min, max}, world_matrix, mass_kg, has_collision,
              joints[], footprint (convex hull, all heights), z_range, layer_cells{toe, body, head},
              geometry_source ("mesh" | "aabb_fallback"), label (index into occupancy labels)
  lights[]    ha.ir.usd_mesh.lights records that passed the outlier filter; lights_excluded[] the rest
  occupancy   file, grid{x0, y0, width, height, res}, layers{name: [z0, z1]}, labels (count)
  report      missing_refs[], warnings[], counts{}, seconds
"""
from __future__ import annotations

SCHEMA = "ha.scene_ir"
VERSION = "0.1"
REQUIRED = ("schema", "version", "scene_id", "source", "bounds", "rooms", "walls", "doors", "windows",
            "objects", "lights", "occupancy", "report")
FLOOR_KIND = {"yaguangzhuan": "polished_tile", "putongcizhuan": "ceramic_tile", "fanghuazhuan": "anti_slip_tile",
              "yaguangmucai": "wood", "mudiban": "wood", "ditan": "carpet"}


def validate(ir: dict) -> list[str]:
    """Return a list of problems (empty = valid)."""
    errs = [f"missing key {k}" for k in REQUIRED if k not in ir]
    if ir.get("schema") != SCHEMA:
        errs.append(f"schema != {SCHEMA}")
    if not ir.get("rooms"):
        errs.append("no rooms")
    labels = ir.get("occupancy", {}).get("labels", 0)
    for o in ir.get("objects", []):
        if not 0 <= o.get("label", -1) < labels:
            errs.append(f"object {o.get('id')} label out of range")
    return errs
