"""Build the 素材库 catalog from the IKEA furniture set in $HA_DATA/ikea-model.

Writes web/library/catalog.json and small JPEGs per product: the IKEA photo, the inputs the pipeline read (尺寸图,
功能图), the model render and, for rigged furniture, the open pose. Each item carries what the pipeline did in between
(movable parts found, dimension sources, rescale, visual review, joint check). GLBs are copied only for
products that some result file uses (web/mock/*/sim_result.json, web/lab/*/sim_result.json), with textures
re-encoded to 512 px JPEG. Run it once before make_mock.py (catalog) and once after (GLBs).

    python web/tools/make_catalog.py
"""
import io
import json
import os
import pathlib
import struct

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = pathlib.Path(os.environ["HA_DATA"]) / "ikea-model"
OUT = ROOT / "web/library"

# IKEA category -> Scene IR categories it can stand in for, and a SAMPLE price (CNY), not a quote.
CATS = {
    "沙发": (["sofa"], 1999), "床": (["bed"], 1499), "衣物收纳柜": (["wardrobe"], 999), "餐桌": (["diningtable"], 799),
    "茶几": (["coffeetable"], 399), "电视柜": (["tvstand"], 599), "床边与小桌": (["nightstand", "bedsidecabinet", "sidetable"], 199),
    "扶手椅": (["armchair", "loungechair"], 899), "餐椅": (["chair"], 299), "书桌和办公桌": (["desk"], 599),
    "斗柜和抽屉柜": (["chestofdrawers"], 799), "书柜和置物架": (["bookcase", "shelf"], 399), "凳子": (["stool"], 99),
    "书桌椅和办公椅": (["officechair"], 499), "展示与餐边柜": (["sideboard"], 999),
}


def words(s):
    """The dataset notes say 重建 for modelling a piece; the page says 建模."""
    return s.replace("重建", "建模")


def thumb(src, dst, px=240):
    im = Image.open(src).convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    im = Image.alpha_composite(bg, im).convert("RGB")
    im.thumbnail((px, px))
    im.save(dst, "JPEG", quality=80)


def shrink_glb(src, dst, px=512):
    """Copy a GLB with every embedded image re-encoded as JPEG no larger than px."""
    b = src.read_bytes()
    n = struct.unpack_from("<I", b, 12)[0]
    j = json.loads(b[20:20 + n])
    bin0 = b[20 + n + 8:]
    views, blob = j["bufferViews"], bytearray()
    images = {im["bufferView"]: k for k, im in enumerate(j.get("images", []))}
    for i, v in enumerate(views):
        data = bin0[v.get("byteOffset", 0): v.get("byteOffset", 0) + v["byteLength"]]
        if i in images:
            im = Image.open(io.BytesIO(data)).convert("RGB")
            im.thumbnail((px, px))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=82)
            data = buf.getvalue()
            j["images"][images[i]]["mimeType"] = "image/jpeg"
        while len(blob) % 4:
            blob.append(0)
        v["byteOffset"], v["byteLength"] = len(blob), len(data)
        blob += data
    while len(blob) % 4:
        blob.append(0)
    j["buffers"] = [{"byteLength": len(blob)}]
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    out = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + 8 + len(blob))
    out += struct.pack("<I4s", len(js), b"JSON") + js + struct.pack("<I4s", len(blob), b"BIN\0") + bytes(blob)
    dst.write_bytes(out)


def used_products():
    """Product id -> the first plan per home that swaps it in, as {home, plan, title}."""
    used = {}
    for f in sorted([*ROOT.glob("web/mock/*/sim_result.json"), *ROOT.glob("web/lab/*/sim_result.json")]):
        for p in json.loads(f.read_text()).get("plans", []):
            for e in p["edits"]:
                pid = e.get("product", {}).get("id")
                if pid and all(u["home"] != f.parent.name for u in used.get(pid, [])):
                    used.setdefault(pid, []).append({"home": f.parent.name, "plan": p["id"], "title": p["title"]})
    return used


# Movable parts the planner found in the product images; other kinds (fixed shelves, wall anchors) are not joints.
MECH = {"straight_sliding_drawer": "抽屉", "side_hinged_door": "门", "side_hinged_glass_door": "玻璃门",
        "seat_swivel": "座椅旋转", "vertical_height_adjustment": "升降", "vertical_height_travel": "升降",
        "adjustable_shelf": "可调隔板"}
DIM_SRC = {"official_record": "商品页", "dimension_image": "尺寸图"}


def load(p):
    return json.loads(p.read_text()) if p.exists() else {}


def harness(d, pid):
    """What the pipeline did between the IKEA page and the model: inputs, plan, rescale, review, joints."""
    ap, vm, rv = load(d / "agent_plan.json"), load(d / "visual_metadata.json"), load(d / "gpt_visual_review.json")
    ph = load(d / "physics_validation.json")
    ins = sorted((d / "reference_inputs").glob("*.jpg"), key=lambda f: ("measure" not in f.name, f.name))[:2]
    inputs = []
    for k, f in enumerate(ins):
        thumb(f, OUT / f"img/{pid}-in{k}.jpg", 200)
        inputs.append({"img": f"library/img/{pid}-in{k}.jpg", "kind": "尺寸图" if "measure" in f.name else "功能图"})
    mech = {}
    for m in ap.get("mechanisms", []):
        if m["kind"] in MECH:
            mech[MECH[m["kind"]]] = mech.get(MECH[m["kind"]], 0) + int(m.get("count") or 1)
    src = ap.get("dimension_sources") or vm.get("dimension_sources") or {}
    dims = {k: [DIM_SRC.get(s.split(":")[0], "估计"), s.split(":", 1)[1].strip() if ":" in s else ""] for k, s in src.items()}
    rescale = None
    if vm.get("api_mesh_used") and vm.get("original_size"):
        rescale = {"from": [round(v, 2) for v in vm["original_size"]], "to": [round(v, 2) for v in vm["closed_size"]]}
    open_img = None
    if (d / "preview_open.png").exists():
        thumb(d / "preview_open.png", OUT / f"img/{pid}-open.jpg")
        open_img = f"library/img/{pid}-open.jpg"
    return {
        "inputs": inputs, "route_note": words(ap.get("reason", "")), "mechanisms": mech, "dims_src": dims, "rescale": rescale,
        "review": rv.get("similarity_score_1_to_5"),
        "joints": {"n": ph["joint_count"], "configs": ph.get("sampled_configurations"),
                   "penetration_m": ph.get("worst_static_penetration_m"), "passed": ph.get("passed")} if ph else None,
        "open_img": open_img,
    }


def main():
    (OUT / "img").mkdir(parents=True, exist_ok=True)
    (OUT / "models").mkdir(parents=True, exist_ok=True)
    used, items = used_products(), []
    for d in sorted(SRC.glob("*/*/model.glb")):
        d = d.parent
        sp = json.loads((d / "source_product.json").read_text())
        vm = json.loads((d / "visual_metadata.json").read_text())
        st = json.loads((d / "state.json").read_text())
        pid, cat = d.name, d.parent.name
        W, D, H = (round(v, 3) for v in vm["closed_size"])
        lux = bool(vm.get("api_mesh_used"))
        view = st.get("best_preview_view", 0) or 0
        thumb(d / "reference.jpg", OUT / f"img/{pid}-ref.jpg")
        thumb(d / f"preview_view{view * 90 if view < 4 else view}.png", OUT / f"img/{pid}.jpg")
        glb = None
        if pid in used:
            shrink_glb(d / "model.glb", OUT / f"models/{pid}.glb")
            glb = f"library/models/{pid}.glb"
        items.append({
            "id": pid, "name": sp["name"], "variant": sp.get("variant", {}).get("color", ""), "category": cat,
            "ir": CATS[cat][0], "size_m": [W, D, H], "dims_cm": sp.get("dimensions_cm", {}), "url": sp["source_url"],
            "lux3d": lux, "limitations": [words(s) for s in st.get("limitations", [])],
            "price_cny": CATS[cat][1], "price_src": "样例",
            "img": f"library/img/{pid}.jpg", "ref": f"library/img/{pid}-ref.jpg", "glb": glb,
            "harness": harness(d, pid), "used_in": used.get(pid, []),
        })
    for f in (OUT / "models").glob("*.glb"):
        if f.stem not in used:
            f.unlink()
    (OUT / "catalog.json").write_text(json.dumps({
        "source": "IKEA 中国官网商品页（商品图、尺寸图、标称尺寸）。静态家具由 Aholo Lux3D 按商品图生成，再按标称尺寸缩放；"
                  "带门、抽屉、升降等活动部件的家具加了关节骨骼，可开合，并在 MuJoCo 里检查关节行程和穿模",
        "price_note": "价格是按品类填的样例价，不是商品页报价",
        "items": items}, ensure_ascii=False, indent=1))
    rig = sum(bool(i["harness"]["joints"]) for i in items)
    print(len(items), "items;", sum(i["lux3d"] for i in items), "lux3d;", rig, "rigged;", len(used), "GLBs:", sorted(used))


if __name__ == "__main__":
    main()
