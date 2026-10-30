/* Presentation layer. Model meshes are kept separate from analysis overlays. */
(() => {
  'use strict'; const L = window.IndoorLab;
  const mat = (color, extra = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: .72, metalness: .05, ...extra }); m.color.convertSRGBToLinear(); if (m.emissive) m.emissive.convertSRGBToLinear(); return m; };
  function box(parent, w, h, d, x, y, z, material, name = '') { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; mesh.name = name; parent.add(mesh); return mesh; }
  function label(text, sub = '', w = 4, h = 1, dark = false) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256; const c = canvas.getContext('2d');
    c.fillStyle = dark ? '#31483f' : '#ebece3'; c.fillRect(0,0,1024,256); c.fillStyle = dark ? '#e6ecda' : '#486553'; c.font = '38px "Segoe UI", "Microsoft YaHei"'; c.textAlign = 'center'; c.fillText(text,512,123,940); c.fillStyle = dark ? '#9eb5a0' : '#92a48c'; c.font = '17px Consolas'; c.fillText(sub,512,184,940);
    const texture = new THREE.CanvasTexture(canvas); texture.encoding = THREE.sRGBEncoding;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w,h), new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide})); mesh.userData.ignoreCollision = true; return mesh;
  }
  L.dispose = group => { const g = new Set(), m = new Set(), t = new Set(); group.traverse(o => { if(o.geometry) g.add(o.geometry); for(const material of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) { m.add(material); for(const value of Object.values(material)) if(value?.isTexture) t.add(value); } }); g.forEach(v=>v.dispose()); m.forEach(v=>v.dispose()); t.forEach(v=>v.dispose()); };
  L.makeDemo = () => {
    const group = new THREE.Group(), cream = mat('#e8eef8'), floorMat = mat('#d8e3f0',{roughness:.47}), wood = mat('#7e9fc8'), dark = mat('#3b608a'), plinth = mat('#e2edfb'), rim = mat('#529ce3',{metalness:.3}), glow = mat('#92d5ff',{emissive:'#51b5ff',emissiveIntensity:.7});
    const floor = box(group,28,.18,30,0,-.09,1,floorMat,'地板'); floor.userData.floor = true;
    const walls = [box(group,28,4,.22,0,2,-13.9,cream,'后墙'),box(group,.22,4,30,-13.9,2,1,cream,'西墙'),box(group,.22,4,30,13.9,2,1,cream,'东墙')]; walls.forEach(o=>o.userData.wall=true);
    for (const x of [-12.7,12.7]) for(const z of [-11.5,1,12.5]) box(group,.3,4,.3,x,2,z,dark,'立柱');
    for (const z of [-11.5,-4,4,12.5]) box(group,26,.12,.16,0,4,z,wood,'顶部梁');
    for(const x of [-9,0,9]) box(group,5,.04,.12,x,3.92,-11.3,glow,'线性灯具');
    const sign = label('MEDIA LAB / ACCESS FOR EVERYONE','NINE INSTALLATIONS. ONE SHARED SPACE.',13,2.1,true); sign.position.set(-1,2.6,-13.77); group.add(sign);
    const titles = ['光的时间','身体与气候','能量的地景','看不见的流动','城市的目光','水的记忆','空间的联系','步行的城市','城市形态实验'];
    const goals = [{id:1,name:'入口 / 集合点',x:-8,z:13}, {id:2,name:'光的时间',x:-6.6,z:-9}, {id:3,name:'中央展区',x:0,z:-1.8}, {id:4,name:'互动展台',x:6.6,z:12.7}, {id:5,name:'东侧走廊',x:11.2,z:1.5}];
    let seed = 719; const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    const miniatures=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),mat('#ffffff'),titles.length*22),miniPose=new THREE.Object3D();let miniIndex=0;miniatures.castShadow=miniatures.receiveShadow=true;miniatures.userData.ignoreCollision=true;group.add(miniatures);
    titles.forEach((title,i) => {
      const x = (i%3-1)*6.6, z = Math.floor(i/3)*7.5-6;
      box(group,4.6,.95,3.65,x,.525,z,plinth,`展台 ${i+1}`); box(group,4.76,.12,3.8,x,1.06,z,rim,'展台边缘'); box(group,4.45,.045,3.48,x,1.15,z,mat('#b3bfa7'),'模型底板');
      box(group,4.35,.025,.025,x,.16,z+1.84,glow,'展台灯带');
      const plaque=label(`0${i+1} / ${title}`,'URBAN STUDY / MEDIA LAB',3.8,.46,true); plaque.position.set(x,.77,z+1.833); group.add(plaque);
      for(let j=0;j<22;j++){const bx=(rand()-.5)*3.8,bz=(rand()-.5)*2.8,h=.08+rand()*.55;miniPose.position.set(x+bx,1.18+h/2,z+bz);miniPose.scale.set(.12+rand()*.28,h,.12+rand()*.2);miniPose.updateMatrix();miniatures.setMatrixAt(miniIndex,miniPose.matrix);miniatures.setColorAt(miniIndex++,new THREE.Color(j%4===0?'#82ae9a':'#e0dfce').convertSRGBToLinear());}
    });
    // An intentionally narrow entrance tests differing body envelopes.
    walls.push(box(group,4.1,2.4,.15,11.75,1.2,-9.7,cream,'休息区隔墙'));
    walls.push(box(group,.15,2.4,1.55,9.7,1.2,-13,cream,'窄门左侧'));
    walls.push(box(group,.15,2.4,1.4,9.7,1.2,-10.4,cream,'窄门右侧'));
    walls.forEach(o=>o.userData.wall=true);
    box(group,2.3,.42,.7,11.8,.21,-13.1,wood,'休息长椅');
    const roomSign=label('QUIET ROOM','NARROW ENTRANCE / TEST ZONE',3.2,.65);roomSign.position.set(11.7,1.8,-13.76);group.add(roomSign);
    goals.push({id:6,name:'休息区 / 窄门测试',x:11.5,z:-11.5});
    box(group,2.4,.7,.8,-10,.35,12.7,wood,'接待台');
    for(const [x,z] of [[-12,7],[12,6],[-12,-8]]) {
      const pot=new THREE.Mesh(new THREE.CylinderGeometry(.35,.25,.55,12),mat('#b3ae92'));pot.position.set(x,.275,z);pot.castShadow=true;group.add(pot);
      for(let n=0;n<3;n++){const leaves=new THREE.Mesh(new THREE.SphereGeometry(.38,9,7),mat(n%2?'#758970':'#92a385'));leaves.scale.set(.85,1.4,.85);leaves.position.set(x+Math.sin(n*2)*.19,.85+n*.2,z+Math.cos(n*2)*.17);leaves.castShadow=true;group.add(leaves);}
    }
    return {group,bounds:{minX:-14,maxX:14,minZ:-14,maxZ:16},goals,name:'Media Lab / 示例展馆',demo:true};
  };
  class SceneView {
    constructor(container) {
      this.container=container;this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#c9d5e5');this.scene.fog=new THREE.Fog('#c9d5e5',100,210);
      this.renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.outputEncoding=THREE.sRGBEncoding;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.08;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;this.shadowDirty=true;this.nextShadow=0;container.appendChild(this.renderer.domElement);this.renderer.domElement.tabIndex=0;
      this.camera=new THREE.PerspectiveCamera(40,1,.05,1500);this.camera.position.set(35,39,46);this.controls=new THREE.OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.07;this.controls.maxPolarAngle=Math.PI*.49;this.controls.minDistance=1;this.controls.maxDistance=400;this.controls.target.set(0,0,1);
      this.scene.add(new THREE.HemisphereLight('#e1edff','#65768f',.56));this.scene.add(new THREE.AmbientLight('#d9e8ff',.1));
      this.sun=new THREE.DirectionalLight('#fff9ef',2.15);this.sun.position.set(-13,26,8);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);this.sun.shadow.bias=-.00012;this.sun.shadow.normalBias=.018;this.sun.shadow.radius=2.5;this.scene.add(this.sun,this.sun.target);
      this.fill=new THREE.DirectionalLight('#bfdcff',.32);this.fill.position.set(14,16,-16);this.scene.add(this.fill);
      this.ground=box(this.scene,500,.2,500,0,-.56,0,mat('#95a3b9',{roughness:.93,envMapIntensity:.12}));
      const contextGrid=new THREE.GridHelper(240,120,'#a0b3cd','#b6c6da');contextGrid.position.y=-.448;contextGrid.material.transparent=true;contextGrid.material.opacity=.48;this.scene.add(contextGrid);
      this.heatGroup=new THREE.Group();this.overlayGroup=new THREE.Group();this.goalGroup=new THREE.Group();this.avatarGroup=new THREE.Group();this.scene.add(this.heatGroup,this.overlayGroup,this.goalGroup,this.avatarGroup);
      this.ray=new THREE.Raycaster();this.mouse=new THREE.Vector2();this.floorPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0);this.dummy=new THREE.Object3D();this.selected=-1;this.view='perspective';
      this.trailGeo=new THREE.BufferGeometry();this.trailMesh=new THREE.LineSegments(this.trailGeo,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.25,depthWrite:false}));this.scene.add(this.trailMesh);
      this.visionMesh=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#358e80',transparent:true,opacity:.35,depthWrite:false}));this.scene.add(this.visionMesh);
      for(const g of [this.heatGroup,this.overlayGroup,this.goalGroup])g.userData.noAO=true;this.pipeline=new L.PresentationPipeline(this);
      const resize=()=>{const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.pipeline.resize(w,h);};new ResizeObserver(resize).observe(container);resize();
      let start;this.renderer.domElement.addEventListener('pointerdown',e=>{start={x:e.clientX,y:e.clientY};});this.renderer.domElement.addEventListener('pointerup',e=>{if(!start||e.button!==0||Math.hypot(e.clientX-start.x,e.clientY-start.y)>5)return;const r=container.getBoundingClientRect();this.mouse.set((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);this.ray.setFromCamera(this.mouse,this.camera);const p=new THREE.Vector3(),hit=this.ray.intersectObjects(this.avatarGroup.children,false)[0],agentId=hit?.object.userData.agentIds?.[hit.instanceId];if(this.ray.ray.intersectPlane(this.floorPlane,p))this.onClick?.({x:p.x,z:p.z},{agentId});});
      this.walkKeys=new Set();this.walkYaw=Math.PI;this.walkPitch=0;this.walkClock=performance.now();window.addEventListener('keydown',e=>{if(this.view!=='walk'||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;if(['w','a','s','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))e.preventDefault();this.walkKeys.add(e.key.toLowerCase());if(e.key.toLowerCase()==='e'&&!e.repeat&&this.model?.doors){const p=this.camera.position,door=this.model.doors.filter(d=>Math.hypot(d.x-p.x,d.z-p.z)<2).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];if(door){const node=this.model.doorNodes[door.id],open=Math.abs(node.leaf.rotation.y)>.5;this.model.setDoor(door.id,open?0:1);this.shadowDirty=true;}}});window.addEventListener('keyup',e=>this.walkKeys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>this.walkKeys.clear());this.renderer.domElement.addEventListener('pointermove',e=>{if(this.view==='walk'&&e.buttons===1){this.walkYaw-=e.movementX*.004;this.walkPitch=L.clamp(this.walkPitch-e.movementY*.003,-.8,.8);}});
    }
    setModel(model,grid) {
      if(this.model&&this.model!==model){this.scene.remove(this.model.group);L.dispose(this.model.group);}this.model=model;this.grid=grid;this.scene.add(model.group);this.bounds=model.bounds;
      this.width=grid.maxX-grid.minX;this.depth=grid.maxZ-grid.minZ;this.shadowDirty=true;const extent=Math.max(this.width,this.depth,10),cx=(grid.minX+grid.maxX)/2,cz=(grid.minZ+grid.maxZ)/2;
      this.sun.position.set(cx-extent*.65,extent*1.05,cz+extent*.45);this.sun.target.position.set(cx,0,cz);Object.assign(this.sun.shadow.camera,{left:-extent*.72,right:extent*.72,top:extent*.72,bottom:-extent*.72,near:.1,far:extent*4});this.sun.shadow.camera.updateProjectionMatrix();this.controls.maxDistance=extent*4;this.camera.far=Math.max(160,extent*7);this.setView(this.view);this.makeOverlays();this.selectCell(-1);
    }
    makeOverlays(){
      for(const group of [this.heatGroup,this.overlayGroup]){L.dispose(group);group.clear();}
      const g=this.grid,s=g.cell;
      this.heatMesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(s*.94,s*.94),new THREE.MeshBasicMaterial({transparent:true,opacity:.8,depthWrite:false,side:THREE.DoubleSide,toneMapped:false}),g.size);this.heatMesh.setColorAt(0,new THREE.Color('#73bdb0'));this.heatMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.heatMesh.frustumCulled=false;this.heatMesh.count=0;this.heatGroup.add(this.heatMesh);
      const solidCount=g.solid.reduce((a,v)=>a+v,0);this.obstacles=new THREE.InstancedMesh(new THREE.BoxGeometry(s*.96,.09,s*.96),new THREE.MeshBasicMaterial({color:'#a9806e',transparent:true,opacity:.55,depthWrite:false}),solidCount);let k=0;for(let i=0;i<g.size;i++)if(g.solid[i]){const p=g.point(i);this.dummy.position.set(p.x,.06,p.z);this.dummy.rotation.set(0,0,0);this.dummy.updateMatrix();this.obstacles.setMatrixAt(k++,this.dummy.matrix);}this.obstacles.frustumCulled=false;this.overlayGroup.add(this.obstacles);this.overlayGroup.visible=false;
      if(this.gridLines){this.scene.remove(this.gridLines);L.dispose(this.gridLines);}
      const verts=[];for(let x=g.minX;x<=g.maxX;x+=1)verts.push(x,.006,g.minZ,x,.006,g.maxZ);for(let z=g.minZ;z<=g.maxZ;z+=1)verts.push(g.minX,.006,z,g.maxX,.006,z);
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));this.gridLines=new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:'#8aa7cc',transparent:true,opacity:.16,depthWrite:false}));this.scene.add(this.gridLines);
      if(this.contactShadow){this.scene.remove(this.contactShadow);L.dispose(this.contactShadow);}
      const shadowCanvas=document.createElement('canvas'),scale=Math.min(4,1400/Math.max(g.cols,g.rows));shadowCanvas.width=Math.ceil(g.cols*scale);shadowCanvas.height=Math.ceil(g.rows*scale);const shadow=shadowCanvas.getContext('2d');shadow.fillStyle='#203f67';shadow.globalAlpha=.32;for(let i=0;i<g.size;i++)if(g.solid[i])shadow.fillRect(i%g.cols*scale,Math.floor(i/g.cols)*scale,scale,scale);
      const blurred=document.createElement('canvas');blurred.width=shadowCanvas.width;blurred.height=shadowCanvas.height;const blur=blurred.getContext('2d');blur.filter=`blur(${Math.max(2,scale*1.3)}px)`;blur.drawImage(shadowCanvas,0,0);
      const texture=new THREE.CanvasTexture(blurred);this.contactShadow=new THREE.Mesh(new THREE.PlaneGeometry(g.maxX-g.minX,g.maxZ-g.minZ),new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:.65,depthWrite:false,toneMapped:false}));this.contactShadow.rotation.x=-Math.PI/2;this.contactShadow.position.set((g.minX+g.maxX)/2,.014,(g.minZ+g.maxZ)/2);this.scene.add(this.contactShadow);
    }
    setView(view){
      this.view=view;const b=this.bounds||{minX:-14,maxX:14,minZ:-14,maxZ:16},cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2,extent=Math.max(b.maxX-b.minX,b.maxZ-b.minZ,5),aspect=this.camera.aspect;
      this.controls.target.set(cx,0,cz);this.controls.enableRotate=view!=='top';
      if(view==='walk'&&this.grid){const start=this.model?.preset==='home'?{x:0,z:4.3}:{x:cx+6,z:cz+4},index=this.grid.nearest(start,.24);if(index>=0){const p=this.grid.point(index);this.camera.up.set(0,1,0);this.camera.position.set(p.x,1.65,p.z);this.walkYaw=Math.PI;this.walkPitch=0;this.walkKeys.clear();this.controls.enabled=false;this.updateWalk(0);}return;}
      if(view==='top'){this.camera.position.set(cx,extent*.6/Math.tan(this.camera.fov*Math.PI/360)/Math.min(1,aspect),cz+.001);this.camera.up.set(0,0,-1);}else if(view==='detail'){const p=this.model?.preset==='office'?{x:10.2,z:0}:{x:cx,z:cz};this.camera.up.set(0,1,0);this.controls.target.set(p.x,.7,p.z);this.camera.position.set(p.x+7,9,p.z+12);}else{this.camera.up.set(0,1,0);this.camera.position.set(cx+extent*.72,extent*1.15,cz+extent*1.13);}
      this.controls.update();
    }
    focus(p){this.controls.target.set(p.x,0,p.z);if(this.view!=='human'){this.camera.position.set(p.x+6,10,p.z+8);}this.controls.update();}
    updateGoals(goals){L.dispose(this.goalGroup);this.goalGroup.clear();goals.forEach((g,i)=>{const ring=new THREE.Mesh(new THREE.RingGeometry(.28,.36,40),new THREE.MeshBasicMaterial({color:'#0789f5',transparent:true,opacity:.9,side:THREE.DoubleSide,depthWrite:false,toneMapped:false}));ring.rotation.x=-Math.PI/2;ring.position.set(g.x,.045,g.z);this.goalGroup.add(ring);const c=document.createElement('canvas');c.width=c.height=96;const ctx=c.getContext('2d');ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(48,48,41,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#1289ee';ctx.lineWidth=5;ctx.stroke();ctx.fillStyle='#1289ee';ctx.font='bold 39px Segoe UI';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),48,49);const tex=new THREE.CanvasTexture(c);tex.encoding=THREE.sRGBEncoding;const pin=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false,toneMapped:false}));pin.position.set(g.x,.68,g.z);pin.scale.set(.55,.55,.55);this.goalGroup.add(pin);});}
    updateHeat(mode){const g=this.grid;let max=0,sampled=0;for(let i=0;i<g.size;i++){const value=g.heatValue(i,mode);max=Math.max(max,value);if(value>0)sampled++;}const palette=['#28b9e8','#ffcf61','#ffa04c','#f15d4b','#c7335d'].map(c=>new THREE.Color(c).convertSRGBToLinear());let k=0;for(let i=0;i<g.size;i++){const value=g.heatValue(i,mode);if(value<=0||g.blocked(i))continue;const t=Math.sqrt(value/Math.max(max,.001))*3.999,bin=Math.floor(t),color=palette[bin].clone().lerp(palette[Math.min(4,bin+1)],t-bin);const p=g.point(i);this.dummy.position.set(p.x,.038,p.z);this.dummy.rotation.set(-Math.PI/2,0,0);this.dummy.scale.set(1,1,1);this.dummy.updateMatrix();this.heatMesh.setMatrixAt(k,this.dummy.matrix);this.heatMesh.setColorAt(k,color);k++;}this.heatMesh.count=k;this.heatMesh.instanceMatrix.needsUpdate=true;if(this.heatMesh.instanceColor)this.heatMesh.instanceColor.needsUpdate=true;return{max,sampledArea:sampled*g.cell**2};}
    selectCell(index){if(this.highlightIndex===index)return;this.highlightIndex=index;if(this.cellHighlight){this.scene.remove(this.cellHighlight);L.dispose(this.cellHighlight);this.cellHighlight=null;}if(index<0||!this.grid)return;const p=this.grid.point(index),s=this.grid.cell;const geo=new THREE.EdgesGeometry(new THREE.BoxGeometry(s,.1,s));this.cellHighlight=new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:'#c74259',depthTest:false}));this.cellHighlight.position.set(p.x,.09,p.z);this.cellHighlight.renderOrder=100;this.scene.add(this.cellHighlight);}
    makeActors(agents){L.dispose(this.avatarGroup);this.avatarGroup.clear();this.crowdRenderer=new L.CrowdRenderer(this.avatarGroup,agents);this.actorCount=agents.length;this.shadowDirty=true;}
    updateActors(agents,time,vision,fov){if(this.actorCount!==agents.length)this.makeActors(agents);if(this.actorTime!==time){this.shadowDirty=true;this.actorTime=time;}const selected=agents.find(a=>a.id===this.selected)||agents[0];this.crowdRenderer.update(agents,time,this.view==='human'?selected?.id:-1);
      const vertices=[],colors=[];for(const a of agents){const col=new THREE.Color(a.profile.color);for(let i=1;i<a.trail.length;i++){vertices.push(a.trail[i-1].x,.055,a.trail[i-1].z,a.trail[i].x,.055,a.trail[i].z);colors.push(col.r,col.g,col.b,col.r,col.g,col.b);}}this.trailGeo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));this.trailGeo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));this.trailGeo.computeBoundingSphere();
      this.visionMesh.visible=!!vision;if(vision&&selected){const v=[],r=Math.min(4,selected.search||4),half=fov*Math.PI/360;let last=null;for(let j=0;j<=32;j++){const angle=selected.angle-half+2*half*j/32,p={x:selected.x+Math.sin(angle)*r,z:selected.z+Math.cos(angle)*r};if(last)v.push(last.x,.07,last.z,p.x,.07,p.z);if(j===0||j===32)v.push(selected.x,.07,selected.z,p.x,.07,p.z);last=p;}this.visionMesh.geometry.setAttribute('position',new THREE.Float32BufferAttribute(v,3));this.visionMesh.geometry.computeBoundingSphere();}
      if(this.view==='human'&&selected){const dir=new THREE.Vector3(Math.sin(selected.angle),0,Math.cos(selected.angle));this.controls.enabled=false;this.camera.up.set(0,1,0);this.camera.position.set(selected.x,selected.type==='wheelchair'?1.34:1.67,selected.z);this.camera.lookAt(this.camera.position.clone().add(dir.multiplyScalar(4)));}else this.controls.enabled=this.view!=='walk';
    }
    setWalls(visible){this.model?.group.traverse(o=>{if(o.userData.wall)o.visible=visible;});this.shadowDirty=true;}
    updateWalk(dt){const keys=this.walkKeys,forward=(keys.has('w')||keys.has('arrowup')?1:0)-(keys.has('s')||keys.has('arrowdown')?1:0),side=(keys.has('d')||keys.has('arrowright')?1:0)-(keys.has('a')||keys.has('arrowleft')?1:0),length=Math.hypot(forward,side)||1,speed=1.35*dt/length;let dx=(Math.sin(this.walkYaw)*forward-Math.cos(this.walkYaw)*side)*speed,dz=(Math.cos(this.walkYaw)*forward+Math.sin(this.walkYaw)*side)*speed;const p=this.camera.position,steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.06));dx/=steps;dz/=steps;const clear=(x,z)=>this.grid.isClear(x,z,.24)&&(this.model.doors||[]).every(d=>!L.residentDoorHits(d,Math.abs(this.model.doorNodes[d.id].leaf.rotation.y)/(Math.PI/2),{x,z,angle:this.walkYaw},{width:.48,length:.48}));for(let i=0;i<steps;i++){if(clear(p.x+dx,p.z+dz)){p.x+=dx;p.z+=dz;}else if(clear(p.x+dx,p.z))p.x+=dx;else if(clear(p.x,p.z+dz))p.z+=dz;}this.camera.lookAt(p.x+Math.sin(this.walkYaw)*Math.cos(this.walkPitch),p.y+Math.sin(this.walkPitch),p.z+Math.cos(this.walkYaw)*Math.cos(this.walkPitch));}
    render(){const now=performance.now();if(this.view==='walk')this.updateWalk(Math.min(.06,(now-this.walkClock)/1000));else if(this.view!=='human')this.controls.update();this.walkClock=now;if(this.shadowDirty&&now>=this.nextShadow){this.renderer.shadowMap.needsUpdate=true;this.shadowDirty=false;this.nextShadow=now+180;}this.pipeline.render();}
    snapshot(){this.render();return this.renderer.domElement.toDataURL('image/png');}
  }
  L.SceneView=SceneView;
})();


