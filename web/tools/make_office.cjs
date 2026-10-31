/* B's office test floor (prototypes/indoor-space-interaction/js/office.js) as a 实验室 scene: scene IR, layered
   occupancy and a display GLB in web/lab/office01/, plus its entry in web/lab/index.json.

   office.js builds every wall and piece of furniture from boxes. This script runs it with three r128, reads the
   boxes back from the instanced meshes, groups touching furniture boxes into objects, and writes the same files the
   USDZ import writes for a home. Two changes to B's floor: an entrance in the south curtain wall at the reception
   (B's floor is closed all round) and lights over every room for the night scene.

     node web/tools/make_office.cjs
*/
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const ROOT = path.resolve(__dirname, '../..'), OUT = path.join(ROOT, 'web/lab/office01');
const ID = 'office01', RES = 0.05, X0 = -18.1, Y0 = -13.1, W = 36.2, H = 26.2;
const LAYERS = { toe: [0.05, 0.3], body: [0.3, 1.4], head: [1.4, 2.0], floor: [0, 0.05] };
const ENTRY = { x: 3.95, z: 12.83, width: 1.8 };

// ---- run office.js ----
function boxes() {
  const ctx = new Proxy({}, { get: () => () => {} });
  globalThis.window = globalThis; globalThis.self = globalThis;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }), querySelectorAll: () => [] };
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'prototypes/js/vendor/three-r128/build/three.min.js'), 'utf8'));
  globalThis.IndoorLab = {};
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'prototypes/indoor-space-interaction/js/office.js'), 'utf8'));
  const THREE = globalThis.THREE, demo = globalThis.IndoorLab.makeOfficeDemo(), out = [];
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler();
  for (const mesh of demo.group.children) {
    if (!mesh.isInstancedMesh || mesh.geometry.type === 'SphereGeometry') continue;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m); m.decompose(p, q, s); e.setFromQuaternion(q, 'YXZ');
      out.push({ key: mesh.name, wall: !!mesh.userData.wall, x: p.x, y: p.y, z: p.z, w: s.x, h: s.y, d: s.z, rot: e.y,
        info: (mesh.userData.instanceMetadata || [])[i] || {} });
    }
  }
  // Foliage spheres stay visual (B ignores them for collision too).
  const leaves = demo.group.children.find(c => c.isInstancedMesh && c.geometry.type === 'SphereGeometry'), plants = [];
  if (leaves) for (let i = 0; i < leaves.count; i++) { leaves.getMatrixAt(i, m); m.decompose(p, q, s); plants.push({ x: p.x, y: p.y, z: p.z, sx: s.x * .32, sy: s.y * .32, sz: s.z * .32 }); }
  return { THREE, list: entrance(out), plants };
}

// Cut the entrance out of the south curtain wall: every wall box that crosses it is split in two.
function entrance(list) {
  const a = ENTRY.x - ENTRY.width / 2, b = ENTRY.x + ENTRY.width / 2, out = [];
  for (const k of list) {
    const lo = k.x - k.w / 2, hi = k.x + k.w / 2;
    if (!k.wall || Math.abs(k.z - ENTRY.z) > .2 || Math.abs(k.rot) > 1e-6 || hi <= a || lo >= b || k.w < 1) { out.push(k); continue; }
    if (a > lo) out.push({ ...k, x: (lo + a) / 2, w: a - lo });
    if (hi > b) out.push({ ...k, x: (b + hi) / 2, w: hi - b });
  }
  return out;
}

// Footprint corners of a (possibly rotated) box in B's (x, z).
function corners(k) {
  const c = Math.cos(k.rot), s = Math.sin(k.rot), out = [];
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const dx = u * k.w / 2, dz = v * k.d / 2;
    out.push([k.x + dx * c + dz * s, k.z - dx * s + dz * c]);
  }
  return out;
}
const rect = k => { const cs = corners(k), xs = cs.map(p => p[0]), zs = cs.map(p => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }; };
// ---- rooms and doorways, in B's (x, z); the IR has x, y = -z ----
const R = (id, type, name, x0, x1, z0, z1) => ({ id, type, name, rects: [[x0, x1, z0, z1]] });
const ROOMS = [
  R('openOffice1', 'openOffice', '01 开放办公', -17.72, -7.89, -12.72, -4.29), R('collabSpace1', 'collabSpace', '02 协作空间', -17.72, -7.89, -4.11, 4.11),
  R('studio1', 'studio', '03 工作室', -17.72, -7.89, 4.29, 12.72), R('designStudio1', 'designStudio', '04 设计团队', 7.89, 17.72, -12.72, -4.29),
  R('openOffice2', 'openOffice', '05 开放办公', 7.89, 17.72, -4.11, 4.11), R('projectSpace1', 'projectSpace', '06 项目空间', 7.89, 17.72, 4.29, 12.72),
  R('meetingRoom1', 'meetingRoom', '07 会议室', -7.71, -0.09, -12.72, -6.34), R('trainingRoom1', 'trainingRoom', '08 培训室', 0.09, 7.71, -12.72, -6.34),
  R('reception1', 'reception', '09 接待会客', 0.09, 7.71, 6.34, 12.72), R('multiHall1', 'multiHall', '10 多功能厅', -7.71, -0.09, 6.34, 12.72),
  R('lounge1', 'lounge', '休息区', -4.51, -0.09, -3.71, -1.36), R('equipmentRoom1', 'equipmentRoom', '设备间', 0.09, 4.51, -3.71, -1.36),
  R('pantry1', 'pantry', '茶水间', -4.51, -0.09, -1.18, 1.18), R('elevatorLobby1', 'elevatorLobby', '电梯厅', 0.09, 4.51, -1.18, 1.18),
  R('serviceRoom1', 'serviceRoom', '服务间', -4.51, -0.09, 1.36, 3.71), R('accessibleToilet1', 'accessibleToilet', '无障碍卫生间', 0.09, 4.51, 1.36, 3.71),
  { id: 'corridor1', type: 'corridor', name: '环形走廊', rects: [[-7.71, -4.69, -6.16, 6.16], [4.69, 7.71, -6.16, 6.16], [-4.69, 4.69, -6.16, -3.89], [-4.69, 4.69, 3.89, 6.16]] },
];
// Doorways as office.js cuts them: [rooms, centre x, centre z, wall runs along 'x' or 'z', opening width].
function doorways() {
  const out = [], outer = { '-8.45': ['meetingRoom1', 'trainingRoom1'], 0: ['corridor1', 'corridor1'], '8.45': ['multiHall1', 'reception1'] };
  const outerRoom = { '-1,-8.45': 'openOffice1', '-1,0': 'collabSpace1', '-1,8.45': 'studio1', '1,-8.45': 'designStudio1', '1,0': 'openOffice2', '1,8.45': 'projectSpace1' };
  for (const x of [-7.8, 7.8]) for (const z of [-8.45, 0, 8.45]) out.push([[outerRoom[Math.sign(x) + ',' + z], outer[z][x < 0 ? 0 : 1]], x, z, 'z', 1.8]);
  for (const [z, w, rs] of [[-6.25, 1.9, ['meetingRoom1', 'trainingRoom1']], [6.25, 2.0, ['multiHall1', 'reception1']]])
    for (const x of [-3.9, 3.9]) out.push([[rs[x < 0 ? 0 : 1], 'corridor1'], x, z, 'x', w]);
  const core = { '-1,-2.53': 'lounge1', '1,-2.53': 'equipmentRoom1', '-1,0': 'pantry1', '1,0': 'elevatorLobby1', '-1,2.53': 'serviceRoom1', '1,2.53': 'accessibleToilet1' };
  for (const sx of [-1, 1]) for (const z of [-2.53, 0, 2.53]) out.push([[core[sx + ',' + z], 'corridor1'], sx * 4.6, z, 'z', sx < 0 && z < 0 ? 1.15 : 1.6]);
  out.push([['reception1'], ENTRY.x, ENTRY.z, 'x', ENTRY.width]);
  return out.map(([rooms, x, z, along, w]) => {
    const ax = along === 'x' ? [1, 0] : [0, -1], nm = along === 'x' ? [0, 1] : [1, 0], y = -z, entry = rooms.length === 1;
    const seg = [[x - ax[0] * w / 2, y - ax[1] * w / 2], [x + ax[0] * w / 2, y + ax[1] * w / 2]].map(p => p.map(r3));
    return { id: entry ? 'entrance_door' : rooms.join('_') + '_door', rooms, kind: entry ? 'automatic' : 'opening', leaves: [], open_leaves: [],
      notes: [entry ? '自动感应门，常开' : '无门扇门洞'], axis: ax, normal: nm, center: [r3(x), r3(y)], depth: entry ? .22 : .18,
      opening_width: w, opening_segment: seg, clear_width: w, clear_segment: seg };
  });
}
const r3 = v => Math.round(v * 1000) / 1000;
const inRect = (x, z, [x0, x1, z0, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
const roomOf = (x, z) => (ROOMS.find(r => r.rects.some(q => inRect(x, z, q))) || { id: 'corridor1' }).id;

// ---- furniture: touching boxes become one object ----
const SKIP = k => k.key === 'key' || k.key === 'floor' || (k.key === 'accent' && !k.wall) || k.y + k.h / 2 <= .01;
function objects(list) {
  const fs_ = list.filter(k => !k.wall && !SKIP(k)), rs = fs_.map(rect), par = fs_.map((_, i) => i);
  const find = i => (par[i] === i ? i : (par[i] = find(par[i])));
  for (let i = 0; i < fs_.length; i++) for (let j = i + 1; j < fs_.length; j++) {
    const a = rs[i], b = rs[j];
    if (a.minX <= b.maxX + .005 && b.minX <= a.maxX + .005 && a.minZ <= b.maxZ + .005 && b.minZ <= a.maxZ + .005) par[find(i)] = find(j);
  }
  const groups = new Map();
  fs_.forEach((k, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(k); });
  const count = {}, out = [];
  for (const parts of groups.values()) {
    const r = parts.map(rect).reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ) }));
    const y0 = Math.min(...parts.map(k => k.y - k.h / 2)), y1 = Math.max(...parts.map(k => k.y + k.h / 2));
    const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2, wx = r.maxX - r.minX, wz = r.maxZ - r.minZ, area = wx * wz;
    const has = key => parts.some(k => k.key === key), big = parts.reduce((a, b) => (a.w * a.d >= b.w * b.d ? a : b));
    const [cat, type] = parts.some(k => /办公桌/.test(k.info.name || '')) ? ['desk', 'dynamic_furniture']
      : big.key === 'chair' ? ['chair', 'dynamic_furniture']
      : big.key === 'fabric' ? ['sofa', 'dynamic_furniture']
      : big.key === 'wood' ? ['cabinet', 'builtin']
      : big.key === 'metal' ? ['cabinet', 'builtin']
      : big.key === 'screen' ? ['tv', 'wall_mounted_object']
      : Math.hypot(cx - 1.1, cz - 3.15) < .2 ? ['toilet', 'dynamic_furniture']
      : Math.hypot(cx - 3.5, cz - 3.25) < .2 ? ['washbasin', 'wall_mounted_object']
      : area > 4 ? ['conferencetable', 'large_appliance']
      : has('accent') || y1 > .9 && area > 1.5 ? ['receptiondesk', 'large_appliance']
      : Math.abs(wx - .5) < .01 && Math.abs(wz - .5) < .01 ? ['plant', 'ornament']
      : ['coffeetable', 'dynamic_furniture'];
    const room = roomOf(cx, cz), n = (count[room + cat] = (count[room + cat] || 0) + 1);
    out.push({ id: `${room}_${cat}_${String(n).padStart(2, '0')}`, category: cat, type, room, parts,
      aabb: { min: [r3(r.minX), r3(-r.maxZ), r3(y0)], max: [r3(r.maxX), r3(-r.minZ), r3(y1)] },
      mass_kg: null, has_collision: true, joints: [],
      footprint: [[r.minX, -r.minZ], [r.maxX, -r.minZ], [r.maxX, -r.maxZ], [r.minX, -r.maxZ], [r.minX, -r.minZ]].map(p => p.map(r3)) });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
// ---- layered occupancy on the import grid (rows along IR y, cols along IR x) ----
function occupancy(walls, objs) {
  const cols = Math.round(W / RES), rows = Math.round(H / RES), n = rows * cols, labels = ['wall', ...objs.map(o => 'obj:' + o.id)];
  const layer = {}; for (const k of ['toe', 'body', 'head']) layer[k] = new Int32Array(n).fill(-1);
  const paint = (k, label) => {
    const c = Math.cos(k.rot), s = Math.sin(k.rot), r = rect(k), y0 = k.y - k.h / 2, y1 = k.y + k.h / 2;
    const hit = Object.keys(layer).filter(L => y1 > LAYERS[L][0] && y0 < LAYERS[L][1]); if (!hit.length) return;
    const j0 = Math.max(0, Math.floor((r.minX - X0) / RES)), j1 = Math.min(cols - 1, Math.floor((r.maxX - X0) / RES));
    const i0 = Math.max(0, Math.floor((-r.maxZ - Y0) / RES)), i1 = Math.min(rows - 1, Math.floor((-r.minZ - Y0) / RES));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const x = X0 + (j + .5) * RES - k.x, z = -(Y0 + (i + .5) * RES) - k.z, u = x * c - z * s, v = x * s + z * c;
      if (Math.abs(u) <= k.w / 2 && Math.abs(v) <= k.d / 2) for (const L of hit) layer[L][i * cols + j] = label;
    }
  };
  walls.forEach(k => paint(k, 0));
  objs.forEach((o, i) => o.parts.forEach(k => paint(k, i + 1)));
  const room = new Int16Array(n).fill(-1);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const k = i * cols + j; if (layer.body[k] === 0 || layer.toe[k] === 0) continue;
    const x = X0 + (j + .5) * RES, z = -(Y0 + (i + .5) * RES), ri = ROOMS.findIndex(r => r.rects.some(q => inRect(x, z, q)));
    room[k] = ri;
  }
  return { rows, cols, labels, layer, room };
}

// Ceiling lights every ~3 m in every room, so the night scene has fittings to switch off.
function lights() {
  const out = [];
  for (const r of ROOMS) for (const [x0, x1, z0, z1] of r.rects) {
    const nx = Math.max(1, Math.round((x1 - x0) / 3)), nz = Math.max(1, Math.round((z1 - z0) / 3));
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
      const x = x0 + (a + .5) * (x1 - x0) / nx, z = z0 + (b + .5) * (z1 - z0) / nz;
      out.push({ id: `${r.id}_light_${out.length}`, kind: 'RectLight', pos: [r3(x), r3(-z), 2.6], dir: [0, 0, -1], intensity: 3000, exposure: 0,
        color: [1, .96, .9], size: [1.2, .3], area: .36, room: r.id });
    }
  }
  return out;
}

// ---- .npz writer (deflated zip of .npy) ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function npy(descr, shape, data) {
  let h = `{'descr': '${descr}', 'fortran_order': False, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}), }`;
  h += ' '.repeat(64 - ((10 + h.length + 1) % 64)) + '\n';
  const head = Buffer.alloc(10); head.write('\x93NUMPY', 0, 'latin1'); head[6] = 1; head[7] = 0; head.writeUInt16LE(h.length, 8);
  return Buffer.concat([head, Buffer.from(h, 'latin1'), Buffer.from(data.buffer, data.byteOffset, data.byteLength)]);
}
function strings(list) {
  const w = Math.max(...list.map(s => [...s].length)), a = new Uint32Array(list.length * w);
  list.forEach((s, i) => [...s].forEach((ch, k) => { a[i * w + k] = ch.codePointAt(0); }));
  return npy('<U' + w, [list.length], a);
}
function zip(files) {
  const loc = [], cen = []; let off = 0;
  for (const [name, raw] of Object.entries(files)) {
    const nm = Buffer.from(name), crc = crc32(raw), data = zlib.deflateRawSync(raw, { level: 9 }), h = Buffer.alloc(30), c = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nm.length, 26);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    loc.push(h, nm, data); cen.push(c, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(cen), end = Buffer.alloc(22), n = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...loc, cd, end]);
}
// ---- display GLB: one top-level node per IR object (named by its id), plus 'wall' and 'ground' ----
// Colours are B's office palette (sRGB hex, stored linear as glTF expects).
const PALETTE = { wall: ['#eef3fb', .86], floor: ['#acb9cc', .63], slab: ['#9aafce', .58], desk: ['#dfeafb', .34], metal: ['#6f89af', .31, .65],
  chair: ['#086ce0', .42], fabric: ['#477fc1', .58], wood: ['#96aece', .58], plant: ['#779d9c', .7], glass: ['#0077f0', .14, .08, .38],
  screen: ['#254e82', .24, .25], accent: ['#087af2', .36, .18], key: ['#506b8d', .58] };
function glb(THREE, nodes) {
  const bin = [], views = [], accessors = [], meshes = [], gnodes = [], mats = [], matIdx = {};
  let off = 0;
  const push = (arr, target) => { const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); bin.push(b); views.push({ buffer: 0, byteOffset: off, byteLength: b.length, target });
    off += b.length; const pad = (4 - (off % 4)) % 4; if (pad) { bin.push(Buffer.alloc(pad)); off += pad; } return views.length - 1; };
  const mat = key => {
    if (matIdx[key] != null) return matIdx[key];
    const [hex, rough, metal = .04, alpha = 1] = PALETTE[key] || PALETTE.desk, c = new THREE.Color(hex).convertSRGBToLinear();
    mats.push({ name: key, pbrMetallicRoughness: { baseColorFactor: [c.r, c.g, c.b, alpha], roughnessFactor: rough, metallicFactor: metal },
      ...(alpha < 1 ? { alphaMode: 'BLEND', doubleSided: true } : {}) });
    return (matIdx[key] = mats.length - 1);
  };
  const box = new THREE.BoxGeometry(1, 1, 1), ball = new THREE.SphereGeometry(1, 10, 8), m4 = new THREE.Matrix4();
  for (const nd of nodes) {
    const byKey = new Map();
    for (const k of nd.parts) { if (!byKey.has(k.key)) byKey.set(k.key, []); byKey.get(k.key).push(k); }
    const prims = [];
    for (const [key, parts] of byKey) {
      const pos = [], nor = [], idx = [];
      for (const k of parts) {
        const g = (k.sphere ? ball : box).clone();
        m4.compose(new THREE.Vector3(k.x, k.y, k.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, k.rot || 0, 0)), new THREE.Vector3(k.w, k.h, k.d));
        g.applyMatrix4(m4);
        const base = pos.length / 3, P = g.attributes.position.array, N = g.attributes.normal.array, I = g.index.array;
        for (let i = 0; i < P.length; i++) { pos.push(P[i]); nor.push(N[i]); }
        for (let i = 0; i < I.length; i++) idx.push(base + I[i]);
      }
      const P = new Float32Array(pos), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], P[i + a]); hi[a] = Math.max(hi[a], P[i + a]); }
      accessors.push({ bufferView: push(P, 34962), componentType: 5126, count: P.length / 3, type: 'VEC3', min: lo, max: hi });
      accessors.push({ bufferView: push(new Float32Array(nor), 34962), componentType: 5126, count: P.length / 3, type: 'VEC3' });
      accessors.push({ bufferView: push(new Uint32Array(idx), 34963), componentType: 5125, count: idx.length, type: 'SCALAR' });
      const a = accessors.length;
      prims.push({ attributes: { POSITION: a - 3, NORMAL: a - 2 }, indices: a - 1, material: mat(key) });
    }
    meshes.push({ name: nd.name, primitives: prims });
    gnodes.push({ name: nd.name, mesh: meshes.length - 1 });
  }
  const json = { asset: { version: '2.0', generator: 'make_office.cjs' }, scene: 0, scenes: [{ nodes: gnodes.map((_, i) => i) }], nodes: gnodes,
    meshes, materials: mats, accessors, bufferViews: views, buffers: [{ byteLength: off }] };
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
  const body = Buffer.concat(bin), head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + body.length, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  return Buffer.concat([head, ch(js.length, 0x4E4F534A), js, ch(body.length, 0x004E4942), body]);
}
// ---- main ----
const FLOOR = { reception: 'polished_tile', pantry: 'polished_tile', accessibleToilet: 'polished_tile', elevatorLobby: 'polished_tile',
  corridor: 'polished_tile', serviceRoom: 'polished_tile', equipmentRoom: 'polished_tile' };
function main() {
  const { THREE, list, plants } = boxes();
  const walls = list.filter(k => k.wall), objs = objects(list), occ = occupancy(walls, objs);
  const poly = ([x0, x1, z0, z1]) => [[x0, -z0], [x1, -z0], [x1, -z1], [x0, -z1], [x0, -z0]].map(p => p.map(r3));
  const rooms = ROOMS.map(r => ({ id: r.id, type: r.type, name: r.name, floor_material: FLOOR[r.type] ? 'tile' : 'carpet',
    floor_kind: FLOOR[r.type] || 'carpet', floor_z: 0, area: r3(r.rects.reduce((a, [x0, x1, z0, z1]) => a + (x1 - x0) * (z1 - z0), 0)),
    polygons: r.rects.map(poly) }));
  const wallPolys = walls.map(k => { const cs = corners(k).map(([x, z]) => [r3(x), r3(-z)]); return [...cs, cs[0]]; });
  const xs = wallPolys.flat().map(p => p[0]), ys = wallPolys.flat().map(p => p[1]);
  const lightsList = lights();
  const ir = {
    schema: 'ha.scene_ir', version: '0.1', scene_id: ID, kind: 'office', name: '办公楼层（公共建筑）',
    source: { generator: 'prototypes/indoor-space-interaction/js/office.js', converter: 'web/tools/make_office.cjs' },
    bounds: [r3(Math.min(...xs)), r3(Math.min(...ys)), r3(Math.max(...xs)), r3(Math.max(...ys))],
    rooms, walls: { polygons: wallPolys }, doors: doorways(), windows: [],
    objects: objs.map(({ parts, ...o }) => ({ ...o, prim_path: '/office/' + o.id, world_matrix: null })),
    lights: lightsList, lights_excluded: [],
    occupancy: { file: 'occupancy.npz', grid: { x0: X0, y0: Y0, width: occ.cols, height: occ.rows, res: RES }, layers: LAYERS,
      labels: occ.labels.length, room_index: ROOMS.map(r => r.id) },
    report: { missing_refs: [], warnings: [], counts: { rooms: rooms.length, doors: 0, windows: 0, objects: objs.length, lights: lightsList.length, lights_excluded: 0 } },
  };
  ir.report.counts.doors = ir.doors.length;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'scene_ir.json'), JSON.stringify(ir, null, 1));
  const n = occ.rows * occ.cols;
  fs.writeFileSync(path.join(OUT, 'occupancy.npz'), zip({
    'floor_h.npy': npy('<f4', [occ.rows, occ.cols], new Float32Array(n)),
    'labels.npy': strings(occ.labels),
    'spec.npy': npy('<f8', [5], new Float64Array([X0, Y0, occ.cols, occ.rows, RES])),
    'layer_toe.npy': npy('<i4', [occ.rows, occ.cols], occ.layer.toe),
    'layer_body.npy': npy('<i4', [occ.rows, occ.cols], occ.layer.body),
    'layer_head.npy': npy('<i4', [occ.rows, occ.cols], occ.layer.head),
    'extra_room.npy': npy('<i2', [occ.rows, occ.cols], occ.room),
  }));
  // Display GLB: walls, ground (floor slabs and floor markings), one node per object; foliage joins the nearest plant.
  const nodes = [{ name: 'wall', parts: walls }, { name: 'ground', parts: list.filter(k => !k.wall && SKIP(k)) }];
  const byObj = objs.map(o => ({ name: o.id, parts: [...o.parts] }));
  const pots = objs.map((o, i) => [o, i]).filter(([o]) => o.category === 'plant');
  for (const s of plants) {
    if (!pots.length) break;
    const [, i] = pots.reduce((a, b) => (Math.hypot(centreXZ(b[0])[0] - s.x, centreXZ(b[0])[1] - s.z) < Math.hypot(centreXZ(a[0])[0] - s.x, centreXZ(a[0])[1] - s.z) ? b : a));
    byObj[i].parts.push({ key: 'plant', sphere: true, x: s.x, y: s.y, z: s.z, w: s.sx, h: s.sy, d: s.sz, rot: 0 });
  }
  fs.writeFileSync(path.join(OUT, ID + '.glb'), glb(THREE, [...nodes, ...byObj]));
  const cats = {}; objs.forEach(o => { cats[o.category] = (cats[o.category] || 0) + 1; });
  console.log('wrote', path.relative(ROOT, OUT), { walls: walls.length, objects: objs.length, cats, doors: ir.doors.length, lights: lightsList.length, grid: [occ.rows, occ.cols] });
}
const centreXZ = o => [(o.aabb.min[0] + o.aabb.max[0]) / 2, -(o.aabb.min[1] + o.aabb.max[1]) / 2];
if (require.main === module) main();
