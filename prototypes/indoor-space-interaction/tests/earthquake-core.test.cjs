const assert = require('node:assert/strict');
global.window = { IndoorLab: {} };
const { EarthquakeScenario } = require('../js/earthquake-core.js');
function run(seed){
  const obstacles = [
    {id:'wall-a', center:{x:0,z:0}, width:1, depth:1, height:2, fragility:.9},
    {id:'wall-b', center:{x:2,z:1}, width:2, depth:1, height:1.4, fragility:.72}
  ];
  const q = new EarthquakeScenario({}, obstacles, {seed, pga:.32, frequency:2.2, duration:12, collapseThreshold:.48}).start();
  for(let i=0;i<360;i++) q.tick(1/30);
  return {summary:q.summary(), damage:q.damage.map(d=>({id:d.id,ratio:d.ratio,collapsed:d.collapsed})), events:q.events.map(e=>({id:e.id,time:e.time,x:e.x,z:e.z}))};
}
const a=run(7319), b=run(7319);
assert.deepEqual(a,b);
assert.ok(a.summary.collapsed>=1,'expected deterministic collapse event');
assert.ok(a.summary.debris>=1,'expected falling debris');
assert.ok(a.summary.groundDisplacement!==0,'expected ground displacement');
console.log(`PASS: deterministic earthquake motion, damage accumulation, collapse (${a.summary.collapsed}) and debris (${a.summary.debris}).`);
