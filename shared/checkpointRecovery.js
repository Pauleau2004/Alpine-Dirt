import { checkpointRouteNear } from './checkpointRoute.js';

export const CHECKPOINT_RECOVERY_CONFIG=Object.freeze({delayMs:3000,beforeGateMetres:4,protectionMs:1000});
const wrap=u=>((u%1)+1)%1;
const signed=u=>wrap(u+.5)-.5;

// Shared detection: solo uses simulation time; LAN uses only server time and
// accepted positions. Merely waiting, reversing or approaching a gate is safe.
export class CheckpointRecovery {
  constructor(timing){this.timing=timing;this.reset();}
  reset(){this.pending=null;this.previous=null;this.previousU=null;this.now=0;}
  update(position,near,now,event=null,active=true,expectedIndex=this.timing.next) {
    if(!active||this.timing.launching){this.reset();return;}
    this.now=Math.max(this.now,now);
    const index=expectedIndex,track=this.timing.track;
    near=checkpointRouteNear(track,position,near);
    if(event?.checkpoint||event?.lap||event?.launchCompleted||(this.pending&&this.pending.index!==index))this.pending=null;
    if(!this.pending&&!event?.checkpoint&&!event?.lap&&!event?.launchCompleted&&this.previous&&this.previousU!==null) {
      const gate=this.timing.gates[index],delta=signed(near.u-this.previousU)*track.length;
      const move=Math.hypot(position.x-this.previous.x,position.z-this.previous.z);
      const sin=Math.sin(gate.yaw),cos=Math.cos(gate.yaw),p=gate.position;
      const before=(this.previous.x-p.x)*sin+(this.previous.z-p.z)*cos;
      const after=(position.x-p.x)*sin+(position.z-p.z)*cos;
      // Use the actual gate plane, like validation, not just a rounded route
      // fraction. A frame exactly on the line must not report a missed gate.
      // Restrict the plane to its own road so a crossing elsewhere cannot count.
      const atGate=Math.abs(signed(near.u-gate.u))*track.length<=Math.max(12,move*2.5+3);
      const passedExpected=delta>0&&atGate&&before<1e-4&&after>=1e-4;
      const lower=this.timing.gates[index===0&&this.timing.passed===0?this.timing.gates.length-1:this.timing.passed].u,sector=wrap(gate.u-lower)*track.length;
      const jumpedAhead=Math.abs(delta)>Math.max(40,move*3+8)&&wrap(near.u-lower)*track.length>sector;
      if(passedExpected||jumpedAhead||this.timing.routeLost||event?.missingCheckpoint)this.pending={index,startedAt:this.now,deadline:this.now+CHECKPOINT_RECOVERY_CONFIG.delayMs};
    }
    this.previous={x:position.x,y:position.y,z:position.z};this.previousU=near.u;
  }
  due(now){return !!this.pending&&now>=this.pending.deadline;}
  snapshot(){return this.pending?{...this.pending}:null;}
  spawn() {
    if(!this.pending)return null;
    const track=this.timing.track,gate=this.timing.gates[this.pending.index];
    let u=wrap(gate.u-CHECKPOINT_RECOVERY_CONFIG.beforeGateMetres/track.length);
    // The racing line can span a real void. Respawn on its run-up, with room
    // to regain speed, instead of placing the motorcycle in mid-air.
    for(const gap of track.gaps??[])if(u>=gap.takeoffU-3/track.length&&u<=gap.landingU+8/track.length)u=wrap(gap.takeoffU-30/track.length);
    return track.at(u);
  }
}

export function resetRecoveryMarker(checkpoints,spawn,position) {
  checkpoints.last=Math.max(0,checkpoints.gates.findLastIndex(g=>g.u<=spawn.u+1e-8));
  checkpoints.resetPosition(position);
}
