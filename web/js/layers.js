/* Overlay layers: clearance heatmap per resident (exact EDT on the occupancy grid), door sweeps. */
(() => {
  'use strict';
  const HA = window.HA = window.HA || {};
  const INF = 1e20;

  // 1-D squared distance transform (Felzenszwalb & Huttenlocher).
  function dt1(f, n, d, v, z) {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  }

  // Euclidean distance (in cells) from every cell to the nearest solid cell.
  function edt(solid, rows, cols) {
    const n = Math.max(rows, cols), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    const g = new Float64Array(rows * cols);
    for (let i = 0; i < rows * cols; i++) g[i] = solid[i] ? 0 : INF;
    for (let j = 0; j < cols; j++) {
      for (let i = 0; i < rows; i++) f[i] = g[i * cols + j];
      dt1(f, rows, d, v, z);
      for (let i = 0; i < rows; i++) g[i * cols + j] = d[i];
    }
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) f[j] = g[i * cols + j];
      dt1(f, cols, d, v, z);
      for (let j = 0; j < cols; j++) g[i * cols + j] = Math.sqrt(d[j]);
    }
    return g;
  }

  // Label grid after plan edits (remove clears the object's cells, move shifts them).
  function edited(occ, layer, edits) {
    const src = occ[layer];
    if (!edits || !edits.length) return src;
    const g = Int32Array.from(src), { rows, cols, res } = occ;
    for (const e of edits) {
      const idx = occ.labels.indexOf('obj:' + e.object_id); if (idx < 0) continue;
      const cells = [];
      for (let k = 0; k < g.length; k++) if (g[k] === idx) { cells.push(k); g[k] = -1; }
      if (e.op === 'move') {
        const di = Math.round(e.dy / res), dj = Math.round(e.dx / res);
        for (const k of cells) {
          const i = Math.floor(k / cols) + di, j = (k % cols) + dj;
          if (i >= 0 && j >= 0 && i < rows && j < cols) g[i * cols + j] = idx;
        }
      }
    }
    return g;
  }

  function halfWidth(p) { const f = p.footprint; return f.shape === 'rect' ? f.size[0] / 2 : f.r; }

  // Clearance (m) per free cell for a resident: distance to the nearest solid minus half its width.
  function clearance(occ, persona, edits) {
    const { rows, cols, res } = occ, doors = new Set();
    occ.labels.forEach((s, i) => { if (s.startsWith('door:')) doors.add(i); });
    const body = edited(occ, 'body', edits);
    const toe = persona.footprint.layers && persona.footprint.layers.toe ? edited(occ, 'toe', edits) : null;
    const solid = new Uint8Array(rows * cols);
    for (let k = 0; k < solid.length; k++) {
      const b = body[k] >= 0 && !doors.has(body[k]), t = toe && toe[k] >= 0 && !doors.has(toe[k]);
      solid[k] = b || t ? 1 : 0;
    }
    const d = edt(solid, rows, cols), r = halfWidth(persona), out = new Float32Array(rows * cols);
    for (let k = 0; k < out.length; k++) out[k] = solid[k] ? NaN : d[k] * res - res / 2 - r;
    return out;
  }

  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const cache = new Map();

  // Heatmap mesh on the floor; cached per (persona, plan).
  function heatmap(occ, persona, edits, key) {
    if (cache.has(key)) return cache.get(key);
    const { rows, cols, res, x0, y0 } = occ, c = clearance(occ, persona, edits);
    const px = new Uint8Array(rows * cols * 4);
    for (let k = 0; k < c.length; k++) {
      if (Number.isNaN(c[k]) || occ.room[k] < 0) continue;
      const [r, g, b] = rgb(HA.text.clearColor(c[k]));
      px.set([r, g, b, c[k] < 0.10 ? 200 : 110], k * 4);
    }
    const tex = new THREE.DataTexture(px, cols, rows, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(cols * res, rows * res),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(HA.sceneBuild.V(x0 + cols * res / 2, y0 + rows * res / 2, 0.015));
    mesh.renderOrder = 2;
    const out = { mesh, clearance: c };
    cache.set(key, out);
    return out;
  }

  HA.layers = { edt, clearance, heatmap, halfWidth };
})();
