/* Plan choice under the user's conditions (PRD 5.10.6): filter by budget, rental, wall work and locked objects,
   then pick 省钱 / 均衡 / 最安全 from the cost-score front. Also draws the cost x score scatter (app and report). */
(() => {
  'use strict';
  const HA = window.HA = window.HA || {};
  const BALANCE = 0.8;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const fresh = () => ({ budget: null, rent: false, noWall: false, locks: new Set() });

  // Why a plan is ruled out under conditions c; '' when it is allowed.
  function why(pl, c) {
    if (pl.worse && pl.worse.length) return '有住户变差';
    if (c.budget != null && pl.cost_cny > c.budget) return '超预算';
    if (c.rent && pl.edits.some(e => e.rent_ok === false)) return '租房不能这样改';
    if (c.noWall && pl.edits.some(e => e.wall)) return '要动墙';
    if (pl.edits.some(e => c.locks.has(e.object_id))) return '动了锁定的物体';
    return '';
  }

  // Cost-score front: sorted by cost, each point scores higher than every cheaper one.
  function front(plans) {
    const out = []; let best = -Infinity;
    [...plans].sort((a, b) => a.cost_cny - b.cost_cny || b.score - a.score)
      .forEach(p => { if (p.score > best) { out.push(p); best = p.score; } });
    return out;
  }

  // 省钱: cheapest plan that raises the score. 最安全: highest score, cheapest among ties.
  // 均衡: cheapest plan that gets at least 80% of the 最安全 gain. A plan holding several labels is one card.
  function picks(plans, base, c) {
    const f = front(plans.filter(p => !why(p, c) && p.score > base));
    if (!f.length) return [];
    const top = f[f.length - 1], gain = top.score - base, out = [];
    [['省钱', f[0]], ['均衡', f.find(p => p.score - base >= BALANCE * gain)], ['最安全', top]].forEach(([label, plan]) => {
      const hit = out.find(x => x.plan === plan);
      if (hit) hit.labels.push(label); else out.push({ labels: [label], plan });
    });
    return out;
  }

  // SVG scatter: every candidate, allowed ones filled, the allowed front joined by a line, baseline and budget dashed.
  function scatter(plans, base, c, sel, labels = {}) {
    const W = 300, H = 176, L = 36, R = 10, T = 12, B = 28;
    const yen = HA.text.cny, maxC = Math.max(1000, ...plans.map(p => p.cost_cny));
    const xMax = Math.ceil(maxC / 5000) * 5000, yMin = Math.floor(Math.min(base, ...plans.map(p => p.score)) / 10) * 10;
    const x = v => L + (v / xMax) * (W - L - R), y = v => T + (1 - (v - yMin) / (100 - yMin)) * (H - T - B);
    let s = '';
    for (let v = yMin; v <= 100; v += 10) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
    for (const v of [0, xMax / 2, xMax]) s += `<text class="ax" x="${x(v)}" y="${H - B + 14}" text-anchor="middle">${yen(v)}</text>`;
    s += `<text class="ax" x="${W - R}" y="${H - 2}" text-anchor="end">花费（样例价）</text><text class="ax" x="2" y="${T - 2}">分</text>`;
    s += `<line class="base" x1="${L}" x2="${W - R}" y1="${y(base)}" y2="${y(base)}"/><text class="ax" x="${W - R}" y="${y(base) - 4}" text-anchor="end">改造前 ${base}</text>`;
    if (c.budget != null && c.budget <= xMax) s += `<line class="budget" x1="${x(c.budget)}" x2="${x(c.budget)}" y1="${T}" y2="${H - B}"/><text class="ax red" x="${x(c.budget) + 3}" y="${T + 9}">预算</text>`;
    const ok = plans.filter(p => !why(p, c) && p.score > base), f = front(ok);
    if (f.length > 1) s += `<polyline class="front" points="${f.map(p => `${x(p.cost_cny)},${y(p.score)}`).join(' ')}"/>`;
    for (const p of [...plans].sort((a, b) => (a.id === sel) - (b.id === sel))) {
      const out = why(p, c), cls = `${out ? 'out' : 'ok'}${p.id === sel ? ' sel' : ''}`;
      s += `<circle class="${cls}" cx="${x(p.cost_cny)}" cy="${y(p.score)}" r="${p.id === sel ? 6 : 4}" data-act="plan" data-arg="${p.id}" tabindex="-1">` +
        `<title>方案 ${p.id} · ${esc(p.title)} · ${yen(p.cost_cny)} · ${p.score} 分${out ? ` · ${out}` : ''}</title></circle>`;
    }
    Object.entries(labels).forEach(([id, text]) => {
      const p = plans.find(q => q.id === id); if (p) s += `<text class="tag" x="${x(p.cost_cny) + 7}" y="${y(p.score) + 12}">${text}</text>`;
    });
    return `<svg class="scatter" viewBox="0 0 ${W} ${H}" role="img" aria-label="所有候选方案的花费和得分">${s}</svg>`;
  }

  HA.plans = { BALANCE, fresh, why, front, picks, scatter };
})();
