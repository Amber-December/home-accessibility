/* Local-only server. Reuse this app; skip ports owned by other apps. */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{execFile}=require('node:child_process');
const {createUsdzService}=require('./scripts/usdz-service.cjs');
const {createLux3dService}=require('./scripts/lux3d-service.cjs');
const root=path.resolve(__dirname,'..'),appPrefix=__dirname+path.sep;
// The indoor app reuses the pinned Three.js runtime from the sibling
// InteractiveEarth project. Keep the URL stable as /js/vendor/... while
// resolving it to the actual shared vendor directory on disk.
const vendorPrefix=path.join(root,'交互地球','InteractiveEarth','js','vendor')+path.sep;
const appPath=`/${encodeURIComponent(path.basename(__dirname))}/index.html`,healthPath='/__access_lab_health__',convertPath='/__access_usdz_convert__',lux3dPath='/__lux3d_generate__',lux3dAssets='/__lux3d_assets__/',aiPath='/__ai_interpret__',modelLibraryPath='/__model_library__',modelLibraryRoot=path.resolve(__dirname,'..','测试模型','模型替换'),VERSION=6;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.cjs':'text/plain; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.png':'image/png','.json':'application/json','.glb':'model/gltf-binary','.gltf':'model/gltf+json','.bin':'application/octet-stream','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
const appURL=port=>`http://127.0.0.1:${port}${appPath}`;
const aiModel=process.env.ACCESS_AI_MODEL||'gpt-5.6';
const aiSchema={type:'object',additionalProperties:false,properties:{profile:{type:'object',additionalProperties:false,properties:{type:{type:'string',enum:['wheelchair','electricWheelchair','assisted','blind','upper','pedestrian']},width:{type:['number','null']},length:{type:['number','null']},speed:{type:['number','null']},reach:{type:['number','null']},maxHeight:{type:['number','null']},doorEffort:{type:['number','null']}},required:['type','width','length','speed','reach','maxHeight','doorEffort']},schedule:{type:'array',items:{type:'object',additionalProperties:false,properties:{targetId:{type:['string','null']},name:{type:'string'},x:{type:['number','null']},z:{type:['number','null']},time:{type:'string'}},required:['targetId','name','x','z','time']}},notes:{type:'string'}},required:['profile','schedule','notes']};
function sendJson(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(payload));}
function readJson(req,maxBytes=256*1024){return new Promise((resolve,reject)=>{let size=0,body='';req.setEncoding('utf8');req.on('data',chunk=>{size+=Buffer.byteLength(chunk);if(size>maxBytes){reject(new Error('请求内容过大。'));req.destroy();return;}body+=chunk;});req.on('end',()=>{try{resolve(body?JSON.parse(body):{});}catch{reject(new Error('请求不是有效 JSON。'));}});req.on('error',reject);});}
function responseText(data){if(typeof data?.output_text==='string')return data.output_text;for(const item of data?.output||[])for(const part of item.content||[]){if(typeof part.text==='string')return part.text;if(typeof part.text?.value==='string')return part.text.value;}return '';}
async function handleAI(req,res){if(req.method!=='POST'){res.writeHead(405,{'Allow':'POST'}).end('Method not allowed');return;}if(!process.env.OPENAI_API_KEY){sendJson(res,503,{error:'未配置 OPENAI_API_KEY。请在启动本地服务的进程中设置环境变量；前端会自动回退本地解析。'});return;}let body;try{body=await readJson(req);}catch(error){sendJson(res,400,{error:error.message});return;}const person=String(body.person||''),schedule=String(body.schedule||''),scene=Array.isArray(body.scene)?body.scene.slice(0,100):[];if(!person&&!schedule){sendJson(res,400,{error:'缺少人物描述或行程描述。'});return;}const system=`你是室内无障碍仿真助手。只根据给出的场景实体选择人物类型、人体包络参数和一日行程。目的地必须优先使用 scene 中已有实体的 targetId 与坐标；不要创造场景外坐标。人物参数单位：宽度、长度、触达、最高触达为米，速度为米每秒，门操作阻力为 0 到 1。把“床、沙发、冰箱、卫生间、入户门”等词映射到最匹配实体。输出严格符合 JSON Schema。`;const user=`人物描述：${person||'普通步行者'}\n行程描述：${schedule||'未提供'}\n场景实体：${JSON.stringify(scene)}`;try{const upstream=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:aiModel,input:[{role:'system',content:[{type:'input_text',text:system}]},{role:'user',content:[{type:'input_text',text:user}]}],text:{format:{type:'json_schema',name:'indoor_schedule',strict:true,schema:aiSchema}}})});const data=await upstream.json().catch(()=>({}));if(!upstream.ok){sendJson(res,upstream.status>=400&&upstream.status<500?upstream.status:502,{error:data?.error?.message||'GPT-5.6 请求失败。'});return;}let parsed;try{parsed=JSON.parse(responseText(data).replace(/^```json\s*|\s*```$/g,''));}catch{sendJson(res,502,{error:'GPT-5.6 返回的结构化结果无法解析。'});return;}parsed.source='gpt-5.6';sendJson(res,200,parsed);}catch(error){sendJson(res,502,{error:`GPT-5.6 服务不可用：${error.message}`});}}
async function readArticulationMetadata(folder){
  const candidates=['关节检查.json','model_spec.json','visual_metadata.json'];
  for(const name of candidates){
    try{
      const raw=await fs.promises.readFile(path.join(folder,name),'utf8');
      const parsed=JSON.parse(raw);
      const joints=Array.isArray(parsed?.joints)?parsed.joints:[];
      if(joints.length||name==='model_spec.json'){
        return {source:name,joints:joints.map(j=>({
          name:j.name||j.label||'',label:j.label||j.name||'',type:j.type||'revolute',
          axis:Array.isArray(j.axis)?j.axis.slice(0,3):Array.isArray(j.axis_gltf)?j.axis_gltf.slice(0,3):null,
          lower:Number.isFinite(Number(j.lower))?Number(j.lower):0,
          upper:Number.isFinite(Number(j.upper))?Number(j.upper):1,
          origin:Array.isArray(j.origin)?j.origin.slice(0,3):null
        }))};
      }
    }catch{}
  }
  return null;
}
async function listModelLibrary(){const items=[];const allowed=/^(model|articulated_pbr)\.glb$/i;const previewNames=['preview_closed.png','preview_view0.png','preview_open.png','reference.jpg','reference.png','preview.jpg','thumbnail.png'];async function findPreview(folder,relativeDir){for(const name of previewNames){try{const file=path.join(folder,name),stat=await fs.promises.stat(file);if(stat.isFile())return `${modelLibraryPath}/${path.join(relativeDir,name).split(path.sep).map(encodeURIComponent).join('/')}`;}catch{}}return null;}async function walk(dir,relative=''){let entries=[];try{entries=await fs.promises.readdir(dir,{withFileTypes:true});}catch{return;}for(const entry of entries){if(entry.name.startsWith('.'))continue;const full=path.join(dir,entry.name),rel=path.join(relative,entry.name);if(entry.isDirectory())await walk(full,rel);else if(allowed.test(entry.name)&&relative.split(path.sep).length===2){const category=relative.split(path.sep)[0]||'未分类',id=path.basename(path.dirname(rel)),key=`${category}/${id}`,folder=path.dirname(full),articulation=await readArticulationMetadata(folder),preview=await findPreview(folder,path.dirname(rel)),item={id:`${key}/${entry.name}`,category,variant:id,name:`${category} · ${id}`,url:`${modelLibraryPath}/${rel.split(path.sep).map(encodeURIComponent).join('/')}`,preview,articulation},existing=items.find(candidate=>candidate.category===category&&candidate.variant===id);if(existing){if(/model\.glb$/i.test(entry.name)){items.splice(items.indexOf(existing),1,item);}continue;}items.push(item);}}}await walk(modelLibraryRoot);return items;}
async function handleModelLibrary(req,res,pathname){if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{'Allow':'GET, HEAD'}).end('Method not allowed');return;}if(pathname===modelLibraryPath){try{sendJson(res,200,{root:'local-test-models',items:await listModelLibrary()});}catch(error){sendJson(res,500,{error:error.message||'模型库读取失败。'});}return;}const prefix=modelLibraryPath+'/';if(!pathname.startsWith(prefix)){res.writeHead(404).end('Not found');return;}let rel;try{rel=pathname.slice(prefix.length).split('/').filter(Boolean).map(decodeURIComponent).join(path.sep);}catch{res.writeHead(400).end('Bad URL');return;}const file=path.resolve(modelLibraryRoot,rel);if(!file.startsWith(modelLibraryRoot+path.sep)||!/\.(glb|gltf|bin|png|jpe?g|webp)$/i.test(file)){res.writeHead(403).end('Forbidden');return;}fs.stat(file,(error,stat)=>{if(error||!stat.isFile()){res.writeHead(404).end('Not found');return;}res.writeHead(200,{'Content-Type':types[path.extname(file).toLowerCase()]||'application/octet-stream','Cache-Control':'no-cache'});if(req.method==='HEAD'){res.end();return;}fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);});}
function createServer(){const usdz=createUsdzService(__dirname),lux3d=createLux3dService(__dirname,{endpoint:lux3dPath});return http.createServer((req,res)=>{
  let pathname;try{pathname=new URL(req.url,'http://localhost').pathname;}catch{res.writeHead(400).end('Bad URL');return;}
  if(pathname===healthPath){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({app:'access-spatial-twin',root:__dirname,version:VERSION,usdz:{ready:usdz.ready(),busy:usdz.busy,endpoint:convertPath,maxBytes:180*1024*1024,timeoutSeconds:180},lux3d:{configured:lux3d.ready(),busy:lux3d.busy,endpoint:lux3dPath,region:'cn'},ai:{configured:!!process.env.OPENAI_API_KEY,model:aiModel,endpoint:aiPath}}));return;}
  if(pathname===convertPath){usdz.handle(req,res).catch(()=>{if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({error:'USDZ 转换服务异常。'}));});return;}
  if(pathname===lux3dPath){lux3d.handle(req,res).catch(()=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Lux3D 生成服务异常。'}));});return;}
  if(pathname===aiPath){handleAI(req,res).catch(error=>{if(!res.headersSent)sendJson(res,502,{error:error.message||'AI 服务异常。'});});return;}
  if(pathname===modelLibraryPath||pathname.startsWith(modelLibraryPath+'/')){handleModelLibrary(req,res,pathname);return;}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'}).end('Method not allowed');return;}
  let file;try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(name.startsWith(lux3dAssets)){const asset=path.basename(name.slice(lux3dAssets.length));if(!/^[a-f0-9]{12,64}\.glb$/i.test(asset)){res.writeHead(404).end('Not found');return;}file=path.join(lux3d.cacheRoot,asset);}
    else if(name.startsWith('/js/vendor/')) file=path.join(vendorPrefix,name.slice('/js/vendor/'.length));
    else file=path.resolve(root,'.'+(name==='/'?decodeURIComponent(appPath):name));
  }catch{res.writeHead(400).end('Bad URL');return;}
  if(!file.startsWith(appPrefix)&&!file.startsWith(vendorPrefix)&&!file.startsWith(lux3d.cacheRoot+path.sep)&&!file.startsWith(modelLibraryRoot+path.sep)){res.writeHead(403).end('Forbidden');return;}
  if(file.startsWith(appPrefix)){const relative=path.relative(__dirname,file),parts=relative.split(path.sep);if(parts.some(p=>p.startsWith('.'))||['scripts','tests'].includes(parts[0].toLowerCase())||['.cjs','.py','.bat'].includes(path.extname(file).toLowerCase())||path.basename(file).toLowerCase()==='requirements-usd.txt'){res.writeHead(403).end('Forbidden');return;}}
  fs.stat(file,(error,stat)=>{if(error||!stat.isFile()){res.writeHead(404).end('Not found');return;}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});if(req.method==='HEAD'){res.end();return;}const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);});
});}
function get(port,url){return new Promise(resolve=>{const request=http.get({hostname:'127.0.0.1',port,path:url,timeout:1000},res=>{let body='';res.on('data',chunk=>{if(body.length<65536)body+=chunk;});res.on('end',()=>resolve({status:res.statusCode,body}));});request.on('timeout',()=>request.destroy());request.on('error',()=>resolve(null));});}
async function isOurApp(port){const health=await get(port,healthPath);if(health?.status===200){try{const data=JSON.parse(health.body);return data.app==='access-spatial-twin'&&path.resolve(data.root)===__dirname&&data.version>=VERSION&&data.usdz?.endpoint===convertPath&&data.lux3d?.endpoint===lux3dPath;}catch{return false;}}
  // Older running servers cannot serve the new conversion endpoint. Launch a
  // version 3 server on the next port instead of opening a stale application.
  return false;
}
function openBrowser(url){execFile('cmd.exe',['/c','start','',url],{windowsHide:true},()=>{});}
async function start({port=Number(process.env.ACCESS_PORT)||8910,open=!process.argv.includes('--no-open'),log=console.log,maxAttempts=25}={}){
  for(let offset=0;offset<maxAttempts;offset++){
    const candidate=port+offset,server=createServer();
    const error=await new Promise(resolve=>{server.once('error',resolve);server.listen(candidate,'127.0.0.1',()=>{server.removeListener('error',resolve);resolve(null);});});
    if(!error){const url=appURL(candidate);log(`ACCESS 本地服务已启动\n${url}\n请保持此窗口开启；Ctrl+C 停止服务。`);if(open)openBrowser(url);return{server,port:candidate,url,reused:false};}
    if(error.code!=='EADDRINUSE')throw error;
    if(await isOurApp(candidate)){const url=appURL(candidate);log(`检测到已运行的 ACCESS，正在复用已有服务。\n${url}`);if(open)openBrowser(url);return{server:null,port:candidate,url,reused:true};}
    log(`端口 ${candidate} 由其他程序使用，正在尝试下一个端口…`);
  }
  throw new Error('没有找到可用端口。请设置 ACCESS_PORT 后重试。');
}
if(require.main===module)start().catch(error=>{console.error(`启动失败：${error.message}`);process.exitCode=1;});
module.exports={start,createServer,isOurApp,appURL,VERSION};
