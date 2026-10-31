/* Fire and earthquake on B's engine (fire-core.js, earthquake-core.js, simulation.js) for one home.
   The selected residents evacuate together as one crowd; returns per-resident outcomes, the hazard summary
   and frames (resident positions, smoke and heat at 0.2 m, quake debris) for the floor animation.
   Fire setup follows B's app.js startDisaster(): same fuel map, seed and parameters scaled by intensity.
   The earthquake runs without the cannon-es physics view; tall loose furniture overturns when the peak ground
   acceleration exceeds its base-to-height ratio (rigid-block rocking criterion). Walls crack as in B but do not
   collapse: a home is designed to the local seismic code, so the hazard modelled indoors is falling furniture. */
((root) => {
  'use strict';
  const L = root.IndoorLab, A = L.HAAdapter;
  const COMBUSTIBLE = /(furniture|bed|sofa|chair|table|cabinet|wood|curtain|rug|carpet|cushion|paper|book|木|家具|床|沙发|椅|桌|柜|窗帘|地毯|布)/i;
  const LOW_FUEL = /(floor|wall|ceiling|metal|glass|stone|tile|door|window|地板|墙|顶|金属|玻璃|石|瓷|门|窗)/i;
  const DT = 0.1, FRAME = 0.5;

  function fuelMap(grid) {
    const values = new Float32Array(grid.size);
    const text = o => `${(o && o.name) || ''} ${(o && o.kind) || ''}`;
    for (let i = 0; i < grid.size; i++) {
      if (grid.blocked(i)) continue;
      const t = text(grid.obstacles[grid.owner[i] || 0]);
      values[i] = COMBUSTIBLE.test(t) ? .95 : LOW_FUEL.test(t) ? .08 : .035;
      if (values[i] >= .5) continue;
      const c = i % grid.cols, r = Math.floor(i / grid.cols);
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const cc = c + dc, rr = r + dr; if (cc < 0 || rr < 0 || cc >= grid.cols || rr >= grid.rows) continue;
        if (COMBUSTIBLE.test(text(grid.obstacles[grid.owner[rr * grid.cols + cc] || 0]))) values[i] = Math.max(values[i], .72);
      }
    }
    return values;
  }

  const centroid = poly => poly.reduce((a, p) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length], [0, 0]);
  // Exits: a free cell just outside every door that opens to the outside (doors with one room).
  function exitsOf(grid, sc) {
    const out = [];
    for (const d of sc.ir.doors.filter(d => d.rooms.length === 1)) {
      for (const s of [1, -1]) for (const k of [1.6, 1.2, .8]) {
        const x = d.center[0] + d.normal[0] * s * k, z = d.center[1] + d.normal[1] * s * k, i = grid.index(x, z);
        if (i < 0 || grid.blocked(i) || !grid.isClear(x, z, .25)) continue;
        // Must be outside every room polygon: the occupancy room layer there is empty.
        const o = sc.occ, c = Math.floor((x - o.x0) / o.res), r = Math.floor((z - o.y0) / o.res);
        if (c >= 0 && r >= 0 && c < o.cols && r < o.rows && o.room[r * o.cols + c] >= 0) continue;
        if (!out.some(e => e.door === d.id)) out.push({ x, z, name: sc.names[d.id] || '入户门', width: d.clear_width || .9, door: d.id });
      }
    }
    return out;
  }

  // Obstacle descriptors for EarthquakeScenario (B's obstacleBodies), with heights from the IR boxes.
  // The occupancy has one label for all walls, so wall cells are split into 1.2 m pieces that crack and fall separately.
  const WALL_PIECE = 1.2;
  function bodies(grid, sc) {
    const by = new Map(), objs = new Map(sc.ir.objects.map(o => [o.id, o]));
    for (let i = 0; i < grid.size; i++) {
      const owner = grid.owner[i]; if (!owner) continue;
      const ob = grid.obstacles[owner]; if (!ob || ob.kind === 'door' || ob.kind === 'window') continue;
      const p = grid.point(i), wall = ob.kind === 'wall';
      const key = wall ? `${owner}:${Math.floor(p.x / WALL_PIECE)}:${Math.floor(p.z / WALL_PIECE)}` : String(owner);
      let it = by.get(key);
      if (!it) { it = { id: by.size + 1, name: ob.name, kind: wall ? 'wall' : 'furniture', semanticId: ob.semanticId, xs: [], zs: [] }; by.set(key, it); }
      it.xs.push(p.x); it.zs.push(p.z);
    }
    return [...by.values()].map(o => {
      const ir = objs.get(o.semanticId), box = ir && ir.aabb && ir.aabb.max && ir.aabb.max.length === 3 ? ir.aabb : null;
      const dh = box ? box.max[2] - box.min[2] : NaN, h = Number.isFinite(dh) && dh > 0 ? dh : o.kind === 'wall' ? 2.7 : 1;
      const mn = a => a.reduce((m, v) => Math.min(m, v), Infinity), mx = a => a.reduce((m, v) => Math.max(m, v), -Infinity);
      const [x0, x1, z0, z1] = [mn(o.xs), mx(o.xs), mn(o.zs), mx(o.zs)];
      return { id: o.id, name: o.name, kind: o.kind, semanticId: o.semanticId, height: h, fragility: o.kind === 'wall' ? .9 : .7, fracturable: o.kind !== 'wall',
        mounted: !!(box && box.min[2] > .3), fixed: o.kind === 'wall' || FIXED.test(ir ? `${ir.category || ''} ${ir.type || ''}` : o.name || ''), center: { x: (x0 + x1) / 2, z: (z0 + z1) / 2 },
        width: Math.max(grid.cell, x1 - x0 + grid.cell), depth: Math.max(grid.cell, z1 - z0 + grid.cell) };
    });
  }

  // Overturning: each free-standing piece is a Housner rocking block driven by the scenario ground motion
  // (Housner 1963; Makris & Konstantinidis 2003). Rocking about the edge of its thin side:
  //   theta" = -p^2 [sin(alpha sgn(theta) - theta) + (u"/g) cos(alpha sgn(theta) - theta)],
  //   p = sqrt(3g / 4R), R = half diagonal, alpha = atan(base / height),
  // starts when |u"| > g tan(alpha), loses r = 1 - 1.5 sin^2(alpha) of angular velocity at each impact and
  // overturns once |theta| > alpha. A wall or another piece on one side stops it: it hits the wall there.
  // Fallen pieces lie as a rectangle from the pivot edge out to their height (shorter when they lean on something).
  // Built-ins (floor-to-ceiling wardrobes, sanitary ware, counters, shower screens) and wall-mounted items stay put.
  const FIXED = /(door|window|toilet|bath|shower|sink|basin|counter|stove|cooktop|range|hood|radiator|fireplace|built)/i;
  const G = 9.81;
  // Dominant frequency of the ground motion: 1.5 Hz (period 0.67 s), the band of strong shaking on medium soil that
  // overturns household furniture. At B's 2.2 Hz the same PGA rocks the blocks but small blocks do not go over (size effect).
  const QUAKE_HZ = 1.5;
  function tipper(grid, obstacles) {
    const open = (x, z) => { const i = grid.index(x, z); return i >= 0 && !grid.blocked(i); };
    const inside = (d, x, z, r) => Math.hypot(Math.max(0, Math.abs(x - d.x) - d.hx), Math.max(0, Math.abs(z - d.z) - d.hz)) < r;
    const reach = (o, alongX, sign) => {   // free floor (m) beyond the pivot edge, probed across the long side
      const half = Math.min(o.width, o.depth) / 2, side = alongX ? o.depth : o.width;
      let n = 0;
      for (let k = grid.cell / 2; k <= o.height; k += grid.cell) {
        let free = 0, all = 0;
        for (let u = -side / 2 + grid.cell / 2; u < side / 2; u += grid.cell, all++)
          if (open(o.center.x + (alongX ? sign * (half + k) : u), o.center.z + (alongX ? u : sign * (half + k)))) free++;
        if (free < all * .5) break;
        n = k + grid.cell / 2;
      }
      return n;
    };
    const blocks = obstacles.filter(o => o.kind === 'furniture' && !o.mounted && !o.fixed && o.height >= .9 && o.height < 2.3).map(o => {
      const b = Math.min(o.width, o.depth), alongX = o.width < o.depth, R = Math.hypot(b, o.height) / 2, alpha = Math.atan(b / o.height);
      const room = [reach(o, alongX, -1), reach(o, alongX, 1)];
      const lim = room.map(n => n < .3 ? Math.min(alpha, Math.atan(n / o.height)) : Infinity);
      return { o, alongX, b, alpha, p: Math.sqrt(3 * G / (4 * R)), r: 1 - 1.5 * Math.sin(alpha) ** 2, room, lim, th: 0, w: 0, peak: 0 };
    });
    let debris = [], t0 = 0;
    const fall = (k, s) => {
      const o = k.o, len = k.room[s > 0 ? 1 : 0], half = k.b / 2, side = k.alongX ? o.depth : o.width, mid = half + len / 2;
      const hx = k.alongX ? len / 2 : side / 2, hz = k.alongX ? side / 2 : len / 2;
      debris.push({ id: o.id, name: o.name, kind: 'toppled', semanticId: o.semanticId, x: o.center.x + (k.alongX ? s * mid : 0), z: o.center.z + (k.alongX ? 0 : s * mid),
        hx, hz, radius: Math.min(hx, hz) + .1, height: Math.min(.6, k.b), energy: Math.min(1, .45 + o.height / 4), leaning: len < o.height - .05 });
    };
    return {
      blocks,
      reset() { debris = []; t0 = 0; for (const k of blocks) { k.th = k.w = k.peak = 0; k.down = false; } },
      release() {},
      fractureWall(id) {
        const o = obstacles.find(x => x.id === id); if (!o) return;
        const r = Math.max(o.width, o.depth) * .35;
        debris.push({ id, name: o.name || '墙体碎片', kind: 'debris', x: o.center.x, z: o.center.z, hx: r, hz: r, radius: r, height: .35, energy: .7 });
      },
      // Integrates every block over [t0, scenario.time] with the scenario analytic ground motion in 5 ms steps.
      step(dt, sc) {
        const q = sc.options, w = 2 * Math.PI * q.frequency, h = .005;
        for (let t = t0 + h; t <= sc.time + 1e-9; t += h) {
          if (t >= q.duration) break;
          const e = Math.sin(Math.PI * t / q.duration) ** 2;
          const ax = q.pga * G * e * (.74 * Math.sin(w * t) + .26 * Math.sin(w * .61 * t + 1.1));
          const az = q.pga * G * e * (.55 * Math.sin(w * .83 * t + .8) + .18 * Math.sin(w * 1.37 * t));
          for (const k of blocks) {
            if (k.down) continue;
            const u = (k.alongX ? ax : az) / G, ta = Math.tan(k.alpha);
            if (k.th === 0 && k.w === 0) { if (u < -ta && k.lim[1] > 0) k.th = 1e-6; else if (u > ta && k.lim[0] > 0) k.th = -1e-6; else continue; }
            const s = k.th > 0 ? 1 : -1, acc = -k.p * k.p * (Math.sin(k.alpha * s - k.th) + u * Math.cos(k.alpha * s - k.th));
            k.w += acc * h; const next = k.th + k.w * h;
            if (next * k.th < 0 || next === 0) { k.th = 0; k.w *= k.r; if (Math.abs(k.w) < 1e-3) k.w = 0; else k.th = Math.sign(k.w) * 1e-6; continue; }
            const lim = k.lim[s > 0 ? 1 : 0];
            if (Math.abs(next) >= lim) { k.th = s * lim; k.w = -k.r * k.w; continue; }   // hits the wall or the piece beside it
            k.th = next; k.peak = Math.max(k.peak, Math.abs(next) / k.alpha);
            if (Math.abs(next) > k.alpha) { k.down = true; fall(k, s); }
          }
        }
        t0 = Math.min(sc.time, q.duration);
      },
      footprints() { return debris.slice(); },
      contactAt(x, z, r = .25) { return debris.find(d => inside(d, x, z, r)) || null; },
      summary() {
        return { toppled: debris.filter(d => d.kind === 'toppled').length, leaning: debris.filter(d => d.leaning).length,
          rocked: blocks.filter(k => k.peak > 0).length, candidates: blocks.length };
      },
    };
  }

  const CROWD = { wheelchair: 'wheelchair', assisted: 'assisted', upper: 'upper' };
  const radiusOf = prof => Math.max(.22, Math.min(.6, (prof.width || .5) / 2 + .02));
  // Bedrooms first: a fire or quake at night finds people in bed (on an office floor, at their desks).
  function startRooms(sc) {
    const rank = t => /bedroom|office|studio|collab|project/i.test(t) ? 0 : /living/i.test(t) ? 1 : /dining|kitchen/i.test(t) ? 2 : 3;
    return sc.ir.rooms.filter(r => r.polygons && r.polygons[0]).sort((a, b) => rank(a.type) - rank(b.type) || b.area - a.area);
  }
  function place(grid, rooms, i, radius, taken) {
    const [x, z] = centroid(rooms[i % rooms.length].polygons[0]), nav = grid.nav(radius);
    let best = -1, bd = Infinity;
    for (const c of nav.mainFree) {
      const p = grid.point(c), d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd && taken.every(q => Math.hypot(q.x - p.x, q.z - p.z) > q.r + radius + .1)) { bd = d; best = c; }
    }
    return best < 0 ? null : grid.point(best);
  }
  // Name of the furniture nearest to a cell (the fire source label).
  function nearestName(grid, cell) {
    const c0 = cell % grid.cols, r0 = Math.floor(cell / grid.cols);
    for (let k = 1; k <= 6; k++) for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) {
      const c = c0 + dc, r = r0 + dr; if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
      const o = grid.obstacles[grid.owner[r * grid.cols + c] || 0];
      if (o && o.kind === 'furniture') return o.name;
    }
    return '';
  }
  // Fields at 0.2 m (max of each 2 x 2 block), one byte per cell.
  function pool2(grid, get) {
    const c2 = Math.ceil(grid.cols / 2), r2 = Math.ceil(grid.rows / 2), out = new Uint8Array(c2 * r2);
    for (let i = 0; i < grid.size; i++) {
      const c = i % grid.cols, r = (i - c) / grid.cols, j = (r >> 1) * c2 + (c >> 1), v = Math.round(Math.max(0, Math.min(1, get(i))) * 255);
      if (v > out[j]) out[j] = v;
    }
    return out;
  }
  // kind 'fire' | 'quake'; residents [{id, profile}]; edits from a plan; room: optional room id where the fire starts.
  function run(sc, { kind, intensity = 1, residents, edits = [], room = null, maxTime }) {
    const grid = A.buildGrid(sc, edits), exits = exitsOf(grid, sc);
    if (!exits.length) throw new Error('户型里没有通向室外的门，无法设置疏散出口');
    const rooms = startRooms(sc);
    const goals = rooms.map((r, i) => { const [x, z] = centroid(r.polygons[0]); return { id: i + 1, name: sc.names[r.id] || r.type, x, z }; });
    const sim = new L.Simulation(grid, goals, { count: residents.length, population: 'pedestrian', seed: 21879 });
    const taken = [], who = [];
    sim.agents.forEach((a, i) => {
      const r = residents[i], type = CROWD[r.profile.type] || 'pedestrian', radius = radiusOf(r.profile);
      const p = place(grid, rooms, i, radius, taken); if (!p) return;
      Object.assign(a, { x: p.x, z: p.z, type, vx: 0, vz: 0, trail: [], path: [], goal: null,
        profile: { ...L.PROFILES[type], name: r.profile.name, radius, speed: r.profile.speed, color: r.profile.color } });
      taken.push({ x: p.x, z: p.z, r: radius }); who[i] = r.id; sim.assignGoal(a);
    });
    const ids = who.filter(Boolean);
    sim.agents = sim.agents.filter((a, i) => who[i]);
    const info = {};
    let hazard;
    if (kind === 'fire') {
      const k = intensity;
      hazard = new L.FireModel(grid, { seed: 21879, wind: { x: .18 * k, z: .05 * k }, sourcePower: 360 * k, fireHeat: 230 * k,
        conductivity: .38, smokeDiffusion: .44, ceilingRise: .2, burnRate: .09, fireSmoke: .3 });
      const fuel = fuelMap(grid); hazard.setFuelMap(fuel);
      const free = grid.nav(.25).mainFree, hot = free.filter(c => fuel[c] > .55), pool = hot.length ? hot : free;
      let cell = pool[(21879 + Math.floor(k * 10)) % pool.length];
      const target = room && sc.ir.rooms.find(r => r.id === room);
      if (target) {
        const [x, z] = centroid(target.polygons[0]), d = c => { const p = grid.point(c); return (p.x - x) ** 2 + (p.z - z) ** 2; };
        cell = pool.reduce((b, c) => (d(c) < d(b) ? c : b), pool[0]);
      }
      hazard.addSource({ cell, name: '起火点', power: 360 * k, smoke: .46 * k, flame: 1 });
      hazard.rebuildEscapeDistance(exits);
      const p = grid.point(cell);
      info.source = { x: p.x, z: p.z, near: nearestName(grid, cell) };
    } else {
      const obstacles = bodies(grid, sc), pga = .32 * intensity;
      hazard = new L.EarthquakeScenario(grid, obstacles, { seed: 7319, pga, frequency: QUAKE_HZ, duration: 12,
        collapseThreshold: Math.max(.35, .58 - intensity * .1), physics: tipper(grid, obstacles) }).start();
      info.pga = pga;
    }
    sim.setHazard(hazard, kind === 'fire' ? 'fire' : 'earthquake', exits);
    const all = sim.agents.slice();

    // An office floor is several times the size of a home, so an earthquake evacuation there gets longer before it counts as failed.
    const T = maxTime || (kind === 'fire' ? 180 : sc.ir.kind === 'office' ? 150 : 60), amb = kind === 'fire' ? hazard.settings.ambientTemperature : 0;
    const frames = [], f30 = [], out = new Map(), seen = new Map();
    let next = 0, doneAt = null;
    for (let t = 0; t <= T + 1e-9; t += DT) {
      if (t >= next - 1e-9) {
        const f = { t: +t.toFixed(2), a: all.map(a => [+a.x.toFixed(2), +a.z.toFixed(2), a.evacuated ? 1 : 0]) };
        if (kind === 'fire') {
          f.smoke = pool2(grid, i => hazard.smoke[i]);
          f.heat = pool2(grid, i => Math.max(hazard.flame[i], (hazard.temperature[i] - amb) / 300));
        } else {
          f.g = +(Math.hypot(hazard.groundAcceleration, hazard.groundAccelerationZ) / 9.81).toFixed(3);
          for (const d of hazard.debris) if (!seen.has(d.id)) seen.set(d.id, { ...d, t: f.t });
        }
        frames.push(f); f30.push(f.a); next += FRAME;
      }
      if (doneAt != null && t > doneAt + 3) break;
      // Everyone still inside has stopped moving for 30 s: they are trapped, the rest of the run adds nothing.
      if (f30.length > 60 && t > 60 && sim.agents.every(a => { const q = f30[f30.length - 61][all.indexOf(a)]; return Math.hypot(a.x - q[0], a.z - q[1]) < .2; })) break;
      sim.tick(DT);
      all.forEach((a, i) => { if (a.evacuated && !out.has(ids[i])) out.set(ids[i], +sim.time.toFixed(1)); });
      // Whoever is out leaves the crowd, so they do not stand in the doorway for the people behind.
      sim.agents = sim.agents.filter(a => !a.evacuated);
      if (doneAt == null && !sim.agents.length) doneAt = t;
    }
    const people = residents.map(r => {
      const i = ids.indexOf(r.id), a = all[i];
      if (i < 0) return { id: r.id, placed: false, evacuated: false };
      return { id: r.id, placed: true, evacuated: !!a.evacuated, time_s: out.get(r.id) ?? null, smoke_dose: +(a.smokeDose || 0).toFixed(3),
        exposure_s: +(a.hazardExposureTime || 0).toFixed(1), distance_m: +(a.distance || 0).toFixed(1), state: a.state,
        fail_code: a.evacuated ? null : exits.every(e => e.width < a.profile.radius * 2 + .08) ? 'exit_too_narrow' : a.failureCode || (kind === 'fire' ? (a.smokeDose > 3 ? 'fire_smoke' : 'fire_route_blocked') : 'earthquake_route_blocked') };
    });
    const c2 = Math.ceil(grid.cols / 2), r2 = Math.ceil(grid.rows / 2);
    return { kind, intensity, ...info, exits: exits.map(e => ({ x: e.x, z: e.z, name: e.name, width: e.width })), people, frames,
      field: { minX: grid.minX, minZ: grid.minZ, cell: grid.cell * 2, cols: c2, rows: r2 },
      debris: [...seen.values()], events: (hazard.events || []).slice(0, 200).map(e => ({ type: e.type, name: e.name, t: +(e.time || 0).toFixed(1), x: e.x, z: e.z })),
      summary: hazard.summary(), crowd: sim.summary(), duration: frames.length ? frames[frames.length - 1].t : 0 };
  }

  L.HAHazard = { run, exitsOf, bodies, fuelMap };
})(typeof self !== 'undefined' ? self : globalThis);