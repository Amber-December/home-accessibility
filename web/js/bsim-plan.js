/* Plan search on B's engine: multi-objective Pareto local search over edit sets (score, cost, how intrusive the work is).
   Proposals follow B's repair agent (resident-repair.js): lever handle, reverse swing, move or remove nearby furniture,
   plus door work, compact fixtures and swaps to catalog products with their prices. Every candidate is re-run on the
   engine with every resident. */
(() => {
  'use strict';
  const HA = window.HA = window.HA || {};
  const FIXED = new Set(['toilet', 'showerhead', 'switch', 'lightfixture', 'bathroomcabinet', 'mirror', 'cabinet']);
  const KEEP = new Set(['bed', 'sofa', 'toilet', 'refrigerator', 'wardrobe']);
  const MOVABLE = new Set(['dynamic_furniture', 'ornament', 'large_appliance']);
  // Reference prices (CNY) for work that has no catalog product.
  const PRICES = {
    toilet: ['短款马桶（进深短 20 cm）', 2800, .10], bathroomcabinet: ['悬挂式洗手台（台下留空，进深短 30 cm）', 1600, .15],
    door_lever: ['低阻力易握执手（高 0.95 m）', 260], door_reverse: ['门扇改向开启（换合页、调门套）', 450],
    door_sliding: ['推拉门套件（含拆旧门）', 1280], door_widen: ['门洞加宽到 0.90 m（拆改墙体、换门套）', 3500],
  };
  const DOOR_FIX = { DOOR_OPEN: ['door_lever'], REACH: ['door_lever'], DOOR_SWING: ['door_reverse'],
    DOOR_WIDTH: ['door_sliding', 'door_widen'], CORRIDOR_WIDTH: ['door_sliding', 'door_widen'], STRETCHER_BLOCK: ['door_widen'] };
  const ISSUE = { closed_door: 'DOOR_OPEN', door_operation: 'DOOR_OPEN', reach_failed: 'REACH', door_swing: 'DOOR_SWING',
    path_blocked: 'CORRIDOR_WIDTH', turn_failed: 'TURN_SPACE', transfer_failed: 'TRANSFER_ZONE', stretcher_blocked: 'STRETCHER_BLOCK' };
  const r3 = v => Math.round(v * 1000) / 1000;
  const base = id => (id == null ? null : String(id).split('#')[0]);
  const keyOf = e => [e.op, e.object_id, e.dx || 0, e.dy || 0, (e.product && e.product.id) || ''].join('|');
  const runKey = r => r.persona + '|' + r.task;
  const centre = o => [(o.aabb.min[0] + o.aabb.max[0]) / 2, (o.aabb.min[1] + o.aabb.max[1]) / 2];

  // Axis-aligned front of an object: away from the side whose 0.15 m outer band is most wall or furniture.
  function front(occ, o) {
    const idx = occ.labels.indexOf('obj:' + o.id), g = occ.body, { res, cols, rows } = occ;
    const cell = (x, y) => [Math.floor((y - occ.y0) / res), Math.floor((x - occ.x0) / res)];
    const [i0, j0] = cell(o.aabb.min[0], o.aabb.min[1]), [i1, j1] = cell(o.aabb.max[0], o.aabb.max[1]);
    const b = Math.max(1, Math.round(.15 / res));
    const frac = (ia, ib, ja, jb) => {
      let n = 0, hit = 0;
      for (let i = Math.max(0, ia); i < Math.min(rows, ib); i++) for (let j = Math.max(0, ja); j < Math.min(cols, jb); j++) {
        n++; const v = g[i * cols + j]; if (v >= 0 && v !== idx) hit++;
      }
      return n ? hit / n : 1;
    };
    const f = { '1,0': frac(i0, i1 + 1, j1 + 1, j1 + 1 + b), '-1,0': frac(i0, i1 + 1, j0 - b, j0),
      '0,1': frac(i1 + 1, i1 + 1 + b, j0, j1 + 1), '0,-1': frac(i0 - b, i0, j0, j1 + 1) };
    let back = [1, 0], best = -Infinity;
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const v = f[d.join(',')] - f[[-d[0], -d[1]].join(',')]; if (v > best) { best = v; back = d; }
    }
    return [-back[0] || 0, -back[1] || 0];
  }

  // Catalog products of the same kind that fit inside the object's footprint, as replace edits: the smallest one (most
  // floor freed) and the cheapest one, so the search can trade clearance against price.
  function swap(occ, o, items) {
    const cat = String(o.category).toLowerCase(), [fx, fy] = front(occ, o);
    const ex = o.aabb.max[0] - o.aabb.min[0], ey = o.aabb.max[1] - o.aabb.min[1];
    const [d0, w0] = Math.abs(fx) > Math.abs(fy) ? [ex, ey] : [ey, ex];
    const area = i => i.size_m[0] * i.size_m[1];
    const fits = items.filter(i => i.lux3d && (i.ir || []).includes(cat) && i.size_m[0] <= w0 && i.size_m[1] <= d0 && area(i) <= .85 * w0 * d0);
    if (!fits.length) return [];
    const small = fits.reduce((a, b) => (area(b) < area(a) || (area(b) === area(a) && b.price_cny < a.price_cny) ? b : a));
    const cheap = fits.reduce((a, b) => (b.price_cny < a.price_cny || (b.price_cny === a.price_cny && area(b) < area(a)) ? b : a));
    const [cx, cy] = centre(o);
    return [...new Set([small, cheap])].map(it => ({ op: 'replace', object_id: o.id,
      product: { id: it.id, name: it.name, variant: it.variant, category: it.category, size_m: it.size_m, url: it.url, glb: it.glb, img: it.img, price_cny: it.price_cny },
      place: { center: [r3(cx - fx * (d0 - it.size_m[1]) / 2), r3(cy - fy * (d0 - it.size_m[1]) / 2)], front: [fx, fy] },
      from_m: [r3(w0), r3(d0)], cost_cny: it.price_cny, rent_ok: true, wall: false }));
  }

  // A move is allowed only if the shifted footprint stays on the grid and lands on free cells in every layer.
  function moveOk(occ, e) {
    const idx = occ.labels.indexOf('obj:' + e.object_id), { rows, cols, res } = occ;
    const di = Math.round((e.dy || 0) / res), dj = Math.round((e.dx || 0) / res);
    for (const layer of ['body', 'toe', 'head']) {
      const g = occ[layer]; if (!g) continue;
      for (let k = 0; k < g.length; k++) {
        if (g[k] !== idx) continue;
        const i = Math.floor(k / cols) + di, j = (k % cols) + dj;
        if (i < 0 || j < 0 || i >= rows || j >= cols) return false;
        const v = g[i * cols + j]; if (v >= 0 && v !== idx) return false;
      }
    }
    return true;
  }

  function doorEdit(d, op) {
    const [, price] = PRICES[op], cw = d.clear_width != null ? d.clear_width : d.opening_width;
    const e = { op, object_id: d.id, cost_cny: price, rent_ok: op === 'door_lever' || op === 'door_reverse', wall: op === 'door_widen' };
    if (op === 'door_sliding') Object.assign(e, { from_m: r3(cw), clear_width_m: r3(cw + .055) });
    if (op === 'door_widen') Object.assign(e, { from_m: r3(cw), clear_width_m: .9 });
    return e;
  }
  const compact = o => {
    const [name, price, shrink] = PRICES[String(o.category).toLowerCase()];
    return { op: 'replace', object_id: o.id, shrink_m: shrink, product: { name, price_cny: price }, cost_cny: price, rent_ok: false, wall: false };
  };
  // Edits worth trying for the problems in `runs` (nearest first). `full` adds work a tenant cannot do (doors, fixtures).
  // `skip` holds keys already ruled out; overlap and fixed-object notes are logged once per search.
  function proposals(sc, runs, edits, items, full, log, skip = new Set()) {
    const { ir, occ } = sc, out = [], seen = new Set([...edits.map(keyOf), ...skip]), near = new Set(), lonely = new Set();
    const note = (k, x) => { if (!skip.has('log|' + k)) { skip.add('log|' + k); log.push(x); } };
    const touched = new Set(edits.filter(e => !e.op.startsWith('door_')).map(e => e.object_id));
    const doors = new Map(ir.doors.map(d => [d.id, d])), objs = ir.objects.filter(o => occ.labels.includes('obj:' + o.id));
    const doorOps = id => new Set(edits.filter(e => e.object_id === id).map(e => e.op));
    const add = (e, rank) => { const k = keyOf(e); if (!seen.has(k)) { seen.add(k); out.push({ e, rank }); } };
    const spots = [];
    for (const r of runs) {
      if (!r.applicable) continue;
      for (const v of r.violations) {
        if ((!r.success && v.severity === 'red') || (full && v.code === 'DOOR_WIDTH')) spots.push({ code: v.code, id: base(v.object_id), at: v.location, target: [r.persona, r.task] });
      }
      if (!r.success) for (const i of (r.risk && r.risk.incidents) || []) spots.push({ code: ISSUE[i.code] || i.code, id: base(i.obstacle.id), at: [i.x, i.z], target: [r.persona, r.task] });
    }
    for (const s of spots) {
      const d = doors.get(s.id);
      if (d) {
        const had = doorOps(d.id), rebuilt = had.has('door_sliding') || had.has('door_widen');
        for (const op of DOOR_FIX[s.code] || []) {
          if (!full && op !== 'door_lever' && op !== 'door_reverse') continue;
          if ((op === 'door_sliding' || op === 'door_widen') && rebuilt) continue;
          if (op === 'door_widen' && (d.clear_width || 0) >= .9) continue;
          if (op === 'door_reverse' && had.has('door_sliding')) continue;
          add(doorEdit(d, op), 0);
        }
      }
      const self = objs.find(o => o.id === s.id), at = s.at || (self ? centre(self) : null);
      if (!at) continue;
      const list = objs.map(o => [Math.hypot(at[0] - centre(o)[0], at[1] - centre(o)[1]), o]).filter(([dd]) => dd < 2)
        .sort((a, b) => a[0] - b[0]).slice(0, 4);
      if (!d && !list.some(([, o]) => MOVABLE.has(o.type) && !FIXED.has(String(o.category).toLowerCase())) && !lonely.has(s.target.join())) {
        lonely.add(s.target.join()); note('lonely|' + s.target.join(), { target: s.target, object_id: s.id, result: '附近没有能动的家具' });
      }
      for (const [dd, o] of list) {
        if (touched.has(o.id) || near.has(o.id)) continue;
        near.add(o.id);
        const cat = String(o.category).toLowerCase();
        if (FIXED.has(cat) || !MOVABLE.has(o.type)) {
          if (full && PRICES[cat]) add(compact(o), 2 + dd);
          else note('fixed|' + o.id, { target: s.target, object_id: o.id, result: '固定设施，不挪动' });
          continue;
        }
        if (!KEEP.has(cat)) add({ op: 'remove', object_id: o.id, cost_cny: 0, rent_ok: true, wall: false }, 1 + dd);
        if (items && items.length) swap(occ, o, items).forEach((sw, k) => add(sw, 1.2 + k * .1 + dd));
        for (const st of [.3, .6]) for (const [dx, dy] of [[st, 0], [-st, 0], [0, st], [0, -st]]) {
          const e = { op: 'move', object_id: o.id, dx, dy, cost_cny: 0, rent_ok: true, wall: false };
          if (moveOk(occ, e)) add(e, 1 + st + dd);
          else { seen.add(keyOf(e)); note(keyOf(e), { target: s.target, ...e, result: '和墙或其他家具重叠' }); }
        }
      }
    }
    return out.sort((a, b) => a.rank - b.rank).map(x => x.e);
  }

  function title(sc, edits) {
    const nm = id => (sc.names && sc.names[id]) || id;
    const DOOR = { door_lever: '换易握执手', door_reverse: '改向开启', door_sliding: '改推拉门', door_widen: '加宽' };
    return edits.map(e => {
      const n = nm(e.object_id);
      if (e.op === 'remove') return '移走' + n;
      if (e.op === 'move') return '挪' + n;
      if (e.op === 'replace') return e.place ? `${n}换成${e.product.name}` : '换' + e.product.name.split('（')[0];
      return n + DOOR[e.op];
    }).join(' + ');
  }

  const okSet = runs => new Set(runs.filter(r => r.applicable && r.success).map(runKey));
  const worseOf = (ok, runs) => runs.filter(r => ok.has(runKey(r)) && !r.success).map(r => [r.persona, r.task]);
  const cost = es => es.reduce((n, e) => n + (e.cost_cny || 0), 0);

  // How far the work reaches: 0 a tenant can do it, 1 needs the owner (doors, fixtures), 2 touches a wall.
  const level = es => (es.some(e => e.wall) ? 2 : es.every(e => e.rent_ok) ? 0 : 1);
  const setKey = es => es.map(keyOf).sort().join(';');
  // a dominates b: at least as good on score (up), cost (down) and level (down), strictly better on one.
  const dom = (a, b) => a.score >= b.score - 1e-9 && a.cost <= b.cost && a.level <= b.level
    && (a.score > b.score + 1e-9 || a.cost < b.cost || a.level < b.level);
  // NSGA-II crowding distance on (score, cost): plans at the ends of the front and in sparse stretches come first.
  function crowd(xs) {
    if (xs.length <= 2) return [...xs];
    const d = new Map(xs.map(x => [x, 0]));
    for (const f of [x => x.score, x => -x.cost]) {
      const s = [...xs].sort((a, b) => f(a) - f(b)), span = f(s[s.length - 1]) - f(s[0]) || 1;
      d.set(s[0], Infinity); d.set(s[s.length - 1], Infinity);
      for (let i = 1; i < s.length - 1; i++) d.set(s[i], d.get(s[i]) + (f(s[i + 1]) - f(s[i - 1])) / span);
    }
    return [...xs].sort((a, b) => d.get(b) - d.get(a) || b.score - a.score);
  }

  // Pareto local search over edit sets with three objectives: engine score (up), cost in CNY from catalog prices and
  // reference labour prices (down), and level (down). The archive holds the plans no other plan dominates. Each round
  // expands the `width` least crowded unexpanded archive plans: edits proposed for the problems their residents still
  // hit are added one at a time, every new edit set is re-run on the engine, and a result enters the archive when it
  // makes no resident worse than the home as built, beats its parent's score, and no archived plan dominates it.
  // opts: { evaluate(edits) -> runs on `tasks`, evaluateAll(edits) -> runs on every task, score, tasks, items, onProgress,
  //   budget (optional upper bound on cost) }.
  async function search(sc, baseRuns, opts) {
    const { evaluate, evaluateAll, score, tasks, items = [], onProgress = () => {}, rounds = 5, width = 3, cap = 12, budget = null } = opts;
    const base0 = baseRuns.filter(r => tasks.includes(r.task)), ok0 = okSet(base0), tried = [], dead = new Set(), seen = new Set();
    let n = 0;
    const node = (edits, runs) => ({ edits, runs, score: score(runs), cost: cost(edits), level: level(edits), ok: okSet(runs), open: true });
    let archive = [node([], base0)];
    for (let round = 0; round < rounds; round++) {
      const open = crowd(archive.filter(a => a.open)).slice(0, round ? width : 1);
      if (!open.length) break;
      const jobs = [];
      for (const p of open) {
        p.open = false;
        let k = 0;
        for (const e of proposals(sc, p.runs, p.edits, items, true, tried, dead)) {
          if (k >= (p.edits.length ? cap : 2 * cap)) break;
          if (budget != null && p.cost + (e.cost_cny || 0) > budget) continue;
          const es = [...p.edits, e], key = setKey(es);
          if (seen.has(key)) continue;
          seen.add(key); jobs.push({ p, e, es }); k++;
        }
      }
      if (!jobs.length) continue;
      onProgress({ round: round + 1, total: jobs.length, done: n, archive: archive.length });
      const res = await Promise.all(jobs.map(j => evaluate(j.es).then(r => { onProgress({ done: ++n }); return r; })));
      res.forEach((runs, i) => {
        const { p, e, es } = jobs[i], c = node(es, runs), worse = worseOf(ok0, runs);
        const fixed = runs.filter(r => r.applicable && r.success && !p.ok.has(runKey(r))).map(r => [r.persona, r.task]);
        const entry = { round: round + 1, ...e, target: fixed[0] || worse[0] || null, score: c.score, fixed, worse,
          result: worse.length ? '有住户变差' : c.score > p.score + .05 ? '有改善' : '仍失败' };
        tried.push(entry);
        // An edit that hurts someone, or does nothing on the home as built, is not proposed again.
        if (worse.length || (entry.result === '仍失败' && !p.edits.length)) dead.add(keyOf(e));
        if (entry.result !== '有改善') return;
        const over = archive.find(a => dom(a, c));
        if (over) { entry.result = '被更省或更好的方案占优'; return; }
        archive.forEach(a => { if (dom(c, a) && a.entry) a.entry.result = '被后来的方案占优'; });
        archive = archive.filter(a => !dom(c, a));
        c.entry = entry; entry.result = '采纳'; archive.push(c);
      });
    }
    const okAll = okSet(baseRuns);
    const plans = await Promise.all(archive.filter(a => a.edits.length).map(async a => {
      const runs = await evaluateAll(a.edits);
      return { title: title(sc, a.edits), edits: a.edits, cost_cny: a.cost, rent_ok: a.level === 0, wall: a.level === 2,
        score: score(runs), worse: worseOf(okAll, runs), runs };
    }));
    plans.sort((a, b) => a.cost_cny - b.cost_cny || b.score - a.score);
    plans.forEach((p, i) => { p.id = 'P' + String(i + 1).padStart(2, '0'); });
    return { plans, tried, candidates: n, method: 'pareto-local-search' };
  }

  HA.bsimPlan = { search, proposals, swap, front, moveOk, title, PRICES };
})();
