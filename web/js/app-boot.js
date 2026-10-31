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
    shot2: { step: 'home', persona: 'wheelchair', say: '我坐手动轮椅，想看看能不能自己上厕所，预算 5000 以内，衣柜不要动' },
  };

  S.selectPersona = selectPersona;
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
    if (S.flow[name]) return S.flow[name](arg, el);
    if (name === 'go') return S.enter(arg);
    if (name === 'confirm') {
      const p = S.personaObj(), on = S.runs('base').filter(r => S.tasks.has(r.task));
      S.chat.say('user', `我是${HA.panels.esc(p.name)}，想试试${on.map(r => HA.panels.esc(r.name)).join('、')}。`);
      S.sheet('chat');
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
    if (name === 'sceneMenu') return sceneMenu($('#scene-list').hidden);
    if (name === 'scene') { S.scene = arg; sceneMenu(false); return S.renderScenes(); }
    if (name === 'fold') return S.fold(arg);
    if (name === 'sheet') return S.sheet(arg);
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
    if (name === 'resume' || name === 'next') {
      S.hideProblem(); S.v.keepRed = null;
      if (name === 'next') { const at = S.tl.at(S.t); S.t = at.seg.t0 + at.seg.dur; }
      if (S.t >= S.tl.total() - 1e-3) { S.update(); S.onEnd(); } else S.play();
    }
  };

  // Scenes are grouped; adding one is one entry here. Only ready scenes can be picked.
  const SCENES = [
    { group: '日常', items: [
      { id: 'day', name: '白天', note: 'T1–T4 日常动线', ready: true },
      { id: 'night', name: '夜间', note: 'T6 起夜照明' },
    ] },
    { group: '灾害', items: [
      { id: 'fire', name: '起火', note: 'T5 烟气疏散' },
      { id: 'quake', name: '地震', note: '倒塌与通道阻断' },
    ] },
  ];
  S.scene = 'day';
  const sceneMenu = open => {
    $('#scene-list').hidden = !open;
    $('#scene .menu-btn').setAttribute('aria-expanded', open);
  };
  S.renderScenes = () => {
    const esc = HA.panels.esc;
    $('#scene-list').innerHTML = SCENES.map(g => `<h5>${esc(g.group)}</h5>` + g.items.map(it =>
      `<button role="menuitemradio" aria-checked="${it.id === S.scene}" data-act="scene" data-arg="${it.id}"${it.ready ? '' : ' disabled title="后续开放"'}>` +
      `${esc(it.name)}<span>${esc(it.ready ? it.note : `${it.note} · 后续开放`)}</span></button>`).join('')).join('');
    $('#scene-name').textContent = SCENES.flatMap(g => g.items).find(it => it.id === S.scene).name;
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
    if (!$('#scene-list').hidden && !e.target.closest('#scene')) sceneMenu(false);
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
    if (e.code === 'Escape' && !$('#scene-list').hidden) { sceneMenu(false); $('#scene .menu-btn').focus(); return; }
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

  async function boot() {
    try {
      const { ir, occ, result } = await HA.api.loadAll();
      Object.assign(S, { ir, occ, result });
      // Room labels are drawn into canvas textures, so the web font must be loaded first.
      await document.fonts.load('600 56px "LF Sans"', '客厅').catch(() => {});
      S.v = HA.viewer.create($('#view'), ir, occ);
      S.v.onView = S.onView; S.onView(S.v.view);
      S.setStyle(HA.config.style); S.renderScenes(); S.syncInsets();
      S.v.onFrame.push(dt => S.tick(dt));
      S.v.onPick = (ud, p) => {
        S.v.marks.forEach((k, id) => { if (k === 'blue') S.v.mark(id, null); });
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
      const pr = PRESETS[HA.config.preset];
      S.preset = pr || null;
      const want = HA.config.persona, persona = pr ? pr.persona : result.personas.some(p => p.id === want) ? want : result.personas[0].id;
      selectPersona(persona, pr && pr.tasks);
      $('#loading').remove();
      S.chat.say('agent', `已载入户型 ${HA.panels.esc(ir.scene_id)}：${ir.rooms.length} 个房间、${ir.doors.length} 扇门、${ir.objects.length} 件物体。先核对户型，再选谁来住；也可以直接在下面说。`);
      S.examples(); S.chat.enable();
      if (pr) {
        S.enter(pr.step);
        if (pr.at === 'fail') {
          const seg = S.tl.seg(0), run = seg.runs[0];
          S.seek(seg.t0 + run.duration - 1e-3); S.stopped = run; S.showProblem(run);
        }
        if (pr.say) S.onSay(pr.say);
      } else {
        if (result.plans.some(p => p.id === HA.config.plan)) S.plan = HA.config.plan;
        S.enter(['pick', 'stay', 'report', 'fix', 'compare'].includes(HA.config.step) ? HA.config.step : 'home');
      }
      window.HA_READY = true;
    } catch (err) {
      const l = $('#loading'); if (l) l.lastElementChild.textContent = '加载失败：' + err.message;
      console.error(err);
    }
  }

  S.chat = HA.chat.create($('#chat'), text => S.onSay(text));
  boot();
})();
