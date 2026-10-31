/* 素材库 3D preview: one GLB on a turntable. Drag to turn it; it keeps turning slowly when left alone. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function turntable(el, url, onError) {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  el.appendChild(r.domElement);
  const scene = new THREE.Scene(), pivot = new THREE.Group();
  const pm = new THREE.PMREMGenerator(r);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(pivot, new THREE.HemisphereLight(0xffffff, 0xd8d2cc, 0.6));
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  let alive = true, yaw = 0.6, drag = null, idle = 0;

  new GLTFLoader().load(url, g => {
    if (!alive) return;
    const m = g.scene, box = new THREE.Box3().setFromObject(m), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    m.position.sub(c);
    pivot.add(m);
    const rad = s.length() / 2;
    cam.position.set(0, rad * 0.9, rad * 3.1);
    cam.lookAt(0, 0, 0);
    el.classList.add('ready');
  }, undefined, err => { if (alive && onError) onError(err); });

  const size = () => {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(size); ro.observe(el); size();
  el.addEventListener('pointerdown', e => { drag = e.clientX; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', e => { if (drag == null) return; yaw += (e.clientX - drag) * 0.01; drag = e.clientX; idle = 0; });
  el.addEventListener('pointerup', () => { drag = null; });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let last = performance.now();
  r.setAnimationLoop(now => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    idle += dt;
    if (!reduced && drag == null && idle > 1.5) yaw += dt * 0.5;
    pivot.rotation.y = yaw;
    r.render(scene, cam);
  });

  return () => {
    alive = false; ro.disconnect(); r.setAnimationLoop(null);
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => { Object.values(m).forEach(v => v && v.isTexture && v.dispose()); m.dispose(); }); });
    pm.dispose(); r.dispose(); r.domElement.remove();
  };
}
