const assert=require('node:assert/strict'),http=require('node:http');
const{start,isOurApp}=require('../server.cjs');
(async()=>{const foreign=http.createServer((req,res)=>res.end('unrelated application'));await new Promise(resolve=>foreign.listen(0,'127.0.0.1',resolve));const port=foreign.address().port;let own;
 try{const first=await start({port,open:false,log:()=>{}});own=first.server;assert(!first.reused);assert(first.port>port);assert(await isOurApp(first.port));const repeated=await start({port,open:false,log:()=>{}});assert(repeated.reused);assert.equal(repeated.port,first.port);assert.equal(repeated.server,null);assert.equal(await isOurApp(port),false);console.log('PASS: foreign occupied port skipped; repeated launch reuses the correct local app.');}
 finally{if(own)await new Promise(resolve=>own.close(resolve));await new Promise(resolve=>foreign.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
