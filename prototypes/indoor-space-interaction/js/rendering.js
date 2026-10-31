/* Local SSAO + colour management. Balanced mode uses the same PBR scene without post effects. */
(() => {
  'use strict';const L=window.IndoorLab;
  class PresentationPipeline{
    constructor(view){this.view=view;this.quality=new URLSearchParams(location.search).get('quality')==='balanced'?'balanced':'high';
      const renderer=view.renderer;renderer.toneMappingExposure=.92;this.style='access';
      const studio=new THREE.Scene();studio.background=new THREE.Color('#a9bdd5');const shell=new THREE.Mesh(new THREE.BoxGeometry(60,35,60),new THREE.MeshBasicMaterial({color:'#73859e',side:THREE.BackSide}));studio.add(shell);
      for(const[x,y,z,w,h]of [[-20,8,0,16,18],[17,10,-20,24,12],[0,17,0,28,12]]){const card=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color(2.2,2.35,2.6),side:THREE.DoubleSide}));card.position.set(x,y,z);card.lookAt(0,0,0);studio.add(card);}
      const generator=new THREE.PMREMGenerator(renderer);this.environment=generator.fromScene(studio,.035);view.scene.environment=this.environment.texture;generator.dispose();studio.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
      this.composer=new THREE.EffectComposer(renderer);this.ssao=new THREE.SSAOPass(view.scene,view.camera,256,256);this.ssao.kernelRadius=.56;this.ssao.normalRenderTarget.depthTexture.type=THREE.UnsignedIntType;this.ssao.enabled=true;this.hazardMode=false;
      const originalOverride=this.ssao.overrideVisibility.bind(this.ssao);this.ssao.overrideVisibility=()=>{originalOverride();
        if(!this._aoExcluded){this._aoExcluded=[];view.scene.traverse(o=>{let excluded=o.isSprite||o.material?.transparent;for(let p=o;p&&!excluded;p=p.parent)excluded=p.userData.noAO;if(excluded)this._aoExcluded.push(o);});}
        for(const o of this._aoExcluded)o.visible=false;
      };
      this.gamma=new THREE.ShaderPass(THREE.GammaCorrectionShader);this.fxaa=new THREE.ShaderPass(THREE.FXAAShader);this.composer.addPass(this.ssao);this.composer.addPass(this.gamma);this.composer.addPass(this.fxaa);
      this.setQuality(this.quality);
    }
    setStyle(style){
      this.style=['access','editorial','surreal','moodboard','soft-home'].includes(style)?style:'access';
      const v=this.view, r=v.renderer;
      const palettes={
        access:{background:'#c9d5e5',fog:'#c9d5e5',ground:'#95a3b9',grid:'#a0b3cd',exposure:1.08,key:'#fff9ef',keyIntensity:2.15,fill:'#bfdcff',fillIntensity:.32,env:.55},
        editorial:{background:'#070a12',fog:'#070a12',ground:'#0d1421',grid:'#2d4058',exposure:.78,key:'#ffd0a0',keyIntensity:1.55,fill:'#688dc2',fillIntensity:.22,env:.22},
        surreal:{background:'#b8cbe8',fog:'#b8cbe8',ground:'#8f89ae',grid:'#d0c9e5',exposure:1.05,key:'#fff1d3',keyIntensity:1.85,fill:'#b8a3ff',fillIntensity:.5,env:.48},
        moodboard:{background:'#101722',fog:'#101722',ground:'#171d27',grid:'#3b3b45',exposure:1.12,key:'#ffc06b',keyIntensity:3.25,fill:'#9ab8d8',fillIntensity:.38,env:.68},
        'soft-home':{background:'#edf1f3',fog:'#edf1f3',ground:'#d4d9dc',grid:'#c2d2d2',exposure:1.22,key:'#fff7df',keyIntensity:2.05,fill:'#b9eddd',fillIntensity:.75,env:.72}
      }[this.style];
      v.scene.background=new THREE.Color(palettes.background);v.scene.fog.color.set(palettes.fog);
      if(v.ground?.material?.color){v.ground.material.color.set(palettes.ground).convertSRGBToLinear();v.ground.material.roughness=this.style==='editorial'?.98:.9;}
      if(v.contextGrid?.material?.color){v.contextGrid.material.color.set(palettes.grid).convertSRGBToLinear();v.contextGrid.material.opacity=this.style==='editorial'?.3:.48;}
      r.toneMappingExposure=palettes.exposure;v.sun.color.set(palettes.key);v.sun.intensity=palettes.keyIntensity;v.fill.color.set(palettes.fill);v.fill.intensity=palettes.fillIntensity;
      v.scene.fog.near=this.style==='moodboard'?70:100;v.scene.fog.far=this.style==='moodboard'?170:210;
      const model=v.model?.group;
      if(model)model.traverse(o=>{
        if(!o.isMesh||!o.material||o.userData.styleLocked)return;
        const mats=Array.isArray(o.material)?o.material:[o.material];
        const label=`${o.name||''} ${o.userData.kind||''} ${o.userData.collisionInfo?.kind||''}`;
        for(const m of mats){
          if(!m.color||m.isMeshBasicMaterial)continue;
          m.userData??={};
          if(!m.userData.presentationOriginalColor)m.userData.presentationOriginalColor=m.color.clone();
          if(m.userData.presentationOriginalRoughness===undefined&&'roughness'in m)m.userData.presentationOriginalRoughness=m.roughness;
          if(m.userData.presentationOriginalEnv===undefined&&'envMapIntensity'in m)m.userData.presentationOriginalEnv=m.envMapIntensity;
          if(this.style==='access'){
            m.color.copy(m.userData.presentationOriginalColor);
            if(m.userData.presentationOriginalRoughness!==undefined)m.roughness=m.userData.presentationOriginalRoughness;
            if(m.userData.presentationOriginalEnv!==undefined)m.envMapIntensity=m.userData.presentationOriginalEnv;
            continue;
          }
          const textured=!!m.map;
          if(textured&&'envMapIntensity'in m)m.envMapIntensity=palettes.env;
          const kind=o.userData.kind||o.userData.collisionInfo?.kind||'';
          let color=null;
          if(this.style==='editorial'){
            if(kind==='wall'||/墙|wall/i.test(label))color='#4b4f5b';
            else if(kind==='floor'||/地板|地面|floor|ground/i.test(label))color='#40352f';
            else if(kind==='window'||/窗|玻璃|window|glass/i.test(label))color='#5f8291';
            else if(kind==='metal'||/金属|把手|metal|handle|fridge/i.test(label))color='#6f788b';
            else if(/沙发|床|椅|织物|sofa|bed|chair|fabric/i.test(label))color='#8b5f4b';
            else if(/坐便|洗手|卫浴|toilet|sink|ceramic/i.test(label))color='#b7b0a7';
            else if(/门|柜|台|桌|door|cabinet|counter|table/i.test(label))color='#6e4e3a';
            else color='#78675e';
          }else if(this.style==='surreal'){
            if(kind==='wall'||/墙|wall/i.test(label))color='#d8cff4';
            else if(kind==='floor'||/地板|地面|floor|ground/i.test(label))color='#b7c8e1';
            else if(kind==='window'||/窗|玻璃|window|glass/i.test(label))color='#8fe1e9';
            else if(kind==='metal'||/金属|把手|metal|handle|fridge/i.test(label))color='#b4d8e5';
            else if(/沙发|床|椅|织物|sofa|bed|chair|fabric/i.test(label))color='#e8bfd0';
            else if(/坐便|洗手|卫浴|toilet|sink|ceramic/i.test(label))color='#fff4f2';
            else if(/门|柜|台|桌|door|cabinet|counter|table/i.test(label))color='#e5c8b3';
            else color='#c6b9e8';
          }else if(this.style==='moodboard'){
            if(kind==='wall'||/墙|wall/i.test(label))color='#b7b0a4';
            else if(kind==='floor'||/地板|地面|floor|ground/i.test(label))color='#a8703e';
            else if(kind==='window'||/窗|玻璃|window|glass/i.test(label))color='#7ba0b8';
            else if(kind==='metal'||/金属|把手|metal|handle|fridge/i.test(label))color='#707d86';
            else if(/沙发|床|椅|织物|sofa|bed|chair|fabric/i.test(label))color='#e2d5bd';
            else if(/坐便|洗手|卫浴|toilet|sink|ceramic/i.test(label))color='#f0eee7';
            else if(/门|柜|台|桌|door|cabinet|counter|table/i.test(label))color='#8d4d2b';
            else color='#c99a66';
          }else if(this.style==='soft-home'){
            if(kind==='wall'||/墙|wall/i.test(label))color='#f5f5f1';
            else if(kind==='floor'||/地板|地面|floor|ground/i.test(label))color='#d8b383';
            else if(kind==='window'||/窗|玻璃|window|glass/i.test(label))color='#cce7e1';
            else if(kind==='metal'||/金属|把手|metal|handle|fridge/i.test(label))color='#a9b6bc';
            else if(/沙发|床|椅|织物|sofa|bed|chair|fabric/i.test(label))color='#e8e2d5';
            else if(/坐便|洗手|卫浴|toilet|sink|ceramic/i.test(label))color='#ffffff';
            else if(/门|柜|台|桌|door|cabinet|counter|table/i.test(label))color='#d6b99a';
            else color='#d4e6df';
          }
          if(color){const target=new THREE.Color(color).convertSRGBToLinear();if(textured)m.color.copy(m.userData.presentationOriginalColor).lerp(target,this.style==='editorial'?.16:.1);else m.color.copy(target);}
          if('roughness'in m)m.roughness=this.style==='editorial'?.5:.68;
          if('envMapIntensity'in m)m.envMapIntensity=palettes.env;
        }
      });
      v.shadowDirty=true;v.nextShadow=0;
    }
    setHazardMode(active){this.hazardMode=!!active;this.ssao.enabled=!this.hazardMode;this.view.shadowDirty=true;this.view.nextShadow=0;}
    setQuality(quality){this.quality=quality==='balanced'?'balanced':'high';this.view.shadowDirty=true;this.view.nextShadow=0;this.resize(this.view.container.clientWidth||800,this.view.container.clientHeight||600);}
    resize(w,h){const ratio=Math.min(devicePixelRatio||1,this.quality==='high'?(this.hazardMode?1.05:1.22):1.1);this.view.renderer.setPixelRatio(ratio);this.view.renderer.setSize(w,h,false);this.composer.setPixelRatio(ratio);this.composer.setSize(w,h);this.fxaa.uniforms.resolution.value.set(1/(w*ratio),1/(h*ratio));}
    render(){const v=this.view;if(this.quality==='balanced'){v.renderer.render(v.scene,v.camera);return;}
      if(this.hazardMode){v.renderer.render(v.scene,v.camera);return;}
      const range=v.camera.far-v.camera.near;this.ssao.minDistance=.018/range;this.ssao.maxDistance=1.5/range;
      for(const material of [this.ssao.ssaoMaterial,this.ssao.depthRenderMaterial]){material.uniforms.cameraNear.value=v.camera.near;material.uniforms.cameraFar.value=v.camera.far;}
      this.ssao.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(v.camera.projectionMatrix);this.ssao.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(v.camera.projectionMatrixInverse);this.composer.render();
    }
  }
  L.PresentationPipeline=PresentationPipeline;
})();
