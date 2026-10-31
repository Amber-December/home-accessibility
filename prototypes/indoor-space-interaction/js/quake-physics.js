/* Bounded rigid-body earthquake adapter. The solver works on metre-scale
 * compound boxes, never on every imported triangle. Original mesh poses are
 * retained so clear/reset restores the exact source scene. */
(() => {
  'use strict';
  const L=window.IndoorLab;
  let enginePromise=null,Engine=null;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const visible=o=>{for(let n=o;n;n=n.parent)if(!n.visible)return false;return true;};
  const matOf=o=>Array.isArray(o.material)?o.material[0]:o.material;
  class QuakePhysics {
    static prepare(){
      if(Engine)return Promise.resolve(Engine);
      if(enginePromise)return enginePromise;
      const src=typeof document!=='undefined'&&(
        document.currentScript?.src||
        [...document.scripts].find(s=>/\/js\/quake-physics\.js(?:\?|$)/.test(s.src))?.src
      );
      // cannon-es ships with this app; resolve it relative to index.html.
      const url=new URL('js/vendor/cannon-es/cannon-es.js',location.href).href;
      enginePromise=import(url).then(m=>{Engine=m;return m;}).catch(e=>{enginePromise=null;throw e;});
      return enginePromise;
    }
    constructor(view,model,grid,options={}){
      if(!Engine)throw new Error('QuakePhysics.prepare() 必须在创建刚体世界前完成。');
      this.C=Engine;this.view=view;this.model=model;this.grid=grid;this.options={maxBodies:72,maxFragments:120,fixedStep:1/120,...options};
      this.group=new THREE.Group();this.group.name='地震裂缝与物理碎片';this.group.userData.noAO=true;this.group.userData.styleLocked=true;view.scene.add(this.group);
      this.root={position:model.group.position.clone(),quaternion:model.group.quaternion.clone(),scale:model.group.scale.clone()};
      const C=this.C;this.world=new C.World({gravity:new C.Vec3(0,-9.81,0)});this.world.broadphase=new C.SAPBroadphase(this.world);this.world.solver.iterations=10;this.world.defaultContactMaterial.friction=.44;this.world.defaultContactMaterial.restitution=.08;
      this.records=[];this.byId=new Map();this.fragments=[];this.cracks=[];this._footprints=[];this.accumulator=0;this.steps=0;this.impacts=0;this.brokenObjects=0;this.fallenObjects=0;this.disposed=false;this.collect();this.descriptors=this.records.map(r=>({id:r.id,name:r.name,kind:r.wall?'wall':'furniture',width:r.size.x,depth:r.size.z,height:r.size.y,center:{x:r.center.x,z:r.center.z},mounted:r.mounted,fragility:r.wall?.48:r.mounted?1.2:r.brittle?1.1:.65,fracturable:r.fracturable}));this.syncVisuals();
    }
    collect(){
      const C=this.C,group=this.model.group;group.updateMatrixWorld(true);const entries=new Map(),walls=[];
      group.traverse(mesh=>{
        if(!mesh.isMesh||!visible(mesh)||mesh.userData.ignoreCollision||!mesh.geometry)return;
        const info=mesh.userData.collisionInfo||{},kind=mesh.userData.kind||info.kind||'',text=`${mesh.name||''} ${info.name||''} ${mesh.userData.sourceProduct||mesh.userData.usdPath||''} ${mesh.userData.sourceType||''}`;
        if(kind==='ceiling'||kind==='floor'||mesh.userData.floor||/地板|floor|ground/i.test(text))return;
        const box=new THREE.Box3().setFromObject(mesh),size=box.getSize(new THREE.Vector3());if(size.length()<.03||!Number.isFinite(size.x+size.y+size.z))return;
        const wall=kind==='wall'||mesh.userData.wall;if(wall){walls.push({meshes:[mesh],box,name:info.name||mesh.name||'室内墙体',text,wall:true});return;}
        const key=mesh.userData.sourceProduct||info.semanticId||info.semanticId===0?String(mesh.userData.sourceProduct||info.semanticId):mesh.uuid;
        const item=entries.get(key)||{meshes:[],box:new THREE.Box3(),name:info.name||mesh.name||'室内物件',text,kind};item.meshes.push(mesh);item.box.union(box);entries.set(key,item);
      });
      const b=this.model.bounds,floor=new C.Body({mass:0,shape:new C.Box(new C.Vec3((b.maxX-b.minX)/2+.5,.12,(b.maxZ-b.minZ)/2+.5)),position:new C.Vec3((b.minX+b.maxX)/2,-.12,(b.minZ+b.maxZ)/2)});this.world.addBody(floor);
      let dynamicCount=0;for(const e of [...walls,...entries.values()]){
        const size=e.box.getSize(new THREE.Vector3()),center=e.box.getCenter(new THREE.Vector3());if(size.y<.045||Math.max(size.x,size.z)>25)continue;
        const text=e.text||e.name,mounted=/wall_mounted|picture|mirror|painting|lamp|挂|悬/i.test(text),fixed=/door|window|toilet|washbasin|rangehood|curtain|rug|门|窗|坐便|洗手|地毯/i.test(text),brittle=/vase|cup|pitcher|plate|mirror|glass|sculpture|ceramic|decor|花瓶|陶瓷|玻璃|装饰/i.test(text),wall=e.wall;
        const dynamic=!wall&&!fixed&&dynamicCount<this.options.maxBodies&&size.x<6&&size.z<6&&size.y<5;if(dynamic)dynamicCount++;
        const rec={id:`quake-${this.records.length}`,name:e.name,wall,meshes:e.meshes,size,center,mounted,brittle,dynamic,fracturable:wall&&Math.min(size.x,size.z)<.65&&size.y>1.2,mass:clamp(size.x*size.y*size.z*(brittle?125:mounted?58:85),.25,180),base:[],released:false,broken:false,cracked:false};
        rec.meshes.forEach(mesh=>{rec.base.push({mesh,parent:mesh.parent,position:mesh.position.clone(),quaternion:mesh.quaternion.clone(),scale:mesh.scale.clone(),matrix:mesh.matrix.clone(),auto:mesh.matrixAutoUpdate,visible:mesh.visible});});
        if(dynamic){rec.pivot=new THREE.Group();rec.pivot.name=`${rec.name} · earthquake body`;rec.pivot.userData.ignoreCollision=true;group.add(rec.pivot);rec.pivot.position.set(center.x,center.y,center.z);for(const m of rec.meshes)rec.pivot.attach(m);}
        rec.body=new C.Body({mass:dynamic?0:0,type:C.Body.STATIC,shape:new C.Box(new C.Vec3(Math.max(.02,size.x/2),Math.max(.02,size.y/2),Math.max(.02,size.z/2))),position:new C.Vec3(center.x,center.y,center.z),linearDamping:.1,angularDamping:.18});this.world.addBody(rec.body);rec.body._quakeRecord=rec;if(dynamic)rec.body.addEventListener('collide',e2=>{const v=Math.abs(e2.contact.getImpactVelocityAlongNormal());if(rec.released&&v>1.1){this.impacts++;rec.lastImpact=v;if(rec.brittle&&v>1.7)rec.pendingBreak=true;}});
        this.records.push(rec);this.byId.set(rec.id,rec);
      }
    }
    release(id){const r=this.byId.get(id);if(!r||!r.dynamic||r.released)return;r.released=true;const C=this.C;r.body.type=C.Body.DYNAMIC;r.body.mass=r.mass;r.body.updateMassProperties();r.body.wakeUp();this.fallenObjects+=r.mounted?1:0;}
    fractureWall(id,scenario){const r=this.byId.get(id);if(!r||r.broken||!r.fracturable)return;this.breakRecord(r,scenario,true);}
    breakRecord(r,scenario,wall=false){
      if(r.broken||this.fragments.length>=this.options.maxFragments-4)return;r.broken=true;r.released=true;this.world.removeBody(r.body);r.meshes.forEach(m=>m.visible=false);
      const C=this.C,count=wall?Math.min(12,this.options.maxFragments-this.fragments.length):Math.min(4,this.options.maxFragments-this.fragments.length),nx=wall?4:2,ny=wall?3:2,color=matOf(r.meshes[0])?.color?.clone()||new THREE.Color('#8e8378');
      for(let k=0;k<count;k++){const sx=Math.max(.04,r.size.x/(wall?nx:2)*.9),sy=Math.max(.04,r.size.y/(wall?ny:2)*.9),sz=Math.max(.04,r.size.z/(wall?1:2)*.9),x=r.center.x+(wall?(k%nx+.5)/nx-.5:((k%2)-.5)*.45)*r.size.x,y=r.center.y+(wall?(Math.floor(k/nx)+.5)/ny-.5:((Math.floor(k/2)%2)-.5)*.5)*r.size.y,z=r.center.z+(wall?0:((k%3)-1)*.35)*r.size.z;
        const body=new C.Body({mass:Math.max(.1,r.mass/count),shape:new C.Box(new C.Vec3(sx/2,sy/2,sz/2)),position:new C.Vec3(x,y,z),linearDamping:.13,angularDamping:.2});body.velocity.set((k%2?1:-1)*(.12+(scenario?.options.pga||.32)*.7),wall?.03:0,((k%3)-1)*.11);body.angularVelocity.set(.15*(k%2),.2,.12*(k%3-1));this.world.addBody(body);
        const mesh=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),new THREE.MeshStandardMaterial({color,roughness:.9,metalness:.02}));mesh.castShadow=mesh.receiveShadow=true;mesh.userData.ignoreCollision=true;mesh.userData.styleLocked=true;this.group.add(mesh);this.fragments.push({id:`${r.id}:fragment-${k}`,name:`${r.name}碎片`,kind:'debris',body,mesh,size:new THREE.Vector3(sx,sy,sz),energy:wall?.9:.65,parent:r.id});
      }
      this.brokenObjects++;scenario?.record({type:wall?'wall-fracture':'impact-break',id:r.id,name:r.name,x:r.center.x,z:r.center.z,impactVelocity:r.lastImpact||0});
    }
    crack(r){if(r.crackMesh||!r.wall)return;const c=r.center,s=r.size,verts=[];for(let i=0;i<8;i++){const t=i/7;verts.push(c.x-(s.x/2+.006),c.y+s.y*.78-t*s.y*.62,c.z+Math.sin(i*2.2)*.06, c.x-(s.x/2+.006),c.y+s.y*.78-(t+.13)*s.y*.62,c.z+Math.sin((i+1)*2.2)*.06);}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));const line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:'#4b4039',transparent:true,opacity:.85}));line.userData.ignoreCollision=true;line.userData.styleLocked=true;this.group.add(line);this.cracks.push(line);r.crackMesh=line;}
    step(dt,scenario){if(this.disposed)return;this.scenario=scenario;this.accumulator+=Math.min(.25,dt);for(const s of scenario.damage){const r=this.byId.get(s.id);if(r&&s.cracked)this.crack(r);}const h=this.options.fixedStep;while(this.accumulator>=h){for(const r of this.records){if(!r.dynamic||!r.released||r.broken)continue;r.body.force.x-=r.body.mass*scenario.groundAcceleration;r.body.force.z-=r.body.mass*scenario.groundAccelerationZ;r.body.wakeUp();}for(const f of this.fragments){f.body.force.x-=f.body.mass*scenario.groundAcceleration;f.body.force.z-=f.body.mass*scenario.groundAccelerationZ;}this.world.step(h);this.steps++;this.accumulator-=h;for(const r of this.records)if(r.pendingBreak){r.pendingBreak=false;this.breakRecord(r,scenario,false);}}this.syncVisuals();}
    syncVisuals(){if(this.disposed)return;const sx=this.scenario?.groundDisplacement||0,sz=this.scenario?.groundDisplacementZ||0;this.model.group.position.set(this.root.position.x+sx,this.root.position.y,this.root.position.z+sz);for(const r of this.records){if(r.cracked)this.crack(r);if(!r.dynamic||!r.released||r.broken)continue;r.pivot.position.set(r.body.position.x-this.model.group.position.x,r.body.position.y,r.body.position.z-this.model.group.position.z);r.pivot.quaternion.set(r.body.quaternion.x,r.body.quaternion.y,r.body.quaternion.z,r.body.quaternion.w);}for(const f of this.fragments){f.mesh.position.set(f.body.position.x,f.body.position.y,f.body.position.z);f.mesh.quaternion.set(f.body.quaternion.x,f.body.quaternion.y,f.body.quaternion.z,f.body.quaternion.w);}}
    footprints(){const out=[];for(const r of this.records){if(!r.dynamic||!r.released||r.broken)continue;const p=r.body.position;if(p.y>1.75)continue;out.push({id:r.id,name:r.name,kind:'fallen-object',x:p.x,z:p.z,radius:Math.max(r.size.x,r.size.z)/2,energy:clamp(r.body.velocity.length()/3+.25,.25,1)});}for(const f of this.fragments){const p=f.body.position;if(p.y>1.75)continue;out.push({id:f.id,name:f.name,kind:'debris',x:p.x,z:p.z,radius:Math.max(f.size.x,f.size.z)/2,energy:f.energy});}this._footprints=out;return out;}
    contactAt(x,z,r=.25){return (this._footprints||[]).find(p=>Math.hypot(x-p.x,z-p.z)<r+p.radius)||null;}
    summary(){return{engine:'cannon-es 0.20.0',rigidBodies:this.records.filter(r=>r.dynamic).length,physicsSteps:this.steps,physicalImpacts:this.impacts,brokenObjects:this.brokenObjects,fallenObjects:this.fallenObjects,fragments:this.fragments.length};}
    reset(){if(this.disposed)return;for(const f of this.fragments){this.world.removeBody(f.body);this.group.remove(f.mesh);f.mesh.geometry.dispose();f.mesh.material.dispose();}for(const c of this.cracks){this.group.remove(c);c.geometry.dispose();c.material.dispose();}this.fragments=[];this.cracks=[];for(const r of this.records){r.released=r.broken=r.cracked=r.pendingBreak=false;r.crackMesh=null;if(r.body&&!this.world.bodies.includes(r.body))this.world.addBody(r.body);if(r.body){r.body.type=this.C.Body.STATIC;r.body.mass=0;r.body.position.set(r.center.x,r.center.y,r.center.z);r.body.quaternion.set(0,0,0,1);r.body.velocity.set(0,0,0);r.body.angularVelocity.set(0,0,0);r.body.force.set(0,0,0);r.body.torque.set(0,0,0);r.body.updateMassProperties();}for(const b of r.base){if(b.parent&&!b.parent.children.includes(b.mesh))b.parent.attach(b.mesh);b.mesh.position.copy(b.position);b.mesh.quaternion.copy(b.quaternion);b.mesh.scale.copy(b.scale);b.mesh.matrix.copy(b.matrix);b.mesh.matrixAutoUpdate=b.auto;b.mesh.visible=b.visible;}if(r.pivot){r.pivot.parent?.remove(r.pivot);r.pivot=null;}if(r.dynamic){r.pivot=new THREE.Group();r.pivot.name=`${r.name} · earthquake body`;r.pivot.userData.ignoreCollision=true;this.model.group.add(r.pivot);r.pivot.position.set(r.center.x,r.center.y,r.center.z);for(const b of r.base)r.pivot.attach(b.mesh);}}this.model.group.position.copy(this.root.position);this.model.group.quaternion.copy(this.root.quaternion);this.model.group.scale.copy(this.root.scale);this._footprints=[];this.accumulator=this.steps=this.impacts=this.brokenObjects=this.fallenObjects=0;}
    dispose(){if(this.disposed)return;this.reset();this.view.scene.remove(this.group);this.world.bodies.slice().forEach(b=>this.world.removeBody(b));this.disposed=true;}
  }
  L.QuakePhysics=QuakePhysics;if(typeof module!=='undefined')module.exports={QuakePhysics};
})();
