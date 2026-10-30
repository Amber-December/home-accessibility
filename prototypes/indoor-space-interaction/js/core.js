/* Pure grid/navigation primitives. Coordinates and radii are always metres. */
(function (root) {
  'use strict';
  const L = root.IndoorLab = root.IndoorLab || {};
  L.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  L.PROFILES = {
    pedestrian: { name: '步行者', radius: .25, speed: 1.15, color: '#1ca7a0' },
    wheelchair: { name: '轮椅使用者', radius: .45, speed: .78, color: '#607ce0' },
    assisted: { name: '辅助器使用者', radius: .38, speed: .65, color: '#d39c53' }
  };
  class Heap {
    constructor() { this.items = []; }
    push(id, cost) { const a = this.items; let i = a.length; a.push({ id, cost }); while (i > 0) { const p = (i - 1) >> 1; if (a[p].cost <= cost) break; a[i] = a[p]; i = p; } a[i] = { id, cost }; }
    pop() { const a = this.items, first = a[0], last = a.pop(); if (a.length) { let i = 0; while (i * 2 + 1 < a.length) { let j = i * 2 + 1; if (j + 1 < a.length && a[j + 1].cost < a[j].cost) j++; if (a[j].cost >= last.cost) break; a[i] = a[j]; i = j; } a[i] = last; } return first; }
    get length() { return this.items.length; }
  }
  // Exact squared Euclidean distance transform (separable lower envelopes).
  function edt1d(f, n, d, v, z) {
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s;
      do { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * (q - p)); if (s <= z[k]) k--; else break; } while (k >= 0);
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const delta = q - v[k]; d[q] = delta * delta + f[v[k]]; }
  }
  class Grid {
    constructor(bounds, cell = .25) {
      this.minX = bounds.minX; this.minZ = bounds.minZ;
      this.cell = cell; this.cols = Math.ceil((bounds.maxX - bounds.minX) / cell); this.rows = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
      this.maxX = this.minX + this.cols * cell; this.maxZ = this.minZ + this.rows * cell;
      this.size = this.cols * this.rows;
      this.solid = new Uint8Array(this.size); this.support = new Uint8Array(this.size); this.support.fill(1);
      this.owner = new Uint32Array(this.size); this.obstacles = [{id:0,name:'模型边界 / 未识别障碍',kind:'boundary'}];
      this.distance = new Float32Array(this.size); this.heat = {}; this.resetHeat(); this.fields = new Map(); this.navs = new Map();
    }
    resetHeat() { for (const key of ['near', 'contact', 'blocked', 'obstruction', 'density']) this.heat[key] = new Float32Array(this.size); }
    index(x, z) { const c = Math.floor((x - this.minX) / this.cell), r = Math.floor((z - this.minZ) / this.cell); return c < 0 || r < 0 || c >= this.cols || r >= this.rows ? -1 : r * this.cols + c; }
    point(i) { return { x: this.minX + (i % this.cols + .5) * this.cell, z: this.minZ + (Math.floor(i / this.cols) + .5) * this.cell }; }
    blocked(i) { return i < 0 || i >= this.size || this.solid[i] || !this.support[i]; }
    finalize() {
      const n = Math.max(this.cols, this.rows), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), temp = new Float64Array(this.size);
      for (let r = 0; r < this.rows; r++) { for (let c = 0; c < this.cols; c++) f[c] = this.blocked(r * this.cols + c) ? 0 : 1e12; edt1d(f, this.cols, d, v, z); for (let c = 0; c < this.cols; c++) temp[r * this.cols + c] = d[c]; }
      for (let c = 0; c < this.cols; c++) { for (let r = 0; r < this.rows; r++) f[r] = temp[r * this.cols + c]; edt1d(f, this.rows, d, v, z); for (let r = 0; r < this.rows; r++) {
        const i = r * this.cols + c, p = this.point(i);
        this.distance[i] = Math.max(0, Math.min(Math.sqrt(d[r]) * this.cell - this.cell * Math.SQRT1_2, p.x - this.minX, this.maxX - p.x, p.z - this.minZ, this.maxZ - p.z));
      } }
      this.fields.clear(); this.navs.clear();
    }
    // Circle versus occupied cell squares; also prevents crossing unsupported edges.
    isClear(x, z, radius) {
      if (x - radius < this.minX || x + radius > this.maxX || z - radius < this.minZ || z + radius > this.maxZ) return false;
      const s = this.cell, c0 = Math.floor((x - radius - this.minX) / s), c1 = Math.floor((x + radius - this.minX) / s), r0 = Math.floor((z - radius - this.minZ) / s), r1 = Math.floor((z + radius - this.minZ) / s);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (this.blocked(r * this.cols + c)) {
        const dx = Math.max(this.minX + c * s - x, 0, x - (this.minX + (c + 1) * s)), dz = Math.max(this.minZ + r * s - z, 0, z - (this.minZ + (r + 1) * s));
        if (dx * dx + dz * dz < radius * radius + 1e-9) return false;
      }
      return true;
    }
    collisionAt(x,z,radius){
      const s=this.cell;let best=null;
      const accept=(i,px,pz,d,unsupported=false)=>{if(d>radius+1e-6||best&&d>=best.clearance)return;const obstacle=unsupported?{id:0,name:'地板支撑边缘',kind:'floor_edge'}:this.obstacles[this.owner[i]||0];best={cellIndex:i,point:{x:px,z:pz},clearance:d,requiredRadius:radius,obstacle};};
      for(let r=Math.floor((z-radius-this.minZ)/s);r<=Math.floor((z+radius-this.minZ)/s);r++)for(let c=Math.floor((x-radius-this.minX)/s);c<=Math.floor((x+radius-this.minX)/s);c++){
        if(c<0||r<0||c>=this.cols||r>=this.rows)continue;const i=r*this.cols+c;if(!this.blocked(i))continue;const px=L.clamp(x,this.minX+c*s,this.minX+(c+1)*s),pz=L.clamp(z,this.minZ+r*s,this.minZ+(r+1)*s);accept(i,px,pz,Math.hypot(x-px,z-pz),!this.support[i]);
      }
      for(const[px,pz,d]of [[this.minX,z,x-this.minX],[this.maxX,z,this.maxX-x],[x,this.minZ,z-this.minZ],[x,this.maxZ,this.maxZ-z]])if(d<radius&&(!best||d<best.clearance))best={cellIndex:-1,point:{x:px,z:pz},clearance:Math.max(0,d),requiredRadius:radius,obstacle:this.obstacles[0]};
      return best;
    }
    lineClear(a, b, radius) { const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (this.cell * .4)); for (let j = 0; j <= n; j++) { const t = n ? j / n : 0; if (!this.isClear(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, radius)) return false; } return true; }
    nav(radius) {
      if (this.navs.has(radius)) return this.navs.get(radius);
      const valid = new Uint8Array(this.size), component = new Int32Array(this.size); component.fill(-1); const free = [], queue = new Int32Array(this.size);
      for (let i = 0; i < this.size; i++) {const p=this.point(i);if (!this.blocked(i) && this.isClear(p.x,p.z,radius)) { valid[i] = 1; free.push(i); }}
      let count = 0;
      for (const start of free) if (component[start] < 0) {
        let head = 0, tail = 0; queue[tail++] = start; component[start] = count;
        while (head < tail) { const i = queue[head++]; this.neighbors(i, valid, j => { if (component[j] < 0) { component[j] = count; queue[tail++] = j; } }); }
        count++;
      }
      const sizes=new Int32Array(count);for(const i of free)sizes[component[i]]++;let largest=0;for(let c=1;c<count;c++)if(sizes[c]>sizes[largest])largest=c;
      const result = { valid, component, free, count, sizes, largest, mainFree:free.filter(i=>component[i]===largest) }; this.navs.set(radius, result); return result;
    }
    neighbors(i, valid, visit) {
      const col = i % this.cols, row = Math.floor(i / this.cols);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dz) || col + dx < 0 || col + dx >= this.cols || row + dz < 0 || row + dz >= this.rows) continue;
        const j = i + dz * this.cols + dx;
        if (!valid[j] || (dx && dz && (!valid[i + dx] || !valid[i + dz * this.cols]))) continue;
        visit(j, dx && dz ? Math.SQRT2 : 1);
      }
    }
    nearest(point, radius, componentId) {
      const nav = this.nav(radius); let best = -1, score = Infinity;
      for (const i of nav.free) { if (componentId !== undefined && nav.component[i] !== componentId) continue; const p = this.point(i), d = (p.x - point.x) ** 2 + (p.z - point.z) ** 2; if (d < score) { best = i; score = d; } }
      return best;
    }
    route(start, goal, radius) {
      const nav = this.nav(radius), si = this.nearest(start, radius); if (si < 0) return { path: [], reachable: false };
      const gi = this.nearest(goal, radius), component = nav.component[si], distanceToGoal = gi < 0 ? Infinity : Math.hypot(this.point(gi).x - goal.x, this.point(gi).z - goal.z);
      const reachable = gi >= 0 && nav.component[gi] === component && distanceToGoal < Math.max(this.cell * 1.5, .4);
      const end = reachable ? gi : this.nearest(goal, radius, component);
      const key = `${radius}:${end}`; let field = this.fields.get(key);
      if (!field) {
        const dist = new Float32Array(this.size), next = new Int32Array(this.size); dist.fill(Infinity); next.fill(-1); dist[end] = 0;
        const heap = new Heap(); heap.push(end, 0);
        while (heap.length) { const item = heap.pop(), i = item.id; if (item.cost > dist[i] + .0001) continue; this.neighbors(i, nav.valid, (j, cost) => { const nd = dist[i] + cost; if (nd < dist[j]) { dist[j] = nd; next[j] = i; heap.push(j, dist[j]); } }); }
        field = { next }; if (this.fields.size > 80) this.fields.clear(); this.fields.set(key, field);
      }
      const raw = []; let at = si; for (let step = 0; at >= 0 && step < this.size; step++) { raw.push(this.point(at)); if (at === end) break; at = field.next[at]; }
      const path = []; let anchor = start, cursor = 0;
      while (cursor < raw.length) { let far = cursor; while (far + 1 < raw.length && far - cursor < 30 && this.lineClear(anchor, raw[far + 1], radius + .035)) far++; path.push(raw[far]); anchor = raw[far]; cursor = far + 1; }
      return { path, reachable, endpoint: this.point(end) };
    }
    heatValue(i, mode) { return mode === 'access' ? this.heat.contact[i]+this.heat.obstruction[i] : mode === 'risk' ? this.heat.near[i] + 3 * this.heat.contact[i] + 8 * this.heat.blocked[i] : (this.heat[mode]?.[i] || 0); }
  }
  L.Grid = Grid; L.Heap = Heap;
  if (typeof module !== 'undefined') module.exports = L;
})(typeof window === 'undefined' ? globalThis : window);
