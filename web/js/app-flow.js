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
        <p class="muted">每个方案都重跑了全部住户，其他住户没有变差。价格取自素材库家具的标价。</p>`,
      buttons: [...ps.map(x => ({ label: `看方案 ${x.plan.id}`, act: 'plan', arg: x.plan.id })),
        { label: '看前后对比', act: 'go', arg: 'compare', primary: true }] });
  };

  function reportUrl() {
    const q = new URLSearchParams(location.search), u = new URLSearchParams();
    ['ir', 'occ', 'glb'].forEach(k => q.get(k) && u.set(k, q.get(k)));
    u.set('plan', S.plan);
    if (S.cons.budget != null) u.set('budget', S.cons.budget);
    if (S.cons.rent) u.set('rent', 1);
    if (S.cons.noWall) u.set('nowall', 1);
    if (S.cons.locks.size) u.set('locks', [...S.cons.locks].join(','));
    return 'report.html?' + u;
  }
  // The report page reads the engine result the app holds: residents, runs and plans without trajectories.
  function snapshot() {
    const R = S.result, slim = rs => rs.map(r => ({ ...r, traj: undefined, monologue: undefined, events: undefined }));
    const snap = { scene_id: S.ir.scene_id, personas: R.personas, tasks: R.tasks,
      baseline: { score: R.baseline.score, runs: slim(R.baseline.runs) }, plans: R.plans.map(p => ({ ...p, runs: slim(p.runs) })), search: R.search };
    try { localStorage.setItem('ha:report', JSON.stringify(snap)); return true; } catch (e) { return false; }
  }

  const repick = id => { if ($('#pick').innerHTML) $('#pick').innerHTML = HA.panels.object(S, id); };

  // 导入户型: homes come from the 素材库 (lab/index.json). H1 opens the default home, others their own IR; the engine runs every home in the browser.
  let homes = null;
  const homeHref = h => {
    if (h.hero === 'H1') return 'index.html';
    const u = new URLSearchParams({ ir: h.ir });
    return `index.html?${u}`;
  };
  const homeName = h => h.name || h.hero || h.id.replace('scene', '#');
  const kindName = h => (h.kind === 'office' ? '公共建筑' : '住宅');
  // Demo floor plans in web/plans/, drawn from the two residential homes and the office floor.
  const DEMO = [['plans/scene000064.png', '住宅 A'], ['plans/scene000021.png', '住宅 B'], ['plans/office01.png', '办公楼层']];
  const loadHomes = async () => homes || (homes = (await fetch('lab/index.json').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })).homes);

  // 上传平面图: match the image against every home's wall layout, then offer the best one to open.
  async function planMatch(src, label) {
    S.sheet('chat');
    try { await loadHomes(); } catch (err) { S.chat.say('agent', `户型列表没加载出来：${esc(err.message)}`); return; }
    S.chat.say('user', `上传平面图：${esc(label)}`);
    S.chat.say('agent', `正在把平面图的墙线和素材库里 ${homes.length} 套场景逐一比对…`);
    let res;
    try { res = await HA.planMatch.match(src, homes); } catch (err) { S.chat.say('agent', `平面图没能识别：${esc(err.message)}`); return; }
    const top = res.matches.slice(0, 3), best = top[0], pct = v => `${Math.round(v * 100)}%`;
    const sure = best.score >= .6 && (!top[1] || best.score - top[1].score >= .08);
    const rows = top.map((m, i) => `<a class="home${i ? '' : ' on'}" href="${esc(homeHref(m.home))}">` +
      `<img src="${esc(m.home.preview)}" alt="" loading="lazy" width="96" height="96"><b>${esc(homeName(m.home))}</b>` +
      `<span class="num">${kindName(m.home)} · 相似度 ${pct(m.score)}</span><span class="num">墙线 ${pct(m.walls)} · 长宽比 ${pct(m.shape)}${m.turned ? ' · 旋转 90°' : ''}</span></a>`).join('');
    S.chat.say('agent', sure
      ? `最接近的是「${esc(homeName(best.home))}」（${kindName(best.home)}，${best.home.area_m2} m²），相似度 ${pct(best.score)}。打开它会载入对应的 3D 模型，按家具库给每件家具配上尺寸、质量和碰撞体，再让住户在里面走。`
      : `没有特别接近的场景，最像的是「${esc(homeName(best.home))}」，相似度 ${pct(best.score)}。可以先用它试住，或者换一张墙线更清楚的平面图。`, {
      title: '平面图匹配结果',
      body: `<div class="plan-q"><img src="${res.query.url}" alt="上传的平面图"><span class="muted num">${res.query.size.join(' × ')} px，与 ${res.matches.length} 套场景比对</span></div>` +
        `<div class="homes">${rows}</div><p><a class="btn primary" href="${esc(homeHref(best.home))}">打开「${esc(homeName(best.home))}」并开始仿真</a></p>`,
    });
  }
  async function importCard() {
    try { await loadHomes(); } catch (err) { S.chat.say('agent', `户型列表没加载出来：${esc(err.message)}`); return; }
    const cur = S.ir.scene_id;
    const grid = homes.map(h => `<a class="home${h.id === cur ? ' on' : ''}" href="${esc(homeHref(h))}"${h.id === cur ? ' aria-current="true"' : ''}>` +
      `<img src="${esc(h.preview)}" alt="" loading="lazy" width="96" height="96"><b>${esc(homeName(h))}</b>` +
      `<span class="num">${h.kind === 'office' ? '公建 · ' : ''}${h.area_m2} m² · ${h.rooms.length} 间</span></a>`).join('');
    const upload = `<div class="plan-up"><label class="btn primary">上传平面图<input type="file" accept="image/*" data-change="planFile" hidden></label>` +
      `<span class="muted">或用示例：${DEMO.map(([u, n]) => `<button class="link" data-act="planDemo" data-arg="${u}">${n}</button>`).join('')}</span></div>`;
    S.sheet('chat');
    S.chat.say('agent', '从素材库里选一套户型。载入后会读出房间、门和家具，先核对再试住。', {
      title: `场景 ${homes.length} 套`,
      body: `${upload}<p class="muted">上传一张平面图（照片、扫描件或 CAD 导出图都行），按墙线布局匹配素材库里最接近的场景；也可以直接点下面的场景。</p><div class="homes">${grid}</div><p class="muted">家具模型在 <a href="library.html">素材库</a>；想多套一起比，去 <a href="lab.html">实验室</a>。</p>`,
    });
  }

  // Actions dispatched from app-boot's S.act.
  S.flow = {
    import: () => importCard(),
    planFile: (v, el) => { const f = el && el.files && el.files[0]; if (f) planMatch(f, f.name); },
    planDemo: u => planMatch(u, (DEMO.find(d => d[0] === u) || [u, u])[1] + ' 平面图'),
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
    export() {
      if (!S.plan) return;
      if (!snapshot()) { S.chat.say('agent', '浏览器存储已满，报告没能生成。'); return; }
      window.open(reportUrl(), '_blank', 'noopener');
    },
  };
})();
