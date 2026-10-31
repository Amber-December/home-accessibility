"""Convert a composed USD stage to a static, metre-scale, Y-up GLB.

Usage: python scripts/convert_usdz.py input.usdz output.glb

OpenUSD resolves references, inherits and instances before geometry is read.
The output keeps every visible render mesh; it is not a geometry simplifier.
When the USDZ contains local UsdUVTexture assets, their diffuse images are
embedded in the GLB. A neutral material remains the fallback for unsupported
shader graphs or missing images.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import re
import struct
import sys
import tempfile
import zipfile
import time

import numpy as np
from pxr import Gf, Usd, UsdGeom, UsdShade


FLOAT = 5126
UNSIGNED_INT = 5125
UNSIGNED_SHORT = 5123


def classify(path: str, metadata: dict | None = None) -> tuple[str, bool]:
    """Classify nodes, not whole scenes, so ceilings can be hidden independently."""
    text = path.lower()
    segments = text.split("/")
    product_type = str((metadata or {}).get("type", "")).lower()
    ceiling = any(word in text for word in ("/ceiling/", "/ceilings/", "ceiling_", "吊顶", "天花"))
    if ceiling or product_type == "ceiling_mounted_object":
        return "ceiling", True
    if any(s in {"floor", "floors", "ground", "grounds", "地板", "地面"} or s.startswith(("floor_", "ground_")) for s in segments) and not any(
        word in text for word in ("floorlamp", "floor_lamp", "floorstanding", "floor_standing")
    ):
        return "floor", False
    if any(s in {"wall", "walls", "墙"} or s.startswith("wall_") for s in segments) or product_type in ("wall", "architecture", "structural_element"):
        return "wall", False
    if any(s in {"window", "windows", "窗"} or s.startswith("window_") for s in segments):
        return "window", False
    if any(s in {"door", "doors", "门"} or s.startswith("door_") or "_door_cabinet_" in s for s in segments):
        return "door", False
    if any(s in {"column", "columns", "pillar", "pillars", "柱"} or s.startswith(("column_", "pillar_")) for s in segments):
        return "wall", False
    # Bedroom names are room contexts, not beds; word boundaries avoid that trap.
    for kind, expression in (
        ("bed", r"(?:^|[/_])(?:bed|doublebed|singlebed|bedframe|mattress)(?:\d|[/_]|$)"),
        ("sofa", r"(?:^|[/_])(?:sofa|couch)(?:\d|[/_]|$)"),
        ("chair", r"(?:^|[/_])(?:chair|armchair|stool)(?:\d|[/_]|$)"),
        ("table", r"(?:^|[/_])(?:table|desk|teatable|diningtable|coffeetable)(?:\d|[/_]|$)"),
        ("cabinet", r"(?:^|[/_])(?:cabinet|wardrobe|shelf|bookcase)(?:\d|[/_]|$)"),
    ):
        if re.search(expression, text):
            return kind, False
    return "furniture", False


def metadata_products(input_path: Path) -> tuple[dict, dict[str, dict]]:
    candidate = input_path.with_name(input_path.stem + "_metadata.json")
    if not candidate.is_file():
        return {}, {}
    try:
        data = json.loads(candidate.read_text(encoding="utf-8"))
        return data, {p["prim_path"]: p for p in data.get("products", []) if p.get("prim_path")}
    except (OSError, ValueError, TypeError):
        return {}, {}


def nearest_product(path: str, products: dict[str, dict]) -> dict | None:
    current = path
    while current:
        if current in products:
            return products[current]
        current = current.rsplit("/", 1)[0]
    return None


def stage_axis_matrix(axis: str, metres: float) -> np.ndarray:
    # USD/Gf matrices use row vectors. Our vertex arrays multiply on the right.
    rotation = np.identity(3, dtype=np.float64)
    if axis == "Z":
        # (x,y,z) USD -> (x,z,-y) glTF, a proper rotation with determinant +1.
        rotation = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)
    elif axis == "X":
        rotation = np.array([[0, 1, 0], [-1, 0, 0], [0, 0, 1]], dtype=np.float64)
    return rotation * metres


def triangulate(points: np.ndarray, counts: np.ndarray, indices: np.ndarray, holes: set[int]) -> np.ndarray:
    """Preserve vertex indices, with ear clipping for non-convex polygons."""
    if len(counts) == 0 or int(counts.sum()) != len(indices):
        raise ValueError("faceVertexCounts does not match faceVertexIndices")
    if np.any(counts < 3):
        # USD can contain degenerate faces; omit only those invalid primitives.
        pass
    if np.all(counts == 3) and not holes:
        return indices.reshape(-1, 3).astype(np.int64, copy=False)
    triangles = []
    cursor = 0
    for face_id, count in enumerate(counts):
        count = int(count)
        face = indices[cursor:cursor + count]
        cursor += count
        if face_id in holes or count < 3:
            continue
        if count == 3:
            triangles.append(face.tolist())
            continue
        coords = points[face]
        normal = np.zeros(3)
        for i in range(count):
            normal += np.cross(coords[i], coords[(i + 1) % count])
        drop = int(np.argmax(np.abs(normal)))
        uv = np.delete(coords, drop, axis=1)
        area = float(np.sum(uv[:, 0] * np.roll(uv[:, 1], -1) - np.roll(uv[:, 0], -1) * uv[:, 1]))
        sign = 1.0 if area >= 0 else -1.0

        def cross2(a, b, c):
            return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

        # The common convex quad case takes the same diagonal as a triangle fan.
        convex = all(sign * cross2(uv[i - 1], uv[i], uv[(i + 1) % count]) >= -1e-12 for i in range(count))
        if convex:
            triangles.extend([[int(face[0]), int(face[i]), int(face[i + 1])] for i in range(1, count - 1)])
            continue
        remaining = list(range(count))
        while len(remaining) > 3:
            ear = None
            for j, curr in enumerate(remaining):
                prev, nxt = remaining[j - 1], remaining[(j + 1) % len(remaining)]
                a, b, c = uv[prev], uv[curr], uv[nxt]
                if sign * cross2(a, b, c) <= 1e-12:
                    continue
                inside = False
                for other in remaining:
                    if other in (prev, curr, nxt):
                        continue
                    p = uv[other]
                    if min(sign * cross2(a, b, p), sign * cross2(b, c, p), sign * cross2(c, a, p)) >= -1e-12:
                        inside = True
                        break
                if not inside:
                    ear = j
                    triangles.append([int(face[prev]), int(face[curr]), int(face[nxt])])
                    break
            if ear is None:
                # A malformed/nonplanar polygon must not silently turn into missing geometry.
                triangles.extend([[int(face[remaining[0]]), int(face[remaining[i]]), int(face[remaining[i + 1]])]
                                  for i in range(1, len(remaining) - 1)])
                remaining = []
                break
            remaining.pop(ear)
        if len(remaining) == 3:
            triangles.append([int(face[i]) for i in remaining])
    return np.asarray(triangles, dtype=np.int64).reshape(-1, 3)


def make_normals(vertices: np.ndarray, triangles: np.ndarray) -> np.ndarray:
    normals = np.zeros(vertices.shape, dtype=np.float32)
    # Bounded temporary arrays keep detailed room meshes affordable to convert.
    for start in range(0, len(triangles), 100_000):
        tri = triangles[start:start + 100_000]
        a, b, c = vertices[tri[:, 0]], vertices[tri[:, 1]], vertices[tri[:, 2]]
        face = np.cross(b - a, c - a)
        for column in range(3):
            np.add.at(normals, tri[:, column], face)
    length = np.linalg.norm(normals, axis=1)
    valid = length > 1e-12
    normals[valid] /= length[valid, None]
    normals[~valid] = (0, 1, 0)
    return normals


def should_skip(prim, mesh: UsdGeom.Mesh) -> str | None:
    imageable = UsdGeom.Imageable(prim)
    if imageable.ComputeVisibility() == UsdGeom.Tokens.invisible:
        return "invisible"
    if imageable.ComputePurpose() in (UsdGeom.Tokens.guide, UsdGeom.Tokens.proxy):
        return "non_render_purpose"
    # Collision geometry authored in a dedicated branch should not replace visible furniture.
    segments = str(prim.GetPath()).lower().split("/")
    if any(s in {"colliders", "collider", "collision", "collisions", "collision_geometry", "physicscolliders"} for s in segments):
        return "collision_only"
    return None


def mesh_uvs(mesh: UsdGeom.Mesh, used: np.ndarray, triangles: np.ndarray) -> np.ndarray | None:
    """Return a stable per-vertex UV set. USD face-varying seams use the first
    corner seen for a point; this keeps the static converter bounded while
    preserving the authored layout for the common non-seamed architectural UVs."""
    primvar = UsdGeom.PrimvarsAPI(mesh.GetPrim()).GetPrimvar("st")
    if not primvar or not primvar.HasValue():
        primvar = UsdGeom.PrimvarsAPI(mesh.GetPrim()).GetPrimvar("uv")
    if not primvar or not primvar.HasValue():
        return None
    values = primvar.ComputeFlattened()
    if not values:
        return None
    raw = np.asarray([[float(v[0]), float(v[1])] for v in values], dtype=np.float32)
    interpolation = str(primvar.GetInterpolation())
    points = mesh.GetPointsAttr().Get()
    if interpolation == "vertex" and len(raw) >= len(points):
        out = raw[used].copy()
    elif interpolation == "faceVarying":
        # Build point -> first corner UV. The original mesh is intentionally
        # kept indexed; repeated UV seams are rare in the architectural USDZ
        # assets and the fallback remains visually preferable to flat colour.
        out = np.zeros((len(points), 2), dtype=np.float32)
        filled = np.zeros(len(points), dtype=bool)
        cursor = 0
        counts = mesh.GetFaceVertexCountsAttr().Get() or []
        indices = mesh.GetFaceVertexIndicesAttr().Get() or []
        for count in counts:
            for point_index in indices[cursor:cursor + int(count)]:
                if cursor < len(raw) and not filled[int(point_index)]:
                    out[int(point_index)] = raw[cursor]
                    filled[int(point_index)] = True
                cursor += 1
        out = out[used]
    else:
        return None
    out[:, 1] = 1.0 - out[:, 1]
    return np.clip(out, 0.0, 1.0)


def diffuse_texture(prim, stage, archive: zipfile.ZipFile) -> tuple[str, bytes, str] | None:
    """Find a local UsdUVTexture feeding diffuseColor and read it from USDZ."""
    material, _ = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()
    if not material:
        return None
    source, _, _ = UsdShade.Material(material).ComputeSurfaceSource()
    if not source:
        return None
    visited = set()
    stack = [source.GetPrim()]
    while stack:
        shader_prim = stack.pop()
        path = str(shader_prim.GetPath())
        if path in visited:
            continue
        visited.add(path)
        shader = UsdShade.Shader(shader_prim)
        if shader.GetIdAttr().Get() == "UsdUVTexture":
            file_attr = shader.GetInput("file")
            asset = file_attr.Get() if file_attr else None
            name = str(asset.path if hasattr(asset, "path") else asset or "")
            name = name.replace("\\", "/").lstrip("./")
            if name:
                try:
                    data = archive.read(name)
                except KeyError:
                    try:
                        data = archive.read("./" + name)
                    except KeyError:
                        data = None
                if data:
                    ext = Path(name).suffix.lower()
                    mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}.get(ext)
                    if mime:
                        return name, data, mime
        for inp in shader.GetInputs():
            try:
                connected, _ = inp.GetConnectedSources()
            except Exception:
                connected = []
            for connection in connected or []:
                if connection:
                    stack.append(connection.source)
    return None


class GlbWriter:
    def __init__(self, directory: Path):
        self.bin = tempfile.TemporaryFile(dir=directory)
        self.length = 0
        self.doc = {
            "asset": {"version": "2.0", "generator": "IndoorLab OpenUSD static stage converter"},
            "scene": 0, "scenes": [{"nodes": []}], "nodes": [], "meshes": [],
            "accessors": [], "bufferViews": [], "materials": [], "buffers": [],
        }
        colors = {
            "floor": [0.66, 0.75, 0.80, 1],
            "wall": [0.82, 0.88, 0.91, 1],
            "ceiling": [0.90, 0.94, 0.96, 1],
            "window": [0.38, 0.62, 0.77, 1],
            "door": [0.56, 0.70, 0.78, 1],
            "furniture": [0.58, 0.72, 0.79, 1],
        }
        self.materials = {}
        self.image_assets = {}
        for kind, color in colors.items():
            self.materials[kind] = len(self.doc["materials"])
            self.doc["materials"].append({
                "name": "IndoorLab " + kind,
                "doubleSided": True,
                "pbrMetallicRoughness": {"baseColorFactor": color, "metallicFactor": 0.0, "roughnessFactor": 0.78},
            })

    def image(self, key: str, data: bytes, mime: str):
        if not data or not key:
            return None
        if key in self.image_assets:
            return self.image_assets[key][0]
        self.image_assets[key] = (len(self.image_assets), bytes(data), mime)
        return self.image_assets[key][0]

    def material(self, kind: str, texture: tuple[str, bytes, str] | None = None):
        key = kind if not texture else f"{kind}:{texture[0]}"
        if key in self.materials:
            return self.materials[key]
        color = {
            "floor": [0.66, 0.75, 0.80, 1], "wall": [0.82, 0.88, 0.91, 1],
            "ceiling": [0.90, 0.94, 0.96, 1], "window": [0.38, 0.62, 0.77, 1],
            "door": [0.56, 0.70, 0.78, 1], "furniture": [0.58, 0.72, 0.79, 1],
            "bed": [0.75, 0.67, 0.62, 1], "sofa": [0.36, 0.50, 0.64, 1],
            "chair": [0.54, 0.39, 0.28, 1], "table": [0.58, 0.43, 0.28, 1],
            "cabinet": [0.52, 0.39, 0.29, 1],
        }.get(kind, [0.58, 0.72, 0.79, 1])
        pbr = {"baseColorFactor": color, "metallicFactor": 0.0, "roughnessFactor": .78}
        if texture:
            image_index = self.image(texture[0], texture[1], texture[2])
            if image_index is not None:
                pbr["baseColorTexture"] = {"index": image_index}
        self.materials[key] = len(self.doc["materials"])
        self.doc["materials"].append({"name": "IndoorLab " + key, "doubleSided": True, "pbrMetallicRoughness": pbr})
        return self.materials[key]

    def accessor(self, array, component: int, value_type: str, target: int, bounds=False):
        pad = (-self.length) % 4
        if pad:
            self.bin.write(b"\0" * pad)
            self.length += pad
        array = np.ascontiguousarray(array)
        view = {"buffer": 0, "byteOffset": self.length, "byteLength": array.nbytes, "target": target}
        self.bin.write(array.tobytes())
        self.length += array.nbytes
        view_id = len(self.doc["bufferViews"])
        self.doc["bufferViews"].append(view)
        accessor = {"bufferView": view_id, "componentType": component, "count": len(array), "type": value_type}
        if bounds:
            accessor["min"] = array.min(axis=0).astype(float).tolist()
            accessor["max"] = array.max(axis=0).astype(float).tolist()
        index = len(self.doc["accessors"])
        self.doc["accessors"].append(accessor)
        return index

    def mesh(self, path, vertices, normals, triangles, extra, uvs=None, texture=None):
        pos = self.accessor(vertices.astype("<f4"), FLOAT, "VEC3", 34962, True)
        norm = self.accessor(normals.astype("<f4"), FLOAT, "VEC3", 34962)
        dtype, component = ("<u2", UNSIGNED_SHORT) if len(vertices) <= 65535 else ("<u4", UNSIGNED_INT)
        indices = self.accessor(triangles.reshape(-1).astype(dtype), component, "SCALAR", 34963)
        node = len(self.doc["nodes"])
        mesh = len(self.doc["meshes"])
        leaf = path.rsplit("/", 1)[-1]
        attributes = {"POSITION": pos, "NORMAL": norm}
        if uvs is not None and len(uvs) == len(vertices):
            attributes["TEXCOORD_0"] = self.accessor(uvs.astype("<f4"), FLOAT, "VEC2", 34962)
        material = self.material(extra["kind"], texture)
        self.doc["meshes"].append({"name": leaf, "primitives": [{"attributes": attributes,
                                                              "indices": indices, "material": material}]})
        self.doc["nodes"].append({"name": leaf, "mesh": mesh, "extras": extra})
        self.doc["scenes"][0]["nodes"].append(node)

    def save(self, output: Path, extras: dict):
        self.doc["extras"] = {"indoorUsd": extras}
        self.doc["asset"]["extras"] = {"indoorUsd": extras}
        self.doc["scenes"][0]["extras"] = {"indoorUsd": extras}
        image_views = []
        for _, data, mime in self.image_assets.values():
            pad = (-self.length) % 4
            if pad:
                self.bin.write(b"\0" * pad); self.length += pad
            view = {"buffer": 0, "byteOffset": self.length, "byteLength": len(data)}
            self.bin.write(data); self.length += len(data)
            image_views.append((view, mime))
        for view, _ in image_views:
            self.doc["bufferViews"].append(view)
        if image_views:
            self.doc["images"] = [{"bufferView": len(self.doc["bufferViews"]) - len(image_views) + i, "mimeType": mime} for i, (_, mime) in enumerate(image_views)]
            self.doc["textures"] = [{"source": i} for i in range(len(image_views))]
            # image() returns a stable insertion index, matching image_views order.
        self.doc["buffers"] = [{"byteLength": self.length}]
        raw_json = json.dumps(self.doc, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
        raw_json += b" " * ((-len(raw_json)) % 4)
        bin_length = self.length + (-self.length) % 4
        total = 12 + 8 + len(raw_json) + 8 + bin_length
        if total > 0xffffffff:
            raise ValueError("The GLB exceeds its 4 GiB format limit")
        temp_path = output.with_name(output.name + ".partial")
        with temp_path.open("wb") as out:
            out.write(struct.pack("<III", 0x46546C67, 2, total))
            out.write(struct.pack("<II", len(raw_json), 0x4E4F534A))
            out.write(raw_json)
            out.write(struct.pack("<II", bin_length, 0x004E4942))
            self.bin.seek(0)
            while True:
                chunk = self.bin.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
            out.write(b"\0" * (bin_length - self.length))
        os.replace(temp_path, output)
        self.bin.close()
        return total


def convert(input_path: Path, output_path: Path) -> dict:
    started = time.monotonic()
    stage = Usd.Stage.Open(str(input_path), load=Usd.Stage.LoadAll)
    if not stage:
        raise ValueError("OpenUSD could not open the stage")
    axis = str(UsdGeom.GetStageUpAxis(stage)).upper()
    metres = float(UsdGeom.GetStageMetersPerUnit(stage))
    if not math.isfinite(metres) or metres <= 0:
        raise ValueError("The USD stage has an invalid metersPerUnit")
    axis_matrix = stage_axis_matrix(axis, metres)
    cache = UsdGeom.XformCache(Usd.TimeCode.Default())
    metadata, products = metadata_products(input_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    writer = GlbWriter(output_path.parent)
    archive = zipfile.ZipFile(input_path, "r")
    bounds_min, bounds_max = np.full(3, np.inf), np.full(3, -np.inf)
    source_min, source_max = np.full(3, np.inf), np.full(3, -np.inf)
    visible_meshes = 0
    original_triangles = 0
    original_faces = 0
    skipped = {}
    kinds = {}
    errors = []
    # TraverseInstanceProxies includes meshes inside instanceable referenced products.
    for prim in Usd.PrimRange(stage.GetPseudoRoot(), Usd.TraverseInstanceProxies()):
        if not prim.IsA(UsdGeom.Mesh):
            continue
        mesh = UsdGeom.Mesh(prim)
        reason = should_skip(prim, mesh)
        if reason:
            skipped[reason] = skipped.get(reason, 0) + 1
            continue
        path = str(prim.GetPath())
        raw_points = mesh.GetPointsAttr().Get()
        raw_counts = mesh.GetFaceVertexCountsAttr().Get()
        raw_indices = mesh.GetFaceVertexIndicesAttr().Get()
        if raw_points is None or raw_counts is None or raw_indices is None or len(raw_points) == 0 or len(raw_indices) == 0:
            skipped["empty_mesh"] = skipped.get("empty_mesh", 0) + 1
            continue
        points = np.asarray(raw_points, dtype=np.float64)
        counts = np.asarray(raw_counts, dtype=np.int64)
        indices = np.asarray(raw_indices, dtype=np.int64)
        if not np.isfinite(points).all() or indices.min() < 0 or indices.max() >= len(points):
            errors.append(path + ": invalid vertex coordinates or indices")
            continue
        matrix = np.asarray(cache.GetLocalToWorldTransform(prim), dtype=np.float64)
        source_world = points @ matrix[:3, :3] + matrix[3, :3]
        world = source_world @ axis_matrix
        if not np.isfinite(world).all():
            errors.append(path + ": invalid composed world transform")
            continue
        holes = set(mesh.GetHoleIndicesAttr().Get() or [])
        triangles = triangulate(points, counts, indices, holes)
        if not len(triangles):
            skipped["empty_triangles"] = skipped.get("empty_triangles", 0) + 1
            continue
        reflected = float(np.linalg.det(matrix[:3, :3] @ axis_matrix)) < 0
        left_handed = mesh.GetOrientationAttr().Get() == UsdGeom.Tokens.leftHanded
        if reflected != left_handed:
            triangles = triangles[:, [0, 2, 1]]
        # Drop unused source points so exported bounds reflect only visible faces.
        used, remapped = np.unique(triangles.reshape(-1), return_inverse=True)
        vertices = world[used].astype(np.float32)
        triangles = remapped.reshape(-1, 3)
        normals = make_normals(vertices, triangles)
        uvs = mesh_uvs(mesh, used, triangles)
        texture = diffuse_texture(prim, stage, archive)
        product = nearest_product(path, products)
        kind, ceiling = classify(path, product)
        extra = {
            "usdPath": path, "sourcePrimPath": path, "kind": kind,
            "ceiling": ceiling, "ignoreCollision": ceiling,
            "sourceProduct": product.get("prim_path") if product else None,
            "sourceType": product.get("type") if product else None,
            "sourceTriangleCount": len(triangles),
            "unit": "meter", "upAxis": "Y", "worldTransformBaked": True,
        }
        writer.mesh(path, vertices, normals, triangles, extra, uvs=uvs, texture=texture)
        bounds_min = np.minimum(bounds_min, vertices.min(axis=0))
        bounds_max = np.maximum(bounds_max, vertices.max(axis=0))
        source_min = np.minimum(source_min, source_world[used].min(axis=0))
        source_max = np.maximum(source_max, source_world[used].max(axis=0))
        visible_meshes += 1
        original_triangles += len(triangles)
        original_faces += len(counts) - len(holes)
        kinds[kind] = kinds.get(kind, 0) + 1
    if errors:
        raise ValueError("Invalid USD geometry: " + "; ".join(errors[:8]))
    if not visible_meshes:
        raise ValueError("The composed USD stage contains no visible render meshes")
    extra = {
        "convertedFrom": "usdz", "converter": "OpenUSD", "sourceFile": input_path.name,
        "sourceUpAxis": axis, "sourceMetersPerUnit": metres,
        "upAxis": "Y", "metersPerUnit": 1.0, "unit": "meter", "worldTransformBaked": True,
        "meshCount": visible_meshes, "triangleCount": original_triangles,
        "originalTriangleCount": original_triangles, "originalFaceCount": original_faces,
        "simplified": False, "kinds": kinds, "skippedMeshes": skipped,
        "bounds": {"min": bounds_min.tolist(), "max": bounds_max.tolist(), "size": (bounds_max - bounds_min).tolist()},
        "sourceBounds": {"min": source_min.tolist(), "max": source_max.tolist(), "size": (source_max - source_min).tolist()},
        "materialStyle": "neutral-blue-white",
        "compositionWarnings": [str(error) for error in stage.GetCompositionErrors()],
    }
    if metadata:
        extra["sourceMetadataMeshCount"] = metadata.get("build_stats", {}).get("mesh_count")
        product_bounds = [p["world_aabb"] for p in products.values() if p.get("world_aabb")]
        if product_bounds:
            pmin = np.min(np.array([p["min"] for p in product_bounds]), axis=0)
            pmax = np.max(np.array([p["max"] for p in product_bounds]), axis=0)
            extra["metadataProductBounds"] = {"min": pmin.tolist(), "max": pmax.tolist(), "size": (pmax - pmin).tolist()}
    extra["embeddedTextures"] = len(writer.image_assets)
    extra["materialStyle"] = "usd-preview-textures-with-neutral-fallback"
    extra["outputBytes"] = writer.save(output_path, extra)
    archive.close()
    extra["elapsedSeconds"] = round(time.monotonic() - started, 3)
    output_path.with_suffix(output_path.suffix + ".json").write_text(json.dumps(extra, ensure_ascii=False, indent=2), encoding="utf-8")
    return extra


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        result = convert(args.input.resolve(), args.output.resolve())
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
