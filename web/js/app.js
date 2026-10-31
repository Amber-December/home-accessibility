/* Store, playback and actions shared by all steps. Step entry lives in app-steps.js, residents in app-people.js,
   scenes in app-scenes.js, presets and boot in app-boot.js. Several residents can be on at once (S.who);
   S.persona is the first of them, the one the camera follows. */
(() => {
  'use strict';
  const HA = window.HA;
  const $ = s => document.querySelector(s);
  const S = HA.app = {
    step: 'home', who: [], persona: null, tasks: new Set(), plan: null, variant: 'base', t: 0, view: 'top',
    layers: { heat: false, risk: false, sweep: false, fp: true }, preset: null, sides: [], announced: new Set(),
  };

  S.planObj = (id = S.plan) => S.result.plans.find(p => p.id === id) || S.result.plans[0];
  S.allRuns = variant => (variant === 'base' ? S.result.baseline.runs : S.planObj(variant).runs);
  S.runs = (variant, persona = S.persona) => S.allRuns(variant).filter(r => r.persona === persona);
  S.run = (variant, persona, task) => S.allRuns(variant).find(r => r.persona === persona && r.task === task);
  S.score = variant => (variant === 'base' ? S.result.baseline.score : S.planObj(variant).score);
  S.personaObj = (id = S.persona) => S.result.personas.find(p => p.id === id);
  S.edits = variant => (variant === 'base' ? [] : S.planObj(variant).edits);
  S.picked = () => S.who.map(id => S.personaObj(id)).filter(Boolean);
  // Runs of the selected residents on the selected tasks.
  S.selRuns = variant => S.allRuns(variant).filter(r => S.who.includes(r.persona) && S.tasks.has(r.task));
  S.taskName = t => (S.result.tasks && S.result.tasks[t]) || t;
  const whoKey = () => S.picked().map(p => `${p.id}:${p.footprint.size.join('x')}`).join(',');

  // ---- floor layers: clearance (widest selected resident) and risk points (selected residents and tasks) ----
  const floor = (kind, make) => {
    S.v.scene.children.filter(m => m.userData[kind]).forEach(m => { m.visible = false; });
    const vs = S.sides.length ? [...new Set(S.sides.map(s => s.variant))] : [S.variant];
    const meshes = vs.map(variant => { const m = make(variant); if (!m.parent) S.v.scene.add(m); m.userData[kind] = true; return m; });
    meshes.forEach(m => { m.visible = S.layers[kind]; });
    return meshes;
  };
  S.refreshHeat = () => {
    if (!S.who.length) return;
    S.heatMeshes = floor('heat', variant => HA.layers.heatmap(S.occ, S.picked(), S.edits(variant), whoKey() + '|' + variant).mesh);
  };
  S.refreshRisk = () => {
    if (!S.who.length || !S.bgrid) return;
    S.riskMeshes = floor('risk', variant => HA.risk.layer(S.bgrid, S.selRuns(variant), `${whoKey()}|${[...S.tasks].sort()}|${variant}|${S.riskMode}`, S.riskMode).mesh);
  };
  S.riskMode = 'access';
  S.refreshFloor = () => { S.refreshHeat(); S.refreshRisk(); };

  // ---- playback: one row per (variant, resident) ----
  const markers = {};
  function markerFor(p, vi) {
    const key = `${p.id}|${vi}|${p.footprint.size.join('x')}`;
    if (!markers[key]) { markers[key] = HA.resident.marker(p); S.v.scene.add(markers[key]); }
    return markers[key];
  }
  S.setupPlayback = variants => {
    Object.values(markers).forEach(m => { m.visible = false; });
    S.sides.forEach(s => s.trail && S.v.scene.remove(s.trail));
    const ps = S.picked();
    S.sides = variants.flatMap((variant, vi) => ps.map(p => ({ variant, vi, persona: p.id, color: p.color, marker: markerFor(p, vi), trail: null, trailRun: null })));
    const tasks = HA.bsim.TASKS.filter(t => S.tasks.has(t));
    const segs = (S.scenes && S.scenes.segs(S.sides)) || tasks.map(task => {
      const runs = S.sides.map(s => S.run(s.variant, s.persona, task));
      return { task, label: `${task} ${S.taskName(task)}`, runs, dur: Math.max(0, ...runs.map(r => (r && r.applicable ? r.duration : 0))) };
    });
    const name = s => `${HA.text.persona(s.persona, S)}${variants.length > 1 ? ` · ${s.vi ? `方案 ${S.planObj().id}` : '改造前'}` : ''}`;
    S.tl.set(segs, S.sides.length > 1 ? S.sides.map(name) : ['']);
    S.t = 0; S.curSeg = -1; S.stopped = null; S.announced.clear(); S.pause();
    const lead = S.personaObj();
    S.v.eye = lead && lead.type === 'wheelchair' ? 1.2 : 1.6;
    S.refreshFloor(); S.update();
  };

  S.update = () => {
    const at = S.tl.at(S.t); if (!at) return;
    let lead = null;
    S.sides.forEach((side, i) => {
      const run = at.seg.runs[i], m = side.marker;
      m.visible = !!(run && run.applicable && run.traj.length) && !['home', 'pick', 'fix'].includes(S.step);
      m.userData.fp.visible = m.userData.edge.visible = S.layers.fp;
      if (!m.visible) { side.pose = null; if (side.trail) side.trail.visible = false; return; }
      const local = Math.min(at.local, run.duration), p = HA.resident.poseAt(run.traj, local);
      m.setPose(p.x, p.y, p.yaw); m.setState(local >= run.duration && !run.success ? 'fail' : 'ok');
      if (side.trailRun !== run) {
        if (side.trail) S.v.scene.remove(side.trail);
        side.trail = HA.resident.trail(run.traj, run.success ? side.color : '#D7263D'); side.trailRun = run; S.v.scene.add(side.trail);
      }
      side.trail.visible = true; side.trail.upTo(p.i + 1);
      side.pose = [p.x, p.y, p.yaw];
      if (!lead && side.vi === (S.v.splitSide || 0)) lead = side.pose;
    });
    S.v.pose = lead;
    S.tl.setTime(S.t);
    if (at.k !== S.curSeg) { S.curSeg = at.k; if (S.step === 'stay') S.renderPanel(); }
  };

  S.play = () => { if (S.t >= S.tl.total() - 1e-3) S.t = 0; S.playing = true; S.tl.setPlaying(true); S.hideProblem(); };
  S.pause = () => { S.playing = false; S.tl && S.tl.setPlaying(false); };
  S.seek = t => { S.t = Math.max(0, Math.min(S.tl.total(), t)); S.hideProblem(); S.update(); };

  let subTimer = null;
  S.subtitle = text => {
    const el = $('#subtitle'); el.textContent = text; el.hidden = !text;
    clearTimeout(subTimer); if (text) subTimer = setTimeout(() => { el.hidden = true; }, 3500);
  };

  // Advance time; fire contact flashes, the lead resident's monologue, end-of-task messages.
  // In 试住 playback stops where the lead resident fails.
  S.tick = dt => {
    if (!S.playing) return;
    const prev = S.t, at = S.tl.at(prev);
    S.t = Math.min(S.tl.total(), prev + dt * S.tl.speed);
    if (at) {
      const l0 = prev - at.seg.t0, l1 = S.t - at.seg.t0;
      for (let i = 0; i < at.seg.runs.length; i++) {
        const run = at.seg.runs[i]; if (!run || !run.applicable) continue;
        run.events.forEach(e => { if (e.type === 'CONTACT' && e.object_id && e.t > l0 && e.t <= l1) S.v.flash(e.object_id); });
        if (i === 0) run.monologue.forEach(m => { if (m.t > l0 - 1e-6 && m.t <= l1) S.subtitle(m.text); });
        if (l0 < run.duration && l1 >= run.duration) {
          S.onRunEnd(run);
          if (i === 0 && !run.success && S.step === 'stay' && S.stopped !== run) {
            S.stopped = run; S.t = at.seg.t0 + run.duration - 1e-3; S.pause(); S.update(); S.showProblem(run); return;
          }
        }
      }
    }
    if (S.t >= S.tl.total()) { S.pause(); S.onEnd && S.onEnd(); }
    S.update();
  };

  // ---- problem card ----
  S.showProblem = run => {
    const v = run.violations.find(x => x.severity === 'red') || run.violations[0];
    const t = v ? HA.text.violation(S.ir, v) : { title: HA.text.code(run.fail_code), nums: HA.panels.esc(run.fail_reason || ''), std: '' };
    const el = $('#problem'), who = S.who.length > 1 ? `${HA.text.persona(run.persona, S)} · ` : '';
    el.innerHTML = `<b>✕ ${who}${HA.panels.esc(run.name)} · ${HA.panels.esc(t.title)}</b><div class="nums">${t.nums}</div>
      ${t.std ? `<div class="muted">${HA.panels.esc(t.std)}</div>` : ''}
      <div class="btns"><button class="primary small" data-act="resume">继续</button><button class="small" data-act="next">看下一个</button></div>`;
    el.hidden = false;
    const loc = v && v.location || (run.traj.length ? run.traj[run.traj.length - 1].slice(1, 3) : null);
    if (v && v.object_id) { S.v.keepRed = new Set([v.object_id]); S.v.mark(v.object_id, 'red'); }
    if (loc) S.v.tag(t.nums, loc[0], loc[1]);
    if (S.preset) setTimeout(() => S.act('resume'), 2000);
  };
  S.hideProblem = () => { $('#problem').hidden = true; S.v && S.v.tag(null); };
})();
