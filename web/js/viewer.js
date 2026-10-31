/* three.js viewer: renderer, post-processing, styles (real / diag), views (plan / bird / follow / fp / walk), picking, marks.
   Camera moves go through camera-controls so every transition is smooth and can be skipped for reduced motion. */
(() => {
  'use strict';
  const HA = window.HA = window.HA || {};
  const { V, WALL_H, CUT_H } = HA.sceneBuild;
  const RED = new THREE.Color('#D7263D'), PURPLE = new THREE.Color('#660874');
  const DIAG = { wall: '#FBFAF8', ground: '#E4E1DA', door: '#E2DED6', object: '#F3F1EC' };
  const VIEWS = ['plan', 'bird', 'follow', 'fp', 'walk'];
  // camera-controls keeps ACTION internal in the bundled ESM build.
  const ACTION = { ROTATE: 1, TRUCK: 2, DOLLY: 16, TOUCH_TRUCK: 128, TOUCH_DOLLY: 1024 };

  function create(el, ir, occ) {
    const { CameraControls, RoomEnvironment } = HA.lib;
    const renderer = new THREE.WebGLRenderer({ antialias: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, HA.config.quality === 'high' ? 2 : 1.5));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
    // Tone mapping is handled once by the post-processing pass. Applying AgX here
    // as well makes the real material pass look flat and grey.
    renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.localClippingEnabled = true;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#ECEAE6');
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; pmrem.dispose();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    const controls = new CameraControls(camera, renderer.domElement);
    controls.maxPolarAngle = Math.PI * 0.49; controls.smoothTime = 0.45; controls.draggingSmoothTime = 0.08; controls.dollyToCursor = true;

    const [bx0, by0, bx1, by1] = ir.bounds, cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, span = Math.max(bx1 - bx0, by1 - by0);
    controls.minDistance = 1; controls.maxDistance = span * 3;
    const hemi = new THREE.HemisphereLight('#fff4e6', '#8a8070', 1.0);
    const sun = new THREE.DirectionalLight('#fff1dc', 2.4);
    sun.position.copy(V(cx - 4, cy - 6, 12)); sun.target.position.copy(V(cx, cy, 0));
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 4; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 40 });
    scene.add(hemi, sun, sun.target);

    const built = HA.sceneBuild.buildScene(ir, occ);
    scene.add(built.root);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 4, span * 4), HA.sceneBuild.mat('#dcd9d3'));
    ground.rotation.x = -Math.PI / 2; ground.position.copy(V(cx, cy, -0.01)); ground.receiveShadow = true; scene.add(ground);
    const fx = HA.fx.create(renderer, scene, camera);

    // One clip plane shared by walls, doors and windows: y < CUT_H when cut, otherwise far above the house.
    const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e3), clipped = [cutPlane];
    built.walls.material.clippingPlanes = clipped;
    built.doors.traverse(m => { if (m.isMesh) m.material.clippingPlanes = clipped; });
    const cutHide = new Set(ir.objects.filter(o => o.category === 'lightfixture').map(o => o.id));

    const v = {
      renderer, scene, camera, controls, built, ir, fx, center: [cx, cy], span,
      view: 'plan', style: 'real', pose: null, eye: 1.2, split: null, insets: { left: 0, right: 0 },
      marks: new Map(), onFrame: [], onPick: null, onView: null, glb: null, glbById: {},
    };
    const smooth = () => !HA.reducedMotion.matches;
    v.shadowsDirty = () => { renderer.shadowMap.needsUpdate = true; };

    v.setWallCut = cut => {
      cutPlane.constant = cut ? CUT_H : 1e3;
      for (const id of cutHide) if (v.glbById[id]) v.glbById[id].visible = !cut;
    };
    v.home = (anim = true, bird = false) => {
      const p = V(cx, cy - v.span * 0.55, v.span * 1.15), t = V(cx, cy, 0);
      const q = bird ? p : V(cx, cy, v.span * 1.35);
      controls.setLookAt(q.x, q.y, q.z, t.x, t.y, t.z, anim && smooth());
    };
    const setControlsFor = name => {
      controls.enabled = name === 'plan' || name === 'bird';
      if (name === 'plan') {
        controls.mouseButtons.left = ACTION.TRUCK;
        controls.mouseButtons.right = ACTION.TRUCK;
        controls.mouseButtons.middle = ACTION.DOLLY;
      } else if (name === 'bird') {
        controls.mouseButtons.left = ACTION.ROTATE;
        controls.mouseButtons.right = ACTION.TRUCK;
        controls.mouseButtons.middle = ACTION.DOLLY;
      }
      controls.touches.one = ACTION.TOUCH_TRUCK;
      controls.touches.two = ACTION.TOUCH_DOLLY;
      controls.touches.three = ACTION.TOUCH_TRUCK;
    };
    v.setView = name => {
      if (!VIEWS.includes(name)) return;
      if (name === 'walk' && v.view !== 'walk') { v.prevView = v.view; startWalk(); }
      v.view = name; setControlsFor(name);
      controls.maxPolarAngle = name === 'plan' || name === 'bird' ? Math.PI * 0.49 : Math.PI;
      v.setWallCut(name === 'plan' || name === 'bird' || name === 'follow');
      built.labels.visible = name === 'plan' || name === 'bird';
      if (name === 'plan') v.home();
      if (name === 'bird') v.home(true, true);
      if (v.onView) v.onView(name);
    };

    v.flyTo = (x, y, dist = 4.5) => {
      if (v.view !== 'plan' && v.view !== 'bird') v.setView('bird');
      const p = V(x, y - dist * 0.6, dist), t = V(x, y, 0);
      controls.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, smooth());
    };

    // Meshes that show object `id` in the current style: IR prisms, or the GLB node of the same name.
    const meshesOf = id => {
      const out = [], o = v.glb ? v.glbById[id] : built.byId[id];
      if (o) o.traverse(m => { if (m.isMesh && m.material.emissive) out.push(m); });
      return out;
    };
    const paint = (id, kind) => meshesOf(id).forEach(m => {
      m.material.emissive.copy(kind ? (kind === 'red' ? RED : PURPLE) : new THREE.Color(0));
      m.material.emissiveIntensity = kind ? 0.55 : 0;
    });
    v.mark = (id, kind) => {
      if (!built.byId[id]) return;
      paint(id, kind);
      if (kind) v.marks.set(id, kind); else v.marks.delete(id);
    };
    v.clearMarks = () => [...v.marks.keys()].forEach(id => v.mark(id, null));
    v.flash = id => {
      v.mark(id, 'red');
      setTimeout(() => { if (v.marks.get(id) === 'red' && !v.keepRed?.has(id)) v.mark(id, null); }, 700);
    };

    let tag = null;
    v.tag = (text, x, y) => {
      if (tag) { scene.remove(tag); tag.material.map.dispose(); tag = null; }
      if (!text) return;
      tag = HA.sceneBuild.textSprite(text, '#D7263D', 0.2); tag.position.copy(V(x, y, 1.6)); scene.add(tag);
    };

    // Styles change materials and post-processing only, never geometry or picking.
    v.setStyle = name => {
      v.style = name; fx.setStyle(name);
      scene.environmentIntensity = name === 'diag' ? 0.9 : 0.5;
      hemi.intensity = name === 'diag' ? 1.4 : 0.7; sun.intensity = name === 'diag' ? 1.2 : 2.4;
      renderer.toneMappingExposure = name === 'diag' ? 1 : 1.05;
      if (v.glb) v.glb.traverse(m => { if (m.isMesh && m.userData.realMat) m.material = name === 'diag' ? m.userData.diagMat : m.userData.realMat; });
      v.marks.forEach((kind, id) => paint(id, kind));
    };

    // GLB on top of the IR model. Top-level node names equal IR ids; IR meshes stay hidden but pickable.
    const topNode = (root, m) => { while (m.parent && m.parent !== root) m = m.parent; return m; };
    const kindOf = name => (name === 'wall' || name === 'windows' || name === 'ground' ? name
      : (built.byId[name] && built.byId[name].userData.kind) || 'object');
    v.loadGLB = url => new Promise((ok, bad) => new THREE.GLTFLoader().load(url, g => {
      const root = g.scene;
      root.children.forEach(n => { v.glbById[n.name] = n; });
      root.traverse(m => {
        if (!m.isMesh) return;
        const kind = kindOf(topNode(root, m).name), cut = kind === 'wall' || kind === 'windows' || kind === 'door';
        m.castShadow = kind !== 'ground'; m.receiveShadow = true;
        const real = m.material.clone();
        const diag = kind === 'windows'
          ? new THREE.MeshStandardMaterial({ color: '#bcd3e0', roughness: 0.1, transparent: true, opacity: 0.35, depthWrite: false })
          : new THREE.MeshStandardMaterial({ color: DIAG[kind] || DIAG.object, roughness: 0.9 });
        if (cut) real.clippingPlanes = diag.clippingPlanes = clipped;
        if (cut) real.side = diag.side = THREE.DoubleSide;
        Object.assign(m.userData, { realMat: real, diagMat: diag });
      });
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root), center = box.getCenter(new THREE.Vector3());
      const target = V(cx, cy, 0);
      root.position.x += target.x - center.x;
      root.position.z += target.z - center.z;
      root.position.y += -box.min.y;
      root.updateMatrixWorld(true);
      // Use the actual imported bounds for framing. Product scenes often include
      // a larger footprint than the IR preview, so the fixed IR span can crop them.
      const size = box.getSize(new THREE.Vector3());
      v.span = Math.max(v.span, size.x, size.z);
      controls.maxDistance = v.span * 3;
      scene.add(root);
      for (const k of ['objects', 'walls', 'floors', 'doors', 'windows']) built[k].visible = false;
      v.glb = root; v.setStyle(v.style); v.setWallCut(cutPlane.constant < 1e2);
      if (v.view === 'plan' || v.view === 'bird') v.home(false, v.view === 'bird');
      v.shadowsDirty();
      ok(root);
    }, undefined, bad));

    // Picking: a click is a pointer press that moved less than 4 px.
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let down = null;
    renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY, e.clientX]; });
    renderer.domElement.addEventListener('pointermove', e => {
      if (!down || v.view !== 'walk' || !v.walk) return;
      v.walk.yaw -= (e.clientX - down[2]) * 0.004; down[2] = e.clientX;
      v.walk.pitch = Math.max(-0.6, Math.min(0.5, v.walk.pitch - e.movementY * 0.003));
    });
    window.addEventListener('pointerup', e => {
      const d = down; down = null;
      if (!d || e.target !== renderer.domElement || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 4 || !v.onPick) return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(built.pick, false)[0];
      v.onPick(hit ? hit.object.userData : null, hit ? [hit.point.x, -hit.point.z] : null);
    });

    // Walk (步入): keyboard and drag, blocked by solid cells of the body layer (doors are passable).
    const doorIdx = new Set(); occ.labels.forEach((s, i) => { if (s.startsWith('door:')) doorIdx.add(i); });
    const solidAt = (x, y) => {
      const j = Math.floor((x - occ.x0) / occ.res), i = Math.floor((y - occ.y0) / occ.res);
      if (i < 0 || j < 0 || i >= occ.rows || j >= occ.cols) return true;
      const b = occ.body[i * occ.cols + j];
      return b >= 0 && !doorIdx.has(b);
    };
    const free = (x, y, r = 0.18) => ![[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].some(([a, b]) => solidAt(x + a, y + b));
    const keys = new Set(), MOVE = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    function startWalk() { const p = v.pose || [cx, cy, Math.PI / 2]; v.walk = { x: p[0], y: p[1], yaw: p[2], pitch: -0.08 }; keys.clear(); }
    window.addEventListener('keydown', e => {
      if (v.view !== 'walk' || e.target.tagName === 'INPUT') return;
      if (e.code === 'Escape') { v.setView(v.prevView || 'plan'); return; }
      if (MOVE.includes(e.code)) { keys.add(e.code); e.preventDefault(); e.stopPropagation(); }
    }, true);
    window.addEventListener('keyup', e => keys.delete(e.code));
    window.addEventListener('keydown', e => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (v.view === 'bird') controls.mouseButtons.left = ACTION.TRUCK;
      }
    });
    window.addEventListener('keyup', e => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (v.view === 'bird') controls.mouseButtons.left = ACTION.ROTATE;
      }
    });
    function stepWalk(dt) {
      const w = v.walk, k = c => (keys.has(c) ? 1 : 0);
      w.yaw += (k('ArrowLeft') + k('KeyA') - k('ArrowRight') - k('KeyD')) * 1.6 * dt;
      const s = (k('ArrowUp') + k('KeyW') - k('ArrowDown') - k('KeyS')) * 1.1 * dt;
      const nx = w.x + Math.cos(w.yaw) * s, ny = w.y + Math.sin(w.yaw) * s;
      if (free(nx, w.y)) w.x = nx;
      if (free(w.x, ny)) w.y = ny;
    }

    function placeCamera(pose, anim, viewName = v.view, force = false) {
      if (viewName === 'plan') {
        const q = V(cx, cy, v.span * 1.35), t = V(cx, cy, 0);
        controls.setLookAt(q.x, q.y, q.z, t.x, t.y, t.z, anim && smooth());
        return;
      }
      if (viewName === 'bird' && !force) return;
      if (viewName === 'bird') {
        const q = V(cx, cy - v.span * 0.55, v.span * 1.15), t = V(cx, cy, 0);
        controls.setLookAt(q.x, q.y, q.z, t.x, t.y, t.z, anim && smooth());
        return;
      }
      let p, t;
      if (viewName === 'walk') {
        const w = v.walk, c = Math.cos(w.pitch);
        p = V(w.x, w.y, v.eye); t = V(w.x + Math.cos(w.yaw) * c * 2, w.y + Math.sin(w.yaw) * c * 2, v.eye + Math.sin(w.pitch) * 2);
      } else {
        if (!pose) return;
        const [x, y, yaw] = pose, f = [Math.cos(yaw), Math.sin(yaw)];
        if (viewName === 'follow') { p = V(x - f[0] * 3.2, y - f[1] * 3.2, 4.4); t = V(x + f[0] * 0.6, y + f[1] * 0.6, 0.4); }
        else { p = V(x - f[0] * 0.15, y - f[1] * 0.15, v.eye); t = V(x + f[0] * 2, y + f[1] * 2, v.eye - 0.25); anim = false; }
      }
      controls.maxPolarAngle = Math.PI;
      controls.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, anim && smooth());
    }

    // Floating panels cover the canvas edges; shift the projection so the scene centres in the free area.
    // The shift eases with the panel slide (0.3 s) unless reduced motion is on.
    v.setInsets = (left, right) => { v.insets = { left, right }; };
    let dxNow = 0;
    function applyOffset(w, h, dt) {
      // CameraControls and WebGL view offsets use the opposite screen-space sign:
      // a right rail reduces the free area to the left, so the scene must move left.
      // setViewOffset uses drawing-buffer pixels, while panel measurements are CSS pixels.
      const dpr = w / Math.max(1, el.clientWidth);
      const dx = (v.insets.right - v.insets.left) * dpr / 2;
      dxNow = smooth() ? dxNow + (dx - dxNow) * Math.min(1, dt * 10) : dx;
      if (Math.abs(dxNow - dx) < 0.5) dxNow = dx;
      if (dxNow) camera.setViewOffset(w, h, dxNow, 0, w, h); else camera.clearViewOffset();
    }

    function resize() { fx.setSize(el.clientWidth, el.clientHeight); }
    new ResizeObserver(resize).observe(el); resize();

    let last = performance.now();
    function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      v.onFrame.forEach(f => f(dt));
      if (v.view === 'walk') stepWalk(dt);
      if (v.view === 'plan') controls.maxPolarAngle = Math.PI * 0.49;
      const w = el.clientWidth, h = el.clientHeight;
      const drawing = renderer.getDrawingBufferSize(new THREE.Vector2());
      const rw = drawing.x, rh = drawing.y;
      if (v.split) {
        renderer.setScissorTest(true);
        v.split.forEach((side, i) => {
          side.apply();
          placeCamera(side.pose && side.pose(), false, v.view === 'walk' ? 'bird' : v.view, true); controls.update(0);
          camera.clearViewOffset(); camera.aspect = (rw / 2) / rh; camera.updateProjectionMatrix();
          renderer.setViewport(i * rw / 2, 0, rw / 2, rh); renderer.setScissor(i * rw / 2, 0, rw / 2, rh);
          renderer.render(scene, camera);
        });
        renderer.setScissorTest(false); renderer.setViewport(0, 0, rw, rh);
      } else {
        camera.aspect = w / h; camera.updateProjectionMatrix();
        // Plan and bird views retain their user framing. Follow / first-person / walk
        // are driven by the resident pose every frame.
        if (v.view !== 'plan' && v.view !== 'bird') placeCamera(v.pose, true);
        controls.update(dt);
        applyOffset(rw, rh, dt); camera.updateProjectionMatrix();
        fx.render(dt);
      }
      requestAnimationFrame(frame);
    }
    v.home(false); v.setView('plan'); v.setStyle(HA.config.style); v.shadowsDirty();
    requestAnimationFrame(frame);
    return v;
  }

  HA.viewer = { create };
})();
