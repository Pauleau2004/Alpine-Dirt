// Conservative envelope, not a second physics simulation. Network jitter gets
// one bounded reserve, never a fresh allowance for every packet received.
export class MovementGuard {
  constructor(now){this.reset(now);}
  reset(now){this.at=now;this.credit=1.2;}
  accept(distance,now) {
    if(!Number.isFinite(distance)||distance<0||!Number.isFinite(now)||now<this.at)return false;
    this.credit=Math.min(17.45,this.credit+65*Math.min((now-this.at)/1000,.25));this.at=now;
    if(distance>this.credit+1e-7)return false;
    this.credit=Math.max(0,this.credit-distance);return true;
  }
}
