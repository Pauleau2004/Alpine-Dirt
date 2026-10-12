import { gateCrossing } from './gateCrossing.js';

// Recovery positions only. Missing one never affects the clock or prevents a
// later marker from becoming the current respawn position.
export class CheckpointSystem {
  constructor(track,count=track.respawnCount??36) {
    this.track=track;this.count=count;
    this.gates=(track.respawnUs??Array.from({length:count},(_,i)=>i/count)).map(u=>track.at(u));this.count=this.gates.length;this.reset();
  }
  reset() {this.last=0;this.previous=null;}
  resetPosition(position) {this.previous={x:position.x,y:position.y,z:position.z};}
  respawn() {return this.gates[this.last];}
  update(position) {
    const previous=this.previous;this.resetPosition(position);
    let latest=-1,passed=null;
    for(let i=0;i<this.count;i++) {
      const fraction=gateCrossing(previous,position,this.gates[i],(this.track.widthAt?.(this.gates[i].u)??this.track.width)/2+.6);
      if(fraction!==null&&fraction>latest){latest=fraction;passed=i;}
    }
    if(passed!==null)this.last=passed;
    return passed;
  }
}
