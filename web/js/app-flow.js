/* Natural-language entry and the user's conditions. Chat text → echo card → 试住; 改造 filters candidates by the
   conditions (budget, rental, wall, locked objects) and recommends 省钱 / 均衡 / 最安全. */
(() => {
  'use strict';
  const HA = window.HA, S = HA.app, T = HA.text, P = HA.plans;
  const $ = s => document.querySelector(s), esc = s => HA.panels.esc(s);
  const EXAMPLES = ['我坐手动轮椅，想看看能不能自己上厕所，预算 5000 以内', '我妈用助行器，房子是租的', '预算 2 万以内，不想动墙，衣柜不要动'];
  S.cons = P.fresh();

  S.picks = () => P.picks(S.result.plans, S.score('base'), S.cons);
  S.planOk = (id = S.plan) => { const pl = S.result.plans.find(p => p.id === id); return !!pl && !P.why(pl, S.cons); };
  // Keep the chosen plan while it meets the conditions; otherwise take 均衡 (or the only card left).
  S.ensurePlan = () => {
    if (S.plan && S.planOk()) return true;
    const ps = S.picks(), x = ps.find(p => p.labels.includes('均衡')) || ps[0];
    S.plan = x ? x.plan.id : null;
    return !!x;
  };
  S.consText = (c = S.cons) => [
    c.budget != null && `预算 ${T.cny(c.budget)} 以内`,
    c.rent && '租房，不改门和墙',
    !c.rent && c.noWall && '不动墙',
    c.locks.size && `不动${[...c.locks].map(id => T.object(S.ir, id)).join('、')}`,
  ].filter(Boolean);

  S.examples = () => S.chat.say('agent', '可以直接说谁来住、想做什么、预算多少，比如：',
    { buttons: EXAMPLES.map(t => ({ label: esc(t), act: 'say', arg: esc(t) })) });

  const merge = it => ({
    budget: it.budget ?? S.cons.budget,
    rent: it.rent ?? S.cons.rent,
    noWall: S.cons.noWall || it.noWall,
    locks: new Set([...S.cons.locks, ...it.locks.map(l => l.id)]),
  });

  // Echo what was understood and wait for 确认 (PRD 5.2). Nothing runs before that.
  S.onSay = text => {
    S.chat.say('user', esc(text));
    const it = HA.intent.parse(text, S.ir);
    if (!it.understood) { S.chat.say('agent', '这句话里没找到住户、任务或条件。'); S.examples(); return; }
    const persona = it.persona || S.persona, runs = S.runs('base', persona);
    const want = it.tasks.length ? it.tasks : runs.filter(r => r.applicable).map(r => r.task);
    const on = runs.filter(r => want.includes(r.task) && r.applicable), na = runs.filter(r => want.includes(r.task) && !r.applicable);
    const cons = merge(it), runNow = !!(it.persona || it.tasks.length) || S.reached < 3;
    if (!on.length) { S.chat.say('agent', `${esc(S.personaObj(persona).name)}没有可试的任务：${na.map(r => `${r.task} ${esc(r.name)}不适用，${esc(r.reason)}`).join('；')}。`); return; }
    S.pending = { persona, tasks: on.map(r => r.task), cons, runNow };
    const li = (k, v, note) => `<li><span class="k">${k}</span><span>${v}${note ? ` <span class="muted">${note}</span>` : ''}</span></li>`;
    const body = `<ul class="echo">${li('住户', esc(S.personaObj(persona).name), it.persona ? '' : '沿用当前')}
      ${li('任务', on.map(r => `${r.task} ${esc(r.name)}`).join('、'), it.tasks.length ? '' : '全部适用任务')}
      ${na.map(r => li('', `<span class="muted">${r.task} ${esc(r.name)}：不适用，${esc(r.reason)}</span>`)).join('')}
      ${li('条件', esc(S.consText(cons).join('；') || '不限'))}</ul>`;
    S.chat.say('agent', '我理解的是：', { body, buttons: [
      { label: runNow ? '确认，开始试住' : '确认，重新挑方案', act: 'intentOk', primary: true },
      { label: '改', act: 'go', arg: 'pick' }] });
  };

  // After a condition changes: keep or swap the plan, redraw the 改造 step, say one line.
  // Several condition changes in a row update one chat line instead of stacking new ones.
  let consMsg = null, consFrom = null;
  function refilter() {
    if (S.step !== 'fix') { S.renderPanel(); return; }
    const again = consMsg && consMsg.parentNode && !consMsg.nextElementSibling;
    if (!again) consFrom = S.plan;
    const ok = S.ensurePlan(), n = S.result.plans.filter(p => !P.why(p, S.cons)).length;
    S.showPlan();
    if (again) consMsg.remove();
    consMsg = S.chat.say('agent', !ok ? '这些条件下没有能提分的方案。放宽预算或解除锁定再试。'
      : `按新条件，${S.result.plans.length} 个候选里有 ${n} 个满足${S.plan !== consFrom ? `，换成方案 ${S.plan}` : ''}。`);
  }

  // Show the chosen plan in the 改造 step: ghosts at the old places, edited objects marked, heatmap of the plan.
  S.showPlan = () => {
    const pl = S.plan ? S.planObj() : null;
    S.v.clearMarks(); S.variant = pl ? pl.id : 'base';
    HA.resident.applyPlan(S.v, pl ? pl.edits : null, pl ? 'preview' : null);
    if (pl) pl.edits.forEach(e => S.v.mark(e.object_id, 'blue'));
    S.setupPlayback([S.variant]);
    S.sides.forEach(s => { s.marker.visible = false; });
    S.renderSteps(); S.renderPanel();
  };

  // 方案卡 in the chat (PRD 5.3): one line per recommended card.
  S.fixCard = () => {
    const ps = S.picks(), base = S.score('base'), cond = S.consText().join('；') || '不限';
    if (!ps.length) return S.chat.say('agent', `按你的条件（${esc(cond)}）没有能提分的方案。可以在右侧放宽预算或解除锁定。`);
    S.chat.say('agent', `按你的条件（${esc(cond)}），推荐：`, {
      body: `<ul>${ps.map(x => `<li><b>${x.labels.join('/')}</b> · 方案 ${x.plan.id}（${T.cny(x.plan.cost_cny)}）：${base} → ${x.plan.score} 分</li>`).join('')}</ul>
        <p class="muted">每个方案都重跑了全部住户，其他住户没有变差。价格是样例参考价。</p>`,
      buttons: [...ps.map(x => ({ label: `看方案 ${x.plan.id}`, act: 'plan', arg: x.plan.id })),
        { label: '看前后对比', act: 'go', arg: 'compare', primary: true }] });
  };

  function reportUrl() {
    const q = new URLSearchParams(location.search), u = new URLSearchParams();
    ['ir', 'result'].forEach(k => q.get(k) && u.set(k, q.get(k)));
    u.set('plan', S.plan);
    if (S.cons.budget != null) u.set('budget', S.cons.budget);
    if (S.cons.rent) u.set('rent', 1);
    if (S.cons.noWall) u.set('nowall', 1);
    if (S.cons.locks.size) u.set('locks', [...S.cons.locks].join(','));
    return 'report.html?' + u;
  }

  const repick = id => { if ($('#pick').innerHTML) $('#pick').innerHTML = HA.panels.object(S, id); };
  // Actions dispatched from app-boot's S.act.
  S.flow = {
    say: text => S.onSay(text),
    intentOk() {
      const q = S.pending; if (!q) return;
      S.pending = null; S.cons = q.cons;
      if (!q.runNow) return S.enter('fix');
      S.selectPersona(q.persona, q.tasks);
      S.enter('stay');
    },
    budget(v) { const n = parseFloat(v); S.cons.budget = Number.isFinite(n) && n >= 0 ? Math.round(n) : null; refilter(); },
    rent(v) { S.cons.rent = v === '1'; refilter(); },
    noWall(v) { S.cons.noWall = !!v; refilter(); },
    lock(id) { S.cons.locks.add(id); refilter(); repick(id); },
    unlock(id) { S.cons.locks.delete(id); refilter(); repick(id); },
    plan(id) { S.plan = id; if (S.step === 'fix') S.showPlan(); else S.enter('fix'); },
    export() { if (S.plan) window.open(reportUrl(), '_blank', 'noopener'); },
  };
})();
