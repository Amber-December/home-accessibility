/* Right column: one panel per step. Buttons carry data-act / data-arg, inputs data-change; app-boot.js dispatches them. */
(() => {
  'use strict';
  const HA = window.HA = window.HA || {};
  const T = () => HA.text;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const icon = run => { const s = HA.timeline.status(run); return `<b class="st ${s}">${HA.timeline.ICON[s]}</b>`; };
  const shape = f => f.shape === 'rect' ? `${f.size[0].toFixed(2)} × ${f.size[1].toFixed(2)} m` : `直径 ${(2 * f.r).toFixed(2)} m`;
  const sw = c => `<i class="sw" style="background:${esc(c)}"></i>`;
  const who = (S, id) => esc(T().persona(id, S));
  const fmt = v => (typeof v === 'number' ? +v.toFixed(2) : v);

  // 选住户: any number of residents at once, each with B's editable parameters; the first one leads the camera.
  function pick(S) {
    const sel = new Set(S.who), P = HA.bsim.PARAMS;
    const cards = S.result.personas.map(p => {
      const on = sel.has(p.id), lead = p.id === S.persona;
      const params = on ? `<div class="params">${P.map(([k, label, unit, lo, hi, st]) => `<label>${label}${unit ? ` ${unit}` : ''}
        <input type="number" min="${lo}" max="${hi}" step="${st}" value="${fmt(p.profile[k])}" data-change="param" data-key="${esc(p.id)}|${k}" aria-label="${esc(p.name)} ${label}"></label>`).join('')}</div>` : '';
      const btns = on ? `${!lead ? `<button class="small" data-act="lead" data-arg="${esc(p.id)}">镜头跟随</button>` : ''}
        ${p.custom ? `<button class="small" data-act="dropPerson" data-arg="${esc(p.id)}">删除</button>` : ''}` : '';
      return `<div class="card persona ${on ? 'on' : ''}">
        <label class="ph"><span><input type="checkbox" data-change="who" data-arg="${esc(p.id)}" ${on ? 'checked' : ''}>${sw(p.color)}<b>${esc(p.name)}</b>
          ${lead && on && S.who.length > 1 ? ' <span class="chip">镜头跟随</span>' : ''}</span><span class="muted num">${shape(p.footprint)} · ${fmt(p.v_mps)} m/s</span></label>
        ${params}${btns}</div>`;
    }).join('');
    const tasks = HA.bsim.TASKS.map(t => {
      const rs = S.who.map(id => S.run('base', id, t)).filter(Boolean), can = rs.filter(r => r.applicable), na = rs.filter(r => !r.applicable);
      return `<label class="task ${can.length ? '' : 'na'}"><input type="checkbox" data-act="task" data-arg="${t}" ${!can.length ? 'disabled' : S.tasks.has(t) ? 'checked' : ''}>
        ${t} ${esc(S.taskName(t))}${na.length ? ` <em>${na.map(r => `${who(S, r.persona)}不适用：${esc(r.reason)}`).join('；')}</em>` : ''}</label>`;
    }).join('');
    const tpl = S.result.personas.filter(p => !p.custom).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    return `<h3>谁来住，做哪些事？</h3>
      <p class="muted">住户可以多选，人数不限，镜头跟随其中一位。改参数后仿真引擎会让这位住户把每项任务重走一遍。
        俯视图的地面颜色是所选住户里最宽的那位在各处还剩多少余量；勾上“风险点位”看磕碰和受阻集中在哪里。</p>
      ${cards}
      <div class="addp"><select id="tpl" aria-label="模板">${tpl}</select><button class="small" data-act="addPerson">按模板加一位住户</button></div>
      <h4>生活任务</h4><div class="tasks">${tasks}</div>
      ${legend()}${S.layers.risk ? riskBlock(S, S.variant) : ''}
      <button class="primary" data-act="confirm" ${S.tasks.size && S.who.length ? '' : 'disabled'}>开始试住</button>`;
  }

  function legend() {
    const L = ['< 0', '0–5 cm', '5–10 cm', '> 10 cm'];
    return `<div class="legend">余量：${L.map((l, i) => `<span><i class="band b${i}"></i>${l}</span>`).join('')}</div>`;
  }

  // 户型: what was recognised. Doors narrower than 0.80 m are highlighted for the user to check.
  function home(S) {
    const ir = S.ir, rooms = ir.rooms.map(r => `<li><span>${esc(T().room(r.type))}</span><span class="num">${(+r.area).toFixed(1)} m²</span></li>`).join('');
    const doors = ir.doors.map(d => `<li class="${d.clear_width < 0.8 ? 'warn' : ''}"><span>${esc(T().object(ir, d.id))}</span>
      <span class="num">净宽 ${T().m(d.clear_width)}</span></li>`).join('');
    return `<h3>${ir.kind === 'office' ? '这个场景' : '这套房'}识别对了吗？</h3><p class="muted">${ir.kind === 'office' ? '场景' : '户型'} ${esc(ir.name || ir.scene_id)}。核对房间和门，确认后选谁来住。</p>
      <h4>房间 ${ir.rooms.length}</h4><ul class="list">${rooms}</ul>
      <h4>门 ${ir.doors.length}</h4><ul class="list">${doors}</ul>
      <h4>家具 ${ir.objects.length} 件</h4><p class="muted">点 3D 视图里的物体看尺寸。</p>
      <button class="primary" data-act="go" data-arg="pick">确认户型</button> <button data-act="import">换一套户型</button>`;
  }

  const EV = { DOOR_PASS: '过门', CONTACT: '擦碰', ARRIVE: '到达', GIVE_UP: '受阻停下' };
  // 试住: every resident on the current task, then the camera resident's events.
  function stay(S, run, seg) {
    if (!run) return `<h3>住得怎么样？</h3><p class="muted">没有可回放的任务。</p>`;
    const p = S.personaObj(run.persona), two = S.sides.some(s => s.vi);
    const rows = seg && seg.runs.length > 1 ? `<table class="who-runs">${seg.runs.map((r, i) => {
      const s = S.sides[i]; if (!s) return '';
      const res = r && r.applicable ? `${icon(r)} ${r.success ? '完成' : esc(T().code(r.fail_code))}` : '<span class="muted">不适用</span>';
      return `<tr><td>${sw(s.color)}${who(S, s.persona)}${two ? (s.vi ? ' · 方案' : ' · 改造前') : ''}</td><td>${res}</td>
        <td class="num">${r && r.applicable ? `${r.time_s} s` : ''}</td></tr>`;
    }).join('')}</table>` : '';
    const ev = run.events.map(e => `<li data-act="seekLocal" data-arg="${e.t}"><span class="t">${e.t.toFixed(1)} s</span>
      ${EV[e.type] || esc(e.type)} ${e.object_id ? esc(T().object(S.ir, e.object_id)) : ''}${e.clear_width_m ? ` · 净宽 ${T().m(e.clear_width_m)}` : ''}${e.penetration_m ? ` · 压入 ${T().cm(e.penetration_m)}` : ''}</li>`).join('');
    const why = !run.success && run.fail_reason ? `<div><span>原因</span>${esc(run.fail_reason)}</div>` : '';
    return `<h3>${esc(seg ? `${seg.task} ${S.taskName(seg.task)}` : run.name)}</h3>${rows}
      <h4>${sw(p.color)}${esc(p.name)}</h4>
      <div class="kv">
        <div><span>结果</span>${run.applicable ? `${icon(run)} ${run.success ? '完成' : esc(T().code(run.fail_code))}` : `不适用：${esc(run.reason)}`}</div>${why}
        <div><span>最小余量</span><a data-act="look" data-arg="clear">${T().m(run.min_clearance_m)}</a></div>
        <div><span>最近的物体</span>${esc(T().object(S.ir, run.min_clearance_object))}</div>
        <div><span>耗时 / 路程</span>${run.time_s ?? '—'} s / ${run.path_m ?? '—'} m</div>
      </div>
      <h4>事件</h4><ul class="events">${ev || '<li class="muted">没有事件</li>'}</ul>
      <button data-act="go" data-arg="report">看体检报告</button>`;
  }
  function issues(S, variant) {
    const out = [];
    for (const r of S.allRuns(variant)) for (const v of r.violations) out.push({ r, v });
    return out.sort((a, b) => (a.v.severity === 'red' ? 0 : 1) - (b.v.severity === 'red' ? 0 : 1));
  }

  // Risk points (B's 磕碰热点): mode, area of hit cells, contacts per 100 m walked, the worst cells.
  const cellColour = (v, max) => HA.risk.PALETTE[Math.min(4, Math.round(Math.sqrt(v / Math.max(max, 1e-3)) * 4))];
  function riskBlock(S) {
    const L = S.riskLayer && S.riskLayer(); if (!L) return '';
    const modes = Object.entries(HA.risk.MODES).map(([k, v]) => `<option value="${k}" ${k === S.riskMode ? 'selected' : ''}>${esc(v)}</option>`).join('');
    const top = HA.risk.top(L, 6).map(x => {
      const objs = [...new Set(x.h.list.map(c => c.obstacle.name))].slice(0, 2).join('、') || '贴近障碍';
      return `<li data-act="look" data-arg="cell:${x.i}"><span>${sw(cellColour(x.v, L.max))}${esc(objs)}</span>
        <span class="num muted">${x.h.contact ? `磕碰 ${x.h.contact}` : ''}${x.h.obstruction ? ` 受阻 ${x.h.obstruction}` : ''}${x.h.near ? ` 贴近 ${x.h.near.toFixed(1)} s` : ''}</span></li>`;
    }).join('');
    return `<h4>风险点位</h4>
      <label class="muted">指标 <select data-change="riskMode" aria-label="风险指标">${modes}</select></label>
      <div class="kv"><div><span>问题栅格面积</span>${L.area.toFixed(2)} m²</div>
        <div><span>每百米磕碰</span>${L.per100 == null ? '—' : L.per100.toFixed(1)} 次（${L.contacts} 次 / ${L.dist.toFixed(0)} m）</div></div>
      <ul class="list riskcells">${top || '<li class="muted">所选住户和任务没有磕碰或受阻。</li>'}</ul>`;
  }
  // One clicked risk cell: who hit what there, during which task, and when.
  function riskCell(S, { h, x, y }) {
    if (!h) return '';
    const rows = h.list.slice(0, 8).map(c => `<li><span>${who(S, c.persona)} · ${c.task} ${esc(S.taskName(c.task))} · ${c.t.toFixed(1)} s</span>
      <span class="muted">${c.type === 'contact' ? '磕碰' : '受阻'} ${esc(c.obstacle.name)}：${esc(c.reason)}</span></li>`).join('');
    return `<div class="pickinfo"><b>风险点位 (${x.toFixed(1)}, ${y.toFixed(1)})</b>
      <div class="muted">磕碰 ${h.contact} · 受阻 ${h.obstruction} · 贴近障碍 ${h.near.toFixed(1)} s</div>
      <ul class="list">${rows || '<li class="muted">这里没有磕碰，只是贴着障碍走。</li>'}</ul></div>`;
  }

  function report(S) {
    const list = issues(S, S.variant), red = list.filter(x => x.v.severity === 'red').length;
    const items = list.map(({ r, v }, i) => {
      const t = T().violation(S.ir, v);
      return `<li class="issue ${v.severity}"><div class="ih"><b>${esc(t.title)}</b><span class="chip">${who(S, r.persona)} · ${esc(r.name)}</span></div>
        <div class="nums">${t.nums}</div><div class="muted">${esc(t.std)}</div>
        ${v.recommendation ? `<div class="muted">建议：${esc(v.recommendation)}</div>` : ''}
        <button class="small" data-act="look" data-arg="${i}">看现场</button></li>`;
    }).join('');
    const na = [...new Set(S.allRuns(S.variant).filter(r => !r.applicable).map(r => `${T().persona(r.persona, S)} ${r.task} ${r.name}：${r.reason}`))];
    const sr = S.result.search;
    return `<h3>哪里不行，为什么？</h3>
      <div class="score"><b>${S.score(S.variant)}</b><span>分</span><em class="red">红 ${red}</em><em class="yellow">黄 ${list.length - red}</em></div>
      <p class="muted">分数 = 60 × 走通的（住户, 任务）占比 + 40 × 通过的规范检查占比，全部住户、全部适用任务一起算。</p>
      ${S.layers.risk ? riskBlock(S) : '<p class="muted">勾上下方“风险点位”看磕碰和受阻热点。</p>'}
      <h4>问题 ${list.length}</h4>
      <ul class="issues">${items || '<li class="muted">没有问题。</li>'}</ul>
      ${na.length ? `<details><summary class="muted">不适用（不算失败）${na.length}</summary><p class="muted">${na.map(esc).join('；')}</p></details>` : ''}
      ${S.result.plans.length ? `<button class="primary" data-act="go" data-arg="fix">帮我改</button>`
        : sr.running ? `<p class="muted">改造方案搜索中：第 ${S.search.round || 1} 轮，已仿真 ${S.search.done}/${S.search.total || '…'} 种改法，
          前沿上 ${S.search.archive || 1} 个方案。完成后可以看怎么改。</p>` : ''}`;
  }
  // 改造 (PRD 5.10.6): the user's conditions, up to three recommended cards, the cost x score scatter, what was tried.
  function cons(S) {
    const c = S.cons;
    const locks = [...c.locks].map(id => `<button class="small" data-act="unlock" data-arg="${esc(id)}" title="解除锁定">${esc(T().object(S.ir, id))} ×</button>`).join('');
    return `<div class="cons">
      <label>预算 <input type="number" min="0" step="500" inputmode="numeric" placeholder="不限" value="${c.budget ?? ''}" data-change="budget" aria-label="预算（元）"> 元</label>
      <div class="seg" role="group" aria-label="房子"><button data-act="rent" data-arg="0" aria-pressed="${!c.rent}">自有</button><button data-act="rent" data-arg="1" aria-pressed="${c.rent}">租房</button></div>
      <label><input type="checkbox" data-change="noWall" ${c.noWall || c.rent ? 'checked' : ''} ${c.rent ? 'disabled title="租房不改门和墙"' : ''}>不动墙</label>
      <div class="locks"><span class="muted">锁定</span>${locks || '<span class="muted">没有。在 3D 里点物体可以锁定</span>'}</div></div>`;
  }

  function planCard(S, pl, labels) {
    const on = S.plan === pl.id, base = S.score('base'), out = HA.plans.why(pl, S.cons);
    const before = Object.fromEntries(S.allRuns('base').map(r => [r.persona + r.task, r]));
    const was = r => before[r.persona + r.task] || {};
    const fixed = pl.runs.filter(r => r.applicable && r.success && !was(r).success);
    const still = pl.runs.filter(r => r.applicable && !r.success);
    const list = rs => rs.map(r => `${who(S, r.persona)} ${esc(r.name)}`).join('、');
    const edits = pl.edits.map(e => `<li>${esc(T().edit(S.ir, e))}${e.cost_cny ? ` <span class="num muted">${T().cny(e.cost_cny)}</span>` : ''}</li>`).join('');
    return `<div class="card plan ${on ? 'on' : ''} ${out ? 'out' : ''}" data-act="plan" data-arg="${pl.id}">
      <div class="ph"><b>${(labels || []).map(l => `<span class="tag">${l}</span>`).join('')}方案 ${pl.id}</b><span class="score-mini num">${base} → <b>${pl.score}</b></span></div>
      <div class="pt">${esc(pl.title)}</div>
      <div class="cost"><b class="num">${T().cny(pl.cost_cny)}</b>${out ? ` <span class="red">${out}</span>` : ''}</div>
      ${on ? `<ol class="edits">${edits}</ol>
        ${fixed.length ? `<p class="ok">修好：${list(fixed)}</p>` : ''}
        ${still.length ? `<p class="red">仍未修好：${still.map(r => `${who(S, r.persona)} ${esc(r.name)}（${esc(T().code(r.fail_code))}）`).join('、')}</p>` : ''}
        <p class="muted">${pl.worse && pl.worse.length ? `<span class="red">有住户变差</span>` : '其他住户没有变差。'}</p>` : ''}</div>`;
  }

  function fix(S) {
    const all = S.result.plans, base = S.score('base'), ps = S.picks();
    const okN = all.filter(p => !HA.plans.why(p, S.cons)).length;
    const sel = S.plan && S.planObj(), extra = sel && !ps.some(x => x.plan === sel);
    const labels = Object.fromEntries(ps.map(x => [x.plan.id, x.labels.join('/')]));
    const tried = (S.result.search.tried || []).map(x => `<li>${x.target ? `<span class="chip">${who(S, x.target[0])} ${x.target[1]}</span>` : ''}
      ${esc(x.op ? T().edit(S.ir, x) : T().object(S.ir, x.object_id))} → <b class="${x.result === '采纳' ? 'ok' : ''}">${esc(x.result)}</b></li>`).join('');
    return `<h3>怎么改？</h3>
      <p class="muted">${all.length} 个候选来自多目标搜索：得分越高越好，花费（家具库标价加参考施工价）越低越好，施工程度（租户能做 / 要房东 / 动墙）越轻越好。
        每轮从前沿上最稀疏的方案出发再加一项改法，让全部住户重跑；只留下没有被别的方案在三项上同时压过的，有住户变差的不要。红色半透明是原来的位置。</p>
      ${cons(S)}
      <p class="muted">满足条件 ${okN} / ${all.length} 个。均衡是拿到最安全方案 ${Math.round(HA.plans.BALANCE * 100)}% 提分的最便宜方案。</p>
      ${ps.map(x => planCard(S, x.plan, x.labels)).join('') || '<p class="red">这些条件下没有能提分的方案。放宽预算或解除锁定再试。</p>'}
      ${extra ? `<h4>你点开的方案</h4>${planCard(S, sel)}` : ''}
      <h4>花费和得分</h4>${HA.plans.scatter(all, base, S.cons, S.plan, labels)}
      <p class="muted">实心点满足条件，空心点不满足；折线连起每档花费下得分最高的方案。点一个点看那个方案。</p>
      <details><summary>试过的改法（${(S.result.search.tried || []).length}）</summary><ul class="tried">${tried}</ul></details>
      <button class="primary" data-act="go" data-arg="compare" ${S.plan ? '' : 'disabled'}>看前后对比</button>`;
  }

  function compare(S) {
    const pl = S.planObj(), base = S.allRuns('base'), after = Object.fromEntries(pl.runs.map(r => [r.persona + r.task, r]));
    const rows = base.filter(r => r.applicable && after[r.persona + r.task]).map(r => {
      const a = after[r.persona + r.task];
      return `<tr class="${!r.success && a.success ? 'up' : r.success && !a.success ? 'down' : ''}"><td>${who(S, r.persona)}</td><td>${esc(r.name)}</td><td>${icon(r)}</td><td>${icon(a)}</td></tr>`;
    }).join('');
    const worse = base.filter(r => r.applicable && r.success && after[r.persona + r.task] && !after[r.persona + r.task].success);
    return `<h3>改完真的好了吗？</h3>
      <div class="score"><span>改造前</span><b>${S.score('base')}</b><span>→ 方案 ${pl.id}</span><b>${pl.score}</b></div>
      <table class="cmp"><tr><th>住户</th><th>任务</th><th>前</th><th>后</th></tr>${rows}</table>
      <p class="${worse.length ? 'red' : 'muted'}">${worse.length ? '变差：' + worse.map(r => `${who(S, r.persona)} ${esc(r.name)}`).join('、') : '没有住户变差。'}</p>
      <button class="primary" data-act="export">导出报告</button>`;
  }

  function object(S, id) {
    const o = S.ir.objects.find(o => o.id === id);
    const d = !o && S.ir.doors.find(d => d.id === id);
    if (!o && !d) return '';
    const rel = issues(S, S.variant).filter(x => x.v.object_id === id);
    const size = o ? (a => `${(a.max[0] - a.min[0]).toFixed(2)} × ${(a.max[1] - a.min[1]).toFixed(2)} × ${(a.max[2] - a.min[2]).toFixed(2)} m`)(o.aabb)
      : `净宽 ${T().m(d.clear_width)}`;
    return `<div class="pickinfo"><b>${esc(T().object(S.ir, id))}</b><div class="muted">${size}</div>
      ${rel.length ? `<div class="red">相关问题 ${rel.length} 条：${[...new Set(rel.map(x => T().code(x.v.code)))].join('、')}</div>` : '<div class="muted">没有相关问题</div>'}
      ${o && S.step === 'fix' ? (S.cons.locks.has(id) ? `<button class="small" data-act="unlock" data-arg="${esc(id)}">解除锁定</button>`
        : `<button class="small" data-act="lock" data-arg="${esc(id)}">锁定，方案里不许动它</button>`) : ''}</div>`;
  }

  HA.panels = { home, pick, stay, report, fix, compare, object, issues, riskCell, riskBlock, esc };
})();
