"""Joint kinematics for door leaves: world-space pose of body1 at a given joint position.

USD/PhysX joints: frame0 = (localPos0, localRot0) in body0 space, frame1 = (localPos1, localRot1) in body1
space; the joint coordinate moves frame1 relative to frame0 along/about `axis`. Composing the full chain
handles mirrored (negative-determinant) and scaled prim transforms, which a sign heuristic does not.
Matrices use the USD row-vector convention: p' = [p, 1] @ M.
"""
from __future__ import annotations

import math

import numpy as np

AXIS = {"X": np.array([1.0, 0, 0]), "Y": np.array([0, 1.0, 0]), "Z": np.array([0, 0, 1.0])}


def _quat_col(q) -> np.ndarray:
    """Column-vector rotation matrix from a Gf.Quat{f,d} (None -> identity)."""
    if q is None:
        return np.eye(3)
    w, (x, y, z) = q.GetReal(), q.GetImaginary()
    n = math.sqrt(w * w + x * x + y * y + z * z) or 1.0
    w, x, y, z = w / n, x / n, y / n, z / n
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def _affine(r_col=np.eye(3), t=(0, 0, 0)) -> np.ndarray:
    m = np.eye(4)
    m[:3, :3] = r_col.T
    m[3, :3] = t
    return m


def _axis_rot(a: np.ndarray, ang: float) -> np.ndarray:
    k = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + math.sin(ang) * k + (1 - math.cos(ang)) * (k @ k)


class JointChain:
    """Maps world points of the moving body (the leaf) to world points at joint position q.

    q is in radians for revolute joints and stage units for prismatic joints.
    """

    def __init__(self, *, revolute: bool, axis: str, lp0, lr0, lp1, lr1, b0_world, b1_world, leaf_is_body1=True):
        self.revolute = revolute
        self.a = AXIS[axis]
        self.f0 = _affine(_quat_col(lr0), lp0) @ b0_world   # joint frame0 -> world
        self.f1 = _affine(_quat_col(lr1), lp1) @ b1_world   # joint frame1 -> world
        self.leaf_is_body1 = leaf_is_body1

    def _j(self, q: float) -> np.ndarray:
        if self.revolute:
            return _affine(_axis_rot(self.a, q))
        return _affine(t=self.a * q)

    def matrix(self, q: float) -> np.ndarray:
        """World -> world transform of the leaf at joint position q (identity at q = 0 if frames agree)."""
        if self.leaf_is_body1:   # leaf rides on frame1: p1 = p_w @ inv(f1); p_w' = p1 @ J @ f0
            return np.linalg.inv(self.f1) @ self._j(q) @ self.f0
        return np.linalg.inv(self.f0) @ np.linalg.inv(self._j(q)) @ self.f1

    def apply(self, pts: np.ndarray, q: float) -> np.ndarray:
        m = self.matrix(q)
        shp = pts.shape
        p = pts.reshape(-1, 3)
        return (p @ m[:3, :3] + m[3, :3]).reshape(shp)

    def pivot_world(self) -> np.ndarray:
        return self.f0[3, :3].copy()

    def axis_world(self) -> np.ndarray:
        v = self.a @ self.f0[:3, :3]
        return v / (np.linalg.norm(v) or 1.0)

    def rest_error(self, pts: np.ndarray) -> float:
        """Max displacement at q = 0 (non-zero means the authored frames disagree)."""
        return float(np.abs(self.apply(pts, 0.0) - pts).max()) if len(pts) else 0.0
