import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { BikePhysics } from '../src/BikePhysics.js';
import { boostStrength } from '../shared/lastPlaceBoost.js';
await RAPIER.init();const dt=1/120;
function setup(y=0) {
  const world=new RAPIER.World({x:0,y:-9.81,z:0});world.timestep=dt;
  world.createCollider(RAPIER.ColliderDesc.cuboid(1000,.5,1000).setTranslation(0,-.5,0));
  const bike=new BikePhysics(RAPIER,world);bike.reset({position:new THREE.Vector3(0,y,0),yaw:0});
  const step=(boost=0,input={throttle:1,brake:0,steer:0})=>{bike.beforeStep(dt,input,1,true,boost);world.step();bike.afterStep();};
  return {world,bike,step};
}
test('Boost produces extra acceleration through grounded tire forces, with no instant velocity change',()=>{
  const a=setup(),b=setup();
  try {
    for(let i=0;i<600;i++){a.step();b.step();}
    const initial=b.bike.body.linvel();b.bike.beforeStep(dt,{throttle:1,brake:0,steer:0},1,true,1);
    assert.deepEqual(b.bike.body.linvel(),initial,'forces wait for the Rapier step');
    const active={state:'ACTIVE',startTime:0,endTime:2500};let maxDelta=0;
    for(let i=0;i<300;i++){const before=b.bike.body.linvel().z;a.step();b.step(boostStrength(active,i*dt*1000));maxDelta=Math.max(maxDelta,b.bike.body.linvel().z-before);}
    const gain=b.bike.speed-a.bike.speed;assert.ok(gain>.5&&gain<4,`speed gain ${gain}`);assert.ok(maxDelta<.08,`per-step gain ${maxDelta}`);
    assert.ok(Math.abs(b.bike.pitch)<.3);assert.ok(b.bike.wheels[1].grounded);
    console.log(`Boost speed gain: ${(gain*3.6).toFixed(2)} km/h; max step: ${maxDelta.toFixed(4)} m/s`);
  }finally{a.world.free();b.world.free();}
});
test('Airborne boost never adds horizontal acceleration and has no effect with a released throttle',()=>{
  const a=setup(30),b=setup(30);
  try {
    for(const r of [a,b])r.bike.body.setLinvel({x:0,y:0,z:10},true);
    for(let i=0;i<100;i++){a.step();b.step(1);assert.deepEqual(b.bike.position,a.bike.position);}
    assert.equal(b.bike.wheels[1].grounded,false);
  }finally{a.world.free();b.world.free();}
  const c=setup(),d=setup();
  try{for(let i=0;i<250;i++){c.step(0,{throttle:0,brake:0,steer:0});d.step(1,{throttle:0,brake:0,steer:0});}assert.deepEqual(c.bike.position,d.bike.position);}
  finally{c.world.free();d.world.free();}
});
