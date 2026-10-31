/* Actions, recording presets (plan section 9 shots) and boot. Results come from B's engine (bsim.js):
   every resident through every task on load, then the plan search in the background. */
(() => {
  'use strict';
  const HA = window.HA, S = HA.app, T = HA.text;
  const $ = s => document.querySelector(s);

  // ?preset=shotN fixes residents, step, view and start time.
  const PRESETS = {
    shot1: { step: 'stay', who: ['wheelchair'], tasks: ['T2'], view: 'follow', at: 'fail' },
    shot4: { step: 'pick', who: ['wheelchair', 'assisted', 'blind'] },
    shot5: { step: 'stay', who: ['wheelchair'], tasks: ['T1', 'T2'], view: 'fp', autoplay: true },
    shot6: { step: 'report', who: ['wheelchair', 'assisted'] },
    shot7: { step: 'fix', who: ['wheelchair'] },
    shot8: { step: 'compare', who: ['wheelchair'], autoplay: true },
    shot9: { step: 'stay', scene: 'fire', who: ['wheelchair', 'assisted', 'blind', 'pedestrian'], view: 'top', autoplay: true },
    shot10: { step: 'stay', scene: 'quake', who: ['wheelchair', 'assisted', 'blind', 'pedestrian'], view: 'top', autoplay: true },
    shot2: { step: 'home', who: ['wheelchair'], say: '我坐手动轮椅，想看看能不能自己上厕所，预算 5000 以内，衣柜不要动' },
  };

  // Residents on stage (any number; the first leads the camera) and the tasks to try.
  // Tasks default to the current scene's tasks that at least one of them can do.
  S.selectPersona = (ids, tasks) => {
    ids = [].concat(ids || []).filter(id => S.personaObj(id));
    if (!ids.length) ids = [S.result.personas[0].id];
    S.who = [...new Set(ids)]; S.persona = S.who[0];
    const can = new Set(S.allRuns('base').filter(r => S.who.includes(r.persona) && r.applicable).map(r => r.task));
    const want = tasks || (S.sceneTasks ? S.sceneTasks() : [...can]);
    S.tasks = new Set(want.filter(t => can.has(t)));
    if (!S.tasks.size) S.tasks = new Set([...can].slice(0, 1));
  };

  function lookAt(item) {
    const { r, v } = item;
    if (S.persona !== r.persona) S.selectPersona([r.persona, ...S.who.filter(id => id !== r.persona)], [...S.tasks]);
    S.tasks.add(r.task);
    S.setupPlayback([S.variant === 'base' ? 'base' : S.variant]);
    let k = 0; while (S.tl.seg(k) && S.tl.seg(k).task !== r.task) k++;
    const seg = S.tl.seg(k), [lx, ly] = v.location || (r.traj.length ? r.traj[r.traj.length - 1].slice(1, 3) : [0, 0]);
    let best = 0, bd = Infinity;
    r.traj.forEach(q => { const d = Math.hypot(q[1] - lx, q[2] - ly); if (d < bd) { bd = d; best = q[0]; } });
    if (seg) S.seek(seg.t0 + best);
    S.v.clearMarks(); if (v.object_id) { S.v.mark(v.object_id, 'red'); S.v.keepRed = new Set([v.object_id]); }
    S.v.flyTo(lx, ly, 7);
    S.v.tag(T.violation(S.ir, v).nums, lx, ly);
    S.renderPanel();
    const list = document.querySelectorAll('.issue'), i = HA.panels.issues(S, S.variant).indexOf(item);
    list.forEach((el, j) => el.classList.toggle('on', j === i));
  }

  S.act = (name, arg, el) => {
    if (S.flow[name]) return S.flow[name](arg, el);
    if (S.people && S.people[name]) return S.people[name](arg, el);
    if (S.scenes && S.scenes[name]) return S.scenes[name](arg, el);
    if (name === 'go') return S.enter(arg);
    if (name === 'confirm') {
      const ps = S.picked(), on = HA.bsim.TASKS.filter(t => S.tasks.has(t));
      S.chat.say('user', `${ps.map(p => HA.panels.esc(p.name)).join('、')}，想试试${on.map(t => HA.panels.esc(S.taskName(t))).join('、')}。`);
      S.sheet('chat');
      return S.intentCard();
    }
    if (name === 'task') {
      if (el.checked) S.tasks.add(arg); else if (S.tasks.size > 1) S.tasks.delete(arg); else el.checked = true;
      S.refreshRisk(); S.renderPanel(); return;
    }
    if (name === 'view') return S.v.split ? null : S.setView(arg);
    if (name === 'style') return S.setStyle(arg);
    if (name === 'fold') return S.fold(arg);
    if (name === 'sheet') return S.sheet(arg);
    if (name === 'layer') return S.setLayer(arg, el.checked);
    if (name === 'riskMode') { S.riskMode = arg; $('#risk-mode').textContent = HA.risk.MODES[arg]; S.refreshRisk(); S.renderPanel(); return; }
    if (name === 'seekLocal') { const at = S.tl.at(S.t); S.seek(at.seg.t0 + +arg); return; }
    if (name === 'look') {
      if (arg === 'clear') { const at = S.tl.at(S.t), r = at && at.seg.runs[0]; if (r) S.v.mark(r.min_clearance_object, 'blue'); return; }
      if (String(arg).startsWith('cell:')) return S.lookCell(+arg.slice(5));
      const items = HA.panels.issues(S, S.variant);
      if (S.step !== 'report') S.enter('report');
      if (items[+arg]) lookAt(items[+arg]);
      return;
    }
    if (name === 'resume' || name === 'next') {
      S.hideProblem(); S.v.keepRed = null;
      if (name === 'next') { const at = S.tl.at(S.t); S.t = at.seg.t0 + at.seg.dur; }
      if (S.t >= S.tl.total() - 1e-3) { S.update(); S.onEnd(); } else S.play();
    }
  };

  // Risk cell inspector: what hit there, who, doing what, and when (B's 磕碰热点 detail).
  S.riskLayer = () => S.riskMeshes && S.riskMeshes.length && HA.risk.layer(S.bgrid, S.selRuns(S.variant), riskKey(S.variant), S.riskMode);
  const riskKey = variant => `${S.picked().map(p => `${p.id}:${p.footprint.size.join('x')}`).join(',')}|${[...S.tasks].sort()}|${variant}|${S.riskMode}`;
  S.lookCell = i => {
    const L = S.riskLayer(); if (!L) return;
    const g = S.bgrid, c = i % g.cols, r = Math.floor(i / g.cols), x = g.minX + (c + .5) * g.cell, y = g.minZ + (r + .5) * g.cell;
    $('#pick').innerHTML = HA.panels.riskCell(S, { i, h: L.cells.get(i), x, y });
    S.v.flyTo(x, y, 6);
  };

  S.setStyle = name => {
    S.v.setStyle(name);
    document.querySelectorAll('#styles button').forEach(b => {
      const on = b.dataset.arg === name; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    });
  };

  // Folding a panel slides it out (CSS) and recentres the 3D view on the remaining free area.
  // On phones both panels share one bottom sheet below the view, so there is nothing to inset.
  const PANEL = { left: '#chat', right: '#detail' }, phone = matchMedia('(max-width: 760px)');
  S.syncInsets = () => {
    if (!S.v) return;
    const b = document.body.classList, edge = side => (phone.matches || b.contains('fold-' + side) ? 0 : $(PANEL[side]).offsetWidth + 12);
    S.v.setInsets(edge('left'), edge('right'));
  };
  S.sheet = tab => {
    document.body.classList.toggle('sheet-chat', tab === 'chat');
    document.querySelectorAll('#sheet-tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.arg === tab));
  };
  S.fold = side => {
    const folded = document.body.classList.toggle('fold-' + side), btn = $(`.fold.${side}`);
    btn.setAttribute('aria-expanded', !folded);
    btn.setAttribute('aria-label', `${folded ? '展开' : '收起'}${side === 'left' ? '对话' : '详情'}面板`);
    btn.textContent = (side === 'left') === folded ? '›' : '‹';
    S.syncInsets();
  };
  window.addEventListener('resize', () => S.syncInsets());
  // Absolute times of every event on the current timeline (all residents), for ←/→ stepping.
  function eventTimes() {
    const out = [];
    for (let k = 0, seg; (seg = S.tl.seg(k)); k++) {
      out.push(seg.t0);
      seg.runs.forEach(run => { if (run && run.applicable) run.events.forEach(e => out.push(seg.t0 + e.t)); });
    }
    return out.sort((a, b) => a - b);
  }

  document.addEventListener('click', e => {
    if (S.scenes && !e.target.closest('#scene')) S.scenes.close();
    const el = e.target.closest('[data-act]');
    if (el && !el.disabled) S.act(el.dataset.act, el.dataset.arg, el);
  });
  // Keyboard (PRD 5.10.3): 1-4 views, Space play, ←/→ events, Enter confirms the panel, Esc closes the problem card.
  // Walk mode captures arrows and Esc itself in viewer.js.
  document.addEventListener('keydown', e => {
    if (!S.v || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    const tl = S.tl && !$('#timeline').hidden;
    const view = { Digit1: 'top', Digit2: 'follow', Digit3: 'fp', Digit4: 'walk' }[e.code];
    if (view) { if (!S.v.split) S.setView(view); return; }
    if (e.code === 'Space' && tl) { e.preventDefault(); S.playing ? S.pause() : S.play(); return; }
    if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && tl) {
      e.preventDefault();
      const ts = eventTimes(), next = e.code === 'ArrowRight' ? ts.find(t => t > S.t + 1e-3) : ts.reverse().find(t => t < S.t - 1e-3);
      if (next != null) { S.pause(); S.seek(next); }
      return;
    }
    if (e.code === 'Escape' && S.scenes && S.scenes.isOpen()) { S.scenes.close(); $('#scene .menu-btn').focus(); return; }
    if (e.code === 'Escape' && !$('#problem').hidden) { S.hideProblem(); return; }
    if (e.code === 'Enter' && e.target === document.body) {
      const b = $('#problem:not([hidden]) button.primary') || $('#panel button.primary:not(:disabled)');
      if (b) { e.preventDefault(); b.click(); }
    }
  });
  // Form controls in the panels report through data-change (value, or checked for checkboxes).
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-change]');
    if (el) S.act(el.dataset.change, el.type === 'checkbox' ? el.checked : el.value, el);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) S.pause(); });

  const say = (...a) => S.chat.say(...a);
  const loading = text => { const l = $('#loading'); if (l) l.lastElementChild.textContent = text; };

  // Plan search runs in the background; the step bar shows its progress and 改造 unlocks when it finishes.
  S.search = { done: 0, total: 0, round: 0 };
  function onProgress(p) {
    if (p.total != null) Object.assign(S.search, { total: p.done + p.total, round: p.round, archive: p.archive });
    if (p.done != null) S.search.done = p.done;
    S.renderSteps();
  }
  function onPlans(res) {
    S.renderSteps();
    if (res.search.none) return;
    const n = res.plans.length, tried = res.search.tried.length;
    const costs = res.plans.map(p => p.cost_cny);
    say('agent', n ? `改造方案搜索完成：仿真引擎试了 ${tried} 种改法组合，每种都让全部住户重跑一遍。按得分、花费、施工程度三个目标比较，
      留下 ${n} 个互不占优的方案（没有别的方案同时更高分、更省钱、动得更少），花费 ${T.cny(Math.min(...costs))} 到 ${T.cny(Math.max(...costs))}，都没有住户变差。`
      : `改造方案搜索完成：试了 ${tried} 种改法组合，没有找到能提分的方案。`);
    if (['report', 'fix', 'compare'].includes(S.step)) S.renderPanel();
    if (S.afterPlans) { const f = S.afterPlans; S.afterPlans = null; f(); }
  }

  async function boot() {
    try {
      const { ir, occ, items } = await HA.api.loadAll();
      Object.assign(S, { ir, occ, items });
      // Room labels are drawn into canvas textures, so the web font must be loaded first.
      await document.fonts.load('600 56px "LF Sans"', '客厅').catch(() => {});
      S.v = HA.viewer.create($('#view'), ir, occ);
      S.v.onView = S.onView; S.onView(S.v.view);
      S.setStyle(HA.config.style); S.syncInsets();
      S.v.onFrame.push(dt => S.tick(dt));
      S.v.onPick = (ud, p) => {
        S.v.marks.forEach((k, id) => { if (k === 'blue') S.v.mark(id, null); });
        const L = S.layers.risk && p && S.riskLayer(), cell = L && HA.risk.cellAt(S.bgrid, L, p[0], p[1]);
        if (cell) { $('#pick').innerHTML = HA.panels.riskCell(S, cell); return; }
        if (!ud) { $('#pick').innerHTML = ''; return; }
        if (S.v.marks.get(ud.id) !== 'red') S.v.mark(ud.id, 'blue');
        $('#pick').innerHTML = HA.panels.object(S, ud.id);
      };
      S.tl = HA.timeline.create($('#timeline'), { onSeek: t => { S.pause(); S.seek(t); }, onPlay: on => (on ? S.play() : S.pause()) });
      if (HA.config.glb) {
        S.v.loadGLB(HA.config.glb)
          .then(() => { if (S.v.planArgs && !S.v.split) HA.resident.applyPlan(S.v, ...S.v.planArgs); })
          .catch(err => console.warn('GLB', err));
      }
      // Every object and door gets its display name, so the engine's events and plan titles read like the UI.
      const names = {};
      for (const o of ir.objects) names[o.id] = T.object(ir, o.id);
      for (const d of ir.doors) names[d.id] = T.object(ir, d.id);
      loading('仿真引擎正在让每位住户把每项生活任务走一遍…');
      S.result = await HA.bsim.buildResult(ir, occ, names, { items, onPlans, onProgress });
      S.bgrid = HA.bsim.meta().grid;
      S.renderScenes();
      const pr = PRESETS[HA.config.preset];
      S.preset = pr || null;
      S.scenes.set((pr && pr.scene) || HA.config.scene);
      const want = (HA.config.persona || '').split(',').filter(id => S.personaObj(id));
      S.selectPersona(pr ? pr.who : want.length ? want : [S.result.personas[0].id], pr && pr.tasks);
      $('#loading').remove();
      const runs = S.result.baseline.runs, ok = runs.filter(r => r.applicable && r.success).length, app = runs.filter(r => r.applicable).length;
      say('agent', `已载入${ir.kind === 'office' ? '场景' : '户型'} ${HA.panels.esc(ir.name || ir.scene_id)}：${ir.rooms.length} 个房间、${ir.doors.length} 扇门、${ir.objects.length} 件物体。
        仿真引擎已让 ${S.result.personas.length} 位住户把 ${HA.bsim.TASKS.length} 项生活任务各走一遍：${app} 项适用，${ok} 项走通，现状 ${S.score('base')} 分。
        ${ir.kind === 'office' ? '公共建筑只做体检，不出改造方案。先核对场景' : '改造方案在后台搜索。先核对户型'}，再选谁来住；也可以直接在下面说。`);
      S.examples(); S.chat.enable();
      const go = step => {
        if ((step === 'fix' || step === 'compare') && S.result.search.running) { S.afterPlans = () => go(step); S.enter('report'); return; }
        S.enter(step);
      };
      if (pr) {
        go(pr.step);
        if (pr.at === 'fail') {
          const seg = S.tl.seg(0), run = seg && seg.runs[0];
          if (run) { S.seek(seg.t0 + run.duration - 1e-3); S.stopped = run; S.showProblem(run); }
        }
        if (pr.say) S.onSay(pr.say);
      } else {
        S.result.ready.then(() => { if (S.result.plans.some(p => p.id === HA.config.plan)) S.plan = HA.config.plan; });
        go((ir.kind === 'office' ? ['pick', 'stay', 'report'] : ['pick', 'stay', 'report', 'fix', 'compare']).includes(HA.config.step) ? HA.config.step : 'home');
      }
      window.HA_READY = true;
    } catch (err) {
      loading('加载失败：' + err.message);
      console.error(err);
    }
  }

  S.chat = HA.chat.create($('#chat'), text => S.onSay(text));
  boot();
})();
