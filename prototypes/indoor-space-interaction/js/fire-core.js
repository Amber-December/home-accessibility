/* Deterministic, horizontal fire / smoke field for the indoor accessibility grid. */
(function (root, factory) {
  'use strict';
  const target = root.IndoorLab = root.IndoorLab || {};
  const api = factory(target);
  Object.assign(target, api);
  if (typeof module !== 'undefined') module.exports = target;
})(typeof window === 'undefined' ? globalThis : window, function (L) {
  'use strict';

  const DEFAULTS = {
    ambientTemperature: 20,
    ignitionTemperature: 140,
    spreadTemperature: 78,
    heatCriticalTemperature: 180,
    heatBlockTemperature: 280,
    conductivity: .22,
    cooling: .012,
    fireHeat: 165,
    burnRate: .075,
    fireSmoke: .24,
    smokeDiffusion: .34,
    smokeAdvection: .42,
    smokeDecay: .004,
    ceilingRise: .12,
    ceilingDiffusion: .65,
    maximumTemperature: 1080,
    smokeWarning: .12,
    smokeCritical: .55,
    smokeBlock: .92,
    flameWarning: .08,
    flameCritical: .35,
    flameBlock: .82,
    riskWeight: 1,
    heatExposureRate: .9,
    smokeExposureRate: .65,
    defaultFuel: 1,
    ignitionFlame: .9,
    sourcePower: 220,
    sourceSmoke: .32,
    sourceFlame: 1,
    maxDt: .25,
    fieldInterval: 1 / 15,
    seed: 21879,
    wind: { x: 0, z: 0 }
  };

  class MinHeap {
    constructor() { this.items = []; }
    push(id, cost) {
      const a = this.items; let i = a.length; const item = { id, cost }; a.push(item);
      while (i > 0) { const p = (i - 1) >> 1; if (a[p].cost <= cost) break; a[i] = a[p]; i = p; }
      a[i] = item;
    }
    pop() {
      const a = this.items, first = a[0], last = a.pop();
      if (a.length && last) { let i = 0; while (i * 2 + 1 < a.length) { let j = i * 2 + 1; if (j + 1 < a.length && a[j + 1].cost < a[j].cost) j++; if (a[j].cost >= last.cost) break; a[i] = a[j]; i = j; } a[i] = last; }
      return first;
    }
    get length() { return this.items.length; }
  }

  const finite = value => Number.isFinite(value) ? value : 0;
  const clamp01 = value => Math.max(0, Math.min(1, finite(value)));

  class FireModel {
    constructor(grid, settings = {}) {
      if (!grid || !Number.isInteger(grid.size)) throw new Error('FireModel 需要 IndoorLab.Grid。');
      this.grid = grid;
      this.settings = { ...DEFAULTS, ...settings, wind: { ...DEFAULTS.wind, ...(settings.wind || {}) } };
      this.size = grid.size;
      this.seed = (this.settings.seed >>> 0) || 1;
      this.time = 0;
      this.sources = [];
      this.exits = [];
      this.events = [];
      this.reset();
    }

    random() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }

    reset() {
      const s = this.settings, n = this.size;
      this.time = 0; this.seed = (s.seed >>> 0) || 1; this.events = []; this.sources = []; this.exits = []; this._lastEscapeBuild = -Infinity; this._fieldAccumulator = 0; this.fieldVersion = 0;
      this.temperature = new Float32Array(n); this.temperature.fill(s.ambientTemperature);
      this.smoke = new Float32Array(n);
      this.ceilingSmoke = new Float32Array(n);
      this.flame = new Float32Array(n);
      this.fuel = new Float32Array(n);
      this.burned = new Uint8Array(n);
      this.exposure = new Float32Array(n);
      this.risk = new Float32Array(n);
      this.ignitionTime = new Float32Array(n); this.ignitionTime.fill(-1);
      this.ignitionParent = new Int32Array(n); this.ignitionParent.fill(-1);
      this.exitDistance = new Float32Array(n); this.exitDistance.fill(Infinity);
      for (let i = 0; i < n; i++) if (!this.grid.blocked(i)) this.fuel[i] = Math.max(0, finite(s.defaultFuel));
      this._updateRisk();
    }

    // Material fuel is projected to accessible cells bordering furniture. Open
    // circulation space can transmit smoke and heat without becoming fuel.
    setFuelMap(values) {
      if (!values || values.length !== this.size) throw new Error('Fuel map must match the navigation grid.');
      for (let i = 0; i < this.size; i++) this.fuel[i] = this.grid.blocked(i) ? 0 : Math.max(0, finite(values[i]));
      this.sceneFuel = true;
      for (const source of this.sources) this._seedSourceFuel(source.cell);
      return this;
    }

    _seedSourceFuel(cell) {
      const p = this.grid.point(cell), reach = Math.max(this.grid.cell * 2, .48);
      for (let i = 0; i < this.size; i++) {
        if (this.grid.blocked(i)) continue;
        const q = this.grid.point(i), d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d <= reach && this.grid.lineClear(p, q, .01)) this.fuel[i] = Math.max(this.fuel[i], 1.1 * (1 - .4 * d / reach));
      }
    }

    _cell(value) {
      if (Number.isInteger(value) && value >= 0 && value < this.size) return value;
      if (value && Number.isFinite(value.x) && Number.isFinite(value.z)) {
        // Agent queries already carry world coordinates. Convert directly to
        // a grid cell; a full nearest-cell scan here used to run once per
        // agent per simulation step and dominated evacuation performance.
        const direct = this.grid.index(value.x, value.z);
        if (direct >= 0) {
          const center = this.grid.point(direct), half = this.grid.cell * .46;
          if (Math.abs(value.x - center.x) <= half && Math.abs(value.z - center.z) <= half && !this.grid.blocked(direct)) return direct;
        }
        const nearest = this.grid.nearest({ x: value.x, z: value.z }, 0);
        return nearest >= 0 ? nearest : -1;
      }
      return -1;
    }

    _neighborCells(i, visit) {
      const valid = this._validCells || (this._validCells = Uint8Array.from({ length: this.size }, (_, j) => this.grid.blocked(j) ? 0 : 1));
      const col = i % this.grid.cols, row = Math.floor(i / this.grid.cols), cols = this.grid.cols, rows = this.grid.rows;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dz) || col + dx < 0 || col + dx >= cols || row + dz < 0 || row + dz >= rows) continue;
        const j = i + dz * cols + dx;
        if (!valid[j] || (dx && dz && (!valid[i + dx] || !valid[i + dz * cols]))) continue;
        visit(j, dx && dz ? Math.SQRT2 : 1);
      }
    }

    _nearestFree(point) {
      if (Number.isInteger(point)) return this.grid.blocked(point) ? -1 : point;
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return -1;
      let best = -1, score = Infinity;
      for (let i = 0; i < this.size; i++) if (!this.grid.blocked(i)) { const p = this.grid.point(i), d = (p.x - point.x) ** 2 + (p.z - point.z) ** 2; if (d < score) { score = d; best = i; } }
      return best;
    }

    addSource(source) {
      const input = typeof source === 'number' ? { cell: source } : (source || {});
      const cell = this._nearestFree(input.cell ?? input.index ?? input);
      if (cell < 0) throw new Error('火源必须位于有地板支撑且未被占据的栅格。');
      const item = { cell, power: finite(input.power) || this.settings.sourcePower, smoke: finite(input.smoke) || this.settings.sourceSmoke, flame: clamp01(input.flame ?? this.settings.sourceFlame), active: input.active !== false, persistent: input.persistent !== false, name: input.name || `火源 ${this.sources.length + 1}` };
      this.sources.push(item);
      this._seedSourceFuel(cell);
      this._ignite(cell, -1, 0);
      return item;
    }

    removeSource(source) {
      const cell = this._cell(typeof source === 'object' ? (source.cell ?? source.index ?? source) : source);
      const before = this.sources.length; this.sources = this.sources.filter(item => item.cell !== cell); return before !== this.sources.length;
    }

    setWind(wind = {}) { this.settings.wind = { ...this.settings.wind, x: finite(wind.x), z: finite(wind.z) }; return this.settings.wind; }

    _ignite(cell, parent = -1, time = this.time) {
      if (cell < 0 || this.grid.blocked(cell) || this.fuel[cell] <= 0) return false;
      if (this.ignitionTime[cell] < 0) { this.ignitionTime[cell] = time; this.ignitionParent[cell] = parent; }
      this.flame[cell] = Math.max(this.flame[cell], this.settings.ignitionFlame);
      return true;
    }

    _updateRisk() {
      const s = this.settings, ambient = s.ambientTemperature;
      for (let i = 0; i < this.size; i++) {
        if (this.grid.blocked(i)) { this.risk[i] = 0; continue; }
        const heat = clamp01((this.temperature[i] - ambient - (s.heatCriticalTemperature - ambient) * .2) / Math.max(.001, s.heatCriticalTemperature - ambient));
        const smoke = clamp01((this.smoke[i] - s.smokeWarning) / Math.max(.001, s.smokeCritical - s.smokeWarning));
        this.risk[i] = clamp01(Math.max(heat, smoke, this.flame[i]) * s.riskWeight);
      }
    }

    _windDestination(i) {
      const w = this.settings.wind || {}, ax = Math.abs(w.x), az = Math.abs(w.z);
      if (ax < 1e-8 && az < 1e-8) return -1;
      const c = i % this.grid.cols, r = Math.floor(i / this.grid.cols);
      let dc = 0, dr = 0;
      if (ax >= az) dc = w.x > 0 ? 1 : -1; else dr = w.z > 0 ? 1 : -1;
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= this.grid.cols || nr >= this.grid.rows) return -1;
      const next = nr * this.grid.cols + nc; return this.grid.blocked(next) ? -1 : next;
    }

    tick(delta = 1 / 30) {
      if (!Number.isFinite(delta) || delta <= 0) return this;
      const inputDt = Math.max(.0001, Math.min(this.settings.maxDt, finite(delta) || 1 / 30)), s = this.settings, n = this.size;
      this.time += inputDt; this._fieldAccumulator += inputDt;
      const fieldDt = Math.min(s.maxDt, this._fieldAccumulator);
      if (fieldDt < Math.max(1 / 30, s.fieldInterval || 0)) return this;
      this._fieldAccumulator = 0;
      const dt = fieldDt;
      const t0 = this.temperature, smoke0 = this.smoke, flame0 = this.flame, fuel0 = this.fuel;
      const t1 = t0.slice(), smoke1 = smoke0.slice(), flame1 = flame0.slice(), fuel1 = fuel0.slice(), ceiling0 = this.ceilingSmoke, ceiling1 = ceiling0.slice();
      const smokeMix = Math.min(.45, s.smokeDiffusion * dt / Math.max(.04, this.grid.cell ** 2));
      const ceilingMix = Math.min(.45, s.ceilingDiffusion * dt / Math.max(.04, this.grid.cell ** 2));

      for (const source of this.sources) if (source.active) {
        const i = source.cell;
        if (source.persistent) fuel1[i] = Math.max(fuel1[i], .12);
        if (fuel1[i] > 0) { t1[i] += source.power * dt; smoke1[i] += source.smoke * dt; flame1[i] = Math.max(flame1[i], source.flame); this._ignite(i, -1, this.time); }
      }
      for (let i = 0; i < n; i++) {
        if (this.grid.blocked(i)) continue;
        const flame = flame0[i];
        if (flame > 0) { const burned = Math.min(fuel0[i], s.burnRate * flame * dt); fuel1[i] = Math.max(0, fuel1[i] - burned); t1[i] += s.fireHeat * flame * dt; smoke1[i] += s.fireSmoke * flame * dt; }
        let neighborTemp = 0, count = 0;
        this._neighborCells(i, j => { neighborTemp += t0[j]; count++; });
        if (count) t1[i] += s.conductivity * (neighborTemp / count - t0[i]) * dt;
        t1[i] -= s.cooling * Math.max(0, t0[i] - s.ambientTemperature) * dt;
        const rising = smoke0[i] * s.ceilingRise * dt;
        smoke1[i] = Math.max(0, smoke1[i] + smokeMix * (this._neighborSmoke(i, smoke0) - smoke0[i]) - s.smokeDecay * smoke0[i] * dt - rising);
        ceiling1[i] = Math.max(0, ceiling0[i] + rising + ceilingMix * (this._neighborSmoke(i, ceiling0) - ceiling0[i]) - s.smokeDecay * ceiling0[i] * dt * .5);
        t1[i] = Math.min(s.maximumTemperature, t1[i]);
      }

      const smokeBeforeWind = smoke1.slice(), windStrength = Math.max(0, Math.hypot(s.wind?.x || 0, s.wind?.z || 0) * s.smokeAdvection);
      if (windStrength > 0) for (let i = 0; i < n; i++) {
        if (this.grid.blocked(i) || smokeBeforeWind[i] <= 0) continue;
        const j = this._windDestination(i); if (j < 0) continue;
        const amount = Math.min(smokeBeforeWind[i], smokeBeforeWind[i] * Math.min(.9, windStrength * dt)); smoke1[i] -= amount; smoke1[j] += amount;
      }

      for (let i = 0; i < n; i++) {
        if (this.grid.blocked(i)) { t1[i] = s.ambientTemperature; ceiling1[i] = smoke1[i] = flame1[i] = fuel1[i] = 0; continue; }
        if (fuel1[i] <= 0) { fuel1[i] = 0; flame1[i] = 0; if (this.ignitionTime[i] >= 0) this.burned[i] = 1; continue; }
        if (flame0[i] <= 0 && flame1[i] <= 0) {
          let parent = -1, maxFlame = 0;
          this._neighborCells(i, j => { if (flame0[j] > maxFlame) { maxFlame = flame0[j]; parent = j; } });
          if (t1[i] >= s.ignitionTemperature || (maxFlame > .16 && t1[i] >= s.spreadTemperature)) { const intensity = Math.max(.25, Math.min(1, maxFlame * .78 + (t1[i] - s.spreadTemperature) / Math.max(1, s.ignitionTemperature))); flame1[i] = intensity; if (this.ignitionTime[i] < 0) { this.ignitionTime[i] = this.time; this.ignitionParent[i] = parent; } }
        }
      }

      this.temperature = t1; this.smoke = smoke1; this.ceilingSmoke = ceiling1; this.flame = flame1; this.fuel = fuel1; this.fieldVersion++;
      for (let i = 0; i < n; i++) { const thermal = Math.max(0, (t1[i] - s.ambientTemperature) / Math.max(1, s.heatCriticalTemperature - s.ambientTemperature)); const smoke = clamp01(smoke1[i]); this.exposure[i] += dt * (Math.max(0, thermal - .1) * s.heatExposureRate + smoke * s.smokeExposureRate); }
      this._updateRisk();
      return this;
    }

    _neighborSmoke(i, values) { let sum = 0, count = 0; this._neighborCells(i, j => { sum += values[j]; count++; }); return count ? sum / count : values[i]; }

    hazardAt(cellOrPoint) { const cell = this._cell(cellOrPoint); if (cell < 0) return null; return { cell, temperature: this.temperature[cell], smoke: this.smoke[cell], flame: this.flame[cell], fuel: this.fuel[cell], exposure: this.exposure[cell], risk: this.risk[cell], dangerous: this.isDangerous(cell), blocked: this.isHazardBlocked(cell) }; }
    isDangerous(cellOrPoint) { const i = this._cell(cellOrPoint); return i >= 0 && this.risk[i] >= .5; }
    isHazardBlocked(cellOrPoint) { const i = this._cell(cellOrPoint); if (i < 0 || this.grid.blocked(i)) return true; const s = this.settings; const heatBlock=this.temperature[i] >= s.heatBlockTemperature, flameBlock=this.flame[i] >= s.flameBlock; // Smoke slows and raises exposure; it only seals a cell when paired with significant heat.
      const smokeSeal=this.smoke[i] >= s.smokeBlock && this.temperature[i] >= s.ambientTemperature+55; return heatBlock || flameBlock || smokeSeal; }
    navigationPenalty(cellOrPoint) { const i = this._cell(cellOrPoint); return i < 0 || this.isHazardBlocked(i) ? Infinity : 1 + this.risk[i] * 4 + this.smoke[i] * 1.5; }

    rebuildEscapeDistance(exits = []) {
      // Escape routing is deliberately rate-limited; fire fields update every
      // frame, while a one-second route refresh is enough for human response.
      if (this.time - this._lastEscapeBuild < .85 && this.exits.length) return this.exitDistance;
      this.exits = exits.map(item => this._nearestFree(typeof item === 'object' && !Number.isInteger(item) ? item : item)).filter(i => i >= 0 && !this.isHazardBlocked(i));
      this.exitDistance.fill(Infinity); const heap = new MinHeap();
      for (const i of new Set(this.exits)) { this.exitDistance[i] = 0; heap.push(i, 0); }
      const valid = Uint8Array.from({ length: this.size }, (_, i) => this.grid.blocked(i) || this.isHazardBlocked(i) ? 0 : 1);
      while (heap.length) { const item = heap.pop(), i = item.id; if (!item || item.cost > this.exitDistance[i] + 1e-6) continue; this.grid.neighbors(i, valid, (j, step) => { const penalty = (this.navigationPenalty(i) + this.navigationPenalty(j)) / 2, next = item.cost + step * this.grid.cell * penalty; if (next < this.exitDistance[j]) { this.exitDistance[j] = next; heap.push(j, next); } }); }
      this._lastEscapeBuild = this.time; return this.exitDistance;
    }

    _dynamicValid(radius) {
      const nav = this.grid.nav(radius), valid = new Uint8Array(this.size);
      for (let i = 0; i < this.size; i++) valid[i] = nav.valid[i] && !this.isHazardBlocked(i) ? 1 : 0;
      return { nav, valid };
    }

    _nearestDynamic(point, radius, valid, component) {
      if (Number.isInteger(point) && point >= 0 && point < this.size && valid[point] && (component === undefined || component[point] >= 0)) return point;
      const target = Number.isInteger(point) ? this.grid.point(point) : point;
      if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.z)) return -1;
      let best = -1, score = Infinity;
      for (let i = 0; i < this.size; i++) if (valid[i] && (component === undefined || component[i] >= 0)) { const p = this.grid.point(i), d = (p.x - target.x) ** 2 + (p.z - target.z) ** 2; if (d < score) { score = d; best = i; } }
      return best;
    }

    route(start, goal, radius = .25) {
      const { nav, valid } = this._dynamicValid(radius);
      const component = new Int32Array(this.size); component.fill(-1);
      const queue = new Int32Array(this.size);
      const si0 = this._nearestDynamic(start, radius, valid); if (si0 < 0) return { path: [], reachable: false };
      let head = 0, tail = 0; queue[tail++] = si0; component[si0] = 0;
      while (head < tail) { const i = queue[head++]; this.grid.neighbors(i, valid, j => { if (component[j] < 0) { component[j] = 0; queue[tail++] = j; } }); }
      const goalPoint = Number.isInteger(goal) ? this.grid.point(goal) : goal;
      const gi = this._nearestDynamic(goal, radius, valid, component), distanceToGoal = gi < 0 || !goalPoint ? Infinity : Math.hypot(this.grid.point(gi).x - goalPoint.x, this.grid.point(gi).z - goalPoint.z);
      if (gi < 0) return { path: [], reachable: false };
      const dist = new Float32Array(this.size), next = new Int32Array(this.size); dist.fill(Infinity); next.fill(-1); dist[gi] = 0; const heap = new MinHeap(); heap.push(gi, 0);
      while (heap.length) { const item = heap.pop(), i = item.id; if (!item || item.cost > dist[i] + 1e-5) continue; this.grid.neighbors(i, valid, (j, step) => { const nd = item.cost + step * this.grid.cell * this.navigationPenalty(j); if (nd < dist[j]) { dist[j] = nd; next[j] = i; heap.push(j, nd); } }); }
      const reachable = distanceToGoal < Math.max(this.grid.cell * 1.5, .4), raw = [], end = reachable ? gi : this._nearestDynamic(goal, radius, valid, component);
      let at = si0; for (let step = 0; at >= 0 && step < this.size; step++) { raw.push(this.grid.point(at)); if (at === end) break; at = next[at]; }
      const dynamicClear = (a, b) => { const count = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (this.grid.cell * .4)); for (let k = 0; k <= count; k++) { const t = count ? k / count : 0, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, i = this.grid.index(x, z); if (!this.grid.isClear(x, z, radius) || i < 0 || this.isHazardBlocked(i)) return false; } return true; };
      const path = []; let anchor = start, cursor = 0; while (cursor < raw.length) { let far = cursor; while (far + 1 < raw.length && far - cursor < 30 && dynamicClear(anchor, raw[far + 1])) far++; path.push(raw[far]); anchor = raw[far]; cursor = far + 1; }
      return { path, reachable, endpoint: this.grid.point(end), hazardAware: true };
    }

    escapeDistanceAt(cellOrPoint) { const i = this._cell(cellOrPoint); return i < 0 ? Infinity : this.exitDistance[i]; }
    escapeDirection(cellOrPoint) { const i = this._cell(cellOrPoint); if (i < 0 || !Number.isFinite(this.exitDistance[i])) return null; let best = -1, score = this.exitDistance[i]; const valid = Uint8Array.from({ length: this.size }, (_, j) => this.grid.blocked(j) ? 0 : 1); this.grid.neighbors(i, valid, j => { if (this.exitDistance[j] < score) { score = this.exitDistance[j]; best = j; } }); return best < 0 ? null : this.grid.point(best); }

    ignitionPath(cellOrPoint) { let at = this._cell(cellOrPoint); if (at < 0 || this.ignitionTime[at] < 0) return []; const path = []; for (let step = 0; at >= 0 && step < this.size; step++) { path.push(at); at = this.ignitionParent[at]; } return path.reverse(); }

    summary() { let maxTemperature = this.settings.ambientTemperature, maxSmoke = 0, burning = 0, dangerous = 0; for (let i = 0; i < this.size; i++) { maxTemperature = Math.max(maxTemperature, this.temperature[i]); maxSmoke = Math.max(maxSmoke, this.smoke[i]); if (this.flame[i] > 0) burning++; if (this.isDangerous(i)) dangerous++; } return { time: this.time, sources: this.sources.length, burningCells: burning, dangerousCells: dangerous, maxTemperature, maxSmoke, ignitedCells: this.ignitionTime.reduce((n, v) => n + (v >= 0 ? 1 : 0), 0) }; }
  }

  return { FireModel, FIRE_DEFAULTS: DEFAULTS };
});
