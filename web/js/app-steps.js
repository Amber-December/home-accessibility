/* Step machine (选人 → 试住 → 体检 → 改造 → 对比), actions, chat cards, recording presets, boot. */
(() => {
  'use strict';
  const HA = window.HA, S = HA.app, T = HA.text;
  const $ = s => document.querySelector(s), esc = s => HA.panels.esc(s);
  const STEPS = ['pick', 'stay', 'report', 'fix', 'compare'];

  S.renderPanel = () => {
    const at = S.tl.at(S.t);
    $('#panel').innerHTML = S.step === 'stay' ? HA.panels.stay(S, at && at.seg.runs[0]) : HA.panels[S.step](S);
  };

  function setView(name) {
    S.view = name; S.v.setView(name);
    document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.arg === name));
  }
  function setLayer(name, on) {
    S.layers[name] = on;
    const box = document.querySelector(`#layers input[data-arg="${name}"]`); if (box) box.checked = on;
    if (name === 'heat') S.refreshHeat();
    if (name === 'sweep') S.v.built.sweeps.visible = on;
    if (name === 'fp') S.update();
  }
  function showTimeline(on) { S.tl.show(on); $('main').classList.toggle('notl', !on); }

  S.intentCard = function () {
    const p = S.personaObj(), runs = S.runs('base');
    const on = runs.filter(r => S.tasks.has(r.task)), na = runs.filter(r => !r.applicable);
    S.chat.say('agent', '我理解的是：', { title: `${esc(p.name)} 在这套房子里住一天`,
      body: `<ul>${on.map(r => `<li>${r.task} ${esc(r.name)}</li>`).join('')}${na.map(r => `<li class="muted">${r.task} ${esc(r.name)}：不适用，${esc(r.reason)}</li>`).join('')}</ul>`,
      buttons: [{ label: '确认，开始试住', act: 'go', arg: 'stay', primary: true }, { label: '改', act: 'go', arg: 'pick' }] });
  };

  S.onRunEnd = run => {
    const key = run.persona + run.task + S.step; if (S.announced.has(key) || S.step !== 'stay') return; S.announced.add(key);
    if (run.success) {
      S.chat.say('agent', `✓ ${esc(run.name)}：${run.time_s} 秒完成，最窄处离${esc(T.object(S.ir, run.min_clearance_object))} ${T.cm(Math.max(0, run.min_clearance_m))}。`);
    } else {
      const v = run.violations.find(x => x.severity === 'red'), t = v && T.violation(S.ir, v);
      S.chat.say('agent', `✕ ${esc(run.name)}：${t ? `${esc(t.title)}，${t.nums}` : esc(T.code(run.fail_code))}。`);
    }
  };
  S.onEnd = () => {
    if (S.step !== 'stay') return;
    S.chat.say('agent', '这一轮试住结束了。', { buttons: [{ label: '看体检报告', act: 'go', arg: 'report', primary: true }] });
  };

  // Enter a step: set 3D view, layers, timeline, right panel and chat card.
  S.enter = step => {
    if ((step === 'fix' || step === 'compare') && !S.result.plans.length) return;
    S.step = step; S.pause(); S.hideProblem(); S.v.split = null; $('#split-labels').hidden = true;
    S.v.clearMarks(); S.v.keepRed = null; S.variant = 'base';
    HA.resident.applyPlan(S.v, null, null);
    document.querySelectorAll('#steps button').forEach(b => b.classList.toggle('on', b.dataset.arg === step));
    if (step === 'pick') {
      S.setupPlayback(['base']); setView('top'); setLayer('heat', true); showTimeline(false);
      S.sides.forEach(s => { s.marker.visible = false; if (s.trail) s.trail.visible = false; });
    } else if (step === 'stay') {
      S.setupPlayback(['base']); setLayer('heat', false); showTimeline(true); setView(S.preset && S.preset.view || 'follow');
      if (!S.preset || S.preset.autoplay) S.play();
    } else if (step === 'report') {
      S.setupPlayback(['base']); setView('top'); setLayer('heat', true); showTimeline(true);
      const items = HA.panels.issues(S, 'base');
      items.filter(x => x.v.severity === 'red').forEach(x => S.v.mark(x.v.object_id, 'red'));
      const red = items.filter(x => x.v.severity === 'red');
      S.chat.say('agent', `体检结果 ${S.score('base')} 分。`, { title: `红色问题 ${red.length} 个，黄色 ${items.length - red.length} 个`,
        body: `<ul>${red.map(x => `<li>${T.persona(x.r.persona)} ${esc(x.r.name)}：${esc(T.violation(S.ir, x.v).title)}</li>`).join('')}</ul>`,
        buttons: [{ label: '看第一个问题', act: 'look', arg: items.indexOf(red[0]) }, { label: '帮我改', act: 'go', arg: 'fix', primary: true }] });
    } else if (step === 'fix') {
      S.plan = S.plan || S.result.plans[0].id; S.variant = S.plan;
      const pl = S.planObj();
      HA.resident.applyPlan(S.v, pl.edits, 'preview'); pl.edits.forEach(e => S.v.mark(e.object_id, 'blue'));
      S.setupPlayback([S.plan]); setView('top'); setLayer('heat', true); showTimeline(false);
      S.sides.forEach(s => { s.marker.visible = false; });
      if (pl.edits[0]) { const o = S.ir.objects.find(o => o.id === pl.edits[0].object_id); if (o) S.v.flyTo((o.aabb.min[0] + o.aabb.max[0]) / 2, (o.aabb.min[1] + o.aabb.max[1]) / 2, 6); }
      S.chat.say('agent', `方案 ${pl.id}：${esc(pl.title)}，${S.score('base')} → ${pl.score} 分。`, {
        body: `<ul>${pl.edits.map(e => `<li>${esc(T.edit(S.ir, e))}</li>`).join('')}</ul>`,
        buttons: [{ label: '看前后对比', act: 'go', arg: 'compare', primary: true }] });
    } else if (step === 'compare') {
      S.plan = S.plan || S.result.plans[0].id;
      const pl = S.planObj();
      S.setupPlayback(['base', S.plan]); setView('top'); setLayer('heat', false); showTimeline(true);
      $('#split-labels').hidden = false; $('#split-right').textContent = `方案 ${pl.id}`;
      S.v.split = S.sides.map((side, i) => ({ apply() {
        HA.resident.applyPlan(S.v, i ? pl.edits : null, i ? 'after' : null);
        S.sides.forEach((s, j) => { s.marker.visible = j === i && !!s.pose; if (s.trail) s.trail.visible = j === i; });
        (S.heatMeshes || []).forEach((m, j) => { m.visible = S.layers.heat && j === i; });
      } }));
      if (!S.preset || S.preset.autoplay) S.play();
    }
    S.renderPanel();
  };
})();
