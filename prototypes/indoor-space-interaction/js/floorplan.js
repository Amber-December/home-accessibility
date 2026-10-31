/* Floor-plan raster blockout, furniture targets and a single-floor interior shell. */
(() => {
  'use strict';
  const L = window.IndoorLab;

  const material = (color, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({color, roughness: .76, metalness: .04, ...extra});
    m.color.convertSRGBToLinear();
    if (m.emissive) m.emissive.convertSRGBToLinear();
    return m;
  };
  const box = (parent, w, h, d, x, y, z, mat, name, data = {}) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(.02, w), Math.max(.02, h), Math.max(.02, d)), mat);
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; mesh.name = name || '平面图构件';
    Object.assign(mesh.userData, data); parent.add(mesh); return mesh;
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function groupRuns(values, predicate) {
    const out = []; let start = -1;
    for (let i = 0; i <= values.length; i++) {
      const hit = i < values.length && predicate(values[i]);
      if (hit && start < 0) start = i;
      if (!hit && start >= 0) { out.push([start, i - 1]); start = -1; }
    }
    return out;
  }

  function imagePixels(canvas) {
    const ctx = canvas.getContext('2d', {willReadFrequently: true}), image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const {data, width, height} = image;
    const dark = new Uint8Array(width * height), accent = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b), sat = max - min;
      dark[i] = max < 92 || (max < 135 && sat < 34) ? 1 : 0;
      accent[i] = sat > 32 && max < 240 && max > 45 ? 1 : 0;
    }
    return {width, height, dark, accent};
  }

  function detectWallSegments(pixels) {
    const {width, height, dark} = pixels, horizontal = [], vertical = [];
    const rowScore = new Float32Array(height), colScore = new Float32Array(width);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x; if (!dark[i]) continue; rowScore[y]++; colScore[x]++;
    }
    const rowBands = groupRuns(rowScore, v => v > width * .08);
    const colBands = groupRuns(colScore, v => v > height * .08);
    const minRun = Math.max(14, Math.round(Math.min(width, height) * .025));
    for (const [y0, y1] of rowBands) {
      const score = new Uint16Array(width);
      for (let y = y0; y <= y1; y++) for (let x = 0; x < width; x++) score[x] += dark[y * width + x];
      for (const [x0, x1] of groupRuns(score, v => v >= Math.max(1, Math.ceil((y1 - y0 + 1) * .45)))) if (x1 - x0 + 1 >= minRun) horizontal.push({x0, x1, y0, y1});
    }
    for (const [x0, x1] of colBands) {
      const score = new Uint16Array(height);
      for (let x = x0; x <= x1; x++) for (let y = 0; y < height; y++) score[y] += dark[y * width + x];
      for (const [y0, y1] of groupRuns(score, v => v >= Math.max(1, Math.ceil((x1 - x0 + 1) * .45)))) if (y1 - y0 + 1 >= minRun) vertical.push({x0, x1, y0, y1});
    }
    const keep = segments => segments.filter(s => Math.max(s.x1 - s.x0 + 1, s.y1 - s.y0 + 1) >= minRun * 1.2);
    return {horizontal: keep(horizontal), vertical: keep(vertical)};
  }

  function detectFurnitureTargets(pixels) {
    const {width, height, dark, accent} = pixels, step = Math.max(3, Math.round(Math.min(width, height) / 220));
    const cols = Math.ceil(width / step), rows = Math.ceil(height / step), mark = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let darkCount = 0, accentCount = 0, total = 0;
      for (let y = r * step; y < Math.min(height, (r + 1) * step); y++) for (let x = c * step; x < Math.min(width, (c + 1) * step); x++) {
        const i = y * width + x; darkCount += dark[i]; accentCount += accent[i]; total++;
      }
      const ratio = darkCount / Math.max(1, total), ar = accentCount / Math.max(1, total);
      // Furniture in the supplied drawings creates compact dark/coloured islands;
      // large wall bands and plain floor tiles are filtered out by these bounds.
      if ((ratio > .055 && ratio < .58) || ar > .16) mark[r * cols + c] = 1;
    }
    const seen = new Uint8Array(mark.length), boxes = [];
    for (let start = 0; start < mark.length; start++) if (mark[start] && !seen[start]) {
      const queue = [start]; seen[start] = 1; let minC = start % cols, maxC = minC, minR = Math.floor(start / cols), maxR = minR, count = 0;
      while (queue.length) {
        const id = queue.pop(), c = id % cols, r = Math.floor(id / cols); count++; minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nc = c + dc, nr = r + dr, ni = nr * cols + nc; if (nc >= 0 && nr >= 0 && nc < cols && nr < rows && mark[ni] && !seen[ni]) { seen[ni] = 1; queue.push(ni); } }
      }
      const w = (maxC - minC + 1) * step, h = (maxR - minR + 1) * step;
      if (count >= 3 && w >= 10 && h >= 10 && w * h >= Math.min(width * height * .00035, 900)) boxes.push({x0:minC * step, x1:Math.min(width - 1, (maxC + 1) * step), y0:minR * step, y1:Math.min(height - 1, (maxR + 1) * step), area:w * h});
    }
    boxes.sort((a, b) => b.area - a.area);
    const selected = [];
    for (const b of boxes) {
      const overlap = selected.some(a => !(b.x1 < a.x0 || b.x0 > a.x1 || b.y1 < a.y0 || b.y0 > a.y1));
      if (overlap) continue;
      selected.push(b); if (selected.length >= 14) break;
    }
    return selected.map((b, index) => {
      const w = b.x1 - b.x0, h = b.y1 - b.y0, aspect = w / Math.max(1, h);
      const type = aspect > 2.1 ? 'sofa / 床' : aspect > 1.35 ? '桌 / 台面' : aspect < .52 ? '柜体' : w * h < 900 ? '椅子' : '家具';
      return {...b, id:`fp-${index + 1}`, type, name:`平面图家具 ${index + 1} · ${type}`};
    });
  }

  function cropData(canvas, target, padding = 12) {
    const x = clamp(target.x0 - padding, 0, canvas.width - 1), y = clamp(target.y0 - padding, 0, canvas.height - 1);
    const w = clamp(target.x1 - target.x0 + padding * 2, 4, canvas.width - x), h = clamp(target.y1 - target.y0 + padding * 2, 4, canvas.height - y);
    const crop = document.createElement('canvas'); crop.width = w; crop.height = h; crop.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
    return crop.toDataURL('image/png');
  }

  function addWall(group, x, z, w, d, y, name, dynamic = false) {
    const wall = box(group, w, 2.8, d, x, y + 1.4, z, material('#ece9df'), name, {wall:true, collisionInfo:{name, kind:'wall'}});
    wall.userData.wall = true; wall.userData.ignoreCollision = dynamic; return wall;
  }

  function createProxy(group, target, x, z, width, depth, y = 0, bodyList = []) {
    const color = target.type.includes('柜') ? '#645e5a' : target.type.includes('椅') ? '#a87957' : target.type.includes('床') ? '#a8998d' : '#7d8f9e';
    const mesh = box(group, width, Math.min(1.05, Math.max(.42, depth * .45)), depth, x, y + Math.min(1.05, Math.max(.42, depth * .45)) / 2, z, material(color), target.name, {ignoreCollision:true, generatedProxy:true});
    const body = {id:target.id, name:target.name, x, z, radius:Math.max(.22, Math.hypot(width, depth) * .5), width, depth, mass:Math.max(8, width * depth * 45), friction:.86, pushable:true, object:mesh, target};
    bodyList.push(body); mesh.userData.dynamicBody = body; return body;
  }

  function worldPoint(px, py, width, height, metersPerPixel) { return {x:(px - width / 2) * metersPerPixel, z:(py - height / 2) * metersPerPixel}; }

  function buildScene({canvas, name='平面图住宅', widthMeters=12} = {}) {
    if (!canvas) throw new Error('缺少平面图图像');
    const pixels = imagePixels(canvas), segments = detectWallSegments(pixels), targets = detectFurnitureTargets(pixels);
    const metersPerPixel = widthMeters / canvas.width, width = canvas.width * metersPerPixel, depth = canvas.height * metersPerPixel, group = new THREE.Group(), dynamicBodies = [];
    const floorMat = material('#d7d1c7', {roughness:.88});
    const floor = box(group, width, .12, depth, 0, -.06, 0, floorMat, '平面图地板', {floor:true});
    floor.userData.floor = true;
    for (const s of segments.horizontal) { const p0 = worldPoint((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, canvas.width, canvas.height, metersPerPixel); addWall(group, p0.x, p0.z, Math.max(.08, (s.x1 - s.x0 + 1) * metersPerPixel), Math.max(.09, (s.y1 - s.y0 + 1) * metersPerPixel), 0, '平面图横墙'); }
    for (const s of segments.vertical) { const p0 = worldPoint((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, canvas.width, canvas.height, metersPerPixel); addWall(group, p0.x, p0.z, Math.max(.09, (s.x1 - s.x0 + 1) * metersPerPixel), Math.max(.08, (s.y1 - s.y0 + 1) * metersPerPixel), 0, '平面图竖墙'); }
    // Furniture proxies stay outside the static collision raster so agents can push them.
    for (const target of targets) {
      const p = worldPoint((target.x0 + target.x1) / 2, (target.y0 + target.y1) / 2, canvas.width, canvas.height, metersPerPixel);
      const fw = clamp((target.x1 - target.x0) * metersPerPixel, .42, 2.8), fd = clamp((target.y1 - target.y0) * metersPerPixel, .42, 2.2);
      target.x = p.x; target.z = p.z; target.width = fw; target.depth = fd; target.crop = cropData(canvas, target); createProxy(group, target, p.x, p.z, fw, fd, 0, dynamicBodies);
    }
    const bounds = {minX:-width/2, maxX:width/2, minZ:-depth/2, maxZ:depth/2};
    const goals = [{id:1,name:'入口 / 集合点',x:0,z:depth/2-.45},{id:2,name:'客厅中心',x:-width*.15,z:depth*.05},{id:3,name:'空间中心',x:width*.28,z:-depth*.12}];
    return {group, bounds, goals, name, demo:false, source:{type:'floorplan',floors:1,widthMeters,width,depth,wallSegments:segments.horizontal.length+segments.vertical.length}, dynamicBodies, furnitureTargets:targets, floorplan:{canvas,width:canvas.width,height:canvas.height,metersPerPixel,segments}};
  }

  L.FloorplanBuilder = {buildScene, analyze: imagePixels, cropData};
})();
