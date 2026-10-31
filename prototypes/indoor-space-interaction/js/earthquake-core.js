/* A reproducible ground-motion / damage scenario coupled to QuakePhysics.
 * Motion and material fragility are scenario inputs, not a structural assessment.
 * Contact, gravity, sliding and impact fragmentation are solved by cannon-es. */
(() => {
  'use strict';
  const L=window.IndoorLab;
  class EarthquakeScenario {
    constructor(grid,obstacles=[],options={}){
      this.grid=grid;this.obstacles=obstacles;
      this.options={seed:7319,pga:.32,frequency:2.2,duration:12,settleDuration:8,collapseThreshold:.78,...options};
      this.physics=options.physics||null;this.reset();
    }
    random(){this.seed=(this.seed*1664525+1013904223)>>>0;return this.seed/4294967296;}
    reset(){
      this.seed=this.options.seed>>>0;this.time=0;this.active=false;this.shaking=false;this.finished=false;
      this.groundAcceleration=this.groundAccelerationZ=this.groundVelocity=this.groundDisplacement=this.groundDisplacementZ=0;
      this.peakGroundDisplacement=this.peakGroundDisplacementZ=0;
      this.debris=[];this.events=[];this._eventKeys=new Set();
      this.damage=this.obstacles.map((o,i)=>({id:o.id??i,ratio:0,cracked:false,collapsed:false,released:false,energy:0,variation:.82+this.random()*.4}));
      this.physics?.reset?.();return this;
    }
    start(){this.reset();this.active=this.shaking=true;return this;}
    record(event){const key=event.key||`${event.type}:${event.id}`;if(this._eventKeys.has(key))return;this._eventKeys.add(key);this.events.push({...event,time:this.time});}
    tick(dt){
      if(this.finished||(!this.active&&!this.time)||!(dt>0))return;
      const o=this.options,t=Math.min(this.time+dt,o.duration),w=2*Math.PI*o.frequency;
      this.time+=dt;this.shaking=this.active=this.time<o.duration-1e-9;
      const e=this.shaking?Math.sin(Math.PI*t/o.duration)**2:0;
      this.groundAcceleration=o.pga*9.81*e*(.74*Math.sin(w*t)+.26*Math.sin(w*.61*t+1.1));
      this.groundAccelerationZ=o.pga*9.81*e*(.55*Math.sin(w*.83*t+.8)+.18*Math.sin(w*1.37*t));
      this.groundDisplacement=-o.pga*9.81*e/(w*w)*(.74*Math.sin(w*t)+.26/(.61*.61)*Math.sin(w*.61*t+1.1));
      this.groundDisplacementZ=-o.pga*9.81*e/(w*w)*(.55/(.83*.83)*Math.sin(w*.83*t+.8)+.18/(1.37*1.37)*Math.sin(w*1.37*t));
      this.groundVelocity=-o.pga*9.81*e/w*(.74*Math.cos(w*t)+.26/.61*Math.cos(w*.61*t+1.1));
      this.peakGroundDisplacement=Math.max(this.peakGroundDisplacement,Math.abs(this.groundDisplacement));
      this.peakGroundDisplacementZ=Math.max(this.peakGroundDisplacementZ,Math.abs(this.groundDisplacementZ));
      const acceleration=Math.hypot(this.groundAcceleration,this.groundAccelerationZ)/9.81;
      for(let i=0;i<this.obstacles.length;i++){
        const object=this.obstacles[i],s=this.damage[i];
        if(s.collapsed)continue;
        // Legacy descriptors without kind are structural wall-like bodies.
        const isWall=object.kind==='wall'||!object.kind;
        const slender=Math.min(2.5,Math.max(.5,(object.height||1)/Math.max(.15,Math.min(object.width||1,object.depth||1))));
        const demand=Math.max(0,acceleration-(isWall ? 0.055 : 0.025));
        s.ratio=Math.min(1.4,s.ratio+demand*dt*(object.fragility??.7)*s.variation*(.62+slender*.24));
        if(isWall&&s.ratio>.10&&!s.cracked){s.cracked=true;this.record({type:'crack',id:s.id,name:object.name,...object.center});}
        const releaseThreshold=object.mounted?.11:.035;
        if(!isWall&&!s.released&&s.ratio>releaseThreshold){s.released=true;this.physics?.release?.(s.id);}
        const threshold=o.collapseThreshold*(isWall ? 1 : .8);
        if(isWall&&object.fracturable!==false&&s.ratio>threshold){
          s.collapsed=true;s.energy=Math.min(1,s.ratio*.6);
          this.record({type:'collapse',id:s.id,name:object.name,energy:s.energy,...object.center});
          if(this.physics)this.physics.fractureWall(s.id,this);
          else this.debris.push({id:s.id,name:object.name||'墙体碎片',kind:'debris',x:object.center?.x||0,z:object.center?.z||0,radius:Math.max(object.width||.5,object.depth||.5)*.35,height:.35,energy:s.energy});
        }
      }
      this.physics?.step?.(dt,this);
      if(this.physics)this.debris=this.physics.footprints();
      if(this.time>=o.duration+o.settleDuration){this.finished=true;this.active=this.shaking=false;}
    }
    contactAt(x,z,radius=.25){return this.physics?.contactAt(x,z,radius)||this.debris.find(d=>Math.hypot(x-d.x,z-d.z)<d.radius+radius)||null;}
    isUnsafe(x,z,radius=.25){return !!this.contactAt(x,z,radius);}
    riskAt(x,z){let risk=Math.min(.8,Math.hypot(this.groundAcceleration,this.groundAccelerationZ)/9.81);for(const d of this.debris){const r=d.radius||.25,q=Math.hypot(x-d.x,z-d.z);if(q<r+.6)risk=Math.max(risk,Math.min(1,(d.energy||.7)*(1-q/(r+.6))));}return risk;}
    summary(){const p=this.physics?.summary?.()||{};return{time:this.time,active:this.active,shaking:this.shaking,finished:this.finished,pga:this.options.pga,groundAcceleration:this.groundAcceleration,groundDisplacement:this.groundDisplacement||this.peakGroundDisplacement,peakGroundDisplacement:this.peakGroundDisplacement,cracked:this.damage.filter(d=>d.cracked).length,collapsed:this.damage.filter(d=>d.collapsed).length,debris:this.debris.length,events:this.events.length,...p};}
    dispose(){this.active=this.shaking=false;this.finished=true;this.physics?.dispose?.();}
  }
  L.EarthquakeScenario=EarthquakeScenario;
  if(typeof module!=='undefined')module.exports={EarthquakeScenario};
})();
