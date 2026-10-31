/* Actions, recording presets (plan section 9 shots) and boot. */
(() => {
  'use strict';
  const HA = window.HA, S = HA.app, T = HA.text;
  const $ = s => document.querySelector(s);

  // ?preset=shotN fixes resident, step, view and start time. Mock data keeps the watermark visible.
  const PRESETS = {
    shot1: { step: 'stay', persona: 'wheelchair', tasks: ['T2'], view: 'follow', at: 'fail' },
    shot4: { step: 'pick', persona: 'wheelchair' },
    shot5: { step: 'stay', persona: 'wheelchair', tasks: ['T1', 'T2'], view: 'fp', autoplay: true },
    shot6: { step: 'report', persona: 'wheelchair' },
    shot7: { step: 'fix', persona: 'wheelchair' },
    shot8: { step: 'compare', persona: 'wheelchair', autoplay: true },
  };

  function selectPersona(id, tasks) {
    S.persona = id;
    const runs = S.runs('base', id).filter(r => r.applicable);
    S.tasks = new Set(tasks || runs.map(r => r.task));
  }

  function lookAt(item) {
    const { r, v } = item;
    if (S.persona !== r.persona) selectPersona(r.persona);
    S.tasks.add(r.task);
    S.setupPlayback([S.variant === 'base' ? 'base' : S.variant]);
    let k = 0; while (S.tl.seg(k) && S.tl.seg(k).task !== r.task) k++;
    const seg = S.tl.seg(k), [lx, ly] = v.location;
    let best = 0, bd = Infinity;
    r.traj.forEach(q => { const d = Math.hypot(q[1] - lx, q[2] - ly); if (d < bd) { bd = d; best = q[0]; } });
    S.seek(seg.t0 + best);
    S.v.clearMarks(); S.v.mark(v.object_id, 'red'); S.v.keepRed = new Set([v.object_id]);
    S.v.flyTo(lx, ly, 7);
    S.v.tag(T.violation(S.ir, v).nums, lx, ly);
    S.renderPanel();
    const list = document.querySelectorAll('.issue'), i = HA.panels.issues(S, S.variant).indexOf(item);
    list.forEach((el, j) => el.classList.toggle('on', j === i));
  }

  S.act = (name, arg, el) => {
    if (name === 'go') return S.enter(arg);
    if (name === 'confirm') {
      const p = S.personaObj(), on = S.runs('base').filter(r => S.tasks.has(r.task));
      S.chat.say('user', `我是${HA.panels.esc(p.name)}，想试试${on.map(r => HA.panels.esc(r.name)).join('、')}。`);
      return S.intentCard();
    }
    if (name === 'persona') {
      if (S.step !== 'pick' || arg === S.persona) return;
      selectPersona(arg); S.refreshHeat(); S.renderPanel(); return;
    }
    if (name === 'task') {
      if (el.checked) S.tasks.add(arg); else if (S.tasks.size > 1) S.tasks.delete(arg); else el.checked = true;
      S.renderPanel(); return;
    }
    if (name === 'view') return S.v.split ? null : S.setView(arg);
    if (name === 'style') return S.setStyle(arg);
    if (name === 'fold') return S.fold(arg);
    if (name === 'layer') {
      S.layers[arg] = el.checked;
      if (arg === 'heat') S.refreshHeat(); else if (arg === 'sweep') S.v.built.sweeps.visible = el.checked; else S.update();
      return;
    }
    if (name === 'seekLocal') { const at = S.tl.at(S.t); S.seek(at.seg.t0 + +arg); return; }
    if (name === 'look') {
      if (arg === 'clear') { const at = S.tl.at(S.t); S.v.mark(at.seg.runs[0].min_clearance_object, 'blue'); return; }
      const items = HA.panels.issues(S, S.variant);
      if (S.step !== 'report') S.enter('report');
      if (items[+arg]) lookAt(items[+arg]);
      return;
    }
    if (name === 'plan') { S.plan = arg; return S.enter('fix'); }
    if (name === 'resume' || name === 'next') {
      S.hideProblem(); S.v.keepRed = null;
      if (name === 'next') { const at = S.tl.at(S.t); S.t = at.seg.t0 + at.seg.dur; }
      if (S.t >= S.tl.total() - 1e-3) { S.update(); S.onEnd(); } else S.play();
    }
  };

  S.setStyle = name => {
    S.v.setStyle(name);
    document.querySelectorAll('#styles button').forEach(b => {
      const on = b.dataset.arg === name; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    });
  };

  // Folding a panel slides it out (CSS) and recentres the 3D view on the remaining free area.
  const PANEL = { left: '#chat', right: '#detail' };
  S.syncInsets = () => {
    if (!S.v) return;
    const b = document.body.classList, edge = side => (b.contains('fold-' + side) ? 0 : $(PANEL[side]).offsetWidth + 12);
    S.v.setInsets(edge('left'), edge('right'));
  };
  S.fold = side => {
    const folded = document.body.classList.toggle('fold-' + side), btn = $(`.fold.${side}`);
    btn.setAttribute('aria-expanded', !folded);
    btn.setAttribute('aria-label', `${folded ? '展开' : '收起'}${side === 'left' ? '对话' : '详情'}面板`);
    btn.textContent = (side === 'left') === folded ? '›' : '‹';
    S.syncInsets();
  };
  window.addEventListener('resize', () => S.syncInsets());

  // Absolute times of every event on the current timeline, for ←/→ stepping.
  function eventTimes() {
    const out = [];
    for (let k = 0, seg; (seg = S.tl.seg(k)); k++) {
      out.push(seg.t0);
      const run = seg.runs[0];
      if (run && run.applicable) run.events.forEach(e => out.push(seg.t0 + e.t));
    }
    return out.sort((a, b) => a - b);
  }

  document.addEventListener('click', e => {
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
    if (e.code === 'Escape' && !$('#problem').hidden) { S.hideProblem(); return; }
    if (e.code === 'Enter' && e.target === document.body) {
      const b = $('#problem:not([hidden]) button.primary') || $('#panel button.primary:not(:disabled)');
      if (b) { e.preventDefault(); b.click(); }
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) S.pause(); });

  async function boot() {
    try {
      const { ir, occ, result } = await HA.api.loadAll();
      Object.assign(S, { ir, occ, result });
      const badges = [];
      if (result.mock) badges.push(`<span class="badge mock" title="${HA.panels.esc(result.note)}">样例数据，非仿真结果</span>`);
      if (result.baseline.runs.some(r => (r.monologue || []).some(m => m.source === 'template'))) badges.push('<span class="badge">规则模式</span>');
      $('#badges').innerHTML = badges.join('');
      S.v = HA.viewer.create($('#view'), ir, occ);
      S.v.onView = S.onView; S.onView(S.v.view);
      S.setStyle(HA.config.style); S.syncInsets();
      S.v.onFrame.push(dt => S.tick(dt));
      S.v.onPick = (ud, p) => {
        S.v.marks.forEach((k, id) => { if (k === 'blue') S.v.mark(id, null); });
        if (!ud) { $('#pick').innerHTML = ''; return; }
        if (S.v.marks.get(ud.id) !== 'red') S.v.mark(ud.id, 'blue');
        $('#pick').innerHTML = HA.panels.object(S, ud.id);
      };
      S.tl = HA.timeline.create($('#timeline'), { onSeek: t => { S.pause(); S.seek(t); }, onPlay: on => (on ? S.play() : S.pause()) });
      if (HA.config.glb) S.v.loadGLB(HA.config.glb).catch(err => console.warn('GLB', err));
      const pr = PRESETS[HA.config.preset];
      S.preset = pr || null;
      selectPersona(pr ? pr.persona : result.personas[0].id, pr && pr.tasks);
      $('#loading').remove();
      S.chat.say('agent', `已载入户型 ${HA.panels.esc(ir.scene_id)}：${ir.rooms.length} 个房间、${ir.doors.length} 扇门、${ir.objects.length} 件物体。先核对户型，再选谁来住。`);
      if (pr) {
        S.enter(pr.step);
        if (pr.at === 'fail') {
          const seg = S.tl.seg(0), run = seg.runs[0];
          S.seek(seg.t0 + run.duration - 1e-3); S.stopped = run; S.showProblem(run);
        }
      } else {
        S.enter('home');
      }
      window.HA_READY = true;
    } catch (err) {
      const l = $('#loading'); if (l) l.lastElementChild.textContent = '加载失败：' + err.message;
      console.error(err);
    }
  }

  S.chat = HA.chat.create($('#chat'));
  boot();
})();
