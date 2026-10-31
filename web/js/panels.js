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
    return `<div class="legend">余量：${HA.text.SCALE.map(([, c], i) => `<span><i style="background:${c}"></i>${L[i]}</span>`).join('')}</div>`;
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

  function fix(S) {
    const cards = S.result.plans.map(pl => {
      const before = Object.fromEntries(S.allRuns('base').map(r => [r.persona + r.task, r]));
      const fixed = pl.runs.filter(r => r.applicable && r.success && !before[r.persona + r.task].success);
      const still = pl.runs.filter(r => r.applicable && !r.success);
      const tried = (pl.tried || []).map(x => `<li><span class="chip">${T().persona(x.target[0])} ${x.target[1]}</span>
        ${esc(x.op ? T().edit(S.ir, x) : T().object(S.ir, x.object_id))} → <b class="${x.result === '采纳' ? 'ok' : ''}">${esc(x.result)}</b></li>`).join('');
      return `<div class="card plan ${S.plan === pl.id ? 'on' : ''}" data-act="plan" data-arg="${pl.id}">
        <div class="ph"><b>方案 ${pl.id} · ${esc(pl.title)}</b><span class="score-mini">${S.score('base')} → <b>${pl.score}</b></span></div>
        <ol class="edits">${pl.edits.map(e => `<li>${esc(T().edit(S.ir, e))}</li>`).join('') || '<li class="muted">没有找到有效改法</li>'}</ol>
        ${fixed.length ? `<p>修好：${fixed.map(r => `${T().persona(r.persona)} ${esc(r.name)}`).join('、')}</p>` : ''}
        ${still.length ? `<p class="red">仍未修好：${still.map(r => `${T().persona(r.persona)} ${esc(r.name)}（${esc(T().code(r.fail_code))}）`).join('、')}</p>` : ''}
        <details><summary>试过的改法（${(pl.tried || []).length}）</summary><ul class="tried">${tried}</ul></details></div>`;
    }).join('');
    return `<h3>怎么改？</h3><p class="muted">红色半透明是原来的位置。每个方案都由仿真重跑验证，其他住户不能变差。</p>
      ${cards}<button class="primary" data-act="go" data-arg="compare">看前后对比</button>`;
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
      <button disabled title="现场段之后接入">导出报告</button>`;
  }

  function object(S, id) {
    const o = S.ir.objects.find(o => o.id === id);
    const d = !o && S.ir.doors.find(d => d.id === id);
    if (!o && !d) return '';
    const rel = issues(S, S.variant).filter(x => x.v.object_id === id);
    const size = o ? (a => `${(a.max[0] - a.min[0]).toFixed(2)} × ${(a.max[1] - a.min[1]).toFixed(2)} × ${(a.max[2] - a.min[2]).toFixed(2)} m`)(o.aabb)
      : `净宽 ${T().m(d.clear_width)}`;
    return `<div class="pickinfo"><b>${esc(T().object(S.ir, id))}</b> ${src('wsr')}<div class="muted">${size}</div>
      ${rel.length ? `<div class="red">相关问题 ${rel.length} 条：${[...new Set(rel.map(x => T().code(x.v.code)))].join('、')}</div>` : '<div class="muted">没有相关问题</div>'}</div>`;
  }

  HA.panels = { pick, stay, report, fix, compare, object, issues, esc };
})();
