"""Door analysis: frame opening, leaves, hinge/slide kinematics, clear width, swing sector."""
from __future__ import annotations

import itertools
import math

import cv2
import numpy as np
from pxr import Usd, UsdPhysics
from shapely.geometry import MultiPoint, Polygon
from shapely.ops import unary_union

from .doors_kin import JointChain
from .occupancy import clip_band
from .usd_mesh import Geometry

MID_BAND = (0.8, 1.2)       # height band used to find the frame opening
OPEN_CAP_DEG = 90.0         # hinged leaves are evaluated at most 90 deg open
BODY_BAND = (0.1, 0.7)      # leaf thickness and clear width are measured on the leaf below its handle


def _intervals_union(iv: np.ndarray) -> list[list[float]]:
    if len(iv) == 0:
        return []
    iv = iv[np.argsort(iv[:, 0])]
    out = [list(iv[0])]
    for a, b in iv[1:]:
        if a <= out[-1][1] + 1e-4:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def _project_extent(P, n, origin, u):
    valid = np.arange(P.shape[1])[None, :] < n[:, None]
    s = (P[..., :2] - origin) @ u
    return np.stack([np.where(valid, s, np.inf).min(1), np.where(valid, s, -np.inf).max(1)], 1)


def hull_xy(xy: np.ndarray):
    """Convex hull of XY points as a shapely Polygon (cv2 hull: ~50x faster than shapely on 1e5 points)."""
    pts = np.ascontiguousarray(xy.reshape(-1, 2), np.float32)
    hull = cv2.convexHull(pts).reshape(-1, 2).astype(float) if len(pts) >= 3 else pts.astype(float)
    if len(hull) >= 3:
        poly = Polygon(hull)
        if poly.area > 1e-8:
            return poly
    return MultiPoint(hull).convex_hull.buffer(0.01)


def _joint_of(prim: Usd.Prim):
    for c in prim.GetChildren():
        if c.IsA(UsdPhysics.RevoluteJoint) or c.IsA(UsdPhysics.PrismaticJoint):
            return c
    return None


def _chain(geo: Geometry, lf: Usd.Prim, j: Usd.Prim, revolute: bool) -> JointChain:
    api = UsdPhysics.Joint(j)
    b0, b1 = api.GetBody0Rel().GetTargets(), api.GetBody1Rel().GetTargets()
    w0 = geo.world(geo.stage.GetPrimAtPath(b0[0])) if b0 else np.eye(4)
    w1 = geo.world(geo.stage.GetPrimAtPath(b1[0])) if b1 else geo.world(lf)
    axis = str((UsdPhysics.RevoluteJoint(j) if revolute else UsdPhysics.PrismaticJoint(j)).GetAxisAttr().Get() or "Z")
    vec = lambda a: np.array(a.Get() or (0, 0, 0), float)  # noqa: E731
    return JointChain(revolute=revolute, axis=axis, lp0=vec(api.GetLocalPos0Attr()), lr0=api.GetLocalRot0Attr().Get(),
                      lp1=vec(api.GetLocalPos1Attr()), lr1=api.GetLocalRot1Attr().Get(), b0_world=w0, b1_world=w1,
                      leaf_is_body1=not b1 or b1[0] == lf.GetPath())


def _poly(g):
    return [[round(x, 3), round(y, 3)] for x, y in g.exterior.coords]


def _body_xy(tris: np.ndarray) -> np.ndarray:
    """XY points of the leaf inside BODY_BAND (below lever handles baked into some leaf meshes)."""
    P, n = clip_band(tris, *BODY_BAND)
    if len(P) == 0:
        return tris[..., :2].reshape(-1, 2)
    return P[..., :2][np.arange(P.shape[1])[None, :] < n[:, None]]


def analyze_door(geo: Geometry, door_prim: Usd.Prim, keep_geometry: bool = False) -> dict:
    """keep_geometry adds out["_tris"]: frame plus leaves (open ones in their open pose), world triangles."""
    kids = [c for c in door_prim.GetChildren() if c.GetTypeName() == "Xform"]
    leaves = [c for c in kids if "handle" not in c.GetName().lower() and _joint_of(c)]
    frames = [c for c in kids if "handle" not in c.GetName().lower() and c not in leaves]
    frame_tris = np.concatenate([geo.subtree_triangles(f) for f in frames]) if frames else np.zeros((0, 3, 3))
    out = {"leaves": [], "notes": []}
    leaf_data, leaf_tris = [], []
    no_handle = lambda q: "handle" in q.GetName().lower()  # noqa: E731
    for lf in leaves:
        lw = geo.world(lf)
        world = geo.subtree_triangles(lf, skip=no_handle)
        if len(world) == 0:
            continue
        # Width/thickness axes: the leaf's local axes that point horizontally in the world (a local frame may
        # carry the leaf height in X or Y), measured on world XY so prim scale and mirroring drop out.
        dirs = lw[:3, :3] / np.linalg.norm(lw[:3, :3], axis=1, keepdims=True)
        horiz = sorted(range(3), key=lambda k: abs(dirs[k, 2]))[:2]
        wxy = world[..., :2].reshape(-1, 2)
        bxy = _body_xy(world)
        axes = [dirs[k, :2] / np.linalg.norm(dirs[k, :2]) for k in horiz]
        spans = [float(np.ptp(wxy @ a)) for a in axes]
        wa = int(np.argmax(spans))
        u = axes[wa]
        ext = {0: spans[wa], 1: float(np.ptp(bxy @ axes[1 - wa]))}
        j = _joint_of(lf)
        revolute = j.IsA(UsdPhysics.RevoluteJoint)
        jt = "hinged" if revolute else "sliding"
        api = UsdPhysics.RevoluteJoint(j) if revolute else UsdPhysics.PrismaticJoint(j)
        lo, hi = float(api.GetLowerLimitAttr().Get() or 0), float(api.GetUpperLimitAttr().Get() or 0)
        open_v = lo if abs(lo) >= abs(hi) else hi
        ch = _chain(geo, lf, j, revolute)
        err = ch.rest_error(world)
        if err > 0.01:
            out["notes"].append(f"{lf.GetName()}: joint frames disagree at rest by {err:.3f} m")
        rec = {"id": lf.GetName(), "kind": jt, "width": round(ext[0], 3), "thickness": round(ext[1], 3),
               "limits": [lo, hi]}
        if ext[0] > 1.3 or ext[1] > 0.12:
            out["notes"].append(f"{lf.GetName()}: unusual leaf size {ext[0]:.3f} x {ext[1]:.3f} m")
        if revolute:
            q = math.radians(max(-OPEN_CAP_DEG, min(OPEN_CAP_DEG, open_v)))
            open_xy = ch.apply(world, q)[..., :2]
            sweep = unary_union([hull_xy(ch.apply(world, q * k / 9)[..., :2]) for k in range(10)]).convex_hull
            rec.update(pivot=[round(float(v), 3) for v in ch.pivot_world()[:2]], open_angle_deg=round(math.degrees(q), 1),
                       sweep=_poly(sweep))
        else:
            open_xy = ch.apply(world, open_v)[..., :2]
            ax = ch.axis_world()
            rec.update(slide_axis=[round(float(v), 4) for v in ax[:2]], travel=round(open_v, 3))
        rec["closed"] = _poly(hull_xy(world[..., :2]))
        rec["open"] = _poly(hull_xy(open_xy))
        out["leaves"].append(rec)
        open_pose = ch.apply(world, q if revolute else open_v)
        leaf_data.append((u, _body_xy(open_pose), _body_xy(world)))
        leaf_tris.append((world, open_pose))
    out = _clear_width(out, frame_tris, leaf_data, door_prim)
    if keep_geometry:
        # Occupancy view of the door in its widest usable state; handles are left out on purpose.
        opened = set(out.get("open_leaves", []))
        parts = [frame_tris] + [o if rec["id"] in opened else c for rec, (c, o) in zip(out["leaves"], leaf_tris)]
        parts = [p for p in parts if len(p)]
        out["_tris"] = np.concatenate(parts) if parts else np.zeros((0, 3, 3))
    return out


def door_rooms(name: str) -> list[str]:
    """`livingRoom1_kitchen1_door_<sku>_yflibNNN` -> ['livingRoom1', 'kitchen1']; entrance doors have one room."""
    head = name.split("_door_")[0] if "_door_" in name else name
    return [r for r in head.split("_") if r]


def _subtract(seg, cuts):
    free = [list(seg)]
    for a, b in cuts:
        nxt = []
        for x, y in free:
            if b <= x or a >= y:
                nxt.append([x, y])
                continue
            if a > x:
                nxt.append([x, a])
            if b < y:
                nxt.append([b, y])
        free = nxt
    return free


def _span(xy, origin, u):
    s = (xy.reshape(-1, 2) - origin) @ u
    return [float(s.min()), float(s.max())]


def _clear_width(out, frame_tris, leaf_data, door_prim):
    """Opening = frame gap at mid height (0.8-1.2 m) that overlaps the closed leaves.
    Clear width = widest part of the opening not covered by the open leaves (projected on the door axis),
    i.e. hinged leaves at min(limit, 90 deg) eat their thickness, sliding leaves whatever stays in the gap."""
    name = door_prim.GetName()
    out.update(id=name, prim_path=str(door_prim.GetPath()), rooms=door_rooms(name))
    kinds = sorted({lf["kind"] for lf in out["leaves"]})
    out["kind"] = "opening" if not kinds else (kinds[0] if len(kinds) == 1 else "mixed")
    fxy = frame_tris[..., :2].reshape(-1, 2)
    if leaf_data:
        u = leaf_data[0][0]
        ref = np.concatenate([w[..., :2].reshape(-1, 2) for _, _, w in leaf_data])
    elif len(fxy):
        ref = fxy
        u = np.linalg.svd(fxy - fxy.mean(0), full_matrices=False)[2][0]
    else:
        out["notes"].append("no geometry")
        return out
    origin = (fxy if len(fxy) else ref).mean(0)
    nrm = np.array([-u[1], u[0]])
    gaps = []
    if len(frame_tris):
        P, n = clip_band(frame_tris, *MID_BAND)
        if len(P):
            iv = _intervals_union(_project_extent(P, n, origin, u))
            gaps = [[iv[i][1], iv[i + 1][0]] for i in range(len(iv) - 1)]
    leaf_iv = _intervals_union(np.array([_span(w[..., :2], origin, u) for _, _, w in leaf_data])) if leaf_data else []
    if leaf_iv:
        L = [leaf_iv[0][0], leaf_iv[-1][1]]
        ov = [max(0.0, min(b, L[1]) - max(a, L[0])) for a, b in gaps]
        if gaps and max(ov) > 0.05:
            opening = gaps[int(np.argmax(ov))]
        else:
            opening = L
            out["notes"].append("frame gap not found; opening = closed leaf span")
    elif gaps:
        opening = max(gaps, key=lambda g: g[1] - g[0])
    else:
        out["notes"].append("no frame gap and no leaves")
        return out
    # Try every open/closed combination: bypass sliding doors only clear one leaf width at a time,
    # double hinged doors clear most with both leaves open.
    closed_iv = [_span(w[..., :2], origin, u) for _, _, w in leaf_data]
    open_iv = [_span(oxy, origin, u) for _, oxy, _ in leaf_data]
    best, best_open = [opening[0], opening[0]], []
    for mask in itertools.product((False, True), repeat=len(leaf_data)):
        free = _subtract(opening, [o if m else c for m, o, c in zip(mask, open_iv, closed_iv)])
        g = max(free, key=lambda s: s[1] - s[0]) if free else [opening[0], opening[0]]
        if g[1] - g[0] > best[1] - best[0] + 1e-6:
            best, best_open = g, [out["leaves"][i]["id"] for i, m in enumerate(mask) if m]
    out["open_leaves"] = best_open
    depth = _span(fxy if len(fxy) else ref, origin, nrm)

    def pt(s):
        return [round(float(v), 3) for v in origin + u * s]

    out.update(axis=[round(float(v), 4) for v in u], normal=[round(float(v), 4) for v in nrm],
               center=pt(0.5 * (opening[0] + opening[1])), depth=round(depth[1] - depth[0], 3),
               opening_width=round(opening[1] - opening[0], 3), opening_segment=[pt(opening[0]), pt(opening[1])],
               clear_width=round(best[1] - best[0], 3), clear_segment=[pt(best[0]), pt(best[1])])
    return out
