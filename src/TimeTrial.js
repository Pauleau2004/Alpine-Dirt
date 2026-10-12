export function formatTime(seconds) {
  if(seconds===null||!Number.isFinite(seconds))return '—:——.———';
  const ms=Math.max(0,Math.floor(seconds*1000));
  return `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
}
// Retain old records, but don't mix two-gate laps with the ten-gate rules.
export const BEST_TIME_KEY='motocross.alpine.v3.best';
export class TimeTrial {
  constructor(storage=globalThis.localStorage,key=BEST_TIME_KEY,laps=Infinity) {
    this.storage=storage;this.key=key;this.best=null;this.laps=laps;
    try {const value=Number(storage?.getItem(key));if(value>5&&Number.isFinite(value))this.best=value;}catch{/* optional persistence */}
    this.reset('practice');
  }
  reset(mode,options={}) {
    this.mode=mode;this.flyingStart=!!options.flyingStart;this.isLaunching=this.flyingStart;
    this.lap=this.flyingStart?0:1;this.lapTime=0;this.launchTime=0;this.total=0;
    this.results=[];this.finished=false;this.newBest=false;
  }
  update(dt,event) {
    if(this.finished||this.mode!=='trial')return;
    if(this.isLaunching) {
      this.launchTime+=dt;
      if(event?.launchCompleted||(event?.lap&&this.lap===0)) {
        this.isLaunching=false;this.lap=1;
        const overshoot=event?.fraction!==undefined?dt*(1-event.fraction):0;
        this.lapTime=Math.max(0,overshoot);this.total=this.lapTime;
        return { launched: true };
      }
      return;
    }
    this.total+=dt;this.lapTime+=dt;
    if(event?.lap) {
      const overshoot=dt*(1-event.fraction),time=this.lapTime-overshoot;
      this.results.push({time,valid:event.valid});
      if(event.valid&&(this.best===null||time<this.best)) {
        this.best=time;this.newBest=true;
        try{this.storage?.setItem(this.key,String(time));}catch{/* optional persistence */}
      }
      if(this.lap===this.laps){this.finished=true;this.total-=overshoot;}else{this.lap++;this.lapTime=overshoot;}
    }
  }
}
