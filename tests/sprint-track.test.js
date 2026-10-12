import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { createTrack } from '../src/tracks/createTrack.js';
import { BikePhysics } from '../src/BikePhysics.js';
import { LapCheckpointSystem } from '../src/LapCheckpointSystem.js';
import { clamp,wrapAngle } from '../src/math.js';

test('Sprint is registered as map 06 with three tables and a compact layout',()=>{
  const track=createTrack('sprint');
  assert.equal(track.id,'sprint');assert.equal(track.number,'06');
  assert.ok(track.length>480&&track.length<650);
  assert.equal(track.features.filter(f=>f.kind==='jump').length,3);
  let previous=0,changes=0,maxCurve=0,clearance=Infinity;
  for(let m=0;m<track.length;m+=2){const k=track.signedCurvature(m/track.length);maxCurve=Math.max(maxCurve,Math.abs(k));if(Math.abs(k)>.015){const sign=Math.sign(k);if(previous&&previous!==sign)changes++;previous=sign;}}
  assert.ok(changes>=4,'real alternating corners instead of an oval');
  assert.ok(maxCurve>.07,'a technical hairpin requires braking');
  for(let i=0;i<track.count;i+=5)for(let j=i+5;j<track.count;j+=5){
    if(Math.min(j-i,track.count-j+i)*track.length/track.count<35)continue;
    const a=track.samples[i],b=track.samples[j];
    clearance=Math.min(clearance,Math.hypot(a.x-b.x,a.z-b.z)-(track.widthAt(i/track.count)+track.widthAt(j/track.count))/2);
  }
  assert.ok(clearance>2,'neighbouring branches stay physically separated');
});
test('Sculpted road and shoulders have no folds or terrain protruding through the racing line',async()=>{
  await RAPIER.init();const world=new RAPIER.World({x:0,y:-9.81,z:0}),t=createTrack('sprint');
  try {
    t.build(new THREE.Scene(),world,RAPIER);
    for(const name of ['sprint-road','sprint-shoulders']) {
      const g=t.group.getObjectByName(name).geometry,p=g.attributes.position,ix=g.index;
      for(let i=0;i<ix.count;i+=3) {
        const a=ix.getX(i),b=ix.getX(i+1),c=ix.getX(i+2);
        const up=(p.getZ(b)-p.getZ(a))*(p.getX(c)-p.getX(a))-(p.getX(b)-p.getX(a))*(p.getZ(c)-p.getZ(a));
        assert.ok(up>0,`${name} folded at triangle ${i/3}`);
      }
    }
    for(let u=0;u<1;u+=.004)for(const fraction of [-.8,0,.8]) {
      const at=t.at(u),side=fraction*t.widthAt(u)/2,expected=t.surfaceHeightAt(u,side)+.035;
      const ray=new RAPIER.Ray({x:at.position.x+Math.cos(at.yaw)*side,y:expected+4,z:at.position.z-Math.sin(at.yaw)*side},{x:0,y:-1,z:0});
      let height=-Infinity;
      world.forEachCollider(c=>{const hit=c.castRay(ray,20,true);if(hit>=0)height=Math.max(height,expected+4-hit);});
      assert.ok(Math.abs(height-expected)<.13,`surface mismatch ${u}, ${side}: ${height-expected}`);
    }
  } finally {world.free();}
});

test('Sprint delivers two valid 40-50 second laps without resets',async()=>{
  await RAPIER.init();const world=new RAPIER.World({x:0,y:-9.81,z:0}),t=createTrack('sprint');world.timestep=1/120;
  try {
    t.build(new THREE.Scene(),world,RAPIER);
    const bike=new BikePhysics(RAPIER,world);bike.reset(t.at(0));
    const timing=new LapCheckpointSystem(t);let progress=0,lastU=0,lap=null,maxOffset=0,maxAir=0;const lapTimes=[];let worst=null;
    const airborneTables=new Set();
    for(let i=0;i<36000&&progress<2.01;i++) {
      const near=t.nearest(bike.position.x,bike.position.z),v=Math.max(1,bike.speed);
      let du=near.u-lastU;if(du<-.5)du++;if(du>.5)du--;progress+=du;lastU=near.u;
      const look=clamp(v*.85,4,13),target=t.at(near.u+look/t.length),vel=bike.body.linvel();
      const angle=wrapAngle(Math.atan2(target.position.x-bike.position.x,target.position.z-bike.position.z)-bike.yaw-wrapAngle(Math.atan2(vel.x,vel.z)-bike.yaw)*.45);
      const steering=Math.atan(2*1.7*Math.sin(angle)/look/Math.max(.6,bike.grip));
      const maxSteer=.5/(1+(Math.abs(bike.speed)/10)**1.25)+.025;
      const curve=Math.max(...[0,6,12,18].map(d=>t.curvature(near.u+d/t.length)));
      const speed=clamp(Math.sqrt(5/Math.max(.008,curve)),8,22);
      bike.beforeStep(1/120,{throttle:clamp((speed-bike.speed)*.9,0,1),brake:clamp((bike.speed-speed)*.3,0,1),steer:clamp(steering/maxSteer,-1,1)},1,true);
      world.step();bike.afterStep();
      const event=timing.update(bike.position);if(event?.lap){lap=event;lapTimes.push((i+event.fraction)/120);assert.ok(event.valid);}
      if(near.distance>maxOffset)worst={u:near.u,speed:bike.speed};maxOffset=Math.max(maxOffset,near.distance);maxAir=Math.max(maxAir,bike.airTime);
      if(bike.airTime>.15)for(const f of t.features) {
        const distance=((near.u-f.start+1)%1)*t.length;
        if(f.kind==='jump'&&distance<(f.rise+f.top+f.fall)*t.length+10)airborneTables.add(f.label);
      }
    }
    console.log({progress,maxOffset,maxAir,lapTimes,worst,airborneTables:[...airborneTables]});
    assert.equal(lapTimes.length,2);
    for(const time of [lapTimes[0],lapTimes[1]-lapTimes[0]])assert.ok(time>=40&&time<=50,`Lap takes ${time.toFixed(2)} s`);
    assert.ok(progress>=1,'complete circuit');assert.ok(lap?.valid,'all checkpoints passed in order');
    assert.ok(maxOffset<4.8,'remain on the racing surface');assert.ok(maxAir>.5,'tables produce substantial flights');
    assert.equal(airborneTables.size,3,'each of the three tables produces a distinct flight');
  } finally {world.free();}
});
