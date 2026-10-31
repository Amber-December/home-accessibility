/* Right column: one panel per step. Buttons carry data-act / data-arg; app.js handles them. */
(() => {
  'use strict';
  const HA = window.HA = window.HA || {};
  const T = () => HA.text;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const src = s => `<span class="src ${s === 'template' ? 'est' : ''}" title="来源">${T().source(s)}${s === 'template' ? ' · 估计' : ''}</span>`;
  const icon = run => { const s = HA.timeline.status(run); return `<b class="st ${s}">${HA.timeline.ICON[s]}</b>`; };
  const shape = f => f.shape === 'rect' ? `矩形 ${f.size[0].toFixed(2)} × ${f.size[1].toFixed(2)} m` : `圆盘 直径 ${(2 * f.r).toFixed(2)} m`;

  function pick(S) {
    const cards = S.result.personas.map(p => {
      const runs = S.runs('base', p.id), on = p.id === S.persona;
      const tasks = runs.map(r => `<label class="task ${r.applicable ? '' : 'na'}" title="${esc(r.reason || '')}">
        <input type="checkbox" data-act="task" data-arg="${r.task}" ${!r.applicable ? 'disabled' : S.tasks.has(r.task) ? 'checked' : ''} ${on ? '' : 'tabindex=-1'}>
        ${r.task} ${esc(r.name)}${r.applicable ? '' : ` <em>不适用：${esc(r.reason)}</em>`}</label>`).join('');
      return `<div class="card persona ${on ? 'on' : ''}" data-act="persona" data-arg="${p.id}">
        <div class="ph"><b>${esc(p.name)}</b><span class="muted">${shape(p.footprint)} · ${p.v_mps} m/s</span></div>
        ${on ? `<div class="tasks">${tasks}</div>` : ''}</div>`;
    }).join('');
    return `<h3>谁来住，做哪些事？</h3><p class="muted">选一位住户，勾选要试的生活任务。俯视图里的地面颜色是这位住户在各处还剩多少余量。</p>
      ${cards}${legend()}
      <button class="primary" data-act="confirm" ${S.tasks.size ? '' : 'disabled'}>开始试住</button>`;
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
    return `<h3>这套房识别对了吗？</h3><p class="muted">户型 ${esc(ir.scene_id)}。核对房间和门，确认后选谁来住。</p>
      <h4>房间 ${ir.rooms.length}</h4><ul class="list">${rooms}</ul>
      <h4>门 ${ir.doors.length}</h4><ul class="list">${doors}</ul>
      <h4>家具 ${ir.objects.length} 件</h4><p class="muted">点 3D 视图里的物体看尺寸。</p>
      <button class="primary" data-act="go" data-arg="pick">确认户型</button>`;
  }

  function stay(S, run) {
    if (!run) return `<h3>他住得怎么样？</h3><p class="muted">没有可回放的任务。</p>`;
    const p = S.personaObj();
    const ev = run.events.map(e => `<li data-act="seekLocal" data-arg="${e.t}"><span class="t">${e.t.toFixed(1)} s</span>
      ${{ DOOR_PASS: '过门', CONTACT: '擦碰', ARRIVE: '到达', GIVE_UP: '受阻停下' }[e.type] || e.type}
      ${e.object_id ? esc(T().object(S.ir, e.object_id)) : ''}${e.clear_width_m ? ` · 净宽 ${T().m(e.clear_width_m)}` : ''}${e.penetration_m ? ` · 压入 ${T().cm(e.penetration_m)}` : ''}</li>`).join('');
    return `<h3>${esc(p.name)} · ${esc(run.name)}</h3>
      <div class="kv">
        <div><span>结果</span>${icon(run)} ${run.success ? '完成' : esc(T().code(run.fail_code))}</div>
        <div><span>最小余量</span><a data-act="look" data-arg="clear">${T().m(run.min_clearance_m)}</a> ${src('wsr')}</div>
        <div><span>最近的物体</span>${esc(T().object(S.ir, run.min_clearance_object))}</div>
        <div><span>耗时 / 路程</span>${run.time_s} s / ${run.path_m} m</div>
      </div>
      <h4>事件</h4><ul class="events">${ev}</ul>
      <button data-act="go" data-arg="report">看体检报告</button>`;
  }

  function issues(S, variant) {
    const out = [];
    for (const r of S.allRuns(variant)) for (const v of r.violations) out.push({ r, v });
    return out.sort((a, b) => (a.v.severity === 'red' ? 0 : 1) - (b.v.severity === 'red' ? 0 : 1));
  }

  function report(S) {
    const list = issues(S, S.variant), red = list.filter(x => x.v.severity === 'red').length;
    const items = list.map(({ r, v }, i) => {
      const t = T().violation(S.ir, v);
      return `<li class="issue ${v.severity}"><div class="ih"><b>${esc(t.title)}</b><span class="chip">${T().persona(r.persona)} · ${esc(r.name)}</span></div>
        <div class="nums">${t.nums}</div><div class="muted">${esc(t.std)} ${src(t.source)}</div>
        <button class="small" data-act="look" data-arg="${i}">看现场</button></li>`;
    }).join('');
    const na = [...new Set(S.allRuns(S.variant).filter(r => !r.applicable).map(r => `${r.task} ${r.name}：${r.reason}`))];
    return `<h3>哪里不行，为什么？</h3>
      <div class="score"><b>${S.score(S.variant)}</b><span>分</span><em class="red">红 ${red}</em><em class="yellow">黄 ${list.length - red}</em></div>
      <ul class="issues">${items || '<li class="muted">没有问题。</li>'}</ul>
      ${na.length ? `<p class="muted">不适用（不算失败）：${na.map(esc).join('；')}</p>` : ''}
      ${S.result.plans.length ? `<button class="primary" data-act="go" data-arg="fix">帮我改</button>` : ''}`;
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
    const fixed = pl.runs.filter(r => r.applicable && r.success && !before[r.persona + r.task].success);
    const still = pl.runs.filter(r => r.applicable && !r.success);
    const who = rs => rs.map(r => `${T().persona(r.persona)} ${esc(r.name)}`).join('、');
    const edits = pl.edits.map(e => `<li>${esc(T().edit(S.ir, e))}${e.cost_cny ? ` <span class="num muted">${T().cny(e.cost_cny)}</span>` : ''}</li>`).join('');
    return `<div class="card plan ${on ? 'on' : ''} ${out ? 'out' : ''}" data-act="plan" data-arg="${pl.id}">
      <div class="ph"><b>${(labels || []).map(l => `<span class="tag">${l}</span>`).join('')}方案 ${pl.id}</b><span class="score-mini num">${base} → <b>${pl.score}</b></span></div>
      <div class="pt">${esc(pl.title)}</div>
      <div class="cost"><b class="num">${T().cny(pl.cost_cny)}</b> <span class="src est">样例价</span>${out ? ` <span class="red">${out}</span>` : ''}</div>
      ${on ? `<ol class="edits">${edits}</ol>
        ${fixed.length ? `<p class="ok">修好：${who(fixed)}</p>` : ''}
        ${still.length ? `<p class="red">仍未修好：${still.map(r => `${T().persona(r.persona)} ${esc(r.name)}（${esc(T().code(r.fail_code))}）`).join('、')}</p>` : ''}
        <p class="muted">${pl.worse && pl.worse.length ? `<span class="red">有住户变差</span>` : '其他住户没有变差。'}</p>` : ''}</div>`;
  }

  function fix(S) {
    const all = S.result.plans, base = S.score('base'), ps = S.picks();
    const okN = all.filter(p => !HA.plans.why(p, S.cons)).length;
    const sel = S.plan && S.planObj(), extra = sel && !ps.some(x => x.plan === sel);
    const labels = Object.fromEntries(ps.map(x => [x.plan.id, x.labels.join('/')]));
    const tried = (S.result.search.tried || []).map(x => `<li><span class="chip">${T().persona(x.target[0])} ${x.target[1]}</span>
      ${esc(x.op ? T().edit(S.ir, x) : T().object(S.ir, x.object_id))} → <b class="${x.result === '采纳' ? 'ok' : ''}">${esc(x.result)}</b></li>`).join('');
    return `<h3>怎么改？</h3>
      <p class="muted">从 ${all.length} 个候选里按你的条件挑。每个候选都重跑了全部住户，有住户变差的不要。红色半透明是原来的位置。</p>
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
    const rows = base.filter(r => r.applicable).map(r => {
      const a = after[r.persona + r.task];
      return `<tr class="${!r.success && a.success ? 'up' : r.success && !a.success ? 'down' : ''}"><td>${T().persona(r.persona)}</td><td>${esc(r.name)}</td><td>${icon(r)}</td><td>${icon(a)}</td></tr>`;
    }).join('');
    const worse = base.filter(r => r.applicable && r.success && !after[r.persona + r.task].success);
    return `<h3>改完真的好了吗？</h3>
      <div class="score"><span>改造前</span><b>${S.score('base')}</b><span>→ 方案 ${pl.id}</span><b>${pl.score}</b></div>
      <table class="cmp"><tr><th>住户</th><th>任务</th><th>前</th><th>后</th></tr>${rows}</table>
      <p class="${worse.length ? 'red' : 'muted'}">${worse.length ? '变差：' + worse.map(r => `${T().persona(r.persona)} ${esc(r.name)}`).join('、') : '没有住户变差。'}</p>
      <button class="primary" data-act="export">导出报告</button>`;
  }

  function object(S, id) {
    const o = S.ir.objects.find(o => o.id === id);
    const d = !o && S.ir.doors.find(d => d.id === id);
    if (!o && !d) return '';
    const rel = issues(S, S.variant).filter(x => x.v.object_id === id);
    const size = o ? (a => `${(a.max[0] - a.min[0]).toFixed(2)} × ${(a.max[1] - a.min[1]).toFixed(2)} × ${(a.max[2] - a.min[2]).toFixed(2)} m`)(o.aabb)
      : `净宽 ${T().m(d.clear_width)}`;
    return `<div class="pickinfo"><b>${esc(T().object(S.ir, id))}</b> ${src('wsr')}<div class="muted">${size}</div>
      ${rel.length ? `<div class="red">相关问题 ${rel.length} 条：${[...new Set(rel.map(x => T().code(x.v.code)))].join('、')}</div>` : '<div class="muted">没有相关问题</div>'}
      ${o && S.step === 'fix' ? (S.cons.locks.has(id) ? `<button class="small" data-act="unlock" data-arg="${esc(id)}">解除锁定</button>`
        : `<button class="small" data-act="lock" data-arg="${esc(id)}">锁定，方案里不许动它</button>`) : ''}</div>`;
  }

  HA.panels = { home, pick, stay, report, fix, compare, object, issues, esc };
})();
