/* 实验室 (PRD 5.9, 5.10.8): the same personas and tasks over many homes. Reads lab/index.json, which holds each
   home's outcome per persona/task for the baseline and every plan, so changing settings never refetches results. */
(() => {
  'use strict';
  const T = HA.text, $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const q = new URLSearchParams(location.search);
  const LEGEND = [['ok', '通过'], ['fix', '没过，能改好'], ['fail', '没过，改不好'], ['na', '不适用'], ['wait', '待运行']];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let D, done = 0, timer = null;

  const cond = () => ({ budget: $('#budget').value === '' ? null : +$('#budget').value, rent: $('#rent').checked, noWall: $('#nowall').checked });
  const checked = id => new Set([...document.querySelectorAll(`#${id} input:checked`)].map(i => i.value));
  const sel = () => ({ p: D.personas.filter(p => checked('personas').has(p.id)), t: Object.keys(D.tasks).filter(t => checked('tasks').has(t)) });
  const keys = s => s.p.flatMap(p => s.t.map(t => `${p.id}/${t}`));
  const allowed = (pl, c) => !pl.worse && (c.budget == null || pl.cost_cny <= c.budget) && !(c.rent && !pl.rent_ok) && !(c.noWall && pl.wall);
  const roomName = r => T.room(r.replace(/\d+$/, ''));

  // Status per persona/task, the runs that count, and the cheapest allowed plan that makes all of them pass.
  function judge(h, ks, c) {
    const live = ks.filter(k => h.runs[k] && h.runs[k] !== 'na'), fails = live.filter(k => h.runs[k] !== 'ok');
    const ok = h.plans.filter(p => allowed(p, c));
    const st = {};
    ks.forEach(k => {
      const v = h.runs[k];
      st[k] = !v || v === 'na' ? 'na' : v === 'ok' ? 'ok' : ok.some(p => p.runs[k] === 'ok') ? 'fix' : 'fail';
    });
    const fix = fails.length ? ok.filter(p => live.every(k => p.runs[k] === 'ok'))
      .sort((a, b) => a.cost_cny - b.cost_cny || b.score - a.score)[0] || null : null;
    return { live, fails, st, fix };
  }

  function link(h, s, j) {
    const p = (s.p.find(p => j.fails.some(k => k.startsWith(p.id + '/'))) || s.p[0] || D.personas[0]).id;
    const u = new URLSearchParams({ ir: h.ir, result: h.result, step: 'report', persona: p });
    return `index.html?${u}`;
  }

  function card(h, s, j, shown) {
    const cells = s.p.map(p => `<span>${esc(T.persona(p.id))}</span>` + s.t.map(t => {
      const k = `${p.id}/${t}`, v = shown ? j.st[k] : 'wait';
      return `<i class="pat-${v}" title="${esc(`${p.name} · ${t} ${D.tasks[t]} · ${LEGEND.find(l => l[0] === v)[1]}`)}"></i>`;
    }).join('')).join('');
    return `<a class="home" href="${esc(link(h, s, j))}" aria-label="${esc(`${h.id}，${h.area_m2} 平方米，在试住里打开`)}">` +
      `<img src="${esc(h.preview)}" alt="" loading="lazy" width="150" height="150">` +
      `<span class="t"><b>${esc(h.hero || h.id.replace('scene', '#'))}</b><span class="num">${h.area_m2} m²</span>` +
      `<span class="score${shown && j.fails.length ? ' bad' : ''}">${shown ? h.score : '—'}</span></span>` +
      `<span class="cells" style="--n:${s.t.length}"><span></span>${s.t.map(t => `<span>${t}</span>`).join('')}${cells}</span></a>`;
  }

  function renderGrid() {
    const s = sel(), ks = keys(s), c = cond();
    $('#grid').innerHTML = D.homes.map((h, i) => card(h, s, judge(h, ks, c), i < done)).join('');
    $('#progress').textContent = `${done} / ${D.homes.length}`;
    if (done === D.homes.length) renderResults(s, ks, c);
  }

  function run() {
    clearInterval(timer); done = 0; $('#results').hidden = true;
    if (!sel().p.length || !sel().t.length) { $('#run-info').textContent = '至少选一位住户和一个任务'; renderGrid(); return; }
    $('#run-info').textContent = '';
    if (reduced) { done = D.homes.length; renderGrid(); return; }
    renderGrid();
    timer = setInterval(() => { done++; renderGrid(); if (done >= D.homes.length) clearInterval(timer); }, 140);
  }

  const bars = (rows, cls, max = Math.max(1, ...rows.map(r => r[1]))) => {
    return rows.map(([name, n, text]) => `<li><span>${esc(name)}</span><span class="bar ${cls}" style="width:${(n / max) * 100}%"></span>` +
      `<span class="n num">${text ?? n}</span></li>`).join('') || '<li class="muted">无</li>';
  };

  function renderResults(s, ks, c) {
    const J = D.homes.map(h => ({ h, j: judge(h, ks, c) }));
    const live = J.reduce((n, x) => n + x.j.live.length, 0), pass = J.reduce((n, x) => n + x.j.live.length - x.j.fails.length, 0);
    const clean = J.filter(x => !x.j.fails.length), fixed = J.filter(x => x.j.fix), stuck = J.filter(x => x.j.fails.length && !x.j.fix);
    const avg = fixed.length ? fixed.reduce((n, x) => n + x.j.fix.cost_cny, 0) / fixed.length : null;
    $('#stats').innerHTML = [
      [`${pass} / ${live}`, '次试住通过'],
      [`${clean.length} / ${J.length}`, '套户型全部通过'],
      [avg == null ? '—' : T.cny(avg), `让全部住户都通过，平均要花（${fixed.length} 套需要改）`],
      [`${stuck.length}`, '套在当前条件下无法全部通过，见下方排行'],
    ].map(([b, t]) => `<div class="stat"><b class="num">${esc(b)}</b><span>${esc(t)}</span></div>`).join('');

    const codes = {};
    J.forEach(x => x.j.fails.forEach(k => { const code = x.h.runs[k]; codes[code] = (codes[code] || 0) + 1; }));
    $('#reasons').innerHTML = bars(Object.entries(codes).sort((a, b) => b[1] - a[1]).map(([k, n]) => [T.code(k), n]), 'pat-fail');
    $('#bypersona').innerHTML = bars(s.p.map(p => {
      let n = 0, ok = 0;
      J.forEach(x => x.j.live.filter(k => k.startsWith(p.id + '/')).forEach(k => { n++; ok += x.h.runs[k] === 'ok'; }));
      return [T.persona(p.id), n ? ok / n : 0, n ? `${Math.round((ok / n) * 100)}%` : '—'];
    }), 'pat-ok', 1);
    $('#worst').innerHTML = [...J].filter(x => x.j.fails.length)
      .sort((a, b) => b.j.fails.length - a.j.fails.length || a.h.score - b.h.score).slice(0, 5)
      .map(x => `<li><a href="${esc(link(x.h, s, x.j))}">${esc(x.h.hero || x.h.id)}</a> · ${x.j.fails.length} 处过不去 · <span class="num">${x.h.score}</span> 分</li>`)
      .join('') || '<li class="muted">全部通过</li>';

    const rows = [...J].sort((a, b) => b.h.score - a.h.score);
    $('#rank').innerHTML = '<thead><tr><th>户型</th><th class="num">面积</th><th>房间</th><th class="num">总分</th><th class="num">通过</th><th>最省的全部通过方案</th><th class="num">花费</th></tr></thead><tbody>' +
      rows.map(({ h, j }) => `<tr${h.hero ? ` class="hero"` : ''}><td${h.hero ? ` data-hero="${h.hero}"` : ''}><a href="${esc(link(h, s, j))}">${h.id}</a></td>` +
        `<td class="num">${h.area_m2} m²</td><td>${esc([...new Set(h.rooms.map(roomName))].join('、'))}</td><td class="num">${h.score}</td>` +
        `<td class="num">${j.live.length - j.fails.length} / ${j.live.length}</td>` +
        `<td>${!j.fails.length ? '<span class="muted">不用改</span>' : j.fix ? `${j.fix.id} · ${esc(j.fix.title)}` : '<span class="muted">当前条件下没有</span>'}</td>` +
        `<td class="num">${j.fix ? T.cny(j.fix.cost_cny) : '—'}</td></tr>`).join('') + '</tbody>';

    const na = {};
    J.forEach(({ h }) => ks.forEach(k => {
      if (h.runs[k] !== 'na') return;
      const key = `${T.persona(k.split('/')[0])} · ${k.split('/')[1]} ${D.tasks[k.split('/')[1]]}：${h.na_reason[k] || '不适用'}`;
      (na[key] = na[key] || []).push(h.hero || h.id);
    }));
    $('#na').innerHTML = Object.entries(na).map(([k, ids]) => `<li>${esc(k)}（${ids.length} 套：${esc(ids.join('、'))}）</li>`).join('') ||
      '<li class="muted">无</li>';
    $('#results').hidden = false;
  }

  async function boot() {
    D = await (await fetch('lab/index.json')).json();
    const area = D.homes.map(h => h.area_m2);
    $('#src-name').textContent = `WSR 户型库（${D.homes.length} 套）`;
    $('#src-info').textContent = `${D.source}。面积 ${Math.min(...area)}–${Math.max(...area)} m²，全部导入成功。`;
    $('#personas').innerHTML = D.personas.map(p => `<label><input type="checkbox" value="${esc(p.id)}" checked> ${esc(p.name)}</label>`).join('');
    $('#tasks').innerHTML = Object.entries(D.tasks).map(([t, n]) => `<label><input type="checkbox" value="${t}" checked> ${t} ${esc(n)}</label>`).join('');
    $('#legend').innerHTML = LEGEND.map(([k, n]) => `<span><i class="sw pat-${k}"></i>${n}</span>`).join('');
    document.querySelectorAll('.side input').forEach(el => el.addEventListener('change', () => { if (done) renderGrid(); }));
    $('#budget').addEventListener('input', () => { if (done) renderGrid(); });
    $('#run').addEventListener('click', run);
    if (q.get('run')) { done = D.homes.length; } renderGrid();
    window.HA_READY = true;
  }
  boot().catch(err => { $('#grid').textContent = '加载失败：' + err.message; console.error(err); });
})();
