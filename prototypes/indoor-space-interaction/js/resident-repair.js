/* Bounded rule-based repair agent: change real editable parameters, rebuild and rerun. */
(() => {
  'use strict';const L=window.IndoorLab,clone=v=>JSON.parse(JSON.stringify(v));
  function proposals(spec,results){const issues=results.flatMap(r=>r.issues.map(i=>({...i,task:r.task}))),list=[];
    const add=(id,title,description,edit)=>{if(!list.some(p=>p.id===id))list.push({id,title,description,edit});};
    if(issues.some(i=>['path_blocked','turn_failed','transfer_failed'].includes(i.code)&&['bathroom','transfer','evacuate'].includes(i.task))){add('move-chair','移动床侧扶手椅','扶手椅向床尾外侧移 1.55 m，释放床侧和转向包络',s=>{s.items.find(i=>i.id==='transferChair').z=-1.35;});}
    if(issues.some(i=>i.code==='path_blocked'&&['bathroom','evacuate'].includes(i.task)))add('reverse-bedDoor','改变卧室门开启方向','将卧室门改向走廊开启，重新检查退让区、门叶扫掠与通过路径',s=>{s.doors.find(d=>d.id==='bedDoor').swing=1;});for(const issue of issues){if(issue.code==='door_swing'){const door=spec.doors.find(d=>d.id===issue.itemId);if(door)add('reverse-'+door.id,'改变'+door.name+'开启方向','反转门的开启方向；重新检查门叶扫掠、退让位置与通行',s=>{s.doors.find(d=>d.id===door.id).swing*=-1;});}
      if(['door_operation','reach_failed'].includes(issue.code)&&spec.doors.some(d=>d.id===issue.itemId)){const id=issue.itemId;add('lever-'+id,'替换低阻力易握执手','操作阻力降至 0.20，高度 0.95 m，执手延长 0.16 m；同一画像复测',s=>{const d=s.doors.find(d=>d.id===id);d.effort=.2;d.handleHeight=.95;d.handleExtension=.16;});}
      if(issue.itemId==='fridge')add('replace-fridge','替换低位把手冰箱','使用内置尺寸方案：宽 0.75 m、深 0.70 m、把手高 0.95 m',s=>{s.items.find(i=>i.id==='fridge').product='accessibleFridge';});
      if(issue.itemId==='coffee')add('move-coffee','调整茶几位置','茶几向客厅边侧移动，重新计算实际碰撞与转向空间',s=>{s.items.find(i=>i.id==='coffee').x=-2.6;});
    }
    if(issues.some(i=>i.itemId==='bathDoor'||i.task==='bathroom'))add('move-vanity','移开门后洗手柜','将洗手柜移到卫生间外墙侧，释放门叶和轮椅操作区',s=>{s.items.find(i=>i.id==='vanity').x=6.9;s.items.find(i=>i.id==='vanity').z=-2.9;});
    return list;
  }
  const score=results=>{const s=L.residentSummary(results);return s.completed*1000-(s.turnFailures+s.pathFailures+s.reachFailures+s.doorFailures+s.transferFailures+s.collisions)*20+results.reduce((n,r)=>n+new Set(r.actions.filter(a=>/触达|开启|取物|转移/.test(a.action)).map(a=>a.action)).size,0)*.1;};
  L.repairResidentHome=async(baseModel,baseGrid,profile,ids,progress)=>{
    const before=L.runResidentSuite(baseGrid,baseModel,profile,ids);let spec=clone(baseModel.spec),best=before,bestScore=score(best),chosen=[],audit=[],bestModel=baseModel,bestGrid=baseGrid;
    for(let round=0;round<6;round++){
      let winner=null;for(const proposal of proposals(spec,best).filter(p=>!chosen.some(c=>c.id===p.id))){progress?.(`修复 Agent 第 ${round+1} 轮：验证「${proposal.title}」`);await new Promise(r=>setTimeout(r,15));const candidateSpec=clone(spec);proposal.edit(candidateSpec);const candidate=L.makeResidentHome(candidateSpec),grid=await L.buildGrid(candidate.group,candidate.bounds,baseGrid.cell),results=L.runResidentSuite(grid,candidate,profile,ids),value=score(results);audit.push({round:round+1,id:proposal.id,title:proposal.title,score:value,summary:L.residentSummary(results)});
        if(value>bestScore+.001&&(!winner||value>winner.score)){if(winner)L.dispose(winner.model.group);winner={proposal,spec:candidateSpec,model:candidate,grid,results,score:value};}else L.dispose(candidate.group);
      }
      if(!winner)break;if(bestModel!==baseModel)L.dispose(bestModel.group);spec=winner.spec;bestModel=winner.model;bestGrid=winner.grid;best=winner.results;bestScore=winner.score;chosen.push({id:winner.proposal.id,title:winner.proposal.title,description:winner.proposal.description});if(best.every(r=>r.success))break;
    }
    return{before,after:best,beforeSummary:L.residentSummary(before),afterSummary:L.residentSummary(best),profile:clone(profile),taskIds:[...ids],cellSize:baseGrid.cell,changes:chosen,audit,model:bestModel,grid:bestGrid,baseSpec:clone(baseModel.spec),afterSpec:spec,method:'固定画像、任务、起点和精度；规则候选逐一重建几何并复测。仅保留评分改善的候选；无改善时不改场景。'};
  };
})();




