/* Lightweight world-space thought/status bubbles for hazard reactions. */
(() => {
  'use strict';
  const L=window.IndoorLab;
  const palette={
    calm:['#ffffff','#50667c'],alarm:['#fff7d6','#9c6200'],startled:['#e3f0ff','#315b89'],protect:['#ede7ff','#5e4a9d'],smoke:['#fff0e6','#9b4e25'],evacuating:['#e4fff4','#177a59'],rerouting:['#fff5cf','#86600d'],trapped:['#ffe2e3','#a23443'],contact:['#f2e6de','#794d38'],safe:['#dcfff0','#217353']
  };
  class AgentStateBubbles {
    constructor(view){
      this.view=view;this.visible=true;this.nodes=new Map();this.root=document.createElement('div');this.root.className='agent-state-bubbles';Object.assign(this.root.style,{position:'absolute',inset:'0',pointerEvents:'none',overflow:'hidden',zIndex:'8'});view.container.appendChild(this.root);
      this._width=0;this._height=0;this._last=0;
    }
    setVisible(value){this.visible=!!value;this.root.hidden=!this.visible;}
    text(agent){if(agent?.furnitureInteraction&& !['smoke','fire','injured'].includes(agent.reaction?.code)){const name=agent.furnitureInteraction.name||'家具';return agent.furnitureInteraction.state==='open'?`已打开${name}`:`正在操作${name}`;}return agent?.reaction?.text||({moving:'通行中',arrived:'已到达',waiting:'等待',blocked:'出口受阻',safe:'已安全'}[agent?.state]||'观察空间');}
    ensure(id){let n=this.nodes.get(id);if(n)return n;n=document.createElement('div');n.className='agent-state-bubble';n.setAttribute('aria-hidden','true');Object.assign(n.style,{position:'absolute',transform:'translate(-50%,-100%)',padding:'4px 8px',borderRadius:'12px',font:'10px/1.2 "Segoe UI","Microsoft YaHei",sans-serif',whiteSpace:'nowrap',boxShadow:'0 3px 10px rgba(14,35,64,.18)',border:'1px solid rgba(255,255,255,.85)',transition:'opacity .12s ease,background .12s ease',willChange:'left,top'});this.root.appendChild(n);this.nodes.set(id,n);return n;}
    update(agents=[]){
      if(!this.visible)return;const cam=this.view.camera,rect=this.view.renderer.domElement.getBoundingClientRect(),box=this.view.container.getBoundingClientRect(),scaleX=box.width?this.view.container.clientWidth/rect.width:1,scaleY=box.height?this.view.container.clientHeight/rect.height:1,active=new Set();
      for(const a of agents){if(!a||a.state==='hidden')continue;const n=this.ensure(a.id),p=new THREE.Vector3(a.x,a.type==='wheelchair'?1.62:1.98,a.z);p.project(cam);const x=(p.x*.5+.5)*rect.width*scaleX+(rect.left-box.left)*scaleX,y=(-p.y*.5+.5)*rect.height*scaleY+(rect.top-box.top)*scaleY;if(p.z<-.98||p.z>1.05||x<-80||y<-40||x>this.view.container.clientWidth+80||y>this.view.container.clientHeight+40){n.style.opacity='0';continue;}const key=a.reaction?.code||a.state||'calm',colors=palette[key]||palette.calm;n.textContent=this.text(a);n.style.left=`${x}px`;n.style.top=`${y}px`;n.style.opacity='1';n.style.background=colors[0];n.style.color=colors[1];active.add(a.id);}
      for(const[id,n]of this.nodes){if(!active.has(id))n.style.opacity='0';}
    }
    dispose(){for(const n of this.nodes.values())n.remove();this.nodes.clear();this.root.remove();}
  }
  L.AgentStateBubbles=AgentStateBubbles;
})();
