"""Top-down preview PNG of an imported home: rooms tinted, walls black, furniture grey, doors coloured by clear width."""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from .occupancy import load_npz

PALETTE = np.array([[230, 216, 173], [173, 216, 230], [200, 230, 200], [230, 200, 230], [210, 210, 240],
                    [240, 220, 200], [200, 240, 240], [240, 240, 200], [220, 200, 200], [200, 220, 240]], np.uint8)


def render(ir_dir: Path, scale: int = 4, threshold: float = 0.80) -> Path:
    ir = json.loads((ir_dir / "scene_ir.json").read_text())
    spec, layers, floor_h, labels, extra = load_npz(ir_dir / ir["occupancy"]["file"])
    room = extra["room"]
    img = np.full((spec.height, spec.width, 3), 255, np.uint8)
    inside = room >= 0
    img[inside] = PALETTE[room[inside] % len(PALETTE)]
    body, toe = layers["body"], layers["toe"]
    kind = np.array([lb.split(":")[0] for lb in labels])
    occ_any = np.maximum(body, toe)
    furn = (occ_any >= 0) & np.isin(occ_any, np.where((kind == "obj") | (kind == "misc"))[0])
    img[furn] = (150, 150, 150)
    img[np.isin(body, np.where(kind == "window")[0])] = (255, 160, 60)
    img[body == 0] = (30, 30, 30)
    img[np.isin(body, np.where(kind == "door")[0])] = (90, 60, 30)
    img = cv2.resize(img, (spec.width * scale, spec.height * scale), interpolation=cv2.INTER_NEAREST)
    img = np.ascontiguousarray(img[::-1])  # world +Y points up in the image
    H = spec.height * scale

    def px(p):
        return (int(round((p[0] - spec.x0) / spec.res * scale)), H - int(round((p[1] - spec.y0) / spec.res * scale)))

    for d in ir["doors"]:
        seg = d.get("clear_segment")
        if not seg:
            continue
        ok = d["clear_width"] >= threshold
        cv2.line(img, px(seg[0]), px(seg[1]), (0, 170, 0) if ok else (0, 0, 230), 3)
        c = px(d["center"])
        cv2.putText(img, f"{d['clear_width']:.2f}", (c[0] + 4, c[1] - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.4,
                    (0, 0, 0), 1, cv2.LINE_AA)
    for r in ir["rooms"]:
        if r["polygons"]:
            xy = np.array(r["polygons"][0])
            c = px(xy.mean(0))
            cv2.putText(img, r["id"], (c[0] - 25, c[1]), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (60, 0, 0), 1, cv2.LINE_AA)
    out = ir_dir / "preview.png"
    cv2.imwrite(str(out), img)
    return out
