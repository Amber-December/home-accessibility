"""Layered occupancy grids from world-space triangles.

Layers (simulation §3): floor 0-0.05 m is a height map (max geometry height, so rugs and
thresholds can be told apart); toe / body / head are label grids holding the index of the
entity that occupies the cell (-1 = free). Later writers win, so callers rasterize walls first
and furniture last, which makes attribution point at furniture where it touches a wall.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

RES = 0.05
FLOOR_BAND = (0.0, 0.05)
LAYERS = {"toe": (0.05, 0.30), "body": (0.30, 1.40), "head": (1.40, 2.00)}
SHIFT = 4  # cv2 sub-pixel bits


@dataclass
class GridSpec:
    x0: float
    y0: float
    width: int   # columns (x)
    height: int  # rows (y)
    res: float = RES

    @classmethod
    def from_bounds(cls, xmin, ymin, xmax, ymax, margin=1.5, res=RES):
        x0 = np.floor((xmin - margin) / res) * res
        y0 = np.floor((ymin - margin) / res) * res
        w = int(np.ceil((xmax + margin - x0) / res))
        h = int(np.ceil((ymax + margin - y0) / res))
        return cls(float(x0), float(y0), w, h, res)

    def to_px(self, xy: np.ndarray) -> np.ndarray:
        """World xy -> cv2 pixel coords (x=col, y=row), cell centres at integers."""
        return np.stack([(xy[..., 0] - self.x0) / self.res - 0.5, (xy[..., 1] - self.y0) / self.res - 0.5], -1)

    def cell_center(self, row, col):
        return self.x0 + (col + 0.5) * self.res, self.y0 + (row + 0.5) * self.res

    def as_dict(self):
        return {"x0": self.x0, "y0": self.y0, "width": self.width, "height": self.height, "res": self.res}


def _clip_plane(P: np.ndarray, n: np.ndarray, z: float, keep_above: bool):
    """Vectorised Sutherland-Hodgman against the plane Z=z. P: (N, M, 3), n: vertex counts."""
    N, M, _ = P.shape
    idx = np.arange(M)[None, :]
    valid = idx < n[:, None]
    nxt = (idx + 1) % np.maximum(n[:, None], 1)
    Q = np.take_along_axis(P, nxt[..., None].repeat(3, 2), axis=1)
    s, t = P[..., 2] - z, Q[..., 2] - z
    if not keep_above:
        s, t = -s, -t
    pin, qin = s >= 0, t >= 0
    cross = (pin != qin) & valid
    denom = np.where(cross, s - t, 1.0)
    alpha = np.where(cross, s / denom, 0.0)
    inter = P + alpha[..., None] * (Q - P)
    out = np.empty((N, 2 * M, 3))
    ok = np.empty((N, 2 * M), bool)
    out[:, 0::2], ok[:, 0::2] = P, pin & valid
    out[:, 1::2], ok[:, 1::2] = inter, cross
    order = np.argsort(~ok, axis=1, kind="stable")
    out = np.take_along_axis(out, order[..., None].repeat(3, 2), axis=1)
    n2 = ok.sum(1)
    m2 = max(int(n2.max(initial=0)), 1)
    return out[:, :m2], n2


def clip_band(tris: np.ndarray, z0: float, z1: float):
    """Clip triangles to z0 <= Z <= z1. Returns (polys (K, M, 3), counts (K,))."""
    if len(tris) == 0:
        return np.zeros((0, 3, 3)), np.zeros(0, int)
    zmin, zmax = tris[..., 2].min(1), tris[..., 2].max(1)
    tris = tris[(zmax >= z0) & (zmin <= z1)]
    if len(tris) == 0:
        return np.zeros((0, 3, 3)), np.zeros(0, int)
    zmin, zmax = tris[..., 2].min(1), tris[..., 2].max(1)
    inside = (zmin >= z0) & (zmax <= z1)  # most triangles of detailed meshes need no clipping
    A, cut = tris[inside], tris[~inside]
    if len(cut) == 0:
        return A, np.full(len(A), 3)
    n = np.full(len(cut), 3)
    P, n = _clip_plane(cut, n, z0, True)
    P, n = _clip_plane(P, n, z1, False)
    keep = n >= 2
    P, n = P[keep], n[keep]
    M = max(P.shape[1], 3)
    if P.shape[1] < M:
        P = np.concatenate([P, np.repeat(P[:, -1:], M - P.shape[1], 1)], 1)
    A = np.concatenate([A, np.repeat(A[:, -1:], M - 3, 1)], 1) if M > 3 else A
    return np.concatenate([A, P]), np.concatenate([np.full(len(A), 3), n])


def _pad_polys(P2: np.ndarray, n: np.ndarray) -> np.ndarray:
    """Repeat the last valid vertex so every polygon has the same length (cv2 needs that)."""
    M = P2.shape[1]
    idx = np.minimum(np.arange(M)[None, :], (n - 1)[:, None])
    return np.take_along_axis(P2, idx[..., None].repeat(2, 2), axis=1)


def rasterize(mask: np.ndarray, px: np.ndarray, n: np.ndarray, value=1):
    """Fill polygons (pixel coords) into mask; degenerate (vertical) ones are drawn as lines."""
    if len(px) == 0:
        return
    pts = np.round(_pad_polys(px, n) * (1 << SHIFT)).astype(np.int32)
    x, y = px[..., 0], px[..., 1]
    area = 0.5 * np.abs((x * np.roll(y, -1, 1) - np.roll(x, -1, 1) * y).sum(1))
    thin = area < 0.5
    if (~thin).any():
        cv2.fillPoly(mask, list(pts[~thin]), value, lineType=cv2.LINE_8, shift=SHIFT)
    if thin.any():
        cv2.polylines(mask, list(pts[thin]), True, value, 1, lineType=cv2.LINE_8, shift=SHIFT)


def _local_fill(spec: GridSpec, P: np.ndarray, n: np.ndarray, value=1):
    """Rasterize into the smallest sub-grid; returns (row0, col0, mask) or None."""
    if len(P) == 0:
        return None
    px = spec.to_px(P[..., :2])
    valid = np.arange(P.shape[1])[None, :] < n[:, None]
    xs, ys = px[..., 0][valid], px[..., 1][valid]
    c0, c1 = max(int(np.floor(xs.min())) - 1, 0), min(int(np.ceil(xs.max())) + 2, spec.width)
    r0, r1 = max(int(np.floor(ys.min())) - 1, 0), min(int(np.ceil(ys.max())) + 2, spec.height)
    if c1 <= c0 or r1 <= r0:
        return None
    mask = np.zeros((r1 - r0, c1 - c0), np.uint8)
    rasterize(mask, px - np.array([c0, r0]), n, value)
    return r0, c0, mask


def build_layers(spec: GridSpec, entities: list[tuple[int, np.ndarray]]):
    """entities: (label, triangles) in paint order. Returns (layers, floor_h, counts).

    layers: {name: int32 (H, W) label grid}; floor_h: float32 max geometry height in the
    floor band (0 = nothing); counts: {label: {layer: cells}}.
    """
    layers = {k: np.full((spec.height, spec.width), -1, np.int32) for k in LAYERS}
    floor_h = np.zeros((spec.height, spec.width), np.float32)
    counts: dict[int, dict[str, int]] = {}
    steps = np.linspace(FLOOR_BAND[0], FLOOR_BAND[1], 11)[1:]  # 5 mm height bins
    for label, tris in entities:
        c = counts.setdefault(label, {})
        for name, (z0, z1) in LAYERS.items():
            P, n = clip_band(tris, z0, z1)
            got = _local_fill(spec, P, n)
            if got is None:
                continue
            r0, c0, m = got
            sel = m > 0
            layers[name][r0:r0 + m.shape[0], c0:c0 + m.shape[1]][sel] = label
            c[name] = c.get(name, 0) + int(sel.sum())
        P, n = clip_band(tris, *FLOOR_BAND)
        if len(P):
            valid = np.arange(P.shape[1])[None, :] < n[:, None]
            ztop = np.where(valid, P[..., 2], -1).max(1)
            for i, hi in enumerate(steps):
                lo = steps[i - 1] if i else -1.0
                sel = (ztop > lo) & (ztop <= hi) if i else (ztop <= hi)
                got = _local_fill(spec, P[sel], n[sel])
                if got is None:
                    continue
                r0, c0, m = got
                view = floor_h[r0:r0 + m.shape[0], c0:c0 + m.shape[1]]
                np.maximum(view, np.where(m > 0, np.float32(hi), np.float32(0)), out=view)
    return layers, floor_h, counts


def save_npz(path, spec: GridSpec, layers, floor_h, labels: list[str], extra: dict | None = None):
    """extra: additional named grids (e.g. room labels), stored as extra_<name>."""
    np.savez_compressed(path, floor_h=floor_h, labels=np.array(labels), spec=np.array(
        [spec.x0, spec.y0, spec.width, spec.height, spec.res]), **{f"layer_{k}": v for k, v in layers.items()},
        **{f"extra_{k}": v for k, v in (extra or {}).items()})


def load_npz(path):
    """Returns (spec, layers, floor_h, labels, extra)."""
    z = np.load(path, allow_pickle=False)
    x0, y0, w, h, res = z["spec"]
    spec = GridSpec(float(x0), float(y0), int(w), int(h), float(res))
    layers = {k[6:]: z[k] for k in z.files if k.startswith("layer_")}
    extra = {k[6:]: z[k] for k in z.files if k.startswith("extra_")}
    return spec, layers, z["floor_h"], list(z["labels"]), extra
