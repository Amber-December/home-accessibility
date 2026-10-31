/* Resident marker (evaluator footprint + simple body), trajectory line, plan preview on the scene. */
(() => {
  'use strict';
  const HA = window.HA = window.HA || {};
  const { V, mat } = HA.sceneBuild;

  // Body faces +x in IR, so rotation.y = yaw.
  function marker(p) {
    const g = new THREE.Group(), f = p.footprint, seated = p.id === 'wheelchair';
    const plate = f.shape === 'rect'
      ? new THREE.BoxGeometry(f.size[1], 0.02, f.size[0])
      : new THREE.CylinderGeometry(f.r, f.r, 0.02, 40);
    const fp = new THREE.Mesh(plate, new THREE.MeshBasicMaterial({ color: '#660874', transparent: true, opacity: 0.28, depthWrite: false }));
    fp.position.y = 0.03; g.add(fp);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(plate), new THREE.LineBasicMaterial({ color: '#660874' }));
    edge.position.y = 0.03; g.add(edge);
    const skin = mat('#f4f6f9'), dark = mat('#4b5b70');
    if (seated) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), dark); seat.position.set(-0.05, 0.5, 0); g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.5), dark); back.position.set(-0.3, 0.78, 0); g.add(back);
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.025, 8, 24), dark);
        w.position.set(-0.1, 0.3, s * 0.3); g.add(w);
      }
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.55, 16), skin); torso.position.set(-0.08, 0.85, 0); g.add(torso);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skin); head.position.set(-0.06, 1.24, 0); g.add(head);
    } else {
      const h = p.id === 'walking_control' ? 1.0 : 0.95;
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, h * 0.75, 16), skin); torso.position.y = h * 0.95; g.add(torso);
      const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, h * 0.6, 12), dark); legs.position.y = h * 0.3; g.add(legs);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skin); head.position.y = h * 1.45; g.add(head);
      if (p.id === 'walker_elder') {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.85, 0.55), dark); frame.position.set(0.28, 0.43, 0); g.add(frame);
      }
    }
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 12), mat('#660874'));
    nose.rotation.z = -Math.PI / 2; nose.position.set((f.size ? f.size[1] / 2 : f.r) + 0.06, 0.05, 0); g.add(nose);
    g.userData = { fp, edge };
    g.setPose = (x, y, yaw) => { g.position.copy(V(x, y, 0)); g.rotation.y = yaw; };
    g.setState = s => { const c = s === 'fail' ? '#D7263D' : '#660874'; fp.material.color.set(c); edge.material.color.set(c); };
    return g;
  }

  // Trajectory as a line; drawn up to the current sample.
  function trail(traj, color = '#660874') {
    const pos = new Float32Array(Math.max(1, traj.length) * 3);
    traj.forEach((q, i) => { const p = V(q[1], q[2], 0.06); pos.set([p.x, p.y, p.z], i * 3); });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
    const ghost = new THREE.Line(geo, new THREE.LineDashedMaterial({ color, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.45 }));
    ghost.computeLineDistances();
    const g = new THREE.Group(); g.add(ghost, line);
    g.upTo = n => geo.setDrawRange(0, Math.max(0, n));
    return g;
  }

  // Pose at time t (linear interpolation, yaw from the nearer sample).
  function poseAt(traj, t) {
    if (!traj.length) return null;
    if (t <= traj[0][0]) return { x: traj[0][1], y: traj[0][2], yaw: traj[0][3], i: 0 };
    let lo = 0, hi = traj.length - 1;
    if (t >= traj[hi][0]) return { x: traj[hi][1], y: traj[hi][2], yaw: traj[hi][3], i: hi };
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (traj[mid][0] <= t) lo = mid; else hi = mid; }
    const a = traj[lo], b = traj[hi], k = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
    return { x: a[1] + (b[1] - a[1]) * k, y: a[2] + (b[2] - a[2]) * k, yaw: k < 0.5 ? a[3] : b[3], i: lo + 1 };
  }

  // 素材库 product models, loaded once per URL.
  const models = {};
  const model = url => (models[url] = models[url] || new Promise((ok, bad) => new THREE.GLTFLoader().load(url, g => ok(g.scene), undefined, bad)));

  // A catalog product at edit.place: its model scaled to the listed size, front facing place.front.
  // Product models face +z, so a plan front (fx, fy), which is (fx, 0, -fy) in the scene, needs yaw atan2(fx, -fy).
  function placeProduct(v, e, floor, token) {
    const [W, D, H] = e.product.size_m, [cx, cy] = e.place.center, [fx, fy] = e.place.front;
    const g = new THREE.Group();
    g.position.set(cx, floor, -cy); g.rotation.y = Math.atan2(fx, -fy);
    v.ghosts.add(g);
    const fit = m => {
      const b = new THREE.Box3().setFromObject(m), size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      const k = new THREE.Vector3(W / size.x, H / size.y, D / size.z);
      m.scale.multiply(k); m.position.set(-c.x * k.x, -b.min.y * k.y, -c.z * k.z);
      m.traverse(x => { if (x.isMesh) { x.castShadow = x.receiveShadow = true; } });
      g.add(m); if (v.shadowsDirty) v.shadowsDirty();
    };
    if (!e.product.glb) return fit(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat('#C7A6DE')));
    model(e.product.glb).then(src => { if (v.ghostToken === token) fit(src.clone(true)); })
      .catch(err => console.warn('product GLB', e.product.glb, err));
  }

  // Apply plan edits to the scene. mode: 'preview' (red ghost at the old place) | 'after' | null (reset).
  // Edits act on both the IR prism and the GLB node of the same id: remove hides, move shifts, replace with a catalog
  // product hides the old piece and shows the product model; other replaces shrink the footprint by shrink_m on each
  // side around its centre. Door edits only get marked.
  function applyPlan(v, edits, mode) {
    v.planArgs = [edits, mode];  // app-boot reapplies it when the scene GLB finishes loading after the plan was shown
    v.ghosts = v.ghosts || new THREE.Group();
    if (!v.ghosts.parent) v.scene.add(v.ghosts);
    v.ghosts.clear();
    const token = v.ghostToken = (v.ghostToken || 0) + 1;
    (v.edited || []).forEach(n => { n.visible = true; n.position.copy(n.userData.pos0); n.scale.set(1, 1, 1); });
    v.edited = [];
    if (mode) {
      for (const e of edits || []) {
        if (e.op.startsWith('door_')) continue;
        const prism = v.built.byId[e.object_id];
        if (mode === 'preview' && prism && prism.geometry) {
          v.ghosts.add(new THREE.Mesh(prism.geometry, new THREE.MeshBasicMaterial({ color: '#D7263D', transparent: true, opacity: 0.25, depthWrite: false })));
        }
        for (const n of [prism, v.glbById[e.object_id]].filter(Boolean)) {
          if (!n.userData.pos0) { n.userData.pos0 = n.position.clone(); n.userData.box0 = new THREE.Box3().setFromObject(n); }
          v.edited.push(n);
          if (e.op === 'remove') n.visible = false;
          if (e.op === 'move') n.position.add(V(e.dx, e.dy, 0));
          if (e.op === 'replace' && e.place) n.visible = false;
          else if (e.op === 'replace') {
            const b = n.userData.box0, c = b.getCenter(new THREE.Vector3()), d = b.getSize(new THREE.Vector3());
            const sx = Math.max(0.3, 1 - 2 * e.shrink_m / d.x), sz = Math.max(0.3, 1 - 2 * e.shrink_m / d.z);
            n.scale.set(sx, 1, sz);
            n.position.set(c.x + (n.userData.pos0.x - c.x) * sx, n.userData.pos0.y, c.z + (n.userData.pos0.z - c.z) * sz);
          }
        }
        if (e.op === 'replace' && e.place && prism) placeProduct(v, e, prism.userData.box0.min.y, token);
      }
    }
    if (v.shadowsDirty) v.shadowsDirty();
  }

  HA.resident = { marker, trail, poseAt, applyPlan };
})();
