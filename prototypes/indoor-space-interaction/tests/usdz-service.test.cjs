// Exercise the real local upload -> OpenUSD -> GLB path with a tiny USDZ room.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os'),http=require('node:http'),{execFileSync}=require('node:child_process');
const appRoot=path.resolve(__dirname,'..'),{createServer}=require('../server.cjs');
function request(port,url,options={}){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:url,method:options.method||'GET',headers:options.headers||{}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);req.end(options.body);});}
(async()=>{
  const temp=await fsp.mkdtemp(path.join(os.tmpdir(),'access-usdz-service-')),python=process.env.ACCESS_USD_PYTHON||path.join(appRoot,'.runtime','python',...(process.platform==='win32'?['Scripts','python.exe']:['bin','python'])),server=createServer();
  try{
    const code=`from pxr import Usd, UsdGeom, UsdUtils, Sdf\nimport sys, os\np=sys.argv[1]\ns=Usd.Stage.CreateNew(os.path.join(p,'room.usda'))\nUsdGeom.SetStageUpAxis(s,UsdGeom.Tokens.z)\nUsdGeom.SetStageMetersPerUnit(s,1.0)\nr=UsdGeom.Xform.Define(s,'/Room');s.SetDefaultPrim(r.GetPrim())\ndef box(name,mn,mx):\n m=UsdGeom.Mesh.Define(s,'/Room/'+name)\n x,y,z=mn;X,Y,Z=mx\n m.CreatePointsAttr([(x,y,z),(X,y,z),(X,Y,z),(x,Y,z),(x,y,Z),(X,y,Z),(X,Y,Z),(x,Y,Z)])\n m.CreateFaceVertexCountsAttr([4]*6)\n m.CreateFaceVertexIndicesAttr([0,3,2,1,4,5,6,7,0,1,5,4,1,2,6,5,2,3,7,6,3,0,4,7])\n m.CreateSubdivisionSchemeAttr('none')\nbox('Floor',(-3,-2,-.15),(3,2,0))\nbox('Wall',(-3,-2,0),(-2.8,2,2.7))\nbox('Table',(-.6,-.4,0),(.6,.4,.8))\ns.GetRootLayer().Save()\nassert UsdUtils.CreateNewUsdzPackage(Sdf.AssetPath(s.GetRootLayer().identifier),os.path.join(p,'room.usdz'))\n`;
    execFileSync(python,['-c',code,temp],{windowsHide:true,env:{...process.env,PYTHONUTF8:'1'}});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port,origin='http://127.0.0.1:'+port,route='/__access_usdz_convert__',body=await fsp.readFile(path.join(temp,'room.usdz'));
    const health=JSON.parse((await request(port,'/__access_lab_health__')).body);assert.equal(health.version,3);assert.equal(health.usdz.ready,true);
    for(const name of ['.runtime/python/Scripts/python.exe','.cache/usdz/anything.glb','scripts/convert_usdz.py','server.cjs'])assert.equal((await request(port,'/'+encodeURIComponent(path.basename(appRoot))+'/'+name)).status,403,name);
    assert.equal((await request(port,route)).status,405);
    assert.equal((await request(port,route,{method:'POST',body})).status,403);
    assert.equal((await request(port,route,{method:'POST',headers:{Origin:'https://example.invalid'},body})).status,403);
    assert.equal((await request(port,route,{method:'POST',headers:{Origin:origin,'Content-Length':181*1024*1024}})).status,413);
    assert.equal((await request(port,route,{method:'POST',headers:{Origin:origin},body:Buffer.alloc(30)})).status,400);
    const first=await request(port,route,{method:'POST',headers:{Origin:origin},body});assert.equal(first.status,200,first.body.toString().slice(0,600));assert.equal(first.body.subarray(0,4).toString(),'glTF');assert.equal(first.headers['content-type'],'model/gltf-binary');
    const jsonLength=first.body.readUInt32LE(12),gltf=JSON.parse(first.body.subarray(20,20+jsonLength));assert(gltf.meshes.length>=3,'Room furniture must survive conversion');
    const second=await request(port,route,{method:'POST',headers:{Origin:origin},body});assert.equal(second.status,200);assert.equal(second.headers['x-access-usdz-cache'],'hit');assert(first.body.equals(second.body));
    const files=await fsp.readdir(path.join(appRoot,'.cache','usdz'));assert(!files.some(n=>n.startsWith('upload-')),'Temporary uploads must be removed');
    console.log('PASS: real USDZ upload / OpenUSD conversion / geometry / cache / origin and size restrictions / private directories / temporary cleanup.');
  }finally{await new Promise(resolve=>server.close(resolve));await fsp.rm(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
