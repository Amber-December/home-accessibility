/* 上传平面图: match an uploaded floor-plan image to the homes in the 素材库 by wall layout.

   Both sides become a wall mask: dark pixels of the image (luminance < 80) and wall cells of each home's occupancy
   grid (rows flipped so north is up). Small connected pieces (room names, dimensions, the scale bar) are dropped,
   the rest is cropped to its bounding box and pooled into a 48 x 48 map of wall density. Two maps are compared with
   a tolerant overlap (each map against the other's 3 x 3 max-filtered copy) under all eight rotations and flips, and
   the score mixes that overlap with how close the two aspect ratios are. */
(() => {
  'use strict';
  const HA = window.HA = window.HA || {};
  const N = 48, LONG = 512, DARK = 80;

  // Keep connected components (8-neighbour) of at least 5% of the largest one; returns their bounding box.
  function mainBox(m, w, h) {
    const lab = new Int32Array(w * h), sizes = [0], stack = [];
    for (let s = 0; s < w * h; s++) {
      if (!m[s] || lab[s]) continue;
      const id = sizes.length; let n = 0; lab[s] = id; stack.push(s);
      while (stack.length) {
        const p = stack.pop(), x = p % w, y = (p - x) / w; n++;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
          const q = Y * w + X; if (m[q] && !lab[q]) { lab[q] = id; stack.push(q); }
        }
      }
      sizes.push(n);
    }
    const big = Math.max(0, ...sizes), keep = sizes.map(n => n >= .05 * big);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let p = 0; p < w * h; p++) {
      if (!lab[p] || !keep[lab[p]]) { m[p] = 0; continue; }
      const x = p % w, y = (p - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
  }

  // Wall density per cell of an N x N grid over the box, scaled so a cell a third covered counts as full.
  function describe(m, w, h) {
    const b = mainBox(m, w, h); if (!b) return null;
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0, g = new Float32Array(N * N), cnt = new Float32Array(N * N);
    for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) {
      const k = Math.min(N - 1, Math.floor((y - b.y0) / bh * N)) * N + Math.min(N - 1, Math.floor((x - b.x0) / bw * N));
      cnt[k]++; if (m[y * w + x]) g[k]++;
    }
    for (let k = 0; k < g.length; k++) g[k] = cnt[k] ? Math.min(1, g[k] / cnt[k] / .33) : 0;
    return { g, aspect: bw / bh };
  }

  const dilate = g => {
    const o = new Float32Array(N * N);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      let v = 0;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < N && b < N && g[a * N + b] > v) v = g[a * N + b];
      }
      o[i * N + j] = v;
    }
    return o;
  };
  // The eight rotations and flips of an N x N map; the odd ones swap width and height.
  function dihedral(g) {
    const out = [];
    for (let t = 0; t < 8; t++) {
      const o = new Float32Array(N * N);
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        let a = i, b = j;
        if (t & 1) [a, b] = [b, a];
        if (t & 2) a = N - 1 - a;
        if (t & 4) b = N - 1 - b;
        o[a * N + b] = g[i * N + j];
      }
      out.push({ g: o, swap: !!(t & 1) });
    }
    return out;
  }
  function overlap(a, b) {
    const ad = dilate(a), bd = dilate(b);
    let num = 0, den = 0;
    for (let k = 0; k < a.length; k++) { num += Math.min(a[k], bd[k]) + Math.min(b[k], ad[k]); den += a[k] + b[k]; }
    return den ? num / den : 0;
  }
  function compare(q, c) {
    let best = { score: 0 };
    for (const v of dihedral(q.g)) {
      const ar = v.swap ? 1 / q.aspect : q.aspect, shape = Math.min(ar, c.aspect) / Math.max(ar, c.aspect);
      const walls = overlap(v.g, c.g), score = .7 * walls + .3 * shape;
      if (score > best.score) best = { score, walls, shape, turned: v.swap };
    }
    return best;
  }

  // Image (File, Blob or URL) -> descriptor.
  async function fromImage(src) {
    const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
    const bmp = await createImageBitmap(blob), k = Math.min(1, LONG / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(bmp, 0, 0, w, h);
    const px = cx.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) m[p] = .299 * px[4 * p] + .587 * px[4 * p + 1] + .114 * px[4 * p + 2] < DARK ? 1 : 0;
    return { d: describe(m, w, h), url: cv.toDataURL('image/png'), size: [bmp.width, bmp.height] };
  }
  // Occupancy grid -> descriptor: wall cells in the body or toe layer, north up.
  function fromOcc(occ) {
    const { rows, cols, labels } = occ, wall = labels.indexOf('wall'), m = new Uint8Array(rows * cols);
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const k = i * cols + j; if (occ.body[k] === wall || occ.toe[k] === wall) m[(rows - 1 - i) * cols + j] = 1;
    }
    return describe(m, cols, rows);
  }

  const cache = new Map();
  // Rank homes ({id, ir, ...} from lab/index.json) against an uploaded plan. Returns the query and the sorted matches.
  async function match(src, homes, onProgress = () => {}) {
    const q = await fromImage(src);
    if (!q.d) throw new Error('图里没有找到墙线，换一张对比度高一点的平面图');
    const out = [];
    for (const [i, h] of homes.entries()) {
      if (!cache.has(h.id)) {
        const ir = await (await fetch(h.ir)).json(), base = h.ir.replace(/[^/]*$/, '');
        const occ = await HA.api.loadOccupancy(base + (ir.occupancy.file || 'occupancy.npz'), ir.occupancy.grid);
        cache.set(h.id, fromOcc(occ));
      }
      const c = cache.get(h.id);
      if (c) out.push({ home: h, ...compare(q.d, c) });
      onProgress(i + 1, homes.length);
    }
    out.sort((a, b) => b.score - a.score);
    return { query: q, matches: out };
  }

  HA.planMatch = { match, fromImage, fromOcc, compare, N };
})();
