import { gateCrossing } from './gateCrossing.js';
import { checkpointRouteNear } from '../shared/checkpointRoute.js';

export const TIMING_CHECKPOINT_COUNT=10;
// Ten ordered timing gates: 1..9 around the loop, then 0 at the finish.
// Recovery markers remain independent and never award a timing checkpoint.
export class LapCheckpointSystem {
  constructor(track) {
    this.track=track;this.gates=(track.timingUs??Array.from({length:TIMING_CHECKPOINT_COUNT},(_,i)=>i/TIMING_CHECKPOINT_COUNT)).map(u=>track.at(u));this.reset();
  }
  reset() {this.passed=0;this.previous=null;this.routeU=null;this.routeLost=false;this.launching=false;}
  setLaunching(enabled=true) {this.launching=enabled;this.passed=0;this.previous=null;this.routeU=null;this.routeLost=false;}
  resetPosition(position,u) {
    this.previous={x:position.x,y:position.y,z:position.z};
    // Keep only already-earned gates at or behind the respawn position. Moving
    // forward by respawn can never promote the ordered checkpoint counter.
    const wrapped=((u%1)+1)%1;
    this.passed=Math.min(this.passed,this.gates.findLastIndex(g=>g.u<=wrapped+1e-8));
    this.routeU=wrapped;this.routeLost=false;
  }
  update(position,routeNear=null) {
    const previous=this.previous;this.previous={x:position.x,y:position.y,z:position.z};
    if(this.launching) {
      const finishWidth=(this.track.widthAt?.(this.gates[0].u)??this.track.width)/2+.6;
      if(previous) {
        const finish=gateCrossing(previous,position,this.gates[0],finishWidth);
        if(finish!==null) {
          this.launching=false;this.passed=0;this.routeLost=false;this.routeU=0.001;
          return { launchCompleted: true, fraction: finish };
        }
      }
      return { launching: true };
    }
    const index=this.next,width=(this.track.widthAt?.(this.gates[index].u)??this.track.width)/2+.6;
    if(this.track.strictRoute) {
      const near=checkpointRouteNear(this.track,position,routeNear);
      if(previous&&this.routeU!==null){const delta=Math.abs(((near.u-this.routeU+1.5)%1)-.5)*this.track.length;const move=Math.hypot(position.x-previous.x,position.z-previous.z);if(delta>Math.max(12,move*2.5+3))this.routeLost=true;}
      this.routeU=near.u;
      const lower=this.gates[this.passed].u,upper=this.gates[this.passed+1]?.u??1;
      // A cut onto a neighbouring lane must return to the earned sector before
      // another gate can count. Respawn may rewind gates but never earn them.
      if(this.routeLost&&near.distance<=width&&near.u>=lower&&near.u<upper)this.routeLost=false;
      if(this.routeLost)return gateCrossing(previous,position,this.gates[0],width)!==null?{missingCheckpoint:true,expected:index}:null;
    }
    const fraction=gateCrossing(previous,position,this.gates[index],width);
    if(fraction!==null) {
      if(index===0){this.passed=0;return {lap:true,valid:true,fraction};}
      this.passed=index;return {checkpoint:true,index,passed:this.passed,fraction};
    }
    if(index!==0) {
      const finish=gateCrossing(previous,position,this.gates[0],width);
      if(finish!==null)return {missingCheckpoint:true,expected:index,fraction:finish};
    }
    return null;
  }
  get next() {return this.passed===this.gates.length-1?0:this.passed+1;}
  progressAt(u) {
    // A skipped gate cannot advance ranking into the next sector.
    const lower=this.gates[this.passed].u,upper=(this.gates[this.passed+1]?.u??1)-1e-6;
    return Math.max(lower,Math.min(upper,u));
  }
}
