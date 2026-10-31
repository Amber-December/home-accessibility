/* Destination steering, grid routing, predictive separation and swept disc collision. */
(() => {
  'use strict';const L=window.IndoorLab;
  class Simulation{
    constructor(grid,goals,settings={}){this.grid=grid;this.goals=goals;this.settings={count:32,population:'mixed',speed:1,vision:180,search:8,seed:21879,maxEvents:5000,...settings};this.schema='access-lab/simulation';this.version='0.2';this.hazard=null;this.hazardType='none';this.hazardExits=[];this.dynamicBodies=[];this.reset();}
    syncDynamicBody(body){if(!body)return;if(typeof body.sync==='function'){body.sync(body);return;}if(body.object){body.object.position.x=body.x;body.object.position.z=body.z;}}
    setDynamicBodies(bodies=[]){this.dynamicBodies=Array.isArray(bodies)?bodies.filter(Boolean):[];for(const b of this.dynamicBodies){b.vx=Number(b.vx)||0;b.vz=Number(b.vz)||0;b.mass=Math.max(.1,Number(b.mass)||20);b.friction=Number.isFinite(b.friction)?b.friction:.86;b.pushable=b.pushable!==false;this.syncDynamicBody(b);}}
    dynamicBodyAt(x,z,radius=0,agent=null){let best=null;for(const body of this.dynamicBodies){if(body.removed||body.pushable===false&&!body.collisionOnly||body.ignoreAgents?.has?.(agent?.id))continue;const dx=x-body.x,dz=z-body.z,dist=Math.hypot(dx,dz),safe=radius+(body.radius||.35);if(dist<safe){const length=dist||.0001;const nx=dist?dx/length:1,nz=dist?dz/length:0;const hit={body,nx,nz,overlap:safe-dist};if(!best||hit.overlap>best.overlap)best=hit;}}return best;}
    moveDynamicBody(hit,v,dt){const body=hit?.body;if(!body||body.collisionOnly)return false;const push=Math.max(.35,Math.min(2.4,(Math.hypot(v.x,v.z)||0)*dt*1.7))/Math.max(.1,body.mass/18);body.vx+=(v.x*push+hit.nx*hit.overlap*.5);body.vz+=(v.z*push+hit.nz*hit.overlap*.5);const oldX=body.x,oldZ=body.z;const nx=body.x+hit.nx*hit.overlap*.72+body.vx*dt,nz=body.z+hit.nz*hit.overlap*.72+body.vz*dt;if(this.grid.isClear(nx,nz,Math.max(.08,body.radius||.2))){body.x=nx;body.z=nz;}else{const xOnly=this.grid.isClear(nx,body.z,Math.max(.08,body.radius||.2)),zOnly=this.grid.isClear(body.x,nz,Math.max(.08,body.radius||.2));if(xOnly)body.x=nx;else if(zOnly)body.z=nz;else{body.vx*=-.16;body.vz*=-.16;}}body.vx*=Math.pow(body.friction,Math.max(1,dt*30));body.vz*=Math.pow(body.friction,Math.max(1,dt*30));const moved=Math.hypot(body.x-oldX,body.z-oldZ);body.pushedDistance=(body.pushedDistance||0)+moved;if(moved>.0001)body.lastMovedAt=this.time;this.syncDynamicBody(body);return moved>.0001;}
    stepDynamicBodies(dt){for(const body of this.dynamicBodies){if(body.removed)continue;const oldX=body.x,oldZ=body.z,nx=body.x+body.vx*dt,nz=body.z+body.vz*dt,r=Math.max(.08,body.radius||.2);if(this.grid.isClear(nx,nz,r)){body.x=nx;body.z=nz;}else{const xOnly=this.grid.isClear(nx,body.z,r),zOnly=this.grid.isClear(body.x,nz,r);if(xOnly)body.x=nx;else if(zOnly)body.z=nz;else{body.vx*=-.2;body.vz*=-.2;}}body.vx*=Math.pow(body.friction,Math.max(1,dt*30));body.vz*=Math.pow(body.friction,Math.max(1,dt*30));this.syncDynamicBody(body);if(Math.abs(body.x-oldX)+Math.abs(body.z-oldZ)>.002)body.lastMovedAt=this.time;}}
    setHazard(hazard,type='none',exits=[]){
      this.hazard=hazard||null;this.hazardType=hazard?type:'none';this.hazardExits=exits||[];this._hazardFields=new Map();this._hazardRouteAt=-Infinity;this._shake=0;this.hazardStartedAt=this.time;
      this.hazard?.rebuildEscapeDistance?.(this.hazardExits);
      for(const a of this.agents){
        a.evacuating=false;a.evacuated=false;a.noticeAt=null;a.protectUntil=0;a.nextReplan=0;a.smokeDose=0;a.fatigue=0;a.reroutes=0;a.hazardExposureTime=0;a._pendingTransitionReason=hazard?'灾害开始':'灾害结束';
        // Stable individual response variation; it does not depend on render rate.
        a.reactionDelay=(a.profile?.reactionDelay??.24)+((a.id*73+19)%101)/101*.72;
        a.reaction={code:'calm',phase:'unaware',text:'观察空间',fear:0,posture:'upright',speedFactor:1};
        a.yieldUntil=0;a.state='moving';if(!hazard)this.assignGoal(a);
      }
    }
    random(){this.seed=(this.seed*1664525+1013904223)>>>0;return this.seed/4294967296;}
    reset(){this.seed=(Number(this.settings.seed)>>>0)||21879;this.initialSeed=this.seed;this.time=0;this.arrivals=0;this.contacts=0;this.dynamicFurnitureContacts=0;this.blocked=0;this.obstructions=0;this.failureCounts={};this.distance=0;this.events=[];this.cellIncidents=new Map();this.eventTotal=0;this.agents=[];this.grid.resetHeat();this.nextTrail=0;this.history=[];this.stateTransitions=0;this._qualityCache=null;
      const count=this.settings.count;
      for(let id=0;id<count;id++){
        // Keep the mixed demo representative across four occupant profiles.
          const requestedType=this.settings.population;
          const type=requestedType==='mixed'?(id%4===0?'wheelchair':id%4===1?'assisted':id%4===2?'upper':'pedestrian'):requestedType;
          const profile=L.PROFILES[type]||L.PROFILES.pedestrian,free=this.grid.nav(profile.radius).mainFree;if(!free.length)continue;
        let p=null;
        for(let trial=0;trial<300;trial++){const candidate=this.grid.point(free[Math.floor(this.random()*free.length)]);if(this.agents.every(a=>Math.hypot(a.x-candidate.x,a.z-candidate.z)>a.profile.radius+profile.radius+.08)){p=candidate;break;}}
        if(!p)continue;const a={id,...p,type,profile,vx:0,vz:0,angle:this.random()*Math.PI*2,state:'moving',_lastState:'moving',_stateSince:0,_pendingTransitionReason:'初始化',trail:[],path:[],pathAt:0,goal:null,wait:0,stalled:0,contactAt:-5,blockedTrip:false,trip:0,search:this.settings.search,preferredSide:profile.preferredSide??(id%2?1:-1),yieldUntil:0,distance:0,routeDistance:0,routeIdealDistance:0,waitTime:0,crowdWaitTime:0,geometryWaitTime:0,reroutes:0,smokeDose:0,hazardExposureTime:0,minClearance:Infinity,minClearanceAt:null,minClearancePoint:null,minClearanceObject:null,statusHistory:[]};this.agents.push(a);this.assignGoal(a);
      }
    }
    assignGoal(a){
      if(this.hazard){if(a.evacuated)return;if(a.evacuating)this.assignEscapeRoute(a);return;}
      if(!this.goals.length&&this.settings.goalPolicy==='custom'){a.goal=null;a.path=[];a._pendingTransitionReason='没有可用目标';a.state='waiting';a.wait=1;return;}
      const all=this.goals.filter(g=>g.id!==a.goal?.id&&Math.hypot(g.x-a.x,g.z-a.z)>.65),near=all.filter(g=>Math.hypot(g.x-a.x,g.z-a.z)<=this.settings.search),choices=near.length?near:all;
      let goal=choices[Math.floor(this.random()*choices.length)];
      // Wander within the search radius when no fixed destinations are available.
      if(!goal&&this.goals.length){goal=this.goals[Math.floor(this.random()*this.goals.length)];if(Math.hypot(goal.x-a.x,goal.z-a.z)<.65){a.goal=goal;a._pendingTransitionReason='目标就在当前位置';a.state='arrived';a.wait=2;return;}}
      if(!goal){const nav=this.grid.nav(a.profile.radius),free=nav.mainFree;for(let n=0;n<30;n++){const p=this.grid.point(free[Math.floor(this.random()*free.length)]);if(Math.hypot(p.x-a.x,p.z-a.z)<=this.settings.search&&Math.hypot(p.x-a.x,p.z-a.z)>1){goal={id:-1,name:'随机探索点',...p};break;}}}
      if(!goal){a._pendingTransitionReason='找不到候选目标';a.state='waiting';a.wait=2;return;}
      a.goal=goal;a.trip++;a.blockedTrip=false;a.stalled=0;a.lastConstraint=null;const route=this.hazard?.route?this.hazard.route(a,goal,a.profile.radius):this.grid.route(a,goal,a.profile.radius);a.path=route.path;a.pathAt=0;a.reachable=route.reachable;a.endpoint=route.endpoint;a.routeIdealDistance=Math.hypot(goal.x-a.x,goal.z-a.z);a.routeDistance=0;for(let i=1;i<route.path.length;i++)a.routeDistance+=Math.hypot(route.path[i].x-route.path[i-1].x,route.path[i].z-route.path[i-1].z);if(route.reachable&&a.routeDistance<.001)a.routeDistance=a.routeIdealDistance;a.routeStartedAt=this.time;a._pendingTransitionReason='重新规划到目标';a.state='moving';
      if(!a.path.length){this.blockTrip(a,'没有可用通行路径');}
    }
    hazardBlocked(x,z,radius=0){
      const h=this.hazard;if(!h)return false;
      if(h.isUnsafe?.(x,z,radius))return true;
      if(!h.isHazardBlocked)return false;
      if(h.isHazardBlocked({x,z}))return true;
      // The same body envelope is used by routing, forward motion and sliding.
      for(let j=0;radius>0&&j<8;j++){const t=j*Math.PI/4;if(h.isHazardBlocked({x:x+Math.cos(t)*radius,z:z+Math.sin(t)*radius}))return true;}
      return false;
    }
    hazardLineClear(a,b,radius,escape=false){
      if(!this.grid.lineClear(a,b,radius))return false;
      const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/Math.min(.08,this.grid.cell*.4)));
      let initialBlocked=escape&&this.hazardBlocked(a.x,a.z,radius);
      for(let k=0;k<=n;k++){const t=k/n,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,blocked=this.hazardBlocked(x,z,radius);if(!blocked)initialBlocked=false;else if(!initialBlocked)return false;}
      return true;
    }
    hazardNavigation(radius){
      if(!this._hazardFields)this._hazardFields=new Map();
      if(this._hazardFields.has(radius))return this._hazardFields.get(radius);
      const g=this.grid,nav=g.nav(radius),valid=new Uint8Array(g.size),goals=[],exitFields=[];
      for(const i of nav.free){const p=g.point(i);if(!this.hazardBlocked(p.x,p.z,radius))valid[i]=1;}
      // Build one distance field per exit. A single shared field always sends
      // everyone to the geometrically nearest door, which creates a crowd
      // plug even when other doors are clear.
      for(const exit of this.hazardExits){
        let at=-1,best=Infinity;
        for(const i of nav.free){if(!valid[i])continue;const p=g.point(i),d=Math.hypot(p.x-exit.x,p.z-exit.z);if(d<best){best=d;at=i;}}
        if(at<0||best>Math.max(1.2,radius+g.cell*2)||Number.isFinite(exit.width)&&exit.width<radius*2+.08)continue;
        const id=goals.length,goal={...exit,...g.point(at),id:-(id+1),name:exit.name||`逃生出口 ${id+1}`};
        const dist=new Float32Array(g.size),next=new Int32Array(g.size),heap=new L.Heap();dist.fill(Infinity);next.fill(-1);dist[at]=0;heap.push(at,0);
        while(heap.length){const item=heap.pop(),i=item.id;if(!item||item.cost>dist[i]+.0001)continue;g.neighbors(i,valid,(j,step)=>{const penalty=Math.min(15,Math.max(1,this.hazard?.navigationPenalty?.(g.point(j))||1)),d=dist[i]+step*penalty;if(d<dist[j]){dist[j]=d;next[j]=i;heap.push(j,d);}});}
        goals.push(goal);exitFields.push({goal,dist,next});
      }
      const dist=new Float32Array(g.size),next=new Int32Array(g.size),exitFor=new Int16Array(g.size);dist.fill(Infinity);next.fill(-1);exitFor.fill(-1);
      for(let i=0;i<g.size;i++)if(valid[i])for(let e=0;e<exitFields.length;e++){const field=exitFields[e];if(field.dist[i]<dist[i]){dist[i]=field.dist[i];next[i]=field.next[i];exitFor[i]=e;}}
      const field={valid,dist,next,exitFor,goals,exitFields};this._hazardFields.set(radius,field);return field;
    }
    assignEscapeRoute(a){
      if(a.evacuated||!this.hazard)return;
      const g=this.grid,f=this.hazardNavigation(a.profile.radius),here=g.index(a.x,a.z),fields=f.exitFields||[];let start=here;
      const reachableAt=i=>fields.some(field=>Number.isFinite(field.dist[i]));
      if(start<0||!reachableAt(start)){
        // If the current cell has just become unsafe, search a short list of
        // nearest reachable cells and validate only those candidates. Testing
        // line-of-sight for every free cell made a single agent entering a
        // smoke plume trigger thousands of grid samples and stall the frame.
        const limit=Math.max(1.2,g.cell*5), candidates=[];
        for(const i of g.nav(a.profile.radius).free){if(!reachableAt(i))continue;const p=g.point(i),d=Math.hypot(p.x-a.x,p.z-a.z);if(d>limit)continue;let at=0;while(at<candidates.length&&candidates[at].d<=d)at++;candidates.splice(at,0,{i,d});if(candidates.length>24)candidates.pop();}
        start=-1;
        for(const item of candidates){const p=g.point(item.i);if(this.hazardLineClear(a,p,a.profile.radius,true)){start=item.i;break;}}
      }
      a.nextReplan=this.time+1.05+(a.id%5)*.09;
      if(start<0||!reachableAt(start)){a.path=[];a.reachable=false;a.state='blocked';a.wait=.35;a.vx=a.vz=0;a.reaction.code='trapped';a.reaction.text=a.type==='wheelchair'||a.type==='assisted'?'通道受阻，需要协助':'出口受阻，寻找通路';a.reaction.phase='waiting';return;}
      // Choose among all reachable exits. Load balancing prevents a clear
      // doorway from becoming a single-file jam while another exit is empty.
      const candidates=fields.map((field,index)=>({field,index,distance:field.dist[start]})).filter(item=>Number.isFinite(item.distance));
      let chosen=candidates[0],best=Infinity;
      for(const item of candidates){const goalId=item.field.goal.id,load=this.agents.reduce((n,b)=>n+(b!==a&&b.evacuating&&b.goal?.id===goalId?1:0),0),sideBias=item.index%2===((a.id+(a.preferredSide>0?1:0))%2)?-.42:0,repeat=a.lastExitId===goalId?-.28:0,score=item.distance+load*1.65+sideBias+repeat;if(score<best){best=score;chosen=item;}}
      if(!chosen){a.path=[];a.reachable=false;a.state='blocked';a.wait=.35;a.vx=a.vz=0;a.reaction.code='trapped';a.reaction.text='暂时没有可用出口';a.reaction.phase='waiting';return;}
      // Follow the shared distance field and keep only a small number of
      // validated waypoints. The old greedy smoother tested every candidate
      // against every other candidate (up to 24 line-of-sight checks per
      // waypoint), which made 32-agent evacuation stalls visible in the UI.
      // A field path is already cell-valid; validating one waypoint every
      // ~0.6 m preserves obstacle clearance while keeping route rebuilds
      // bounded and deterministic.
      const raw=[];let cursor=start;for(let n=0;n<g.size&&cursor>=0;n++){raw.push(cursor);cursor=chosen.field.next[cursor];}
      const path=[];let anchor=a,at=0,step=Math.max(1,Math.round(.6/g.cell));
      while(at<raw.length){
        let targetAt=Math.min(raw.length-1,at+step-1),candidate=g.point(raw[targetAt]);
        // If a long segment crosses a corner, back up to the nearest valid
        // field cell. At most three checks are needed for each waypoint.
        let checks=0;while(targetAt>at&&!this.hazardLineClear(anchor,candidate,a.profile.radius+.015,anchor===a)&&checks++<3){targetAt=Math.max(at,targetAt-Math.ceil(step/3));candidate=g.point(raw[targetAt]);}
        path.push(candidate);anchor=candidate;at=targetAt+1;
      }
      const previous=a.goal?.id;a.goal=chosen.field.goal;a.lastExitId=a.goal.id;a.path=path;a.pathAt=0;a.reachable=true;a.endpoint=path[path.length-1];a.state='moving';a.stalled=0;
      if(previous!==a.goal.id||a.blockedTrip){a.reroutes=(a.reroutes||0)+1;a.reaction.code='rerouting';a.reaction.text='避开危险，改走通路';a.rerouteUntil=this.time+1.1;}
      a.blockedTrip=false;
    }
    updateHazardResponse(a,dt){
      if(!this.hazard)return;const h=this.hazard,elapsed=this.time-this.hazardStartedAt;
      if(!a.reaction)a.reaction={code:'calm',phase:'unaware',text:'观察空间',fear:0,posture:'upright',speedFactor:1};
      const r=a.reaction;
      if(a.evacuated){a.state='safe';r.code='safe';r.phase='safe';r.text='已到疏散集合点';r.posture='upright';r.speedFactor=0;r.fear=Math.max(0,r.fear-dt*.12);return;}
      const fire=this.hazardType==='fire',local=fire?h.hazardAt?.(a):null,smoke=local?.smoke||0,risk=local?.risk||0;
      a.smokeDose=(a.smokeDose||0)+smoke*dt;
      let perceived=fire?(smoke>.035||(local?.temperature||20)>42||risk>.1):this._shake>.025;
      // Nearby fire is visible only through a clear sightline; distant agents hear a delayed alarm.
      if(fire&&!perceived&&h.sources)for(const source of h.sources){const p=Number.isInteger(source.cell)?this.grid.point(source.cell):source;if(Number.isFinite(p.x)&&Math.hypot(p.x-a.x,p.z-a.z)<5&&this.grid.lineClear(a,p,.03)){perceived=true;break;}}
      if(a.noticeAt==null&&elapsed>=a.reactionDelay&&(perceived||elapsed>2.8+a.reactionDelay*1.6)){
        a.noticeAt=this.time;r.code=fire?'alarm':'startled';r.text=fire?'发现烟火！':'感觉到摇晃！';r.phase='reacting';r.fear=.45+(a.id%4)*.08;
      }
      if(a.noticeAt==null){r.code='calm';r.text='观察周围';return;}
      r.fear=L.clamp(r.fear+dt*((fire?risk+smoke*.2:this._shake)*.18-.012),.22,1);
      if(this.time-a.noticeAt<.5+a.reactionDelay*.35){a.state='reacting';a.vx=a.vz=0;r.posture=fire?'alert':(a.type==='wheelchair'||a.type==='assisted'?'brace':'crouch');r.speedFactor=0;return;}
      if(!fire){const shaking=h.shaking===undefined?!!h.active:!!h.shaking;
        if(shaking&&this._shake>.045)a.protectUntil=this.time+.85;
        if(this.time<a.protectUntil){a.state='reacting';a.vx=a.vz=0;r.code='protect';r.phase='protect';r.text=a.type==='wheelchair'?'制动稳住，保护头部':a.type==='assisted'?'扶稳辅助器，保护头部':'蹲低，护住头颈';r.posture=a.type==='wheelchair'||a.type==='assisted'?'brace':'crouch';r.speedFactor=0;return;}
      }
      if(!a.evacuating){a.evacuating=true;a.nextReplan=0;}
      a.fatigue=L.clamp((a.fatigue||0)+dt*((a.evacuating?.003:0)+smoke*.008),0,.65);
      r.posture=fire&&smoke>.16?(a.type==='wheelchair'?'cough':'duck'):'upright';
      r.speedFactor=(a.type==='pedestrian'?1.2:a.type==='wheelchair'?1.03:a.type==='assisted' ? .92 : 1.08)*(1-a.fatigue*.35)*Math.max(.35,1-smoke*.22);
      if(this.time>=a.nextReplan||!a.path.length&&a.state!=='blocked')this.assignEscapeRoute(a);
      if(a.state==='reacting')a.state='moving';
      if(a.state==='blocked'){r.code='trapped';r.phase='waiting';r.text=a.type==='wheelchair'||a.type==='assisted'?'通道受阻，需要协助':'出口受阻，寻找通路';return;}
      r.phase='evacuating';
      if(this.time<(a.contactUntil||0)){r.code='contact';r.text=a.contactText||'碰到障碍，正在避让';}
      else if(fire&&smoke>.16){r.code='smoke';r.text=a.type==='wheelchair'?'烟雾逼近，尽快离开':'烟雾呛人，低姿前行';}
      else if(this.time<(a.rerouteUntil||0)){r.code='rerouting';r.text='避开危险，改走通路';}
      else{r.code='evacuating';r.text=fire?'远离烟火，寻找出口':'摇晃减弱，避开落物';}
    }
    event(a,type,reason,p=a,details={}){
      const i=this.grid.index(p.x,p.z),physical=type==='contact'||(type==='blocked'&&(details.rawCode||details.code)!=='crowd_wait');
      if(i>=0&&type==='contact')this.grid.heat.contact[i]++;
      if(i>=0&&type==='blocked'){this.grid.heat.blocked[i]++;if(physical)this.grid.heat.obstruction[i]++;}
      const event={id:++this.eventTotal,time:this.time,type,agent:a.id,profile:a.type,x:p.x,z:p.z,cellIndex:i,goal:a.goal?.name||'随机探索',reason,requiredWidth:a.profile.radius*2,physical,...details};
      this.events.push(event);if(this.events.length>(this.settings.maxEvents||5000))this.events.shift();
      if(i>=0&&(type==='contact'||type==='blocked')){let item=this.cellIncidents.get(i);if(!item){item={index:i,contact:0,blocked:0,obstruction:0,crowd:0,firstTime:this.time,lastTime:this.time,causes:{},profiles:{},obstacles:{},recent:[]};this.cellIncidents.set(i,item);}if(type==='contact')item.contact++;else{item.blocked++;item[physical?'obstruction':'crowd']++;}item.lastTime=this.time;const key=event.code||type;const cause=item.causes[key]||(item.causes[key]={code:key,reason,count:0});cause.count++;item.profiles[a.type]=(item.profiles[a.type]||0)+1;if(event.collision?.obstacle){const o=event.collision.obstacle;item.obstacles[o.id]={...o,count:(item.obstacles[o.id]?.count||0)+1};}item.recent.push(event);if(item.recent.length>8)item.recent.shift();}
      this.onEvent?.(event);return event;
    }
    transition(a,next,reason=''){
      if(!a||a.state===next)return;
      a._pendingTransitionReason=reason||a._pendingTransitionReason||`状态变为 ${next}`;
      a.state=next;
    }
    recordStateTransitions(){
      for(const a of this.agents){if(a._lastState===a.state)continue;const from=a._lastState||'unknown',to=a.state;a.statusHistory=a.statusHistory||[];const item={time:this.time,from,to,reason:a._pendingTransitionReason||`状态变为 ${to}`};a.statusHistory.push(item);if(a.statusHistory.length>64)a.statusHistory.shift();this.stateTransitions++;this.event(a,'state_transition',item.reason,a,{code:'state_transition',from,to,heat:false});a._lastState=to;a._stateSince=this.time;a._pendingTransitionReason='';}
    }
    classifyFailure(a,code='route_disconnected'){
      const c=a.lastConstraint?.collision?.obstacle||null;
      if(code==='crowd_wait')return 'crowd_bottleneck';
      if(this.hazardType==='fire'){
        const local=this.hazard?.hazardAt?.(a)||{};
        if((local.temperature||0)>=180)return 'fire_high_temperature';
        if((local.smoke||0)>=.55)return 'smoke_exposure';
        return 'fire_route_blocked';
      }
      if(this.hazardType==='earthquake')return c?.kind==='debris'||c?.kind==='dynamic_debris'?'earthquake_debris':'earthquake_route_blocked';
      if(c?.kind==='floor_edge')return 'floor_edge';
      if(c?.kind==='dynamic_furniture')return 'dynamic_furniture_collision';
      if(c?.kind==='door')return 'door_width';
      if(code==='geometry_stall')return 'geometry_stall';
      return code;
    }
    updateClearance(a){
      const clearance=this.grid.clearanceAt(a.x,a.z,a.profile.radius);
      a.clearance=clearance;if(clearance<a.minClearance){a.minClearance=clearance;a.minClearanceAt=this.time;a.minClearancePoint={x:a.x,z:a.z};const nearest=this.grid.nearestObstacle(a.x,a.z,Math.max(0,a.profile.radius+Math.max(0,clearance)));a.minClearanceObject=nearest?.id??null;}
    }
    clearanceStats(){
      const values=this.agents.map(a=>a.minClearance).filter(Number.isFinite),sorted=values.slice().sort((a,b)=>a-b),percentile=p=>sorted.length?sorted[Math.min(sorted.length-1,Math.max(0,Math.floor((sorted.length-1)*p)))]:null;
      const byProfile={};for(const a of this.agents){const key=a.type;if(!byProfile[key])byProfile[key]={profile:key,count:0,minClearanceM:Infinity,meanClearanceM:0};const row=byProfile[key];row.count++;row.minClearanceM=Math.min(row.minClearanceM,a.minClearance);row.meanClearanceM+=Number.isFinite(a.minClearance)?a.minClearance:0;}for(const row of Object.values(byProfile)){row.meanClearanceM=row.count?row.meanClearanceM/row.count:null;if(!Number.isFinite(row.minClearanceM))row.minClearanceM=null;}
      return{count:values.length,minClearanceM:values.length?sorted[0]:null,p10ClearanceM:percentile(.1),medianClearanceM:percentile(.5),meanClearanceM:values.length?values.reduce((s,v)=>s+v,0)/values.length:null,byProfile};
    }
    agentMetrics(){return this.agents.map(a=>({id:a.id,profile:a.type,state:a.state,goal:a.goal?.name||null,arrived:a.state==='arrived'||a.state==='safe',evacuated:!!a.evacuated,distanceM:Number((a.distance||0).toFixed(4)),plannedPathM:Number((a.routeDistance||0).toFixed(4)),routeIdealM:Number((a.routeIdealDistance||0).toFixed(4)),detourRatio:a.routeIdealDistance>1e-6?Number((a.routeDistance/a.routeIdealDistance).toFixed(4)):null,reroutes:a.reroutes||0,waitTimeS:Number((a.waitTime||0).toFixed(3)),crowdWaitTimeS:Number((a.crowdWaitTime||0).toFixed(3)),geometryWaitTimeS:Number((a.geometryWaitTime||0).toFixed(3)),smokeDose:Number((a.smokeDose||0).toFixed(4)),hazardExposureTimeS:Number((a.hazardExposureTime||0).toFixed(3)),minClearanceM:Number.isFinite(a.minClearance)?Number(a.minClearance.toFixed(4)):null,minClearanceAt:Number.isFinite(a.minClearanceAt)?Number(a.minClearanceAt.toFixed(3)):null,minClearancePoint:a.minClearancePoint,minClearanceObject:a.minClearanceObject,failureCode:a.failureCode||null,statusHistory:a.statusHistory||[]}));}
    qualityChecks(){
      const wallPenetrations=[],agentOverlaps=[],outside=[],invalidGoals=[],invalidHazardExits=[],unsafeHazardExits=[];
      for(const a of this.agents){if(!this.grid.isClear(a.x,a.z,Math.max(0,a.profile.radius-.001)))wallPenetrations.push(a.id);if(this.grid.index(a.x,a.z)<0)outside.push(a.id);if(a.goal&&this.grid.index(a.goal.x,a.goal.z)<0)invalidGoals.push(a.id);}
      for(let i=0;i<this.agents.length;i++)for(let j=i+1;j<this.agents.length;j++){const a=this.agents[i],b=this.agents[j];if(a.evacuated||b.evacuated)continue;if(Math.hypot(a.x-b.x,a.z-b.z)<a.profile.radius+b.profile.radius-.002)agentOverlaps.push([a.id,b.id]);}
      for(const exit of this.hazardExits||[]){if(this.grid.index(exit.x,exit.z)<0)invalidHazardExits.push(exit.id??exit.name??null);else if(this.hazard?.isUnsafe?.(exit.x,exit.z,0))unsafeHazardExits.push(exit.id??exit.name??null);}
      const dynamicBodies=this.dynamicBodies.filter(b=>!b.removed&&!this.grid.isClear(b.x,b.z,Math.max(.08,b.radius||.2))).map(b=>b.id);
      return{ok:!wallPenetrations.length&&!agentOverlaps.length&&!outside.length&&!invalidGoals.length&&!dynamicBodies.length&&!invalidHazardExits.length,wallPenetrations,agentOverlaps,outside,invalidGoals,invalidHazardExits,unsafeHazardExits,dynamicBodies};
    }
    manifest(){return{schema:this.schema,version:this.version,seed:this.initialSeed,settings:{...this.settings},grid:{origin:[this.grid.minX,this.grid.minZ],cellSize:this.grid.cell,rows:this.grid.rows,cols:this.grid.cols},hazard:{type:this.hazardType,startedAt:this.hazardStartedAt,exits:this.hazardExits.map(e=>({id:e.id,name:e.name,x:e.x,z:e.z,width:e.width}))},agents:this.agents.map(a=>({id:a.id,profile:a.type,radius:a.profile.radius,speed:a.profile.speed})),limits:{maxEvents:this.settings.maxEvents||5000,deterministic:true}};}
    blockTrip(a,reason,code='route_disconnected'){
      const failureCode=this.classifyFailure(a,code);a.failureCode=failureCode;
      if(!a.blockedTrip){a.blockedTrip=true;this.blocked++;if(code!=='crowd_wait')this.obstructions++;this.failureCounts[failureCode]=(this.failureCounts[failureCode]||0)+1;
        const collision=code==='crowd_wait'?null:(a.lastConstraint?.collision||this.grid.collisionAt(a.x,a.z,a.profile.radius+this.grid.cell*2));
        this.event(a,'blocked',reason,a,{code:failureCode,rawCode:code,collision,evidence:code==='crowd_wait'?'已检测到人际避让造成的持续停滞':code==='route_disconnected'?'当前身体半径对应的栅格通行场无法连通目标；附近障碍仅供定位':'连续尝试被几何障碍阻止'});
      }a._pendingTransitionReason=reason;this.transition(a,'blocked',reason);a.wait=2+this.random()*2;a.vx=a.vz=0;
    }
    clearHeat(){this.grid.resetHeat();this.cellIncidents.clear();}
    tick(dt){
      this.time+=dt;const grid=this.grid,fov=Math.cos(this.settings.vision*Math.PI/360);this.stepDynamicBodies(dt);for(const a of this.agents)this.updateClearance(a);
      if(this.hazard){
        this.hazard.tick(dt);
        this._shake=Math.min(1,Math.max(Math.abs(this.hazard.groundAcceleration||0)/9.81,Math.abs(this.hazard.groundAccelerationZ||0)/9.81));
        // Rebuilding a hazard-aware distance field is much more expensive than
        // stepping the field itself. Fire smoke changes smoothly, so refresh
        // its routes at 0.9 s; earthquake debris needs a tighter 0.25 s loop.
        // Rebuilding the shared hazard distance fields is expensive on a
        // dense indoor grid. Fire and smoke evolve smoothly, so agents can
        // safely keep the previous field for a few seconds and still react
        // on their individual replan timers. Earthquake debris needs the
        // tighter refresh because a collision can close a route abruptly.
        const routeRefresh=this.hazardType==='fire'?2.6:.25;
        if(this.hazard.time-(this._hazardRouteAt||-1)>=routeRefresh){
          this._hazardRouteAt=this.hazard.time;
          this._hazardFields?.clear();
          this.hazard.rebuildEscapeDistance?.(this.hazardExits);
        }
        for(const a of this.agents){this.updateHazardResponse(a,dt);if(this.hazardType==='fire'&&(a.smokeDose||0)>0)a.hazardExposureTime=(a.hazardExposureTime||0)+dt;else if(this.hazardType==='earthquake'&&this._shake>.02)a.hazardExposureTime=(a.hazardExposureTime||0)+dt;}
        this.recordStateTransitions();
      }
      // Neighbours are read from the same state at the beginning of this step.
      const old=this.agents.map(a=>({x:a.x,z:a.z,vx:a.vx,vz:a.vz})),velocities=[];
      for(let idx=0;idx<this.agents.length;idx++){
        const a=this.agents[idx],prev=old[idx];a.search=this.settings.search;
        const i=grid.index(a.x,a.z);if(i>=0){grid.heat.density[i]+=dt;if(grid.distance[i]-a.profile.radius<.35)grid.heat.near[i]+=dt;}
        if(a.state!=='moving'){a.waitTime=(a.waitTime||0)+dt;if(a.lastConstraint?.type==='people')a.crowdWaitTime=(a.crowdWaitTime||0)+dt;else if(a.state==='blocked'||a.lastConstraint?.type==='geometry')a.geometryWaitTime=(a.geometryWaitTime||0)+dt;a.wait-=dt;if(a.wait<=0&&!a.evacuated&&!a.rescueRole&&(!a.protectUntil||a.protectUntil<=this.time))this.assignGoal(a);velocities.push({x:0,z:0});continue;}
        while(a.pathAt<a.path.length&&Math.hypot(a.path[a.pathAt].x-a.x,a.path[a.pathAt].z-a.z)<Math.max(.12,grid.cell*.65))a.pathAt++;
        if(a.pathAt>=a.path.length){
          if(a.reachable&&a.goal&&Math.hypot(a.x-a.goal.x,a.z-a.goal.z)<Math.max(.55,grid.cell*2)){this.arrivals++;a.vx=a.vz=0;if(a.evacuating){a.evacuated=true;a._pendingTransitionReason='到达疏散出口';this.transition(a,'safe','到达疏散出口');a.wait=Infinity;a.reaction={code:'safe',phase:'safe',text:'已到疏散集合点',fear:Math.max(0,(a.reaction?.fear||0)-.1),posture:'upright',speedFactor:0};}else{a._pendingTransitionReason='到达目标';this.transition(a,'arrived','到达目标');a.wait=.7+this.random()*1.5;}}
          else this.blockTrip(a,'目标在当前身体尺度下不可达：通道过窄、家具阻挡或区域不连通');velocities.push({x:0,z:0});continue;
        }
        let target=a.path[a.pathAt];if(a.pathAt+1<a.path.length&&grid.lineClear(a,a.path[a.pathAt+1],a.profile.radius+.04)){a.pathAt++;target=a.path[a.pathAt];}
        const dx=target.x-a.x,dz=target.z-a.z,len=Math.hypot(dx,dz)||1,fx=dx/len,fz=dz/len,desiredSpeed=a.profile.speed*this.settings.speed,response=a.reaction||{speedFactor:1},responseSpeed=desiredSpeed*(response.speedFactor===undefined?1:response.speedFactor);
        let vx=fx*responseSpeed,vz=fz*responseSpeed;
        if(a.yieldUntil&&a.yieldUntil>this.time){vx*=.22;vz*=.22;}
        for(let j=0;j<this.agents.length;j++){
          if(j===idx)continue;const other=this.agents[j],p=old[j],rx=p.x-prev.x,rz=p.z-prev.z,dist=Math.hypot(rx,rz),safe=a.profile.radius+other.profile.radius+.18;
          if(dist>Math.min(this.settings.search,3.8)||dist<.00001)continue;
          const visible=(rx*fx+rz*fz)/dist>=fov;if(!visible&&dist>safe+.15)continue;
          const rvx=vx-p.vx,rvz=vz-p.vz,t=L.clamp((rx*rvx+rz*rvz)/(rvx*rvx+rvz*rvz+.001),0,1.3),px=rx-rvx*t,pz=rz-rvz*t,predicted=Math.hypot(px,pz);
          if(dist<safe+.5){const force=Math.max(0,(safe+.5-dist)/(safe+.5))*responseSpeed*1.6;vx-=rx/dist*force;vz-=rz/dist*force;}
          if(predicted<safe&&rx*fx+rz*fz>0){
            const myGoal=a.goal?Math.hypot(a.x-a.goal.x,a.z-a.goal.z):Infinity,otherGoal=other.goal?Math.hypot(other.x-other.goal.x,other.z-other.goal.z):Infinity;
            const otherHasPriority=other.evacuated||otherGoal<myGoal-.12||(Math.abs(otherGoal-myGoal)<=.12&&other.id<a.id);
            if(otherHasPriority){a.yieldUntil=Math.max(a.yieldUntil||0,this.time+.28);vx*=.2;vz*=.2;}
            else{const urgency=(safe-predicted)/safe,side=a.preferredSide||((a.id&1)?1:-1);vx+=fz*urgency*responseSpeed*.62*side;vz-=fx*urgency*responseSpeed*.62*side;vx*=.96;vz*=.96;}
          }
        }
        // Visible obstacles in the forward fan contribute a local repulsion force.
        const scan=a.rescueRole==='doctor'?0:Math.max(.8,a.profile.radius+.55),cell=grid.cell,c0=Math.floor((a.x-scan-grid.minX)/cell),c1=Math.ceil((a.x+scan-grid.minX)/cell),r0=Math.floor((a.z-scan-grid.minZ)/cell),r1=Math.ceil((a.z+scan-grid.minZ)/cell);
        let ox=0,oz=0;
        for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++){if(c<0||r<0||c>=grid.cols||r>=grid.rows)continue;const j=r*grid.cols+c;if(!grid.blocked(j))continue;const p=grid.point(j),rx=p.x-a.x,rz=p.z-a.z,dist=Math.hypot(rx,rz);if(dist>scan||dist<.001||(rx*fx+rz*fz)/dist<fov)continue;const force=(scan-dist)/scan*.18;ox-=rx/dist*force;oz-=rz/dist*force;}
        const olen=Math.hypot(ox,oz);if(olen>.7){ox*=.7/olen;oz*=.7/olen;}vx+=ox*desiredSpeed;vz+=oz*desiredSpeed;
        const speed=Math.hypot(vx,vz);if(speed>responseSpeed){vx*=responseSpeed/speed;vz*=responseSpeed/speed;}const relax=Math.min(1,dt*7);velocities.push({x:a.vx+(vx-a.vx)*relax,z:a.vz+(vz-a.vz)*relax});
      }
      for(let idx=0;idx<this.agents.length;idx++){
        const a=this.agents[idx],v=velocities[idx];if(a.state!=='moving'){a.vx=a.vz=0;continue;}const startX=a.x,startZ=a.z,steps=Math.max(1,Math.ceil(Math.hypot(v.x,v.z)*dt/.065));let hit=false,contact=null,dynamicFurnitureContact=null,dynamicFurnitureMoved=false,peopleWait=false;
        for(let step=0;step<steps;step++){
          const dx=v.x*dt/steps,dz=v.z*dt/steps,nx=a.x+dx,nz=a.z+dz;
          // Agents that already crossed an exit leave the collision field.
          // Keeping them as solid bodies permanently plugs the doorway and
          // makes the remaining crowd look frozen even though their routes are
          // valid.
          const peopleClear=(x,z)=>a.rescueRole==='doctor'||this.agents.every(b=>b===a||b.evacuated||b.state==='safe'||(a.rescuePair&&b.rescuePair===a.rescuePair)||Math.hypot(x-b.x,z-b.z)>=a.profile.radius+b.profile.radius+.015);
          const dynamicHit=this.dynamicBodyAt(nx,nz,a.profile.radius,a);
          const hazardBlocked=this.hazardBlocked(nx,nz,a.profile.radius);
          if(dynamicHit){
            // Keep a separate contact record even when the furniture can be
            // pushed away. A successful push is still physical feedback that
            // should appear in contact counters, heatmaps, and exports.
            dynamicFurnitureContact=dynamicHit;
            dynamicFurnitureMoved=this.moveDynamicBody(dynamicHit,v,dt)||dynamicFurnitureMoved;
            if(!this.dynamicBodyAt(nx,nz,a.profile.radius,a)&&grid.isClear(nx,nz,a.profile.radius)&&!hazardBlocked){a.x=nx;a.z=nz;}
            else if(grid.isClear(nx,a.z,a.profile.radius)&&peopleClear(nx,a.z)&&!this.hazardBlocked(nx,a.z,a.profile.radius))a.x=nx;
            else if(grid.isClear(a.x,nz,a.profile.radius)&&peopleClear(a.x,nz)&&!this.hazardBlocked(a.x,nz,a.profile.radius))a.z=nz;
            else{hit=true;contact={obstacle:{id:dynamicHit.body.id,name:dynamicHit.body.name||'可推动家具',kind:'dynamic_furniture'}};a.lastConstraint={type:'geometry',time:this.time,collision:contact};}
          }else if(!grid.isClear(nx,nz,a.profile.radius)||hazardBlocked){
            hit=true;contact=grid.collisionAt(nx,nz,a.profile.radius);a.lastConstraint={type:'geometry',time:this.time,collision:contact};
            if(grid.isClear(nx,a.z,a.profile.radius)&&peopleClear(nx,a.z)&&!this.hazardBlocked(nx,a.z,a.profile.radius))a.x=nx;
            else if(grid.isClear(a.x,nz,a.profile.radius)&&peopleClear(a.x,nz)&&!this.hazardBlocked(a.x,nz,a.profile.radius))a.z=nz;
          }else if(peopleClear(nx,nz)){a.x=nx;a.z=nz;}else{peopleWait=true;a.lastConstraint={type:'people',time:this.time};}
        }
        const hazardDynamic=this.hazard?.contactAt?.(a.x,a.z,a.profile.radius),furnitureObstacle=dynamicFurnitureContact?.body?{id:dynamicFurnitureContact.body.id,name:dynamicFurnitureContact.body.name||'可推动家具',kind:'dynamic_furniture'}:null,hitObstacle=hazardDynamic||furnitureObstacle||contact?.obstacle;
        // Count both blocked and pushable furniture contacts. The one-second
        // per-agent debounce keeps a long push from inflating the metric.
        if((hit||dynamicFurnitureContact||hazardDynamic)&&this.time-a.contactAt>=1){
          a.contactAt=this.time;this.contacts++;
          const furniture=!!dynamicFurnitureContact&&!hazardDynamic;
          if(furniture){
            const body=dynamicFurnitureContact.body;a.lastConstraint=a.lastConstraint||{type:'geometry',time:this.time,collision:{obstacle:{id:body.id,name:body.name||'可推动家具',kind:'dynamic_furniture'}}};
            this.dynamicFurnitureContacts++;a.contactUntil=this.time+1.2;a.contactText=dynamicFurnitureMoved?'碰到家具，家具已移动':'碰到家具，正在避让';a.reaction=a.reaction||{code:'calm',phase:'moving',text:'行走中',fear:0,posture:'upright',speedFactor:1};a.reaction.code='contact';a.reaction.text=a.contactText;
          }else if(hazardDynamic){a.contactUntil=this.time+1.2;a.contactText='碰到落物，正在避让';a.reaction=a.reaction||{code:'calm',phase:'moving',text:'行走中',fear:0,posture:'upright',speedFactor:1};a.reaction.code='contact';a.reaction.text=a.contactText;}
          const obstacle=contact?.obstacle,code=hitObstacle?.kind==='floor_edge'?'floor_edge':hazardDynamic?'dynamic_debris':furniture?'dynamic_furniture':'geometry_contact';
          this.event(a,'contact',`身体安全包络触及${hitObstacle?.name||'障碍栅格'}`,a,{code,collision:hitObstacle?{obstacle:hitObstacle}:contact,evidence:furniture?'人物安全包络与可移动家具代理发生接触，家具已被推动或阻挡':'一次实际移动尝试与碰撞栅格重叠，已阻止穿透'});
        }
        const moved=Math.hypot(a.x-startX,a.z-startZ);this.distance+=moved;a.distance=(a.distance||0)+moved;a.vx=(a.x-startX)/dt;a.vz=(a.z-startZ)/dt;if(moved>.001)a.angle=Math.atan2(a.vx,a.vz);this.updateClearance(a);
        a.stalled=moved<.055*dt?a.stalled+dt:Math.max(0,a.stalled-dt*.45);if(a.stalled>3.5){const crowd=peopleWait||a.lastConstraint?.type==='people';this.blockTrip(a,crowd?'人际避让导致持续停滞（不计入障碍热力）':'几何障碍附近持续停滞，当前路径无法继续',crowd?'crowd_wait':'geometry_stall');}
      }
      this.recordStateTransitions();
      if(this.time>=this.nextTrail){this.nextTrail=this.time+.3;for(const a of this.agents){a.trail.push({x:a.x,z:a.z});if(a.trail.length>48)a.trail.shift();}this.history.push({time:this.time,arrivals:this.arrivals});if(this.history.length>100)this.history.shift();}
    }
    summary(){const total=this.arrivals+this.blocked;return{simulatedSeconds:this.time,agents:this.agents.length,arrivals:this.arrivals,contacts:this.contacts,dynamicFurnitureContacts:this.dynamicFurnitureContacts,blockedTrips:this.blocked,obstacleBlockedTrips:this.obstructions,crowdBlockedTrips:this.blocked-this.obstructions,finishedTripArrivalRate:total?this.arrivals/total:null,totalDistanceMeters:this.distance,eventCount:this.eventTotal,retainedEvents:this.events.length,stateTransitions:this.stateTransitions,clearance:this.clearanceStats(),failureCodes:{...this.failureCounts},quality:this.qualityChecks()};}
  }
  L.Simulation=Simulation;
})();
