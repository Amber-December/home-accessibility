/* Step machine (户型 → 住户 → 试住 → 体检 → 改造 → 对比), step bar, chat cards. */
(() => {
  'use strict';
  const HA = window.HA, S = HA.app, T = HA.text;
  const $ = s => document.querySelector(s), esc = s => HA.panels.esc(s);
  const STEPS = ['home', 'pick', 'stay', 'report', 'fix', 'compare'];
  const NAMES = ['户型', '住户', '试住', '体检', '改造', '对比'];
  S.reached = 0;

  // Step bar: braille numeral before each name; visited steps have filled dots; later steps unlock in order.
  S.renderSteps = () => {
    const plans = S.result && S.result.plans.length, busy = S.result && S.result.search.running, sr = S.search || {};
    const prog = busy ? `方案搜索中 ${sr.done || 0}/${sr.total || '…'}` : '';
    $('#steps').innerHTML = STEPS.map((id, i) => {
      const locked = i > S.reached || (i >= 4 && !plans);
      const why = i >= 4 && busy ? prog : i >= 4 && !plans ? '没有可用的改造方案' : `先完成「${NAMES[i - 1]}」`;
      return `${i ? '<span class="sep" aria-hidden="true"></span>' : ''}<button data-act="go" data-arg="${id}"
        class="${id === S.step ? 'on' : ''} ${i <= S.reached ? 'done' : ''}" ${locked ? `disabled title="${why}"` : ''}
        ${id === S.step ? 'aria-current="step"' : ''}><span aria-hidden="true">${T.brailleDigit(i + 1)}</span>${NAMES[i]}${i === 4 && busy ? `<small class="num">${sr.done || 0}/${sr.total || '…'}</small>` : ''}</button>`;
    }).join('');
  };

  S.renderPanel = () => {
    const at = S.tl.at(S.t);
    $('#panel').innerHTML = S.step === 'stay' ? (S.scenes && S.scenes.panel()) || HA.panels.stay(S, at && at.seg.runs[0], at && at.seg) : HA.panels[S.step](S);
  };

  // Button state, walk hint and S.view follow the viewer, which also changes view on its own (Esc leaves walk).
  S.onView = name => {
    S.view = name;
    document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.arg === name));
    $('#walk-hint').hidden = name !== 'walk';
  };
  const setView = name => S.v.setView(name);
  S.setView = setView;
  function setLayer(name, on) {
    S.layers[name] = on;
    const box = document.querySelector(`#layers input[data-arg="${name}"]`); if (box) box.checked = on;
    if (name === 'heat') S.refreshHeat();
    if (name === 'risk') { S.refreshRisk(); $('#risk-legend').hidden = !on; $('#risk-mode').textContent = HA.risk.MODES[S.riskMode]; if (['report', 'pick'].includes(S.step)) S.renderPanel(); }
    if (name === 'sweep') S.v.built.sweeps.visible = on;
    if (name === 'fp') S.update();
  }
  S.setLayer = setLayer;
  function showTimeline(on) { S.tl.show(on); document.body.classList.toggle('tl', on); }

  S.intentCard = function () {
    const ps = S.picked(), tasks = HA.bsim.TASKS.filter(t => S.tasks.has(t));
    const rows = ps.map(p => {
      const rs = tasks.map(t => S.run('base', p.id, t)).filter(Boolean), on = rs.filter(r => r.applicable), na = rs.filter(r => !r.applicable);
      return `<li><b>${esc(p.name)}</b>：${on.map(r => `${r.task} ${esc(r.name)}`).join('、') || '<span class="muted">没有可试的任务</span>'}
        ${na.length ? `<div class="muted">${na.map(r => `${r.task} 不适用，${esc(r.reason)}`).join('；')}</div>` : ''}</li>`;
    }).join('');
    S.chat.say('agent', '我理解的是：', { title: `${ps.length > 1 ? `${ps.length} 位住户` : esc(ps[0].name)} 在这套房子里住一天`,
      body: `<ul>${rows}</ul>`,
      buttons: [{ label: '确认，开始试住', act: 'go', arg: 'stay', primary: true }, { label: '改', act: 'go', arg: 'pick' }] });
  };

  S.onRunEnd = run => {
    const key = run.persona + run.task + S.step; if (S.announced.has(key) || S.step !== 'stay') return; S.announced.add(key);
    const who = S.who.length > 1 ? `${T.persona(run.persona, S)} · ` : '';
    if (run.hazard) {
      S.chat.say('agent', run.success ? `✓ ${who}${run.time_s} 秒撤到室外。` : `✕ ${who}${esc(T.code(run.fail_code))}：${esc(run.fail_reason)}。`);
      return;
    }
    if (run.success) {
      S.chat.say('agent', `✓ ${who}${esc(run.name)}：${run.time_s} 秒完成，最窄处离${esc(T.object(S.ir, run.min_clearance_object))} ${T.cm(Math.max(0, run.min_clearance_m))}。`);
    } else {
      const v = run.violations.find(x => x.severity === 'red'), t = v && T.violation(S.ir, v);
      S.chat.say('agent', `✕ ${who}${esc(run.name)}：${t ? `${esc(t.title)}，${t.nums}` : esc(run.fail_reason || T.code(run.fail_code))}。`);
    }
  };
  S.onEnd = () => {
    if (S.step !== 'stay') return;
    S.chat.say('agent', '这一轮试住结束了。', { buttons: [{ label: '看体检报告', act: 'go', arg: 'report', primary: true }] });
  };

  // Enter a step: set 3D view, layers, timeline, right panel and chat card.
  S.enter = step => {
    if (step === 'compare' && !S.ensurePlan()) step = 'fix';
    // A fire or quake scene runs the hazard for the selected residents first, then plays it.
    if (step === 'stay' && S.scenes && S.scenes.pending()) {
      S.scenes.prepare().then(() => S.enter('stay')).catch(e => { console.error(e); S.chat.say('agent', `灾害推演失败：${esc(e.message)}`); });
      return;
    }
    const idx = STEPS.indexOf(step);
    if (idx < 0 || ((step === 'fix' || step === 'compare') && !S.result.plans.length)) return;
    S.step = step; S.reached = Math.max(S.reached, idx); S.pause(); S.hideProblem(); S.v.split = null; $('#split-labels').hidden = true;
    S.v.clearMarks(); S.v.keepRed = null; S.variant = 'base';
    HA.resident.applyPlan(S.v, null, null);
    S.renderSteps();
    if (step === 'home' || step === 'pick') {
      S.setupPlayback(['base']); setView('top'); setLayer('heat', step === 'pick'); showTimeline(false);
      S.sides.forEach(s => { s.marker.visible = false; if (s.trail) s.trail.visible = false; });
    } else if (step === 'stay') {
      S.setupPlayback(['base']); setLayer('heat', false); showTimeline(true); setView(S.preset && S.preset.view || 'follow');
      if (!S.preset || S.preset.autoplay) S.play();
    } else if (step === 'report') {
      S.setupPlayback(['base']); setView('top'); setLayer('heat', true); showTimeline(true);
      const items = HA.panels.issues(S, 'base');
      items.filter(x => x.v.severity === 'red').forEach(x => S.v.mark(x.v.object_id, 'red'));
      // 结论卡 (PRD 5.3): how many places fail, the score, one 看现场 per red item, then 小改 / 整屋重新布置.
      const red = items.filter(x => x.v.severity === 'red'), score = S.score('base');
      S.chat.say('agent', '体检完成。', {
        title: red.length ? `有 ${red.length} 处过不去，总分 ${score}` : `没有过不去的地方，总分 ${score}`,
        body: `<ul class="look">${red.map(x => `<li><span>${T.persona(x.r.persona, S)} ${esc(x.r.name)}：${esc(T.violation(S.ir, x.v).title)}</span>
          <button class="small" data-act="look" data-arg="${items.indexOf(x)}">看现场</button></li>`).join('')}</ul>
          ${items.length > red.length ? `<p class="muted">另有黄色提醒 ${items.length - red.length} 条，见右侧。</p>` : ''}`,
        buttons: [{ label: '小改', act: 'go', arg: 'fix', primary: true, disabled: !S.result.plans.length },
          { label: '整屋重新布置', act: 'relayout', disabled: !S.result.plans.length }] });
    } else if (step === 'fix') {
      S.ensurePlan(); setView('top'); setLayer('heat', true); showTimeline(false);
      S.showPlan(); S.fixCard();
      const pl = S.plan && S.planObj(), e = pl && pl.edits.find(e => S.ir.objects.some(o => o.id === e.object_id));
      if (e) { const o = S.ir.objects.find(o => o.id === e.object_id); S.v.flyTo((o.aabb.min[0] + o.aabb.max[0]) / 2, (o.aabb.min[1] + o.aabb.max[1]) / 2, 9); }
    } else if (step === 'compare') {
      const pl = S.planObj(), worse = S.allRuns('base').filter(r => r.applicable && r.success && !S.run(pl.id, r.persona, r.task).success);
      S.chat.say('agent', `方案 ${pl.id} 改完：${S.score('base')} → ${pl.score} 分，${worse.length ? `变差 ${worse.length} 项` : '没有住户变差'}。`, {
        buttons: [{ label: '导出报告', act: 'export', primary: true }] });
      S.setupPlayback(['base', S.plan]); setView('top'); setLayer('heat', false); showTimeline(true);
      $('#split-labels').hidden = false; $('#split-right').textContent = `方案 ${pl.id}`;
      S.v.split = [0, 1].map(i => ({ apply() {
        HA.resident.applyPlan(S.v, i ? pl.edits : null, i ? 'after' : null);
        S.sides.forEach(s => { s.marker.visible = s.vi === i && !!s.pose; if (s.trail) s.trail.visible = s.vi === i; });
        (S.heatMeshes || []).forEach((m, j) => { m.visible = S.layers.heat && j === i; });
        (S.riskMeshes || []).forEach((m, j) => { m.visible = S.layers.risk && j === i; });
      } }));
      if (!S.preset || S.preset.autoplay) S.play();
    }
    S.renderPanel();
  };
})();
