import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { BikePhysics } from '../src/BikePhysics.js';
import { Track } from '../src/Track.js';
import { CheckpointSystem } from '../src/CheckpointSystem.js';
import { LapCheckpointSystem } from '../src/LapCheckpointSystem.js';
import { TimeTrial } from '../src/TimeTrial.js';
import { clamp, wrapAngle } from '../src/math.js';

await RAPIER.init();
const dt=1/120;
const neutral={throttle:0,brake:0,steer:0};
function setup() {
  const world=new RAPIER.World({x:0,y:-9.81,z:0});world.timestep=dt;
  world.createCollider(RAPIER.ColliderDesc.cuboid(1000,0.5,1000).setTranslation(0,-0.5,0));
  const bike=new BikePhysics(RAPIER,world);
  bike.reset({position:new THREE.Vector3(),yaw:0});
  const step=(input=neutral)=>{bike.beforeStep(dt,input);world.step();bike.afterStep();};
  for(let i=0;i<240;i++)step();
  return {world,bike,step};
}
test('Suspension supports the chassis at rest without drift or oscillation',()=>{
  const {world,bike,step}=setup();const y=bike.position.y;
  for(let i=0;i<600;i++)step();
  assert.ok(Math.abs(bike.position.y-y)<0.01);
  assert.ok(bike.wheels.every(w=>w.grounded&&w.compression>0.02&&w.compression<0.09));
  assert.ok(Math.abs(bike.pitch)<0.02);
  world.free();
});
test('Progressive torque, braking, variable steering and assisted lean',()=>{
  const {world,bike,step}=setup();
  for(let i=0;i<60;i++)step({...neutral,throttle:1});const initial=bike.speed;
  for(let i=0;i<900;i++)step({...neutral,throttle:1});const fast=bike.speed;
  assert.ok(initial>0.1&&initial<4,`initial speed ${initial}`);
  assert.ok(fast>18&&fast<35,`top speed ${fast}`);
  for(let i=0;i<180;i++)step({...neutral,throttle:0.45,steer:0.55});
  assert.ok(bike.roll>0.12&&bike.roll<0.8,`lean ${bike.roll}`);
  const fastSteer=Math.abs(bike.steer);
  assert.ok(Math.abs(bike.pitch)<0.3);
  assert.ok(Number.isFinite(bike.position.x));
  const beforeBrake=Math.abs(bike.speed);
  for(let i=0;i<480;i++)step({...neutral,brake:1});
  assert.ok(Math.abs(bike.speed)<0.5,`braking ${beforeBrake} -> ${bike.speed}`);
  for(let i=0;i<120;i++)step({...neutral,steer:.55});
  assert.ok(Math.abs(bike.steer)>fastSteer*1.5,'low speed allows more steering');
  world.free();
});
test('Ramp produces airtime and a recoverable landing using suspension forces',()=>{
  const {world,bike,step}=setup();
  const vertices=new Float32Array([-9,0,24,9,0,24,-9,2.8,35,9,2.8,35,-9,0,48,9,0,48]);
  world.createCollider(RAPIER.ColliderDesc.trimesh(vertices,new Uint32Array([0,2,1,1,2,3,2,4,3,3,4,5])));
  let maxAir=0,maxPitch=0,landed=false,hasAir=false,maxCompression=0;
  for(let i=0;i<1500;i++) {
    step({...neutral,throttle:1});
    maxAir=Math.max(maxAir,bike.airTime);maxPitch=Math.max(maxPitch,Math.abs(bike.pitch));
    maxCompression=Math.max(maxCompression,...bike.wheels.map(w=>w.compression));
    if(bike.airTime>0.1)hasAir=true;
    if(hasAir&&bike.grounded)landed=true;
  }
  assert.ok(maxAir>0.18,`airtime ${maxAir}`);assert.ok(landed);
  assert.ok(maxCompression>0.08,`compression ${maxCompression}`);
  assert.ok(maxPitch<0.9);assert.ok(bike.position.y>0.4);
  console.log(`Ramp: ${maxAir.toFixed(2)} s airtime; compression ${(maxCompression*100).toFixed(1)} cm`);
  world.free();
});
test('A complete circuit can be ridden through steering and pedals without resets',()=>{
  const world=new RAPIER.World({x:0,y:-9.81,z:0});world.timestep=dt;
  const track=new Track();track.build(new THREE.Scene(),world,RAPIER);
  const bike=new BikePhysics(RAPIER,world);bike.reset(track.at(0));
  const checkpoints=new CheckpointSystem(track),timing=new LapCheckpointSystem(track),trial=new TimeTrial(null);trial.reset('trial');
  let progress=0,lastU=0,maxDistance=0,maxAir=0,maxPitch=0,worst={},airStart=null;
  const flights=[];
  for(let i=0;i<18000&&progress<1.005;i++) {
    const near=track.nearest(bike.position.x,bike.position.z);
    let du=near.u-lastU;if(du<-.5)du++;if(du>.5)du--;progress+=du;lastU=near.u;
    const v=Math.max(1,bike.speed),look=clamp(v*1.15,7,18);
    const target=track.at(near.u+look/track.length);
    const vel=bike.body.linvel();
    const course=Math.atan2(vel.x,vel.z);
    const angle=wrapAngle(Math.atan2(target.position.x-bike.position.x,target.position.z-bike.position.z)-bike.yaw-wrapAngle(course-bike.yaw)*.45);
    const desiredYaw=2*v*Math.sin(angle)/look;
    const steering=Math.atan(desiredYaw*1.7/v/Math.max(.6,bike.grip));
    const maxSteer=.5/(1+(Math.abs(bike.speed)/10)**1.25)+.025;
    const curve=Math.max(...[0,8,16,24].map(d=>Math.abs(wrapAngle(track.at(near.u+(d+5)/track.length).yaw-track.at(near.u+d/track.length).yaw))/5));
    const targetSpeed=clamp(Math.sqrt(5/Math.max(.01,curve)),7,17);
    const input={throttle:clamp((targetSpeed-bike.speed)*.9,0,1),brake:clamp((bike.speed-targetSpeed)*.3,0,1),steer:clamp(steering/maxSteer,-1,1)};
    bike.beforeStep(dt,input,1,near.distance<6);world.step();bike.afterStep();
    checkpoints.update(bike.position);
    const event=timing.update(bike.position);
    trial.update(dt,event);
    if(!bike.grounded&&airStart===null)airStart={u:near.u,step:i};
    if(bike.grounded&&airStart!==null){if((i-airStart.step)*dt>.15)flights.push(airStart.u);airStart=null;}
    if(near.distance>maxDistance)worst={u:near.u,speed:bike.speed,grip:bike.grip,steer:input.steer,angle};
    maxDistance=Math.max(maxDistance,near.distance);maxAir=Math.max(maxAir,bike.airTime);maxPitch=Math.max(maxPitch,Math.abs(bike.pitch));
    assert.ok(Number.isFinite(bike.position.y));
  }
  console.log(`Circuit: ${(progress*100).toFixed(1)}%; max offset ${maxDistance.toFixed(2)} m; air ${maxAir.toFixed(2)} s; pitch ${maxPitch.toFixed(2)} rad`);
  console.log('Largest departure:',worst);
  console.log('Flight locations:',flights.map(u=>u.toFixed(3)));
  assert.ok(progress>=1,`completed ${progress} laps`);
  assert.ok(maxDistance<5.8,`left circuit ${maxDistance} m`);
  assert.ok(maxAir>0.1,'track must contain real jumps');
  assert.ok(maxPitch<0.9);
  assert.ok(flights.length>=6,'the circuit must deliver at least six distinct flights');
  assert.equal(trial.results.length,1,'all ten gates must validate the physical lap');
  assert.equal(trial.results[0].valid,true,'the full ridden lap must be valid');
  world.free();
});

test('Limited airborne pitch and lateral corrections act in the requested direction',()=>{
  for(const [input,sign] of [[{throttle:1,brake:0,steer:1},-1],[{throttle:0,brake:1,steer:-1},1]]){
    const {world,bike,step}=setup();bike.reset({position:new THREE.Vector3(0,9,0),yaw:0});
    for(let i=0;i<90;i++)step(input);
    assert.equal(bike.grounded,false);
    assert.ok(bike.pitch*sign>.12&&Math.abs(bike.pitch)<.88);
    assert.ok(bike.roll*input.steer>0&&Math.abs(bike.roll)<.6);
    world.free();
  }
});
