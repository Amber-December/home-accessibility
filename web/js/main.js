/* Entry module. Loads the ES-module libraries from web/vendor (see the importmap in index.html),
   exposes them to the classic IIFE modules as window.THREE and HA.lib, then runs those modules in order. */
import * as THREE_NS from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
import * as PP from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import CameraControls from 'camera-controls';

CameraControls.install({ THREE: THREE_NS });
window.THREE = { ...THREE_NS, GLTFLoader };
window.fflate = { unzipSync };
const HA = window.HA = window.HA || {};
HA.lib = { PP, N8AOPostPass, CameraControls, RoomEnvironment };
HA.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// text.js is a deferred classic script in index.html so the loading braille shows before the libraries arrive.
const MODULES = ['api', 'scene-ir', 'fx', 'viewer', 'resident', 'layers', 'timeline', 'panels', 'chat',
  'app', 'app-steps', 'app-boot'];

function load(name) {
  return new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = `js/${name}.js`; s.async = false;
    s.onload = ok; s.onerror = () => bad(new Error(`js/${name}.js 加载失败`));
    document.body.appendChild(s);
  });
}

try {
  for (const m of MODULES) await load(m);
} catch (err) {
  const el = document.getElementById('loading');
  if (el) el.lastElementChild.textContent = err.message;
  throw err;
}
