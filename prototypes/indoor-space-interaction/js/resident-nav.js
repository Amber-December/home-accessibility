/* SE(2) search: position + eight headings; swept rectangle tests guard moves and turns. */
(() => {
  'use strict';const L=window.IndoorLab,TAU=Math.PI*2;
  const delta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
  function poseClear(grid,x,z,angle,width,length,padding=0){
    const hw=width/2+padding,hl=length/2+padding,s=Math.sin(angle),c=Math.cos(angle),ex=Math.abs(c)*hw+Math.abs(s)*hl,ez=Math.abs(s)*hw+Math.abs(c)*hl,cell=grid.cell;
    if(x-ex<grid.minX||x+ex>grid.maxX||z-ez<grid.minZ||z+ez>grid.maxZ)return false;
    for(let r=Math.floor((z-ez-grid.minZ)/cell);r<=Math.floor((z+ez-grid.minZ)/cell);r++)for(let col=Math.floor((x-ex-grid.minX)/cell);col<=Math.floor((x+ex-grid.minX)/cell);col++){
      const i=r*grid.cols+col;if(!grid.blocked(i))continue;const p=grid.point(i),dx=p.x-x,dz=p.z-z,h=cell/2;
      if(Math.abs(dx*c-dz*s)<hw+h*(Math.abs(c)+Math.abs(s))-1e-7&&Math.abs(dx*s+dz*c)<hl+h*(Math.abs(c)+Math.abs(s))-1e-7)return false;
    }return true;
  }
  function swept(grid,a,b,profile,extra){const da=delta(a.angle,b.angle),steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.07),Math.ceil(Math.abs(da)/(Math.PI/24)));for(let j=0;j<=steps;j++){const t=j/steps,p={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,angle:a.angle+da*t};if(!poseClear(grid,p.x,p.z,p.angle,profile.width,profile.length)||extra&&!extra(p))return false;}return true;}
  // Long bodies (stretcher) also step sideways and turn 45 degrees about the middle of their front or rear edge, the way two bearers shuffle and swing one end through a door.
  function pivotPose(grid,p,heading,turn,end,length){const a=p.angle,b=a+turn*Math.PI/4,k=end*length/2,px=p.x+Math.sin(a)*k,pz=p.z+Math.cos(a)*k,x=px-Math.sin(b)*k,z=pz-Math.cos(b)*k,i=grid.index(x,z);return i<0?-1:i*8+((heading+turn)%8+8)%8;}
  function pivotSwept(grid,p,turn,end,profile,extra){const k=end*profile.length/2,px=p.x+Math.sin(p.angle)*k,pz=p.z+Math.cos(p.angle)*k;for(let j=1;j<=12;j++){const b=p.angle+turn*Math.PI/4*j/12,q={x:px-Math.sin(b)*k,z:pz-Math.cos(b)*k,angle:b};if(!poseClear(grid,q.x,q.z,b,profile.width,profile.length)||extra&&!extra(q))return false;}return true;}
  function margin(grid,p,profile){let lo=0,hi=.8;for(let i=0;i<7;i++){const mid=(lo+hi)/2;if(poseClear(grid,p.x,p.z,p.angle,profile.width,profile.length,mid))lo=mid;else hi=mid;}return lo;}
  function route(grid,start,goal,profile,extra){
    const long=Number.isFinite(profile.length)&&profile.length>profile.width*1.5,heading=((Math.round(start.angle/(Math.PI/4))%8)+8)%8,si=grid.index(start.x,start.z),gi=grid.index(goal.x,goal.z);if(si<0||gi<0)return{success:false,path:[],reason:'起点或终点超出地板范围'};
    grid.residentPoseCaches=grid.residentPoseCaches||new Map();const cacheKey=profile.width+':'+profile.length+':'+(extra?.key||'static');let valid=grid.residentPoseCaches.get(cacheKey);if(!valid){valid=new Uint8Array(grid.size*8);grid.residentPoseCaches.set(cacheKey,valid);}
    const pose=state=>({...grid.point(state>>3),angle:(state%8)*Math.PI/4}),isValid=state=>{if(!valid[state]){const p=pose(state);valid[state]=poseClear(grid,p.x,p.z,p.angle,profile.width,profile.length)&&(!extra||extra(p))?1:2;}return valid[state]===1;};
    let source=si*8+heading;if(!isValid(source)||!swept(grid,start,pose(source),profile,extra))return{success:false,path:[],reason:'起点的身体包络与家具或墙体相交'};
    const distances=new Float64Array(grid.size*8),previous=new Int32Array(grid.size*8);distances.fill(Infinity);previous.fill(-1);distances[source]=0;const heap=new L.Heap();
    const heuristic=state=>{const p=grid.point(state>>3);return Math.hypot(p.x-goal.x,p.z-goal.z);};heap.push(source,heuristic(source));let end=-1,best=source,bestH=heuristic(source),expanded=0;const closed=new Uint8Array(grid.size*8);
    while(heap.length&&expanded++<(grid.routeBudget||L.ROUTE_BUDGET||30000)){const state=heap.pop().id;if(closed[state])continue;closed[state]=1;const p=pose(state),h=heuristic(state);if(h<bestH){bestH=h;best=state;}if(h<grid.cell*1.3&&(goal.angle===undefined||Math.abs(delta(p.angle,goal.angle))<.1)){end=state;break;}
      const index=state>>3,heading=state%8,col=index%grid.cols,row=Math.floor(index/grid.cols),dx=Math.round(Math.sin(p.angle)),dz=Math.round(Math.cos(p.angle));
      const options=[{state:index*8+(heading+1)%8,cost:.25},{state:index*8+(heading+7)%8,cost:.25}];
      for(const direction of [1,-1]){const c=col+dx*direction,r=row+dz*direction;if(c>=0&&r>=0&&c<grid.cols&&r<grid.rows)options.push({state:(r*grid.cols+c)*8+heading,cost:grid.cell*Math.hypot(dx,dz)*(direction<0?1.4:1)});}
      if(long)for(const direction of [1,-1]){const c=col+dz*direction,r=row-dx*direction;if(c>=0&&r>=0&&c<grid.cols&&r<grid.rows)options.push({state:(r*grid.cols+c)*8+heading,cost:grid.cell*Math.hypot(dx,dz)*2});}
      if(long)for(const turn of [1,-1])for(const end of [1,-1]){const next=pivotPose(grid,p,heading,turn,end,profile.length);if(next>=0)options.push({state:next,cost:.25+profile.length/2*Math.PI/4,pivot:[turn,end]});}
      for(const option of options){const next=option.state;if(closed[next]||!isValid(next))continue;const cost=distances[state]+option.cost;if(cost>=distances[next]||!(option.pivot?pivotSwept(grid,p,option.pivot[0],option.pivot[1],profile,extra)&&swept(grid,{x:p.x+Math.sin(p.angle)*option.pivot[1]*profile.length/2-Math.sin(p.angle+option.pivot[0]*Math.PI/4)*option.pivot[1]*profile.length/2,z:p.z+Math.cos(p.angle)*option.pivot[1]*profile.length/2-Math.cos(p.angle+option.pivot[0]*Math.PI/4)*option.pivot[1]*profile.length/2,angle:pose(next).angle},pose(next),profile,extra):swept(grid,p,pose(next),profile,extra)))continue;distances[next]=cost;previous[next]=state;heap.push(next,cost+heuristic(next));}
    }
    const success=end>=0;let at=success?end:best,path=[];while(at>=0){path.push(pose(at));at=previous[at];}path.reverse();path.unshift({...start});if(success){const last=path.at(-1),target={...goal,angle:goal.angle===undefined?last.angle:goal.angle};if(swept(grid,last,target,profile,extra))path.push(target);else return{success:false,path,reason:'目标接近位置无法容纳身体包络'};}
    return{success,path,expanded,reason:success?'':'按实际身体长宽与转向扫掠无法连通目标'};
  }
  L.ResidentNav={poseClear,swept,margin,route,delta};
})();

