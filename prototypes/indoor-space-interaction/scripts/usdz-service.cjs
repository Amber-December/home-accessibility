/* OpenUSD bridge: streamed local uploads, one process, and content-addressed cache. */
'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');
const MAX_UPLOAD=180*1024*1024,TIMEOUT_MS=180000,MAX_OUTPUT=768*1024*1024;
function json(res,status,error){if(!res.headersSent&&!res.destroyed)res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Connection':'close'}).end(JSON.stringify({error}));}
function localRequest(req){
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return false;
  try{
    const base=new URL('http://'+req.headers.host),origin=new URL(req.headers.origin||'');
    return ['127.0.0.1','localhost','[::1]'].includes(base.hostname)&&Number(base.port||80)===req.socket.localPort&&origin.origin===base.origin&&origin.protocol==='http:'&&(!req.headers['sec-fetch-site']||req.headers['sec-fetch-site']==='same-origin');
  }catch{return false;}
}
function createUsdzService(appRoot,{pythonPath=process.env.ACCESS_USD_PYTHON||path.join(appRoot,'.runtime','python',...(process.platform==='win32'?['Scripts','python.exe']:['bin','python'])),scriptPath=path.join(appRoot,'scripts','convert_usdz.py'),timeoutMs=TIMEOUT_MS}={}){
  const cacheRoot=path.join(appRoot,'.cache','usdz');let active=false;
  function ready(){return fs.existsSync(pythonPath)&&fs.existsSync(scriptPath);}
  function convert(input,output,res){return new Promise((resolve,reject)=>{
    const child=spawn(pythonPath,['-u',scriptPath,input,output],{cwd:appRoot,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});let stdout='',stderr='',timeout=false,closed=false;
    const timer=setTimeout(()=>{timeout=true;child.kill();},timeoutMs);
    const aborted=()=>{if(!res.writableEnded){closed=true;child.kill();}};res.once('close',aborted);
    child.stdout.on('data',v=>{stdout=(stdout+v.toString('utf8')).slice(-65536);});child.stderr.on('data',v=>{stderr=(stderr+v.toString('utf8')).slice(-65536);});
    child.once('error',error=>{clearTimeout(timer);res.off('close',aborted);reject(error);});
    child.once('close',code=>{clearTimeout(timer);res.off('close',aborted);if(closed)return reject(Object.assign(new Error('客户端已断开。'),{status:499}));if(timeout)return reject(Object.assign(new Error('USDZ 转换超过 180 秒，请简化模型后重试。'),{status:504}));if(code!==0){const diagnostic=(stderr||stdout).trim().split(/\r?\n/).slice(-4).join('\n');return reject(new Error('USDZ 转换失败：'+(diagnostic||'OpenUSD 进程退出。')));}resolve();});
  });}
  async function validGLB(file){try{const stat=await fsp.stat(file);if(!stat.isFile()||stat.size<20||stat.size>MAX_OUTPUT)return false;const handle=await fsp.open(file,'r');try{const b=Buffer.alloc(12);await handle.read(b,0,12,0);return b.readUInt32LE(0)===0x46546c67&&b.readUInt32LE(4)===2&&b.readUInt32LE(8)===stat.size;}finally{await handle.close();}}catch{return false;}}
  async function handle(req,res){
    if(req.method!=='POST'){res.setHeader('Allow','POST');json(res,405,'USDZ 转换仅接受 POST。');return;}
    if(!localRequest(req)){json(res,403,'仅允许从此本机应用的同源页面提交模型。');req.resume();return;}
    if(!ready()){json(res,503,'本机 USDZ 支持未安装，请运行「安装USDZ支持.bat」后重新启动。');req.resume();return;}
    const length=Number(req.headers['content-length']);if(Number.isFinite(length)&&length>MAX_UPLOAD){json(res,413,'USDZ 超过 180 MB，请先简化模型。');req.resume();return;}
    if(active){res.setHeader('Retry-After','5');json(res,503,'另一个 USDZ 模型正在转换，请等待完成后重试。');req.resume();return;}
    active=true;let temp=null,uploadTimer,cleaned=false;
    async function cleanup(){
      if(cleaned)return;
      cleaned=true;
      clearTimeout(uploadTimer);
      if(temp){const dir=temp;temp=null;await fsp.rm(dir,{recursive:true,force:true}).catch(()=>{});}
    }
    try{
      await fsp.mkdir(cacheRoot,{recursive:true});temp=await fsp.mkdtemp(path.join(cacheRoot,'upload-'));const input=path.join(temp,'input.usdz'),output=path.join(temp,'output.glb');
      const digest=crypto.createHash('sha256');let bytes=0,tooLarge=false,signature=Buffer.alloc(0);
      const upload=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;if(bytes>MAX_UPLOAD){tooLarge=true;return done();}if(signature.length<4)signature=Buffer.concat([signature,chunk.subarray(0,4-signature.length)]);digest.update(chunk);done(null,chunk);}});
      uploadTimer=setTimeout(()=>req.destroy(new Error('USDZ 上传超时。')),timeoutMs);
      await pipeline(req,upload,fs.createWriteStream(input,{flags:'wx'}));clearTimeout(uploadTimer);
      if(tooLarge)throw Object.assign(new Error('USDZ 超过 180 MB，请先简化模型。'),{status:413});
      if(bytes<30||signature.readUInt32LE(0)!==0x04034b50)throw Object.assign(new Error('文件不是有效的 USDZ ZIP 归档。'),{status:400});
      const converter=await fsp.readFile(scriptPath),requirements=await fsp.readFile(path.join(appRoot,'requirements-usd.txt')).catch(()=>Buffer.alloc(0));
      const version=crypto.createHash('sha256').update('access-usdz-v1').update(converter).update(requirements).digest('hex').slice(0,16),sourceHash=digest.digest('hex'),cache=path.join(cacheRoot,sourceHash+'-'+version+'.glb');
      const cached=await validGLB(cache);
      if(!cached){await convert(input,output,res);if(!await validGLB(output))throw new Error('OpenUSD 未生成有效 GLB，原场景保持不变。');await fsp.rename(output,cache);}
      if(res.destroyed)return;
      await cleanup();
      // The cache file is complete and immutable at this point. Release the
      // conversion gate before streaming it so an immediate cache retry is
      // accepted as soon as the first response finishes.
      active=false;
      const stat=await fsp.stat(cache);res.writeHead(200,{'Content-Type':'model/gltf-binary','Content-Length':stat.size,'Cache-Control':'no-store','X-Access-USDZ-Cache':cached?'hit':'miss','X-Access-USDZ-SHA256':sourceHash,'X-Access-USDZ-Converter':version,'X-Content-Type-Options':'nosniff'});
      await pipeline(fs.createReadStream(cache),res);
    }catch(error){
      // Release the single-conversion gate before writing the error response.
      // The client may retry as soon as it receives that response; waiting for
      // asynchronous temp-file cleanup here would otherwise produce a false
      // "another model is converting" 503 on the immediate retry.
      active=false;
      await cleanup();
      if(error.status!==499)json(res,error.status||500,error.message||'USDZ 转换失败。');
    }
    finally{await cleanup();active=false;}
  }
  return{handle,ready,get busy(){return active;}};
}
module.exports={createUsdzService,MAX_UPLOAD,TIMEOUT_MS,localRequest};
