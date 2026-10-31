"""Generate a MOCK sim result for H1 so the web UI can be built before the evaluator exists.

Not evaluator output: disc planning on the body layer, crude goal checks, greedy furniture moves, and a small
grid of priced candidate plans (furniture x bathroom fittings x door work) built from a SAMPLE price table.
The file carries "mock": true and the UI shows a watermark. Never use it for video or report numbers.

    python web/tools/make_mock.py        # writes web/mock/H1/sim_result.json
"""
import heapq
import json
import math
import pathlib

import numpy as np
import yaml
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIX = ROOT / "tests/fixtures/H1"
OUT = ROOT / "web/mock/H1/sim_result.json"
TASK_NAMES = {"T1": "入户到沙发", "T2": "卧室到卫生间", "T3": "取用冰箱", "T4": "床椅转移"}

ir = json.loads((FIX / "scene_ir.json").read_text())
occ = np.load(FIX / "occupancy.npz")
G = ir["occupancy"]["grid"]
RES, X0, Y0 = G["res"], G["x0"], G["y0"]
LABELS = [str(s) for s in occ["labels"]]
ROOMS = ir["occupancy"]["room_index"]
ROOM = occ["extra_room"]
DOOR = {i for i, s in enumerate(LABELS) if s.startswith("door:")}
OBJ = {o["id"]: o for o in ir["objects"]}
cards = yaml.safe_load((ROOT / "src/ha/resident/personas.yaml").read_text())
PERSONAS = [p for p in cards["personas"] if p["id"] in cards["tasks"] and p["id"] != "stretcher"]


def cell(x, y):
    return int((y - Y0) / RES), int((x - X0) / RES)


def xy(i, j):
    return X0 + (j + 0.5) * RES, Y0 + (i + 0.5) * RES


def label_grid(layer):
    g = occ[layer].copy()
    g[np.isin(g, list(DOOR))] = -1
    return g


BASE = {"body": label_grid("layer_body"), "toe": label_grid("layer_toe")}


def half_width(p):
    f = p["footprint"]
    return f["size"][0] / 2 if f["shape"] == "rect" else f["r"]


def field(grids, p):
    lab = grids["body"].copy()
    if p["footprint"].get("layers", {}).get("toe"):
        lab = np.where(lab >= 0, lab, grids["toe"])
    solid = lab >= 0
    d, (ii, jj) = ndimage.distance_transform_edt(~solid, return_indices=True)
    return d * RES - RES / 2, lab[ii, jj]


def nearest_free(dist, room_id, x, y, r):
    in_room = ROOM < 0 if room_id is None else ROOM == ROOMS.index(room_id)
    mask = (dist >= r) & in_room
    if not mask.any():
        mask = (dist >= 0.15) & in_room
    ii, jj = np.nonzero(mask)
    ci, cj = cell(x, y)
    k = np.argmin((ii - ci) ** 2 + (jj - cj) ** 2)
    return int(ii[k]), int(jj[k])


def plan(dist, start, goal, r=0.15):
    h, w = dist.shape
    best = {start: 0.0}
    prev = {}
    pq = [(0.0, start)]
    while pq:
        c, u = heapq.heappop(pq)
        if u == goal:
            break
        if c > best[u]:
            continue
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                v = (u[0] + di, u[1] + dj)
                if (di or dj) and 0 <= v[0] < h and 0 <= v[1] < w and dist[v] >= r:
                    nc = c + math.hypot(di, dj) * (1 + 3 * max(0.0, 0.6 - dist[v]))
                    if nc < best.get(v, 1e18):
                        best[v], prev[v] = nc, u
                        heapq.heappush(pq, (nc, v))
    if goal not in prev:
        return None
    path = [goal]
    while path[-1] != start:
        path.append(prev[path[-1]])
    return path[::-1]


def centroid(obj_id):
    a = OBJ[obj_id]["aabb"]
    return (a["min"][0] + a["max"][0]) / 2, (a["min"][1] + a["max"][1]) / 2


def first(cat, room=None):
    return next((o["id"] for o in ir["objects"] if o["category"] == cat and (room is None or o["room"] == room)), None)


def door_side(door, room_id, offset):
    (cx, cy), (nx, ny) = door["center"], door["normal"]
    for s in (1, -1):
        x, y = cx + s * nx * offset, cy + s * ny * offset
        i, j = cell(x, y)
        rid = ROOM[i, j]
        if (room_id is None and rid < 0) or (room_id is not None and rid >= 0 and ROOMS[rid] == room_id):
            return x, y
    return cx + nx * offset, cy + ny * offset


ENTRY = next(d for d in ir["doors"] if len(d["rooms"]) == 1)
BED, TOILET, SOFA = first("bed", "masterBedroom1"), first("toilet", "bathroom1"), first("sofa", "livingRoom1")
FRIDGE = first("refrigerator")
BED_DOOR = next(d for d in ir["doors"] if "masterBedroom1" in d["rooms"] and "livingRoom1" in d["rooms"])


def task_ends(task):
    if task == "T1":
        return (None, *door_side(ENTRY, None, 1.0)), (OBJ[SOFA]["room"], *centroid(SOFA))
    if task == "T2":
        return (OBJ[BED]["room"], *centroid(BED)), (OBJ[TOILET]["room"], *centroid(TOILET))
    if task == "T4":
        return ("masterBedroom1", *door_side(BED_DOOR, "masterBedroom1", 0.8)), ("masterBedroom1", *centroid(BED))
    return None


def obj_id(lab):
    s = LABELS[lab] if lab >= 0 else "wall"
    return s.split(":", 1)[-1]


FIXED = {"toilet", "showerhead", "switch", "lightfixture", "bathroomcabinet"}
KEEP = {"bed", "sofa", "toilet", "refrigerator"}


def simulate(grids, p, task, door_w=None):
    rec = {"persona": p["id"], "task": task, "name": TASK_NAMES[task], "applicable": True}
    if task == "T3" and FRIDGE is None:
        return {**rec, "applicable": False, "reason": "户型里没有冰箱"}
    dist, near = field(grids, p)
    r = half_width(p)
    (sr, sx, sy), (gr, gx, gy) = task_ends(task)
    path = plan(dist, nearest_free(dist, sr, sx, sy, r + 0.02), nearest_free(dist, gr, gx, gy, r + 0.02))
    if path is None:
        return {**rec, "success": False, "fail_stage": "L0", "fail_code": "UNREACHABLE", "traj": [], "events": [],
                "violations": [], "monologue": [], "min_clearance_m": None, "min_clearance_object": None, "time_s": 0, "path_m": 0}
    clear = np.array([dist[c] - r for c in path])
    bad = np.nonzero(clear < 0)[0]
    stop = int(bad[0]) if len(bad) else len(path) - 1
    kin = p["kinematics"]
    traj, events, viol, mono = [], [], [], []
    t = 0.0
    pts = path[: stop + 1 : 3] + ([path[stop]] if stop % 3 else [])
    for k, c in enumerate(pts):
        x, y = xy(*c)
        if k:
            px, py = traj[-1][1], traj[-1][2]
            slow = kin.get("v_slow_mps") and dist[c] - r < kin.get("slow_when_clearance_below_m", 0)
            t += math.hypot(x - px, y - py) / (kin["v_slow_mps"] if slow else kin["v_mps"])
        nxt = xy(*pts[min(k + 1, len(pts) - 1)])
        yaw = math.atan2(nxt[1] - y, nxt[0] - x) if k + 1 < len(pts) else (traj[-1][3] if traj else 0.0)
        traj.append([round(t, 2), round(x, 3), round(y, 3), round(yaw, 3)])
    need = p.get("doors", {}).get("clear_width_m", {}).get("gb_retrofit")
    for d in ir["doors"]:
        hits = [q for q in traj if math.hypot(q[1] - d["center"][0], q[2] - d["center"][1]) < 0.3]
        if not hits:
            continue
        q = hits[0]
        cw = (door_w or {}).get(d["id"], d["clear_width"])
        events.append({"t": q[0], "type": "DOOR_PASS", "object_id": d["id"], "x": q[1], "y": q[2], "clear_width_m": cw})
        if need and cw < need:
            viol.append({"code": "DOOR_WIDTH", "object_id": d["id"], "measured": cw, "required": need,
                         "standard": "GB55019 2.5.4（改造）", "location": [q[1], q[2]], "source": "wsr", "severity": "yellow"})
    rec_ok, fail_code, fail_stage = stop == len(path) - 1, None, None
    if not rec_ok:
        c = path[stop]
        x, y = xy(*c)
        ob = obj_id(near[c])
        at_door = any(math.hypot(x - d["center"][0], y - d["center"][1]) < 0.4 for d in ir["doors"])
        fail_code, fail_stage = ("DOOR_WIDTH" if at_door else "CORRIDOR_WIDTH"), "L1"
        events.append({"t": traj[-1][0], "type": "CONTACT", "object_id": ob, "x": round(x, 3), "y": round(y, 3),
                       "penetration_m": round(float(-clear[stop]), 3)})
        viol.append({"code": fail_code, "object_id": ob, "measured": round(float(2 * dist[c]), 3), "required": round(2 * r, 3),
                     "standard": "外形宽度", "location": [round(x, 3), round(y, 3)], "source": "wsr", "severity": "red"})
        mono.append({"t": traj[-1][0], "text": f"这里只剩 {2 * dist[c]:.2f} 米宽，我需要 {2 * r:.2f} 米，过不去。", "source": "template"})
    elif p["id"] == "wheelchair" and task in ("T2", "T4"):
        g = path[-1]
        if task == "T2":
            code, need_m, std = "TURN_SPACE", 1.50, "GB50763 3.5.3"
            measured = float(2 * dist[ROOM == ROOMS.index(gr)].max())
        else:
            code, need_m, std = "TRANSFER_ZONE", 1.20, "GB55019 3.4.6"
            ii, jj = np.nonzero(ROOM == ROOMS.index(gr))
            near_goal = np.hypot(ii - g[0], jj - g[1]) * RES <= 1.0
            measured = float(2 * dist[ii[near_goal], jj[near_goal]].max())
        if measured < need_m:
            rec_ok, fail_code, fail_stage = False, code, "L2"
            x, y = xy(*g)
            viol.append({"code": code, "object_id": obj_id(near[g]), "measured": round(measured, 3), "required": need_m,
                         "standard": std, "location": [round(x, 3), round(y, 3)], "source": "wsr", "severity": "red"})
            mono.append({"t": traj[-1][0], "text": f"这里最多 {measured:.2f} 米，我要 {need_m:.2f} 米。", "source": "template"})
    events.append({"t": traj[-1][0], "type": "ARRIVE" if rec_ok else "GIVE_UP", "x": traj[-1][1], "y": traj[-1][2]})
    k = int(np.argmin(clear[: stop + 1]))
    return {**rec, "success": rec_ok, "fail_stage": fail_stage, "fail_code": fail_code,
            "min_clearance_m": round(float(clear[k]), 3), "min_clearance_object": obj_id(near[path[k]]),
            "time_s": traj[-1][0], "path_m": round(len(path) * RES, 2), "traj": traj, "events": events,
            "violations": viol, "monologue": mono}


def run_all(grids, door_w=None):
    return [simulate(grids, p, t, door_w) for p in PERSONAS for t in cards["tasks"][p["id"]] if t in TASK_NAMES]


def score(runs):
    app = [r for r in runs if r["applicable"]]
    sev = [v["severity"] for r in app for v in r["violations"]]
    s = 100 * sum(r["success"] for r in app) / len(app) - 5 * sev.count("red") - 2 * sev.count("yellow")
    return round(max(0.0, min(100.0, s)), 1)


def apply_edit(grids, edit):
    """Grid after one edit, or None if a move overlaps. Door work changes clear widths only (see door_w)."""
    if edit["op"].startswith("door_"):
        return grids
    idx = LABELS.index("obj:" + edit["object_id"])
    out = {}
    for name, g in grids.items():
        g = g.copy()
        if edit["op"] == "replace":  # a smaller product in the same place: erode the footprint
            m = g == idx
            g[m & ~ndimage.binary_erosion(m, iterations=round(edit["shrink_m"] / RES))] = -1
            out[name] = g
            continue
        ii, jj = np.nonzero(g == idx)
        g[ii, jj] = -1
        if edit["op"] == "move":
            ni, nj = ii + round(edit["dy"] / RES), jj + round(edit["dx"] / RES)
            if ni.min() < 0 or nj.min() < 0 or ni.max() >= g.shape[0] or nj.max() >= g.shape[1] or (g[ni, nj] >= 0).any():
                return None
            g[ni, nj] = idx
        out[name] = g
    return out


def key(r):
    return r["persona"], r["task"]


def repair(base_runs):
    grids, runs, edits, tried = BASE, base_runs, [], []
    for target in [r for r in base_runs if r["applicable"] and not r["success"]]:
        cur = {key(r): r for r in runs}[key(target)]
        if cur["success"]:
            continue
        red = next((v for v in cur["violations"] if v["severity"] == "red"), None)
        if red is None:
            continue
        lx, ly = red["location"]
        near = sorted((math.hypot(lx - centroid(o)[0], ly - centroid(o)[1]), o) for o in OBJ
                      if "obj:" + o in LABELS and math.hypot(lx - centroid(o)[0], ly - centroid(o)[1]) < 2.0)
        cands = []
        for _, o in near[:4]:
            cat = OBJ[o]["category"]
            if cat in FIXED:
                tried.append({"target": list(key(target)), "object_id": o, "result": "固定设施，不挪动"})
                continue
            cands += [{"op": "move", "object_id": o, "dx": dx, "dy": dy}
                      for s in (0.3, 0.6) for dx, dy in ((s, 0), (-s, 0), (0, s), (0, -s))]
            if cat not in KEEP:
                cands.append({"op": "remove", "object_id": o})
        if not cands:
            tried.append({"target": list(key(target)), "object_id": red["object_id"], "result": "附近没有能动的家具"})
        for e in cands:
            g = apply_edit(grids, e)
            if g is None:
                tried.append({"target": list(key(target)), **e, "result": "和墙或其他家具重叠"})
                continue
            new = run_all(g)
            nd = {key(r): r for r in new}
            worse = [list(key(r)) for r in runs if r["applicable"] and r["success"] and not nd[key(r)]["success"]]
            fixed = nd[key(target)]["success"]
            tried.append({"target": list(key(target)), **e, "fixed": fixed, "worse": worse,
                          "result": "采纳" if fixed and not worse else ("有住户变差" if worse else "仍失败")})
            if fixed and not worse:
                grids, runs = g, new
                edits.append(e)
                break
    return edits, tried, runs


# SAMPLE prices (CNY), not quotes from product pages. The UI and report label them 样例.
PRICES = {
    "toilet": ("短款马桶（进深短 20 cm）", 2800),
    "bathroomcabinet": ("悬挂式洗手台（台下留空，进深短 30 cm）", 1600),
    "door_sliding": ("推拉门套件（含拆旧门）", 1280),
    "door_widen": ("门洞加宽到 0.90 m（拆改墙体、换门套）", 3500),
}


def priced(e, rent_ok, wall):
    name, price = PRICES.get(OBJ[e["object_id"]]["category"] if e["op"] == "replace" else e["op"], (None, 0))
    return {**e, "cost_cny": price, "rent_ok": rent_ok, "wall": wall,
            **({"product": {"name": name, "price_cny": price, "price_src": "样例"}} if name else {})}


def door_edit(d, op):
    # sliding: the leaf no longer stands in the opening, so the clear width gains about the leaf thickness and stop
    w = round(d["clear_width"] + 0.055, 3) if op == "door_sliding" else 0.90
    return priced({"op": op, "object_id": d["id"], "from_m": d["clear_width"], "clear_width_m": w}, False, op == "door_widen")


CN = {"wardrobe": "衣柜", "bed": "床", "sofa": "沙发", "chair": "椅子", "armchair": "扶手椅", "stool": "凳子",
      "cabinet": "柜子", "sidetable": "边几", "coffeetable": "茶几", "diningtable": "餐桌", "TVStand": "电视柜",
      "bedsidecabinet": "床头柜", "Nightstand": "床头柜", "floorlamp": "落地灯", "loungechair": "躺椅"}


def title(edits):
    parts, doors = [], {}
    room = {"livingRoom": "客厅", "masterBedroom": "主卧", "guestBedroom": "次卧", "bathroom": "卫生间", "balcony": "阳台"}

    def cn(o):
        cat = OBJ[o]["category"]
        twin = sum(x["category"] == cat for x in ir["objects"]) > 1
        return (room.get(OBJ[o]["room"].rstrip("0123456789"), "") if twin else "") + CN.get(cat, cat)
    for e in edits:
        if e["op"] == "remove":
            parts.append("移走" + cn(e["object_id"]))
        elif e["op"] == "move":
            parts.append("挪" + cn(e["object_id"]))
        elif e["op"] == "replace":
            parts.append("换" + PRICES[OBJ[e["object_id"]]["category"]][0].split("（")[0])
        else:
            doors[e["op"]] = doors.get(e["op"], 0) + 1
    parts += [f"{n} 扇门{'改推拉门' if op == 'door_sliding' else '加宽'}" for op, n in doors.items()]
    return " + ".join(parts)


def candidates(base, furniture):
    """Every combination of furniture edits, compact toilet and door work, each re-run for all residents."""
    narrow = [d for d in ir["doors"] if any(v["code"] == "DOOR_WIDTH" and v["object_id"] == d["id"]
                                           for r in base if r["applicable"] for v in r["violations"])]
    bath = [d for d in narrow if any(r.startswith("bathroom") for r in d["rooms"])]
    door_opts = [[], [door_edit(d, "door_sliding") for d in bath], [door_edit(d, "door_sliding") for d in narrow],
                 [door_edit(d, "door_widen") for d in narrow]]
    toilet = priced({"op": "replace", "object_id": TOILET, "shrink_m": 0.10}, False, False)
    basin = priced({"op": "replace", "object_id": first("bathroomcabinet", OBJ[TOILET]["room"]), "shrink_m": 0.15}, False, False)
    toilet_opts = [[], [toilet], [toilet, basin]]
    furn_opts = [[], [priced(e, True, False) for e in furniture]]
    out = []
    for fo in furn_opts:
        for to in toilet_opts:
            grids = BASE
            for e in fo + to:
                grids = apply_edit(grids, e)
            for do in door_opts:
                edits = fo + to + do
                if not edits or grids is None:
                    continue
                runs = run_all(grids, {e["object_id"]: e["clear_width_m"] for e in do})
                nd = {key(r): r for r in runs}
                worse = [list(key(r)) for r in base if r["applicable"] and r["success"] and not nd[key(r)]["success"]]
                out.append({"title": title(edits), "edits": edits, "cost_cny": sum(e["cost_cny"] for e in edits),
                            "rent_ok": all(e["rent_ok"] for e in edits), "wall": any(e["wall"] for e in edits),
                            "score": score(runs), "worse": worse, "runs": runs})
    out.sort(key=lambda c: (c["cost_cny"], -c["score"]))
    for i, c in enumerate(out):
        c["id"] = f"P{i + 1:02d}"
    return out


def main():
    base = run_all(BASE)
    furniture, tried, _ = repair(base)
    plans = candidates(base, furniture)
    out = {
        "mock": True,
        "generator": "web/tools/make_mock.py",
        "note": "前端开发用的样例，不是评估器输出。判定是圆盘近似和粗略的终点检查，价格是样例价格表，数字不能进视频和报告。",
        "scene_id": ir["scene_id"],
        "personas": [{"id": p["id"], "name": p["name"], "footprint": p["footprint"], "v_mps": p["kinematics"]["v_mps"]} for p in PERSONAS],
        "tasks": TASK_NAMES,
        "baseline": {"score": score(base), "runs": base},
        "search": {"tried": tried, "candidates": len(plans)},
        "plans": [{"id": c["id"], **{k: v for k, v in c.items() if k != "id"}} for c in plans],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    for r in base:
        print(r["persona"], r["task"], r.get("success"), r.get("fail_code"), r.get("min_clearance_m"), r.get("min_clearance_object"))
    print("baseline", out["baseline"]["score"], "furniture", furniture)
    for c in plans:
        fails = [f"{r['persona']}/{r['task']}:{r['fail_code']}" for r in c["runs"] if r["applicable"] and not r["success"]]
        print(c["id"], c["cost_cny"], c["score"], c["title"], "worse", c["worse"], "fails", fails)
    print(OUT, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
