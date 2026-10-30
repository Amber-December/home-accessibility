// Generate equivalent tiny rooms in real file formats and exercise local browser loaders.
const{chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),vertices=[],faces=[];
function box(x0,y0,z0,x1,y1,z1){const n=vertices.length;vertices.push([x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]);for(const q of [[0,1,2,3],[4,7,6,5],[0,4,5,1],[3,2,6,7],[0,3,7,4],[1,5,6,2]]){faces.push([q[0]+n,q[1]+n,q[2]+n],[q[0]+n,q[2]+n,q[3]+n]);}}
box(-5,-.2,-4,5,0,4);box(-5,0,-4,-4.8,3,4);box(4.8,0,-4,5,3,4);box(-5,0,-4,5,3,-3.8);box(-.8,0,-.6,.8,1,.6);
const zup=vertices.map(([x,y,z])=>[x,-z,y]);
function chunk(id,...parts){const body=Buffer.concat(parts),head=Buffer.alloc(6);head.writeUInt16LE(id);head.writeUInt32LE(body.length+6,2);return Buffer.concat([head,body]);}
function tds(){const v=Buffer.alloc(2+vertices.length*12);v.writeUInt16LE(vertices.length);zup.flat().forEach((x,i)=>v.writeFloatLE(x,2+i*4));const f=Buffer.alloc(2+faces.length*8);f.writeUInt16LE(faces.length);faces.forEach((t,i)=>t.forEach((x,j)=>f.writeUInt16LE(x,2+i*8+j*2)));return chunk(0x4d4d,chunk(0x3d3d,chunk(0x4000,Buffer.from('room\0'),chunk(0x4100,chunk(0x4110,v),chunk(0x4120,f)))));}
function gltf(glb){const positions=Buffer.alloc(vertices.length*12);vertices.flat().forEach((n,i)=>positions.writeFloatLE(n,i*4));const indices=Buffer.alloc(faces.length*6);faces.flat().forEach((n,i)=>indices.writeUInt16LE(n,i*2));const bin=Buffer.concat([positions,indices]);const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.length},{buffer:0,byteOffset:positions.length,byteLength:indices.length}],accessors:[{bufferView:0,componentType:5126,count:vertices.length,type:'VEC3',min:[-5,-.2,-4],max:[5,3,4]},{bufferView:1,componentType:5123,count:faces.length*3,type:'SCALAR'}]};if(!glb){doc.buffers[0].uri='data:application/octet-stream;base64,'+bin.toString('base64');return Buffer.from(JSON.stringify(doc));}let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);const padded=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]),header=Buffer.alloc(12),jh=Buffer.alloc(8),bh=Buffer.alloc(8);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+json.length+8+padded.length,8);jh.writeUInt32LE(json.length);jh.writeUInt32LE(0x4e4f534a,4);bh.writeUInt32LE(padded.length);bh.writeUInt32LE(0x004e4942,4);return Buffer.concat([header,jh,json,bh,padded]);}
function dae(){return Buffer.from(`<?xml version="1.0"?><COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1"><asset><unit name="meter" meter="1"/><up_axis>Y_UP</up_axis></asset><library_geometries><geometry id="room"><mesh><source id="positions"><float_array id="array" count="${vertices.length*3}">${vertices.flat().join(' ')}</float_array><technique_common><accessor source="#array" count="${vertices.length}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="v"><input semantic="POSITION" source="#positions"/></vertices><triangles count="${faces.length}"><input semantic="VERTEX" source="#v" offset="0"/><p>${faces.flat().join(' ')}</p></triangles></mesh></geometry></library_geometries><library_visual_scenes><visual_scene id="Scene"><node id="room-node"><instance_geometry url="#room"/></node></visual_scene></library_visual_scenes><scene><instance_visual_scene url="#Scene"/></scene></COLLADA>`);}
function fbx(){return Buffer.from(`; FBX 7.4.0 project file
FBXHeaderExtension:  {
 FBXHeaderVersion: 1003
 FBXVersion: 7400
}
Objects:  {
 Geometry: 1, "Geometry::room", "Mesh" {
  Vertices: *${vertices.length*3} {
   a: ${vertices.flat().join(',')}
  }
  PolygonVertexIndex: *${faces.length*3} {
   a: ${faces.flatMap(f=>[f[0],f[1],-f[2]-1]).join(',')}
  }
 }
 Model: 2, "Model::room", "Mesh" {
  Version: 232
  Properties70:  {
   P: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
   P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
   P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
  }
 }
}
Connections:  {
 C: "OO",1,2
 C: "OO",2,0
}
`);}
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{const page=await browser.newPage({viewport:{width:1400,height:950}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});page.on('console',m=>{if(['error','warn'].includes(m.type()))console.log('BROWSER',m.text().slice(0,600));});page.on('requestfailed',r=>console.log('REQUEST FAILED',r.url(),r.failure()));page.on('worker',w=>w.evaluate(()=>self.addEventListener('unhandledrejection',e=>console.error('WORKER REJECTION',String(e.reason)))).catch(()=>{}));await page.goto('http://127.0.0.1:8910/'+'indoor-space-interaction'+'/index.html?quality=balanced');await page.waitForFunction(()=>IndoorLab.app.simulation&&!IndoorLab.app.busy);
 const cases=[['room.3ds',tds()],['room.glb',gltf(true)],['room.gltf',gltf(false)],['room.dae',dae()],['room.fbx',Buffer.from(fbx().toString().replace(/^ +/gm,s=>'\t'.repeat(s.length)))]];
 for(const[name,buffer]of cases){if(name.endsWith('.fbx'))console.log('FBX PARSE',await page.evaluate(text=>{try{new THREE.FBXLoader().parse(new TextEncoder().encode(text).buffer,'');return'ok';}catch(e){return e.stack;}},buffer.toString()));await page.locator('#model-files').setInputFiles({name,mimeType:'application/octet-stream',buffer});await page.waitForFunction(name=>!IndoorLab.app.busy&&IndoorLab.app.model.name===name,name,{timeout:40000}).catch(async e=>{console.log('IMPORT ERROR',name,await page.locator('#toast').textContent());throw e;});const result=await page.evaluate(()=>{const a=IndoorLab.app;return{centerBlocked:!!a.grid.blocked(a.grid.index(0,0)),sideClear:a.grid.isClear(2,1,.45),hasFloor:a.grid.meta.hasFloor,source:a.model.source};});console.log(name,result);assert(result.centerBlocked,name+' missing furniture collider');assert(result.sideClear,name+' room falsely blocked');assert(result.hasFloor,name+' floor missing');}
 assert.deepEqual(errors,[]);console.log('PASS: real 3DS, GLB, GLTF, Collada and FBX files, floor support and furniture collision.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});


