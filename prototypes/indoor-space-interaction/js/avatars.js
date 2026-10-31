/* Articulated people and mobility devices, batched by geometry/material. */
(() => {
  'use strict';const L=window.IndoorLab;
  function material(color,extra={}){const m=new THREE.MeshStandardMaterial({color,roughness:.65,...extra});m.color.convertSRGBToLinear();return m;}
  class CrowdRenderer{
    constructor(group,agents){this.group=group;this.count=agents.length;this.parts={};this.pose=new THREE.Object3D();this.up=new THREE.Vector3(0,1,0);this.direction=new THREE.Vector3();
      const torso=new THREE.LatheGeometry([new THREE.Vector2(.115,-.26),new THREE.Vector2(.145,-.2),new THREE.Vector2(.153,.03),new THREE.Vector2(.185,.2),new THREE.Vector2(.16,.26),new THREE.Vector2(.07,.29)],24);torso.computeVertexNormals();
      const defs={torso:[torso,material('#ffffff'),1],skin:[new THREE.SphereGeometry(1,18,14),material('#ffffff'),16],hair:[new THREE.SphereGeometry(1,20,12,0,Math.PI*2,0,Math.PI*.62),material('#ffffff',{roughness:.88}),3],cloth:[new THREE.CylinderGeometry(1,1,1,12),material('#ffffff'),4],pants:[new THREE.CylinderGeometry(1,1,1,14),material('#32465e'),4],hip:[new THREE.SphereGeometry(1,16,12),material('#30445d'),1],shoes:[new THREE.SphereGeometry(1,16,10),material('#233348',{roughness:.42}),2],tyres:[new THREE.TorusGeometry(.3,.026,10,40),material('#293448',{roughness:.88}),2],rims:[new THREE.TorusGeometry(.274,.012,8,40),material('#9eb8d5',{metalness:.85,roughness:.23}),4],chrome:[new THREE.CylinderGeometry(1,1,1,8),material('#9fb5ce',{metalness:.78,roughness:.28}),32],padding:[new THREE.BoxGeometry(1,1,1),material('#195db0',{roughness:.69}),4],casters:[new THREE.CylinderGeometry(1,1,1,18),material('#344b69'),4],selection:[new THREE.RingGeometry(.94,1,40),new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.24,depthWrite:false,side:THREE.DoubleSide}),1]};
      defs.cane=[new THREE.CylinderGeometry(1,1,1,10),material('#f4f8ff',{roughness:.4}),2];for(const[key,[geo,mat,per]]of Object.entries(defs)){const mesh=new THREE.InstancedMesh(geo,mat,Math.max(1,agents.length*per));mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.castShadow=key!=='selection';mesh.receiveShadow=true;mesh.userData.agentIds=[];mesh.userData.noAO=key==='selection';if(['torso','skin','hair','cloth','selection'].includes(key))mesh.setColorAt(0,new THREE.Color('#ffffff'));this.parts[key]=mesh;group.add(mesh);}
    }
    put(key,p,scale,rotation,color,id){const mesh=this.parts[key],n=this.indices[key]++,o=this.pose;o.position.set(p.x,p.y,p.z);o.scale.set(...scale);if(rotation?.isQuaternion)o.quaternion.copy(rotation);else o.rotation.set(...(rotation||[0,0,0]));o.updateMatrix();mesh.setMatrixAt(n,o.matrix);mesh.userData.agentIds[n]=id;if(color)mesh.setColorAt(n,new THREE.Color(color).convertSRGBToLinear());}
    link(key,a,b,r,color,id){this.direction.subVectors(b,a);const length=this.direction.length();if(length<1e-6)return;const q=new THREE.Quaternion().setFromUnitVectors(this.up,this.direction.normalize());this.put(key,{x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(a.z+b.z)/2},[r,length,r],q,color,id);}
    update(agents,time,hiddenId=-1){this.indices={};for(const k in this.parts)this.indices[k]=0;
      for(const a of agents){if(a.id===hiddenId)continue;const seated=a.type==='wheelchair',assisted=a.type==='assisted',reaction=a.reaction||{},crouch=!seated&&(reaction.posture==='crouch'||reaction.posture==='duck'),brace=!seated&&reaction.posture==='brace',angle=a.angle,phase=time*(assisted?4:5.8)+a.id*1.7,moving=a.state==='moving'&&Math.hypot(a.vx,a.vz)>.03,stride=moving?Math.sin(phase)*(assisted?.07:.17):0,bob=moving&&!seated?Math.abs(Math.sin(phase))*.018:0;
        const skin=['#e1bc9d','#d6ab8d','#b37f62','#e8c8ae','#bc9379'][a.id%5],hair=['#233248','#66554c','#37404b','#8e8b82'][a.id%4],shirt=['#1480de','#2e9ce7','#dce7f4','#4c74ac','#8caccd'][a.id%5];
        const local=(x,y,z)=>new THREE.Vector3(a.x+Math.cos(angle)*x+Math.sin(angle)*z,y+bob,a.z-Math.sin(angle)*x+Math.cos(angle)*z),put=(key,x,y,z,scale,rotation,color)=>this.put(key,local(x,y,z),scale,rotation||[0,angle,0],color,a.id),link=(key,p,q,r,color)=>this.link(key,local(...p),local(...q),r,color,a.id);
        const hip=seated?.59:crouch?.61:.86,shoulder=seated?1.06:crouch?.98:1.36,head=seated?1.32:crouch?1.20:1.65,lean=assisted?.035:crouch?.12:brace?.055:0;
        put('torso',0,(hip+shoulder)/2,lean,[1,seated?.78:1,.76],null,shirt);put('hip',0,hip-.035,0,[.135,.115,.115]);
        link('skin',[0,shoulder+.03,lean],[0,head-.11,lean],.048,skin);put('skin',0,head,lean,[.108,.139,.102],null,skin);put('hair',0,head+.014,lean-.005,[.111,.139,.106],null,hair);
        // Ears, nose and simple eyes become visible when following an agent closely.
        for(const side of [-1,1]){put('skin',side*.108,head-.01,lean,[.022,.034,.02],null,skin);put('hair',side*.038,head+.018,lean+.089,[.014,.018,.008],[Math.PI,angle,0],hair);}
        put('skin',0,head-.012,lean+.103,[.022,.026,.033],null,skin);
        for(const side of [-1,1]){
          const legZ=seated?.26:stride*side,kneeY=seated?.55:.49,ankleY=seated?.21:.13,kneeZ=seated?.29:legZ*.65,ankleZ=seated?.34:legZ;
          link('pants',[side*.085,hip-.07,0],[side*.095,kneeY,kneeZ],.064);link('pants',[side*.095,kneeY,kneeZ],[side*.1,ankleY,ankleZ],.048);put('shoes',side*.1,ankleY-.055,ankleZ+.045,[.066,.052,.125]);
          const acting=/触达|取物|把手/.test(a.action||''),protecting=crouch||brace,limited=a.type==='upper',elbowZ=protecting?side*.06:acting?.15:assisted?.14:seated?.08:-stride*side*(limited?.1:.6),handZ=protecting?.12:acting?(limited?.23:.38):assisted?.2:seated?.25:-stride*side*(limited?.1:1),elbowY=protecting?head-.12:acting?(seated?.99:1.27):seated?.88:1.13,handY=protecting?head-.03:acting?(seated?1.04:1.35):assisted?.9:seated?.79:.93,handX=assisted?side*.28:side*.215;
          link('cloth',[side*.168,shoulder,lean],[side*.19,elbowY+.035,elbowZ],.063,shirt);put('skin',side*.19,elbowY,elbowZ,[.046,.046,.046],null,skin);link('skin',[side*.19,elbowY,elbowZ],[handX,handY,handZ],.036,skin);put('skin',handX,handY-.025,handZ,[.035,.06,.026],null,skin);put('skin',handX+side*.03,handY-.005,handZ+.016,[.014,.034,.014],null,skin);
        }
        put('selection',0,.035,0,[a.profile.radius,a.profile.radius,1],[-Math.PI/2,0,0],a.profile.color);
        if(seated){
          put('padding',0,.53,.03,[.43,.075,.4]);put('padding',0,.91,-.19,[.44,.53,.065]);
          for(const side of [-1,1]){
            put('tyres',side*.285,.325,-.025,[1,1,1],[0,angle+Math.PI/2,0]);put('rims',side*.32,.325,-.025,[1,1,1],[0,angle+Math.PI/2,0]);put('rims',side*.285,.325,-.025,[.92,.92,.92],[0,angle+Math.PI/2,0]);
            for(let j=0;j<8;j++){const t=j*Math.PI/4+time*(moving?1.4:0);link('chrome',[side*.285,.325,-.025],[side*.285,.325+Math.sin(t)*.265,-.025+Math.cos(t)*.265],.004);}
            link('chrome',[side*.22,.35,-.12],[side*.22,.99,-.2],.016);link('chrome',[side*.22,.99,-.2],[side*.22,1.02,-.31],.018);link('chrome',[side*.22,.5,-.12],[side*.2,.15,.32],.017);put('casters',side*.2,.1,.32,[.075,.025,.075],[0,0,Math.PI/2]);put('padding',side*.23,.78,.025,[.05,.055,.31]);put('padding',side*.13,.16,.39,[.17,.035,.15]);
          }link('chrome',[-.285,.325,-.025],[.285,.325,-.025],.022);
        }
        if(assisted){for(const side of [-1,1]){link('chrome',[side*.29,.08,.19],[side*.29,.89,.19],.015);link('chrome',[side*.29,.1,-.13],[side*.29,.89,.19],.014);put('padding',side*.29,.9,.17,[.043,.035,.13]);put('casters',side*.29,.055,.19,[.043,.023,.043],[0,0,Math.PI/2]);}link('chrome',[-.29,.69,.19],[.29,.69,.19],.015);link('chrome',[-.29,.3,.19],[.29,.66,.19],.009);}
        if(a.type==='blind'){const tip=.21+Math.sin(time*5)*.22;link('cane',[.215,.93,.06],[tip,.035,.93],.014);put('casters',tip,.027,.93,[.022,.025,.022],[0,0,Math.PI/2]);}
      }
      for(const[key,mesh]of Object.entries(this.parts)){mesh.count=this.indices[key];mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
    }
  }
  L.CrowdRenderer=CrowdRenderer;
})();

