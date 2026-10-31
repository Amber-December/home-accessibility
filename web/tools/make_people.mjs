/* Resident character models for the web page: one GLB per person in $HA_DATA/people-rig/person_XX/model_rigged.glb
   is reduced to a small static GLB in web/models/people/, and web/models/people/manifest.json lists them by engine
   resident type.

   The page only moves a whole body along the engine trajectory, so the rig and its demo animation are dropped, the
   mesh is simplified, the base colour texture is shrunk to 512 px JPEG, metal and roughness become constants, and
   vertex data is quantized (KHR_mesh_quantization, read by three.js without a decoder).

   Needs @gltf-transform/{core,extensions,functions}, meshoptimizer and sharp (npm i @gltf-transform/cli sharp):
     NODE_PATH=<dir>/node_modules node web/tools/make_people.mjs [--src $HA_DATA/people-rig] [--ratio 0.12]
*/
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(process.env.NODE_PATH || '.', 'x.js'));
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { weld, simplify, quantize, prune, dedup, textureCompress } = require('@gltf-transform/functions');
const { MeshoptSimplifier } = require('meshoptimizer');
const sharp = require('sharp');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'web/models/people');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SRC = arg('--src', path.join(process.env.HA_DATA || '', 'people-rig'));
const RATIO = +arg('--ratio', 0.12);

// Engine resident type for each person (B's profiles: wheelchair, electricWheelchair, assisted, blind, upper,
// pedestrian). Canes and crutches walk with an aid like the walker frame, so they count as assisted. The first
// person of each type is that type's default body.
const TYPE = {
  wheelchair: ['09', '10', '11', '12'],
  electricWheelchair: ['13', '14', '15'],
  assisted: ['06', '07', '08', '01', '02', '03', '04', '05'],
  blind: ['23', '24'],
  upper: ['19', '20'],
  pedestrian: ['25', '16', '17', '18', '21', '22', '26'],
};

// glTF bodies face +z; the page's body faces +x (IR), so a quarter turn about the vertical.
const YAW = Math.PI / 2;

async function one(io, id) {
  const dir = path.join(SRC, 'person_' + id), doc = await io.read(path.join(dir, 'model_rigged.glb'));
  const root = doc.getRoot();
  root.listAnimations().forEach(a => a.dispose());
  for (const n of root.listNodes()) n.setSkin(null);
  root.listSkins().forEach(s => s.dispose());
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    for (const s of p.listSemantics()) if (/^(JOINTS|WEIGHTS)_/.test(s)) p.setAttribute(s, null);
  }
  for (const mat of root.listMaterials()) {
    if (mat.getMetallicRoughnessTexture()) { mat.setMetallicRoughnessTexture(null); mat.setMetallicFactor(0).setRoughnessFactor(0.8); }
    mat.setNormalTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
  }
  await MeshoptSimplifier.ready;
  await doc.transform(
    prune(), dedup(), weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.01 }),
    textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [512, 512], quality: 80 }),
    quantize(), prune());
  const file = `person_${id}.glb`;
  await io.write(path.join(OUT, file), doc);
  const c = JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8') || '{}');
  return { id: 'person_' + id, file, title: c.title || 'person_' + id, child: c.age_group === '儿童',
    seated: c.standing_human === false, height: c.height_target_m || null, bytes: fs.statSync(path.join(OUT, file)).size };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const manifest = {}, people = [];
  for (const [type, ids] of Object.entries(TYPE)) for (const id of ids) {
    const p = await one(io, id);
    people.push({ id: p.id, type, glb: p.file, title: p.title, child: p.child, seated: p.seated, height: p.height });
    if (!manifest[type]) manifest[type] = { glb: p.file, height: p.height, yaw: YAW, id: p.id, title: p.title };
    console.log(`${type.padEnd(18)} ${p.id}  ${(p.bytes / 1e6).toFixed(2)} MB  ${p.title}`);
  }
  manifest.people = people;
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  const total = people.reduce((s, p) => s + fs.statSync(path.join(OUT, p.glb)).size, 0);
  console.log(`${people.length} people, ${(total / 1e6).toFixed(1)} MB -> ${path.relative(ROOT, OUT)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
