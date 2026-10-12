import { Quaternion } from 'three';
import { INTERPOLATION_MS } from '../../shared/multiplayer.js';
const mix=(a,b,t)=>a+(b-a)*t;
const mixArray=(a,b,t)=>a.map((v,i)=>mix(v,b[i],t));
export class NetworkInterpolation {
  constructor(delay=INTERPOLATION_MS){this.delay=delay;this.frames=[];this.version=null;}
  push(frame,version=0) {
    if(version!==this.version){this.frames=[];this.version=version;}
    if(this.frames.length&&frame.serverTime<=this.frames.at(-1).serverTime)return;
    this.frames.push(frame);if(this.frames.length>32)this.frames.shift();
  }
  sample(now) {
    if(!this.frames.length)return null;
    const target=now-this.delay;
    while(this.frames.length>2&&this.frames[1].serverTime<=target)this.frames.shift();
    const a=this.frames[0],b=this.frames[1]??a;
    const t=a===b?0:Math.max(0,Math.min(1,(target-a.serverTime)/(b.serverTime-a.serverTime)));
    const rotation=new Quaternion(...a.rotation).slerp(new Quaternion(...b.rotation),t).toArray();
    return {...b,position:mixArray(a.position,b.position,t),rotation,speed:mix(a.speed,b.speed,t),steer:mix(a.steer,b.steer,t),pitch:mix(a.pitch,b.pitch,t),roll:mix(a.roll,b.roll,t),throttle:mix(a.throttle,b.throttle,t),suspension:mixArray(a.suspension,b.suspension,t),compression:mixArray(a.compression,b.compression,t)};
  }
}
