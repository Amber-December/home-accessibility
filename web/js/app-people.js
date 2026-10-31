/* Residents on stage: toggle any number of them, edit B's parameters, add user-made residents from a template.
   An edited or new resident is re-run by the engine on the home as built and on every plan, then all scores are
   recomputed, so 体检, 改造 and 对比 always cover everyone in S.result.personas. */
(() => {
  'use strict';
  const HA = window.HA, S = HA.app, esc = s => HA.panels.esc(s);
  const $ = s => document.querySelector(s);
  const say = (...a) => S.chat.say(...a);

  // Pick step stays put while residents change: rebuild playback and floor layers, keep markers hidden, redraw.
  function refresh() {
    S.setupPlayback(['base']);
    if (['home', 'pick'].includes(S.step)) S.sides.forEach(s => { s.marker.visible = false; if (s.trail) s.trail.visible = false; });
    S.renderPanel();
  }
  const select = ids => { S.selectPersona(ids, [...S.tasks]); refresh(); };

  const worse = (base, runs) => {
    const after = new Map(runs.map(r => [r.persona + '|' + r.task, r]));
    return base.filter(r => r.applicable && r.success && after.has(r.persona + '|' + r.task) && !after.get(r.persona + '|' + r.task).success)
      .map(r => [r.persona, r.task]);
  };
  const put = (runs, id, add) => runs.filter(r => r.persona !== id).concat(add);

  async function onPlans(p) {
    const R = S.result, T = HA.bsim.TASKS;
    const runs = await Promise.all(R.plans.map(pl => HA.bsim.runAll([p], T, pl.edits)));
    R.plans.forEach((pl, i) => { pl.runs = put(pl.runs, p.id, runs[i]); pl.score = HA.bsim.score(pl.runs); pl.worse = worse(R.baseline.runs, pl.runs); });
  }
  // Re-run one resident everywhere. Plans still being searched pick the resident up when the search ends.
  let busy = 0;
  async function rerun(p) {
    const R = S.result;
    busy++; S.renderPanel();
    say('agent', `仿真引擎正在让${esc(p.name)}把 ${HA.bsim.TASKS.length} 项任务重走一遍…`);
    try {
      const base = await HA.bsim.runAll([p], HA.bsim.TASKS, []);
      if (!R.personas.some(x => x.id === p.id)) return;  // removed meanwhile
      R.baseline.runs = put(R.baseline.runs, p.id, base); R.baseline.score = HA.bsim.score(R.baseline.runs);
      if (R.search.running) R.ready.then(() => onPlans(R.personas.find(x => x.id === p.id) || p).then(() => S.renderPanel()));
      else await onPlans(p);
      const app = base.filter(r => r.applicable), ok = app.filter(r => r.success).length;
      say('agent', `${esc(p.name)}：${app.length} 项适用，${ok} 项走通。全屋现状 ${R.baseline.score} 分。`);
    } catch (e) {
      console.error(e); say('agent', `重跑失败：${esc(e.message)}`);
    } finally { busy--; }
    S.selectPersona(S.who, [...S.tasks]);
    refresh();
  }

  function param(value, el) {
    const [id, key] = el.dataset.key.split('|'), spec = HA.bsim.PARAMS.find(x => x[0] === key), p = S.personaObj(id);
    let v = parseFloat(value);
    if (!p || !spec || !Number.isFinite(v)) { S.renderPanel(); return; }
    v = Math.max(spec[3], Math.min(spec[4], v));
    if (v === p.profile[key]) { S.renderPanel(); return; }
    const q = HA.bsim.withParams(p, { [key]: v }), R = S.result;
    R.personas[R.personas.indexOf(p)] = q;
    return rerun(q);
  }

  function addPerson() {
    const tpl = S.personaObj($('#tpl') && $('#tpl').value) || S.personaObj(S.persona);
    const p = HA.bsim.custom(tpl);
    S.result.personas.push(p);
    S.who = [...S.who, p.id];
    return rerun(p);
  }

  function dropPerson(id) {
    const R = S.result, p = S.personaObj(id); if (!p || !p.custom) return;
    R.personas = R.personas.filter(x => x.id !== id);
    R.baseline.runs = put(R.baseline.runs, id, []); R.baseline.score = HA.bsim.score(R.baseline.runs);
    R.plans.forEach(pl => { pl.runs = put(pl.runs, id, []); pl.score = HA.bsim.score(pl.runs); pl.worse = worse(R.baseline.runs, pl.runs); });
    select(S.who.filter(x => x !== id));
  }

  S.people = {
    who(on, el) {
      const id = el.dataset.arg, ids = on ? [...S.who, id] : S.who.filter(x => x !== id);
      if (!ids.length) { el.checked = true; return; }
      select(ids);
    },
    lead: id => select([id, ...S.who.filter(x => x !== id)]),
    param, addPerson, dropPerson,
    busy: () => busy > 0,
  };
})();
