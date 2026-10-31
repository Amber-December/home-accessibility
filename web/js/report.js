/* Printable single-page report (PRD 5.10.9 / F7). Reads the same IR and result as the app; the chosen plan and the
   user's conditions come from the URL (?plan=&budget=&rent=1&nowall=1&locks=a,b). Sample data is labelled in place. */
(() => {
  'use strict';
  const HA = window.HA, T = HA.text, P = HA.plans;
  const q = new URLSearchParams(location.search);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const IR = q.get('ir') || '../tests/fixtures/H1/scene_ir.json', RESULT = q.get('result') || 'mock/H1/sim_result.json';
  const cons = {
    budget: q.has('budget') ? +q.get('budget') : null, rent: q.get('rent') === '1', noWall: q.get('nowall') === '1',
    locks: new Set((q.get('locks') || '').split(',').filter(Boolean)),
  };
  const SAMPLE = '<span class="sample">样例</span>';
  const status = r => (!r || !r.applicable ? '<span class="na">— 不适用</span>'
    : r.success ? '<span class="ok">✓ 完成</span>' : `<span class="fail">✕ ${esc(T.code(r.fail_code))}</span>`);
  const json = u => fetch(u).then(r => { if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); });

  async function main() {
    const [ir, res] = await Promise.all([json(IR), json(RESULT)]);
    const base = res.baseline.score, plans = res.plans || [], picks = P.picks(plans, base, cons);
    const pl = plans.find(p => p.id === q.get('plan')) || (picks.find(x => x.labels.includes('均衡')) || picks[0] || {}).plan;
    const picked = pl && picks.some(x => x.plan === pl), off = pl ? P.why(pl, cons) : '';
    const pname = id => esc((res.personas.find(p => p.id === id) || {}).name || id);
    const key = r => r.persona + r.task, runs = res.baseline.runs;
    const after = pl ? Object.fromEntries(pl.runs.map(r => [key(r), r])) : {};
    const viol = runs.flatMap(r => (r.violations || []).map(v => ({ r, v })))
      .sort((a, b) => (a.v.severity === 'red' ? 0 : 1) - (b.v.severity === 'red' ? 0 : 1));
    const red = viol.filter(x => x.v.severity === 'red');
    const fixed = pl ? runs.filter(r => r.applicable && !r.success && after[key(r)].success) : [];
    const still = (pl ? pl.runs : runs).filter(r => r.applicable && !r.success);
    const worse = pl ? runs.filter(r => r.applicable && r.success && !after[key(r)].success) : [];
    const cond = [cons.budget != null && `预算 ${T.cny(cons.budget)} 以内`, cons.rent && '租房，不改门和墙', !cons.rent && cons.noWall && '不动墙',
      cons.locks.size && `不动${[...cons.locks].map(id => T.object(ir, id)).join('、')}`].filter(Boolean).join('；') || '不限';
    const who = rs => rs.map(r => `${pname(r.persona)}「${esc(r.name)}」`).join('、');
    const tested = [...new Set(runs.map(r => r.persona))].map(pname).join('、');
    const out = [];

    if (res.mock) out.push(`<p class="mock"><b>样例数据</b>${esc(res.note)}</p>`);
    out.push(`<h1>住前体检报告</h1><p class="meta">户型 ${esc(ir.scene_id)} · ${ir.rooms.length} 个房间、${ir.doors.length} 扇门、${ir.objects.length} 件物体 · 试住：${tested} · 生成于 ${new Date().toLocaleString('zh-CN')}</p>`);

    out.push(`<section><h2>结论</h2><div class="big"><span>改造前</span><b>${base}</b>${pl ? `<span>→ 方案 ${pl.id}</span><b class="up">${pl.score}</b>` : ''}<span>分</span></div>
      <p>这套房子有 <b>${red.length}</b> 处过不去${viol.length > red.length ? `，另有 ${viol.length - red.length} 条提醒` : ''}。
      ${pl ? `${picked ? `按你的条件（${esc(cond)}），推荐` : `你选的是`}方案 ${pl.id}「${esc(pl.title)}」，花费 ${T.cny(pl.cost_cny)}${SAMPLE}${off ? `，<b class="fail">不满足你的条件：${esc(off)}</b>` : ''}。
      修好 ${fixed.length} 项${fixed.length ? `：${who(fixed)}` : ''}；${still.length ? `仍未修好 ${still.length} 项：${who(still)}` : '全部任务都能完成'}；${worse.length ? `<b class="fail">变差 ${worse.length} 项：${who(worse)}</b>` : '没有住户变差'}。`
        : `按你的条件（${esc(cond)}）没有能提分的方案。`}</p></section>`);

    out.push(`<section><h2>问题</h2><table><tr><th></th><th>住户 · 任务</th><th>问题</th><th>实测</th><th>要求</th><th>差</th><th>来源</th></tr>
      ${viol.map(({ r, v }, i) => `<tr class="${v.severity}"><td>${i + 1}</td><td>${pname(r.persona)} · ${esc(r.name)}</td>
        <td>${esc(T.object(ir, v.object_id))} · ${esc(T.code(v.code))}</td><td class="num">${T.m(v.measured)}</td><td class="num">${T.m(v.required)}</td>
        <td class="num">${v.required > v.measured ? T.cm(v.required - v.measured) : '—'}</td><td>${esc(T.source(v.source))}</td></tr>`).join('') || '<tr><td colspan="7">没有问题。</td></tr>'}</table></section>`);

    if (pl) {
      const labels = Object.fromEntries(picks.map(x => [x.plan.id, x.labels.join('/')]));
      out.push(`<section><h2>方案 ${pl.id} · ${esc(pl.title)}</h2>
        <ol>${pl.edits.map(e => `<li>${esc(T.edit(ir, e))}${e.cost_cny ? ` <span class="num">${T.cny(e.cost_cny)}</span>${SAMPLE}` : '（不花钱）'}</li>`).join('')}</ol>
        <p>合计 <b class="num">${T.cny(pl.cost_cny)}</b>${SAMPLE}。条件：${esc(cond)}。${pl.rent_ok ? '租房也能做。' : ''}${pl.wall ? '要动墙。' : ''}</p>
        <div class="two"><div>${P.scatter(plans, base, cons, pl.id, labels)}</div>
        <p class="muted">共 ${plans.length} 个候选，每个都重跑了全部住户。实心点满足条件，空心点不满足；折线连起每档花费下得分最高的方案。
        推荐：${picks.map(x => `${x.labels.join('/')} 方案 ${x.plan.id}（${T.cny(x.plan.cost_cny)}，${x.plan.score} 分）`).join('；') || '无'}。</p></div></section>`);

      out.push(`<section><h2>前后对比</h2><table><tr><th>住户</th><th>任务</th><th>改造前</th><th>改造后</th></tr>
        ${runs.map(r => { const a = after[key(r)], cls = r.applicable && !r.success && a.success ? 'up' : r.applicable && r.success && !a.success ? 'down' : '';
          return `<tr class="${cls}"><td>${pname(r.persona)}</td><td>${r.task} ${esc(r.name)}</td><td>${status(r)}</td><td>${status(a)}</td></tr>`; }).join('')}</table></section>`);

      const items = {};
      pl.edits.filter(e => e.product).forEach(e => {
        const it = items[e.product.name] = items[e.product.name] || { ...e.product, n: 0 }; it.n++;
      });
      const rows = Object.values(items);
      out.push(`<section><h2>商品清单</h2>${rows.length ? `<table><tr><th>商品</th><th>数量</th><th>单价</th><th>小计</th><th>价格来源</th></tr>
        ${rows.map(it => `<tr><td>${esc(it.name)}</td><td class="num">${it.n}</td><td class="num">${T.cny(it.price_cny)}</td><td class="num">${T.cny(it.price_cny * it.n)}</td><td>${esc(it.price_src)}</td></tr>`).join('')}
        <tr class="sum"><td colspan="3">合计</td><td class="num">${T.cny(rows.reduce((s, it) => s + it.price_cny * it.n, 0))}</td><td></td></tr></table>` : '<p>这个方案不用买东西。</p>'}
        ${pl.edits.some(e => !e.cost_cny) ? `<p class="muted">不花钱的改动：${pl.edits.filter(e => !e.cost_cny).map(e => esc(T.edit(ir, e))).join('、')}。</p>` : ''}</section>`);
    }

    const stds = [...new Map(viol.map(({ v }) => [v.standard, v])).values()].filter(v => v.standard);
    out.push(`<section><h2>规范依据</h2><ul>${stds.map(v => `<li>${esc(v.standard)}（${esc(T.code(v.code))}，来源 ${esc(T.source(v.source))}）</li>`).join('') || '<li>无</li>'}</ul></section>`);

    out.push(`<section><h2>假设和样例说明</h2><ul>
      ${res.mock ? `<li>${esc(res.note)}</li>` : ''}
      <li>价格来自样例价格表，标了「样例」的数字不是报价。</li>
      <li>住户用平面判定外形代表：${res.personas.map(p => `${esc(p.name)} ${p.footprint.shape === 'rect' ? `${p.footprint.size[0]} × ${p.footprint.size[1]} m` : `直径 ${2 * p.footprint.r} m`}`).join('；')}。</li>
      <li>总分 = 适用任务完成率 × 100，每个红色问题扣 5 分、黄色扣 2 分，限制在 0–100。不适用的任务不算失败。</li>
      <li>推荐规则：省钱是最便宜的提分方案，最安全是得分最高的方案，均衡是拿到最安全方案 ${Math.round(P.BALANCE * 100)}% 提分的最便宜方案；有住户变差的方案不推荐。</li></ul></section>`);

    document.getElementById('report').innerHTML = out.join('');
    window.HA_READY = true;
  }

  main().catch(err => { document.getElementById('report').innerHTML = `<p class="fail">报告生成失败：${esc(err.message)}</p>`; console.error(err); });
})();
