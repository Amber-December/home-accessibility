const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const url='http://127.0.0.1:8910/'+encodeURIComponent('室内空间交互')+'/index.html?quality=balanced';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.IndoorLab?.app?.simulation&&!window.IndoorLab.app.busy,{timeout:60000});
  for(const style of ['access','editorial','surreal']){await page.locator('#render-style').selectOption(style);await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>IndoorLab.app.view.pipeline.style),style);await page.screenshot({path:path.join(__dirname,`style-${style}.png`),fullPage:true});}
  await page.locator('#operation-mode').selectOption('crowd');await page.waitForFunction(()=>!IndoorLab.app.busy&&!IndoorLab.app.simulation.isResident,{timeout:60000});
  await page.locator('#disaster-type').selectOption('fire');await page.locator('#disaster-start').click();await page.waitForFunction(()=>IndoorLab.app.disaster?.constructor?.name==='FireModel',{timeout:10000});
  const fire=await page.evaluate(()=>{const s=IndoorLab.app.simulation;for(let i=0;i<600;i++)s.tick(1/30);return IndoorLab.app.disaster.summary();});
  assert(fire.ignitedCells>1&&fire.burningCells>0&&fire.dangerousCells>0);await page.screenshot({path:path.join(__dirname,'fire-browser.png'),fullPage:true});
  await page.locator('#disaster-reset').click();await page.locator('#disaster-type').selectOption('earthquake');await page.locator('#disaster-start').click();await page.waitForFunction(()=>IndoorLab.app.disaster?.constructor?.name==='EarthquakeScenario',{timeout:10000});
  const quake=await page.evaluate(()=>{const s=IndoorLab.app.simulation;for(let i=0;i<360;i++)s.tick(1/30);return IndoorLab.app.disaster.summary();});
  assert(quake.collapsed>=1&&quake.events>=1);await page.screenshot({path:path.join(__dirname,'earthquake-browser.png'),fullPage:true});
  const unexpected=errors.filter(e=>!e.includes('请检查单位或向上轴'));assert.deepEqual(unexpected,[]);console.log('PASS: three render styles, fire propagation / evacuation and earthquake collapse / debris browser flows.');console.log({fire,quake});
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
