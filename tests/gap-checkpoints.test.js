import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GapTrack } from '../src/tracks/GapTrack.js';
import { LapCheckpointSystem } from '../src/LapCheckpointSystem.js';
import { CheckpointSystem } from '../src/CheckpointSystem.js';
import { CheckpointRecovery } from '../shared/checkpointRecovery.js';
import { BikePhysics } from '../src/BikePhysics.js';
import { RaceManager } from '../server/RaceManager.js';

const track=new GapTrack();
const distance=(a,b)=>Math.abs(((a-b+1.5)%1)-.5)*track.length;
function point(m,lane=0,height=.96) {
  const at=track.at(m/track.length),p=at.position.clone();
  p.x+=Math.cos(at.yaw)*lane;p.z-=Math.sin(at.yaw)*lane;p.y+=height;
  return p;
}
function fixture() {
  const timing=new LapCheckpointSystem(track),recovery=new CheckpointRecovery(timing),markers=new CheckpointSystem(track);
  return {timing,recovery,markers,laps:0,gates:[],step(p,now) {
    const near=track.nearest(p.x,p.z,p.y),event=timing.update(p,near);
    recovery.update(p,near,now,event);markers.update(p);
    if(event?.checkpoint)this.gates.push(event.index);
    if(event?.lap){this.laps++;this.gates.push(0);}
    return event;
  }};
}

test('All three underpasses keep the correct road across its full width and suspension heights',()=>{
  for(const gap of track.gaps)for(const lane of [-11.8,-8,0,8,11.8])for(const height of [.6,.96,1.5]) {
    for(let d=-30;d<=30;d+=.75) {
      const m=gap.underpassU*track.length+d,p=point(m,lane,height),near=track.nearestCheckpoint(p);
      assert.ok(distance(near.u,m/track.length)<1,JSON.stringify({gap:gap.id,lane,height,d,wrongRoad:near.u}));
    }
  }
});

test('Two complete solo laps validate all ten gates without false recovery, on both edges and while weaving',()=>{
  for(const speed of [12,30,45])for(const lane of [-11.8,-8,0,8,11.8,'weave']) {
    const f=fixture(),step=speed/30;
    for(let m=.01;m<track.length*2+step;m+=step) {
      const side=lane==='weave'?11*Math.sin(m/25):lane;
      f.step(point(m,side),m/speed*1000);
      assert.equal(f.recovery.pending,null,JSON.stringify({lane,speed,lap:Math.floor(m/track.length)+1,m:m%track.length,pending:f.recovery.pending}));
      assert.equal(f.timing.routeLost,false);
    }
    assert.equal(f.laps,2);
    assert.deepEqual(f.gates,[1,2,3,4,5,6,7,8,9,0,1,2,3,4,5,6,7,8,9,0]);
  }
});

test('LAN validates two laps on both edges, including below jump 2, without reset or ranking jumps',()=>{
  for(const lane of [-11,11]) {
    const race=new RaceManager(track,[{id:'r',name:'Test',color:'#fff'}],2,10000,{countdownMs:0});
    race.loaded('r',10000);const r=race.records.get('r');let progress=0;
    for(let seq=0;r.finishTime===null&&seq<4000;seq++) {
      const m=-2+seq*1.1,side=-1.4+(lane+1.4)*Math.min(1,(m+2)/30),p=point(m,side),now=10000+seq*50;
      assert.ok(race.accept('r',{seq,resetVersion:0,position:p.toArray(),velocity:[0,0,0]},now),`packet ${seq}`);
      race.tick(now);
      assert.equal(r.checkpointRecovery.pending,null,JSON.stringify({lane,m:m%track.length,lap:r.completedLaps+1}));
      assert.equal(r.resetVersion,0);assert.equal(race.resetEvents.length,0);
      assert.ok(r.progress>=progress-1e-6&&r.progress-progress<.01,'continuous ranking through stacked roads');
      progress=r.progress;
    }
    assert.equal(r.completedLaps,2);assert.equal(r.lapTimes.length,2);assert.equal(race.finished,true);
  }
});

test('Skipping each timing gate on lap 2 still requires recovery and cannot award a lap',()=>{
  for(let index=0;index<10;index++) {
    const f=fixture(),target=index===0?track.length:track.timingUs[index]*track.length;
    for(let m=.01;m<track.length+target+5;m+=1) {
      const remaining=m-track.length-target,side=15*Math.max(0,1-Math.abs(remaining)/30);
      f.step(point(m,side),m*50);
    }
    assert.equal(f.laps,1,`gate ${index}`);assert.equal(f.timing.next,index);
    assert.equal(f.recovery.pending?.index,index);assert.ok(f.recovery.due(f.recovery.pending.deadline));
    const spawn=f.recovery.spawn();assert.ok(!track.isGap(spawn.u));
    assert.ok(distance(spawn.u,track.timingUs[index])>=3.99);
    f.timing.resetPosition(spawn.position,spawn.u);assert.equal(f.timing.next,index);
  }
});

test('Dropping from any jump onto its lower road still starts recovery instead of accepting a shortcut',()=>{
  for(const gap of track.gaps) {
    const f=fixture(),m=(gap.takeoffU+gap.landingU)/2*track.length;
    f.timing.passed=f.timing.gates.findLastIndex(g=>g.u<gap.takeoffU);
    f.step(point(m-1),1000);f.step(point(m),1050);
    const lower=track.at(gap.underpassU).position.clone();lower.y+=.96;
    f.step(lower,1100);
    assert.equal(f.timing.routeLost,true,`jump ${gap.id}`);
    assert.ok(f.recovery.pending);assert.equal(f.laps,0);
  }
});

test('Real Rapier trajectories cross below all jumps and fly over them without false recovery',async()=>{
  await RAPIER.init();
  const world=new RAPIER.World({x:0,y:-9.81,z:0});world.timestep=1/120;
  track.build(new THREE.Scene(),world,RAPIER);
  const bike=new BikePhysics(RAPIER,world);
  try {
    for(const gap of track.gaps)for(const flying of [false,true])for(const lane of [-8,0,8])for(const speed of [21,32,36]) {
      const spawn=track.at((flying?gap.takeoffU:gap.underpassU)-(flying?12:25)/track.length);
      spawn.position.x+=Math.cos(spawn.yaw)*lane;spawn.position.z-=Math.sin(spawn.yaw)*lane;
      bike.reset(spawn);bike.body.setLinvel({x:Math.sin(spawn.yaw)*speed,y:Math.tan(spawn.pitch)*speed,z:Math.cos(spawn.yaw)*speed},true);
      const f=fixture();f.timing.passed=f.timing.gates.findLastIndex(g=>g.u<=spawn.u);
      f.timing.resetPosition(bike.position,spawn.u);
      let airtime=0,finished=false;
      for(let i=0;i<1200;i++) {
        bike.beforeStep(1/120,{throttle:1,brake:0,steer:0});world.step();bike.afterStep();
        f.step(bike.position,i/120*1000);
        const label=JSON.stringify({gap:gap.id,flying,lane,speed,i,p:bike.position.toArray(),pending:f.recovery.pending});
        assert.equal(f.recovery.pending,null,label);
        assert.equal(f.timing.routeLost,false,label);
        const near=track.nearestCheckpoint(bike.position);
        if(!flying&&near.u>gap.underpassU+22/track.length){finished=true;break;}
        if(flying){if(!bike.grounded)airtime+=1/120;else if(airtime>.4){finished=true;break;}}
      }
      assert.ok(finished,JSON.stringify({gap:gap.id,flying,lane,speed}));
    }
  }finally{world.free();}
});
