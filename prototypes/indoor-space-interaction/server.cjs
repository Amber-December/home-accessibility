/* Local-only server. Reuse this app; skip ports owned by other apps. */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{execFile}=require('node:child_process');
const {createUsdzService}=require('./scripts/usdz-service.cjs');
const root=path.resolve(__dirname,'..'),appPrefix=__dirname+path.sep;
// Three.js r128 is shared with sibling prototypes under ../js/vendor.
const vendorPrefix=path.join(root,'js','vendor')+path.sep;
const appPath=`/${encodeURIComponent(path.basename(__dirname))}/index.html`,healthPath='/__access_lab_health__',convertPath='/__access_usdz_convert__',VERSION=3;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.cjs':'text/plain; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.png':'image/png','.json':'application/json'};
const appURL=port=>`http://127.0.0.1:${port}${appPath}`;
function createServer(){const usdz=createUsdzService(__dirname);return http.createServer((req,res)=>{
  let pathname;try{pathname=new URL(req.url,'http://localhost').pathname;}catch{res.writeHead(400).end('Bad URL');return;}
  if(pathname===healthPath){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({app:'access-spatial-twin',root:__dirname,version:VERSION,usdz:{ready:usdz.ready(),busy:usdz.busy,endpoint:convertPath,maxBytes:180*1024*1024,timeoutSeconds:180}}));return;}
  if(pathname===convertPath){usdz.handle(req,res).catch(()=>{if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({error:'USDZ 转换服务异常。'}));});return;}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'}).end('Method not allowed');return;}
  let file;try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(name.startsWith('/js/vendor/')) file=path.join(vendorPrefix,name.slice('/js/vendor/'.length));
    else file=path.resolve(root,'.'+(name==='/'?decodeURIComponent(appPath):name));
  }catch{res.writeHead(400).end('Bad URL');return;}
  if(!file.startsWith(appPrefix)&&!file.startsWith(vendorPrefix)){res.writeHead(403).end('Forbidden');return;}
  if(file.startsWith(appPrefix)){const relative=path.relative(__dirname,file),parts=relative.split(path.sep);if(parts.some(p=>p.startsWith('.'))||['scripts','tests'].includes(parts[0].toLowerCase())||['.cjs','.py','.bat'].includes(path.extname(file).toLowerCase())||path.basename(file).toLowerCase()==='requirements-usd.txt'){res.writeHead(403).end('Forbidden');return;}}
  fs.stat(file,(error,stat)=>{if(error||!stat.isFile()){res.writeHead(404).end('Not found');return;}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});if(req.method==='HEAD'){res.end();return;}const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);});
});}
function get(port,url){return new Promise(resolve=>{const request=http.get({hostname:'127.0.0.1',port,path:url,timeout:1000},res=>{let body='';res.on('data',chunk=>{if(body.length<65536)body+=chunk;});res.on('end',()=>resolve({status:res.statusCode,body}));});request.on('timeout',()=>request.destroy());request.on('error',()=>resolve(null));});}
async function isOurApp(port){const health=await get(port,healthPath);if(health?.status===200){try{const data=JSON.parse(health.body);return data.app==='access-spatial-twin'&&path.resolve(data.root)===__dirname&&data.version>=VERSION&&data.usdz?.endpoint===convertPath;}catch{return false;}}
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
