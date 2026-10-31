"""Export a WSR home as a light GLB for the web viewer (plan V0). Display only; never used for scoring.

One glTF node per Scene IR object or door (node name = IR id) so the viewer can highlight the object a
violation points to; walls, ground and windows get their own nodes, and meshes under no IR entity go to
"other:<top-level prim>". Materials keep the bound diffuse texture (UsdPreviewSurface diffuseColor or OmniPBR
diffuse_texture) with the mesh UVs, downscaled to TEX_PX and stored as JPEG; otherwise the constant colour,
else a per-kind fallback. GeomSubset bindings give one material per subset. Meshes are reduced by vertex
clustering on a GRID metre lattice, doubled (up to MAX_GRID) for a mesh above MAX_TRIS; UV seams are kept. Written in glTF Y-up (Scene IR is Z-up); a sidecar
<name>.nodes.json lists the nodes.

  python -m ha.ir.export_glb scene000064 --ir-run <run_id> [--grid 0.01] [--tex-px 512] [--max-tris 30000] [--ceiling]
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image
from pxr import Usd, UsdGeom, UsdShade

from ha import runlog
from ha.ir.usd_mesh import Geometry, open_stage

SKIP_TOP = {"_materials", "lights", "Cam1", "env_light"}
FALLBACK = {"wall": (0.86, 0.85, 0.82), "ground": (0.62, 0.52, 0.42), "ceiling": (0.95, 0.95, 0.95),
            "windows": (0.65, 0.80, 0.90), "door": (0.55, 0.40, 0.28), "object": (0.70, 0.70, 0.70),
            "other": (0.75, 0.75, 0.75)}  # display (sRGB) values
Z_UP_TO_Y_UP = trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])
UV_Q = 4096  # UV quantum when welding corners after clustering
MAX_GRID = 0.02  # coarsest lattice used to meet the per-mesh triangle budget
MIN_ALPHA = 0.2  # WSR glass is often authored fully transparent; keep it faintly visible


def srgb_to_linear(c):
    c = np.clip(np.asarray(c, np.float64), 0, 1)
    return tuple(float(x) for x in np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4))


@dataclass(frozen=True)
class Look:
    rgb: tuple  # linear base colour factor
    tex: str | None = None  # resolved texture path
    uv: tuple = (1.0, 1.0, 0.0, 0.0, 0.0)  # sx, sy, rotate (deg), tx, ty: st' = R(st * s) + t
    alpha: float = 1.0
    rough: float = 0.8
    metal: float = 0.0


def _val(sh, name):
    i = sh.GetInput(name)
    return None if not i or i.HasConnectedSource() else i.Get()


class Looks:
    def __init__(self, tex_px: int = 512):
        self.tex_px = tex_px
        self.mats: dict = {}
        self.images: dict[str, Image.Image | None] = {}

    def image(self, asset) -> str | None:
        """Resolved path of a readable texture (loaded and downscaled once), else None."""
        path = getattr(asset, "resolvedPath", "") or ""
        if not path:
            return None
        if path not in self.images:
            im = None
            try:
                if "[" in path:  # inside the usdz: /a/b.usdz[inner/path.jpg]
                    outer, inner = path[:-1].split("[", 1)
                    with zipfile.ZipFile(outer) as z:
                        data = z.read(inner)
                else:
                    data = Path(path).read_bytes()
                im = Image.open(io.BytesIO(data)).convert("RGB")
                im.thumbnail((self.tex_px, self.tex_px), Image.Resampling.LANCZOS)
                im.format = "JPEG"  # trimesh keeps JPEG instead of re-encoding as PNG
            except (KeyError, OSError, ValueError, zipfile.BadZipFile):
                im = None
            self.images[path] = im
        return path if self.images[path] is not None else None

    def mean(self, path: str) -> tuple:
        return srgb_to_linear(np.asarray(self.images[path].resize((32, 32))).reshape(-1, 3).mean(0) / 255)

    @staticmethod
    def bound(prim):
        """ComputeBoundMaterial, or the raw material:binding rel (WSR often omits MaterialBindingAPI)."""
        mat, _ = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()
        if mat:
            return mat
        while prim and prim.GetPath().pathElementCount:
            rel = prim.GetRelationship("material:binding")
            if rel and rel.GetTargets():
                m = UsdShade.Material(prim.GetStage().GetPrimAtPath(rel.GetTargets()[0]))
                if m:
                    return m
            prim = prim.GetParent()
        return None

    def of(self, prim) -> Look | None:
        mat = self.bound(prim)
        if not mat:
            return None
        key = mat.GetPath()
        if key not in self.mats:
            self.mats[key] = self._read(mat)
        return self.mats[key]

    @staticmethod
    def _transform2d(tex) -> tuple:
        st = tex.GetInput("st")
        for a in (st.GetValueProducingAttributes() if st and st.HasConnectedSource() else []):
            t = UsdShade.Shader(a.GetPrim())
            if t and t.GetIdAttr().Get() == "UsdTransform2d":
                s, r, tr = _val(t, "scale"), _val(t, "rotation"), _val(t, "translation")
                s, tr = s if s is not None else (1, 1), tr if tr is not None else (0, 0)
                return float(s[0]), float(s[1]), float(r or 0), float(tr[0]), float(tr[1])
        return Look.uv

    def _read(self, mat) -> Look | None:
        for c in Usd.PrimRange(mat.GetPrim()):
            sh = UsdShade.Shader(c)
            if not sh:
                continue
            if sh.GetIdAttr().Get() == "UsdPreviewSurface":
                op, ro, me = _val(sh, "opacity"), _val(sh, "roughness"), _val(sh, "metallic")
                extra = dict(alpha=float(1 if op is None else op), rough=float(0.8 if ro is None else ro),
                             metal=float(me or 0))
                i = sh.GetInput("diffuseColor")
                if i and i.HasConnectedSource():
                    # follow through NodeGraph wrappers (WSR: map_N/map_N UsdUVTexture inside a NodeGraph)
                    for a in i.GetValueProducingAttributes():
                        tex = UsdShade.Shader(a.GetPrim())
                        f = tex.GetInput("file")
                        if f and (path := self.image(f.Get())):
                            return Look((1.0, 1.0, 1.0), path, self._transform2d(tex), **extra)
                elif i and i.Get() is not None:
                    return Look(tuple(float(x) for x in i.Get()), **extra)
            ro = _val(sh, "reflection_roughness_constant")
            extra = dict(rough=float(0.8 if ro is None else ro))
            t = sh.GetInput("diffuse_texture")
            if t and t.Get() and (path := self.image(t.Get())):
                s, r, tr = _val(sh, "texture_scale"), _val(sh, "texture_rotate"), _val(sh, "texture_translate")
                s, tr = s if s is not None else (1, 1), tr if tr is not None else (0, 0)
                # OmniPBR: a larger texture_scale draws the texture larger, i.e. st / scale
                uv = (1 / float(s[0]), 1 / float(s[1]), float(r or 0), float(tr[0]), float(tr[1]))
                return Look((1.0, 1.0, 1.0), path, uv, **extra)
            k = sh.GetInput("diffuse_color_constant")
            if k and k.Get() is not None:
                return Look(tuple(float(x) for x in k.Get()), **extra)
        return None


def mesh_corners(geo: Geometry, prim):
    """World vertices; per triangle its vertex ids, its faceVertexIndices slots and its source face; face count."""
    m = UsdGeom.Mesh(prim)
    pts, counts, idx = m.GetPointsAttr().Get(), m.GetFaceVertexCountsAttr().Get(), m.GetFaceVertexIndicesAttr().Get()
    empty = np.zeros((0, 3), np.int64)
    if not pts or not counts or not idx:
        return np.zeros((0, 3)), empty, empty, np.zeros(0, np.int64), 0
    w = geo.world(prim)
    v = np.asarray(pts, np.float64) @ w[:3, :3] + w[3, :3]
    counts, idx = np.asarray(counts, np.int64), np.asarray(idx, np.int64)
    starts = np.concatenate([[0], np.cumsum(counts)[:-1]])
    slots, faces = [], []
    for k in range(3, int(counts.max()) + 1):  # fan triangulation, grouped by polygon size
        sel = np.nonzero(counts == k)[0]
        for j in range(1, k - 1) if sel.size else ():
            s = starts[sel]
            slots.append(np.stack([s, s + j, s + j + 1], 1))
            faces.append(sel)
    if not slots:
        return v, empty, empty, np.zeros(0, np.int64), len(counts)
    slot = np.concatenate(slots)
    return v, idx[slot], slot, np.concatenate(faces), len(counts)


def corner_uv(prim, tri_v, slot, face) -> np.ndarray | None:
    """(n, 3, 2) primvars:st per triangle corner, or None."""
    pv = UsdGeom.PrimvarsAPI(prim).GetPrimvar("st")
    vals = pv.ComputeFlattened() if pv and pv.HasValue() else None
    if vals is None or not len(vals):
        return None
    vals = np.asarray(vals, np.float64).reshape(-1, 2)
    at = {"faceVarying": slot, "vertex": tri_v, "varying": tri_v, "constant": np.zeros_like(slot),
          "uniform": np.repeat(face[:, None], 3, 1)}.get(pv.GetInterpolation())
    if at is None or at.max() >= len(vals):
        return None
    return vals[at]


def apply_uv(uv: np.ndarray, xf: tuple) -> np.ndarray:
    if xf == Look.uv:
        return uv
    sx, sy, rot, tx, ty = xf
    u, v, c, s = uv[..., 0] * sx, uv[..., 1] * sy, math.cos(math.radians(rot)), math.sin(math.radians(rot))
    return np.stack([c * u - s * v + tx, s * u + c * v + ty], -1)


def face_looks(prim, looks: Looks, n_faces: int) -> tuple[list, np.ndarray]:
    """Distinct looks of a mesh and the index of each face's look; GeomSubset bindings override the mesh's."""
    table, per = [looks.of(prim)], np.zeros(n_faces, np.int64)
    for sub in UsdGeom.Subset.GetAllGeomSubsets(UsdGeom.Imageable(prim)):
        lk = looks.of(sub.GetPrim())
        ids = np.asarray(sub.GetIndicesAttr().Get() or [], np.int64)
        if lk is None or not ids.size:
            continue
        if lk not in table:
            table.append(lk)
        per[ids[ids < n_faces]] = table.index(lk)
    return table, per


def cluster(v: np.ndarray, f: np.ndarray, uv: np.ndarray | None, grid: float):
    """Vertex-clustering decimation: snap to a grid, merge, drop collapsed and duplicate faces, keep only used
    vertices. Corners in one cell with different UVs (n, 3, 2) stay separate so texture seams survive."""
    if grid > 0:
        _, first, inv = np.unique(np.round(v / grid).astype(np.int64), axis=0, return_index=True, return_inverse=True)
        v, f = v[first], inv.reshape(-1)[f]
    keep = (f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])
    f = f[keep]
    if not len(f):
        return v[:0], f, None
    if uv is None:
        used, inv = np.unique(f, return_inverse=True)
        return v[used], np.unique(inv.reshape(-1, 3), axis=0), None
    uv = uv[keep].reshape(-1, 2)
    key = np.column_stack([f.reshape(-1), np.round(uv * UV_Q).astype(np.int64)])
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    return v[key[first, 0]], np.unique(inv.reshape(-1, 3), axis=0), uv[first]


def units(ir: dict) -> dict[str, dict]:
    """prim path -> node record for every IR object and door, plus the structural top-level groups."""
    u = {o["prim_path"]: {"node": o["id"], "kind": "object", "category": o.get("category"), "room": o.get("room")}
         for o in ir["objects"]}
    u |= {d["prim_path"]: {"node": d["id"], "kind": "door", "category": d.get("kind")} for d in ir["doors"]}
    for top in ("wall", "ground", "ceiling", "windows"):
        u[f"/root/{top}"] = {"node": top, "kind": top}
    return u


def owner(path: str, table: dict) -> dict | None:
    while path and path != "/":
        if path in table:
            return table[path]
        path = path.rsplit("/", 1)[0]
    return None


def material(look: Look, image) -> trimesh.visual.material.PBRMaterial:
    alpha = 1.0 if look.alpha >= 1 else max(look.alpha, MIN_ALPHA)
    return trimesh.visual.material.PBRMaterial(
        baseColorFactor=[*(int(round(255 * min(max(c, 0), 1))) for c in look.rgb), int(round(255 * alpha))],
        baseColorTexture=image, metallicFactor=look.metal, roughnessFactor=look.rough,
        alphaMode="BLEND" if alpha < 1 else None)


def export(scene_id: str, ir_path: Path, out: Path, grid: float = 0.01, tex_px: int = 512,
           max_tris: int = 30000, ceiling: bool = False) -> dict:
    usd = Path(os.environ["HA_DATA"]) / "World-SimReady-Home/raw/full/scene" / scene_id / f"{scene_id}.usdz"
    st = open_stage(str(usd))
    geo = Geometry(st)
    table = units(json.loads(ir_path.read_text()))
    looks = Looks(tex_px)
    sc = trimesh.Scene()
    nodes: dict[str, dict] = {}
    tri_in = tri_out = fallback = textured = 0
    used_tex: set[str] = set()
    it = iter(Usd.PrimRange(st.GetPrimAtPath("/root")))
    for p in it:
        top = p.GetPath().pathString.split("/")[2] if p.GetPath().pathElementCount > 1 else ""
        if top in SKIP_TOP or (top == "ceiling" and not ceiling):
            it.PruneChildren()
            continue
        if not p.IsA(UsdGeom.Mesh) or UsdGeom.Imageable(p).ComputeVisibility() == UsdGeom.Tokens.invisible:
            continue
        v, tri_v, slot, face, n_faces = mesh_corners(geo, p)
        if not len(tri_v):
            continue
        tri_in += len(tri_v)
        rec = owner(p.GetPath().pathString, table) or {"node": f"other:{top}", "kind": "other"}
        name = rec["node"]
        lk_table, per = face_looks(p, looks, n_faces)
        uv_all = corner_uv(p, tri_v, slot, face)
        for li, look in enumerate(lk_table):
            sel = per[face] == li
            if not sel.any():
                continue
            if look is None:
                look, fallback = Look(srgb_to_linear(FALLBACK[rec["kind"]])), fallback + 1
            elif look.tex and uv_all is None:  # texture without UVs: its mean colour
                look = Look(looks.mean(look.tex), alpha=look.alpha, rough=look.rough, metal=look.metal)
            uv = apply_uv(uv_all[sel], look.uv) if look.tex else None
            g = grid
            while True:  # coarsen dense parts (bedding, sofas) until they fit the budget
                vv, ff, uu = cluster(v, tri_v[sel], uv, g)
                if len(ff) <= max_tris or not g or g >= MAX_GRID:
                    break
                g *= 2
            if not len(ff):
                continue
            if name not in nodes:
                nodes[name] = {k: rec.get(k) for k in ("kind", "category", "room")} | {"meshes": 0, "tris": 0}
                sc.graph.update(frame_to=name, frame_from=sc.graph.base_frame)
            tri_out += len(ff)
            if look.tex:
                textured += 1
                used_tex.add(look.tex)
            vis = trimesh.visual.TextureVisuals(uv=uu, material=material(look, looks.images.get(look.tex)))
            m = trimesh.Trimesh(vv, ff, process=False, visual=vis)
            sc.add_geometry(m, node_name=f"{name}#{nodes[name]['meshes']}", parent_node_name=name)
            nodes[name]["meshes"] += 1
            nodes[name]["tris"] += len(ff)
    sc.apply_transform(Z_UP_TO_Y_UP)
    out.mkdir(parents=True, exist_ok=True)
    glb = out / f"{scene_id}.glb"
    glb.write_bytes(sc.export(file_type="glb"))
    info = {"scene": scene_id, "grid_m": grid, "tex_px": tex_px, "max_tris": max_tris, "ceiling": ceiling, "tris_in": tri_in,
            "tris_out": tri_out, "meshes": sum(n["meshes"] for n in nodes.values()), "textured_meshes": textured,
            "textures": len(used_tex), "fallback_colour_meshes": fallback, "bytes": glb.stat().st_size,
            "up": "Y (glTF); Scene IR z -> glTF y, IR y -> glTF -z", "nodes": nodes}
    (out / f"{scene_id}.nodes.json").write_text(json.dumps(info, ensure_ascii=False, indent=1))
    return info


def main(argv=None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("scenes", nargs="+")
    ap.add_argument("--ir-run", required=True)
    ap.add_argument("--grid", type=float, default=0.01)
    ap.add_argument("--tex-px", type=int, default=512)
    ap.add_argument("--max-tris", type=int, default=30000)
    ap.add_argument("--ceiling", action="store_true")
    a = ap.parse_args(argv)
    ir_dir = runlog.outputs_root() / "runs/E1" / a.ir_run / "scenes"
    run_dir = runlog.new_run("V0", tag="glb")
    res = {}
    for s in a.scenes:
        info = export(s, ir_dir / s / "scene_ir.json", run_dir, a.grid, a.tex_px, a.max_tris, a.ceiling)
        res[s] = {k: info[k] for k in ("tris_in", "tris_out", "bytes", "meshes", "textured_meshes", "textures",
                                       "fallback_colour_meshes")} | {"nodes": len(info["nodes"])}
        print(s, res[s], flush=True)
    runlog.write_manifest(run_dir, experiment="V0", params=vars(a), notes=json.dumps(res))


if __name__ == "__main__":
    main()
