/* Scene IR + layered occupancy -> IndoorLab grid, doors and task plans; IndoorLab results -> front-end runs.
   Pure (no DOM, no THREE): loaded by the sim worker after B's core, resident-nav, simulation, resident-tasks
   and standards-report. IR (x, y) maps to IndoorLab (x, z); IndoorLab faces (sin a, cos a), the IR yaw faces
   (cos yaw, sin yaw), so yaw = pi/2 - a. */
(function (root) {
  'use strict';
  const L = root.IndoorLab;
  const CELL = 0.1;
  const TASKS = [['T1', 'sofa'], ['T2', 'bathroom'], ['T3', 'fridge'], ['T4', 'transfer'], ['T5', 'evacuate'], ['T6', 'night'], ['T7', 'stretcher'], ['T8', 'clutter']];
  const T2B = Object.fromEntries(TASKS), B2T = Object.fromEntries(TASKS.map(([t, b]) => [b, t]));
  const NAMES = Object.fromEntries([...L.RESIDENT_TASKS, ...L.RESIDENT_EXTRA_TASKS].map(t => [B2T[t.id], t.name]));
  // Office floors (ir.kind 'office') run the same eight tasks between office anchors: a desk stands in for the bed,
  // the reception sofa for the living-room sofa and the pantry cabinet for the fridge.
  const OFFICE_NAMES = { T1: '入口到接待区沙发', T2: '工位到无障碍卫生间', T3: '茶水间取物', T4: '工位落座转移', T5: '工位紧急疏散',
    T6: '夜间加班去卫生间', T7: '急救担架进出', T8: '入口杂物容错' };
  const namesFor = ir => (ir && ir.kind === 'office' ? { ...NAMES, ...OFFICE_NAMES } : NAMES);
  L.ROUTE_BUDGET = 240000;

  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const snap = a => wrap(Math.round(a / (Math.PI / 4)) * (Math.PI / 4));
  const face = (x, z) => snap(Math.atan2(x, z));
  function centroid(poly) {
    const pts = poly.length > 1 && poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1] ? poly.slice(0, -1) : poly;
    return pts.reduce((a, p) => ({ x: a.x + p[0] / pts.length, z: a.z + p[1] / pts.length }), { x: 0, z: 0 });
  }
  const boxOf = o => ({ minX: o.aabb.min[0], minZ: o.aabb.min[1], maxX: o.aabb.max[0], maxZ: o.aabb.max[1] });
  const pointBox = p => ({ minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z });
  const mid = b => ({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 });

  // Label grid after plan edits (same rules as the clearance heatmap): remove clears, move shifts, replace erodes.
  function edited(occ, layer, edits) {
    const src = occ[layer];
    if (!edits || !edits.length) return src;
    const g = Int32Array.from(src), { rows, cols, res } = occ;
    for (const e of edits) {
      const idx = occ.labels.indexOf('obj:' + e.object_id); if (idx < 0) continue;
      const cells = [];
      for (let k = 0; k < g.length; k++) if (g[k] === idx) { cells.push(k); g[k] = -1; }
      if (e.op === 'move') {
        const di = Math.round((e.dy || 0) / res), dj = Math.round((e.dx || 0) / res);
        for (const k of cells) {
          const i = Math.floor(k / cols) + di, j = (k % cols) + dj;
          if (i >= 0 && j >= 0 && i < rows && j < cols) g[i * cols + j] = idx;
        }
      }
      if (e.op === 'replace' && e.place) {
        // Catalog product: keep the old cells inside its footprint, back against the old one's back.
        const [cx, cy] = e.place.center, [fx, fy] = e.place.front, [w, d] = e.product.size_m;
        for (const k of cells) {
          const x = occ.x0 + (k % cols + .5) * res - cx, y = occ.y0 + (Math.floor(k / cols) + .5) * res - cy;
          if (Math.abs(-x * fy + y * fx) <= w / 2 && Math.abs(x * fx + y * fy) <= d / 2) g[k] = idx;
        }
      } else if (e.op === 'replace') {
        const on = new Uint8Array(g.length); let cur = cells;
        cur.forEach(k => { on[k] = 1; });
        for (let n = Math.round((e.shrink_m || 0) / res); n > 0; n--) {
          cur = cur.filter(k => on[k - 1] && on[k + 1] && on[k - cols] && on[k + cols]);
          on.fill(0); cur.forEach(k => { on[k] = 1; });
        }
        cur.forEach(k => { g[k] = idx; });
      }
    }
    return g;
  }

  function roomAt(sc, x, z) {
    const o = sc.occ, c = Math.floor((x - o.x0) / o.res), r = Math.floor((z - o.y0) / o.res);
    return c < 0 || r < 0 || c >= o.cols || r >= o.rows ? -1 : o.room[r * o.cols + c];
  }
  // Normal sign that points from the door centre into `room` (-1 room index = outside).
  function sideTo(sc, d, room) {
    const want = room === -1 ? -1 : sc.ir.occupancy.room_index.indexOf(room);
    for (const s of [1, -1]) for (const k of [.45, .7, 1]) {
      if (roomAt(sc, d.center[0] + d.normal[0] * s * k, d.center[1] + d.normal[1] * s * k) === want) return s;
    }
    return room === -1 ? 1 : -1;
  }
  const LANDING_CELLS = 26;
  const entryDoor = sc => sc.ir.doors.find(d => d.rooms.length === 1);

  function buildGrid(sc, edits = []) {
    const o = sc.occ, k = Math.round(CELL / o.res), ent = entryDoor(sc);
    // The occupancy ends at the outer wall; the landing outside the entry door needs room for a 1.9 m stretcher.
    const pad = [0, 0, 0, 0], out = ent ? [ent.normal[0] * sideTo(sc, ent, -1), ent.normal[1] * sideTo(sc, ent, -1)] : [0, 0];
    if (ent) pad[Math.abs(out[0]) > Math.abs(out[1]) ? (out[0] < 0 ? 0 : 1) : (out[1] < 0 ? 2 : 3)] = LANDING_CELLS;
    const c0 = pad[0], r0 = pad[2], cols = Math.ceil(o.cols / k) + pad[0] + pad[1], rows = Math.ceil(o.rows / k) + pad[2] + pad[3];
    const minX = o.x0 - c0 * CELL, minZ = o.y0 - r0 * CELL;
    const grid = new L.Grid({ minX, minZ, maxX: minX + cols * CELL - 1e-6, maxZ: minZ + rows * CELL - 1e-6 }, CELL);
    const body = edited(o, 'body', edits), toe = edited(o, 'toe', edits), lab = o.labels;
    const door = new Uint8Array(lab.length), wall = new Uint8Array(lab.length);
    lab.forEach((s, i) => {
      const j = s.indexOf(':'), kind = j < 0 ? s : s.slice(0, j), id = j < 0 ? s : s.slice(j + 1);
      if (kind === 'door') door[i] = 1;
      if (kind === 'wall') wall[i] = 1;
      grid.obstacles.push({ id: 'L' + i, name: sc.names[id] || (kind === 'wall' ? '墙' : kind === 'window' ? '窗' : id),
        kind: kind === 'obj' ? 'furniture' : kind, semanticId: kind === 'wall' ? 'wall' : id });
    });
    grid.support.fill(0);
    // Walls mark a coarse cell if any fine cell under it is wall, so thin walls never leak. Furniture marks it when it
    // covers at least half the fine cells, so a gap between two pieces keeps its measured width instead of losing a cell per side.
    const furn = new Uint8Array(grid.size), furnOwner = new Int32Array(grid.size);
    for (let r = 0; r < o.rows; r++) for (let c = 0; c < o.cols; c++) {
      const fi = r * o.cols + c, gi = (Math.floor(r / k) + r0) * cols + Math.floor(c / k) + c0, b = body[fi], t = toe[fi];
      if (o.room[fi] >= 0 || (b >= 0 && door[b]) || (t >= 0 && door[t])) grid.support[gi] = 1;
      const l = b >= 0 && !door[b] ? b : t >= 0 && !door[t] ? t : -1;
      if (l < 0) continue;
      if (wall[l]) { if (!grid.solid[gi]) { grid.solid[gi] = 1; grid.owner[gi] = l + 1; } continue; }
      furn[gi]++; furnOwner[gi] = l + 1;
    }
    for (let gi = 0; gi < grid.size; gi++) if (furn[gi] * 2 >= k * k) { grid.solid[gi] = 1; grid.owner[gi] = furnOwner[gi]; }
    // Doorway floor: openings carry no room id, so mark them walkable across the wall depth.
    for (const d of sc.ir.doors) {
      const half = (d.opening_width || d.clear_width || .9) / 2, depth = (d.depth || .2) / 2 + .1;
      for (let i = 0; i < grid.size; i++) {
        if (grid.support[i]) continue;
        const p = grid.point(i), dx = p.x - d.center[0], dz = p.z - d.center[1];
        if (Math.abs(dx * d.axis[0] + dz * d.axis[1]) <= half && Math.abs(dx * d.normal[0] + dz * d.normal[1]) <= depth) grid.support[i] = 1;
      }
    }
    // Widened doors: clear wall cells across the new opening.
    for (const e of edits) {
      if (e.op !== 'door_widen') continue;
      const d = sc.ir.doors.find(x => x.id === e.object_id); if (!d) continue;
      const half = e.clear_width_m / 2 + .03, depth = (d.depth || .2) / 2 + .06;
      for (let i = 0; i < grid.size; i++) {
        if (!grid.solid[i] || grid.obstacles[grid.owner[i]].kind !== 'wall') continue;
        const p = grid.point(i), dx = p.x - d.center[0], dz = p.z - d.center[1];
        if (Math.abs(dx * d.axis[0] + dz * d.axis[1]) <= half && Math.abs(dx * d.normal[0] + dz * d.normal[1]) <= depth) {
          grid.solid[i] = 0; grid.owner[i] = 0; grid.support[i] = 1;
        }
      }
    }
    // Landing outside the entry door so tasks can start and end in the stairwell.
    if (ent) {
      const s = sideTo(sc, ent, -1);
      for (let i = 0; i < grid.size; i++) {
        if (grid.solid[i]) continue;
        const p = grid.point(i), dx = p.x - ent.center[0], dz = p.z - ent.center[1];
        const along = dx * ent.axis[0] + dz * ent.axis[1], out = (dx * ent.normal[0] + dz * ent.normal[1]) * s;
        if (Math.abs(along) <= 1.4 && out > 0 && out <= 2.4) grid.support[i] = 1;
      }
    }
    grid.finalize();
    return grid;
  }
  // ---- doors: IR leaves -> B leaf lines (hinge + direction, or sliding track) ----
  const unit = (x, z) => { const n = Math.hypot(x, z) || 1; return { x: x / n, z: z / n }; };
  function leafOf(l) {
    const c = centroid(l.closed), o = centroid(l.open);
    if (l.kind === 'sliding') {
      const u = unit(l.slide_axis[0], l.slide_axis[1]);
      return { sliding: true, p0: { x: c.x - u.x * l.width / 2, z: c.z - u.z * l.width / 2 }, u, shift: { x: o.x - c.x, z: o.z - c.z } };
    }
    const pivot = { x: l.pivot[0], z: l.pivot[1] };
    const a0 = Math.atan2(c.z - pivot.z, c.x - pivot.x), a1 = Math.atan2(o.z - pivot.z, o.x - pivot.x);
    return { pivot, a0, da: wrap(a1 - a0) };
  }
  // The entry door's operating values follow B's built-in home (entry .95 m / .25, interior 1.05 m / .55).
  function buildDoors(sc, edits) {
    const out = [], ent = entryDoor(sc);
    for (const d of sc.ir.doors) {
      const leaves = d.leaves || []; if (!leaves.length) continue;
      const e = edits.find(x => x.object_id === d.id && (x.op === 'door_sliding' || x.op === 'door_widen'));
      const lever = edits.some(x => x.object_id === d.id && x.op === 'door_lever'), n0 = out.length;
      const reverse = edits.some(x => x.object_id === d.id && x.op === 'door_reverse');
      const LEVER = lever ? { effort: .2, handleHeight: .95, handleExtension: .16 } : {};
      const cw = e ? e.clear_width_m : d.clear_width != null ? d.clear_width : d.opening_width;
      const base = { name: sc.names[d.id] || d.id, x: d.center[0], z: d.center[1], center: { x: d.center[0], z: d.center[1] },
        normal: unit(d.normal[0], d.normal[1]), axisV: unit(d.axis[0], d.axis[1]), irId: d.id, rooms: d.rooms,
        handleHeight: d === ent ? .95 : 1.05, effort: d === ent ? .25 : .55, width: cw, clearWidth: cw };
      if (e && e.op === 'door_sliding') {
        const u = base.axisV, w = cw + .04;
        out.push({ ...base, id: d.id, leafWidth: w, effort: Math.min(base.effort, .3), ...LEVER,
          leaf: { sliding: true, p0: { x: base.x - u.x * w / 2, z: base.z - u.z * w / 2 }, u, shift: { x: u.x * w, z: u.z * w } } });
        continue;
      }
      const open = d.open_leaves && d.open_leaves.length ? d.open_leaves : [leaves[0].id];
      let main = false;
      for (const l of leaves) {
        const leaf = leafOf(l); let w = l.width;
        // B's reverse repair: the leaf swings to the other side of the wall.
        if (reverse && !leaf.sliding) leaf.da = -leaf.da;
        if (e && e.op === 'door_widen' && !leaf.sliding) {
          const k = cw - (d.clear_width || cw), u = base.axisV;
          const s = Math.sign((leaf.pivot.x - base.x) * u.x + (leaf.pivot.z - base.z) * u.z) || 1;
          w += k; leaf.pivot = { x: leaf.pivot.x + u.x * s * k / 2, z: leaf.pivot.z + u.z * s * k / 2 };
        }
        if (open.includes(l.id) && !main) { main = true; out.push({ ...base, id: d.id, leafWidth: w, leaf }); }
        else if (!open.includes(l.id)) out.push({ ...base, id: d.id + '#' + l.id, fixed: true, width: undefined, handleHeight: undefined, leafWidth: w, leaf });
      }
      // B's lever repair: low-effort handle at 0.95 m with a 0.16 m extension.
      out.slice(n0).forEach(x => { if (!x.fixed) Object.assign(x, LEVER); });
    }
    return out;
  }

  // ---- rooms: door / open-plan adjacency, BFS for the door sequence of a task ----
  const OUT = '__out__';
  function roomGraph(sc) {
    if (sc.graph) return sc.graph;
    const idx = sc.ir.occupancy.room_index, o = sc.occ, adj = new Map(), pairs = new Set();
    const add = (a, b, door) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push({ to: b, door }); };
    for (const d of sc.ir.doors) {
      const [a, b] = d.rooms.length === 1 ? [d.rooms[0], OUT] : d.rooms;
      add(a, b, d); add(b, a, d);
    }
    for (let r = 0; r < o.rows; r++) for (let c = 0; c < o.cols; c++) {
      const i = r * o.cols + c, a = o.room[i]; if (a < 0 || o.body[i] >= 0) continue;
      for (const k of [c + 1 < o.cols ? i + 1 : -1, r + 1 < o.rows ? i + o.cols : -1]) {
        if (k < 0 || o.body[k] >= 0) continue;
        const b = o.room[k]; if (b >= 0 && b !== a) pairs.add(Math.min(a, b) + '|' + Math.max(a, b));
      }
    }
    for (const p of pairs) { const [a, b] = p.split('|').map(n => idx[+n]); add(a, b, null); add(b, a, null); }
    return (sc.graph = adj);
  }
  function crossings(sc, from, to) {
    if (from === to) return [];
    const adj = roomGraph(sc), prev = new Map([[from, null]]), q = [from];
    while (q.length) {
      const a = q.shift(); if (a === to) break;
      for (const e of adj.get(a) || []) if (!prev.has(e.to)) { prev.set(e.to, { from: a, door: e.door }); q.push(e.to); }
    }
    if (!prev.has(to)) return null;
    const out = [];
    for (let r = to; prev.get(r); r = prev.get(r).from) out.unshift({ ...prev.get(r), to: r });
    return out;
  }
  // ---- model: B doors, spec items, task plans (same targets as the scorer's task table) ----
  function boxFor(o, edits) {
    const b = boxOf(o);
    for (const e of edits) {
      if (e.object_id !== o.id) continue;
      if (e.op === 'move') { b.minX += e.dx || 0; b.maxX += e.dx || 0; b.minZ += e.dy || 0; b.maxZ += e.dy || 0; }
      if (e.op === 'replace' && e.place) {
        const [cx, cz] = e.place.center, [w, d] = e.product.size_m, alongX = Math.abs(e.place.front[0]) > Math.abs(e.place.front[1]);
        const hx = (alongX ? d : w) / 2, hz = (alongX ? w : d) / 2;
        Object.assign(b, { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz });
      } else if (e.op === 'replace' && e.shrink_m) { const s = e.shrink_m; b.minX += s; b.maxX -= s; b.minZ += s; b.maxZ -= s; }
    }
    return b;
  }
  function buildModel(sc, edits = []) {
    const ir = sc.ir, gone = new Set(edits.filter(e => e.op === 'remove').map(e => e.object_id));
    const objs = ir.objects.filter(o => !gone.has(o.id));
    const doors = buildDoors(sc, edits), state = {};
    const model = { doors, irDoors: ir.doors, doorState: state, setDoor(id, v) { state[id] = v; }, taskPlans: {}, taskPoints: {}, missing: {}, ends: {},
      spec: { items: objs.map(o => ({ id: o.id, name: sc.names[o.id] || o.category, kind: String(o.category || '').toLowerCase() })) } };
    const cat = c => objs.filter(o => String(o.category || '').toLowerCase() === c);
    const first = (c, roomType) => { const all = cat(c); return all.find(o => roomType && String(o.room).startsWith(roomType)) || all[0] || null; };
    const office = ir.kind === 'office', ent = entryDoor(sc);
    model.names = namesFor(ir);
    const bed = office ? first('desk', 'openOffice') : first('bed', 'masterBedroom'), toilet = first('toilet', office ? 'accessibleToilet' : 'bathroom');
    const sofa = first('sofa', office ? 'reception' : 'livingRoom'), fridge = office ? first('cabinet', 'pantry') : first('refrigerator');
    const bedDoor = bed && (ir.doors.find(d => d.rooms.includes(bed.room) && d.rooms.some(r => r.startsWith('livingRoom')))
      || ir.doors.find(d => d.rooms.includes(bed.room) && !d.rooms.some(r => r.startsWith('bathroom'))));
    const named = (o, s) => ({ box: boxFor(o, edits), itemId: o.id, label: s + (sc.names[o.id] || o.category) });
    const outside = (d, k) => {
      const s = sideTo(sc, d, -1);
      return { x: d.center[0] + d.normal[0] * s * k, z: d.center[1] + d.normal[1] * s * k, angle: face(-d.normal[0] * s, -d.normal[1] * s) };
    };
    const leafy = new Set(doors.filter(d => !d.fixed).map(d => d.id));
    const route = (a, b) => {
      const cs = crossings(sc, a, b); if (!cs) return null;
      return cs.filter(c => c.door && leafy.has(c.door.id)).map(c => ({ door: c.door.id, side: sideTo(sc, c.door, c.from === OUT ? -1 : c.from) }));
    };
    const roomCentre = id => { const r = ir.rooms.find(r => r.id === id); return r ? centroid(r.polygons[0]) : null; };
    const plan = (t, need, build) => {
      const miss = need.find(([v]) => !v); if (miss) { model.missing[t] = miss[1]; return; }
      const p = build(); if (!p) { model.missing[t] = '房间之间没有连通的门洞'; return; }
      if (p.steps && p.steps.includes(null)) { model.missing[t] = '房间之间没有连通的门洞'; return; }
      model.taskPlans[t] = p;
    };
    const flat = (...xs) => xs.some(x => x === null) ? [null] : xs.flat();
    plan('sofa', [[ent, '没有入户门'], [sofa, '户型里没有沙发']], () => ({ start: outside(ent, 1.0), steps: flat(route(OUT, sofa.room),
      [{ goal: named(sofa, '靠近'), itemId: sofa.id, label: '靠近沙发' }, { wait: 1, label: '靠近沙发 / 完成' }]) }));
    plan('bathroom', [[bed, '户型里没有床'], [toilet, '户型里没有马桶']], () => ({ start: { box: boxFor(bed, edits), itemId: bed.id },
      steps: flat(route(bed.room, toilet.room), [{ goal: named(toilet, '靠近'), itemId: toilet.id, label: '前往马桶' }, { wait: 1, label: '到达马桶' }]) }));
    const fridgeH = edits.some(e => e.op === 'replace' && fridge && e.object_id === fridge.id) ? .95 : 1.55;
    plan('fridge', [[fridge, '户型里没有冰箱']], () => {
      const from = sofa ? sofa.room : fridge.room, c = roomCentre(from) || mid(boxFor(fridge, edits));
      return { start: { x: c.x, z: c.z, angle: 0, near: true }, steps: flat(route(from, fridge.room),
        [{ goal: named(fridge, '靠近'), itemId: fridge.id, label: '靠近冰箱' },
          { reach: { box: boxFor(fridge, edits), height: fridgeH }, itemId: fridge.id, label: '开启冰箱 / 取物' }]) };
    });
    plan('transfer', [[bed, '户型里没有床'], [bedDoor, '卧室没有门']], () => {
      const other = bedDoor.rooms.find(r => r !== bed.room) || OUT, s = sideTo(sc, bedDoor, other === OUT ? -1 : other);
      const start = { x: bedDoor.center[0] + bedDoor.normal[0] * s * .8, z: bedDoor.center[1] + bedDoor.normal[1] * s * .8,
        angle: face(-bedDoor.normal[0] * s, -bedDoor.normal[1] * s), near: true };
      return { start, steps: flat(route(other, bed.room), [{ transfer: { box: boxFor(bed, edits) }, itemId: bed.id }]) };
    });
    plan('evacuate', [[ent, '没有入户门'], [bed, '户型里没有床']], () => ({ start: { box: boxFor(bed, edits), itemId: bed.id },
      steps: flat(route(bed.room, OUT), [{ goal: outside(ent, 1.0), label: '疏散至门外' }]) }));
    plan('night', [[bed, '户型里没有床'], [toilet, '户型里没有马桶']], () => ({ start: { box: boxFor(bed, edits), itemId: bed.id },
      steps: flat(route(bed.room, toilet.room), [{ goal: named(toilet, '夜间前往'), itemId: toilet.id, label: '夜间前往马桶 / 低照度行走' },
        { wait: 1, label: '夜间到达马桶' }]) }));
    if (!ent) { model.missing.stretcher = model.missing.clutter = '没有入户门'; }
    else if (!bed) model.missing.stretcher = '户型里没有床';
    if (ent && bed) model.taskPoints.stretcher = { bed: boxFor(bed, edits), bedId: bed.id, target: outside(ent, 1.2) };
    if (ent && model.taskPlans.sofa) {
      const s = sideTo(sc, ent, ent.rooms[0]), u = unit(ent.axis[0], ent.axis[1]), pts = [];
      for (let i = -4; i <= 4; i++) pts.push({ x: ent.center[0] + ent.normal[0] * s * .85 + u.x * i * .42, z: ent.center[1] + ent.normal[1] * s * .85 + u.z * i * .42 });
      model.taskPoints.clutter = pts;
    } else if (ent) model.missing.clutter = model.missing.sofa;
    Object.assign(model.ends, { ent, bed, toilet, sofa, fridge, bedDoor });
    return model;
  }
  // ---- B results -> front-end runs ----
  const CODE = { closed_door: 'DOOR_OPEN', path_blocked: 'CORRIDOR_WIDTH', turn_failed: 'TURN_SPACE', reach_failed: 'REACH',
    door_operation: 'DOOR_OPEN', door_swing: 'DOOR_SWING', transfer_failed: 'TRANSFER_ZONE', stretcher_blocked: 'STRETCHER_BLOCK' };
  const CHECK = { CORRIDOR_WIDTH: 'CORRIDOR_WIDTH', TURN_SPACE: 'TURN_SPACE', TRANSFER_ZONE: 'TRANSFER_ZONE', REACH_HEIGHT: 'REACH',
    DOOR_OPERATION: 'DOOR_OPEN', DOOR_SWING_BLOCK: 'DOOR_SWING', DOOR_WIDTH: 'DOOR_WIDTH', STRETCHER_BLOCK: 'STRETCHER_BLOCK',
    CLUTTER_MARGIN: 'CLUTTER_MARGIN', LIGHT_DARK: 'LIGHT_DARK' };
  const r3 = v => Math.round(v * 1000) / 1000;
  const baseId = id => id == null ? null : String(id).split('#')[0];
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? r3(v) : null);
  function violationOf(c, loc, severity) {
    const req = c.required, required = typeof req === 'number' ? req : req && (req.gbExistingM ?? req.gbMaxM ?? req.max ?? req.gbDiameterM);
    const v = { code: CHECK[c.code] || c.code, object_id: baseId(c.objectId), measured: num(c.measured), required: num(required),
      standard: (c.standard || []).join(' / '), location: loc ? [r3(loc.x), r3(loc.z)] : null, source: c.source, severity, evidence: c.evidence,
      recommendation: c.recommendation || '' };
    if (v.measured == null || v.required == null) v.text = c.evidence;
    return v;
  }
  function doorPasses(model, trace) {
    const out = [];
    for (const d of model.doors) {
      if (d.fixed) continue;
      for (let k = 1; k < trace.length; k++) {
        const a = trace[k - 1], b = trace[k];
        const sa = (a.x - d.x) * d.normal.x + (a.z - d.z) * d.normal.z, sb = (b.x - d.x) * d.normal.x + (b.z - d.z) * d.normal.z;
        if (sa * sb <= 0 && sa !== sb && Math.abs((b.x - d.x) * d.axisV.x + (b.z - d.z) * d.axisV.z) < (d.leafWidth || 1) + .2) {
          out.push({ t: r3(b.time), type: 'DOOR_PASS', object_id: d.id, x: r3(b.x), y: r3(b.z), clear_width_m: num(d.clearWidth) }); break;
        }
      }
    }
    return out;
  }
  function convert(grid, model, profile, pid, tid, r, doorChecks) {
    const trace = r.trace || [], half = profile.width / 2;
    let best = Infinity, at = null;
    for (let k = 0; k < trace.length; k += 3) {
      const c = grid.clearanceAt(trace[k].x, trace[k].z, half); if (c < best) { best = c; at = trace[k]; }
    }
    const nearObj = at ? (grid.collisionAt(at.x, at.z, half + .6) || {}).obstacle : null;
    const events = doorPasses(model, trace), mono = [];
    const issues = r.issues || [];
    issues.forEach(i => {
      events.push({ t: r3(i.time), type: 'CONTACT', object_id: baseId(i.itemId), x: r3(i.x), y: r3(i.z), reason: i.reason });
      mono.push({ t: r3(i.time), text: i.reason, source: 'simulation' });
    });
    (r.probes || []).filter(p => p.hits.length).slice(0, 6).forEach(p => mono.push({ t: r3(p.time), text: `白杖碰到${p.hits[0].object}，沿边确认`, source: 'simulation' }));
    const end = trace[trace.length - 1] || { time: 0, x: 0, z: 0 };
    events.push({ t: r3(r.duration), type: r.success ? 'ARRIVE' : 'GIVE_UP', x: r3(end.x), y: r3(end.z) });
    const rep = L.buildStandardsReport([r], { doors: [], spec: model.spec }, profile, { generatedAt: '' });
    const fails = rep.checks.filter(c => c.status === 'fail');
    const viol = fails.map((c, k) => violationOf(c, issues[k] || end, 'red'));
    const passed = new Set(events.filter(e => e.type === 'DOOR_PASS').map(e => e.object_id));
    for (const c of doorChecks) if (passed.has(c.objectId)) {
      const d = model.doors.find(d => d.id === c.objectId); viol.push(violationOf(c, d, 'yellow'));
    }
    const code = !r.success ? (viol.find(v => v.severity === 'red') || {}).code || CODE[(issues[0] || {}).code] || 'UNREACHABLE' : null;
    return { persona: pid, task: tid, name: model.names[tid] || r.name, applicable: true, success: !!r.success,
      fail_code: code, fail_stage: issues[0] ? issues[0].code : null, fail_reason: issues[0] ? issues[0].reason : null,
      min_clearance_m: r3(Number.isFinite(r.minClearance) ? r.minClearance : 0),
      min_clearance_object: (issues[0] && baseId(issues[0].itemId)) || (nearObj && nearObj.semanticId) || null,
      time_s: Math.round(r.duration * 100) / 100, path_m: Math.round(r.distance * 100) / 100,
      traj: trace.map(p => [r3(p.time), r3(p.x), r3(p.z), r3(wrap(Math.PI / 2 - p.angle))]),
      actions: r.actions || [], events: events.sort((a, b) => a.t - b.t), violations: viol,
      monologue: mono.sort((a, b) => a.t - b.t), checks: rep.checks, clutter: r.clutter || null, stretcher: r.stretcher || null,
      risk: riskOf(grid, model, profile, r) };
  }
  // Risk points, same accumulation as B's Simulation.event: closed_door -> contact, other issues -> blocked + obstruction;
  // near-time where the body is within .35 m of an obstacle (B's base tick).
  function riskOf(grid, model, profile, r) {
    const near = new Map(), trace = r.trace || [], half = profile.width / 2;
    for (let k = 1; k < trace.length; k++) {
      const p = trace[k], i = grid.index(p.x, p.z); if (i < 0) continue;
      if (grid.distance[i] - half < .35) near.set(i, (near.get(i) || 0) + (p.time - trace[k - 1].time));
    }
    const incidents = (r.issues || []).map(issue => {
      const i = grid.index(issue.x, issue.z), id = baseId(issue.itemId);
      const ob = grid.obstacles.find(o => o.semanticId === id);
      const door = model.doors.find(d => d.id === issue.itemId || d.irId === id);
      return { i, type: issue.code === 'closed_door' ? 'contact' : 'blocked', code: issue.code, reason: issue.reason, t: r3(issue.time),
        x: r3(issue.x), z: r3(issue.z), obstacle: { id: id || 'task', name: (door && door.name) || (ob && ob.name) || id || '任务操作区', kind: door ? 'door' : ob ? ob.kind : 'task' } };
    });
    return { near: [...near].map(([i, v]) => [i, r3(v)]), incidents };
  }

  function resolveStart(grid, profile, st) {
    if (!st || !st.near) return st;
    const i = grid.nearest(st, Math.max(profile.width, profile.length) / 2);
    return i < 0 ? st : { ...grid.point(i), angle: st.angle || 0 };
  }
  // Closest clear pose to p (cells sorted by distance, given headings first-come).
  function poseNear(grid, p, w, l, angles, maxR) {
    const N = L.ResidentNav, c0 = Math.floor((p.x - grid.minX) / grid.cell), r0 = Math.floor((p.z - grid.minZ) / grid.cell), R = Math.ceil(maxR / grid.cell), cand = [];
    for (let r = r0 - R; r <= r0 + R; r++) for (let c = c0 - R; c <= c0 + R; c++) {
      if (r < 0 || c < 0 || r >= grid.rows || c >= grid.cols) continue;
      const i = r * grid.cols + c; if (grid.blocked(i)) continue;
      const q = grid.point(i), d = Math.hypot(q.x - p.x, q.z - p.z); if (d <= maxR) cand.push([d, q]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (const [, q] of cand) for (const a of angles) if (N.poseClear(grid, q.x, q.z, a, w, l)) return { x: q.x, z: q.z, angle: a };
    return null;
  }
  const HEADINGS = [0, Math.PI / 2, Math.PI / 4, 3 * Math.PI / 4];
  function runOne(grid, model, profile, b) {
    if (b === 'stretcher') {
      const tp = model.taskPoints.stretcher, sp = { ...profile, width: .6, length: 1.9 };
      const t = poseNear(grid, tp.target, .6, 1.9, [tp.target.angle, tp.target.angle + Math.PI / 2], 1.2) || tp.target;
      // The stretcher is set down wherever it fits beside the bed: search from the landing towards the bed and keep the
      // closest pose the stretcher reaches; it counts if it lies within 0.8 m of the bed, the span two bearers lift a patient across.
      const b = tp.bed, gap = p => {
        const s = Math.abs(Math.sin(p.angle)), c = Math.abs(Math.cos(p.angle)), ex = c * sp.width / 2 + s * sp.length / 2, ez = s * sp.width / 2 + c * sp.length / 2;
        return Math.hypot(Math.max(0, b.minX - p.x - ex, p.x - ex - b.maxX), Math.max(0, b.minZ - p.z - ez, p.z - ez - b.maxZ));
      };
      const back = L.ResidentNav.route(grid, t, mid(b), sp), end = back.path && back.path[back.path.length - 1];
      const s = end && gap(end) <= .8 ? { x: end.x, z: end.z, angle: end.angle }
        : L.residentNearBox(grid, model, sp, b, null) || poseNear(grid, mid(b), .6, 1.9, HEADINGS, 3) || { ...mid(b), angle: 0 };
      model.taskPoints.stretcher = { ...tp, start: s, target: t };
      const res = L.runResidentExtendedSuite(grid, model, profile, ['stretcher'])[0];
      model.taskPoints.stretcher = tp;
      if (res.success || !end || back.path.length < 2) return res;
      // Blocked: show the stretcher coming in from the landing and stopping where it cannot turn, at the nearest door.
      // Doorways without leaves (open office floors) are not in model.doors; fall back to every IR door.
      const cands = model.doors.length ? model.doors : model.irDoors.map(d => ({ x: d.center[0], z: d.center[1], irId: d.id }));
      const dist = d => Math.hypot(d.x - end.x, d.z - end.z), door = cands.reduce((a, d) => (dist(d) < dist(a) ? d : a));
      let time = 0, prev = back.path[0];
      res.trace = back.path.map(p => { time += Math.hypot(p.x - prev.x, p.z - prev.z) / .6; prev = p; return { time, x: p.x, z: p.z, angle: p.angle, action: '急救担架进出 / 运送', doors: {} }; });
      res.duration = time + 1; res.distance = 0;
      res.start = res.trace[0];
      res.issues = [{ time, code: 'stretcher_blocked', reason: `担架（0.6 × 1.9 m）过不了这扇门或转角，离床还有 ${gap(end).toFixed(1)} m`, itemId: door.irId, x: end.x, z: end.z }];
      return res;
    }
    if (b === 'clutter') {
      const pts = model.taskPoints.clutter;
      model.taskPoints.clutter = pts.filter(p => { const i = grid.index(p.x, p.z); return i >= 0 && !grid.blocked(i); });
      const res = L.runResidentExtendedSuite(grid, model, profile, ['clutter'])[0];
      model.taskPoints.clutter = pts;
      return res;
    }
    const plan = model.taskPlans[b], saved = plan.start;
    plan.start = resolveStart(grid, profile, plan.start);
    const res = L.runResidentSuite(grid, model, profile, [b])[0];
    plan.start = saved;
    return res;
  }

  const gridCache = new Map();
  function context(sc, edits) {
    const key = JSON.stringify(edits || []);
    if (!gridCache.has(key)) {
      if (gridCache.size > 12) gridCache.delete(gridCache.keys().next().value);
      const grid = buildGrid(sc, edits || []), model = buildModel(sc, edits || []);
      const doorChecks = L.buildStandardsReport([], model, null, { generatedAt: '' }).checks.filter(c => c.status === 'fail');
      gridCache.set(key, { grid, model, doorChecks });
    }
    return gridCache.get(key);
  }
  // One resident (B profile + id) through the given tasks (T1..T8) on the home with `edits` applied.
  function runSuite(sc, pid, profile, taskIds, edits) {
    const { grid, model, doorChecks } = context(sc, edits);
    return taskIds.map(tid => {
      const b = T2B[tid];
      if (model.missing[b] || (!model.taskPlans[b] && !model.taskPoints[b])) {
        return { persona: pid, task: tid, name: namesFor(sc.ir)[tid], applicable: false, reason: model.missing[b] || '户型缺少这项任务的目标', success: null,
          traj: [], events: [], violations: [], monologue: [], risk: { near: [], incidents: [] } };
      }
      for (const d of model.doors) model.setDoor(d.id, 0);
      return convert(grid, model, profile, pid, tid, runOne(grid, model, profile, b), doorChecks);
    });
  }
  // 60 x share of (resident, task) runs completed + 40 x share of distinct standards checks passed.
  // A check is one code on one object; it fails if any run fails it (red) or flags it (yellow).
  function score(runs) {
    const app = runs.filter(r => r.applicable); if (!app.length) return 0;
    const st = new Map(), key = (code, id) => code + '|' + (id == null ? '' : String(id).split('#')[0]);
    for (const r of app) {
      for (const c of r.checks || []) if (c.status === 'pass' && !st.has(key(c.code, c.objectId))) st.set(key(c.code, c.objectId), 1);
      for (const v of r.violations) st.set(key(v.code, v.object_id), 0);
    }
    const ok = [...st.values()].filter(Boolean).length;
    const s = 60 * app.filter(r => r.success).length / app.length + 40 * (st.size ? ok / st.size : 1);
    return Math.round(Math.max(0, Math.min(100, s)) * 10) / 10;
  }
  function gridMeta(sc) { const g = context(sc, []).grid; return { minX: g.minX, minZ: g.minZ, cell: g.cell, cols: g.cols, rows: g.rows }; }
  function doorsOf(sc, edits) { return context(sc, edits).model.doors.map(d => ({ id: d.id, irId: d.irId, fixed: !!d.fixed, leaf: d.leaf, leafWidth: d.leafWidth, name: d.name })); }

  L.HAAdapter = { TASKS, NAMES, namesFor, T2B, B2T, buildGrid, buildModel, runSuite, score, gridMeta, doorsOf, reset: () => gridCache.clear() };
})(typeof self !== 'undefined' ? self : globalThis);
