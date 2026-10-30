"""Read world-space triangles, transforms and lights from a WSR USD stage."""
from __future__ import annotations

import math

import numpy as np
from pxr import Gf, Usd, UsdGeom, UsdLux

LIGHT_TYPES = ("RectLight", "SphereLight", "DiskLight", "CylinderLight")


def open_stage(path: str) -> Usd.Stage:
    stage = Usd.Stage.Open(path)
    if stage is None:
        raise RuntimeError(f"cannot open {path}")
    return stage


def mat_np(m: Gf.Matrix4d) -> np.ndarray:
    """USD matrices use row vectors: p_world = [p, 1] @ M."""
    return np.array(m, dtype=np.float64).reshape(4, 4)


class Geometry:
    """Caches world transforms; returns triangles as (N, 3, 3) float64 arrays."""

    def __init__(self, stage: Usd.Stage):
        self.stage = stage
        self.xf = UsdGeom.XformCache(Usd.TimeCode.Default())

    def world(self, prim: Usd.Prim) -> np.ndarray:
        return mat_np(self.xf.GetLocalToWorldTransform(prim))

    def mesh_triangles(self, mesh_prim: Usd.Prim, to_frame: np.ndarray | None = None) -> np.ndarray:
        mesh = UsdGeom.Mesh(mesh_prim)
        pts = mesh.GetPointsAttr().Get()
        counts = mesh.GetFaceVertexCountsAttr().Get()
        idx = mesh.GetFaceVertexIndicesAttr().Get()
        if not pts or not counts or not idx:
            return np.zeros((0, 3, 3))
        pts = np.asarray(pts, dtype=np.float64)
        counts = np.asarray(counts, dtype=np.int64)
        idx = np.asarray(idx, dtype=np.int64)
        m = self.world(mesh_prim)
        if to_frame is not None:  # express in another prim's local frame
            m = m @ np.linalg.inv(to_frame)
        pts = pts @ m[:3, :3] + m[3, :3]
        starts = np.concatenate([[0], np.cumsum(counts)[:-1]])
        tris = []
        for k in range(3, int(counts.max()) + 1):  # fan triangulation, grouped by polygon size
            sel = starts[counts == k]
            if sel.size == 0:
                continue
            for j in range(1, k - 1):
                tris.append(np.stack([idx[sel], idx[sel + j], idx[sel + j + 1]], axis=1))
        if not tris:
            return np.zeros((0, 3, 3))
        return pts[np.concatenate(tris)]

    def subtree_triangles(self, prim: Usd.Prim, skip=None, to_frame: np.ndarray | None = None) -> np.ndarray:
        out = []
        it = iter(Usd.PrimRange(prim))
        for p in it:
            if skip and skip(p):
                it.PruneChildren()
                continue
            if p.IsA(UsdGeom.Mesh):
                img = UsdGeom.Imageable(p).ComputeVisibility()
                if img != UsdGeom.Tokens.invisible:
                    out.append(self.mesh_triangles(p, to_frame))
        out = [t for t in out if len(t)]
        return np.concatenate(out) if out else np.zeros((0, 3, 3))


def lights(stage: Usd.Stage, geo: Geometry) -> list[dict]:
    out = []
    for p in stage.Traverse():
        t = p.GetTypeName()
        if t not in LIGHT_TYPES:
            continue
        m = geo.world(p)
        api = UsdLux.LightAPI(p)
        rec = {"id": p.GetName(), "kind": t, "pos": [round(float(v), 4) for v in m[3, :3]],
               "dir": [round(float(v), 4) for v in -m[2, :3] / (np.linalg.norm(m[2, :3]) or 1)],
               "intensity": float(api.GetIntensityAttr().Get() or 0.0),
               "exposure": float(api.GetExposureAttr().Get() or 0.0),
               "color": [round(float(c), 4) for c in (api.GetColorAttr().Get() or (1, 1, 1))]}
        if t == "RectLight":
            r = UsdLux.RectLight(p)
            rec["size"] = [float(r.GetWidthAttr().Get() or 0), float(r.GetHeightAttr().Get() or 0)]
            rec["area"] = rec["size"][0] * rec["size"][1]
        elif t in ("SphereLight", "DiskLight"):
            rad = float((UsdLux.SphereLight(p) if t == "SphereLight" else UsdLux.DiskLight(p)).GetRadiusAttr().Get() or 0)
            rec["radius"] = rad
            rec["area"] = (4 if t == "SphereLight" else 1) * math.pi * rad * rad
        out.append(rec)
    return out
