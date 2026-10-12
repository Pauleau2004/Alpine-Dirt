export const LAST_PLACE_BOOST_CONFIG=Object.freeze({
  enabled:true,
  modes:Object.freeze({soloRace:true,multiplayerRace:true}),
  unlockLap:1,unlockProgress:.50,rechargeSeconds:10,maxStoredCharges:1,
  activationKey:'Space',durationSeconds:2.5,
  accelerationMultiplier:1.35,torqueMultiplier:1.35,maxSpeedMultiplier:1.08,
  resetRechargeWhenNoLongerLast:true,removeStoredBoostWhenNoLongerLast:true,
  allowActiveBoostToFinishAfterOvertake:true,
  rampInSeconds:.18,rampOutSeconds:.3,
});
const clamp01=n=>Math.max(0,Math.min(1,n));
export function boostStrength(state,now,config=LAST_PLACE_BOOST_CONFIG) {
  if(state?.state!=='ACTIVE'||!Number.isFinite(state.startTime)||!Number.isFinite(state.endTime)||now<state.startTime||now>=state.endTime)return 0;
  const fade=Math.min(clamp01((now-state.startTime)/(config.rampInSeconds*1000)),clamp01((state.endTime-now)/(config.rampOutSeconds*1000)));
  return fade*fade*(3-2*fade);
}

// The same state machine runs in the solo simulation and on the LAN server.
// Ordered rows must use validated circuit progress (completed laps + sector).
export class LastPlaceBoostManager {
  constructor(raceId,mode,config=LAST_PLACE_BOOST_CONFIG) {
    this.raceId=raceId;this.config={...LAST_PLACE_BOOST_CONFIG,...config,modes:{...LAST_PLACE_BOOST_CONFIG.modes,...config.modes}};
    this.enabled=this.config.enabled&&!!this.config.modes[mode];this.players=new Map();
    this.boostSystemUnlocked=false;this.lastPlacePlayerId=null;this.leaderProgress=0;this.totalRacers=0;this.now=0;this.racing=false;this.activationCount=0;
  }
  update(now,rows,racing=true) {
    this.now=Math.max(this.now,now);now=this.now;this.racing=racing&&this.enabled;
    const participants=rows.filter(r=>!r.disconnected&&!r.dnf);
    this.totalRacers=participants.length;this.leaderProgress=Math.max(0,...participants.map(r=>r.progress??0));
    if(this.racing&&this.leaderProgress>=this.config.unlockLap-1+this.config.unlockProgress)this.boostSystemUnlocked=true;
    const oldLast=this.lastPlacePlayerId,last=participants.at(-1);
    this.lastPlacePlayerId=this.racing&&this.boostSystemUnlocked&&participants.length>=2&&last?.finishTime===null?last.id:null;
    const present=new Set(rows.map(r=>r.id));
    for(const id of this.players.keys())if(!present.has(id))this.players.delete(id);
    for(const row of rows) {
      let p=this.players.get(row.id);
      if(!p){p={playerId:row.id,state:'LOCKED',chargeStartTime:null,startTime:null,endTime:null,activationCount:0};this.players.set(row.id,p);}
      const eligible=row.id===this.lastPlacePlayerId,canRace=this.racing&&!row.disconnected&&!row.dnf&&row.finishTime===null;
      const expiredAt=p.endTime;
      if(canRace&&p.state==='ACTIVE'&&now<p.endTime&&(eligible||this.config.allowActiveBoostToFinishAfterOvertake))continue;
      p.startTime=null;p.endTime=null;
      if(!eligible){p.state=this.boostSystemUnlocked?'INELIGIBLE':'LOCKED';p.chargeStartTime=null;continue;}
      if(p.chargeStartTime===null)p.chargeStartTime=expiredAt!==null&&expiredAt<=now&&oldLast===row.id?expiredAt:now;
      p.state=now-p.chargeStartTime+1e-6>=this.config.rechargeSeconds*1000?'READY':'CHARGING';
    }
  }
  activate(playerId) {
    const p=this.players.get(playerId);
    if(!this.racing||!this.boostSystemUnlocked||this.lastPlacePlayerId!==playerId||p?.state!=='READY')return null;
    p.state='ACTIVE';p.chargeStartTime=null;p.startTime=this.now;p.endTime=this.now+this.config.durationSeconds*1000;p.activationCount++;this.activationCount++;
    return {raceId:this.raceId,playerId,startTime:p.startTime,endTime:p.endTime,durationSeconds:this.config.durationSeconds,sequence:this.activationCount};
  }
  resetPlayer(playerId) {
    const p=this.players.get(playerId);if(!p)return;
    p.state=this.boostSystemUnlocked?'INELIGIBLE':'LOCKED';p.chargeStartTime=p.startTime=p.endTime=null;
  }
  stateFor(playerId,now=this.now) {
    const p=this.players.get(playerId);if(!p)return null;
    const charge=p.chargeStartTime===null?0:Math.max(0,Math.min(this.config.rechargeSeconds,(now-p.chargeStartTime)/1000));
    return {...p,eligible:playerId===this.lastPlacePlayerId,chargeSeconds:charge,chargeProgress:charge/this.config.rechargeSeconds,available:p.state==='READY',remainingSeconds:p.state==='ACTIVE'?Math.max(0,(p.endTime-now)/1000):0};
  }
  snapshot() {
    return {unlocked:this.boostSystemUnlocked,lastPlacePlayerId:this.lastPlacePlayerId,leaderProgress:this.leaderProgress,totalRacers:this.totalRacers,rechargeSeconds:this.config.rechargeSeconds,durationSeconds:this.config.durationSeconds,players:[...this.players.keys()].map(id=>this.stateFor(id))};
  }
}
