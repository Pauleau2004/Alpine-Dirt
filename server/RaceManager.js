import { randomUUID } from 'node:crypto';
import * as THREE from 'three';
import { CheckpointSystem } from '../src/CheckpointSystem.js';
import { LapCheckpointSystem } from '../src/LapCheckpointSystem.js';
import { gateCrossing } from '../src/gateCrossing.js';
import { gridSpawn,serializeSpawn } from '../shared/multiplayer.js';
import { PlayerCollisionSystem } from './PlayerCollisionSystem.js';
import { LastPlaceBoostManager } from '../shared/lastPlaceBoost.js';
import { CheckpointRecovery,CHECKPOINT_RECOVERY_CONFIG,resetRecoveryMarker } from '../shared/checkpointRecovery.js';
import { MovementGuard } from './MovementGuard.js';
import { checkpointRouteNear } from '../shared/checkpointRoute.js';

export class RaceManager {
  constructor(track,players,laps,now,{countdownMs=3000,finishTimeoutMs=60000,recordStore=null}={}) {
    this.id=randomUUID();this.track=track;this.laps=laps;this.createdAt=now;
    this.countdownMs=countdownMs;this.finishTimeoutMs=finishTimeoutMs;this.recordStore=recordStore;
    this.startAt=null;this.deadline=null;this.finished=false;this.records=new Map();this.collisions=new PlayerCollisionSystem(this.id);
    this.boost=new LastPlaceBoostManager(this.id,'multiplayerRace');
    this.resetEvents=[];
    players.forEach((player,index)=>{
      const spawn=gridSpawn(track,index),position=spawn.position.clone();position.y+=.96;
      this.records.set(player.id,{id:player.id,name:player.name,color:player.color,spawn:serializeSpawn(spawn),position,state:null,lastAt:now,lastSeq:-1,resetVersion:0,resetAt:0,loaded:false,started:false,completedLaps:0,lapTimes:[],lapBoosted:[],boostUsedInLap:false,lapStartedAt:null,finishTime:null,finishAt:null,dnf:false,disconnected:false,nearU:0,progress:0,respawn:new CheckpointSystem(track),timing:new LapCheckpointSystem(track)});
    });
    for(const r of this.records.values()){r.checkpointRecovery=new CheckpointRecovery(r.timing);r.movement=new MovementGuard(now);r.rejectedMovement=0;}
  }
  loaded(id,now) {
    const r=this.records.get(id);if(r)r.loaded=true;
    if(this.startAt===null&&[...this.records.values()].filter(r=>!r.disconnected).every(r=>r.loaded)){
      this.startAt=now+this.countdownMs;for(const racer of this.records.values())racer.movement.reset(this.startAt);
    }
  }
  tick(now) {
    if(this.startAt===null)return [];
    if(this.deadline!==null&&now>=this.deadline)for(const r of this.records.values())if(r.finishTime===null)r.dnf=true;
    if([...this.records.values()].every(r=>r.finishTime!==null||r.dnf))this.finished=true;
    for(const r of this.records.values()) {
      if(this.finished||r.disconnected||r.dnf||r.finishTime!==null)r.checkpointRecovery.reset();
      else if(now>=this.startAt&&r.checkpointRecovery.due(now)){
        const result=this.resetPlayer(r.id,now);
        if(result)this.resetEvents.push({raceId:this.id,playerId:r.id,...result});
      }
    }
    this.updateBoost(now);
    return !this.finished&&now>=this.startAt?this.collisions.update(this.records,now):[];
  }
  accept(id,state,now) {
    const r=this.records.get(id);
    if(!r||!r.loaded||r.disconnected||this.startAt===null||now<this.startAt||r.finishTime!==null||r.dnf||state.seq<=r.lastSeq)return false;
    const rebased=this.collisions.rebase(r,state);if(!rebased)return false;
    const position=new THREE.Vector3(...rebased.position),previousPosition=r.position.clone();
    if(!r.movement.accept(position.distanceTo(r.position),now)){
      if(++r.rejectedMovement>=6){const result=this.resetPlayer(id,now,'invalid-state');if(result)this.resetEvents.push({raceId:this.id,playerId:id,...result});}
      return false;
    }
    r.rejectedMovement=0;
    state=this.collisions.constrain(this.records,id,state,now);if(!state)return false;
    position.fromArray(state.position);
    // Stacked routes need the rider's height to rank and validate the correct branch.
    const near=checkpointRouteNear(this.track,position,(this.track.id==='gaptrack'||this.track.altitudeAware)
      ?this.track.nearest(position.x,position.z,position.y)
      :this.track.nearest(position.x,position.z));
    if(!r.checkpointRecovery.previous) {
      const beforeNear=this.track.nearest(previousPosition.x,previousPosition.z,previousPosition.y);
      r.checkpointRecovery.update(previousPosition,beforeNear,now,null,r.loaded,r.started?r.timing.next:0);
    }
    r.respawn.previous=previousPosition;
    r.respawn.update(position);
    let event=null;
    if(!r.started) {
      const fraction=gateCrossing(previousPosition,position,r.timing.gates[0],this.track.width/2+.6);
      if(fraction!==null){r.started=true;r.lapStartedAt=this.startAt;event={launchCompleted:true};}
      r.timing.previous={...position};
    } else {
      r.timing.previous=previousPosition;
      event=r.timing.update(position,near);
      if(event?.lap) {
        const crossedAt=r.lastAt+(now-r.lastAt)*event.fraction;
        r.completedLaps++;r.lapTimes.push((crossedAt-r.lapStartedAt)/1000);r.lapBoosted.push(r.boostUsedInLap);r.lapStartedAt=crossedAt;
        if(!r.boostUsedInLap)this.recordStore?.submit(r.lapTimes.at(-1),r.name,now);
        const boostActive=this.boost.stateFor(r.id,crossedAt)?.state==='ACTIVE';
        r.boostUsedInLap=boostActive;
        if(r.completedLaps>=this.laps){r.finishAt=crossedAt;r.finishTime=(crossedAt-this.startAt)/1000;this.deadline??=now+this.finishTimeoutMs;}
      }
    }
    r.nearU=near.u;
    // Ranking is bounded by the last of the ten ordered gates earned.
    r.progress=r.completedLaps+(r.started?r.timing.progressAt(r.nearU):0);
    r.position.copy(position);r.state=state;r.lastAt=now;r.lastSeq=state.seq;
    r.checkpointRecovery.update(position,near,now,event,r.loaded&&!r.disconnected&&r.finishTime===null&&!r.dnf,r.started?r.timing.next:0);
    this.updateBoost(now);
    return true;
  }
  resetPlayer(id,now,reason=null) {
    const r=this.records.get(id);if(!r||r.finishTime!==null||r.dnf||now-r.resetAt<700)return null;
    const missed=r.checkpointRecovery.pending,spawn=r.checkpointRecovery.spawn()??(r.started?r.respawn.respawn():gridSpawn(this.track,[...this.records.keys()].indexOf(id)));
    r.position.copy(spawn.position);r.position.y+=.96;r.state=null;r.lastAt=now;r.resetAt=now;r.resetVersion++;
    this.collisions.removePlayer(id);r.collisionGraceUntil=now+this.collisions.config.respawnGraceMs;
    r.checkpointProtectionUntil=missed?now+CHECKPOINT_RECOVERY_CONFIG.protectionMs:0;
    r.resetReason=reason??(missed?'checkpoint':null);r.resetCheckpoint=missed?.index??null;
    r.movement.reset(now);r.rejectedMovement=0;
    r.collision=null;r.collisionOffsets=null;r.collisionAt=0;
    r.spawn=serializeSpawn(spawn);
    r.respawn.resetPosition(r.position);r.timing.resetPosition(r.position,spawn.u);
    if(missed)resetRecoveryMarker(r.respawn,spawn,r.position);
    r.checkpointRecovery.reset();
    r.progress=r.completedLaps+(r.started?r.timing.progressAt(spawn.u):0);
    this.boost.resetPlayer(id);this.updateBoost(now);
    return {spawn:serializeSpawn(spawn),version:r.resetVersion,reason:r.resetReason,checkpoint:r.resetCheckpoint,protectionUntil:r.checkpointProtectionUntil};
  }
  disconnect(id,permanent=false,now=this.boost.now) {this.collisions.removePlayer(id);const r=this.records.get(id);if(r){r.disconnected=true;r.checkpointRecovery.reset();if(permanent&&r.finishTime===null)r.dnf=true;}this.boost.resetPlayer(id);this.updateBoost(now);}
  reconnect(id,now=Date.now()) {this.collisions.removePlayer(id);const r=this.records.get(id);if(r){r.disconnected=false;r.collisionGraceUntil=now+this.collisions.config.respawnGraceMs;}this.boost.resetPlayer(id);this.updateBoost(now);}
  updateBoost(now) {this.boost.update(now,this.standings().map(r=>({...r,finishTime:r.time})),this.startAt!==null&&now>=this.startAt&&!this.finished);}
  requestBoost(id,now) {this.updateBoost(now);const r=this.records.get(id),event=r?.loaded?this.boost.activate(id):null;if(event&&r)r.boostUsedInLap=true;return event?{...event,resetVersion:r.resetVersion}:null;}
  standings() {
    const list=[...this.records.values()].sort((a,b)=>{
      if(a.finishTime!==null||b.finishTime!==null){if(a.finishTime===null)return 1;if(b.finishTime===null)return -1;return a.finishTime-b.finishTime||a.id.localeCompare(b.id);}
      return Number(a.dnf)-Number(b.dnf)||b.progress-a.progress||a.id.localeCompare(b.id);
    });
    return list.map((r,i)=>{
      const bestLap=r.lapTimes.length?Math.min(...r.lapTimes):null;
      const bestLapIdx=bestLap!==null?r.lapTimes.indexOf(bestLap):-1;
      const bestLapBoosted=bestLapIdx!==-1?!!r.lapBoosted[bestLapIdx]:false;
      return {id:r.id,name:r.name,color:r.color,place:i+1,lap:Math.min(r.completedLaps+1,this.laps),completedLaps:r.completedLaps,timingPassed:r.timing.passed,timingCount:r.timing.gates.length,checkpointRecovery:r.checkpointRecovery.snapshot(),respawn:r.respawn.last,progress:r.progress,time:r.finishTime,bestLap,bestLapBoosted,disconnected:r.disconnected,dnf:r.dnf};
    });
  }
  snapshot(now) {
    return {id:this.id,mapId:this.track.id??'alpine',startAt:this.startAt,laps:this.laps,deadline:this.deadline,finished:this.finished,serverTime:now,record:this.recordStore?.record??null,records:this.recordStore?.records??[],recordSaveError:!!this.recordStore?.error,boost:this.boost.snapshot(),collisions:this.collisions.snapshot(),standings:this.standings(),players:[...this.records.values()].map(r=>({id:r.id,spawn:r.spawn,state:r.state,serverTime:Math.max(r.lastAt,r.collisionAt??0),collision:r.collision,finished:r.finishTime!==null,resetVersion:r.resetVersion,resetReason:r.resetReason,resetCheckpoint:r.resetCheckpoint,checkpointProtectionUntil:r.checkpointProtectionUntil??0,position:r.position.toArray(),disconnected:r.disconnected,dnf:r.dnf}))};
  }
}
