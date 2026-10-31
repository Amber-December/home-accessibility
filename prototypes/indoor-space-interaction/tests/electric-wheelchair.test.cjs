const assert = require('node:assert/strict');
global.window = global;
const L = require('../js/core.js');
require('../js/simulation.js');
require('../js/resident-tasks.js');

const electric = L.RESIDENT_PROFILES.electricWheelchair;
assert(electric, 'electric wheelchair profile must be registered');
assert.equal(electric.type, 'wheelchair', 'renderer and simulation reuse wheelchair geometry');
assert(electric.length > L.RESIDENT_PROFILES.wheelchair.length, 'powered chair has a longer safety envelope');
assert(electric.speed > L.RESIDENT_PROFILES.wheelchair.speed, 'powered chair uses a higher cruise speed');
assert.equal(electric.width, L.RESIDENT_PROFILES.wheelchair.width, 'width stays comparable for door clearance');
console.log('PASS: electric wheelchair profile is distinct in parameters while reusing wheelchair collision geometry.');
