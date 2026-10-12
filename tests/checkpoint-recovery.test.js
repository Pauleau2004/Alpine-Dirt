import test from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../src/Track.js';
import { LapCheckpointSystem } from '../src/LapCheckpointSystem.js';
import { CheckpointSystem } from '../src/CheckpointSystem.js';
import { TimeTrial } from '../src/TimeTrial.js';
import { CheckpointRecovery,resetRecoveryMarker } from '../shared/checkpointRecovery.js';
import { RaceManager } from '../server/RaceManager.js';

const wrap=u=>((u%1)+1)%1;
function fixture(track=new Track()) {
  const timing=new LapCheckpointSystem(track),recovery=new CheckpointRecovery(timing);
  return {track,timing,recovery,step(u,now,{side=0,height=1,active=true}={}) {
    const at=track.at(u),p=at.position.clone();p.x+=Math.cos(at.yaw)*side;p.z-=Math.sin(at.yaw)*side;p.y+=height;
    const near=track.nearest(p.x,p.z,p.y),event=timing.update(p,near);recovery.update(p,near,now,event,active);
    return {p,near,event};
  }};
}
function miss(f,index=1,now=1000) {
  f.timing.passed=index===0?9:index-1;
  const u=f.timing.gates[index].u;
  f.step(u-2/f.track.length,now,{side:10});
  f.step(u+2/f.track.length,now+100,{side:10});
  assert.equal(f.recovery.pending?.index,index);
}

test('A missed gate starts one 3 s deadline; waiting and continuing cannot extend it',()=>{
  const f=fixture();miss(f);
  assert.equal(f.recovery.pending.deadline,4100);
  f.step(.11,2000,{side:10});f.step(.11,4000,{side:10});
  assert.equal(f.recovery.pending.deadline,4100);
  assert.equal(f.recovery.due(4099),false);assert.equal(f.recovery.due(4100),true);
});
test('Waiting before a gate, reversing, practice and the flying start never trigger a return',()=>{
  const f=fixture();
  f.step(.095,0);f.step(.095,30000);f.step(.09,40000);assert.equal(f.recovery.pending,null);
  f.step(.099,41000,{side:10,active:false});f.step(.101,42000,{side:10,active:false});assert.equal(f.recovery.pending,null);
  f.timing.setLaunching();f.step(.3,50000,{side:10});f.step(.31,60000,{side:10});assert.equal(f.recovery.pending,null);
});
test('Passing the expected gate in time cancels recovery, but returning behind it alone does not',()=>{
  const f=fixture();miss(f);
  f.step(.1-2/f.track.length,2100,{side:10});assert.ok(f.recovery.pending);
  f.step(.1-2/f.track.length,2200,{side:3});
  f.step(.1+2/f.track.length,2300,{side:3});
  assert.equal(f.timing.next,2);assert.equal(f.recovery.pending,null);assert.equal(f.recovery.due(10000),false);
});
test('All ten missed gates respawn before the gate without awarding it or resetting elapsed time',()=>{
  for(let index=0;index<10;index++) {
    const f=fixture(),trial=new TimeTrial(null),markers=new CheckpointSystem(f.track);
    trial.reset('trial');trial.update(20,null);miss(f,index);
    const spawn=f.recovery.spawn();assert.ok(Math.abs(wrap(f.timing.gates[index].u-spawn.u)*f.track.length-4)<1e-6);
    f.timing.resetPosition(spawn.position,spawn.u);resetRecoveryMarker(markers,spawn,spawn.position);f.recovery.reset();
    assert.equal(f.timing.next,index);assert.equal(trial.lapTime,20);
    assert.ok(markers.respawn().u<=spawn.u);
    f.step(spawn.u,4100);assert.equal(f.recovery.pending,null);
  }
});
test('Strict-route lane cuts are detected even without crossing the missed gate plane',()=>{
  const f=fixture();f.step(.03,1000);
  f.timing.routeLost=true;
  f.recovery.update(f.track.at(.2).position,{u:.2},1100);
  assert.equal(f.recovery.pending.index,1);
});
test('A gate near a void returns to the run-up instead of the gap or an unusable landing',()=>{
  const f=fixture();f.track.gaps=[{takeoffU:.08,landingU:.11}];miss(f);
  assert.ok(Math.abs(f.recovery.spawn().u-(.08-30/f.track.length))<1e-8);
});

function raceFixture() {
  let now=10000,seq=0;
  const track=new Track(),race=new RaceManager(track,[{id:'rider',name:'Pilote A',color:'#fff'}],2,now,{countdownMs:0});race.loaded('rider',now);
  const r=race.records.get('rider');
  return {race,r,track,get now(){return now;},set now(value){now=value;},drive(u,side=0,ms=50,version=r.resetVersion) {
    now+=ms;const at=track.at(u),p=at.position.clone();p.y+=.96;p.x+=Math.cos(at.yaw)*side;p.z-=Math.sin(at.yaw)*side;
    const state={position:p.toArray(),velocity:[0,0,0],rotation:[0,0,0,1],grounded:true,seq:seq++,resetVersion:version,collisionAck:r.collision?.revision??0};
    assert.equal(race.accept('rider',state,now),true,`state u=${u}`);return state;
  }};
}
function driveMiss(f) {
  for(let u=-2/f.track.length;u<.106;u+=.001) {
    const offset=10*Math.max(0,1-Math.abs(u-.1)/.02);f.drive(u,offset);
  }
  assert.equal(f.r.timing.next,1);assert.ok(f.r.checkpointRecovery.pending);
}
test('LAN forces the return at 3 s even without new packets; reset is broadcast once and rejects stale packets',()=>{
  const f=raceFixture();driveMiss(f);const {race,r}=f,pending=r.checkpointRecovery.snapshot(),lapStartedAt=r.lapStartedAt;
  race.tick(pending.deadline-1);assert.equal(r.resetVersion,0);
  race.tick(pending.deadline);assert.equal(r.resetVersion,1);assert.equal(race.resetEvents.length,1);
  assert.equal(race.resetEvents[0].reason,'checkpoint');assert.equal(race.resetEvents[0].checkpoint,1);
  assert.equal(r.checkpointRecovery.pending,null);assert.equal(r.timing.next,1);assert.equal(r.completedLaps,0);assert.equal(r.lapStartedAt,lapStartedAt);
  assert.equal(r.state,null);assert.equal(r.position.y,r.spawn.position[1]+.96);
  assert.equal(r.checkpointProtectionUntil,pending.deadline+1000);
  assert.equal(race.accept(r.id,{seq:9999,position:r.position.toArray(),velocity:[0,0,0],resetVersion:0},pending.deadline+100),false);
  race.tick(pending.deadline+10);assert.equal(race.resetEvents.length,1);
  f.now=pending.deadline;
  f.drive(r.spawn.u);assert.equal(race.collisions.view(r,f.now),null);
  assert.ok(race.collisions.view(r,pending.deadline+1000),'solid again after 1 second');
  for(let u=r.spawn.u+.001;u<.103;u+=.001)f.drive(u);
  assert.equal(r.timing.next,2,'the recovered gate still requires a real crossing');
});
test('LAN detects a skipped start, including a first accepted packet beyond the grid gate',()=>{
  const f=raceFixture(),gate=f.track.at(0);
  f.r.position.copy(gate.position).addScaledVector(gate.tangent,-1);f.r.position.y+=.96;
  f.r.position.x+=Math.cos(gate.yaw)*10;f.r.position.z-=Math.sin(gate.yaw)*10;
  f.drive(1/f.track.length,10,100);
  assert.equal(f.r.started,false);assert.equal(f.r.checkpointRecovery.pending?.index,0);
});
test('Disconnect, completed race and ordinary resets clear or avoid checkpoint protection',()=>{
  for(const action of ['disconnect','finish','reset']) {
    const f=raceFixture();driveMiss(f);const deadline=f.r.checkpointRecovery.pending.deadline;
    if(action==='disconnect')f.race.disconnect(f.r.id,false,f.now);
    if(action==='finish')f.r.finishTime=30;
    if(action==='reset'){f.r.checkpointRecovery.reset();f.race.resetPlayer(f.r.id,f.now);assert.equal(f.r.checkpointProtectionUntil,0);}
    f.race.tick(deadline+1);assert.equal(f.r.checkpointRecovery.pending,null);assert.equal(f.race.resetEvents.length,0);
  }
});
