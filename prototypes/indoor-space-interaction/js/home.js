/* Editable semantic home. Product options are dimension presets, not shopping listings. */
(() => {
  'use strict';const L=window.IndoorLab;
  L.HOME_CATALOG={standardFridge:{name:'高位把手冰箱 / 尺寸方案',w:.85,d:.8,h:1.85,handleHeight:1.55},accessibleFridge:{name:'低位易握把手冰箱 / 尺寸方案',w:.75,d:.7,h:1.65,handleHeight:.95}};
  L.homeSpec=()=>({items:[
    {id:'sofa',name:'客厅沙发',kind:'sofa',x:-5.6,z:3.8,w:2.6,d:1,h:.82},
    {id:'coffee',name:'活动茶几',kind:'table',x:-3.7,z:3.2,w:1.15,d:.8,h:.48},
    {id:'bed',name:'卧室床',kind:'bed',x:-5.5,z:-3.8,w:2.1,d:2.2,h:.53},
    {id:'transferChair',name:'床侧扶手椅',kind:'chair',x:-3.7,z:-2.9,w:.9,d:.85,h:.85},
    {id:'fridge',kind:'fridge',x:5.6,z:1.2,product:'standardFridge'},
    {id:'kitchenCounter',name:'厨房操作台',kind:'counter',x:6.8,z:3.7,w:1.1,d:2.6,h:.88},
    {id:'vanity',name:'门后洗手柜',kind:'counter',x:2.2,z:-3.2,w:.85,d:.65,h:.82},
    {id:'toilet',name:'坐便器',kind:'toilet',x:5.7,z:-4.4,w:.7,d:.85,h:.47}
  ],doors:[
    {id:'entryDoor',name:'入户门',x:0,z:5.9,axis:'x',width:1.5,swing:1,handleHeight:.95,effort:.25},
    {id:'bedDoor',name:'卧室门',x:-1.3,z:-2.5,axis:'z',width:1.6,swing:-1,handleHeight:1.05,effort:.55},
    {id:'bathDoor',name:'卫生间门',x:1.3,z:-2.5,axis:'z',width:1.5,swing:1,handleHeight:1.05,effort:.55}
  ]});
  L.materializeItem=item=>item.kind==='fridge'?{...item,...L.HOME_CATALOG[item.product||'standardFridge']}:item;
  L.makeResidentHome=(given)=>{
    const spec=JSON.parse(JSON.stringify(given||L.homeSpec())),group=new THREE.Group(),zones=new THREE.Group(),doorNodes={},itemNodes={};zones.userData.noAO=true;group.add(zones);
    const mat=(c,extra={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.62,envMapIntensity:.3,...extra});m.color.convertSRGBToLinear();return m;},white=mat('#eaf1fb'),blue=mat('#2788db'),metal=mat('#839cb7',{metalness:.65,roughness:.3}),floor=mat('#b5c2d5'),fabric=mat('#4b8cc6'),wood=mat('#b0c4dd');
    const box=(parent,w,h,d,x,y,z,m,info,ignore=false)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;mesh.userData.collisionInfo=info||{name:'住宅隔墙',kind:'wall'};mesh.userData.ignoreCollision=ignore;mesh.name=info?.name||'住宅隔墙';parent.add(mesh);return mesh;};
    box(group,16,.2,13.8,0,-.1,.9,floor,{name:'住宅地板',kind:'floor'});box(group,16.2,.16,14,0,-.29,.9,metal,null,true);
    const wall=(w,d,x,z)=>{const a=box(group,w,2.7,d,x,1.35,z,white);a.userData.wall=true;const cap=box(group,w+.012,.025,d+.012,x,2.71,z,blue,null,true);cap.userData.wall=true;};
    const split=(axis,k,a,b,center,width)=>{for(const[u,v]of [[a,center-width/2],[center+width/2,b]])if(v>u)axis==='x'?wall(v-u,.16,(u+v)/2,k):wall(.16,v-u,k,(u+v)/2);};
    wall(16,.18,0,-5.9);wall(.18,12,-7.9,0);wall(.18,12,7.9,0);split('x',5.9,-8,8,0,spec.doors[0].width);
    for(const[x,side]of [[-1.3,-1],[1.3,1]]){split('z',x,-5.9,-.05,-2.5,side<0?spec.doors[1].width:spec.doors[2].width);split('z',x,.05,5.9,2.5,2.3);}
    wall(6.6,.16,-4.65,0);wall(6.6,.16,4.65,0);
    const label=(text,x,z)=>{const c=document.createElement('canvas');c.width=512;c.height=100;const ctx=c.getContext('2d');ctx.fillStyle='#477aaa';ctx.font='36px Microsoft YaHei';ctx.textAlign='center';ctx.fillText(text,256,62);const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;const mesh=new THREE.Mesh(new THREE.PlaneGeometry(3,.586),new THREE.MeshBasicMaterial({map:t,transparent:true,depthWrite:false}));mesh.rotation.x=-Math.PI/2;mesh.position.set(x,.015,z);mesh.userData.ignoreCollision=true;zones.add(mesh);};
    for(const[t,x,z]of [['卧室 / BEDROOM',-4.7,-.7],['客厅 / LIVING',-4.7,.65],['厨房 / KITCHEN',4.7,4.9],['卫生间 / BATH',4.8,-.7]])label(t,x,z);zones.traverse(o=>o.userData.ignoreCollision=true);
    for(const raw of spec.items){const item=L.materializeItem(raw),n=new THREE.Group();n.position.set(item.x,0,item.z);n.userData.semanticId=item.id;n.userData.kind=item.kind;n.userData.productName=item.name||item.kind;group.add(n);itemNodes[item.id]=n;const info={semanticId:item.id,name:item.name||({fridge:'冰箱',toilet:'卫生间洁具'}[item.kind]||item.kind),kind:item.kind};
      const b=(w,h,d,x,y,z,m)=>box(n,w,h,d,x,y,z,m,info);
      if(item.kind==='bed'){b(item.w,.25,item.d,0,.17,0,wood);b(item.w-.05,.22,item.d-.06,0,.415,0,white);b(item.w,.85,.12,0,.45,-item.d/2,blue);for(const x of [-.5,.5])b(.65,.13,.42,x,.59,-.65,white);b(item.w-.09,.035,1.2,0,.55,.35,fabric);}
      else if(item.kind==='sofa'){b(item.w,.25,item.d,0,.3,0,fabric);b(item.w,.5,.16,0,.65,item.d/2-.08,fabric);for(const x of [-item.w/2+.08,item.w/2-.08])b(.16,.45,item.d,x,.49,0,fabric);for(const x of [-.7,0,.7])b(.65,.08,.67,x,.47,-.04,blue);}
      else if(item.kind==='fridge'){b(item.w,item.h,item.d,0,item.h/2,0,white);b(item.w-.06,item.h*.55,.035,0,item.h*.68,item.d/2+.02,wood);b(.035,.23,.07,item.w*.34,item.handleHeight,item.d/2+.07,metal);}
      else if(item.kind==='chair'){b(item.w,.13,item.d,0,.48,0,blue);b(item.w,.45,.12,0,.72,-item.d/2+.06,fabric);for(const x of [-item.w/2+.07,item.w/2-.07]){b(.08,.25,item.d,x,.6,0,blue);b(.06,.42,.06,x,.21,0,metal);}}
      else if(item.kind==='table'){b(item.w,.08,item.d,0,item.h-.04,0,wood);for(const x of [-item.w*.4,item.w*.4])b(.06,item.h-.08,item.d*.7,x,(item.h-.08)/2,0,metal);}
      else if(item.kind==='toilet'){b(item.w*.7,.42,item.d*.7,0,.21,.04,white);b(item.w,.08,item.d,0,.46,.05,white);b(item.w,.75,.18,0,.375,-item.d/2,white);}
      else{b(item.w,item.h,item.d,0,item.h/2,0,wood);b(item.w+.03,.05,item.d+.03,0,item.h,0,white);}
    }
    for(const d of spec.doors){const root=new THREE.Group(),axis=d.axis==='x'?0:-Math.PI/2;root.position.set(d.axis==='x'?d.x-d.width/2:d.x,0,d.axis==='x'?d.z:d.z-d.width/2);root.rotation.y=axis;const leaf=new THREE.Group();root.add(leaf);box(leaf,d.width,2.25,.045,d.width/2,1.125,0,wood,null,true);for(const side of [-1,1])box(leaf,.22,.035,.075+(d.handleExtension||0),d.width-.18,d.handleHeight,side*(.065+(d.handleExtension||0)/2),metal,null,true);group.add(root);doorNodes[d.id]={root,leaf,base:axis};root.userData.noAO=false;}
    return{group,zones,doors:spec.doors,doorNodes,itemNodes,spec,editableHome:true,preset:'home',demo:true,name:'Resident Home / 数字住户住宅',bounds:{minX:-8,maxX:8,minZ:-6,maxZ:7.8},goals:[{id:1,name:'客厅沙发',x:-4.9,z:2.6},{id:2,name:'床侧转移区',x:-3.7,z:-3.65},{id:3,name:'卫生间',x:4.4,z:-2.3},{id:4,name:'冰箱',x:5.6,z:2.45},{id:5,name:'入户门外',x:0,z:7.1}],
      setDoor(id,t){const node=doorNodes[id],d=spec.doors.find(d=>d.id===id);if(node)node.leaf.rotation.y=d.swing*t*Math.PI/2;}
    };
  };
})();

