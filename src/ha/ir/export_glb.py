"""Export a WSR home as a light GLB for the web viewer (plan V0). Display only; never used for scoring.

One glTF node per Scene IR object or door (node name = IR id) so the viewer can highlight the object a
violation points to; walls, ground and windows get their own nodes, and meshes under no IR entity go to
"other:<top-level prim>". Colours: mean colour of the bound texture (UsdPreviewSurface diffuseColor or OmniPBR
diffuse_texture), else the constant colour, else a per-kind fallback. Meshes are reduced by vertex clustering
on a GRID metre lattice. Written in glTF Y-up (Scene IR is Z-up); a sidecar <name>.nodes.json lists the nodes.

  python -m ha.ir.export_glb scene000064 --ir-run <run_id> [--grid 0.01] [--ceiling]
"""
from __future__ import annotations

import argparse
import json
import os
import zipfile
from pathlib import Path

import cv2
import numpy as np
import trimesh
from pxr import Usd, UsdGeom, UsdShade

from ha import runlog
from ha.ir.usd_mesh import Geometry, open_stage

SKIP_TOP = {"_materials", "lights", "Cam1", "env_light"}
FALLBACK = {"wall": (0.86, 0.85, 0.82), "ground": (0.62, 0.52, 0.42), "ceiling": (0.95, 0.95, 0.95),
            "windows": (0.65, 0.80, 0.90), "door": (0.55, 0.40, 0.28), "object": (0.70, 0.70, 0.70),
            "other": (0.75, 0.75, 0.75)}
Z_UP_TO_Y_UP = trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])


class Colours:
    def __init__(self):
        self.tex: dict[str, tuple | None] = {}

    def texture_mean(self, asset) -> tuple | None:
        path = getattr(asset, "resolvedPath", "") or ""
        if path in self.tex:
            return self.tex[path]
        rgb = None
        try:
            if "[" in path:  # inside the usdz: /a/b.usdz[inner/path.jpg]
                outer, inner = path[:-1].split("[", 1)
                with zipfile.ZipFile(outer) as z:
                    buf = np.frombuffer(z.read(inner), np.uint8)
                im = cv2.imdecode(buf, cv2.IMREAD_COLOR)
            else:
                im = cv2.imread(path, cv2.IMREAD_COLOR) if path else None
            if im is not None:
                b, g, r = cv2.resize(im, (32, 32), interpolation=cv2.INTER_AREA).reshape(-1, 3).mean(0) / 255
                rgb = (float(r), float(g), float(b))
        except (KeyError, OSError, ValueError, zipfile.BadZipFile):
            rgb = None
        self.tex[path] = rgb
        return rgb

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

    def of(self, mesh_prim) -> tuple | None:
        mat = self.bound(mesh_prim)
        if not mat:
            return None
        for c in Usd.PrimRange(mat.GetPrim()):
            sh = UsdShade.Shader(c)
            if not sh:
                continue
            if sh.GetIdAttr().Get() == "UsdPreviewSurface":
                i = sh.GetInput("diffuseColor")
                if i and i.HasConnectedSource():
                    # follow through NodeGraph wrappers (WSR: map_N/map_N UsdUVTexture inside a NodeGraph)
                    for a in i.GetValueProducingAttributes():
                        f = UsdShade.Shader(a.GetPrim()).GetInput("file")
                        if f and (rgb := self.texture_mean(f.Get())):
                            return rgb
                elif i and i.Get() is not None:
                    return tuple(float(x) for x in i.Get())
            t = sh.GetInput("diffuse_texture")
            if t and t.Get() and (rgb := self.texture_mean(t.Get())):
                return rgb
            k = sh.GetInput("diffuse_color_constant")
            if k and k.Get() is not None:
                return tuple(float(x) for x in k.Get())
        return None


def mesh_arrays(geo: Geometry, prim) -> tuple[np.ndarray, np.ndarray]:
    m = UsdGeom.Mesh(prim)
    pts, counts, idx = m.GetPointsAttr().Get(), m.GetFaceVertexCountsAttr().Get(), m.GetFaceVertexIndicesAttr().Get()
    if not pts or not counts or not idx:
        return np.zeros((0, 3)), np.zeros((0, 3), np.int64)
    w = geo.world(prim)
    v = np.asarray(pts, np.float64) @ w[:3, :3] + w[3, :3]
    counts, idx = np.asarray(counts, np.int64), np.asarray(idx, np.int64)
    starts = np.concatenate([[0], np.cumsum(counts)[:-1]])
    faces = [np.stack([idx[s], idx[s + j], idx[s + j + 1]], 1)
             for k in range(3, int(counts.max()) + 1) if (s := starts[counts == k]).size for j in range(1, k - 1)]
    return v, (np.concatenate(faces) if faces else np.zeros((0, 3), np.int64))


def cluster(v: np.ndarray, f: np.ndarray, grid: float) -> tuple[np.ndarray, np.ndarray]:
    """Vertex-clustering decimation: snap to a grid, merge, drop collapsed and duplicate faces."""
    if grid <= 0 or not len(f):
        return v, f
    _, first, inv = np.unique(np.round(v / grid).astype(np.int64), axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    f = inv[f]
    f = f[(f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])]
    if len(f):
        f = np.unique(f, axis=0)
    return v[first], f
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


def export(scene_id: str, ir_path: Path, out: Path, grid: float = 0.01, ceiling: bool = False) -> dict:
    usd = Path(os.environ["HA_DATA"]) / "World-SimReady-Home/raw/full/scene" / scene_id / f"{scene_id}.usdz"
    st = open_stage(str(usd))
    geo = Geometry(st)
    table = units(json.loads(ir_path.read_text()))
    col = Colours()
    sc = trimesh.Scene()
    nodes: dict[str, dict] = {}
    tri_in = tri_out = fallback = 0
    it = iter(Usd.PrimRange(st.GetPrimAtPath("/root")))
    for p in it:
        top = p.GetPath().pathString.split("/")[2] if p.GetPath().pathElementCount > 1 else ""
        if top in SKIP_TOP or (top == "ceiling" and not ceiling):
            it.PruneChildren()
            continue
        if not p.IsA(UsdGeom.Mesh) or UsdGeom.Imageable(p).ComputeVisibility() == UsdGeom.Tokens.invisible:
            continue
        v, f = mesh_arrays(geo, p)
        if not len(f):
            continue
        tri_in += len(f)
        v, f = cluster(v, f, grid)
        if not len(f):
            continue
        tri_out += len(f)
        rec = owner(p.GetPath().pathString, table) or {"node": f"other:{top}", "kind": "other"}
        name = rec["node"]
        if name not in nodes:
            nodes[name] = {k: rec.get(k) for k in ("kind", "category", "room")} | {"meshes": 0, "tris": 0}
            sc.graph.update(frame_to=name, frame_from=sc.graph.base_frame)
        rgb = col.of(p)
        if rgb is None:
            rgb, fallback = FALLBACK[rec["kind"]], fallback + 1
        mat = trimesh.visual.material.PBRMaterial(baseColorFactor=[*(int(255 * min(max(c, 0), 1)) for c in rgb), 255],
                                                  metallicFactor=0.0, roughnessFactor=0.8)
        m = trimesh.Trimesh(v, f, process=False, visual=trimesh.visual.TextureVisuals(material=mat))
        sc.add_geometry(m, node_name=f"{name}#{nodes[name]['meshes']}", parent_node_name=name)
        nodes[name]["meshes"] += 1
        nodes[name]["tris"] += len(f)
    sc.apply_transform(Z_UP_TO_Y_UP)
    out.mkdir(parents=True, exist_ok=True)
    glb = out / f"{scene_id}.glb"
    glb.write_bytes(sc.export(file_type="glb"))
    info = {"scene": scene_id, "grid_m": grid, "ceiling": ceiling, "tris_in": tri_in, "tris_out": tri_out,
            "meshes": sum(n["meshes"] for n in nodes.values()), "fallback_colour_meshes": fallback,
            "bytes": glb.stat().st_size, "up": "Y (glTF); Scene IR z -> glTF y, IR y -> glTF -z", "nodes": nodes}
    (out / f"{scene_id}.nodes.json").write_text(json.dumps(info, ensure_ascii=False, indent=1))
    return info


def main(argv=None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("scenes", nargs="+")
    ap.add_argument("--ir-run", required=True)
    ap.add_argument("--grid", type=float, default=0.01)
    ap.add_argument("--ceiling", action="store_true")
    a = ap.parse_args(argv)
    ir_dir = runlog.outputs_root() / "runs/E1" / a.ir_run / "scenes"
    run_dir = runlog.new_run("V0", tag="glb")
    res = {}
    for s in a.scenes:
        info = export(s, ir_dir / s / "scene_ir.json", run_dir, a.grid, a.ceiling)
        res[s] = {k: info[k] for k in ("tris_in", "tris_out", "bytes", "meshes", "fallback_colour_meshes")} | {"nodes": len(info["nodes"])}
        print(s, res[s], flush=True)
    runlog.write_manifest(run_dir, experiment="V0", params=vars(a), notes=json.dumps(res))


if __name__ == "__main__":
    main()
