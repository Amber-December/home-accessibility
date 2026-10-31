/* Deterministic injury and stretcher rescue scenario for both demo buildings. */
(() => {
  'use strict';
  const L = window.IndoorLab;
  function finitePoint(grid, point, radius = .28, fallback = {x: 0, z: 0}, search = Infinity) {
    const free = grid.nav(radius).free || grid.nav(radius).mainFree || [];
    let best = null, score = Infinity;
    for (const i of free) {const p = grid.point(i), d = Math.hypot(p.x - point.x, p.z - point.z);if(d < score){score=d;best=p;}}
    if (best && score <= search) return best;
    if (fallback && grid.isClear(fallback.x, fallback.z, radius)) return fallback;
    return best || fallback;
  }
  class InjuryRescueSimulation extends L.Simulation {
    constructor(grid, model, settings = {}) {
      super(grid, model.goals || [], {...settings, count: Math.max(8, Number(settings.count) || 16)});
      this.model = model;
      this.isRescue = true;
      this.rescue = {phase: 'walking', triggerAt: 5 + (this.initialSeed % 7) * .55, victim: null, doctors: [], approach: [], exit: null, collisions: 0, rescued: false, stretcher: {x: 0, z: 0, angle: 0, radius: .62, visible: false}};
      this.setupRescue();
    }
    entrance() {
      const center = {x: (this.grid.minX + this.grid.maxX) / 2, z: (this.grid.minZ + this.grid.maxZ) / 2};
      const doors = this.model.doors || [];
      let door = doors.find(d => /入口|入户|entry|exit|entrance/i.test(`${d.name || ''} ${d.id || ''}`));
      if (!door) door = doors.slice().sort((a, b) => Math.min(Math.abs(a.x - this.grid.minX), Math.abs(a.x - this.grid.maxX), Math.abs(a.z - this.grid.minZ), Math.abs(a.z - this.grid.maxZ)) - Math.min(Math.abs(b.x - this.grid.minX), Math.abs(b.x - this.grid.maxX), Math.abs(b.z - this.grid.minZ), Math.abs(b.z - this.grid.maxZ)))[0];
      if (door) {
        const horizontal = door.axis === 'x';
        const positive = horizontal ? door.z >= center.z : door.x >= center.x;
        const inside = horizontal ? {x: door.x, z: door.z + (positive ? -.85 : .85)} : {x: door.x + (positive ? -.85 : .85), z: door.z};
        const outside = horizontal ? {x: door.x, z: door.z + (positive ? .85 : -.85)} : {x: door.x + (positive ? .85 : -.85), z: door.z};
        return {inside: finitePoint(this.grid, inside), outside: finitePoint(this.grid, outside), door};
      }
      const edge = Math.abs(this.grid.maxZ - center.z) > Math.abs(this.grid.minZ - center.z) ? 1 : -1;
      return {inside: finitePoint(this.grid, {x: center.x, z: center.z + edge * Math.max(1, (this.grid.maxZ - this.grid.minZ) * .35)}), outside: finitePoint(this.grid, {x: center.x, z: center.z + edge * Math.max(1, (this.grid.maxZ - this.grid.minZ) * .48)}), door: null};
    }
    makeDoctor(id, point) {
      const profile = {...L.PROFILES.doctor};
      return {id, type: 'doctor', profile, x: point.x, z: point.z, vx: 0, vz: 0, angle: Math.PI, state: 'waiting', _lastState: 'waiting', _stateSince: 0, _pendingTransitionReason: '等待救援派遣', trail: [], path: [], pathAt: 0, goal: null, wait: Infinity, stalled: 0, contactAt: -5, blockedTrip: false, trip: 0, search: this.settings.search, preferredSide: id % 2 ? 1 : -1, yieldUntil: 0, distance: 0, routeDistance: 0, routeIdealDistance: 0, waitTime: 0, crowdWaitTime: 0, geometryWaitTime: 0, reroutes: 0, smokeDose: 0, hazardExposureTime: 0, minClearance: Infinity, minClearanceAt: null, minClearancePoint: null, minClearanceObject: null, statusHistory: [], rescueRole: 'doctor', rescuePair: 'stretcher-team'};
    }
    setupRescue() {
      const entry = this.entrance();
      const doctorFree = this.grid.nav(.3).free || [];
      const nearestDoctorPoint = victim => {let best=null,score=Infinity;for(const i of doctorFree){const p=this.grid.point(i),d=Math.hypot(p.x-victim.x,p.z-victim.z);if(d<score){score=d;best=p;}}return{point:best,distance:score};};
      const candidates=this.agents.filter(a=>a.type==='pedestrian').map(a=>({...nearestDoctorPoint(a),victim:a})).sort((a,b)=>a.distance-b.distance);
      const chosen=candidates[0]||{victim:this.agents[0],point:null};
      const victim = chosen.victim;
      if (!victim) return;
      victim.rescueRole = 'victim';
      this.rescue.victim = victim;
      this.rescue.exit = entry.outside;
      const left = finitePoint(this.grid, {x: entry.inside.x - .42, z: entry.inside.z}, .3, entry.inside);
      const right = finitePoint(this.grid, {x: entry.inside.x + .42, z: entry.inside.z}, .3, entry.inside);
      const doctors = [this.makeDoctor(this.agents.length, left), this.makeDoctor(this.agents.length + 1, right)];
      this.agents.push(...doctors);
      this.rescue.doctors = doctors;
      const center=chosen.point||{x:victim.x,z:victim.z};
      this.rescue.approach = [{x: center.x - .42, z: center.z}, {x: center.x + .42, z: center.z}].map(p => finitePoint(this.grid, p, .3, center));
      const body = {id: 'rescue-stretcher', name: '担架', kind: 'stretcher', x: victim.x, z: victim.z, radius: .62, mass: 100, friction: 1, pushable: false, collisionOnly: true, removed: true, ignoreAgents: new Set([victim.id, doctors[0].id, doctors[1].id])};
      this.rescue.stretcherBody = body;
      this.setDynamicBodies([body]);
    }
    route(agent, target, name) {
      const route = this.grid.route({x: agent.x, z: agent.z}, target, agent.profile.radius);
      agent.goal = {...target, name}; agent.path = route.path || []; agent.pathAt = 0; agent.reachable = route.reachable; agent.endpoint = route.endpoint; agent.routeIdealDistance = Math.hypot(target.x - agent.x, target.z - agent.z); agent.routeDistance = 0; for (let i = 1; i < agent.path.length; i++) agent.routeDistance += Math.hypot(agent.path[i].x - agent.path[i - 1].x, agent.path[i].z - agent.path[i - 1].z); agent.state = route.path?.length ? 'moving' : 'blocked'; agent.wait = 0; agent.rescueGoal = target;
    }
    dispatch() {
      const r = this.rescue, v = r.victim;
      r.phase = 'dispatch';
      v.state = 'injured'; v.wait = Infinity; v.vx = v.vz = 0; v.goal = null; v.path = []; v.reaction = {code: 'injured', phase: 'injured', text: '脚踝扭伤，无法站立', fear: .35, posture: 'fallen', speedFactor: 0};
      const center = finitePoint(this.grid, {x: v.x, z: v.z}, .3, {x: v.x, z: v.z});
      r.approach = [{x: center.x - .62, z: center.z - .32}, {x: center.x - .62, z: center.z + .32}].map(p => finitePoint(this.grid, p, .3, center));
      r.doctors.forEach((doctor, i) => {doctor.wait = 0; doctor.reaction = {code: 'rescue', phase: 'rescue', text: '进入空间救援', fear: 0, posture: 'upright', speedFactor: 1}; this.route(doctor, r.approach[i], '靠近伤员');});
    }
    startCarry() {
      const r = this.rescue, v = r.victim;
      r.phase = 'carry'; r.stretcher.visible = true; r.stretcherBody.removed = false;
      v.state = 'carried'; v.wait = Infinity; v.reaction = {code: 'injured', phase: 'carried', text: '被担架抬运', fear: .22, posture: 'fallen', speedFactor: 0};
      r.doctors.forEach((doctor, i) => {this.route(doctor, r.exit, '抬担架返回入口'); doctor.reaction.text = '抬担架返回入口';});
    }
    updateStretcher() {
      const r = this.rescue, v = r.victim, d0 = r.doctors[0], d1 = r.doctors[1];
      if (r.phase !== 'carry' || !d0 || !d1) return;
      const x = (d0.x + d1.x) / 2, z = (d0.z + d1.z) / 2, angle = Math.atan2(d1.x - d0.x, d1.z - d0.z);
      r.stretcher.x = x; r.stretcher.z = z; r.stretcher.angle = angle; r.stretcherBody.x = x; r.stretcherBody.z = z;
      v.x = x; v.z = z; v.angle = angle; v.trail.push({x, z}); if (v.trail.length > 48) v.trail.shift();
      if (!this.grid.isClear(x, z, r.stretcher.radius)) {
        if (this.time - (r.lastCollisionAt || -Infinity) >= 1) {r.lastCollisionAt = this.time; r.collisions++; this.event(d0, 'contact', '担架安全包络触及家具或墙体', d0, {code: 'stretcher_collision', collision: this.grid.collisionAt(x, z, r.stretcher.radius), evidence: '担架宽度净空检查'});}
      }
    }
    tick(dt) {
      const r = this.rescue;
      if (r.phase === 'walking' && this.time >= r.triggerAt) this.dispatch();
      super.tick(dt);
      if (r.phase === 'dispatch' && r.doctors.every((doctor, i) => Math.hypot(doctor.x - r.approach[i].x, doctor.z - r.approach[i].z) < .72)) this.startCarry();
      if (r.phase === 'carry') {
        this.updateStretcher();
        const lead = r.doctors[0];
        if (lead && Math.hypot(lead.x - r.exit.x, lead.z - r.exit.z) < 1.0 && r.doctors.every(d => d.state === 'arrived' || d.state === 'safe' || Math.hypot(d.x - r.exit.x, d.z - r.exit.z) < 1.0)) {
          r.phase = 'complete'; r.rescued = true; r.stretcher.visible = false; r.stretcherBody.removed = true;
          r.doctors.forEach(d => {d.state = 'safe'; d.wait = Infinity; d.reaction = {code: 'safe', phase: 'safe', text: '已完成救援', fear: 0, posture: 'upright', speedFactor: 0};});
          r.victim.state = 'safe'; r.victim.reaction = {code: 'safe', phase: 'safe', text: '已送出入口', fear: 0, posture: 'fallen', speedFactor: 0};
        }
      }
    }
    summary() {const base = super.summary(); return {...base, rescue:{phase:this.rescue.phase,triggerAt:this.rescue.triggerAt,rescued:this.rescue.rescued,stretcherCollisions:this.rescue.collisions,victimId:this.rescue.victim?.id,doctorIds:this.rescue.doctors.map(d=>d.id)}};}
  }
  L.InjuryRescueSimulation = InjuryRescueSimulation;
})();
