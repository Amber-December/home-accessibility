const assert=require('node:assert/strict');
const L=require('../js/core.js');
// Browser globals needed by simulation.js are supplied by the tiny deterministic harness.
global.window={IndoorLab:L};
require('../js/simulation.js');
function grid(){const g=new L.Grid({minX:0,maxX:12,minZ:0,maxZ:10},.25);g.finalize();return g;}
const exits=[{x:11.5,z:5,name:'出口'}];
function hazard(type){return type==='earthquake'?{time:0,active:true,finished:false,shaking:true,groundAcceleration:5,groundAccelerationZ:0,tick(){this.time+=1/30;this.groundAcceleration=5;},isUnsafe(){return false;},rebuildEscapeDistance(){}}:{time:0,sources:[{cell:10}],tick(){this.time+=1/30;},hazardAt(){return{smoke:.5,temperature:90,risk:.8,dangerous:true};},isHazardBlocked(){return false;},navigationPenalty(){return 1;},rebuildEscapeDistance(){},route(){return{path:[{x:11.5,z:5}],reachable:true};}};}
{
  const s=new L.Simulation(grid(),[{id:1,x:11.5,z:5}],{count:4,population:'pedestrian',search:20});s.setHazard(hazard('fire'),'fire',exits);for(let i=0;i<60;i++)s.tick(1/30);assert(s.agents.some(a=>a.reaction.code==='smoke'||a.reaction.code==='evacuating'||a.reaction.code==='safe'));assert(s.agents.every(a=>a.evacuating||a.state==='safe'));console.log('fire response',s.agents.map(a=>({state:a.state,reaction:a.reaction.code,text:a.reaction.text})));
}
{
  const s=new L.Simulation(grid(),[{id:1,x:11.5,z:5}],{count:4,population:'mixed',search:20});const h=hazard('earthquake');s.setHazard(h,'earthquake',exits);for(let i=0;i<20;i++)s.tick(1/30);assert(s.agents.some(a=>a.reaction.code==='protect'||a.reaction.code==='startled'));assert(s.agents.some(a=>a.reaction.posture==='crouch'||a.reaction.posture==='brace'));h.groundAcceleration=0;h.shaking=false;for(let i=0;i<120;i++)s.tick(1/30);assert(s.agents.some(a=>a.evacuating||a.state==='safe'));console.log('earthquake response',s.agents.map(a=>({state:a.state,reaction:a.reaction.code,posture:a.reaction.posture})));
}
console.log('PASS: hazard perception, protection, evacuation state and terminal safe agents.');
