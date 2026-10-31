/* Store, playback and actions shared by all steps. Step entry, presets and boot live in app-steps.js. */
(() => {
  'use strict';
  const HA = window.HA;
  const $ = s => document.querySelector(s);
  const S = HA.app = {
    step: 'home', persona: null, tasks: new Set(), plan: null, variant: 'base', t: 0, view: 'top',
    layers: { heat: false, sweep: false, fp: true }, preset: null, sides: [], announced: new Set(),
  };

  S.planObj = (id = S.plan) => S.result.plans.find(p => p.id === id) || S.result.plans[0];
  S.allRuns = variant => (variant === 'base' ? S.result.baseline.runs : S.planObj(variant).runs);
  S.runs = (variant, persona = S.persona) => S.allRuns(variant).filter(r => r.persona === persona);
  S.run = (variant, persona, task) => S.allRuns(variant).find(r => r.persona === persona && r.task === task);
  S.score = variant => (variant === 'base' ? S.result.baseline.score : S.planObj(variant).score);
  S.personaObj = (id = S.persona) => S.result.personas.find(p => p.id === id);
  S.edits = variant => (variant === 'base' ? [] : S.planObj(variant).edits);

  // ---- heatmap ----
  S.heatFor = variant => {
    const h = HA.layers.heatmap(S.occ, S.personaObj(), S.edits(variant), S.persona + '|' + variant);
    if (!h.mesh.parent) S.v.scene.add(h.mesh);
    return h.mesh;
  };
  S.refreshHeat = () => {
    S.v.scene.children.filter(m => m.userData.heat).forEach(m => { m.visible = false; });
    S.heatMeshes = S.sides.length ? S.sides.map(s => S.heatFor(s.variant)) : [S.heatFor(S.variant)];
    S.heatMeshes.forEach(m => { m.userData.heat = true; m.visible = S.layers.heat; });
  };

  // ---- playback ----
  const markers = {};
  function markerFor(i) {
    const key = S.persona + i;
    if (!markers[key]) { markers[key] = HA.resident.marker(S.personaObj()); S.v.scene.add(markers[key]); }
    return markers[key];
  }
  S.setupPlayback = variants => {
    Object.values(markers).forEach(m => { m.visible = false; });
    S.sides.forEach(s => s.trail && S.v.scene.remove(s.trail));
    S.sides = variants.map((variant, i) => ({ variant, marker: markerFor(i), trail: null, trailRun: null }));
    const tasks = S.runs('base').map(r => r.task).filter(t => S.tasks.has(t) || !S.run('base', S.persona, t).applicable);
    const segs = tasks.map(task => {
      const runs = variants.map(v => S.run(v, S.persona, task));
      return { task, label: `${task} ${runs[0].name}`, runs, dur: Math.max(0, ...runs.map(r => (r.applicable ? r.duration : 0))) };
    });
    S.tl.set(segs, variants.length > 1 ? ['改造前', `方案 ${S.planObj().id}`] : ['']);
    S.t = 0; S.curSeg = -1; S.stopped = null; S.announced.clear(); S.pause();
    S.v.eye = S.persona === 'wheelchair' ? 1.2 : 1.6;
    S.refreshHeat(); S.update();
  };

  S.update = () => {
    const at = S.tl.at(S.t); if (!at) return;
    S.sides.forEach((side, i) => {
      const run = at.seg.runs[i], m = side.marker;
      m.visible = !!(run && run.applicable && run.traj.length) && !['home', 'pick', 'fix'].includes(S.step);
      m.userData.fp.visible = m.userData.edge.visible = S.layers.fp;
      if (!m.visible) { side.pose = null; return; }
      const local = Math.min(at.local, run.duration), p = HA.resident.poseAt(run.traj, local);
      m.setPose(p.x, p.y, p.yaw); m.setState(local >= run.duration && !run.success ? 'fail' : 'ok');
      if (side.trailRun !== run) {
        if (side.trail) S.v.scene.remove(side.trail);
        side.trail = HA.resident.trail(run.traj, run.success ? '#660874' : '#D7263D'); side.trailRun = run; S.v.scene.add(side.trail);
      }
      side.trail.upTo(p.i + 1);
      side.pose = [p.x, p.y, p.yaw];
    });
    S.v.pose = S.sides[0] && S.sides[0].pose;
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

  // Advance time; fire contact flashes, monologue, end-of-task messages; stop at the first failure.
  S.tick = dt => {
    if (!S.playing) return;
    const prev = S.t, at = S.tl.at(prev);
    S.t = Math.min(S.tl.total(), prev + dt * S.tl.speed);
    if (at) {
      const run = at.seg.runs[0], l0 = prev - at.seg.t0, l1 = S.t - at.seg.t0;
      if (run.applicable) {
        run.events.forEach(e => { if (e.type === 'CONTACT' && e.t > l0 && e.t <= l1) S.v.flash(e.object_id); });
        run.monologue.forEach(m => { if (m.t > l0 - 1e-6 && m.t <= l1) S.subtitle(m.text); });
        if (l0 < run.duration && l1 >= run.duration) {
          S.onRunEnd(run);
          if (!run.success && S.sides.length === 1 && S.stopped !== run) {
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
    const v = run.violations.find(x => x.severity === 'red') || run.violations[0]; if (!v) return;
    const t = HA.text.violation(S.ir, v), el = $('#problem');
    el.innerHTML = `<b>✕ ${HA.panels.esc(run.name)} · ${HA.panels.esc(t.title)}</b><div class="nums">${t.nums}</div>
      <div class="muted">${HA.panels.esc(t.std)} · 来源 ${HA.text.source(t.source)}</div>
      <div class="btns"><button class="primary small" data-act="resume">继续</button><button class="small" data-act="next">看下一个</button></div>`;
    el.hidden = false;
    S.v.keepRed = new Set([v.object_id]); S.v.mark(v.object_id, 'red');
    S.v.tag(t.nums, v.location[0], v.location[1]);
    if (S.preset) setTimeout(() => S.act('resume'), 2000);
  };
  S.hideProblem = () => { $('#problem').hidden = true; S.v && S.v.tag(null); };
})();
