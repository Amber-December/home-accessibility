/* Local SSAO + colour management. Balanced mode uses the same PBR scene without post effects. */
(() => {
  'use strict';const L=window.IndoorLab;
  class PresentationPipeline{
    constructor(view){this.view=view;this.quality=new URLSearchParams(location.search).get('quality')==='balanced'?'balanced':'high';
      const renderer=view.renderer;renderer.toneMappingExposure=.92;
      const studio=new THREE.Scene();studio.background=new THREE.Color('#a9bdd5');const shell=new THREE.Mesh(new THREE.BoxGeometry(60,35,60),new THREE.MeshBasicMaterial({color:'#73859e',side:THREE.BackSide}));studio.add(shell);
      for(const[x,y,z,w,h]of [[-20,8,0,16,18],[17,10,-20,24,12],[0,17,0,28,12]]){const card=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color(2.2,2.35,2.6),side:THREE.DoubleSide}));card.position.set(x,y,z);card.lookAt(0,0,0);studio.add(card);}
      const generator=new THREE.PMREMGenerator(renderer);this.environment=generator.fromScene(studio,.035);view.scene.environment=this.environment.texture;generator.dispose();studio.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
      this.composer=new THREE.EffectComposer(renderer);this.ssao=new THREE.SSAOPass(view.scene,view.camera,512,512);this.ssao.kernelRadius=.72;this.ssao.normalRenderTarget.depthTexture.type=THREE.UnsignedIntType;
      const originalOverride=this.ssao.overrideVisibility.bind(this.ssao);this.ssao.overrideVisibility=()=>{originalOverride();view.scene.traverse(o=>{let excluded=o.isSprite||o.material?.transparent;for(let p=o;p&&!excluded;p=p.parent)excluded=p.userData.noAO;if(excluded)o.visible=false;});};
      this.gamma=new THREE.ShaderPass(THREE.GammaCorrectionShader);this.fxaa=new THREE.ShaderPass(THREE.FXAAShader);this.composer.addPass(this.ssao);this.composer.addPass(this.gamma);this.composer.addPass(this.fxaa);
      this.setQuality(this.quality);
    }
    setQuality(quality){this.quality=quality==='balanced'?'balanced':'high';this.view.shadowDirty=true;this.view.nextShadow=0;this.resize(this.view.container.clientWidth||800,this.view.container.clientHeight||600);}
    resize(w,h){const ratio=Math.min(devicePixelRatio||1,this.quality==='high'?1.4:1.25);this.view.renderer.setPixelRatio(ratio);this.view.renderer.setSize(w,h,false);this.composer.setPixelRatio(ratio);this.composer.setSize(w,h);this.fxaa.uniforms.resolution.value.set(1/(w*ratio),1/(h*ratio));}
    render(){const v=this.view;if(this.quality==='balanced'){v.renderer.render(v.scene,v.camera);return;}
      const range=v.camera.far-v.camera.near;this.ssao.minDistance=.018/range;this.ssao.maxDistance=1.5/range;
      for(const material of [this.ssao.ssaoMaterial,this.ssao.depthRenderMaterial]){material.uniforms.cameraNear.value=v.camera.near;material.uniforms.cameraFar.value=v.camera.far;}
      this.ssao.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(v.camera.projectionMatrix);this.ssao.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(v.camera.projectionMatrixInverse);this.composer.render();
    }
  }
  L.PresentationPipeline=PresentationPipeline;
})();
