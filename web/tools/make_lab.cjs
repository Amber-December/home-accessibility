/* Run B's resident engine over every 实验室 home and rewrite web/lab/index.json with the outcomes.

   For each home in web/lab/<scene>/ it reads scene_ir.json and occupancy.npz, runs every resident of
   prototypes/indoor-space-interaction through T1-T8 on the home as built, then runs the same plan search the
   app runs (web/js/bsim-plan.js, catalog swaps from web/library/catalog.json) and keeps one outcome map per plan.
   Homes run in parallel child processes.

     node web/tools/make_lab.cjs [-j 8] [scene ...]
*/
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib'), cp = require('child_process');
const ROOT = path.resolve(__dirname, '../..'), WEB = path.join(ROOT, 'web'), LAB = path.join(WEB, 'lab');
const B = path.join(ROOT, 'prototypes/indoor-space-interaction/js');
const ORDER = ['wheelchair', 'electricWheelchair', 'assisted', 'blind', 'upper', 'pedestrian'];
const TASKS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];

// ---- .npz (zip of .npy) without dependencies ----
function unzip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip file');
  const n = buf.readUInt16LE(e + 10), out = {};
  let p = buf.readUInt32LE(e + 16);
  for (let k = 0; k < n; k++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    const at = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), raw = buf.subarray(at, at + size);
    out[name] = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    p += 46 + nl + xl + cl;
  }
  return out;
}
function npy(b) {
  const major = b[6], hlen = major === 1 ? b.readUInt16LE(8) : b.readUInt32LE(8), off = major === 1 ? 10 : 12;
  const header = b.toString('latin1', off, off + hlen);
  const descr = /'descr':\s*'([^']+)'/.exec(header)[1];
  const shape = /'shape':\s*\(([^)]*)\)/.exec(header)[1].split(',').map(s => s.trim()).filter(Boolean).map(Number);
  const body = b.subarray(off + hlen), ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  if (descr.startsWith('<U')) {
    const w = Number(descr.slice(2)), c = new Uint32Array(ab), data = [];
    for (let i = 0; i < shape[0]; i++) { let s = ''; for (let k = 0; k < w; k++) { const x = c[i * w + k]; if (!x) break; s += String.fromCodePoint(x); } data.push(s); }
    return { shape, data };
  }
  const T = { '<i4': Int32Array, '<i2': Int16Array, '<f4': Float32Array, '<f8': Float64Array, '|u1': Uint8Array, '|b1': Uint8Array }[descr];
  if (!T) throw new Error('npy dtype not supported: ' + descr);
  return { shape, data: new T(ab) };
}
function occupancy(file, grid) {
  const z = unzip(fs.readFileSync(file)), a = k => z[k + '.npy'] && npy(z[k + '.npy']);
  const body = a('layer_body'), head = a('layer_head');
  return { ...grid, rows: body.shape[0], cols: body.shape[1], labels: a('labels').data, body: body.data, toe: a('layer_toe').data,
    head: head && head.data, room: a('extra_room').data };
}
// ---- one home ----
function load() {
  globalThis.window = globalThis; globalThis.self = globalThis;
  globalThis.document = { querySelectorAll: () => [] };
  for (const f of ['core', 'resident-nav', 'simulation', 'resident-tasks', 'standards-report'])
    vm.runInThisContext(fs.readFileSync(path.join(B, f + '.js'), 'utf8'), { filename: f + '.js' });
  for (const f of ['text', 'bsim-model', 'bsim-plan', 'bsim'])
    vm.runInThisContext(fs.readFileSync(path.join(WEB, 'js', f + '.js'), 'utf8'), { filename: f + '.js' });
  return { L: globalThis.IndoorLab, HA: globalThis.HA };
}
const outcome = runs => Object.fromEntries(runs.map(r => [`${r.persona}/${r.task}`, !r.applicable ? 'na' : r.success ? 'ok' : r.fail_code]));

async function one(scene) {
  const { L, HA } = load(), A = L.HAAdapter, d = path.join(LAB, scene);
  const ir = JSON.parse(fs.readFileSync(path.join(d, 'scene_ir.json'), 'utf8'));
  const occ = occupancy(path.join(d, (ir.occupancy && ir.occupancy.file) || 'occupancy.npz'), ir.occupancy.grid);
  const names = {};
  for (const o of [...ir.objects, ...ir.doors]) names[o.id] = HA.text.object(ir, o.id);
  const sc = { ir, occ, names }, items = JSON.parse(fs.readFileSync(path.join(WEB, 'library/catalog.json'), 'utf8')).items;
  const ids = ORDER.filter(id => L.RESIDENT_PROFILES[id]);
  const run = (edits, tasks) => ids.flatMap(id => A.runSuite(sc, id, L.RESIDENT_PROFILES[id], tasks, edits));
  const t0 = Date.now(), base = run([], TASKS), tasks = TASKS.filter(t => t !== 'T8' && base.some(r => r.task === t && r.applicable));
  const res = await HA.bsimPlan.search(sc, base, { evaluate: e => Promise.resolve(run(e, tasks)), evaluateAll: e => Promise.resolve(run(e, TASKS)),
    score: A.score, tasks, items, onProgress: () => {} });
  // The same search result the browser would cache, so opening the home re-runs only the plans instead of searching.
  fs.writeFileSync(path.join(d, 'plans.json'), JSON.stringify(HA.bsim.seedOf(ir, res)));
  return { scene, ms: Date.now() - t0, score: A.score(base), runs: outcome(base),
    na_reason: Object.fromEntries(base.filter(r => !r.applicable).map(r => [`${r.persona}/${r.task}`, r.reason])),
    plans: res.plans.map(p => ({ id: p.id, title: p.title, cost_cny: p.cost_cny, rent_ok: p.rent_ok, wall: p.wall, score: p.score,
      worse: p.worse.length > 0, runs: outcome(p.runs) })),
    personas: ids.map(id => { const { name, short, footprint, v_mps } = HA.bsim.persona(id, L.RESIDENT_PROFILES[id]); return { id, name, short, footprint, v_mps }; }),
    tasks: A.NAMES, task_names: ir.kind === 'office' ? A.namesFor(ir) : undefined };
}

// ---- all homes ----
async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--one') { process.stdout.write(JSON.stringify(await one(argv[1]))); return; }
  const j = argv[0] === '-j' ? +argv[1] : 6, only = argv.slice(argv[0] === '-j' ? 2 : 0);
  const file = path.join(LAB, 'index.json'), index = JSON.parse(fs.readFileSync(file, 'utf8'));
  const homes = index.homes.filter(h => !only.length || only.includes(h.id)), done = {};
  let next = 0;
  const worker = () => new Promise(ok => {
    const go = () => {
      if (next >= homes.length) return ok();
      const h = homes[next++], t = Date.now();
      cp.execFile(process.execPath, [__filename, '--one', h.id], { maxBuffer: 1 << 28 }, (err, out, errOut) => {
        if (err) { console.error(h.id, 'failed', errOut || err.message); return go(); }
        done[h.id] = JSON.parse(out);
        console.log(h.id, `${((Date.now() - t) / 1000).toFixed(0)} s`, 'score', done[h.id].score, 'plans', done[h.id].plans.length);
        go();
      });
    };
    go();
  });
  await Promise.all(Array.from({ length: Math.min(j, homes.length) }, worker));
  const any = Object.values(done)[0];
  if (!any) throw new Error('no home finished');
  index.generator = 'web/tools/make_lab.py（户型导入）+ web/tools/make_lab.cjs（仿真引擎和方案搜索）';
  delete index.note;
  index.personas = any.personas; index.tasks = any.tasks;
  index.homes = index.homes.map(h => {
    const r = done[h.id]; if (!r) return h;
    const { result, ...rest } = h;
    return { ...rest, score: r.score, runs: r.runs, na_reason: r.na_reason, plans: r.plans, ...(r.task_names ? { tasks: r.task_names } : {}) };
  });
  fs.writeFileSync(file, JSON.stringify(index));
  console.log('wrote', path.relative(ROOT, file), Object.keys(done).length, '/', homes.length, 'homes');
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { load, occupancy, one, LAB, ORDER, TASKS };
