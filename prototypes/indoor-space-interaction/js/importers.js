/* All files are parsed in this browser. Companion resources resolve to local Blob URLs. */
(() => {
  'use strict'; const L=window.IndoorLab;
  const formats=['obj','stl','3ds','gltf','glb','fbx','dae'];
  L.modelFormats=formats;
  function parseSTL(buffer){
    const view=new DataView(buffer),decoder=new TextDecoder();let positions=[];
    const count=buffer.byteLength>=84?view.getUint32(80,true):0;
    if(count>0&&84+count*50===buffer.byteLength){if(count>2000000)throw new Error('STL 超过 200 万三角面，请先简化模型。');positions=new Float32Array(count*9);let k=0;for(let i=0;i<count;i++){const offset=84+i*50+12;for(let j=0;j<9;j++)positions[k++]=view.getFloat32(offset+j*4,true);}}
    else{const text=decoder.decode(buffer),re=/vertex\s+([+-]?[\d.eE+-]+)\s+([+-]?[\d.eE+-]+)\s+([+-]?[\d.eE+-]+)/g;let match;while((match=re.exec(text))){positions.push(Number(match[1]),Number(match[2]),Number(match[3]));if(positions.length>18000000)throw new Error('STL 网格过大，请先简化。');}}
    if(!positions.length||positions.length%9||!positions.every(Number.isFinite))throw new Error('STL 数据无效或没有三角网格。');const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.computeVertexNormals();return new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:'#c1c6b7',roughness:.7,side:THREE.DoubleSide}));
  }
  L.parseSTL=parseSTL;
  L.importModel=async(files,options,progress)=>{
    files=[...files];const main=files.find(f=>formats.includes(f.name.split('.').pop().toLowerCase()));if(!main)throw new Error('请选择 OBJ / STL / 3DS / GLB / GLTF / FBX / DAE 模型。');
    if(files.filter(f=>formats.includes(f.name.split('.').pop().toLowerCase())).length>1)throw new Error('一次请选择一个主模型，配套贴图、MTL 和 BIN 可一起选择。');
    if(main.size>180*1024*1024)throw new Error('主模型超过 180 MB，请先分层导出或简化网格。');
    const ext=main.name.split('.').pop().toLowerCase(),blobs=[],missing=new Set(),manager=new THREE.LoadingManager(),resourceMap=new Map();
    for(const file of files){const url=URL.createObjectURL(file);blobs.push(url);resourceMap.set(file.name.toLowerCase(),url);if(file.webkitRelativePath)resourceMap.set(file.webkitRelativePath.toLowerCase(),url);}
    manager.setURLModifier(url=>{
      if(/^(blob:|data:)/i.test(url))return url;
      let decoded;try{decoded=decodeURIComponent(url).replace(/\\/g,'/');}catch{decoded=url;}
      const key=decoded.replace(/^\.\//,'').toLowerCase(),base=key.split('/').pop(),local=resourceMap.get(key)||resourceMap.get(base);
      if(local)return local;missing.add(base);return 'data:application/octet-stream;base64,';
    });
    const resourceErrors=new Set();manager.onError=url=>resourceErrors.add(url);
    let resourcesPending=false,finishResources,resourceTimer;
    manager.onStart=()=>{resourcesPending=true;};manager.onLoad=()=>{resourcesPending=false;finishResources?.();};
    let root=null,group=null,complete=false;
    try{
      progress?.(`正在读取 ${main.name}…`);const buffer=await main.arrayBuffer(),text=()=>new TextDecoder().decode(buffer);
      if(ext==='obj'){
        const loader=new THREE.OBJLoader(manager),mtl=files.find(f=>/\.mtl$/i.test(f.name));
        if(mtl){const materials=new THREE.MTLLoader(manager).parse(await mtl.text(),'');materials.preload();loader.setMaterials(materials);}root=loader.parse(text());
      }else if(ext==='stl')root=parseSTL(buffer);
      else if(ext==='3ds')root=new THREE.TDSLoader(manager).parse(buffer,'');
      else if(ext==='gltf'||ext==='glb'){
        const result=await new Promise((resolve,reject)=>new THREE.GLTFLoader(manager).parse(buffer,'',resolve,reject));root=result.scene;
      }else if(ext==='fbx')root=new THREE.FBXLoader(manager).parse(buffer,'');
      else if(ext==='dae')root=new THREE.ColladaLoader(manager).parse(text(),'').scene;
      // Keep Blob URLs alive until all companion resources have settled.
      if(resourcesPending)await new Promise((resolve,reject)=>{finishResources=resolve;resourceTimer=setTimeout(()=>reject(new Error('配套资源加载超时，请检查贴图和 BIN 文件。')),15000);});
      let meshCount=0,triangles=0;
      root.traverse(o=>{if(o.isCamera||o.isLight)o.visible=false;if(!o.isMesh)return;meshCount++;const p=o.geometry.attributes.position;triangles+=(o.geometry.index?.count||p?.count||0)/3;o.castShadow=o.receiveShadow=true;
        if(!o.material)o.material=new THREE.MeshStandardMaterial({color:'#b7c3b1',roughness:.7});
        for(const material of Array.isArray(o.material)?o.material:[o.material]){material.side=THREE.DoubleSide;if(material.roughness!==undefined)material.roughness=Math.max(.3,material.roughness);}
      });
      if(!meshCount||!triangles)throw new Error('模型没有可读取的三角网格。');
      if(triangles>2000000)throw new Error('模型超过 200 万三角面，请先简化网格后导入。');
      group=new THREE.Group();const orient=new THREE.Group();orient.add(root);group.add(orient);
      const up=options.up==='auto'?(['stl','3ds'].includes(ext)?'z':'y'):options.up;if(up==='z')orient.rotation.x=-Math.PI/2;
      group.scale.setScalar(options.unit);group.updateMatrixWorld(true);
      let bounds3=new THREE.Box3().setFromObject(group);if(bounds3.isEmpty()||![bounds3.min.x,bounds3.min.y,bounds3.min.z,bounds3.max.x,bounds3.max.y,bounds3.max.z].every(Number.isFinite))throw new Error('模型包含无效坐标。');
      const size=bounds3.getSize(new THREE.Vector3());if(Math.max(size.x,size.z)>500||Math.min(size.x,size.z)<.5)throw new Error(`当前平面尺寸 ${size.x.toFixed(2)} × ${size.z.toFixed(2)} m；请检查单位或向上轴（支持 0.5–500 m）。`);
      const center=bounds3.getCenter(new THREE.Vector3()),floor=Number.isFinite(options.floor)?bounds3.min.y+options.floor:L.estimateFloor(group);
      group.position.set(-center.x,-floor,-center.z);group.updateMatrixWorld(true);bounds3=new THREE.Box3().setFromObject(group);
      const bounds={minX:bounds3.min.x,maxX:bounds3.max.x,minZ:bounds3.min.z,maxZ:bounds3.max.z};
      // Imported walls: only tall broad meshes, never hide a merged whole-room mesh.
      group.traverse(o=>{if(!o.isMesh)return;const b=new THREE.Box3().setFromObject(o),s=b.getSize(new THREE.Vector3());if(meshCount>3&&s.y>2&&Math.min(s.x,s.z)<.6&&Math.max(s.x,s.z)>2)o.userData.wall=true;});
      complete=true;
      return{group,bounds,goals:[],name:main.name,demo:false,source:{format:ext,unit:options.unit,up,floorAboveBottom:-bounds3.min.y,floorElevationMeters:floor,translationMeters:[-center.x,-floor,-center.z],meshCount,triangles:Math.round(triangles),missing:[...missing],resourceErrors:resourceErrors.size},warnings:missing.size?`缺少 ${[...missing].join('、')}；几何已载入，部分材质可能缺失。`:resourceErrors.size?'几何已加载，但部分配套贴图无法解码。':''};
    }catch(error){throw new Error(/DRACO|Meshopt|KTX2|decoder/i.test(error.message)?'此模型带有压缩网格或纹理，请导出未压缩 GLB / GLTF 再试。':`导入失败：${error.message}`);}
    finally{clearTimeout(resourceTimer);blobs.forEach(url=>URL.revokeObjectURL(url));if(!complete&&root)L.dispose(group||root);}
  };
})();
