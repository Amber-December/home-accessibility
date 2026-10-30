"""CP1 door check for the hero homes: an independent raster measurement plus a crop image per door.

The importer (ha.ir.doors) measures widths analytically by projecting frame and leaf geometry onto the
door axis. Here the same USD meshes (walls included) are sliced at three heights, rasterized at 5 mm in
the door's own (u, n) frame, and the straight-through free strip that contains the door centre is
intersected over all rows |n| <= ROW_SPAN. Closed state = walls + frame; open state = walls + frame +
leaves the importer chose to open. Gate (plan E1): |raster - importer| <= 0.03 m.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np

from ha import runlog
from ha.ir.doors import _joint_of, analyze_door
from ha.ir.occupancy import clip_band, rasterize
from ha.ir.usd_mesh import Geometry, open_stage

RES = 0.005
U_SPAN, ROW_SPAN, NEAR = 1.4, 0.6, 1.8
BANDS = [(0.30, 0.35), (0.90, 0.95), (1.50, 1.55)]
GATE = 0.03
HEROES = ["scene000064", "scene000021", "scene000104"]


def local(P, origin, u, nrm):
    d = P[..., :2] - origin
    return np.stack([d @ u, d @ nrm], -1)


def raster(tris, origin, u, nrm, band):
    W, H = int(2 * U_SPAN / RES), int(2 * ROW_SPAN / RES)
    m = np.zeros((H, W), np.uint8)
    P, n = clip_band(tris, *band)
    if len(P):
        q = local(P, origin, u, nrm)
        px = np.stack([(q[..., 0] + U_SPAN) / RES - 0.5, (q[..., 1] + ROW_SPAN) / RES - 0.5], -1)
        rasterize(m, px, n, 1)
    return m


def strip(mask):
    """Free columns shared by every row, then the run that contains (or is nearest to) the centre column."""
    free = ~(mask.astype(bool).any(0))
    c = mask.shape[1] // 2
    runs, k = [], 0
    while k < len(free):
        if free[k]:
            j = k
            while j < len(free) and free[j]:
                j += 1
            runs.append((k, j))
            k = j
        else:
            k += 1
    if not runs:
        return 0.0, None, False
    a, b = min(runs, key=lambda r: 0 if r[0] <= c < r[1] else min(abs(r[0] - c), abs(r[1] - c)))
    return (b - a) * RES, ((a + 0.5) * RES - U_SPAN, (b - 0.5) * RES - U_SPAN), a <= c < b


def crop_png(path, closed, opened, seg, title):
    img = np.full(closed.shape + (3,), 255, np.uint8)
    img[closed > 0] = (90, 90, 90)
    img[(opened > 0) & (closed == 0)] = (0, 140, 255)
    img = img[::-1].copy()  # +n up
    h, w = closed.shape
    if seg:
        y = h // 2
        x0, x1 = [int((s + U_SPAN) / RES) for s in seg]
        cv2.line(img, (x0, y), (x1, y), (0, 170, 0), 3)
    cv2.putText(img, title, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 200), 1, cv2.LINE_AA)
    cv2.imwrite(str(path), cv2.resize(img, (w // 2, h // 2), interpolation=cv2.INTER_AREA))


def check_scene(scene, ir_dir, out_dir):
    root = Path(os.environ["HA_DATA"]) / "World-SimReady-Home/raw/full/scene" / scene
    st = open_stage(str(root / f"{scene}.usdz"))
    g = Geometry(st)
    wall = g.subtree_triangles(st.GetPrimAtPath("/root/wall"))
    ir = json.loads((ir_dir / scene / "scene_ir.json").read_text())
    rows = []
    for d in ir["doors"]:
        prim = st.GetPrimAtPath(d["prim_path"])
        r = analyze_door(g, prim, keep_geometry=True)
        kids = [c for c in prim.GetChildren() if c.GetTypeName() == "Xform" and "handle" not in c.GetName().lower()]
        frame = [c for c in kids if not _joint_of(c)]
        ftris = np.concatenate([g.subtree_triangles(f) for f in frame]) if frame else np.zeros((0, 3, 3))
        origin, u, nrm = np.array(d["center"]), np.array(d["axis"]), np.array(d["normal"])
        near = wall[np.linalg.norm(wall[..., :2].mean(1) - origin, axis=1) < NEAR]
        closed_t = np.concatenate([near, ftris])
        open_t = np.concatenate([near, r["_tris"]])
        rec = {"door": d["id"], "kind": d["kind"], "importer_opening": d.get("opening_width"),
               "importer_clear": d.get("clear_width"), "bands": {}}
        for band in BANDS:
            mc, mo = raster(closed_t, origin, u, nrm, band), raster(open_t, origin, u, nrm, band)
            wc, _, inc = strip(mc)
            wo, seg, ino = strip(mo)
            rec["bands"][f"{band[0]:.2f}"] = {"opening": round(wc, 3), "clear": round(wo, 3),
                                             "centre_free": bool(inc and ino)}
            if band == BANDS[1]:
                crop_png(out_dir / f"{scene}__{d['id'][:40]}.png", mc, mo, seg,
                         f"{d['id'][:38]} imp {d.get('clear_width')} ras {wo:.3f}")
        body = [rec["bands"][k] for k in ("0.30", "0.90")]
        rec["raster_opening"] = min(b["opening"] for b in body)
        rec["raster_clear"] = min(b["clear"] for b in body)
        rec["diff_clear"] = round(rec["raster_clear"] - (d.get("clear_width") or 0), 3)
        # Bypass sliding doors leave one leaf over the opening centre, so centre_free is only required of hinged doors.
        rec["pass"] = abs(rec["diff_clear"]) <= GATE and (d["kind"] != "hinged" or all(b["centre_free"] for b in body))
        rows.append(rec)
        print(scene, d["id"][:44], d["kind"], "imp", d.get("clear_width"), "ras", rec["raster_clear"],
              "diff", rec["diff_clear"], "PASS" if rec["pass"] else "CHECK", flush=True)
    return rows


def main(ir_run):
    ir_dir = Path(os.environ["HA_OUTPUTS"]) / "runs/E1" / ir_run / "scenes"
    params = {"ir_run": ir_run, "res": RES, "bands": BANDS, "gate": GATE, "row_span": ROW_SPAN}
    run_dir = runlog.new_run("E1", tag="cp1-doors")
    out_dir = run_dir / "doors"
    out_dir.mkdir(parents=True, exist_ok=True)
    res = {s: check_scene(s, ir_dir, out_dir) for s in HEROES}
    n = sum(len(v) for v in res.values())
    ok = sum(r["pass"] for v in res.values() for r in v)
    (run_dir / "door_check.json").write_text(json.dumps({"doors": n, "pass": ok, "scenes": res}, indent=1))
    runlog.write_manifest(run_dir, experiment="E1", params=params, notes=f"CP1 door check: {ok}/{n} pass")
    print("doors", n, "pass", ok, "->", run_dir)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "20261030-075249-all-v3")
