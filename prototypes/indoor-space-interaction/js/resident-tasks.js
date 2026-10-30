/* Deterministic task execution. Every result comes from the same geometry/action evaluator. */
(() => {
  'use strict';const L=window.IndoorLab,N=L.ResidentNav;
  L.RESIDENT_PROFILES={
    wheelchair:{name:'轮椅住户',type:'wheelchair',width:.72,length:1.05,speed:.72,angularSpeed:.65,reach:.75,maxHeight:1.25,doorEffort:.7,transferPadding:.22,probeDelay:0,color:'#607ce0'},
    assisted:{name:'助行器老人',type:'assisted',width:.64,length:.82,speed:.48,angularSpeed:.48,reach:.65,maxHeight:1.4,doorEffort:.6,transferPadding:.16,probeDelay:0,color:'#d39c53'},
    blind:{name:'视障 / 白杖住户',type:'blind',width:.52,length:.5,speed:.65,angularSpeed:.8,reach:.68,maxHeight:1.6,doorEffort:.7,transferPadding:.1,probeDelay:.65,color:'#22aa9b'},
    upper:{name:'上肢活动受限住户',type:'upper',width:.5,length:.46,speed:.95,angularSpeed:.8,reach:.42,maxHeight:1.1,doorEffort:.35,transferPadding:.12,probeDelay:0,color:'#9370cc'}
  };
  L.PROFILES.blind={name:'视障 / 白杖住户',radius:.26,speed:.65,color:'#22aa9b'};L.PROFILES.upper={name:'上肢活动受限住户',radius:.25,speed:.95,color:'#9370cc'};
  L.RESIDENT_TASKS=[{id:'sofa',name:'入户到沙发'},{id:'bathroom',name:'卧室到卫生间'},{id:'fridge',name:'取用冰箱'},{id:'transfer',name:'床椅转移'},{id:'evacuate',name:'紧急疏散'}];
  function leafPoints(d,t){const hinge={x:d.axis==='x'?d.x-d.width/2:d.x,z:d.axis==='x'?d.z:d.z-d.width/2},a=(d.axis==='x'?0:-Math.PI/2)+d.swing*t*Math.PI/2;return{hinge,dx:Math.cos(a),dz:-Math.sin(a)};}
  function leafHits(d,t,p,profile){const line=leafPoints(d,t),s=Math.sin(p.angle),c=Math.cos(p.angle);for(let u=.06;u<d.width;u+=.045){const dx=line.hinge.x+line.dx*u-p.x,dz=line.hinge.z+line.dz*u-p.z;if(Math.abs(dx*c-dz*s)<profile.width/2+.035&&Math.abs(dx*s+dz*c)<profile.length/2+.035)return true;}return false;}
  class Trial{
    constructor(grid,model,profile,task){this.grid=grid;this.model=model;this.profile=profile;this.task=task;this.time=0;this.distance=0;this.trace=[];this.actions=[];this.issues=[];this.doors=Object.fromEntries(model.doors.map(d=>[d.id,0]));this.minClearance=Infinity;this.pose=task==='sofa'?{x:.5,z:6.8,angle:Math.PI}:task==='fridge'?{x:-5,z:2,angle:Math.PI/2}:{x:-3.9,z:-4.65,angle:0};this.start={...this.pose};this.trace.push({time:0,...this.pose,action:'准备任务',doors:{...this.doors}});}
    fail(code,reason,itemId,point=this.pose){this.issues.push({time:this.time,code,reason,itemId,x:point.x,z:point.z});return false;}
    append(target,duration,action){const from={...this.pose},angle=N.delta(from.angle,target.angle??from.angle),start=this.time,steps=Math.max(1,Math.ceil(duration/.12));for(let i=1;i<=steps;i++){const t=i/steps;this.trace.push({time:start+duration*t,x:from.x+(target.x-from.x)*t,z:from.z+(target.z-from.z)*t,angle:from.angle+angle*t,action,doors:{...this.doors}});}this.time+=duration;this.distance+=Math.hypot(target.x-from.x,target.z-from.z);this.pose={...target,angle:from.angle+angle};this.actions.push({action,start,end:this.time,x:target.x,z:target.z});}
    wait(seconds,action){this.append({...this.pose},seconds,action);return true;}
    probe(){this.probes=this.probes||[];const hits=[];for(const offset of [-.55,0,.55]){const angle=this.pose.angle+offset;for(let distance=.15;distance<=1.05;distance+=.06){const x=this.pose.x+Math.sin(angle)*distance,z=this.pose.z+Math.cos(angle)*distance,index=this.grid.index(x,z),door=this.model.doors.find(d=>leafHits(d,this.doors[d.id],{x,z,angle},{width:.035,length:.035}));if(this.grid.blocked(index)||door){hits.push({distance,x,z,object:door?.name||this.grid.obstacles[this.grid.owner[index]||0].name});break;}}}this.probes.push({time:this.time,x:this.pose.x,z:this.pose.z,hits});this.wait(this.profile.probeDelay+(hits.length?.2:0),hits.length?'白杖探测 / 沿障碍确认':'白杖探测 / 触觉路径确认');}
    clearance(p){let lo=0,hi=N.margin(this.grid,p,this.profile);for(let i=0;i<6;i++){const mid=(lo+hi)/2,envelope={width:this.profile.width+2*mid,length:this.profile.length+2*mid};if(this.model.doors.every(d=>!leafHits(d,this.doors[d.id],p,envelope)))lo=mid;else hi=mid;}return lo;}
    move(goal,action='行走'){const dynamic=p=>this.model.doors.every(d=>!leafHits(d,this.doors[d.id],p,this.profile));dynamic.key=JSON.stringify(this.doors);const route=N.route(this.grid,this.pose,goal,this.profile,dynamic);for(const p of route.path.slice(1)){
        const hit=this.model.doors.find(d=>leafHits(d,this.doors[d.id],p,this.profile));if(hit)return this.fail('closed_door',`路径触及尚未开启的${hit.name}`,hit.id);
        const length=Math.hypot(p.x-this.pose.x,p.z-this.pose.z),rotation=Math.abs(N.delta(this.pose.angle,p.angle));
        if(this.profile.probeDelay&&length>0&&Math.floor(this.distance/.8)!==Math.floor((this.distance+length)/.8))this.probe();
        this.minClearance=Math.min(this.minClearance,this.clearance(p));this.append(p,Math.max(.04,length/this.profile.speed,rotation/this.profile.angularSpeed),rotation>.1?'转向':action);
      }
      if(!route.success){const collision=this.grid.collisionAt(this.pose.x,this.pose.z,1.2);return this.fail('path_blocked',route.reason,collision?.obstacle?.semanticId);}return true;
    }
    turn(angle,action='转身定位'){const p={...this.pose,angle};if(!N.swept(this.grid,this.pose,p,this.profile)){const collision=this.grid.collisionAt(p.x,p.z,1.4);return this.fail('turn_failed','转向扫掠包络与家具或隔墙重叠',collision?.obstacle?.semanticId);}this.append(p,Math.abs(N.delta(this.pose.angle,angle))/this.profile.angularSpeed,action);return true;}
    reach(x,z,height,itemId,action){const distance=Math.hypot(x-this.pose.x,z-this.pose.z);if(distance>this.profile.reach+.03||height>this.profile.maxHeight)return this.fail('reach_failed',`操作点距离 ${distance.toFixed(2)} m / 高度 ${height.toFixed(2)} m，超出此画像的模拟触达范围`,itemId);this.wait(this.profile.type==='upper'?3:1.5,action);return true;}
    openDoor(id,inside=false){const d=this.model.doors.find(d=>d.id===id),offset=this.profile.length/2+.25;
      const approach=d.axis==='x'?{x:d.x+d.width/2-.18,z:d.z+(inside?-offset:offset),angle:inside?0:Math.PI}:{x:d.x-offset,z:d.z+d.width/2-.18,angle:Math.PI/2};
      if(!this.move(approach,'靠近门把手'))return false;const line=leafPoints(d,0),handle={x:line.hinge.x+line.dx*(d.width-.18),z:line.hinge.z+line.dz*(d.width-.18)};
      const ext=d.handleExtension||0,dist=Math.hypot(approach.x-handle.x,approach.z-handle.z)||1;handle.x+=(approach.x-handle.x)/dist*ext;handle.z+=(approach.z-handle.z)/dist*ext;if(!this.reach(handle.x,handle.z,d.handleHeight,id,'触达 / 握住门把手'))return false;if(d.effort>this.profile.doorEffort)return this.fail('door_operation',`${d.name}操作阻力 ${d.effort.toFixed(2)} 超过画像阈值 ${this.profile.doorEffort.toFixed(2)}`,id);
      for(let step=1;step<=18;step++){const t=step/18,line=leafPoints(d,t);for(let u=.18;u<d.width-.12;u+=.06){const x=line.hinge.x+line.dx*u,z=line.hinge.z+line.dz*u;for(const other of this.model.doors){if(other.id===id)continue;const l=leafPoints(other,this.doors[other.id]),v=L.clamp((x-l.hinge.x)*l.dx+(z-l.hinge.z)*l.dz,0,other.width);if(Math.hypot(x-l.hinge.x-l.dx*v,z-l.hinge.z-l.dz*v)<.055)return this.fail('door_swing',`${d.name}扫掠与${other.name}门叶冲突`,id,{x,z});}if(!this.grid.isClear(x,z,.022)){const o=this.grid.collisionAt(x,z,.12)?.obstacle;if(o?.kind==='wall'&&(u<this.grid.cell+.12||d.width-u<this.grid.cell+.12))continue;return this.fail('door_swing',`${d.name}开启扫掠被${o?.name||'构件'}阻挡`,id,{x,z});}}}
      if(Array.from({length:18},(_,i)=>(i+1)/18).some(t=>leafHits(d,t,this.pose,this.profile))){
        let retreat=null;for(const[dx,dz]of [[-1,1],[0,1],[-1,0],[1,1],[0,-1],[1,0],[-1,-1],[1,-1]]){const p={x:this.pose.x+dx*1.15,z:this.pose.z+dz*1.15,angle:this.pose.angle};if(N.swept(this.grid,this.pose,p,this.profile)&&Array.from({length:18},(_,i)=>(i+1)/18).every(t=>!leafHits(d,t,p,this.profile))){retreat=p;break;}}
        if(!retreat)return this.fail('door_swing',`${d.name}扫掠占据操作区，住户没有安全退让位置`,id);this.append(retreat,1.6,'开门退让');
      }
      for(let i=1;i<=12;i++){this.doors[id]=i/12;this.wait(.2,'开启'+d.name);}return true;
    }
    run(){let success=false;const p=this.profile;
      if(this.task==='sofa')success=this.openDoor('entryDoor')&&this.move({x:0,z:4.9})&&this.move({x:-4.8,z:2.5})&&this.turn(Math.PI)&&!!this.wait(1,'靠近沙发 / 完成');
      if(this.task==='bathroom')success=this.openDoor('bedDoor')&&this.move({x:0,z:-1.5})&&this.openDoor('bathDoor')&&this.move({x:4.7,z:-2.2})&&this.turn(0);
      if(this.task==='fridge'){const item=L.materializeItem(this.model.spec.items.find(i=>i.id==='fridge')),goal={x:item.x,z:item.z+item.d/2+p.length/2+.25,angle:Math.PI};success=this.move(goal,'靠近冰箱')&&this.reach(item.x,item.z+item.d/2+.07,item.handleHeight,'fridge','开启冰箱 / 取物');}
      if(this.task==='transfer'){success=this.move({x:-3.7,z:-3.75,angle:-Math.PI/2},'靠近床侧')&&this.turn(-Math.PI/2);if(success){if(!N.poseClear(this.grid,this.pose.x+p.transferPadding,this.pose.z,this.pose.angle,p.width+2*p.transferPadding,p.length+2*p.transferPadding))success=this.fail('transfer_failed','床侧转移包络与扶手椅或床体重叠','transferChair');else{this.wait(5,'床椅侧向转移 / 几何模拟');success=true;}}}
      if(this.task==='evacuate')success=this.openDoor('bedDoor')&&this.move({x:0,z:4.5})&&this.openDoor('entryDoor',true)&&this.move({x:0,z:7.05},'疏散至门外');
      // The last action has no return value; success depends on issue-free completion.
      if(this.task==='sofa'&&!this.issues.length)success=true;
      return{task:this.task,name:L.RESIDENT_TASKS.find(t=>t.id===this.task).name,profile:JSON.parse(JSON.stringify(p)),start:this.start,success:!!success,completedSeconds:success?this.time:null,duration:this.time,distance:this.distance,minClearance:Number.isFinite(this.minClearance)?this.minClearance:0,collisions:this.issues.filter(i=>i.code==='closed_door'||i.code==='collision').length,turnFailures:this.issues.filter(i=>i.code==='turn_failed').length,pathFailures:this.issues.filter(i=>i.code==='path_blocked').length,reachFailures:this.issues.filter(i=>i.code==='reach_failed').length,doorFailures:this.issues.filter(i=>i.code.startsWith('door')).length,transferFailures:this.issues.filter(i=>i.code==='transfer_failed').length,issues:this.issues,probes:this.probes||[],actions:this.actions,trace:this.trace};
    }
  }
  L.residentDoorHits=leafHits;L.runResidentSuite=(grid,model,profile,ids)=>ids.map(id=>new Trial(grid,model,profile,id).run());
  L.residentSummary=results=>({tasks:results.length,completed:results.filter(r=>r.success).length,collisions:results.reduce((s,r)=>s+r.collisions,0),turnFailures:results.reduce((s,r)=>s+r.turnFailures,0),pathFailures:results.reduce((s,r)=>s+r.pathFailures,0),reachFailures:results.reduce((s,r)=>s+r.reachFailures,0),doorFailures:results.reduce((s,r)=>s+r.doorFailures,0),transferFailures:results.reduce((s,r)=>s+r.transferFailures,0),minClearance:results.length?Math.min(...results.map(r=>r.minClearance)):0,totalAttemptSeconds:results.reduce((s,r)=>s+r.duration,0)});
  class ResidentSimulation extends L.Simulation{
    constructor(grid,model,profile,ids,prepared){super(grid,[],{count:0});this.model=model;this.residentProfile=profile;this.results=prepared||L.runResidentSuite(grid,model,profile,ids);this.settings={count:1,population:profile.type,vision:profile.type==='blind'?0:160,search:8,speed:1,goalPolicy:'task'};this.isResident=true;this.resetPlayback();}
    resetPlayback(){this.time=0;this.finished=false;this.taskIndex=0;this.localTime=0;this.cursor=0;this.contacts=0;this.blocked=0;this.obstructions=0;this.arrivals=0;this.distance=0;this.events=[];this.cellIncidents=new Map();this.eventTotal=0;this.grid.resetHeat();this.history=[];this.agents=[{id:0,type:this.residentProfile.type,profile:{...L.PROFILES[this.residentProfile.type],radius:this.residentProfile.width/2},...this.results[0]?.start,vx:0,vz:0,state:'moving',angle:this.results[0]?.start.angle||0,trail:[],search:8,goal:{name:this.results[0]?.name||'等待任务'}}];for(const d of this.model.doors)this.model.setDoor(d.id,0);}
    tick(dt){if(this.finished)return;const result=this.results[this.taskIndex],a=this.agents[0];if(!result){this.finished=true;return;}this.time+=dt;this.localTime+=dt;const trace=result.trace;while(this.cursor+1<trace.length&&trace[this.cursor+1].time<=this.localTime)this.cursor++;const p=trace[this.cursor],q=trace[Math.min(this.cursor+1,trace.length-1)],t=q.time>p.time?L.clamp((this.localTime-p.time)/(q.time-p.time),0,1):1;const old={x:a.x,z:a.z};a.x=p.x+(q.x-p.x)*t;a.z=p.z+(q.z-p.z)*t;a.angle=p.angle+N.delta(p.angle,q.angle)*t;a.vx=(a.x-old.x)/dt;a.vz=(a.z-old.z)/dt;a.action=q.action;a.state='moving';a.goal={name:result.name};for(const[id,value]of Object.entries(q.doors))this.model.setDoor(id,value);a.trail.push({x:a.x,z:a.z});if(a.trail.length>120)a.trail.shift();
      if(this.localTime>=result.duration+.4){for(const issue of result.issues){const type=issue.code==='closed_door'?'contact':'blocked';if(type==='contact')this.contacts++;else{this.blocked++;this.obstructions++;}const obstacle=this.grid.obstacles.find(o=>o.semanticId===issue.itemId)||{id:'semantic:'+issue.itemId,name:this.model.doors.find(d=>d.id===issue.itemId)?.name||issue.itemId||'任务操作区',kind:'task'};this.event(a,type,issue.reason,a,{code:issue.code,evidence:'数字住户任务执行器记录；栅格为最后安全停留位置',collision:{obstacle,point:{x:issue.x,z:issue.z}},taskId:result.task});}if(result.success)this.arrivals++;this.distance+=result.distance;this.taskIndex++;this.localTime=0;this.cursor=0;a.trail=[];if(this.taskIndex>=this.results.length){this.finished=true;a.state='arrived';}else{const start=this.results[this.taskIndex].start;Object.assign(a,start);}}
    }
  }
  L.ResidentSimulation=ResidentSimulation;
})();







