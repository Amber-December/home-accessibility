"""Draw floor plans from a scene's IR and occupancy grid.

For each scene it writes web/plans/<scene>.png, an architectural-style plan (black walls, door swings, room names
and areas, scale bar) used as demo material for 上传平面图, and with --preview also web/lab/<scene>/preview.jpg in the
colour style of the other 实验室 previews.

  python web/tools/make_plans.py [--preview] scene000064 scene000021 office01
"""
import argparse
import json
import math
import pathlib

import numpy as np
from PIL import Image, ImageDraw, ImageFont

WEB = pathlib.Path(__file__).resolve().parents[1]
FONT = "/usr/share/fonts/truetype/arphic-gbsn00lp/gbsn00lp.ttf"
ROOM = {"livingRoom": "客厅", "masterBedroom": "主卧", "guestBedroom": "次卧", "childrensRoom": "儿童房", "eldersRoom": "老人房",
        "kitchen": "厨房", "bathroom": "卫生间", "corridor": "走廊", "balcony": "阳台", "diningRoom": "餐厅", "study": "书房"}
TINT = {"livingRoom": "#cdeff0", "masterBedroom": "#d8d4ec", "guestBedroom": "#d5e8cf", "childrensRoom": "#d5e8cf",
        "eldersRoom": "#d8d4ec", "kitchen": "#f4ecc0", "bathroom": "#cfe0f2", "corridor": "#f1d0d6", "balcony": "#e8e8e8"}


def font(size):
    try:
        return ImageFont.truetype(FONT, size)
    except OSError:
        return ImageFont.load_default()


def load(scene):
    d = WEB / "lab" / scene
    ir = json.loads((d / "scene_ir.json").read_text())
    z = np.load(d / ir["occupancy"]["file"])
    return ir, z


def frame(ir, z, ppm, pad):
    x0, y0, cols, rows, res = z["spec"]
    body = z["layer_body"]
    wall = body == 0
    ii, jj = np.nonzero(wall)
    bx0, bx1 = x0 + jj.min() * res, x0 + (jj.max() + 1) * res
    by0, by1 = y0 + ii.min() * res, y0 + (ii.max() + 1) * res
    w, h = int((bx1 - bx0) * ppm) + 2 * pad, int((by1 - by0) * ppm) + 2 * pad
    to = lambda x, y: (pad + (x - bx0) * ppm, pad + (by1 - y) * ppm)
    return w, h, to, (x0, y0, res, bx0, by1)


def cells(img_w, img_h, mask, spec, ppm, pad, colour):
    """Paint grid cells of `mask` onto a new RGBA layer."""
    x0, y0, res, bx0, by1 = spec
    rows, cols = mask.shape
    xs = pad + (x0 + np.arange(cols + 1) * res - bx0) * ppm
    ys = pad + (by1 - (y0 + np.arange(rows + 1) * res)) * ppm
    out = np.zeros((img_h, img_w), bool)
    ii, jj = np.nonzero(mask)
    for i, j in zip(ii, jj):
        a, b = int(round(xs[j])), int(round(xs[j + 1]))
        c, d = int(round(ys[i + 1])), int(round(ys[i]))
        out[max(c, 0):max(d, c + 1), max(a, 0):max(b, a + 1)] = True
    layer = Image.new("RGBA", (img_w, img_h), (0, 0, 0, 0))
    layer.paste(Image.new("RGBA", (img_w, img_h), colour), mask=Image.fromarray(out.astype(np.uint8) * 255))
    return layer


def room_name(r):
    return r.get("name") or ROOM.get(r["type"], r["type"])


def plan(scene, ppm):
    ir, z = load(scene)
    pad = 70
    w, h, to, spec = frame(ir, z, ppm, pad)
    im = Image.new("RGBA", (w, h + 60), "white")
    dr = ImageDraw.Draw(im)
    for r in ir["rooms"]:
        for p in r["polygons"]:
            dr.polygon([to(*q) for q in p], fill="#f6f6f4")
    for o in ir["objects"]:
        a, b = o["aabb"]["min"], o["aabb"]["max"]
        if len(b) < 3 or b[2] < 0.05:
            continue
        p, q = to(a[0], b[1]), to(b[0], a[1])
        dr.rectangle([p, q], outline="#9a9a9a", width=1)
    im.alpha_composite(cells(w, h + 60, z["layer_body"] == 0, spec, ppm, pad, (20, 20, 20, 255)))
    dr = ImageDraw.Draw(im)
    for d in ir["doors"]:
        (ax, ay), (bx, by) = d["opening_segment"]
        dr.line([to(ax, ay), to(bx, by)], fill="white", width=max(3, int(ppm * 0.16)))
        wd = math.hypot(bx - ax, by - ay)
        nx, ny = d["normal"]
        tip = to(ax + nx * wd, ay + ny * wd)
        dr.line([to(ax, ay), tip], fill="#333333", width=1)
        cx, cy = to(ax, ay)
        rr = wd * ppm
        start = math.degrees(math.atan2(tip[1] - cy, tip[0] - cx))
        end = math.degrees(math.atan2(to(bx, by)[1] - cy, to(bx, by)[0] - cx))
        lo, hi = sorted([start, end])
        if hi - lo > 180:
            lo, hi = hi, lo + 360
        dr.arc([cx - rr, cy - rr, cx + rr, cy + rr], lo, hi, fill="#666666", width=1)
    f, fs = font(max(12, int(ppm * 0.32))), font(max(10, int(ppm * 0.24)))
    for r in ir["rooms"]:
        p = max(r["polygons"], key=lambda p: abs(sum(p[i][0] * p[i + 1][1] - p[i + 1][0] * p[i][1] for i in range(len(p) - 1))))
        cx, cy = to(sum(q[0] for q in p[:-1]) / (len(p) - 1), sum(q[1] for q in p[:-1]) / (len(p) - 1))
        dr.text((cx, cy - 8), room_name(r), fill="#222222", font=f, anchor="mm")
        dr.text((cx, cy + 12), f"{r['area']:.1f} 平方米", fill="#555555", font=fs, anchor="mm")
    ft = font(22)
    title = "办公楼层平面图" if ir.get("kind") == "office" else "住宅平面图"
    dr.text((pad, 24), title, fill="#111111", font=ft, anchor="lm")
    y = h + 20
    dr.line([(pad, y), (pad + 2 * ppm, y)], fill="#111111", width=3)
    for k in range(3):
        dr.line([(pad + k * ppm, y - 6), (pad + k * ppm, y + 6)], fill="#111111", width=2)
    dr.text((pad + 2 * ppm + 10, y), "2 m", fill="#111111", font=fs, anchor="lm")
    out = WEB / "plans" / f"{scene}.png"
    out.parent.mkdir(exist_ok=True)
    im.convert("RGB").save(out, optimize=True)
    return out


def preview(scene, size=360):
    ir, z = load(scene)
    x0, y0, cols, rows, res = z["spec"]
    rgb = np.full((int(rows), int(cols), 3), 255, np.uint8)
    room = z["extra_room"]
    idx = ir["occupancy"]["room_index"]
    types = {r["id"]: r["type"] for r in ir["rooms"]}
    for k, rid in enumerate(idx):
        c = TINT.get(types.get(rid), "#dfe7f2").lstrip("#")
        rgb[room == k] = [int(c[i:i + 2], 16) for i in (0, 2, 4)]
    body = z["layer_body"]
    rgb[body > 0] = (120, 120, 120)
    rgb[body == 0] = (40, 40, 48)
    im = Image.fromarray(rgb[::-1])
    im.thumbnail((size, size))
    canvas = Image.new("RGB", (size, int(size * 0.75)), "white")
    canvas.paste(im, ((canvas.width - im.width) // 2, (canvas.height - im.height) // 2))
    out = WEB / "lab" / scene / "preview.jpg"
    canvas.save(out, "JPEG", quality=82)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("scenes", nargs="+")
    a = ap.parse_args()
    for s in a.scenes:
        print(plan(s, 40 if s.startswith("scene") else 32))
        if a.preview:
            print(preview(s))


if __name__ == "__main__":
    main()
