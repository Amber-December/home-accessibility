/* Risk points, as in B's 无障碍磕碰热点: per engine grid cell, contact and obstruction events of the selected runs
   plus the time the body spends within 0.35 m of an obstacle. Modes follow B's Grid.heatValue:
   access = contact + obstruction, contact, obstruction, risk = near + 3 x contact + 8 x blocked.
   Colours: B's palette, t = sqrt(value / max) x 3.999 between neighbouring stops. */
(() => {
  'use strict';
  const HA = window.HA = window.HA || {};
  const PALETTE = ['#28b9e8', '#ffcf61', '#ffa04c', '#f15d4b', '#c7335d'];
  const MODES = { risk: '综合风险 · 贴近时长 + 3×磕碰 + 8×受阻', access: '磕碰 + 障碍受阻 · 事件数', contact: '仅障碍磕碰 · 事件数', obstruction: '仅障碍受阻 · 事件数' };
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const STOPS = PALETTE.map(rgb);
  const colour = t => { const b = Math.min(3, Math.floor(t)), f = t - b; return STOPS[b].map((c, k) => Math.round(c + (STOPS[b + 1][k] - c) * f)); };

  // Cells hit by the runs: Map index -> { near s, contact n, obstruction n, list of incidents with resident and task }.
  function collect(runs) {
    const cells = new Map(), at = i => cells.get(i) || cells.set(i, { near: 0, contact: 0, obstruction: 0, list: [] }).get(i);
    let contacts = 0, dist = 0;
    for (const r of runs) {
      if (!r.applicable || !r.risk) continue;
      dist += r.path_m || 0;
      for (const [i, s] of r.risk.near) at(i).near += s;
      for (const x of r.risk.incidents) {
        if (x.i < 0) continue;
        const c = at(x.i); c[x.type === 'contact' ? 'contact' : 'obstruction']++;
        c.list.push({ ...x, persona: r.persona, task: r.task, name: r.name });
        if (x.type === 'contact') contacts++;
      }
    }
    return { cells, contacts, dist };
  }
  const value = (c, mode) => mode === 'access' ? c.contact + c.obstruction : mode === 'risk' ? c.near + 3 * c.contact + 8 * c.obstruction : c[mode] || 0;

  const cache = new Map();
  // Floor overlay on the engine grid (grid: {minX, minZ, cell, cols, rows}); cached by key.
  function layer(grid, runs, key, mode = 'risk') {
    if (cache.has(key)) return cache.get(key);
    if (cache.size > 24) cache.delete(cache.keys().next().value);
    const { cells, contacts, dist } = collect(runs), { cols, rows, cell } = grid;
    let max = 0, n = 0;
    for (const c of cells.values()) { const v = value(c, mode); if (v > 0) { n++; max = Math.max(max, v); } }
    const px = new Uint8Array(cols * rows * 4);
    for (const [i, c] of cells) {
      const v = value(c, mode); if (v <= 0) continue;
      px.set([...colour(Math.sqrt(v / Math.max(max, 1e-3)) * 3.999), 215], i * 4);
    }
    const tex = new THREE.DataTexture(px, cols, rows, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(cols * cell, rows * cell),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(HA.sceneBuild.V(grid.minX + cols * cell / 2, grid.minZ + rows * cell / 2, 0.02));
    mesh.renderOrder = 3;
    const out = { mesh, cells, max, mode, area: n * cell * cell, contacts, dist, per100: dist > 0 ? contacts * 100 / dist : null };
    cache.set(key, out);
    return out;
  }

  // The hit cell nearest (x, y) within one cell, for the inspector.
  function cellAt(grid, L, x, y) {
    const c0 = Math.floor((x - grid.minX) / grid.cell), r0 = Math.floor((y - grid.minZ) / grid.cell);
    let best = null;
    for (let r = r0 - 1; r <= r0 + 1; r++) for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (r < 0 || c < 0 || r >= grid.rows || c >= grid.cols) continue;
      const i = r * grid.cols + c, h = L.cells.get(i);
      if (h && value(h, L.mode) > 0 && (!best || value(h, L.mode) > value(best.h, L.mode))) best = { i, h, x: grid.minX + (c + .5) * grid.cell, y: grid.minZ + (r + .5) * grid.cell };
    }
    return best;
  }
  // Top cells by value, for the list in 体检.
  const top = (L, n = 8) => [...L.cells].map(([i, h]) => ({ i, h, v: value(h, L.mode) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, n);

  HA.risk = { PALETTE, MODES, collect, layer, cellAt, top, value };
})();
