/* three.js viewer: renderer, cameras (top / follow / first person), picking, highlights, split rendering. */
(() => {
  'use strict';
  const HA = window.HA = window.HA || {};
  const { V, WALL_H, CUT_H } = HA.sceneBuild;
  const BLUE = new THREE.Color('#2f7cf6'), RED = new THREE.Color('#e5484d');

  function create(el, ir, occ) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, HA.config.quality === 'high' ? 2 : 1.5));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#e9edf2');
    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49;

    scene.add(new THREE.HemisphereLight('#ffffff', '#c9d2dc', 0.75));
    const [bx0, by0, bx1, by1] = ir.bounds, cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, span = Math.max(bx1 - bx0, by1 - by0);
    const sun = new THREE.DirectionalLight('#ffffff', 0.6);
    sun.position.copy(V(cx - 4, cy - 6, 12)); sun.target.position.copy(V(cx, cy, 0));
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 40 });
    scene.add(sun, sun.target);

    const built = HA.sceneBuild.buildScene(ir, occ);
    scene.add(built.root);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 4, span * 4), HA.sceneBuild.mat('#dde3ea'));
    ground.rotation.x = -Math.PI / 2; ground.position.copy(V(cx, cy, -0.01)); ground.receiveShadow = true; scene.add(ground);

    const v = {
      renderer, scene, camera, controls, built, ir, center: [cx, cy], span,
      view: 'top', pose: null, eye: 1.2, split: null, marks: new Map(), onFrame: [], onPick: null,
    };

    v.setWallCut = cut => { built.walls.scale.y = cut ? CUT_H / WALL_H : 1; };
    v.home = () => {
      camera.position.copy(V(cx, cy - span * 0.55, span * 1.15)); controls.target.copy(V(cx, cy, 0)); controls.update();
    };
    v.setView = name => {
      v.view = name; controls.enabled = name === 'top';
      v.setWallCut(name !== 'fp');
      built.labels.visible = name === 'top';
      if (name === 'top') v.home();
    };

    // Smooth camera move to look at IR point (x, y).
    let fly = null;
    v.flyTo = (x, y, dist = 4.5) => {
      if (v.view !== 'top') v.setView('top');
      fly = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(),
        p1: V(x, y - dist * 0.6, dist), t1: V(x, y, 0) };
    };

    v.mark = (id, kind) => {
      const o = built.byId[id]; if (!o) return;
      o.traverse(m => {
        if (!m.isMesh || !m.userData.base) return;
        m.material.emissive = kind ? (kind === 'red' ? RED : BLUE).clone() : new THREE.Color(0);
        m.material.emissiveIntensity = kind ? 0.55 : 0;
      });
      if (kind) v.marks.set(id, kind); else v.marks.delete(id);
    };
    v.clearMarks = () => [...v.marks.keys()].forEach(id => v.mark(id, null));
    v.flash = id => {
      v.mark(id, 'red');
      setTimeout(() => { if (v.marks.get(id) === 'red' && !v.keepRed?.has(id)) v.mark(id, null); }, 700);
    };

    // Floating label in 3D, e.g. "实测 0.68 m / 要求 0.70 m".
    let tag = null;
    v.tag = (text, x, y) => {
      if (tag) { scene.remove(tag); tag.material.map.dispose(); tag = null; }
      if (!text) return;
      tag = HA.sceneBuild.textSprite(text, '#c0262d', 0.2); tag.position.copy(V(x, y, 1.6)); scene.add(tag);
    };

    // Optional GLB on top of the white model; IR meshes stay for picking but are hidden.
    v.loadGLB = url => new Promise((ok, bad) => new THREE.GLTFLoader().load(url, g => {
      g.scene.traverse(m => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; } });
      scene.add(g.scene);
      built.objects.children.forEach(m => { m.material.transparent = true; m.material.opacity = 0; m.castShadow = false; });
      built.walls.visible = false;
      v.glb = g.scene; ok(g.scene);
    }, undefined, bad));

    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let down = null;
    renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4 || !v.onPick) return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(built.pick, false)[0];
      const p = hit ? hit.point : null;
      v.onPick(hit ? hit.object.userData : null, p ? [p.x, -p.z] : null);
    });

    function resize() {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
    }
    new ResizeObserver(resize).observe(el); resize();

    function placeCamera(pose) {
      if (!pose || v.view === 'top') return;
      const [x, y, yaw] = pose, f = [Math.cos(yaw), Math.sin(yaw)];
      if (v.view === 'follow') {
        const want = V(x - f[0] * 3.2, y - f[1] * 3.2, 4.4);
        camera.position.lerp(want, 0.06); controls.target.lerp(V(x + f[0] * 0.6, y + f[1] * 0.6, 0.4), 0.12);
        camera.lookAt(controls.target);
      } else {
        camera.position.copy(V(x - f[0] * 0.15, y - f[1] * 0.15, v.eye));
        controls.target.copy(V(x + f[0] * 2, y + f[1] * 2, v.eye - 0.25)); camera.lookAt(controls.target);
      }
    }

    let last = performance.now();
    function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      v.onFrame.forEach(f => f(dt));
      if (fly) {
        fly.t = Math.min(1, fly.t + dt / 0.7); const k = 1 - Math.pow(1 - fly.t, 3);
        camera.position.lerpVectors(fly.p0, fly.p1, k); controls.target.lerpVectors(fly.t0, fly.t1, k);
        if (fly.t >= 1) fly = null;
      }
      if (v.view === 'top') controls.update();
      const w = el.clientWidth, h = el.clientHeight;
      if (v.split) {
        renderer.setScissorTest(true);
        v.split.forEach((side, i) => {
          side.apply();
          placeCamera(side.pose && side.pose());
          camera.aspect = (w / 2) / h; camera.updateProjectionMatrix();
          renderer.setViewport(i * w / 2, 0, w / 2, h); renderer.setScissor(i * w / 2, 0, w / 2, h);
          renderer.render(scene, camera);
        });
        renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h);
      } else {
        placeCamera(v.pose);
        camera.aspect = w / h; camera.updateProjectionMatrix();
        renderer.render(scene, camera);
      }
      requestAnimationFrame(frame);
    }
    v.home(); v.setView('top');
    requestAnimationFrame(frame);
    return v;
  }

  HA.viewer = { create };
})();
