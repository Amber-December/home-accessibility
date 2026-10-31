/* Furniture recognition and reversible model replacement.  Everything stays in
 * the browser; the optional library endpoint only exposes local test assets. */
(() => {
  'use strict';
  const L = window.IndoorLab;
  const $ = id => document.getElementById(id);
  const KIND_LABELS = {bed:'床',sofa:'沙发',fridge:'冰箱',toilet:'卫生间洁具',chair:'椅子',table:'桌子',cabinet:'柜体',counter:'台面',furniture:'家具'};
  const inferKind = value => {
    const text = String(value || '').toLowerCase();
    if (/床边|床头柜|床头|nightstand|bedside/.test(text)) return 'table';
    if (/床|bed|mattress/.test(text)) return 'bed';
    if (/沙发|sofa|couch/.test(text)) return 'sofa';
    if (/冰箱|fridge|refrigerator/.test(text)) return 'fridge';
    if (/马桶|坐便|厕所|卫生间|toilet|wc|bath/.test(text)) return 'toilet';
    if (/椅|chair|stool|seat/.test(text)) return 'chair';
    if (/桌|书桌|办公桌|table|desk/.test(text)) return 'table';
    if (/柜|衣柜|餐边|收纳|cabinet|wardrobe|shelf|storage/.test(text)) return 'cabinet';
    if (/台|counter|vanity/.test(text)) return 'counter';
    return 'furniture';
  };
  const categoryKind = category => {
    const k = inferKind(category);
    return k === 'furniture' ? (/办公椅|椅|chair/i.test(String(category)) ? 'chair' : /柜|shelf|storage/i.test(String(category)) ? 'cabinet' : 'table') : k;
  };
  const furniturePathKey = (info, node) => {
    const direct = info.sourceProduct || node?.userData?.sourceProduct;
    const raw = info.usdPath || node?.userData?.usdPath;
    if (raw) {
      const parts = String(raw).split('/').filter(Boolean);
      const token = /(?:^|[_-])(?:bed|mattress|sofa|couch|chair|armchair|stool|table|desk|cabinet|wardrobe|shelf|bookcase|fridge|refrigerator|toilet|sink|bathtub|kitchen)(?:\d|[_-]|$)|床|沙发|椅|桌|柜|冰箱|马桶|浴缸/i;
      const index = parts.findIndex(part => token.test(part));
      if (index >= 0) return `/${parts.slice(0,index + 1).join('/')}`;
    }
    return direct || null;
  };
  const disposeObject = object => { if (!object) return; const geometries = new Set(), materials = new Set(), textures = new Set(); object.traverse?.(o => { if (o.geometry) geometries.add(o.geometry); for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) { if (!m) continue; materials.add(m); for (const value of Object.values(m)) if (value?.isTexture) textures.add(value); } }); textures.forEach(t => t.dispose?.()); materials.forEach(m => m.dispose?.()); geometries.forEach(g => g.dispose?.()); };

  class ModelReplacementManager {
    constructor(options = {}) { this.state = options.state || (() => ({})); this.toast = options.toast || (() => {}); this.library = []; this.uploads = []; this.targets = []; this.history = new Map(); this.mixers = new Set(); this.model = null; }
    currentModel() { const state = this.state() || {}; return state.model || L.app?.model || null; }
    scan(model = this.currentModel()) {
      this.model = model; this.targets = []; if (!model?.group) return this.targets;
      const semantic = model.itemNodes && model.spec?.items;
      if (semantic) for (const item of model.spec.items) { const node = model.itemNodes[item.id]; if (!node) continue; this.targets.push({key:`semantic:${item.id}`,id:item.id,name:item.name || item.id,kind:inferKind(item.kind || item.name),node,semantic:true}); }
      if (!this.targets.length) {
        const grouped = new Map(); model.group.traverse(o => {
          if (!o.isMesh || o.visible === false || o.userData.ignoreCollision || o.userData.wall || o.userData.floor) return;
          const info = o.userData.collisionInfo || {}, name = info.name || o.name || '未命名家具', kind = inferKind(info.kind || name);
          const label = `${name} ${info.kind || ''}`;
          // Geometry-only office imports often expose material/part names
          // such as slab, metal, fabric, screen or wood. They are useful for
          // rendering but are not meaningful furniture replacement targets.
          if (kind === 'furniture' && /wall|floor|ceiling|地板|墙|顶|门|window|slab|metal|fabric|screen|wood|material|mesh|未命名家具/i.test(label)) return;
          const key = furniturePathKey(info,o) || info.semanticId || `${kind}:${o.uuid}`;
          let item = grouped.get(key);
          if (!item) { item = {key:`mesh:${key}`,id:key,name,kind,node:o,nodes:[o],semantic:false}; grouped.set(key,item); }
          else { item.nodes.push(o); if (item.kind === 'furniture' && kind !== 'furniture') item.kind = kind; item.name = item.name || name; }
        }); this.targets = [...grouped.values()];
      }
      // Keep replaced imported meshes selectable even though their original
      // node is hidden behind the replacement anchor.
      for (const record of this.history.values()) {
        if (record?.target && !this.targets.some(target => target.key === record.target.key)) this.targets.push(record.target);
      }
      for (const target of this.targets) {
        target.label = `${KIND_LABELS[target.kind] || target.kind} · ${target.name}`;
        target.originalBounds = this.boundsOf(target);
        target.originalSize = target.originalBounds.getSize(new THREE.Vector3());
      }
      return this.targets;
    }
    boundsOf(target) {
      const bounds = new THREE.Box3();
      for (const node of target?.nodes || [target?.node]) if (node) bounds.union(new THREE.Box3().setFromObject(node));
      return bounds.isEmpty() ? new THREE.Box3(new THREE.Vector3(),new THREE.Vector3(1,1,1)) : bounds;
    }
    targetForObject(object) {
      if (!object) return null;
      this.scan();
      for (const target of this.targets) {
        let node = object;
        while (node) {
          if (node === target.node || target.nodes?.includes(node) || node.userData?.replacementTargetKey === target.key || node.userData?.replacementTargetKey === target.id) return target;
          node = node.parent;
        }
      }
      return null;
    }
    selectTarget(targetOrKey) {
      const target = typeof targetOrKey === 'string' ? this.targets.find(item => item.key === targetOrKey || item.id === targetOrKey) : targetOrKey;
      if (!target) return null;
      this.selectedTargetKey = target.key;
      this.onTargetSelected?.(target);
      return target;
    }
    selectObject(object) {
      const target = this.targetForObject(object);
      return target ? this.selectTarget(target) : null;
    }
    sizeOf(node) { if (!node) return new THREE.Vector3(1,1,1); node.updateMatrixWorld?.(true); const box = new THREE.Box3().setFromObject(node), size = box.getSize(new THREE.Vector3()); return new THREE.Vector3(Math.max(size.x,.05),Math.max(size.y,.05),Math.max(size.z,.05)); }
    async refreshLibrary() { try { const response = await fetch('/__model_library__',{cache:'no-store'}); if (!response.ok) throw new Error(`模型库请求失败（${response.status}）`); const data = await response.json(); this.library = Array.isArray(data.items) ? data.items.map(item => ({...item,kind:categoryKind(item.category)})) : []; return this.library; } catch (error) { this.library = []; return []; } }
    addUpload(file) { if (!file) return null; const url = URL.createObjectURL(file), ext=String(file.name||'').split('.').pop().toLowerCase(); if (!['glb','gltf'].includes(ext)) { this.uploads.push({id:`companion:${file.name}:${file.lastModified}`,name:file.name,url,file,companion:true}); return null; } const asset = {id:`upload:${file.name}:${file.lastModified}`,name:`上传 · ${file.name}`,category:'上传模型',kind:inferKind(file.name),url,upload:true,file}; this.uploads.push(asset); this.library.push(asset); return asset; }
    async loadAsset(asset) { if (!asset) throw new Error('请选择替换模型。'); const response = await fetch(asset.url); if (!response.ok) throw new Error(`无法读取替换模型（${response.status}）。`); const buffer = await response.arrayBuffer(); const manager = new THREE.LoadingManager(), uploaded = new Map(this.uploads.map(item => [item.file?.name?.toLowerCase(), item.url])); manager.setURLModifier(url => { const key = String(url).split(/[\\/]/).pop().toLowerCase(); return uploaded.get(key) || url; }); let basePath=''; try { const parsed = new URL(asset.url,location.href); basePath = parsed.href.slice(0,parsed.href.lastIndexOf('/')+1); } catch {} return await new Promise((resolve,reject) => new THREE.GLTFLoader(manager).parse(buffer,basePath,result => { const root = result.scene || result.scenes?.[0]; if (!root) return reject(new Error('替换模型没有可显示的场景。')); if (!asset.articulation?.joints?.length) { const embedded=[]; for (const node of result.parser?.json?.nodes || []) { const extra=node.extras?.joint || node.extras?.articulation; if (!extra) continue; embedded.push({name:extra.name || node.name || '',label:extra.label || node.name || '',type:extra.type || 'revolute',axis:extra.axis || extra.axis_gltf || null,lower:extra.lower,upper:extra.upper}); } if (embedded.length) asset.articulation={source:'glb-extras',joints:embedded}; } root.userData.replacementAsset = asset; root.userData.animationClips = result.animations || []; resolve({root,animations:result.animations || []}); }, reject)); }
    fitReplacement(root,target) { const size = target.originalSize || this.sizeOf(target.node), sourceBox = new THREE.Box3().setFromObject(root), sourceSize = sourceBox.getSize(new THREE.Vector3()); const scale = Math.max(.001,Math.min((size.x*.96)/Math.max(sourceSize.x,.001),(size.z*.96)/Math.max(sourceSize.z,.001),(size.y*1.15)/Math.max(sourceSize.y,.001))); root.scale.setScalar(scale); root.updateMatrixWorld(true); const fitted = new THREE.Box3().setFromObject(root), center = fitted.getCenter(new THREE.Vector3()); root.position.x -= center.x; root.position.z -= center.z; root.position.y -= fitted.min.y; root.updateMatrixWorld(true); }
    saveTarget(target) {
      if (this.history.has(target.key)) return this.history.get(target.key);
      // Keep the first world transform as the replacement anchor. Imported
      // USD/glTF furniture is often nested below scaled or rotated groups, so
      // copying position/rotation/scale alone can move or mirror the model.
      target.node.updateMatrixWorld?.(true);
      const originalBounds = target.originalBounds?.clone?.() || this.boundsOf(target);
      const originalCenter = originalBounds.isEmpty()
        ? target.node.getWorldPosition?.(new THREE.Vector3()) || new THREE.Vector3()
        : originalBounds.getCenter(new THREE.Vector3());
      // Replacement roots are fitted so their local X/Z center is at 0 and
      // their local floor is at Y=0. Use the source footprint center and
      // bottom as the world anchor, which also handles geometry-baked USDZ
      // transforms where the source node itself stays at the origin.
      const originalAnchorWorldPosition = originalBounds.isEmpty()
        ? originalCenter.clone()
        : new THREE.Vector3(originalCenter.x, originalBounds.min.y, originalCenter.z);
      const record = {
        target,
        semantic:target.semantic,
        node:target.node,
        originalChildren:target.semantic ? [...target.node.children] : null,
        originalVisible:target.node.visible,
        originalNodeStates:(target.nodes || [target.node]).map(node => ({node,visible:node.visible})),
        originalParent:target.node.parent,
        originalWorldMatrix:target.node.matrixWorld?.clone?.() || new THREE.Matrix4(),
        originalBounds,
        originalAnchorWorldPosition,
        originalPosition:target.node.position.clone(),
        originalRotation:target.node.rotation.clone(),
        originalScale:target.node.scale.clone(),
        current:null,
        mixer:null
      };
      this.history.set(target.key,record);
      return record;
    }
    articulationFor(asset) {
      const raw = Array.isArray(asset?.articulation) ? asset.articulation : asset?.articulation?.joints || asset?.joints || asset?.metadata?.joints;
      if (!Array.isArray(raw)) return [];
      return raw.map(item => ({...item, name:String(item.name || item.label || '')})).filter(item => item.name);
    }
    matchJointDefinition(joint, definitions) {
      const name = String(joint?.name || '').toLowerCase();
      return definitions.find(def => {
        const key = String(def.name || def.label || '').toLowerCase();
        return key && (key === name || key.includes(name) || name.includes(key));
      }) || null;
    }
    jointAxis(definition, joint) {
      const raw = definition?.axis || definition?.axis_gltf || definition?.axisThree;
      if (Array.isArray(raw) && raw.length >= 3) {
        const axis = new THREE.Vector3(Number(raw[0]) || 0, Number(raw[1]) || 0, Number(raw[2]) || 0);
        if (axis.lengthSq() > 1e-8) return axis.normalize();
      }
      const label = `${definition?.name || ''} ${definition?.label || ''} ${joint?.name || ''}`;
      return /drawer|slide|prismatic|抽屉|滑轨/i.test(label) ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    }
    jointMode(definition, joint) {
      const text = `${definition?.type || ''} ${definition?.jointType || ''} ${definition?.name || ''} ${definition?.label || ''} ${joint?.name || ''}`;
      return /prismatic|slider|slide|drawer|抽屉|滑动/i.test(text) ? 'prismatic' : 'revolute';
    }
    jointLimit(definition, joint, target) {
      const mode = this.jointMode(definition, joint);
      const lower = Number(definition?.lower);
      const upper = Number(definition?.upper);
      if (Number.isFinite(upper) && Number.isFinite(lower) && upper > lower) return {mode, lower, upper};
      if (mode === 'prismatic') {
        const size = target?.originalSize || new THREE.Vector3(1, 1, 1);
        return {mode, lower:0, upper:Math.max(.08, Math.min(.42, Math.max(size.x, size.y, size.z) * .32))};
      }
      const degrees = Number(definition?.limitDegrees || definition?.angleDegrees);
      return {mode, lower:0, upper:Number.isFinite(degrees) ? degrees * Math.PI / 180 : .65};
    }
    applyJointMotion(record, joint, progress) {
      const base = record.jointBase?.find(item => item.node === joint);
      if (!base) return;
      const definition = record.jointDefinitions?.find(item => item.node === joint)?.definition;
      const limit = this.jointLimit(definition, joint, record.target);
      const value = limit.lower + (limit.upper - limit.lower) * L.clamp(progress, 0, 1);
      const axis = this.jointAxis(definition, joint);
      if (limit.mode === 'prismatic') {
        joint.position.copy(base.position).addScaledVector(axis, value);
        joint.quaternion.copy(base.quaternion);
      } else {
        joint.position.copy(base.position);
        joint.quaternion.copy(base.quaternion);
        joint.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, value));
      }
      joint.updateMatrixWorld?.(true);
    }
    articulatedDestinations() {
      const destinations = [];
      for (const record of this.history.values()) {
        if (!record?.current || (!record.joints?.length && !record.animations?.length) || !record.target) continue;
        const current = record.current;
        current.updateMatrixWorld?.(true);
        const box = new THREE.Box3().setFromObject(current);
        if (box.isEmpty()) continue;
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const target = record.target;
        const key = `articulated:${target.key}`;
        if (destinations.some(item => item.id === key)) continue;
        destinations.push({
          id: key,
          semanticId: target.id,
          name: `操作 · ${target.name}`,
          kind: target.kind || 'furniture',
          x: center.x,
          z: center.z,
          w: Math.max(.12, size.x),
          d: Math.max(.12, size.z),
          source: 'articulated-furniture',
          sourceLabel: '可动家具 · 自动添加',
          furnitureTarget: target.key,
          interaction: 'nearby-agent',
          joints: record.joints.map(joint => joint.name).filter(Boolean),
          animations: (record.animations || []).map(clip => clip.name).filter(Boolean)
        });
      }
      return destinations;
    }
    notifyWorkbench() {
      const workbench = L.app?.workbench;
      workbench?.invalidate?.();
      workbench?.renderQueue?.();
    }
    async replace(targetOrKey,asset) {
      const target = typeof targetOrKey === 'string' ? this.targets.find(t => t.key === targetOrKey || t.id === targetOrKey) : targetOrKey; if (!target) throw new Error('没有识别到可替换的家具。');
      const record = this.saveTarget(target), loaded = await this.loadAsset(asset), root = loaded.root; this.fitReplacement(root,target);
      if (record.current) { this.mixers.forEach(m => { if (m.getRoot?.() === record.current) { m.stopAllAction?.(); this.mixers.delete(m); } }); record.mixer = null; record.animations = []; record.animationAction = null; disposeObject(record.current); }
      if (record.anchor?.parent) record.anchor.parent.remove(record.anchor);
      record.anchor = null;
      if (record.dynamicBody) { record.dynamicBody.removed = true; record.dynamicBody = null; }
      root.userData.replacementTargetKey = target.key;
      if (target.semantic) {
        while (target.node.children.length) target.node.remove(target.node.children[0]);
        target.node.add(root);
      } else {
        for (const node of target.nodes || [target.node]) node.visible = false;
        const parent = record.originalParent || target.node.parent || this.model.group;
        parent.updateMatrixWorld?.(true);
        const anchor = new THREE.Group();
        anchor.name = `替换 · ${target.name}`;
        anchor.userData.replacementTargetKey = target.key;
        // Convert the original world matrix back into the chosen parent's
        // local space. This preserves the exact scene position, orientation,
        // and inherited scale even when the furniture has transformed parents.
        const anchorWorldMatrix = (record.originalWorldMatrix || target.node.matrixWorld).clone();
        anchorWorldMatrix.setPosition(record.originalAnchorWorldPosition || target.node.getWorldPosition?.(new THREE.Vector3()) || new THREE.Vector3());
        const localMatrix = new THREE.Matrix4()
          .copy(parent.matrixWorld)
          .invert()
          .multiply(anchorWorldMatrix);
        localMatrix.decompose(anchor.position,anchor.quaternion,anchor.scale);
        parent.add(anchor);
        anchor.add(root);
        record.anchor = anchor;
      }
      record.current = root; record.asset = asset;
      const definitions = this.articulationFor(asset), matched = [], nodes = [];
      root.traverse(o => nodes.push(o));
      // Resolve one scene node per sidecar joint. A fuzzy name match can
      // otherwise select both `drawer_1_joint` and its `drawer_1` mesh,
      // causing the same drawer to be transformed twice.
      const usedNodes = new Set();
      for (const definition of definitions) {
        const wanted = String(definition.name || definition.label || '').toLowerCase();
        let node = nodes.find(candidate => !usedNodes.has(candidate) && String(candidate.name || '').toLowerCase() === wanted);
        if (!node) node = nodes.find(candidate => !usedNodes.has(candidate) && this.matchJointDefinition(candidate,[definition]));
        if (node) { matched.push({node, definition}); usedNodes.add(node); }
      }
      // Prefer the explicit joint nodes from the sidecar metadata. This keeps
      // drawer panels and door meshes attached to one joint instead of moving
      // every child mesh that happens to contain “drawer” or “door” in its name.
      if (matched.length) record.jointDefinitions = matched;
      else {
        record.jointDefinitions = [];
        root.traverse(o => {
          if (o.isBone || /(?:joint|hinge|axis|关节|骨骼)(?:$|[_-])/i.test(o.name || '')) record.jointDefinitions.push({node:o,definition:null});
        });
      }
      record.joints = record.jointDefinitions.map(item => item.node);
      record.jointBase = record.joints.map(j => ({node:j,rotation:j.rotation.clone(),quaternion:j.quaternion.clone(),position:j.position.clone()}));
      if (loaded.animations.length) { const mixer = new THREE.AnimationMixer(root); record.mixer = mixer; record.animations = loaded.animations; this.mixers.add(mixer); root.userData.animationClips = loaded.animations; }
      // Articulated replacements use a conservative dynamic proxy for
      // navigation and contact feedback. Their meshes are excluded from the
      // static collision grid so the proxy is the single collision source.
      if (record.joints.length || loaded.animations.length) root.traverse(o => { if (o.isMesh) o.userData.ignoreCollision = true; });
      root.userData.replacement = {assetId:asset.id,category:asset.category,kind:asset.kind,joints:record.joints.map(j => j.name),animations:record.animations?.map(clip => clip.name).filter(Boolean)||[],interaction:'nearby-agent',articulation:record.jointDefinitions.map(item => ({name:item.node.name,type:item.definition?.type || this.jointMode(item.definition,item.node),axis:this.jointAxis(item.definition,item.node).toArray()}))};
      record.interactionProgress = 0;
      record.interactionState = 'closed';
      target.currentAsset = asset;
      this.notifyWorkbench();
      return record;
    }
    dynamicBodyFor(record) {
      if (!record?.current || (!record.joints?.length && !record.animations?.length) || !record.target) return null;
      const object = record.anchor || record.target.node;
      if (!object) return null;
      let body = record.dynamicBody;
      if (!body) {
        const world = object.getWorldPosition?.(new THREE.Vector3()) || new THREE.Vector3(object.position?.x || 0, object.position?.y || 0, object.position?.z || 0);
        body = record.dynamicBody = {id:`replacement:${record.target.key}`,name:record.target.name || '可动家具',kind:'dynamic_furniture',x:world.x,z:world.z,radius:.45,mass:22,friction:.86,pushable:true,object,record};
        body.sync = current => {
          const parent = object.parent;
          if (parent?.worldToLocal) {
            const worldY = object.getWorldPosition?.(new THREE.Vector3()).y || object.position.y || 0;
            const local = parent.worldToLocal(new THREE.Vector3(current.x, worldY, current.z));
            object.position.x = local.x; object.position.z = local.z;
          } else { object.position.x = current.x; object.position.z = current.z; }
        };
      }
      const box = new THREE.Box3().setFromObject(record.current), size = box.getSize(new THREE.Vector3());
      body.radius = Math.max(.22, Math.min(2.4, Math.hypot(size.x, size.z) * .5));
      body.name = record.target.name || body.name;
      return body;
    }
    dynamicBodies() { const bodies = []; for (const record of this.history.values()) { const body = this.dynamicBodyFor(record); if (body) bodies.push(body); } return bodies; }
    async randomize(kind) { this.scan(); const choices = this.library.filter(a => !kind || a.kind === kind); if (!choices.length) throw new Error(`模型库中暂时没有「${KIND_LABELS[kind] || kind || '家具'}」替换模型；可以先上传一个 GLB。`); const targets = this.targets.filter(t => !kind || t.kind === kind); if (!targets.length) throw new Error(`当前场景没有识别到「${KIND_LABELS[kind] || kind}」。`); let count = 0; for (const target of targets) { const sameKind=choices.filter(asset=>asset.kind===target.kind),pool=sameKind.length?sameKind:choices; const asset = pool[Math.floor(Math.random() * pool.length)]; await this.replace(target,asset); count++; } return count; }
    restore() { let count = 0; for (const record of this.history.values()) { const target = record.target; if (record.current) { disposeObject(record.current); record.current = null; } if (record.mixer) { record.mixer.stopAllAction(); this.mixers.delete(record.mixer); record.mixer = null; } if (record.dynamicBody) { record.dynamicBody.removed = true; record.dynamicBody = null; } record.animations = []; record.animationAction = null; if (record.semantic) { while (target.node.children.length) target.node.remove(target.node.children[0]); for (const child of record.originalChildren || []) target.node.add(child); target.node.visible = record.originalVisible; } else { if (record.anchor?.parent) record.anchor.parent.remove(record.anchor); for (const state of record.originalNodeStates || [{node:target.node,visible:record.originalVisible}]) state.node.visible = state.visible; } target.currentAsset = null; count++; } this.history.clear(); if (count) this.notifyWorkbench(); return count; }
    play(targetOrKey,clipName,enabled=true) { const target = typeof targetOrKey === 'string' ? this.targets.find(t => t.key === targetOrKey || t.id === targetOrKey) : targetOrKey, record = target && this.history.get(target.key); if (!record?.mixer) return false; const clip = (record.animations || []).find(c => !clipName || c.name === clipName) || record.animations?.[0]; if (!clip) return false; const action = record.mixer.clipAction(clip); enabled ? action.reset().play() : action.stop(); return true; }
    setJointMotion(targetOrKey, jointName, rotationY = 0, rotationX = 0, rotationZ = 0) { const target = typeof targetOrKey === 'string' ? this.targets.find(t => t.key === targetOrKey || t.id === targetOrKey) : targetOrKey, record = target && this.history.get(target.key); if (!record?.current) return false; const joint = (record.joints || []).find(j => j.name === jointName) || (record.joints || [])[0]; if (!joint) return false; joint.rotation.set(rotationX,rotationY,rotationZ); return true; }
    update(delta,agents=[]) {
      for (const mixer of this.mixers) mixer.update(delta);
      // Nearby residents can open an articulated replacement. This is a
      // lightweight interaction bridge for GLB bones/joints and animation
      // clips; the existing navigation grid still remains the collision source.
      for (const agent of agents || []) if (agent?.furnitureInteraction) agent.furnitureInteraction = null;
      const autoInteract = $('replace-auto-interact')?.checked !== false;
      for (const record of this.history.values()) {
        if (!record.current || (!record.joints?.length && !record.animations?.length) || !record.target?.node) continue;
        const box=new THREE.Box3().setFromObject(record.current),center=box.getCenter(new THREE.Vector3());
        const dynamicBody=this.dynamicBodyFor(record);
        if (dynamicBody) dynamicBody.radius=Math.max(.22,Math.min(2.4,Math.hypot(box.max.x-box.min.x,box.max.z-box.min.z)*.5));
        let closest=null,closestDistance=Infinity;
        for (const agent of agents || []) {
          if (!agent || agent.state === 'hidden' || agent.evacuated || agent.state === 'safe') continue;
          const dx=Math.max(box.min.x-agent.x,0,agent.x-box.max.x),dz=Math.max(box.min.z-agent.z,0,agent.z-box.max.z);
          const distance=Math.hypot(dx,dz);
          if (distance<closestDistance) { closestDistance=distance; closest=agent; }
        }
        const reach=Math.max(.45,Number(closest?.profile?.reach)||.55),near=!!closest && closestDistance<Math.max(1.05,reach+.45);
        const previousProgress = Number(record.interactionProgress) || 0;
        record.interactionProgress=L.clamp(previousProgress+((autoInteract&&near)?delta*2.8:-delta*1.8),0,1);
        if (record.joints?.length) {
          for (const joint of record.joints) this.applyJointMotion(record,joint,record.interactionProgress);
        } else if (record.mixer && record.animations?.length) {
          const clip = record.animations[0];
          const action = record.animationAction || (record.animationAction = record.mixer.clipAction(clip));
          action.setLoop?.(THREE.LoopOnce,1);
          action.clampWhenFinished = true;
          action.play();
          action.paused = true;
          action.time = L.clamp(record.interactionProgress,0,1) * Math.max(.001,clip.duration || 1);
          record.mixer.update(0);
        }
        // Capture the live articulated bounds after applying the joint. This
        // makes the interaction result inspectable instead of silently
        // changing the mesh while the navigation grid remains unchanged.
        record.current.updateMatrixWorld?.(true);
        const movedBox=new THREE.Box3().setFromObject(record.current);
        const moving=Math.abs(record.interactionProgress-previousProgress)>1e-4;
        let collisionAgent=null;
        for(const agent of agents||[]){
          if(!agent||agent.state==='hidden'||agent.evacuated||agent.state==='safe')continue;
          const radius=Math.max(.05,Number(agent.profile?.radius)||.25);
          const dx=Math.max(movedBox.min.x-agent.x,0,agent.x-movedBox.max.x);
          const dz=Math.max(movedBox.min.z-agent.z,0,agent.z-movedBox.max.z);
          if(Math.hypot(dx,dz)<=radius){collisionAgent=agent;break;}
        }
        record.interactingAgent=autoInteract&&near?closest.id:null;
        record.interactionDistance=Number.isFinite(closestDistance)?closestDistance:null;
        const collision=!!collisionAgent;
        const blocked=!!collisionAgent&&(collisionAgent.state==='blocked'||collisionAgent.lastConstraint?.collision?.obstacle?.id===dynamicBody?.id);
        const feedback={triggered:!!(autoInteract&&closest&&near),moving,motionApplied:moving&&(record.joints.length>0||!!record.animationAction),collision,blocked,agentId:closest?.id??null,collisionAgentId:collisionAgent?.id??null,distance:record.interactionDistance,state:record.interactionState};
        record.motionFeedback=feedback;
        const nextState = record.interactionProgress>.98 ? 'open' : record.interactionProgress>.02 ? (record.interactionProgress >= previousProgress ? 'opening' : 'closing') : 'closed';
        const previousState = record.interactionState;
        record.interactionState = nextState;
        if(record.motionFeedback)record.motionFeedback.state=nextState;
        record.current.userData.interactionState=nextState;
        record.current.userData.interactionAgent=record.interactingAgent;
        if (autoInteract&&closest&&near) {
          const currentInteraction = closest.furnitureInteraction;
          if (!currentInteraction || !Number.isFinite(currentInteraction.distance) || currentInteraction.distance > record.interactionDistance) {
            closest.furnitureInteraction={targetId:record.target.id,targetKey:record.target.key,name:record.target.name,state:nextState,progress:record.interactionProgress,distance:record.interactionDistance,joints:record.joints.length,animations:record.animations?.length||0,collision,blocked,motionApplied:feedback.motionApplied};
          }
        }
        const sim = L.app?.simulation;
        if (sim?.event && previousState && previousState !== nextState && closest) {
          const verb = nextState === 'open' || nextState === 'opening' ? '靠近并操作家具' : nextState === 'closing' ? '家具正在回位' : '家具已关闭';
          sim.event(closest,'furniture_interaction',verb,closest,{code:'furniture_interaction',furnitureId:record.target.id,furnitureName:record.target.name,state:nextState,distance:record.interactionDistance,collision:{furnitureId:record.target.id,name:record.target.name,articulated:true}});
        }
        if(sim?.event&&collision&&moving&&this._canEmitFurnitureCollision(record,sim.time)){
          sim.event(collisionAgent||closest,'furniture_interaction',`家具运动与人物包络重叠 · ${record.target.name}`,collisionAgent||closest,{code:'furniture_collision',furnitureId:record.target.id,furnitureName:record.target.name,state:nextState,distance:record.interactionDistance,collision:{furnitureId:record.target.id,name:record.target.name,articulated:true,agentOverlap:true},blocked});
        }
      }
    }
    _canEmitFurnitureCollision(record,time){const last=Number(record.lastCollisionEventAt);if(Number.isFinite(last)&&time-last<1)return false;record.lastCollisionEventAt=time;return true;}
  }
  L.ModelReplacementManager = ModelReplacementManager;
  L.inferFurnitureKind = inferKind;

  function attachUI() {
    if (!$('model-replace-controls') || !L.app || !L.ModelReplacementManager) return false;
    const manager = new ModelReplacementManager({state:() => ({model:L.app.model}),toast:(message,error=false) => { const node=$('toast'); if (!node) return; node.textContent=message; node.classList.toggle('error',error); node.hidden=false; clearTimeout(attachUI.toastTimer); attachUI.toastTimer=setTimeout(() => node.hidden=true,error?9000:4500); }}); L.modelReplacement = manager;
    const targetSelect=$('replace-target'),assetSelect=$('replace-asset'),assetList=$('replace-asset-list'),currentLabel=$('replace-current'),status=$('replace-status'),setStatus=text=>{if(status)status.textContent=text;};
    const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const previewUrl=asset=>asset?.preview||String(asset?.url||'').replace(/\/(?:model|articulated_pbr)\.glb(?:\?.*)?$/i,'/preview_closed.png');
    const renderTargets=()=>{manager.scan();if(!targetSelect)return;const previous=manager.selectedTargetKey||targetSelect.value,targets=manager.targets;targetSelect.innerHTML=targets.length?targets.map(t=>`<option value="${esc(t.key)}">${esc(t.label)}</option>`).join(''):'<option value="">当前模型没有匹配家具</option>';if(targets.some(t=>t.key===previous))targetSelect.value=previous;else{targetSelect.value='';manager.selectedTargetKey='';}};
    const renderAssets=(target=null)=>{
      if(!assetList||!assetSelect)return;
      const selected=target||manager.targets.find(t=>t.key===targetSelect?.value)||manager.targets.find(t=>t.key===manager.selectedTargetKey);
      if(!selected){assetSelect.innerHTML='<option value="">等待场景识别</option>';assetList.innerHTML='<div class="model-replace-empty">点击三维场景中的家具后显示相似模型。</div>';return;}
      const items=manager.library.filter(a=>a.kind===selected.kind),previous=assetSelect.value;
      assetSelect.innerHTML=items.length?items.map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join(''):'<option value="">暂无同类模型</option>';
      if(items.some(a=>a.id===previous))assetSelect.value=previous;
      assetList.innerHTML=items.length?items.map(asset=>`<button type="button" class="model-replace-card${asset.id===previous?' active':''}" data-asset="${esc(asset.id)}" role="listitem" title="点击替换为 ${esc(asset.name)}"><span class="model-replace-thumb"><img src="${esc(previewUrl(asset))}" alt="${esc(asset.name)} 缩略图" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="model-replace-thumb-fallback" hidden>3D</span></span><span class="model-replace-card-name">${esc(asset.name)}</span><small>${asset.articulation?.joints?.length?'可动关节 · 自动互动':'静态模型'}</small></button>`).join(''):'<div class="model-replace-empty">没有找到同类模型；当前场景对象仍保留，可换用其他场景或模型库。</div>';
    };
    manager.onTargetSelected=target=>{renderTargets();if(targetSelect)targetSelect.value=target.key;manager.selectedTargetKey=target.key;renderAssets(target);if(currentLabel)currentLabel.textContent=`当前家具：${target.label}`;const related=manager.library.filter(asset=>asset.kind===target.kind);setStatus(related.length?`已自动识别「${target.name}」，点击下方模型卡片即可替换。`:`已自动识别「${target.name}」；模型库暂无同类模型。`);};
    const rebuild=async()=>{const app=L.app;if(app?.install&&app.model)await app.install(app.model);};
    const replaceWithAsset=async asset=>{const target=manager.targets.find(t=>t.key===targetSelect?.value)||manager.targets.find(t=>t.key===manager.selectedTargetKey);if(!target||!asset){setStatus('请先点击场景中的家具。');return;}try{if(assetSelect)assetSelect.value=asset.id;setStatus(`正在载入「${asset.name}」…`);await manager.replace(target,asset);await rebuild();renderAssets(target);setStatus(`已将「${target.name}」替换为「${asset.name}」。${manager.history.get(target.key)?.joints?.length?'已保留可动关节，并会在人物靠近时自动互动。':''}`);}catch(error){setStatus(error.message);}};
    assetList?.addEventListener('click',event=>{const button=event.target.closest('[data-asset]');if(!button)return;const asset=manager.library.find(item=>item.id===button.dataset.asset);replaceWithAsset(asset);});
    targetSelect?.addEventListener('change',()=>{manager.selectedTargetKey=targetSelect.value;renderAssets();});
    $('replace-apply')?.addEventListener('click',async()=>{const asset=manager.library.find(a=>a.id===assetSelect?.value);await replaceWithAsset(asset);});
    $('replace-random')?.addEventListener('click',async()=>{try{const kind=$('replace-kind')?.value||'';setStatus('正在随机替换家具…');const count=await manager.randomize(kind);await rebuild();setStatus(`已随机替换 ${count} 个对象。`);}catch(error){setStatus(error.message);}});
    $('replace-restore')?.addEventListener('click',async()=>{const count=manager.restore();if(count)await rebuild();setStatus(count?`已还原 ${count} 个家具对象。`:'当前没有需要还原的替换。');});
    $('replace-joint-play')?.addEventListener('click',()=>{const ok=manager.play(targetSelect.value);setStatus(ok?'已播放替换模型的第一段动画。':'该模型没有可播放动画；可使用关节角度接口。');});
    manager.refreshLibrary().then(()=>{renderTargets();renderAssets();});renderTargets();renderAssets();let lastModel=null;setInterval(()=>{const current=L.app?.model;if(current!==lastModel){if(lastModel)manager.restore();lastModel=current;renderTargets();renderAssets();}},1000);return true;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',() => { if (!attachUI()) setTimeout(attachUI,300); }); else if (!attachUI()) setTimeout(attachUI,300);
})();
