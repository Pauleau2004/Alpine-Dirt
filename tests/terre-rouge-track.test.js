import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { createTrack } from '../src/tracks/createTrack.js';
import { BikePhysics } from '../src/BikePhysics.js';
import { LapCheckpointSystem } from '../src/LapCheckpointSystem.js';
import { clamp,wrapAngle } from '../src/math.js';

const track=createTrack('terrerouge');
test('Terre Rouge has six tables, two rhythms, a double wave and a compression',()=>{
  assert.equal(track.id,'terrerouge');
  assert.equal(track.features.filter(f=>f.kind==='jump').length,6);
  assert.equal(track.features.filter(f=>f.kind==='roller').length,9);
  assert.equal(track.features.filter(f=>f.kind==='compression').length,1);
  const heights=track.samples.map(p=>p.y);
  assert.ok(Math.max(...heights)-Math.min(...heights)>16);
  assert.ok(track.berms.length>=5);
  assert.ok(track.widthAt(track.landmarks.narrow)<9);
  for(const f of track.features)for(let m=0;m<(f.rise+f.top+f.fall)*track.length+10;m+=2) {
    assert.ok(track.curvature(f.start+m/track.length)<.025,'jumps and whoops stay clear of tight corners');
  }
  let clearance=Infinity;
  for(let i=0;i<track.count;i+=5)for(let j=i+5;j<track.count;j+=5) {
    if(Math.min(j-i,track.count-j+i)*track.length/track.count<40)continue;
    const a=track.samples[i],b=track.samples[j];
    clearance=Math.min(clearance,Math.hypot(a.x-b.x,a.z-b.z)-(track.widthAt(i/track.count)+track.widthAt(j/track.count))/2);
  }
  assert.ok(clearance>3,`separate lane edges: ${clearance.toFixed(2)} m`);
});

test('Sculpted road and shoulders have no folds or terrain protruding through the racing line',async()=>{
  await RAPIER.init();const world=new RAPIER.World({x:0,y:-9.81,z:0}),t=createTrack('terrerouge');
  try {
    t.build(new THREE.Scene(),world,RAPIER);
    for(const name of ['terre-rouge-road','terre-rouge-shoulders']) {
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

test('The technical circuit can be ridden for a validated lap without resets',async()=>{
  await RAPIER.init();const world=new RAPIER.World({x:0,y:-9.81,z:0}),t=createTrack('terrerouge');world.timestep=1/120;
  try {
    t.build(new THREE.Scene(),world,RAPIER);
    const bike=new BikePhysics(RAPIER,world);bike.reset(t.at(0));
    const timing=new LapCheckpointSystem(t);let progress=0,lastU=0,lap=null,maxOffset=0,maxAir=0;
    const airborneTables=new Set();
    for(let i=0;i<36000&&progress<1.01;i++) {
      const near=t.nearest(bike.position.x,bike.position.z),v=Math.max(1,bike.speed);
      let du=near.u-lastU;if(du<-.5)du++;if(du>.5)du--;progress+=du;lastU=near.u;
      const look=clamp(v*.85,4,13),target=t.at(near.u+look/t.length),vel=bike.body.linvel();
      const angle=wrapAngle(Math.atan2(target.position.x-bike.position.x,target.position.z-bike.position.z)-bike.yaw-wrapAngle(Math.atan2(vel.x,vel.z)-bike.yaw)*.45);
      const steering=Math.atan(2*1.7*Math.sin(angle)/look/Math.max(.6,bike.grip));
      const maxSteer=.5/(1+(Math.abs(bike.speed)/10)**1.25)+.025;
      const curve=Math.max(...[0,6,12,18].map(d=>t.curvature(near.u+d/t.length)));
      const speed=clamp(Math.sqrt(4/Math.max(.01,curve)),5,18);
      bike.beforeStep(1/120,{throttle:clamp((speed-bike.speed)*.9,0,1),brake:clamp((bike.speed-speed)*.3,0,1),steer:clamp(steering/maxSteer,-1,1)},1,true);
      world.step();bike.afterStep();
      const event=timing.update(bike.position);if(event?.lap)lap=event;
      maxOffset=Math.max(maxOffset,near.distance);maxAir=Math.max(maxAir,bike.airTime);
      if(bike.airTime>.15)for(const f of t.features) {
        const distance=((near.u-f.start+1)%1)*t.length;
        if(f.kind==='jump'&&distance<(f.rise+f.top+f.fall)*t.length+10)airborneTables.add(f.label);
      }
    }
    console.log({progress,maxOffset,maxAir,lap});
    assert.ok(progress>=1,'complete circuit');assert.ok(lap?.valid,'all checkpoints passed in order');
    assert.ok(maxOffset<4.3,'remain on the racing surface');assert.ok(maxAir>.5,'tables produce substantial flights');
    assert.equal(airborneTables.size,6,'each of the six tables produces a distinct flight');
  } finally {world.free();}
});
