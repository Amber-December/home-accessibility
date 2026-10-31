(() => {
  'use strict';const L=window.IndoorLab,$=id=>document.getElementById(id);
  let view,sim,model,grid,workbench,disaster=null,running=false,rate=1,busy=false,files=[],goalMode=false,selectedCell=-1,last=performance.now(),accumulator=0,uiAt=0,frames=0,fpsAt=last,toastTimer;
  const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const time=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
  function toast(message,error=false){$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,error?10000:5500);}
  function settings(){return{count:Number($('agent-count').value),population:$('population').value,speed:Number($('walk-speed').value),vision:Number($('vision').value),search:Number($('search-range').value),goalPolicy:$('goal-policy').value,rescueScenario:!!$('injury-rescue-enabled')?.checked};}
  function setRunning(value){running=!!value&&!busy&&!!sim&&sim.agents.length>0;$('play-icon').textContent=running?'Ⅱ':'▶';$('play-text').textContent=running?'暂停模拟':'开始模拟';$('run-status').textContent=busy?'正在构建':running?'模拟进行中':sim?.time>0?'模拟已暂停':'准备就绪';}
  function setBusy(value,message='正在构建场景…'){busy=value;$('loading').hidden=!value;$('loading-text').textContent=message;for(const id of ['play-button','demo-button','demo-preset','model-files','cell-size','agent-count','population','reimport-button','model-unit','model-up','floor-level','reset-button','add-goal','operation-mode','resident-profile','resident-task-pack','resident-run','resident-repair','resident-before','resident-after','resident-restore','disaster-type','disaster-intensity','disaster-start','disaster-reset','goal-policy','goal-form-toggle','save-goal','resident-diy-parse','resident-ai-parse','injury-rescue-enabled','injury-rescue-start','injury-rescue-reset','replace-kind','replace-target','replace-asset','replace-files','replace-apply','replace-random','replace-restore','replace-joint-play','replace-auto-interact'])$(id).disabled=value||(id==='reimport-button'&&!files.length);for(const input of document.querySelectorAll('#resident-controls input,#resident-controls select,#resident-controls textarea'))input.disabled=value;if(value)setRunning(false);}
  function activeGoals(){
    if(!model)return;
    const policy=$('goal-policy').value;
    const base=[...(policy==='custom'?[]:model.defaultGoals.filter(g=>!model.hiddenDefaultGoals.includes(g.id))),...(policy==='default'?[]:model.customGoals)];
    // Articulated replacement models become actionable destinations. The
    // replacement manager owns their live bounds, so rebuilds pick up the
    // latest furniture position without duplicating entries.
    const articulated=L.modelReplacement?.articulatedDestinations?.()||[];
    const ids=new Set(base.map(goal=>goal.id));
    model.goals=[...base,...articulated.filter(goal=>!ids.has(goal.id))];
  }
  function connectSim(prepared){activeGoals();const rescue=!!$('injury-rescue-enabled')?.checked&&!prepared;sim=rescue&&L.InjuryRescueSimulation?new L.InjuryRescueSimulation(grid,model,settings()):workbench?.build(grid,model,prepared)||new L.Simulation(grid,model.goals,settings());document.body.classList.toggle('rescue-active',!!sim.rescue);const replacementBodies=L.modelReplacement?.dynamicBodies?.()||[];if(sim.rescue?.stretcherBody)sim.setDynamicBodies?.([...(model.dynamicBodies||[]),...replacementBodies,sim.rescue.stretcherBody]);else sim.setDynamicBodies?.([...(model.dynamicBodies||[]),...replacementBodies]);sim.onEvent=()=>renderEvents();view.selected=-1;selectedCell=-1;$('selection').hidden=true;$('cell-inspector').hidden=true;view.selectCell(-1);view.setRescueScenario?.(sim.rescue||null);accumulator=0;renderGoals();renderEvents();updateUI();view.updateActors(sim.agents,sim.time,$('vision-visible').checked,sim.settings.vision);fpsAt=performance.now();frames=0;if(sim.agents.length<sim.settings.count)toast(`当前空间可安全放置 ${sim.agents.length} / ${sim.settings.count} 人；可减少人数或检查单位、地面及碰撞栅格。`,true);}
  function autoGoals(g){const free=g.nav(.25).free;if(!free.length)return[];const b=model.bounds,targets=[[.18,.18],[.82,.18],[.5,.5],[.18,.82],[.82,.82]],used=new Set(),goals=[];for(const [u,v]of targets){const i=g.nearest({x:b.minX+(b.maxX-b.minX)*u,z:b.minZ+(b.maxZ-b.minZ)*v},.25);if(i<0||used.has(i))continue;used.add(i);goals.push({id:goals.length+1,name:`目的地 ${goals.length+1}`,...g.point(i)});}return goals;}
  function findExits(){
    if(!grid)return[];
    const chosen=[],margin=Math.max(.38,grid.cell*1.6),spacing=Math.max(1.4,grid.cell*6),add=(p,name,width=Infinity)=>{
      if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.z))return;
      const i=grid.nearest(p,.25);if(i<0||grid.blocked(i))return;const q=grid.point(i);if(!grid.isClear(q.x,q.z,.25))return;
      if(chosen.every(e=>Math.hypot(e.x-q.x,e.z-q.z)>spacing))chosen.push({...q,name:name||'边界出口',width});
    };
    // Semantic exterior doors are preferred when the model provides them.
    for(const d of model?.doors||[]){
      const label=`${d.name||''} ${d.id||''}`;
      const external=/入户|入口|外|entry|exit|entrance/i.test(label)||Math.min(Math.abs(d.x-grid.minX),Math.abs(d.x-grid.maxX),Math.abs(d.z-grid.minZ),Math.abs(d.z-grid.maxZ))<2.2;
      if(!external)continue;
      if(d.axis==='x')add({x:d.x,z:d.z+(d.z>=(grid.minZ+grid.maxZ)/2?margin:-margin)},d.name||'外部门',d.width);
      else add({x:d.x+(d.x>=(grid.minX+grid.maxX)/2?margin:-margin),z:d.z},d.name||'外部门',d.width);
    }
    // Generic imported scenes have no semantic doors. Sample inset boundary
    // cells; using exact min/max coordinates fails Grid.isClear because the
    // body envelope itself would be outside the model bounds.
    // When semantic exterior doors were found, do not invent wall exits.
    // Boundary sampling is only a fallback for geometry-only imports.
    if(!chosen.length){
      const step=Math.max(spacing,grid.cell*2),sample=(axis,fixed,start,end)=>{for(let v=start;v<=end+.001;v+=step){const p=axis==='x'?{x:fixed,z:v}:{x:v,z:fixed};add(p,'边界出口');}};
      sample('x',grid.minX+margin,grid.minZ+margin,grid.maxZ-margin);
      sample('x',grid.maxX-margin,grid.minZ+margin,grid.maxZ-margin);
      sample('z',grid.minZ+margin,grid.minX+margin,grid.maxX-margin);
      sample('z',grid.maxZ-margin,grid.minX+margin,grid.maxX-margin);
    }
    if(!chosen.length)return autoGoals(grid).slice(0,2).map(g=>({...g,name:'临时疏散集合点'}));
    return chosen.slice(0,6);
  }
  function clearDisaster(){
    if(sim)sim.setHazard(null,'none',[]);
    const previous=disaster;
    disaster=null;
    previous?.dispose?.();
    view?.setDisaster(null,'none');
    $('disaster-status').textContent='灾害已清除。可重新选择火灾或地震实验。';
  }
  function clearRescue(){
    $('injury-rescue-enabled').checked=false;
    view?.setRescueScenario?.(null);
    if(sim&&!busy)connectSim();
    $('injury-rescue-status').textContent='救援实验已清除。可重新选择办公楼或住宅楼后再次启动。';
  }
  async function startRescue(){
    if(busy||!model)return;
    clearDisaster();$('operation-mode').value='crowd';$('injury-rescue-enabled').checked=true;setBusy(true,'正在准备随机受伤与担架救援…');
    try{await install(model);$('injury-rescue-status').textContent='实验已启动：行人将先正常行走，随后随机扭伤；两名医生会从入口进入并抬担架返回。';setRunning(true);}catch(error){$('injury-rescue-enabled').checked=false;toast(error.message,true);console.error(error);}finally{setBusy(false);}
  }
  function buildFuelMap(){
    const values=new Float32Array(grid.size); 
    const combustible=/(furniture|bed|sofa|chair|table|cabinet|wood|curtain|rug|carpet|cushion|paper|book|木|家具|床|沙发|椅|桌|柜|窗帘|地毯|布)/i;
    const lowFuel=/(floor|wall|ceiling|metal|glass|stone|tile|door|window|地板|墙|顶|金属|玻璃|石|瓷|门|窗)/i;
    for(let i=0;i<grid.size;i++){
      if(grid.blocked(i)){values[i]=0;continue;}
      const own=grid.obstacles[grid.owner[i]||0];
      const text=`${own?.name||''} ${own?.kind||''}`;
      values[i]=combustible.test(text) ? .95 : lowFuel.test(text) ? .08 : .035;
      if(values[i] < .5){
        const c=i%grid.cols,r=Math.floor(i/grid.cols);
        for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++){
          const cc=c+dc,rr=r+dr;if(cc<0||rr<0||cc>=grid.cols||rr>=grid.rows)continue;
          const n=grid.obstacles[grid.owner[rr*grid.cols+cc]||0],nt=`${n?.name||''} ${n?.kind||''}`;
          if(combustible.test(nt)){values[i]=Math.max(values[i],.72);}
        }
      }
    }
    return values;
  }
  function obstacleBodies(){
    const by=new Map();
    for(let i=0;i<grid.size;i++){
      const owner=grid.owner[i];if(!owner)continue;
      let item=by.get(owner);if(!item){item={id:owner,cells:[],height:1.8,fragility:.9};by.set(owner,item);}
      item.cells.push(grid.point(i));
    }
    return [...by.values()].map(o=>{
      const xs=o.cells.map(p=>p.x),zs=o.cells.map(p=>p.z);
      return {...o,center:{x:xs.reduce((a,b)=>a+b,0)/xs.length,z:zs.reduce((a,b)=>a+b,0)/zs.length},width:Math.max(grid.cell,Math.max(...xs)-Math.min(...xs)+grid.cell),depth:Math.max(grid.cell,Math.max(...zs)-Math.min(...zs)+grid.cell)};
    });
  }
  async function startDisaster(){
    if(!sim||busy)return;
    const type=$('disaster-type').value;
    if(type==='none'){clearDisaster();return;}
    if(sim.rescue){$('injury-rescue-enabled').checked=false;view.setRescueScenario?.(null);setBusy(true,'正在结束救援实验并切换灾害仿真…');try{await install(model);}finally{setBusy(false);}}
    if(sim.isResident){
      $('operation-mode').value='crowd';
      workbench?.invalidate();
      setBusy(true,'正在切换到人群灾害仿真…');
      try{await install(model);}catch(e){toast(e.message,true);console.error(e);return;}finally{setBusy(false);}
      if(!sim||sim.isResident){toast('灾害实验需要人群仿真模式。',true);return;}
    }
    clearDisaster();
    const intensity=Number($('disaster-intensity').value),exits=findExits();
    if(type==='fire'){
      disaster=new L.FireModel(grid,{seed:21879,wind:{x:.18*intensity,z:.05*intensity},sourcePower:360*intensity,fireHeat:230*intensity,conductivity:.38,smokeDiffusion:.44,ceilingRise:.2,burnRate:.09,fireSmoke:.3});
      const fuelMap=buildFuelMap();
      disaster.setFuelMap?.(fuelMap);
      const free=grid.nav(.25).mainFree;
      if(!free.length){toast('当前场景没有可用地面，无法设置火源。',true);return;}
      const fuelCandidates=free.filter(i=>fuelMap[i]>.55);
      const sourcePool=fuelCandidates.length?fuelCandidates:free;
      const source=sourcePool[(21879+Math.floor(intensity*10))%sourcePool.length];
      disaster.addSource({cell:source,name:'随机火源',power:360*intensity,smoke:.46*intensity,flame:1});
      disaster.rebuildEscapeDistance(exits);
      sim.setHazard(disaster,'fire',exits);
      view.setDisaster(disaster,'fire');
      $('disaster-status').textContent=`火灾实验中 · ${exits.length} 个出口 · 网格温度 / 烟气 / 火焰每 30Hz 更新`;
    }else{
      await L.QuakePhysics.prepare();
      const physics=new L.QuakePhysics(view,model,grid,{maxBodies:72,maxFragments:120});
      const eqObs=physics.descriptors;
      disaster=new L.EarthquakeScenario(grid,eqObs,{seed:7319,pga:.32*intensity,frequency:2.2,duration:12,collapseThreshold:Math.max(.35,.58-intensity*.1),physics}).start();
      sim.setHazard(disaster,'earthquake',exits);
      view.setDisaster(disaster,'earthquake');
      $('disaster-status').textContent=`地震实验中 · PGA ${(disaster.options.pga).toFixed(2)}g · 结构损伤与碎片风险每 30Hz 更新`;
    }
    $('disaster-start').disabled=false;
    setRunning(true);
  }
  async function install(next,preparedGrid,preparedResults){
    clearDisaster();
    const nextGrid=preparedGrid||await L.buildGrid(next.group,next.bounds,Number($('cell-size').value),message=>$('loading-text').textContent=message);
    if(!nextGrid.nav(.25).free.length){if(next!==model)L.dispose(next.group);throw new Error('没有可容纳步行者的通行区域。请检查模型单位、地面标高和向上轴。');}
    const newModel=model!==next;model=next;grid=nextGrid;if(!model.defaultGoals){model.defaultGoals=(model.goals.length?model.goals:autoGoals(grid)).map(g=>({...g,source:'default'}));model.customGoals=[];model.hiddenDefaultGoals=[];}if(newModel)$('goal-policy').value='default';activeGoals();
    view.setModel(model,grid);view.setWalls($('walls-visible').checked);view.heatGroup.visible=$('heat-visible').checked;view.trailMesh.visible=$('trails-visible').checked;view.overlayGroup.visible=$('obstacles-visible').checked;if(model.zones)model.zones.visible=$('zones-visible').checked;
    $('model-name').textContent=model.name;$('model-meta').textContent=`${(model.bounds.maxX-model.bounds.minX).toFixed(1)} × ${(model.bounds.maxZ-model.bounds.minZ).toFixed(1)} m · ${grid.meta.triangles.toLocaleString()} 面`;
    $('project-name').textContent=model.demo?(model.preset==='office'?'Digital Workplace':'Resident Home'):model.name;$('scene-code').textContent=model.demo?'LEVEL 01 / DEMO':'IMPORTED SPACE';$('scene-title').textContent=model.demo?(model.preset==='office'?'Digital Workplace':'Resident Home'):model.name;$('scene-subtitle').textContent=model.demo?(model.preset==='office'?'办公空间 / 开放办公 · 会议 · 服务核心':'可编辑住宅 / 门、家具、日常任务与修复复测'):model.name;
    $('grid-note').textContent=`${grid.cols} × ${grid.rows} 格 · ${grid.cell.toFixed(2)} m · ${grid.meta.hasFloor?'已识别地板支撑':'虚拟平面（未检测到足够地板）'} · 高度 0.08–1.80 m`;
    if(model.editableHome){$('scene-title').textContent='Resident Home';$('scene-subtitle').textContent='可编辑住宅 / 门、家具、日常任务与修复复测';$('project-name').textContent='Resident Home';}connectSim(preparedResults);if(grid.cell!==Number($('cell-size').value))toast(`场景较大，实际栅格已调整为 ${grid.cell.toFixed(2)} m（最多 20 万格）。`);
    if(model.warnings)toast(model.warnings,true);
  }
  async function loadDemo(){if(busy)return;workbench?.invalidate();setBusy(true);try{await install($('demo-preset').value==='office'?L.makeOfficeDemo():L.makeResidentHome());files=[];$('reimport-button').disabled=true;}catch(e){toast(e.message,true);console.error(e);}finally{setBusy(false);setRunning(false);}}
  async function loadFiles(selected){if(busy||!selected.length)return;setBusy(true,'正在解析模型文件…');let next;try{next=await L.importModel(selected,{unit:$('model-unit').value==='auto'?NaN:Number($('model-unit').value),up:$('model-up').value,floor:$('floor-level').value===''?NaN:Number($('floor-level').value)},message=>$('loading-text').textContent=message);await install(next);files=[...selected];toast(next.source?.usd?`已加载完整住宅 · ${(next.bounds.maxX-next.bounds.minX).toFixed(1)} × ${(next.bounds.maxZ-next.bounds.minZ).toFixed(1)} m · 白蓝材质 · 人物按真实身高显示。`:`已加载 ${next.name}。请先检查尺度、地面和碰撞栅格，再开始模拟。`);}catch(e){toast(e.message,true);console.error(e);}finally{setBusy(false);setRunning(false);$('model-files').value='';}}
  function reset(){if(!sim||busy)return;const wasRunning=running;clearDisaster();connectSim();setRunning(wasRunning);}
  function renderGoals(){view.updateGoals(model.goals);$('goal-list').innerHTML=model.goals.length?model.goals.map((g,i)=>`<div class="goal-row"><span class="goal-marker">${i+1}</span><button data-focus="${g.id}">${escape(g.name)}<small class="goal-source">${g.source==='custom'?'自定义':g.source==='articulated-furniture'?'可动家具 · 自动添加':'默认'} · ${g.x.toFixed(1)}, ${g.z.toFixed(1)} m</small></button><button class="goal-remove" data-remove="${g.id}" title="移除目的地" aria-label="移除 ${escape(g.name)}">×</button></div>`).join(''):'<p class="hint">尚无自定义目的地。请点选地面或输入坐标添加；行人会等待目标。</p>';$('goal-note').textContent=`当前启用 ${model.goals.length} 个目标；已保存 ${model.customGoals.length} 个自定义目标。切换模式会保留目标，重置本次模拟。`;}
  function addCustomGoal(p){if(!model||busy)return false;const i=grid.index(p.x,p.z);if(!Number.isFinite(p.x)||!Number.isFinite(p.z)||i<0||grid.blocked(i)){toast('请选择模型范围内未被障碍占据且有地板支撑的地面。',true);return false;}if(model.customGoals.length>=20){toast('最多保存 20 个自定义目的地。',true);return false;}const id=Math.max(1000,...model.customGoals.map(g=>g.id))+1,name=$('goal-name').value.trim()||`自定义目标 ${id-1000}`;model.customGoals.push({id,name,...p,source:'custom'});if($('goal-policy').value==='default')$('goal-policy').value='mixed';reset();$('goal-x').value=p.x.toFixed(2);$('goal-z').value=p.z.toFixed(2);toast(`已添加「${name}」；${$('goal-policy').value==='mixed'?'默认与自定义目标共同参与':'使用自定义目标'}。`);return true;}
  function renderEvents(){if(!sim)return;$('event-count').textContent=sim.eventTotal;$('event-list').innerHTML=sim.events.length?sim.events.slice(-18).reverse().map(e=>{const furniture=e.type==='furniture_interaction',label=e.type==='blocked'?'目的地受阻':e.type==='state_transition'?`状态：${e.from||'?'} → ${e.to||'?'}`:furniture?(e.code==='furniture_collision'?`家具碰撞反馈：${e.furnitureName||'可动家具'}`:`家具互动：${e.furnitureName||'可动家具'}`):'障碍接触',icon=e.type==='blocked'?'!':e.type==='state_transition'?'↺':furniture?'↻':'↔',detail=furniture?`${e.reason}${e.blocked?' · 已阻止接近':e.collision?.agentOverlap?' · 运动包络重叠':' · 运动已应用'}`:`${time(e.time)} / AGENT ${String(e.agent+1).padStart(2,'0')} / ${e.x.toFixed(1)}, ${e.z.toFixed(1)} m`;return`<button class="event-row" data-event="${e.id}"><span class="event-icon ${e.type}">${icon}</span><span><b>${label} · ${escape(L.PROFILES[e.profile]?.name||e.profile)}</b><small>${furniture?`${time(e.time)} / ${detail}`:detail}</small></span></button>`;}).join(''):'<div class="empty-state"><span>⌁</span><p>从一次行走开始。<br>接触、受阻和状态变化将在这里留下记录。</p></div>';}
  function updateUI(){if(!sim)return;const stats=sim.summary();if(disaster){if(disaster instanceof L.FireModel){const fs=disaster.summary();$('disaster-status').textContent=`火灾实验中 · ${disaster.exits.length} 个出口 · 已点燃 ${fs.ignitedCells} · 燃烧 ${fs.burningCells} · 高危 ${fs.dangerousCells} · ${fs.time.toFixed(1)} s`;}else if(disaster instanceof L.EarthquakeScenario){const qs=disaster.summary();const bound=sim.hazard===disaster?'绑定':'未绑定';$('disaster-status').textContent=`地震实验中 · PGA ${qs.pga.toFixed(2)}g · 摇晃 ${qs.time.toFixed(1)} s · 倒塌 ${qs.collapsed} · 掉落 ${qs.debris} · ${bound}`;}}if(sim.rescue){const r=sim.rescue;$('injury-rescue-status').textContent=r.phase==='walking'?`救援实验已准备 · ${Math.max(0,r.triggerAt-sim.time).toFixed(1)} s 后随机受伤`:r.phase==='dispatch'?'伤员已倒地 · 两名医生正在进入场景':r.phase==='carry'?`担架运送中 · 担架磕碰 ${r.collisions} 次`:'救援完成 · 伤员已从入口送出';}
    $('elapsed').textContent=time(sim.time);$('arrivals').textContent=sim.arrivals;$('contacts').textContent=sim.contacts;$('blocked').textContent=sim.blocked;$('moving').innerHTML=`${sim.agents.filter(a=>a.state==='moving').length} <small>/ ${sim.agents.length}</small>`;$('success-rate').textContent=stats.finishedTripArrivalRate===null?'—':`${Math.round(stats.finishedTripArrivalRate*100)}%`;
    const mode=$('heat-mode').value,{max,sampledArea}=view.updateHeat(mode);$('heat-max').textContent=max?`MAX ${max.toFixed(0)} 次`:'尚无障碍事件';$('sample-area').textContent=`${sampledArea.toFixed(1)} m²`;
    $('risk-score').textContent=sim.distance>0?(sim.contacts*100/sim.distance).toFixed(1):'—';
    const history=sim.history,maxA=Math.max(1,...history.map(h=>h.arrivals));$('sparkline').setAttribute('d',history.length>1?history.map((h,i)=>`${i?'L':'M'}${(i/(history.length-1)*104).toFixed(1)},${(35-h.arrivals/maxA*30).toFixed(1)}`).join(' '):'M0,35 L105,35');
    if(view.selected>=0&&!$('selection').hidden)showAgent(sim.agents.find(a=>a.id===view.selected));
    if(selectedCell>=0&&!$('cell-inspector').hidden)showCell(selectedCell);
    workbench?.render(sim);
  }
  function showCell(index){const item=sim.cellIncidents.get(index);if(!item)return;selectedCell=index;view.selected=-1;$('selection').hidden=true;view.selectCell(index);const p=grid.point(index),last=item.recent.at(-1),causes=Object.values(item.causes).sort((a,b)=>b.count-a.count),objects=Object.values(item.obstacles).sort((a,b)=>b.count-a.count),required=[...new Set(item.recent.map(e=>e.requiredWidth.toFixed(2)))];$('cell-inspector').hidden=false;$('cell-inspector').querySelector('.cell-inspector-body').innerHTML=`<span class="eyebrow">ACCESSIBILITY / CELL ${index}</span><h3>磕碰栅格详情</h3><p class="cell-position">X ${p.x.toFixed(2)} / Z ${p.z.toFixed(2)} m · ${grid.cell.toFixed(2)} m 栅格</p><div class="cell-metrics"><span><b>${item.contact}</b>障碍接触</span><span><b>${item.obstruction}</b>障碍受阻</span><span><b>${item.crowd}</b>人际等待</span></div><h4>发生原因</h4>${causes.map(c=>`<div class="cause-row"><span>${escape(c.reason)}</span><b>${c.count} 次</b></div>`).join('')}<h4>涉及对象</h4><p>${objects.length?objects.slice(0,4).map(o=>escape(o.name)).join('<br>'):'暂无可直接归因的模型对象'}</p><div class="cell-facts"><span>涉及人群</span><b>${Object.keys(item.profiles).map(k=>escape(L.PROFILES[k].name)).join(' / ')}</b><span>身体包络宽度</span><b>${required.join(' / ')} m</b><span>事件时间</span><b>${time(item.firstTime)} – ${time(item.lastTime)}</b></div><p class="evidence-note">${escape(last.evidence||'记录来自本次实际模拟。')}${last.type==='blocked'?'。受阻记录的位置是行人停滞点，附近对象并不代表实际接触面。':'。栅格记录行人的最后安全位置；已阻止穿透障碍。'}<br>人际等待不进入障碍热点。身体包络与栅格判定不等同于规范结论。</p>`;}
  function showAgent(a){if(!a)return;const interaction=a.furnitureInteraction,interactionText=interaction?`<br>家具互动：${escape(interaction.name||'可动家具')} · ${interaction.state==='open'?'已打开':interaction.state==='closing'?'正在回位':'正在操作'}${interaction.collision?' · 运动包络重叠':''}${interaction.blocked?' · 已阻止接近':''}`:'';$('selection').hidden=false;$('selection').querySelector('.selection-body').innerHTML=`<b>AGENT ${String(a.id+1).padStart(2,'0')} · ${escape(a.profile.name)}</b>身体半径 ${a.profile.radius.toFixed(2)} m<br>目标 ${escape(a.goal?.name||'随机探索')}<br>状态 ${{moving:'行走中',arrived:'已到达 / 停留',blocked:'受阻 / 等待',waiting:'等待目标'}[a.state]}<br>位置 ${a.x.toFixed(2)}, ${a.z.toFixed(2)} m${interactionText}`;}
  function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);}
  function exportJSON(){const cells=[];for(let i=0;i<grid.size;i++)if(grid.heat.density[i]||grid.heat.contact[i]||grid.heat.blocked[i])cells.push({index:i,...grid.point(i),contactEvents:grid.heat.contact[i],blockedTripEvents:grid.heat.blocked[i],obstacleBlockedEvents:grid.heat.obstruction[i],accessEvents:grid.heatValue(i,'access'),diagnostics:sim.cellIncidents.get(i),nearPersonSeconds:grid.heat.near[i],densityPersonSeconds:grid.heat.density[i]});const data={schema:'access-lab/1',createdAt:new Date().toISOString(),model:model.name,modelSource:model.source||{type:'built-in-demo'},settings:sim.settings,summary:sim.summary(),manifest:sim.manifest?.(),agentMetrics:sim.agentMetrics?.(),qualityChecks:sim.qualityChecks?.(),grid:{origin:[grid.minX,grid.minZ],cellSize:grid.cell,rows:grid.rows,cols:grid.cols,...grid.meta},method:{displayedHeat:'contactEvents + obstacleBlockedEvents; crowd waiting, traffic and dwell time excluded',arrivalRate:'arrivals/(arrivals+blockedTrips)',contacts:'attempted obstacle overlap, 1 second per agent debounce',blocked:'unreachable target or 3.5 seconds sustained stall, one event per trip',eventRetentionLimit:sim.settings.maxEvents||5000,cellDiagnostics:'aggregate retained per cell; last 8 detailed events per cell',seed:sim.initialSeed,metrics:['per-agent minimum clearance','planned versus actual path','reroutes','crowd wait','geometry wait','hazard exposure','state transitions'],limitations:'Single horizontal floor, conservative 0.08–1.8m projection, not a standards compliance check; use MuJoCo/CFD/FEM for engineering validation'},goals:model.goals,destinationSets:{policy:$('goal-policy').value,default:model.defaultGoals,custom:model.customGoals},obstacles:grid.obstacles,cells,events:sim.events};download('ACCESS-analysis.json',JSON.stringify(data,null,2),'application/json');}
  function exportCSV(){const quote=value=>'"'+String(value).replace(/"/g,'""')+'"',lines=['cell_index,x_m,z_m,cell_size_m,is_obstacle,is_supported,obstacle_name,contact_events,obstacle_blocked_events,crowd_wait_events,access_events,reason_codes'];for(let i=0;i<grid.size;i++){const p=grid.point(i),item=sim.cellIncidents.get(i);lines.push([i,p.x.toFixed(3),p.z.toFixed(3),grid.cell,grid.solid[i],grid.support[i],quote(grid.owner[i]?grid.obstacles[grid.owner[i]].name:''),grid.heat.contact[i],grid.heat.obstruction[i],item?.crowd||0,grid.heatValue(i,'access'),quote(item?Object.keys(item.causes).join(';'):'')].join(','));}download('ACCESS-grid.csv','\uFEFF'+lines.join('\r\n'),'text/csv;charset=utf-8');}
  function animate(now){requestAnimationFrame(animate);const delta=Math.min(.1,(now-last)/1000);last=now;if(!sim){view?.render();return;}if(running&&!busy&&!document.hidden){accumulator+=delta*rate;let steps=0;while(accumulator>=1/30&&steps++<12){sim.tick(1/30);if(sim.isResident&&sim.finished)setRunning(false);accumulator-=1/30;}}L.modelReplacement?.update(delta,sim.agents||[]);view.updateActors(sim.agents,sim.time,$('vision-visible').checked,sim.settings.vision);view.render();frames++;if(now-fpsAt>1200){$('fps').textContent=running?`${Math.round(frames*1000/(now-fpsAt))} FPS`:(view.pipeline.quality==='high'?'精细画面':'流畅画面');frames=0;fpsAt=now;}if(now-uiAt>400){updateUI();uiAt=now;}}
  function bind(){
    $('play-button').onclick=()=>{if(sim?.isResident&&sim.finished)reset();setRunning(!running);};$('reset-button').onclick=reset;$('demo-button').onclick=loadDemo;$('demo-preset').onchange=loadDemo;$('model-files').onchange=e=>loadFiles(e.target.files);$('reimport-button').onclick=()=>loadFiles(files);
    $('render-quality').value=view.pipeline.quality;$('render-quality').onchange=()=>view.pipeline.setQuality($('render-quality').value);
    $('render-style').value=view.pipeline.style;$('render-style').onchange=()=>view.setRenderStyle($('render-style').value);
    $('launch-note').textContent=location.protocol==='file:'?'HTML 直开模式：部分模型加载受限制，推荐用 BAT 启动本地服务。':`本地 HTTP 服务 · 端口 ${location.port||80} · 模型仅在本机解析`;
    $('goal-policy').onchange=reset;$('restore-goals').onclick=()=>{model.hiddenDefaultGoals=[];$('goal-policy').value='default';reset();toast('已恢复场景默认目的地；自定义目标仍保留。');};$('goal-form-toggle').onclick=()=>{$('goal-form').hidden=!$('goal-form').hidden;};$('save-goal').onclick=()=>{if($('goal-x').value===''||$('goal-z').value===''){toast('请填写 X 和 Z 坐标。',true);return;}addCustomGoal({x:Number($('goal-x').value),z:Number($('goal-z').value)});};
    $('zones-visible').onchange=()=>{if(model?.zones)model.zones.visible=$('zones-visible').checked;};
    const updateClock=()=>{const date=new Date();$('wall-clock').textContent=date.toLocaleTimeString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'});$('wall-date').textContent=date.toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})+' / CST';};updateClock();setInterval(updateClock,1000);
    document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b===button));const mode=button.dataset.mode;if(mode==='overview'){view.setView('perspective');$('zones-visible').checked=true;$('zones-visible').onchange();}if(mode==='agents'){$('trails-visible').checked=true;$('trails-visible').onchange();if(!running)setRunning(true);}if(mode==='analysis'){$('heat-visible').checked=true;$('heat-visible').onchange();$('zones-visible').checked=false;$('zones-visible').onchange();view.setView('top');}if(mode==='events'){setRunning(false);const event=sim?.events.at(-1);if(event){view.focus(event);toast(`${event.reason} · ${event.goal}`);}else toast('尚无事件记录。开始模拟后可查看障碍接触和受阻位置。');}document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view.view));});
    $('drop-zone').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('model-files').click();}};
    for(const e of ['dragenter','dragover'])$('drop-zone').addEventListener(e,event=>{event.preventDefault();$('drop-zone').classList.add('drag');});for(const e of ['dragleave','drop'])$('drop-zone').addEventListener(e,event=>{event.preventDefault();$('drop-zone').classList.remove('drag');});$('drop-zone').addEventListener('drop',e=>loadFiles(e.dataTransfer.files));
    $('agent-count').oninput=()=>{$('count-value').textContent=`${$('agent-count').value} 人`;};$('agent-count').onchange=reset;$('population').onchange=reset;
    $('walk-speed').oninput=()=>{$('speed-value').textContent=`${Number($('walk-speed').value).toFixed(1)} ×`;if(sim)sim.settings.speed=Number($('walk-speed').value);};$('vision').onchange=()=>{if(sim)sim.settings.vision=Number($('vision').value);};$('search-range').onchange=()=>{if(sim)sim.settings.search=Number($('search-range').value);};
    $('disaster-intensity').oninput=()=>{$('disaster-intensity-value').textContent=`${Number($('disaster-intensity').value).toFixed(1)} ×`;};$('disaster-start').onclick=startDisaster;$('disaster-reset').onclick=clearDisaster;$('agent-bubbles').onchange=()=>view.agentBubbles?.setVisible($('agent-bubbles').checked);
    $('injury-rescue-start').onclick=startRescue;$('injury-rescue-reset').onclick=clearRescue;$('injury-rescue-enabled').onchange=()=>{if($('injury-rescue-enabled').checked)startRescue();else clearRescue();};
    $('cell-size').onchange=async()=>{if(busy)return;setBusy(true);try{await install(model);}catch(e){toast(e.message,true);}finally{setBusy(false);setRunning(false);}};
    document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===button));view.setView(button.dataset.view);if(button.dataset.view==='walk'){setRunning(false);toast('自由步入：WASD 移动，左键拖动看方向，E 开关附近的门。');}$('tool-hint').textContent=button.dataset.view==='walk'?'WASD 移动 / 左键拖动看方向 / E 开关附近门':button.dataset.view==='human'?'跟随选中住户 / 点击切换':'左键旋转 / 右键平移 / 滚轮缩放';});
    document.querySelectorAll('[data-rate]').forEach(button=>button.onclick=()=>{rate=Number(button.dataset.rate);document.querySelectorAll('[data-rate]').forEach(b=>b.classList.toggle('active',b===button));});
    $('fit-button').onclick=()=>view.setView(view.view);$('snapshot-button').onclick=()=>{const a=document.createElement('a');a.href=view.snapshot();a.download='ACCESS-view.png';a.click();};
    $('heat-visible').onchange=()=>view.heatGroup.visible=$('heat-visible').checked;$('trails-visible').onchange=()=>view.trailMesh.visible=$('trails-visible').checked;$('obstacles-visible').onchange=()=>view.overlayGroup.visible=$('obstacles-visible').checked;$('walls-visible').onchange=()=>view.setWalls($('walls-visible').checked);$('heat-mode').onchange=updateUI;
    $('clear-heat').onclick=()=>{sim?.clearHeat();selectedCell=-1;view.selectCell(-1);$('cell-inspector').hidden=true;updateUI();toast('已清空热点及栅格原因聚合；累计旅程和事件列表保留。');};$('clear-events').onclick=()=>{if(!sim)return;sim.events=[];renderEvents();toast('已清空事件列表；栅格原因聚合和累计统计保留。');};
    $('add-goal').onclick=()=>{goalMode=!goalMode;$('add-goal').textContent=goalMode?'取消添加':'＋ 在地面点选';$('tool-hint').textContent=goalMode?'点击可通行地面设置目的地 / Esc 取消':'左键旋转 / 右键平移 / 滚轮缩放';view.renderer.domElement.style.cursor=goalMode?'crosshair':'';};
    view.onClick=(p,hit={})=>{if(busy)return;if(goalMode){if(addCustomGoal(p))$('add-goal').click();return;}const picked=L.modelReplacement?.selectObject?.(hit.object);if(picked){selectedCell=-1;view.selectCell(-1);$('cell-inspector').hidden=true;return;}const index=grid.index(p.x,p.z);if($('heat-visible').checked&&sim.cellIncidents.has(index)&&grid.heatValue(index,$('heat-mode').value)>0){showCell(index);return;}const a=hit.agentId===undefined?sim.agents.reduce((best,a)=>Math.hypot(a.x-p.x,a.z-p.z)<Math.hypot(best.x-p.x,best.z-p.z)?a:best,sim.agents[0]||{x:1e9,z:1e9}):sim.agents.find(a=>a.id===hit.agentId);if(a?.id!==undefined&&(hit.agentId!==undefined||Math.hypot(a.x-p.x,a.z-p.z)<.7)){selectedCell=-1;view.selectCell(-1);$('cell-inspector').hidden=true;view.selected=a.id;showAgent(a);}};
    $('goal-list').onclick=e=>{const focus=e.target.closest('[data-focus]'),remove=e.target.closest('[data-remove]');if(focus)view.focus(model.goals.find(g=>g.id===Number(focus.dataset.focus)));if(remove){const id=Number(remove.dataset.remove),goal=model.goals.find(g=>g.id===id);if(goal?.source==='custom')model.customGoals=model.customGoals.filter(g=>g.id!==id);else model.hiddenDefaultGoals.push(id);reset();toast('已移除目标并重置模拟；默认目标可用「恢复默认」找回。');}};
    $('event-list').onclick=e=>{const button=e.target.closest('[data-event]');if(!button)return;const event=sim.events.find(e=>e.id===Number(button.dataset.event));if(event){view.focus(event);if(sim.cellIncidents.has(event.cellIndex))showCell(event.cellIndex);else toast(`${event.reason} · 目标：${event.goal}`);}};$('selection').onclick=e=>{if(e.target.closest('[data-close-selection]')){$('selection').hidden=true;view.selected=-1;}};$('cell-inspector').onclick=e=>{if(e.target.closest('[data-close-cell]')){$('cell-inspector').hidden=true;selectedCell=-1;view.selectCell(-1);}};
    $('help-button').onclick=()=>$('help-dialog').showModal();$('close-help').onclick=()=>$('help-dialog').close();document.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)||e.target.isContentEditable)return;if(e.key.toLowerCase()==='f'){e.preventDefault();document.body.classList.toggle('menus-hidden');return;}if(e.key==='Escape'&&goalMode)$('add-goal').click();});
    const dialog=document.createElement('dialog');dialog.innerHTML='<button class="dialog-close" aria-label="关闭">×</button><span class="eyebrow">EXPORT ANALYSIS</span><h2>把观察带回设计。</h2><p>JSON 包含参数、统计、目的地、已采样栅格与最多 5000 条事件；CSV 包含全部栅格及四项原始指标，可导入 GIS、Excel 或 Grasshopper。坐标为居中后的米制 X / Z。</p><div style="display:flex;gap:12px;margin-top:24px"><button class="play-button" id="export-json">下载 JSON</button><button class="export-button" id="export-csv" style="margin:0">下载栅格 CSV</button></div>';document.body.appendChild(dialog);dialog.querySelector('.dialog-close').onclick=()=>dialog.close();$('export-button').onclick=()=>{if(sim)dialog.showModal();};$('export-json').onclick=exportJSON;$('export-csv').onclick=exportCSV;
  }
  try{if(!window.THREE)throw new Error('本地 Three.js 未加载，请保留本文件夹与 InteractiveEarth/js 的相对路径。');view=new L.SceneView($('viewport'));workbench=new L.ResidentWorkbench({state:()=>({view,sim,model,grid,busy}),reset,install,play:setRunning,busy:setBusy,toast,loadDemo,download});bind();loadDemo();requestAnimationFrame(animate);}catch(e){$('loading').hidden=false;$('loading-text').textContent=`无法启动：${e.message}`;console.error(e);}
  // Read-only diagnostics for local QA and extending the architecture.
  L.app={get view(){return view;},get simulation(){return sim;},get grid(){return grid;},get model(){return model;},get workbench(){return workbench;},get disaster(){return disaster;},get running(){return running;},get busy(){return busy;},reset,install,loadDemo,startDisaster,clearDisaster,startRescue,clearRescue};
})();






