/* B's resident engine (prototypes/indoor-space-interaction) in a small worker pool.
   Builds what the UI reads: residents from B's profiles, runs of every resident x task, and improvement plans
   found by re-running the engine with candidate edits. Run shape: see bsim-model.js convert(). */
(() => {
  'use strict';
  const HA = window.HA = window.HA || {};
  const TASKS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];
  const SHORT = { wheelchair: '轮椅', electricWheelchair: '电动轮椅', assisted: '助行器', blind: '视障', upper: '上肢受限', pedestrian: '步行' };
  const ORDER = ['wheelchair', 'electricWheelchair', 'assisted', 'blind', 'upper', 'pedestrian'];
  // Parameters a user can change on a resident (B's workbench set), with the input range.
  const PARAMS = [['width', '宽', 'm', .3, 1.2, .01], ['length', '长', 'm', .3, 2, .01], ['speed', '速度', 'm/s', .2, 2, .05],
    ['reach', '触达距离', 'm', .2, 1.2, .01], ['maxHeight', '最高触达', 'm', .6, 2.2, .01], ['doorEffort', '开门力', '', .1, 1, .05]];
  let pool = [], meta = null, seq = 0;
  const pending = new Map();

  function spawn() {
    const w = new Worker('js/bsim-worker.js');
    w.busy = 0;
    w.onmessage = ({ data: m }) => {
      if (m.type === 'ready') { w.ready(m); return; }
      const p = pending.get(m.id); if (!p) return;
      pending.delete(m.id); w.busy--;
      if (m.type === 'error') p.bad(new Error(m.message)); else p.ok(m);
    };
    w.onerror = e => console.error('bsim worker', e.message || e);
    return w;
  }

  // Start the pool on one home. Resolves with {grid, doors, profiles} from the engine.
  function start(ir, occ, names) {
    pool.forEach(w => w.terminate());
    const n = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    pool = Array.from({ length: n }, spawn);
    return Promise.all(pool.map(w => new Promise(ok => { w.ready = ok; w.postMessage({ type: 'load', ir, occ, names }); })))
      .then(ms => (meta = ms[0]));
  }

  const adapt = r => {
    const last = r.traj.length ? r.traj[r.traj.length - 1][0] : 0;
    // Runs that stop at the start still get a short segment so the failure is shown on the timeline.
    return { ...r, t0: 0, duration: r.applicable ? Math.max(last, 1.5) : 0 };
  };
  // One worker job: residents [{id, profile}] through tasks on the home with edits applied.
  function job(residents, tasks, edits = []) {
    const w = pool.reduce((a, b) => (b.busy < a.busy ? b : a)), id = ++seq;
    w.busy++;
    return new Promise((ok, bad) => { pending.set(id, { ok, bad }); w.postMessage({ type: 'run', id, residents, tasks, edits }); })
      .then(m => m.runs.map(adapt));
  }
  // Fire or earthquake evacuation of the given residents together (bsim-hazard.js). Resolves with the run result.
  function hazard(kind, residents, { intensity = 1, edits = [], room = null } = {}) {
    const w = pool.reduce((a, b) => (b.busy < a.busy ? b : a)), id = ++seq;
    w.busy++;
    return new Promise((ok, bad) => {
      pending.set(id, { ok, bad });
      w.postMessage({ type: 'hazard', id, kind, intensity, edits, room, residents: residents.map(p => ({ id: p.id, profile: p.profile })) });
    }).then(m => m.result);
  }
  // Spread residents over the pool, one job each.
  const runAll = (personas, tasks, edits) =>
    Promise.all(personas.map(p => job([{ id: p.id, profile: p.profile }], tasks, edits))).then(x => x.flat());

  function persona(id, prof, extra = {}) {
    return { id, name: prof.name, short: SHORT[id] || prof.short || prof.name, type: prof.type, color: prof.color,
      footprint: { shape: 'rect', size: [prof.width, prof.length] }, v_mps: prof.speed, profile: { ...prof }, ...extra };
  }
  const personas = () => ORDER.filter(id => meta.profiles[id]).map(id => persona(id, meta.profiles[id]));
  // A user-made resident: a copy of a template with its own id, name and parameters.
  let customN = 0;
  function custom(tpl, values = {}) {
    customN++;
    const prof = { ...tpl.profile, ...values, name: `自定义住户 ${customN}`, short: `自定义 ${customN}`, color: ['#e0607c', '#c58b2b', '#5a8f29', '#2b7bc5'][customN % 4] };
    return persona(`custom${customN}`, prof, { custom: true, from: tpl.id });
  }
  const withParams = (p, values) => persona(p.id, { ...p.profile, ...values }, { custom: p.custom, from: p.from });

  // 60 x share of (resident, task) runs completed + 40 x share of distinct standards checks passed.
  // Same formula as bsim-model.js score(), applied to whatever selection the UI shows.
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

  // Plans found for a home are kept per browser so a second visit does not search again.
  const VERSION = 'bsim-2';
  const cacheKey = ir => `ha:plans:${VERSION}:${ir.scene_id || ''}:${ir.objects.length}:${ir.doors.length}`;
  function cached(ir) { try { return JSON.parse(localStorage.getItem(cacheKey(ir)) || 'null'); } catch (e) { return null; } }
  const seedOf = (ir, res) => ({ ...res, key: cacheKey(ir), plans: res.plans.map(p => ({ ...p, runs: undefined })) });
  function keep(ir, res) {
    try { localStorage.setItem(cacheKey(ir), JSON.stringify(seedOf(ir, res))); } catch (e) { /* quota: search again next time */ }
  }
  // Homes in the lab ship the search result next to their IR (web/tools/make_lab.cjs); used when it was made for this IR.
  async function seeded(ir) {
    try {
      const r = await fetch(`lab/${encodeURIComponent(ir.scene_id || '')}/plans.json`);
      const s = r.ok ? await r.json() : null;
      return s && s.key === cacheKey(ir) ? s : null;
    } catch (e) { return null; }
  }

  // Result the UI reads: every resident through T1-T8 on the home as built, then the plan search in the background.
  // `onPlans(result)` fires when plans are ready; `onProgress({done, total, round, archive})` while searching.
  async function buildResult(ir, occ, names, { items = [], onPlans = () => {}, onProgress = () => {} } = {}) {
    await start(ir, occ, names);
    const ps = personas(), runs = await runAll(ps, TASKS, []);
    const result = { personas: ps, tasks: meta.names, baseline: { score: score(runs), runs }, plans: [], search: { tried: [], candidates: 0, running: true } };
    const all = edits => runAll(result.personas, TASKS, edits);
    const tasks = TASKS.filter(t => t !== 'T8' && runs.some(r => r.task === t && r.applicable));
    const done = res => {
      result.plans = res.plans; result.search = { tried: res.tried, candidates: res.candidates, method: res.method, running: false };
      onPlans(result);
    };
    const hit = cached(ir) || await seeded(ir);
    result.ready = (hit
      ? Promise.all(hit.plans.map(async p => ({ ...p, runs: await all(p.edits) }))).then(plans => done({ ...hit, plans }))
      : HA.bsimPlan.search({ ir, occ, names }, runs, { evaluate: edits => job(result.personas, tasks, edits), evaluateAll: all, score, tasks, items, onProgress })
        .then(res => { keep(ir, res); done(res); }))
      .catch(e => { console.error('plan search', e); result.search.running = false; onPlans(result); });
    return result;
  }

  HA.bsim = { TASKS, PARAMS, start, job, hazard, runAll, persona, personas, custom, withParams, score, buildResult, seedOf, meta: () => meta };
})();
