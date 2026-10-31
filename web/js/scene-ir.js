/* 3D view built from Scene IR (white model), optional GLB on top, residents, trajectories, picking.
   IR (x, y, z) maps to three.js (x, z, -y), the same convention as ha.ir.export_glb. */
(() => {
  'use strict';
  const HA = window.HA = window.HA || {};
  const V = (x, y, z = 0) => new THREE.Vector3(x, z, -y);
  const WALL_H = 2.7, CUT_H = 1.15;
  const ROOM_COLOR = { livingRoom: '#eef2f6', masterBedroom: '#f1efe9', guestBedroom: '#f1efe9', bathroom: '#e6eef3', kitchen: '#eef0e8', corridor: '#f2f3f4', balcony: '#ecefe9' };
  const OBJ_COLOR = { bed: '#c8d3e2', sofa: '#b6c4d8', toilet: '#ffffff', wardrobe: '#a8b6c9', diningtable: '#c9b9a3', coffeetable: '#c9b9a3', TVStand: '#b3a690', bathroomcabinet: '#dfe6ec' };
  const SKIP = new Set(['lightfixture', 'book', 'cosmeticbottle', 'vase', 'switch', 'showerhead']);

  function mat(color, extra) {
    return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.8, metalness: 0.0 }, extra));
  }

  // IR polygon [[x,y],...] -> horizontal prism from z0 to z1 (three.js coordinates).
  function prism(points, z0, z1) {
    const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p[0], p[1])));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, z1 - z0), bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, z0, 0);
    return geo;
  }

  function flat(points, z) {
    const geo = new THREE.ShapeGeometry(new THREE.Shape(points.map(p => new THREE.Vector2(p[0], p[1]))));
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, z, 0);
    return geo;
  }

  function textSprite(text, color = '#41505f', size = 0.55) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    g.font = '600 56px "PingFang SC","Microsoft YaHei",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = color; g.fillText(text, 256, 64);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    s.scale.set(size * 4, size, 1); s.renderOrder = 10;
    return s;
  }

  // Greedy rectangles over wall cells of the body layer, as one InstancedMesh.
  function wallMesh(occ) {
    const { rows, cols, body, res, x0, y0 } = occ;
    const wall = occ.labels.indexOf('wall');
    const used = new Uint8Array(rows * cols), rects = [];
    const isWall = (i, j) => body[i * cols + j] === wall && !used[i * cols + j];
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      if (!isWall(i, j)) continue;
      let w = 1; while (j + w < cols && isWall(i, j + w)) w++;
      let h = 1;
      outer: while (i + h < rows) { for (let k = 0; k < w; k++) if (!isWall(i + h, j + k)) break outer; h++; }
      for (let a = 0; a < h; a++) for (let k = 0; k < w; k++) used[(i + a) * cols + j + k] = 1;
      rects.push([j, i, w, h]);
    }
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat('#fbfbfa'), rects.length);
    const m = new THREE.Matrix4();
    rects.forEach(([j, i, w, h], n) => {
      const cx = x0 + (j + w / 2) * res, cy = y0 + (i + h / 2) * res;
      m.compose(V(cx, cy, WALL_H / 2), new THREE.Quaternion(), new THREE.Vector3(w * res, WALL_H, h * res));
      mesh.setMatrixAt(n, m);
    });
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }

  function buildScene(ir, occ) {
    const root = new THREE.Group(), pick = [], byId = {};
    const floors = new THREE.Group(), labels = new THREE.Group(), objects = new THREE.Group(), doors = new THREE.Group(), sweeps = new THREE.Group();
    for (const r of ir.rooms) {
      for (const poly of r.polygons) {
        const m = new THREE.Mesh(flat(poly, 0.002), mat(ROOM_COLOR[r.type] || '#f0f2f4'));
        m.receiveShadow = true; m.userData = { kind: 'room', id: r.id }; floors.add(m);
      }
      const p = r.polygons[0], cx = p.reduce((s, q) => s + q[0], 0) / p.length, cy = p.reduce((s, q) => s + q[1], 0) / p.length;
      const s = textSprite(HA.text.room(r.type), '#41505f', 0.42); s.position.copy(V(cx, cy, 0.05)); s.userData.roomId = r.id; labels.add(s);
    }
    const walls = wallMesh(occ);
    walls.scale.y = 1;
    for (const o of ir.objects) {
      if (SKIP.has(o.category) || !o.footprint || o.footprint.length < 3) continue;
      const [z0, z1] = o.z_range || [o.aabb.min[2], o.aabb.max[2]];
      const m = new THREE.Mesh(prism(o.footprint, z0, Math.min(z1, 2.4)), mat(OBJ_COLOR[o.category] || '#c4cfdc'));
      m.castShadow = m.receiveShadow = true;
      m.userData = { kind: 'object', id: o.id, base: m.material.color.clone() };
      objects.add(m); pick.push(m); byId[o.id] = m;
    }
    for (const d of ir.doors) {
      const g = new THREE.Group(); g.userData = { kind: 'door', id: d.id };
      for (const leaf of d.leaves || []) {
        const poly = leaf.open || leaf.closed;
        if (poly) {
          const m = new THREE.Mesh(prism(poly, 0, 2.05), mat('#b89c7a'));
          m.castShadow = true; m.userData = { kind: 'door', id: d.id, base: m.material.color.clone() };
          g.add(m); pick.push(m);
        }
        if (leaf.sweep) {
          const s = new THREE.Mesh(flat(leaf.sweep, 0.012), new THREE.MeshBasicMaterial({ color: '#f2a33a', transparent: true, opacity: 0.35, depthWrite: false }));
          sweeps.add(s);
        }
      }
      doors.add(g); byId[d.id] = g;
    }
    for (const w of ir.windows) {
      const a = w.aabb;
      const m = new THREE.Mesh(new THREE.BoxGeometry(a.max[0] - a.min[0], a.max[2] - a.min[2], a.max[1] - a.min[1]),
        mat('#9cc6e6', { transparent: true, opacity: 0.45 }));
      m.position.copy(V((a.min[0] + a.max[0]) / 2, (a.min[1] + a.max[1]) / 2, (a.min[2] + a.max[2]) / 2));
      root.add(m);
    }
    sweeps.visible = false;
    root.add(floors, walls, objects, doors, sweeps, labels);
    return { root, pick, byId, walls, labels, sweeps, objects };
  }

  HA.sceneBuild = { buildScene, V, textSprite, mat, flat, WALL_H, CUT_H };
})();
