/* Destination steering, grid routing, predictive separation and swept disc collision. */
(() => {
  'use strict';const L=window.IndoorLab;
  class Simulation{
    constructor(grid,goals,settings={}){this.grid=grid;this.goals=goals;this.settings={count:32,population:'mixed',speed:1,vision:180,search:8,...settings};this.reset();}
    random(){this.seed=(this.seed*1664525+1013904223)>>>0;return this.seed/4294967296;}
    reset(){this.seed=21879;this.time=0;this.arrivals=0;this.contacts=0;this.blocked=0;this.obstructions=0;this.distance=0;this.events=[];this.cellIncidents=new Map();this.eventTotal=0;this.agents=[];this.grid.resetHeat();this.nextTrail=0;this.history=[];
      const count=this.settings.count;
      for(let id=0;id<count;id++){
        const type=this.settings.population==='mixed'?(id%5===0?'wheelchair':id%5===1?'assisted':'pedestrian'):this.settings.population,profile=L.PROFILES[type],free=this.grid.nav(profile.radius).mainFree;if(!free.length)continue;
        let p=null;
        for(let trial=0;trial<300;trial++){const candidate=this.grid.point(free[Math.floor(this.random()*free.length)]);if(this.agents.every(a=>Math.hypot(a.x-candidate.x,a.z-candidate.z)>a.profile.radius+profile.radius+.08)){p=candidate;break;}}
        if(!p)continue;const a={id,...p,type,profile,vx:0,vz:0,angle:this.random()*Math.PI*2,state:'moving',trail:[],path:[],pathAt:0,goal:null,wait:0,stalled:0,contactAt:-5,blockedTrip:false,trip:0,search:this.settings.search};this.agents.push(a);this.assignGoal(a);
      }
    }
    assignGoal(a){
      if(!this.goals.length&&this.settings.goalPolicy==='custom'){a.goal=null;a.path=[];a.state='waiting';a.wait=1;return;}
      const all=this.goals.filter(g=>g.id!==a.goal?.id&&Math.hypot(g.x-a.x,g.z-a.z)>.65),near=all.filter(g=>Math.hypot(g.x-a.x,g.z-a.z)<=this.settings.search),choices=near.length?near:all;
      let goal=choices[Math.floor(this.random()*choices.length)];
      // Wander within the search radius when no fixed destinations are available.
      if(!goal&&this.goals.length){goal=this.goals[Math.floor(this.random()*this.goals.length)];if(Math.hypot(goal.x-a.x,goal.z-a.z)<.65){a.goal=goal;a.state='arrived';a.wait=2;return;}}
      if(!goal){const nav=this.grid.nav(a.profile.radius),free=nav.mainFree;for(let n=0;n<30;n++){const p=this.grid.point(free[Math.floor(this.random()*free.length)]);if(Math.hypot(p.x-a.x,p.z-a.z)<=this.settings.search&&Math.hypot(p.x-a.x,p.z-a.z)>1){goal={id:-1,name:'随机探索点',...p};break;}}}
      if(!goal){a.state='waiting';a.wait=2;return;}
      a.goal=goal;a.trip++;a.blockedTrip=false;a.stalled=0;a.lastConstraint=null;const route=this.grid.route(a,goal,a.profile.radius);a.path=route.path;a.pathAt=0;a.reachable=route.reachable;a.endpoint=route.endpoint;a.state='moving';
      if(!a.path.length){this.blockTrip(a,'没有可用通行路径');}
    }
    event(a,type,reason,p=a,details={}){
      const i=this.grid.index(p.x,p.z),physical=type==='contact'||details.code!=='crowd_wait';
      if(i>=0){this.grid.heat[type==='contact'?'contact':'blocked'][i]++;if(type==='blocked'&&physical)this.grid.heat.obstruction[i]++;}
      const event={id:++this.eventTotal,time:this.time,type,agent:a.id,profile:a.type,x:p.x,z:p.z,cellIndex:i,goal:a.goal?.name||'随机探索',reason,requiredWidth:a.profile.radius*2,physical,...details};
      this.events.push(event);if(this.events.length>5000)this.events.shift();
      if(i>=0){let item=this.cellIncidents.get(i);if(!item){item={index:i,contact:0,blocked:0,obstruction:0,crowd:0,firstTime:this.time,lastTime:this.time,causes:{},profiles:{},obstacles:{},recent:[]};this.cellIncidents.set(i,item);}item[type==='contact'?'contact':'blocked']++;if(type==='blocked')item[physical?'obstruction':'crowd']++;item.lastTime=this.time;const key=event.code||type;const cause=item.causes[key]||(item.causes[key]={code:key,reason,count:0});cause.count++;item.profiles[a.type]=(item.profiles[a.type]||0)+1;if(event.collision?.obstacle){const o=event.collision.obstacle;item.obstacles[o.id]={...o,count:(item.obstacles[o.id]?.count||0)+1};}item.recent.push(event);if(item.recent.length>8)item.recent.shift();}
      this.onEvent?.(event);return event;
    }
    blockTrip(a,reason,code='route_disconnected'){
      if(!a.blockedTrip){a.blockedTrip=true;this.blocked++;if(code!=='crowd_wait')this.obstructions++;
        const collision=code==='crowd_wait'?null:(a.lastConstraint?.collision||this.grid.collisionAt(a.x,a.z,a.profile.radius+this.grid.cell*2));
        this.event(a,'blocked',reason,a,{code,collision,evidence:code==='crowd_wait'?'已检测到人际避让造成的持续停滞':code==='route_disconnected'?'当前身体半径对应的栅格通行场无法连通目标；附近障碍仅供定位':'连续尝试被几何障碍阻止'});
      }a.state='blocked';a.wait=2+this.random()*2;a.vx=a.vz=0;
    }
    clearHeat(){this.grid.resetHeat();this.cellIncidents.clear();}
    tick(dt){
      this.time+=dt;const grid=this.grid,fov=Math.cos(this.settings.vision*Math.PI/360);
      // Neighbours are read from the same state at the beginning of this step.
      const old=this.agents.map(a=>({x:a.x,z:a.z,vx:a.vx,vz:a.vz})),velocities=[];
      for(let idx=0;idx<this.agents.length;idx++){
        const a=this.agents[idx],prev=old[idx];a.search=this.settings.search;
        const i=grid.index(a.x,a.z);if(i>=0){grid.heat.density[i]+=dt;if(grid.distance[i]-a.profile.radius<.35)grid.heat.near[i]+=dt;}
        if(a.state!=='moving'){a.wait-=dt;if(a.wait<=0)this.assignGoal(a);velocities.push({x:0,z:0});continue;}
        while(a.pathAt<a.path.length&&Math.hypot(a.path[a.pathAt].x-a.x,a.path[a.pathAt].z-a.z)<Math.max(.12,grid.cell*.65))a.pathAt++;
        if(a.pathAt>=a.path.length){
          if(a.reachable&&a.goal&&Math.hypot(a.x-a.goal.x,a.z-a.goal.z)<Math.max(.55,grid.cell*2)){this.arrivals++;a.state='arrived';a.wait=.7+this.random()*1.5;a.vx=a.vz=0;}
          else this.blockTrip(a,'目标在当前身体尺度下不可达：通道过窄、家具阻挡或区域不连通');velocities.push({x:0,z:0});continue;
        }
        let target=a.path[a.pathAt];if(a.pathAt+1<a.path.length&&grid.lineClear(a,a.path[a.pathAt+1],a.profile.radius+.04)){a.pathAt++;target=a.path[a.pathAt];}
        const dx=target.x-a.x,dz=target.z-a.z,len=Math.hypot(dx,dz)||1,fx=dx/len,fz=dz/len,desiredSpeed=a.profile.speed*this.settings.speed;
        let vx=fx*desiredSpeed,vz=fz*desiredSpeed;
        for(let j=0;j<this.agents.length;j++){
          if(j===idx)continue;const other=this.agents[j],p=old[j],rx=p.x-prev.x,rz=p.z-prev.z,dist=Math.hypot(rx,rz),safe=a.profile.radius+other.profile.radius+.18;
          if(dist>Math.min(this.settings.search,3.8)||dist<.00001)continue;
          const visible=(rx*fx+rz*fz)/dist>=fov;if(!visible&&dist>safe+.15)continue;
          const rvx=vx-p.vx,rvz=vz-p.vz,t=L.clamp((rx*rvx+rz*rvz)/(rvx*rvx+rvz*rvz+.001),0,1.3),px=rx-rvx*t,pz=rz-rvz*t,predicted=Math.hypot(px,pz);
          if(dist<safe+.5){const force=Math.max(0,(safe+.5-dist)/(safe+.5))*desiredSpeed*1.6;vx-=rx/dist*force;vz-=rz/dist*force;}
          if(predicted<safe&&rx*fx+rz*fz>0){const urgency=(safe-predicted)/safe,side=1;vx+=fz*urgency*desiredSpeed*.9*side;vz-=fx*urgency*desiredSpeed*.9*side;vx*=.9;vz*=.9;}
        }
        // Visible obstacles in the forward fan contribute a local repulsion force.
        const scan=Math.max(.8,a.profile.radius+.55),cell=grid.cell,c0=Math.floor((a.x-scan-grid.minX)/cell),c1=Math.ceil((a.x+scan-grid.minX)/cell),r0=Math.floor((a.z-scan-grid.minZ)/cell),r1=Math.ceil((a.z+scan-grid.minZ)/cell);
        let ox=0,oz=0;
        for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++){if(c<0||r<0||c>=grid.cols||r>=grid.rows)continue;const j=r*grid.cols+c;if(!grid.blocked(j))continue;const p=grid.point(j),rx=p.x-a.x,rz=p.z-a.z,dist=Math.hypot(rx,rz);if(dist>scan||dist<.001||(rx*fx+rz*fz)/dist<fov)continue;const force=(scan-dist)/scan*.18;ox-=rx/dist*force;oz-=rz/dist*force;}
        const olen=Math.hypot(ox,oz);if(olen>.7){ox*=.7/olen;oz*=.7/olen;}vx+=ox*desiredSpeed;vz+=oz*desiredSpeed;
        const speed=Math.hypot(vx,vz);if(speed>desiredSpeed){vx*=desiredSpeed/speed;vz*=desiredSpeed/speed;}const relax=Math.min(1,dt*7);velocities.push({x:a.vx+(vx-a.vx)*relax,z:a.vz+(vz-a.vz)*relax});
      }
      for(let idx=0;idx<this.agents.length;idx++){
        const a=this.agents[idx],v=velocities[idx];if(a.state!=='moving'){a.vx=a.vz=0;continue;}const startX=a.x,startZ=a.z,steps=Math.max(1,Math.ceil(Math.hypot(v.x,v.z)*dt/.065));let hit=false,contact=null,peopleWait=false;
        for(let step=0;step<steps;step++){
          const dx=v.x*dt/steps,dz=v.z*dt/steps,nx=a.x+dx,nz=a.z+dz;
          const peopleClear=(x,z)=>this.agents.every(b=>b===a||Math.hypot(x-b.x,z-b.z)>=a.profile.radius+b.profile.radius+.015);
          if(!grid.isClear(nx,nz,a.profile.radius)){
            hit=true;contact=grid.collisionAt(nx,nz,a.profile.radius);a.lastConstraint={type:'geometry',time:this.time,collision:contact};
            if(grid.isClear(nx,a.z,a.profile.radius)&&peopleClear(nx,a.z))a.x=nx;
            else if(grid.isClear(a.x,nz,a.profile.radius)&&peopleClear(a.x,nz))a.z=nz;
          }else if(peopleClear(nx,nz)){a.x=nx;a.z=nz;}else{peopleWait=true;a.lastConstraint={type:'people',time:this.time};}
        }
        if(hit&&this.time-a.contactAt>=1){a.contactAt=this.time;this.contacts++;const obstacle=contact?.obstacle;this.event(a,'contact',`身体安全包络触及${obstacle?.name||'障碍栅格'}`,a,{code:obstacle?.kind==='floor_edge'?'floor_edge':'geometry_contact',collision:contact,evidence:'一次实际移动尝试与碰撞栅格重叠，已阻止穿透'});}
        const moved=Math.hypot(a.x-startX,a.z-startZ);this.distance+=moved;a.vx=(a.x-startX)/dt;a.vz=(a.z-startZ)/dt;if(moved>.001)a.angle=Math.atan2(a.vx,a.vz);
        a.stalled=moved<.055*dt?a.stalled+dt:Math.max(0,a.stalled-dt*.45);if(a.stalled>3.5){const crowd=peopleWait||a.lastConstraint?.type==='people';this.blockTrip(a,crowd?'人际避让导致持续停滞（不计入障碍热力）':'几何障碍附近持续停滞，当前路径无法继续',crowd?'crowd_wait':'geometry_stall');}
      }
      if(this.time>=this.nextTrail){this.nextTrail=this.time+.3;for(const a of this.agents){a.trail.push({x:a.x,z:a.z});if(a.trail.length>48)a.trail.shift();}this.history.push({time:this.time,arrivals:this.arrivals});if(this.history.length>100)this.history.shift();}
    }
    summary(){return{simulatedSeconds:this.time,agents:this.agents.length,arrivals:this.arrivals,contacts:this.contacts,blockedTrips:this.blocked,obstacleBlockedTrips:this.obstructions,crowdBlockedTrips:this.blocked-this.obstructions,finishedTripArrivalRate:this.arrivals+this.blocked?this.arrivals/(this.arrivals+this.blocked):null,totalDistanceMeters:this.distance,eventCount:this.eventTotal,retainedEvents:this.events.length};}
  }
  L.Simulation=Simulation;
})();
