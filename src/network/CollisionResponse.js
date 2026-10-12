import {MOTORCYCLE_COLLISION_CONFIG as CONFIG,clamp} from '../../shared/collisions.js';
import { damp } from '../math.js';
const limit=(v,max)=>{const scale=Math.min(1,max/Math.max(1e-9,Math.hypot(v.x,v.z)));v.x*=scale;v.z*=scale;};

export class CollisionResponse {
  constructor(config=CONFIG){this.config=config;this.onContact=null;this.clear();}
  clear(){
    this.pending={x:0,z:0};this.visualOffset={x:0,z:0};this.yaw=0;
    this.revision=0;this.offset=[0,0,0];
    this.lastSequence=0;this.windowAt=-Infinity;this.windowBudget=0;
    this.applied=0;this.gripTimer=0;this.recoveryTimer=0;this.lastContact=null;
  }
  receive(event,{raceId,playerId,version,now,bike}) {
    const c=this.config;
    if(!c.enabled||event.raceId!==raceId||event.sequence<=this.lastSequence||now-event.timestamp>c.maxEventAgeMs||event.timestamp-now>100)return false;
    this.lastSequence=event.sequence;
    const effect=event.effects?.find(e=>e.playerId===playerId);
    if(!effect||effect.version!==version)return false;
    this.reconcile(effect.authority,bike,version);
    const v=bike.body.linvel(),speed=Math.hypot(v.x,v.z),loss=Math.min(c.maxVelocityLoss,speed*clamp(effect.velocityLoss,0,.25));
    const delta={x:effect.deltaVelocity[0]-v.x/Math.max(speed,1)*loss,z:effect.deltaVelocity[2]-v.z/Math.max(speed,1)*loss};
    limit(delta,c.maxCombinedDeltaV);
    if(now-this.windowAt>=c.impactWindowMs){this.windowAt=now;this.windowBudget=0;}
    limit(delta,Math.max(0,c.maxCombinedDeltaV-this.windowBudget));this.windowBudget+=Math.hypot(delta.x,delta.z);
    this.pending.x+=delta.x;this.pending.z+=delta.z;limit(this.pending,c.maxCombinedDeltaV);
    this.yaw=clamp(this.yaw+effect.yawImpulse,-c.maxAngularImpulse,c.maxAngularImpulse);
    if(!event.persistent){
      this.gripTimer=c.postImpactGripDuration;
      this.recoveryTimer=c.recoveryAssistDuration;
    }
    this.lastContact={
      point:event.point,normal:event.direction,intensity:event.intensity,
      relativeSpeed:event.relativeSpeed,kind:event.kind,contactLevel:effect.contactLevel||'NORMAL',
      persistent:event.persistent,depth:event.depth||0,angleDeg:event.angleDeg||0,timestamp:now
    };
    this.applied++;
    this.onContact?.(event,effect);
    return true;
  }
  reconcile(authority,bike,version) {
    if(!authority||authority.version!==version||authority.revision<=this.revision)return false;
    const dx=authority.offset[0]-this.offset[0],dz=authority.offset[2]-this.offset[2],p=bike.body.translation();
    bike.body.setTranslation({x:p.x+dx,y:p.y,z:p.z+dz},true);
    bike.position.x+=dx;bike.position.z+=dz;
    bike.previousPosition.x+=dx;bike.previousPosition.z+=dz;
    this.visualOffset.x-=dx;this.visualOffset.z-=dz;
    // Enforce a unilateral velocity constraint; never replay a stale impulse.
    const v=bike.body.linvel();
    for(let iteration=0;iteration<12;iteration++)for(const c of authority.constraints){const n=c.normal,d=c.speed-v.x*n[0]-v.z*n[2];if(d>0){v.x+=n[0]*d;v.z+=n[2]*d;}}
    bike.body.setLinvel(v,true);
    this.revision=authority.revision;this.offset=[...authority.offset];
    return true;
  }
  renderOffset(dt) {
    const part=Math.exp(-dt/this.config.correctionDuration);
    this.visualOffset.x*=part;this.visualOffset.z*=part;
    return this.visualOffset;
  }
  step(bike,dt) {
    const c=this.config,part=1-Math.exp(-dt/c.responseDuration),vx=this.pending.x*part,vz=this.pending.z*part;
    // Strict Anti-Launch: only horizontal forces (Y is 0)
    bike.body.applyImpulse({x:vx*bike.config.mass,y:0,z:vz*bike.config.mass},true);
    this.pending.x-=vx;this.pending.z-=vz;
    const yaw=this.yaw*part;bike.yawRate+=yaw;this.yaw-=yaw;
    // Subtle post-impact grip reduction & gentle recovery assistance
    if(this.gripTimer>0){
      this.gripTimer-=dt;
      bike.grip=Math.min(bike.grip,c.postImpactGripMultiplier);
    }
    if(this.recoveryTimer>0){
      this.recoveryTimer-=dt;
      bike.yawRate=damp(bike.yawRate,0,2.5,dt);
    }
  }
}
