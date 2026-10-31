const assert = require('node:assert/strict');
const L = require('../js/core.js');
require('../js/fire-core.js');

function gridWithWall(cell = .25) {
  const g = new L.Grid({ minX: 0, maxX: 8, minZ: 0, maxZ: 6 }, cell);
  for (let r = 0; r < g.rows; r++) {
    const p = g.point(r * g.cols + Math.floor(4 / cell));
    if (p.z > .8 && p.z < 5.2) g.solid[r * g.cols + Math.floor(4 / cell)] = 1;
  }
  g.finalize();
  return g;
}

{
  const g = gridWithWall(), fire = new L.FireModel(g, { conductivity: .3, smokeDiffusion: .6, smokeAdvection: 0, sourcePower: 160, sourceSmoke: .8 });
  const source = fire.addSource({ x: 1.5, z: 3, name: '左侧火源' });
  const sourceCell = source.cell, sourcePoint = g.point(sourceCell);
  fire.rebuildEscapeDistance([{ x: 7.2, z: 3 }, { x: 1, z: .4 }]);
  assert(Number.isFinite(fire.escapeDistanceAt({ x: 2.5, z: 3 })), 'an exit on the source side should be reachable');
  assert.equal(fire.ignitionPath(sourceCell).at(-1), sourceCell);
  for (let i = 0; i < 18; i++) fire.tick(.1);
  const near = fire.hazardAt({ x: sourcePoint.x + .5, z: sourcePoint.z });
  const far = fire.hazardAt({ x: 6.5, z: 3 });
  assert(near.smoke > 0 && near.temperature > 20, 'near field must receive heat and smoke');
  assert(far.smoke < near.smoke * .95, 'solid wall must block smoke diffusion');
  assert(far.flame === 0, 'solid wall must block flame propagation');
  assert(fire.grid.blocked(fire.grid.index(4, 3)));
  assert(Number.isFinite(fire.escapeDistanceAt({ x: 2, z: 3 })), 'unburned source-side cells keep an exit distance');
}

{
  const g = new L.Grid({ minX: 0, maxX: 4, minZ: 0, maxZ: 2 }, .25); g.finalize();
  const fire = new L.FireModel(g, { sourcePower: 180, sourceSmoke: 1.2, conductivity: .02, smokeDiffusion: .8, smokeAdvection: 0, ignitionTemperature: 200, spreadTemperature: 170 });
  const source = fire.addSource({ x: .5, z: 1 });
  fire.tick(.2); fire.tick(.2);
  const target = fire.hazardAt({ x: .75, z: 1 });
  assert(target.smoke > 0, 'smoke must arrive before distant fire ignition');
  assert.equal(target.flame, 0, 'distant cell must not ignite in the first smoke step');
  assert(target.exposure > 0, 'integrated exposure should accumulate');
  assert(fire.summary().ignitedCells >= 1);
  assert.equal(fire.ignitionPath(source.cell).length, 1);
}

{
  const g = new L.Grid({ minX: 0, maxX: 6, minZ: 0, maxZ: 3 }, .25); g.finalize();
  const fire = new L.FireModel(g, { sourcePower: 320, sourceSmoke: 1.4, conductivity: .1 });
  fire.addSource({ x: 3, z: 1.5 });
  const route = fire.route({ x: .8, z: 1.5 }, { x: 5.2, z: 1.5 }, .25);
  assert(route.hazardAware && route.path.length > 1, 'fire route must expose a dynamic hazard-aware path');
  assert(route.path.every(p => !fire.isHazardBlocked(p)), 'dynamic route must avoid burning cells');
}

{
  const build = () => { const g = new L.Grid({ minX: 0, maxX: 5, minZ: 0, maxZ: 5 }, .25); g.finalize(); const fire = new L.FireModel(g, { wind: { x: 1, z: 0 }, sourcePower: 190, sourceSmoke: .9, conductivity: .08 }); fire.addSource({ x: 1, z: 2.5 }); for (let i = 0; i < 120; i++) fire.tick(1 / 30); return fire; };
  const a = build(), b = build();
  assert.deepEqual(Array.from(a.temperature), Array.from(b.temperature), 'same seed and inputs must be deterministic');
  assert.deepEqual(Array.from(a.smoke), Array.from(b.smoke));
  assert.deepEqual(Array.from(a.flame), Array.from(b.flame));
  for (const values of [a.temperature, a.smoke, a.flame, a.fuel, a.exposure, a.risk]) for (const value of values) assert(Number.isFinite(value), 'repeated ticks must remain finite');
  const windSource = a.hazardAt({ x: 1, z: 2.5 }), downwind = a.hazardAt({ x: 1.5, z: 2.5 }), upwind = a.hazardAt({ x: .5, z: 2.5 });
  assert(downwind.smoke >= upwind.smoke, 'positive wind should bias smoke downwind');
}

{
  const g = new L.Grid({ minX: 0, maxX: 3, minZ: 0, maxZ: 3 }, .25); const unsupported = g.index(1.5, 1.5); g.support[unsupported] = 0; g.finalize();
  const fire = new L.FireModel(g, { sourcePower: 240, sourceSmoke: 1, conductivity: .5 }); fire.addSource({ x: 1.5, z: 1.25 });
  for (let i = 0; i < 30; i++) fire.tick(.1);
  assert(fire.hazardAt(unsupported)?.blocked, 'unsupported floor cells are excluded from fire field');
  assert(fire.isHazardBlocked(unsupported));
  const exits = fire.rebuildEscapeDistance([{ x: 2.75, z: 2.75 }]);
  assert.equal(exits.length, g.size); assert(Number.isFinite(fire.escapeDistanceAt({ x: 2.5, z: 2.5 })));
}

{
  const g = new L.Grid({ minX: 0, maxX: 4, minZ: 0, maxZ: 4 }, .25); g.finalize();
  const fire = new L.FireModel(g, { sourcePower: 240, sourceSmoke: 1.4, smokeDiffusion: .45, ceilingRise: .3 });
  const fuel = new Float32Array(g.size); fuel.fill(0); fuel[g.index(1, 2)] = 1; fuel[g.index(1.25, 2)] = .7; fire.setFuelMap(fuel);
  const src = fire.addSource({ x: 1, z: 2 }); for (let i = 0; i < 40; i++) fire.tick(.1);
  assert(fire.fuel[src.cell] < 1, 'material fuel must burn down');
  assert(fire.ceilingSmoke[src.cell] > 0, 'smoke must rise into a separate ceiling layer');
  const before = fire.time; fire.tick(0); assert.equal(fire.time, before, 'zero dt must pause the hazard');
}

console.log('PASS: deterministic fire field, heat/smoke/flame/fuel/exposure, wall and unsupported-floor blocking, smoke-first spread, wind bias and dynamic exit distance.');
