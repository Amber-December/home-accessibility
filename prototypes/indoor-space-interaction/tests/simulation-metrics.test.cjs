const assert = require('node:assert/strict');
global.window = global;
const L = require('../js/core.js');
require('../js/simulation.js');

const grid = new L.Grid({minX: 0, maxX: 10, minZ: 0, maxZ: 8}, .2);
for (let r = 0; r < grid.rows; r++) {
  if (r < 12 || r > 27) grid.solid[r * grid.cols + 24] = 1;
}
grid.finalize();
const sim = new L.Simulation(grid, [{id: 1, name: '出口', x: 9, z: 4}], {
  count: 4, population: 'mixed', search: 20, seed: 1234
});
for (let i = 0; i < 600; i++) sim.tick(1 / 30);

const summary = sim.summary();
assert.equal(summary.clearance.count, 4);
assert(Number.isFinite(summary.clearance.minClearanceM));
assert.equal(typeof summary.quality.ok, 'boolean');
assert(summary.stateTransitions >= 1);
assert(summary.eventCount >= summary.stateTransitions);

const metrics = sim.agentMetrics();
assert.equal(metrics.length, 4);
assert(metrics.every(row => row.minClearanceM !== null));
assert(metrics.every(row => row.distanceM >= 0));
assert(metrics.some(row => row.statusHistory.length > 0));

const manifest = sim.manifest();
assert.equal(manifest.schema, 'access-lab/simulation');
assert.equal(manifest.seed, 1234);
assert.equal(manifest.limits.deterministic, true);
assert.equal(manifest.agents.length, 4);

const quality = sim.qualityChecks();
assert.deepEqual(quality.wallPenetrations, []);
assert.deepEqual(quality.agentOverlaps, []);
console.log('PASS: deterministic manifest, clearance metrics, state transitions and simulation quality checks.');
