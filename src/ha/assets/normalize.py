"""Local post-processing of a generated mesh (simulation §5 steps 5 and 7). No network, no credits.

Conventions: the asset library works in Z-up metres (same as Scene IR, USD and MuJoCo). GLB files are written in
glTF's Y-up convention so three.js loads them as-is. Width W runs along +x, depth D along +y, height H along +z;
the origin is the footprint centre on the floor.

QA gate (frozen): fit per-axis scales s = nominal / extent; reject when max(s) / min(s) - 1 > 0.15, i.e. the
generated shape's proportions disagree with the product's published W x D x H by more than 15%. Yaw 0 and 90
degrees are both tried because the generator does not tell us which horizontal axis is the width.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import trimesh

QA_TOL = 0.15
Y_UP_TO_Z_UP = trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0])
Z_UP_TO_Y_UP = np.linalg.inv(Y_UP_TO_Z_UP)


def load_scene(path: str | Path) -> trimesh.Scene:
    return trimesh.load(str(path), force="scene")


def _bounds(vertices: np.ndarray, M: np.ndarray) -> np.ndarray:
    v = trimesh.transform_points(vertices, M)
    return np.stack([v.min(0), v.max(0)])


def fit(scene: trimesh.Scene, nominal_m, up: str = "y") -> tuple[np.ndarray, dict]:
    """Return the 4x4 transform (source frame -> normalized Z-up frame) and the QA record."""
    nominal = np.asarray(nominal_m, dtype=float)
    verts = scene.to_mesh().vertices
    base = Y_UP_TO_Z_UP if up == "y" else np.eye(4)
    best = None
    for yaw in (0, 90):
        R = trimesh.transformations.rotation_matrix(math.radians(yaw), [0, 0, 1]) @ base
        b = _bounds(verts, R)
        ext = b[1] - b[0]
        if np.any(ext <= 1e-9):
            continue
        s = nominal / ext
        spread = float(s.max() / s.min() - 1)
        if best is None or spread < best[0]:
            best = (spread, yaw, R, b, ext, s)
    if best is None:
        raise ValueError("degenerate mesh: zero extent on some axis")
    spread, yaw, R, b, ext, s = best
    centre = np.array([(b[0, 0] + b[1, 0]) / 2, (b[0, 1] + b[1, 1]) / 2, b[0, 2]])
    T = trimesh.transformations.translation_matrix(-centre)
    S = np.diag([*s, 1.0])
    rec = {"up_in": up, "yaw_deg": yaw, "raw_extent": [round(float(x), 4) for x in ext],
           "nominal_m": nominal.tolist(), "scale": [round(float(x), 4) for x in s],
           "uniform_equiv": round(float(np.cbrt(np.prod(s))), 4), "spread": round(spread, 4),
           "qa_tol": QA_TOL, "qa_pass": spread <= QA_TOL}
    return S @ T @ R, rec


def convex_hulls(mesh: trimesh.Trimesh, threshold: float = 0.08, max_hulls: int = 32) -> list[trimesh.Trimesh]:
    import coacd

    parts = coacd.run_coacd(coacd.Mesh(mesh.vertices, mesh.faces), threshold=threshold,
                            max_convex_hull=max_hulls, seed=0)
    return [trimesh.Trimesh(v, f) for v, f in parts]


def process(src: str | Path, nominal_m, out_dir: str | Path, up: str = "y", decompose: bool = True,
            coacd_threshold: float = 0.08) -> dict:
    """Normalize src into out_dir/{normalized.glb, collision/hull_###.obj, qa.json}; return the QA record.

    Outputs are written even when QA fails so the failure can be inspected; callers must check qa_pass.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    scene = load_scene(src)
    M, rec = fit(scene, nominal_m, up)
    scene.apply_transform(M)
    b = scene.bounds
    rec["bounds_after"] = [[round(float(x), 4) for x in r] for r in b]
    mesh = scene.to_mesh()
    rec["faces"] = int(len(mesh.faces))
    rec["watertight"] = bool(mesh.is_watertight)
    gl = scene.copy()
    gl.apply_transform(Z_UP_TO_Y_UP)
    gl.export(str(out / "normalized.glb"), file_type="glb")
    if decompose:
        col = out / "collision"
        col.mkdir(exist_ok=True)
        hulls = convex_hulls(mesh, coacd_threshold)
        for k, h in enumerate(hulls):
            h.export(str(col / f"hull_{k:03d}.obj"))
        rec["hulls"] = len(hulls)
        rec["coacd_threshold"] = coacd_threshold
    rec["src"] = str(src)
    (out / "qa.json").write_text(json.dumps(rec, indent=1))
    return rec
