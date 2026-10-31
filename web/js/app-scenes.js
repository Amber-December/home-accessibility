/* Scenes, following B's app.js scene set. 白天 runs T1–T4 and T8, 夜间 runs T6 under dimmed light, 急救 runs T7.
   起火 and 地震 put every selected resident into one crowd and run B's FireModel / EarthquakeScenario
   (bsim-hazard.js in the worker). In 试住 a hazard scene replaces the task timeline with one evacuation segment,
   and smoke and heat or fallen furniture are drawn on the floor in step with playback. */
(() => {
  'use strict';
  const HA = window.HA, S = HA.app, T = HA.text, esc = s => HA.panels.esc(s);
  const $ = s => document.querySelector(s);
  const GROUPS = [
    ['日常', [
      { id: 'day', name: '白天', hint: 'T1–T4 日常动线 · T8 杂物', tasks: ['T1', 'T2', 'T3', 'T4', 'T8'] },
      { id: 'night', name: '夜间', hint: 'T6 起夜，灯光调暗', tasks: ['T6'], night: true },
      { id: 'rescue', name: '急救', hint: 'T7 担架进出', tasks: ['T7'] }]],
    ['灾害', [
      { id: 'fire', name: '起火', hint: '烟气蔓延，全员疏散', tasks: ['T5'], hazard: 'fire' },
      { id: 'quake', name: '地震', hint: '家具倾倒，全员疏散', tasks: ['T5'], hazard: 'quake' }]],
  ];
  const ALL = GROUPS.flatMap(g => g[1]);
  S.scene = 'day';
  const cur = () => ALL.find(s => s.id === S.scene) || ALL[0];
  const opt = { intensity: 1, room: '' };
  let hz = null, ov = null, hooked = false;

  S.sceneTasks = () => cur().tasks.slice();

  // ---- menu ----
  const isOpen = () => !$('#scene-list').hidden;
  function sceneMenu(open) {
    const on = typeof open === 'boolean' ? open : !isOpen();
    $('#scene-list').hidden = !on;
    $('#scene .menu-btn').setAttribute('aria-expanded', on);
  }
  const close = () => sceneMenu(false);
  S.renderScenes = () => {
    if (!hooked && S.v) { S.v.onFrame.push(draw); hooked = true; }
    const c = cur();
    $('#scene-name').textContent = c.name;
    $('#scene-list').innerHTML = GROUPS.map(([g, items]) => `<h5>${g}</h5>${items.map(s =>
      `<button role="menuitemradio" aria-checked="${s.id === c.id}" data-act="scene" data-arg="${s.id}">${s.name}<span>${s.hint}</span></button>`).join('')}`).join('');
  };

  function scene(id) {
    const s = ALL.find(x => x.id === id); close(); if (!s) return;
    S.scene = s.id; S.renderScenes();
    S.v.setNight(!!s.night);
    S.selectPersona(S.who, null);
    S.chat.say('agent', s.hazard ? `切到「${s.name}」：所选 ${S.who.length} 位住户一起从${S.ir.kind === 'office' ? '工位' : '卧室'}出发往外撤，仿真引擎推演${s.hazard === 'fire' ? '火和烟的蔓延' : '地面晃动和家具倾倒'}。`
      : `切到「${s.name}」：${s.tasks.map(t => `${t} ${esc(S.taskName(t))}`).join('、')}。`);
    if (['stay'].includes(S.step)) return S.enter('stay');
    if (['home', 'pick'].includes(S.step)) { S.setupPlayback(['base']); S.sides.forEach(x => { x.marker.visible = false; if (x.trail) x.trail.visible = false; }); }
    S.renderPanel();
  }

  // ---- hazard runs ----
  const keyOf = () => `${cur().hazard}|${opt.intensity}|${opt.room}|${S.picked().map(p => `${p.id}:${p.profile.width}:${p.profile.speed}`).join(',')}`;
  const pending = () => !!cur().hazard && (!hz || hz.key !== keyOf());
  async function prepare() {
    const sc = cur(), key = keyOf(), ps = S.picked();
    S.chat.say('agent', `仿真引擎正在推演${sc.name}，${ps.map(p => esc(p.name)).join('、')}一起疏散…`);
    const t0 = performance.now();
    const result = await HA.bsim.hazard(sc.hazard, ps, { intensity: opt.intensity, room: opt.room || null });
    hz = { key, kind: sc.hazard, result, runs: toRuns(result), ms: performance.now() - t0 };
    clearOverlay();
    report();
    return hz;
  }

  const need = p => +(Math.max(.22, Math.min(.6, (p.profile.width || .5) / 2 + .02)) * 2 + .08).toFixed(2);
  function reason(res, p) {
    const q = S.personaObj(p.id);
    if (p.fail_code === 'exit_too_narrow') {
      const w = Math.max(...res.exits.map(e => e.width || 0));
      return `最宽的出口净宽 ${w.toFixed(2)} m，这位住户要 ${need(q).toFixed(2)} m 才过得去`;
    }
    if (p.fail_code === 'fire_smoke') return `吸入烟气剂量 ${p.smoke_dose}，超过 3 已失能`;
    if (p.fail_code === 'fire_route_blocked') return `去出口的路被火和烟封住，在烟里待了 ${p.exposure_s} s`;
    if (p.fail_code === 'earthquake_route_blocked' || p.fail_code === 'earthquake_debris') return '倒下的家具和碎片挡住了去出口的路';
    if (p.fail_code === 'fire_high_temperature') return '去出口的路上温度超过 180 ℃';
    if (p.fail_code === 'smoke_exposure') return '去出口的路上烟浓度超过 0.55';
    if (p.fail_code === 'crowd_bottleneck') return '被前面的人堵在门口';
    return T.code(p.fail_code);
  }
  // Each resident's positions become a trajectory, so 试住 playback, markers, trails and the timeline work unchanged.
  function toRuns(res) {
    let k = 0;
    const name = res.kind === 'fire' ? '火灾疏散' : '地震疏散';
    return res.people.map(p => {
      const base = { persona: p.id, task: 'T5', name, hazard: res.kind, events: [], monologue: [], violations: [], min_clearance_m: null, min_clearance_object: null };
      if (!p.placed) return { ...base, applicable: false, reason: '户型里放不下这位住户', traj: [], duration: 0 };
      const j = k++, traj = [];
      for (const f of res.frames) {
        const [x, y, out] = f.a[j], prev = traj[traj.length - 1];
        const yaw = prev && Math.hypot(x - prev[1], y - prev[2]) > .02 ? Math.atan2(y - prev[2], x - prev[1]) : prev ? prev[3] : 0;
        traj.push([f.t, x, y, yaw]);
        if (out) break;
      }
      const duration = p.evacuated && p.time_s != null ? p.time_s : res.duration;
      return { ...base, applicable: true, success: p.evacuated, traj, duration: Math.max(.1, duration), time_s: p.time_s ?? +res.duration.toFixed(1),
        path_m: p.distance_m, fail_code: p.fail_code, fail_reason: p.evacuated ? '' : reason(res, p), smoke_dose: p.smoke_dose, exposure_s: p.exposure_s };
    });
  }
  // Chat card after a run: who got out and when, who did not and why, what the hazard did.
  function facts(res) {
    const s = res.summary || {};
    if (res.kind === 'fire') return `起火点在${esc(res.source.near || '屋内')}旁，最高温度 ${Math.round(s.maxTemperature || 0)} ℃，过火面积 ${((s.ignitedCells || 0) * .01).toFixed(1)} m²`;
    return `峰值地面加速度 ${res.pga.toFixed(2)} g，${s.candidates || 0} 件高家具里 ${s.rocked || 0} 件晃动、${s.toppled || 0} 件倒下，墙体开裂 ${s.cracked || 0} 处`;
  }
  function report() {
    const res = hz.result, out = hz.runs.filter(r => r.applicable && r.success), stuck = hz.runs.filter(r => r.applicable && !r.success);
    S.chat.say('agent', `${cur().name}推演完成：${out.length} 人撤出，${stuck.length} 人没出去。`, {
      title: facts(res),
      body: `<ul>${hz.runs.map(r => `<li><b>${esc(T.persona(r.persona, S))}</b>：${!r.applicable ? esc(r.reason)
        : r.success ? `${r.time_s} 秒撤出，走了 ${r.path_m} m` : `${esc(T.code(r.fail_code))}，${esc(r.fail_reason)}`}</li>`).join('')}</ul>`,
    });
  }

  // One segment for the whole evacuation; sides without a run (another variant) stay empty.
  function segs(sides) {
    if (S.step !== 'stay' || !cur().hazard || !hz || hz.key !== keyOf()) return null;
    const runs = sides.map(s => (s.vi ? null : hz.runs.find(r => r.persona === s.persona) || null));
    return [{ task: 'T5', label: `${cur().name} · 全员疏散`, runs, dur: hz.result.duration }];
  }

  // 试住 panel for a hazard scene: strength (and fire room), per-resident outcome, hazard facts.
  function panel(run) {
    const sc = cur(); if (!sc.hazard || S.step !== 'stay') return null;
    const lv = [[.7, '弱'], [1, '中'], [1.5, '强'], [2.2, '极强']].map(([v, l]) => `<button data-act="intensity" data-arg="${v}" aria-pressed="${opt.intensity === v}">${l}</button>`).join('');
    const rooms = sc.hazard === 'fire' ? `<label class="muted">起火房间 <select data-change="fireRoom" aria-label="起火房间"><option value="">随机</option>${S.ir.rooms.map(r =>
      `<option value="${esc(r.id)}" ${opt.room === r.id ? 'selected' : ''}>${esc(T.room(r.type))}</option>`).join('')}</select></label>` : '';
    const head = `<h3>${sc.name} · 全员疏散</h3><div class="cons"><div class="seg" role="group" aria-label="强度">${lv}</div>${rooms}</div>`;
    if (!hz || hz.key !== keyOf()) return `${head}<p class="muted">仿真引擎推演中…</p>`;
    const res = hz.result, icon = r => `<b class="st ${HA.timeline.status(r)}">${HA.timeline.ICON[HA.timeline.status(r)]}</b>`;
    const rows = hz.runs.map(r => { const p = S.personaObj(r.persona);
      return `<tr><td><i class="sw" style="background:${esc(p.color)}"></i>${esc(T.persona(r.persona, S))}</td>
        <td>${!r.applicable ? '<span class="muted">放不下</span>' : `${icon(r)} ${r.success ? '撤出' : esc(T.code(r.fail_code))}`}</td>
        <td class="num">${r.applicable ? `${r.time_s} s` : ''}</td><td class="num">${r.applicable ? `${r.path_m} m` : ''}</td>
        ${res.kind === 'fire' ? `<td class="num">${r.applicable ? r.smoke_dose : ''}</td>` : ''}</tr>`; }).join('');
    const why = hz.runs.filter(r => r.applicable && !r.success).map(r => `<li><span>${esc(T.persona(r.persona, S))}</span><span class="muted">${esc(r.fail_reason)}</span></li>`).join('');
    const fallen = res.kind === 'quake' ? res.debris.filter(d => d.kind === 'toppled').map(d => `<li><span>${esc(d.name)}</span><span class="num muted">${d.t.toFixed(1)} s${d.leaning ? ' · 靠在旁边' : ''}</span></li>`).join('') : '';
    return `${head}<p class="muted">${facts(res)}。出口 ${res.exits.map(e => `${esc(e.name)} ${(e.width || 0).toFixed(2)} m`).join('、')}。</p>
      <table class="who-runs"><tr><th>住户</th><th>结果</th><th>用时</th><th>路程</th>${res.kind === 'fire' ? '<th>烟气剂量</th>' : ''}</tr>${rows}</table>
      ${why ? `<h4>没出去的原因</h4><ul class="list">${why}</ul>` : ''}
      ${res.kind === 'quake' ? `<h4>倒下的家具</h4><ul class="list">${fallen || '<li class="muted">这个强度下没有家具倒下。</li>'}</ul>` : ''}
      <p class="muted">${res.kind === 'fire' ? '地面灰色是 0.2 m 高处的烟，橙红是火和高温。' : '红色方块是倒下家具占住的地面，灰色是墙体碎片。'}推演用时 ${(hz.ms / 1000).toFixed(1)} s。</p>
      <button data-act="go" data-arg="report">看体检报告</button>`;
  }
  const rerun = () => (S.step === 'stay' ? S.enter('stay') : S.renderPanel());
  function intensity(v) { opt.intensity = +v; rerun(); }
  function fireRoom(v) { opt.room = v || ''; rerun(); }

  // 整屋重新布置: open the highest-scoring plan that meets the user's conditions.
  function relayout() {
    const ok = S.result.plans.filter(p => !HA.plans.why(p, S.cons)), pool = ok.length ? ok : S.result.plans;
    const best = pool.reduce((a, b) => (b.score > a.score || (b.score === a.score && b.cost_cny < a.cost_cny) ? b : a), pool[0]);
    if (!best) return;
    S.plan = best.id;
    S.chat.say('agent', `整屋重新布置选了得分最高的方案 ${best.id}：${esc(best.title)}，${T.cny(best.cost_cny)}，${S.score('base')} → ${best.score} 分。`);
    S.enter('fix');
  }
  // ---- floor overlay: smoke and heat texture (fire) or fallen furniture and debris (quake), exits and fire source ----
  const { V, textSprite } = HA.sceneBuild;
  function clearOverlay() {
    if (!ov) return;
    S.v.scene.remove(ov.group);
    ov.group.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) { if (m.material.map) m.material.map.dispose(); m.material.dispose(); } });
    ov = null;
  }
  function build() {
    const res = hz.result, group = new THREE.Group(), o = { res, group, last: -1, pieces: [] };
    for (const e of res.exits) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(.32, 32), new THREE.MeshBasicMaterial({ color: '#2A9D8F', transparent: true, opacity: .75, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2; disc.position.copy(V(e.x, e.z, .03)); disc.renderOrder = 5;
      const s = textSprite('出口', '#2A9D8F', .42); s.position.copy(V(e.x, e.z, 1.1));
      group.add(disc, s);
    }
    if (res.kind === 'fire') {
      const { cols, rows, cell, minX, minZ } = res.field;
      o.px = new Uint8Array(cols * rows * 4);
      o.tex = new THREE.DataTexture(o.px, cols, rows, THREE.RGBAFormat);
      o.tex.magFilter = o.tex.minFilter = THREE.LinearFilter; o.tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(cols * cell, rows * cell),
        new THREE.MeshBasicMaterial({ map: o.tex, transparent: true, depthWrite: false, toneMapped: false }));
      mesh.rotation.x = -Math.PI / 2; mesh.position.copy(V(minX + cols * cell / 2, minZ + rows * cell / 2, .025)); mesh.renderOrder = 4;
      const s = textSprite(`起火点${res.source.near ? ` · ${res.source.near}` : ''}`, '#D7263D', .42); s.position.copy(V(res.source.x, res.source.z, 1.3));
      group.add(mesh, s);
    } else {
      for (const d of res.debris) {
        const fell = d.kind === 'toppled', h = Math.max(.08, d.height || .3);
        const box = new THREE.Mesh(new THREE.BoxGeometry(2 * d.hx, h, 2 * d.hz),
          new THREE.MeshStandardMaterial({ color: fell ? '#D7263D' : '#8A8590', transparent: true, opacity: fell ? .6 : .8, roughness: .9 }));
        box.position.copy(V(d.x, d.z, h / 2)); box.visible = false;
        const pc = { t: d.t, items: [box] };
        if (fell) { const s = textSprite(`${d.name}倒了`, '#D7263D', .2); s.position.copy(V(d.x, d.z, h + .5)); s.visible = false; pc.items.push(s); group.add(s); }
        group.add(box); o.pieces.push(pc);
      }
    }
    S.v.scene.add(group);
    return o;
  }
  // Smoke is grey with alpha rising with the square root of density (floor-level smoke is thin); heat above 8 % goes amber to vermilion and covers the smoke.
  function paint(o, f) {
    const { px } = o, sm = f.smoke, ht = f.heat;
    for (let j = 0; j < sm.length; j++) {
      const s = sm[j] / 255, h = ht[j] / 255, k = j * 4;
      if (h > .08) { px[k] = 232 - 17 * h; px[k + 1] = 163 - 125 * h; px[k + 2] = 61; px[k + 3] = 120 + 135 * Math.min(1, h * 1.5); }
      else { px[k] = px[k + 1] = 70; px[k + 2] = 80; px[k + 3] = s > .004 ? Math.min(215, 40 + Math.sqrt(s) * 320) : 0; }
    }
    o.tex.needsUpdate = true;
  }
  // Every rendered frame: overlay follows the playback clock of the evacuation segment.
  function draw() {
    const on = S.step === 'stay' && !!cur().hazard && !!hz && hz.key === keyOf();
    if (!on) { if (ov) ov.group.visible = false; return; }
    if (!ov || ov.res !== hz.result) { clearOverlay(); ov = build(); }
    ov.group.visible = true;
    const at = S.tl.at(S.t), t = at ? S.t - at.seg.t0 : 0, fs = hz.result.frames;
    const i = Math.max(0, Math.min(fs.length - 1, Math.floor(t / .5 + 1e-6)));
    if (hz.result.kind === 'fire') { if (i !== ov.last) { paint(ov, fs[i]); ov.last = i; } }
    else ov.pieces.forEach(pc => pc.items.forEach(m => { m.visible = t >= pc.t; }));
  }

  // Deep links and presets: pick the scene before the residents, without chat.
  function set(id) { if (!ALL.some(s => s.id === id)) return; S.scene = id; S.renderScenes(); S.v.setNight(!!cur().night); }

  S.scenes = {
    set, sceneMenu: () => sceneMenu(), scene, close, isOpen, relayout, intensity, fireRoom,
    pending, prepare, segs, panel, current: cur, hazard: () => hz,
  };
})();
