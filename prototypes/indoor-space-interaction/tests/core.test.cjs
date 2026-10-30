const assert=require('node:assert/strict');
const L=require('../js/core.js');
function openGrid(cell=.2){const g=new L.Grid({minX:0,maxX:10,minZ:0,maxZ:8},cell);return g;}
{
 const g=openGrid();g.solid[g.index(5,4)]=1;g.finalize();
 assert(!g.isClear(5.1,4.1,.25));assert(g.isClear(2,2,.45));assert(!g.isClear(.1,2,.25));
 const route=g.route({x:2,z:4.1},{x:8,z:4.1},.45);assert(route.reachable);assert(route.path.length>1);
 let p={x:2,z:4.1};for(const next of route.path){assert(g.lineClear(p,next,.45),'route segment intersects obstacle');p=next;}
 for(let i=0;i<g.size;i++){const p=g.point(i),o=g.point(g.index(5,4));const expected=Math.max(0,Math.min(Math.hypot(p.x-o.x,p.z-o.z)-g.cell*Math.SQRT1_2,p.x,10-p.x,p.z,8-p.z));assert(Math.abs(g.distance[i]-expected)<1e-5,'EDT is not exact');}
}
{
 // Physical opening is 0.8m: a 0.5m disc fits, a 0.9m disc does not.
 const g=openGrid(.1);for(let r=0;r<g.rows;r++)for(let c=0;c<g.cols;c++){const i=r*g.cols+c,p=g.point(i);if(p.x>4.8&&p.x<5.2&&(p.z<3.65||p.z>4.35))g.solid[i]=1;}g.finalize();
 assert(g.route({x:2,z:4},{x:8,z:4},.25).reachable,'pedestrian must fit narrow passage');
 assert(!g.route({x:2,z:4},{x:8,z:4},.45).reachable,'wheelchair must fail narrow passage');
}
{
 const g=openGrid(.1);for(let r=0;r<g.rows;r++)for(let c=0;c<g.cols;c++){const i=r*g.cols+c,p=g.point(i);if(p.x>4.8&&p.x<5.2&&(p.z<3.55||p.z>4.45))g.solid[i]=1;}g.finalize();
 assert(g.route({x:2,z:4},{x:8,z:4},.45).reachable,'1.0m opening must admit a 0.9m disc; no extra distance-transform inflation');
}
{
 const g=openGrid();for(let r=0;r<g.rows;r++)g.solid[r*g.cols+25]=1;g.finalize();
 const route=g.route({x:2,z:3},{x:8,z:3},.25);assert(!route.reachable);assert(route.path.length);assert(route.endpoint.x<5);
 g.heat.near[0]=2;g.heat.contact[0]=3;g.heat.blocked[0]=4;assert.equal(g.heatValue(0,'risk'),43);g.resetHeat();assert.equal(g.heatValue(0,'risk'),0);
}
console.log('PASS: exact clearance, disc collision, swept routes, body-width bottleneck, unreachable frontier and heat accounting.');
