/* Simulation timeline: one segment per task, status marks, event ticks, scrub, play / pause, speed. */
(() => {
  'use strict';
  const HA = window.HA = window.HA || {};
  const ICON = { ok: '●', fail: '✕', warn: '▲', na: '–' };

  function status(run) {
    if (!run.applicable) return 'na';
    if (!run.success) return 'fail';
    return run.violations.some(v => v.severity === 'yellow') || (run.min_clearance_m != null && run.min_clearance_m < 0.05) ? 'warn' : 'ok';
  }

  function create(el, cb) {
    el.innerHTML = `
      <div class="tl-ctrl">
        <button class="tl-play" title="空格键也可以">播放</button>
        <div class="tl-speed">${[1, 2, 4].map(s => `<button data-s="${s}">${s}×</button>`).join('')}</div>
        <span class="tl-clock">0.0 s</span>
      </div>
      <div class="tl-rows"></div>`;
    const rowsEl = el.querySelector('.tl-rows'), playBtn = el.querySelector('.tl-play'), clock = el.querySelector('.tl-clock');
    let rows = [], segs = [], total = 0;
    const tl = { speed: 1, playing: false };

    playBtn.onclick = () => cb.onPlay(!tl.playing);
    el.querySelectorAll('.tl-speed button').forEach(b => { b.onclick = () => { tl.setSpeed(+b.dataset.s); cb.onSpeed && cb.onSpeed(tl.speed); }; });

    // segs: [{label, dur, runs:[run per row]}]; rows: row titles (one per side in compare).
    tl.set = (segments, rowTitles = ['']) => {
      segs = segments; rows = rowTitles; total = 0;
      segs.forEach(s => { s.t0 = total; total += s.dur; });
      rowsEl.innerHTML = rows.map((title, ri) => `
        <div class="tl-row" data-r="${ri}">${title ? `<span class="tl-rowname">${title}</span>` : ''}
          <div class="tl-track">${segs.map((s, si) => {
            const run = s.runs[ri], st = run ? status(run) : 'na';
            const ticks = run && run.applicable ? run.events.filter(e => e.type === 'CONTACT' || e.type === 'DOOR_PASS').map(e =>
              `<i class="tick ${e.type === 'CONTACT' ? 'hit' : ''}" style="left:${(100 * e.t / Math.max(0.01, s.dur)).toFixed(2)}%"></i>`).join('') : '';
            return `<div class="tl-seg ${st}" data-s="${si}" style="flex-grow:${Math.max(s.dur, 2.5)}"
              title="${s.label}${run && !run.applicable ? '：' + (run.reason || '不适用') : ''}">
              <span class="tl-name">${s.label}</span>${ticks}<b class="tl-mark">${ICON[st]}</b><div class="tl-fill"></div></div>`;
          }).join('')}</div></div>`).join('');
      rowsEl.querySelectorAll('.tl-seg').forEach(d => {
        d.onpointerdown = e => {
          const s = segs[+d.dataset.s], r = d.getBoundingClientRect();
          cb.onSeek(s.t0 + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * s.dur);
        };
      });
      tl.setTime(0);
    };

    tl.total = () => total;
    tl.at = t => {
      for (let i = 0; i < segs.length; i++) if (t < segs[i].t0 + segs[i].dur || i === segs.length - 1) return { k: i, seg: segs[i], local: Math.max(0, t - segs[i].t0) };
      return null;
    };
    tl.seg = k => segs[k];
    tl.setTime = t => {
      clock.textContent = `${t.toFixed(1)} s / ${total.toFixed(1)} s`;
      rowsEl.querySelectorAll('.tl-row').forEach(row => row.querySelectorAll('.tl-seg').forEach(d => {
        const s = segs[+d.dataset.s], f = s.dur ? Math.max(0, Math.min(1, (t - s.t0) / s.dur)) : (t >= s.t0 ? 1 : 0);
        d.querySelector('.tl-fill').style.width = (100 * f).toFixed(2) + '%';
        d.classList.toggle('cur', t >= s.t0 && t < s.t0 + s.dur);
      }));
    };
    tl.setPlaying = p => { tl.playing = p; playBtn.textContent = p ? '暂停' : '播放'; };
    tl.setSpeed = s => {
      tl.speed = s; el.querySelectorAll('.tl-speed button').forEach(b => b.classList.toggle('on', +b.dataset.s === s));
    };
    tl.show = on => { el.hidden = !on; };
    tl.setSpeed(1);
    return tl;
  }

  HA.timeline = { create, status, ICON };
})();
