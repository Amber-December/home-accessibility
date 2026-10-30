/* Geometry -> a conservative horizontal occupancy slice; never one whole-model AABB. */
(() => {
  'use strict'; const L = window.IndoorLab;
  function clip(poly, height, greater) {
    const out = []; if (!poly.length) return out; let a = poly[poly.length - 1], inside = greater ? a.y >= height : a.y <= height;
    for (const b of poly) { const next = greater ? b.y >= height : b.y <= height; if (inside !== next) { const t = (height - a.y) / (b.y - a.y); out.push(new THREE.Vector3(a.x + (b.x - a.x) * t, height, a.z + (b.z - a.z) * t)); } if (next) out.push(b); a = b; inside = next; } return out;
  }
  function pointInTriangle(x, z, a, b, c) {
    const cross = (p, q) => (q.x - p.x) * (z - p.z) - (q.z - p.z) * (x - p.x);
    const u = cross(a, b), v = cross(b, c), w = cross(c, a);
    return !((u < -1e-9 || v < -1e-9 || w < -1e-9) && (u > 1e-9 || v > 1e-9 || w > 1e-9));
  }
  function segmentHitsRect(a, b, x0, z0, x1, z1) {
    let lo = 0, hi = 1; const dx = b.x - a.x, dz = b.z - a.z;
    for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dz, a.z - z0], [dz, z1 - a.z]]) { if (Math.abs(p) < 1e-12) { if (q < 0) return false; } else { const t = q / p; if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t); if (lo > hi) return false; } } return true;
  }
  function raster(grid, a, b, c, target, owner=0) {
    const s = grid.cell, c0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - grid.minX) / s)), c1 = Math.min(grid.cols - 1, Math.floor((Math.max(a.x, b.x, c.x) - grid.minX) / s)), r0 = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - grid.minZ) / s)), r1 = Math.min(grid.rows - 1, Math.floor((Math.max(a.z, b.z, c.z) - grid.minZ) / s));
    const area = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    for (let r = r0; r <= r1; r++) for (let col = c0; col <= c1; col++) {
      const i = r * grid.cols + col; if (target[i]) continue;
      const x = grid.minX + col * s, z = grid.minZ + r * s;
      if ((area > 1e-10 && [[x, z], [x + s, z], [x, z + s], [x + s / 2, z + s / 2], [x + s, z + s]].some(p => pointInTriangle(...p, a, b, c))) || segmentHitsRect(a, b, x, z, x + s, z + s) || segmentHitsRect(b, c, x, z, x + s, z + s) || segmentHitsRect(c, a, x, z, x + s, z + s)){target[i] = 1;if(owner)grid.owner[i]=owner;}
    }
  }
  function eachTriangle(group, visit) {
    group.updateMatrixWorld(true); const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    group.traverse(mesh => {
      if (!mesh.isMesh || mesh.userData.ignoreCollision) return;
      const geo = mesh.geometry, pos = geo.attributes.position, idx = geo.index; if (!pos) return;
      const count = idx ? idx.count : pos.count, transforms = mesh.isInstancedMesh ? mesh.count : 1, inst = new THREE.Matrix4(), world = new THREE.Matrix4();
      for (let n = 0; n < transforms; n++) {
        if (mesh.isInstancedMesh) { mesh.getMatrixAt(n, inst); world.multiplyMatrices(mesh.matrixWorld, inst); } else world.copy(mesh.matrixWorld);
        for (let j = 0; j + 2 < count; j += 3) { a.fromBufferAttribute(pos, idx ? idx.getX(j) : j).applyMatrix4(world); b.fromBufferAttribute(pos, idx ? idx.getX(j + 1) : j + 1).applyMatrix4(world); c.fromBufferAttribute(pos, idx ? idx.getX(j + 2) : j + 2).applyMatrix4(world); if ([a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z].every(Number.isFinite)) visit(a, b, c, mesh, n); }
      }
    });
  }
  L.eachTriangle = eachTriangle;
  L.estimateFloor = group => {
    const bounds = new THREE.Box3().setFromObject(group), bins = new Map(), limit = bounds.min.y + Math.min(.5, (bounds.max.y - bounds.min.y) * .18), normal = new THREE.Vector3(), edge = new THREE.Vector3();
    eachTriangle(group, (a, b, c) => { normal.subVectors(b, a).cross(edge.subVectors(c, a)); const area = normal.length() / 2, y = (a.y + b.y + c.y) / 3;
      if (area > .01 && Math.abs(normal.y) > normal.length() * .97 && y <= limit) { const key = Math.round(y / .02); bins.set(key, (bins.get(key) || 0) + area); }
    });
    const sorted = [...bins].sort((a, b) => b[1] - a[1]); if (!sorted.length) return bounds.min.y;
    const candidate = sorted.filter(p => p[1] >= sorted[0][1] * .6).sort((a, b) => b[0] - a[0])[0]; return candidate[0] * .02;
  };
  L.buildGrid = async (group, bounds, requestedCell, progress) => {
    let cell = requestedCell; const area = (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ); if (area / cell ** 2 > 200000) cell = Math.ceil(Math.sqrt(area / 190000) * 100) / 100;
    const grid = new L.Grid(bounds, cell), floor = new Uint8Array(grid.size); let triangles = 0, projected = 0, floorCount = 0;
    progress?.('正在提取人体高度范围内的碰撞体…'); await new Promise(resolve => setTimeout(resolve, 30));
    const owners=new Map();
    eachTriangle(group, (a, b, c,mesh,instance) => {
      triangles++; const ymin = Math.min(a.y, b.y, c.y), ymax = Math.max(a.y, b.y, c.y);
      if (ymax < .08 && ymin > -.14 && ymax - ymin < .035) { raster(grid, a, b, c, floor); floorCount++; }
      if (ymax < .08 || ymin > 1.8) return;
      const ownerKey=mesh.uuid+':'+instance;let owner=owners.get(ownerKey);if(!owner){owner=grid.obstacles.length;const info=mesh.userData.instanceMetadata?.[instance]||mesh.userData.collisionInfo||{};grid.obstacles.push({id:owner,name:info.name||mesh.name||'未命名模型网格',kind:info.kind||(mesh.userData.wall?'wall':'model'),semanticId:info.semanticId,openingWidth:info.openingWidth,meshName:mesh.name||'',instance:mesh.isInstancedMesh?instance:undefined});owners.set(ownerKey,owner);}
      const poly = clip(clip([a, b, c], .08, true), 1.8, false);
      for (let k = 1; k + 1 < poly.length; k++) { raster(grid, poly[0], poly[k], poly[k + 1], grid.solid,owner); projected++; }
    });
    // Fill only small enclosed voids (hollow furniture), never flood-fill a room.
    const seen = new Uint8Array(grid.size), queue = new Int32Array(grid.size);
    for (let start = 0; start < grid.size; start++) if (!grid.solid[start] && !seen[start]) {
      let h = 0, t = 0, edge = false; queue[t++] = start; seen[start] = 1;
      while (h < t) { const i = queue[h++], x = i % grid.cols, z = Math.floor(i / grid.cols); if (!x || !z || x === grid.cols - 1 || z === grid.rows - 1) edge = true;
        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) { if (x + dx < 0 || x + dx >= grid.cols || z + dz < 0 || z + dz >= grid.rows) continue; const j = i + dx + dz * grid.cols; if (!seen[j] && !grid.solid[j]) { seen[j] = 1; queue[t++] = j; } }
      }
      if (!edge && t * cell * cell < 2){let owner=0;for(let j=0;j<t&&!owner;j++)for(const delta of [-1,1,-grid.cols,grid.cols])owner=owner||grid.owner[queue[j]+delta]||0;for (let j = 0; j < t; j++){grid.solid[queue[j]] = 1;grid.owner[queue[j]]=owner;}}
    }
    const supported = floor.reduce((sum, v) => sum + v, 0), hasFloor = supported * cell ** 2 > area * .12;
    if (hasFloor) grid.support.set(floor);
    progress?.('正在构建不同身体尺度的通行场…'); await new Promise(resolve => setTimeout(resolve, 20));
    grid.finalize(); for (const p of Object.values(L.PROFILES)) grid.nav(p.radius);
    grid.meta = { triangles, projected, hasFloor, floorTriangles: floorCount, requestedCell, actualCell: cell, smallVoidFillLimitM2: 2, collisionHeight: [.08, 1.8] };
    return grid;
  };
})();
