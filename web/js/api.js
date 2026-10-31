/* Data loading: scene IR, layered occupancy (npz read in the browser) and the 素材库 catalog. */
(() => {
  'use strict';
  const HA = window.HA = window.HA || {};
  const q = new URLSearchParams(location.search);
  const FIX = '../tests/fixtures/H1/';
  const H1 = 'models/H1/scene000064.glb';
  const glbFor = ir => {
    if (!ir) return H1;
    const sid = (/lab\/([\w-]+)\/scene_ir\.json$/.exec(ir) || /(scene\d+)\/scene_ir\.json$/.exec(ir) || [])[1];
    return !sid ? '' : sid === 'scene000064' ? H1 : ir.replace(/scene_ir\.json$/, `${sid}.glb`);
  };
  HA.config = {
    ir: q.get('ir') || FIX + 'scene_ir.json',
    occupancy: q.get('occ') || FIX + 'occupancy.npz',
    // Every home ships a display GLB next to its IR (H1 under models/); ?glb=none falls back to the IR white model.
    glb: q.get('glb') === 'none' ? '' : q.get('glb') || glbFor(q.get('ir')),
    style: q.get('style') === 'diag' ? 'diag' : 'real',
    preset: q.get('preset') || '',
    // Deep links from the lab and the 素材库: open a step for one persona, optionally with a plan chosen.
    step: q.get('step') || '', persona: q.get('persona') || '', plan: q.get('plan') || '',
    quality: q.get('quality') || 'normal',
    scene: q.get('scene') || '',
  };

  async function json(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  }

  // Minimal .npy reader: little-endian numeric arrays and fixed-width unicode (<U) strings.
  function parseNpy(buf) {
    const u8 = new Uint8Array(buf);
    const major = u8[6];
    const hlen = major === 1 ? u8[8] | (u8[9] << 8) : new DataView(buf).getUint32(8, true);
    const off = major === 1 ? 10 : 12;
    const header = new TextDecoder('latin1').decode(u8.subarray(off, off + hlen));
    const descr = /'descr':\s*'([^']+)'/.exec(header)[1];
    const shape = /'shape':\s*\(([^)]*)\)/.exec(header)[1].split(',').map(s => s.trim()).filter(Boolean).map(Number);
    const body = buf.slice(off + hlen);
    const types = { '<i4': Int32Array, '<i2': Int16Array, '<f4': Float32Array, '<f8': Float64Array, '|u1': Uint8Array, '|b1': Uint8Array };
    if (descr.startsWith('<U')) {
      const w = Number(descr.slice(2)), cp = new Uint32Array(body), out = [];
      for (let i = 0; i < shape[0]; i++) {
        let s = '';
        for (let k = 0; k < w; k++) { const c = cp[i * w + k]; if (!c) break; s += String.fromCodePoint(c); }
        out.push(s);
      }
      return { shape, data: out };
    }
    if (!types[descr]) throw new Error('npy dtype not supported: ' + descr);
    return { shape, data: new types[descr](body) };
  }

  async function loadOccupancy(url, grid) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    const files = fflate.unzipSync(new Uint8Array(await r.arrayBuffer()));
    const arr = name => {
      const f = files[name + '.npy'];
      return f && parseNpy(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength));
    };
    const body = arr('layer_body');
    return {
      ...grid, rows: body.shape[0], cols: body.shape[1],
      labels: arr('labels').data,
      body: body.data, toe: arr('layer_toe').data, head: arr('layer_head').data,
      room: arr('extra_room').data,
    };
  }

  HA.api = {
    // The home (IR + occupancy) and the 素材库 products used for catalog swaps. Results come from the engine (bsim.js).
    async loadAll() {
      const ir = await json(HA.config.ir);
      const base = HA.config.ir.replace(/[^/]*$/, '');
      const occUrl = q.get('occ') || base + (ir.occupancy && ir.occupancy.file || 'occupancy.npz');
      const [occ, items] = await Promise.all([
        loadOccupancy(occUrl, ir.occupancy.grid),
        json('library/catalog.json').then(c => c.items || []).catch(() => []),
      ]);
      return { ir, occ, items };
    },
    parseNpy, loadOccupancy,
  };
})();
