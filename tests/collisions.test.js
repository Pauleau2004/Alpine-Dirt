import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {PlayerCollisionSystem} from '../server/PlayerCollisionSystem.js';
import {CollisionResponse} from '../src/network/CollisionResponse.js';
import {MULTIPLAYER_COLLISION_CONFIG as C,capsuleContact,heading} from '../shared/collisions.js';
import {BikePhysics} from '../src/BikePhysics.js';

const record=(id,x,z,{vx=0,vz=0,y=1,yaw=0,grounded=true}={})=>({id,position:new THREE.Vector3(x,y,z),resetVersion:0,lastAt:1000,finishTime:null,state:{rotation:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw).toArray(),velocity:[vx,0,vz],grounded}});
const records=(...r)=>new Map(r.map(p=>[p.id,p]));
const fresh=(r,now)=>{for(const p of r.values())p.lastAt=now;return r;};
const magnitude=e=>Math.hypot(...e.deltaVelocity);

test('Side rubs stay gentle, rear impacts slow the following bike, frontal shocks are capped',()=>{
  const side=new PlayerCollisionSystem('side').update(records(record('a',-.25,0,{vx:1,vz:12}),record('b',.25,0,{vx:-1,vz:12})),1000)[0];
  assert.equal(side.kind,'side');assert.ok(side.effects[0].deltaVelocity[0]<0);assert.ok(side.effects[1].deltaVelocity[0]>0);assert.ok(magnitude(side.effects[0])<.5);assert.ok(side.effects[0].velocityLoss<.01);
  const rear=new PlayerCollisionSystem('rear').update(records(record('a',0,-.9,{vz:16}),record('b',0,.9,{vz:8})),1000)[0];
  assert.equal(rear.kind,'rear');assert.ok(rear.effects[0].deltaVelocity[2]<0);assert.ok(rear.effects[0].velocityLoss>rear.effects[1].velocityLoss);assert.ok(magnitude(rear.effects[0])>magnitude(rear.effects[1]));
  const head=new PlayerCollisionSystem('head').update(records(record('a',0,-.9,{vz:50}),record('b',0,.9,{vz:-50,yaw:Math.PI})),1000)[0];
  assert.equal(head.kind,'frontal');assert.ok(head.intensity>side.intensity);
  for(const e of head.effects){assert.ok(magnitude(e)<=C.maxLinearImpulse);assert.equal(e.deltaVelocity[1],0);assert.ok(Math.abs(e.yawImpulse)<=C.maxAngularImpulse);}
});

test('Persistent contact has cooldown and never replays the initial velocity loss',()=>{
  const system=new PlayerCollisionSystem('r'),r=records(record('a',-.2,0,{vx:1}),record('b',.2,0,{vx:-1}));
  assert.equal(system.update(r,1000).length,1);
  assert.equal(system.update(fresh(r,1100),1100).length,0);
  const e=system.update(fresh(r,1150),1150)[0];assert.ok(e.persistent);assert.equal(e.effects[0].velocityLoss,0);assert.ok(e.intensity<=C.persistentImpulse);assert.equal(system.count,1);
  r.get('b').position.x=4;system.update(fresh(r,1180),1180);assert.equal(system.contacts.size,0);
  r.get('b').position.x=.2;assert.equal(system.update(fresh(r,1200),1200).length,0,'cooldown survives a brief separation');
  assert.equal(system.update(fresh(r,1320),1320).length,1);assert.ok(system.count>=1);
});

test('Vertical separation is ignored, airborne effects are weakened, connected riders remain solid during packet loss',()=>{
  const system=new PlayerCollisionSystem('r'),a=record('a',-.2,0),b=record('b',.2,0,{y:4});
  assert.equal(system.update(records(a,b),1000).length,0);
  b.position.y=1;
  const ground=new PlayerCollisionSystem('g').update(records(a,b),1000)[0];
  a.state.grounded=b.state.grounded=false;
  const air=new PlayerCollisionSystem('air').update(records(a,b),1000)[0];
  assert.ok(Math.abs(air.intensity/ground.intensity-C.airborneMultiplier)<1e-6);
  system.update(records(a,b),1250);assert.equal(system.previous.size,2,'packet loss must not make a connected rider intangible');
});

test('Swept capsules catch a fast crossing between ticks without teleport corrections',()=>{
  const system=new PlayerCollisionSystem('r'),r=records(record('a',-2,0,{vx:65}),record('b',2,0,{vx:-65}));
  assert.equal(system.update(r,1000).length,0);
  r.get('a').position.x=2;r.get('b').position.x=-2;
  const events=system.update(fresh(r,1066),1066);assert.equal(events.length,1);
  assert.ok(events[0].effects[0].correction.every(v=>v===0));
});

test('Six touching riders produce at most 15 bounded contacts and disconnect cleans pairs',()=>{
  const system=new PlayerCollisionSystem('r'),r=records(...Array.from({length:6},(_,i)=>record(String(i),(i%2)*.25,Math.floor(i/2)*.25,{vz:12})));
  const events=system.update(r,1000);assert.ok(events.length>0&&events.length<=15);
  for(const event of events)for(const e of event.effects)assert.ok(magnitude(e)<=C.maxLinearImpulse);
  r.get('0').disconnected=true;system.update(fresh(r,1200),1200);assert.ok([...system.contacts.values()].every(c=>c.a!=='0'&&c.b!=='0'));assert.equal(system.previous.has('0'),false);
  r.get('1').collisionGraceUntil=2000;system.update(fresh(r,1400),1400);assert.ok(system.previous.has('1'),'respawn grace must not disable solidity');
});

await RAPIER.init();
test('Confirmed contacts immediately block velocity and position, while rendering corrections ease separately',()=>{
  const world=new RAPIER.World({x:0,y:0,z:0}),bike=new BikePhysics(RAPIER,world);bike.reset({position:new THREE.Vector3(0,4,0),yaw:0});bike.body.setLinvel({x:0,y:2,z:14},true);
  const response=new CollisionResponse(),system=new PlayerCollisionSystem('race'),r=records(record('a',0,-.8,{vz:14}),record('b',0,.8,{vz:-14,yaw:Math.PI}));
  const event=system.update(r,1000)[0],context={raceId:'race',playerId:'a',version:0,now:1040,bike};
  assert.ok(response.receive(event,context),'40 ms delayed authoritative contact');
  assert.equal(response.receive(event,context),false,'deduplicate retransmissions');
  const before=bike.body.linvel().z,startY=bike.body.translation().y;
  for(let i=0;i<60;i++){const p=bike.body.translation();response.step(bike,1/120);const q=bike.body.translation();assert.ok(Math.hypot(q.x-p.x,q.z-p.z)<1e-6,'body is already separated');}
  const v=bike.body.linvel();assert.ok(v.z<=0,'front impact blocks the full closing speed');assert.equal(v.y,2);assert.equal(bike.body.translation().y,startY);
  assert.equal(world.bodies.len(),1);
  assert.equal(response.receive({...event,sequence:100},{...context,version:1}),false,'old respawn version');
  assert.equal(response.receive({...event,sequence:101},{...context,now:1700}),false,'late contact');
  assert.equal(response.receive({...event,sequence:102,raceId:'old'},context),false,'old race');
  world.free();
});

test('Five simultaneous cosmetic impacts share one impulse budget',()=>{
  const world=new RAPIER.World({x:0,y:0,z:0}),bike=new BikePhysics(RAPIER,world);bike.reset({position:new THREE.Vector3(),yaw:0});bike.body.setLinvel({x:0,y:0,z:20},true);
  const response=new CollisionResponse();
  for(let i=1;i<=5;i++)response.receive({raceId:'r',sequence:i,timestamp:1000,effects:[{playerId:'a',version:0,deltaVelocity:[0,0,-2.2],velocityLoss:.18,yawImpulse:.12,correction:[0,0,-.1]}]},{raceId:'r',playerId:'a',version:0,now:1000,bike});
  for(let i=0;i<120;i++)response.step(bike,1/120);
  assert.ok(bike.body.linvel().z>20-C.maxCombinedDeltaV-.01);assert.equal(bike.position.z,0);assert.ok(Math.abs(bike.yawRate)<=C.maxAngularImpulse+.001);world.free();
});

test('Three-tier contact levels: frottement léger, contact normal and choc important with anti-launch and anti-spin',()=>{
  const system=new PlayerCollisionSystem('tiers');
  const rub=system.update(records(record('a',-.25,0,{vx:.5,vz:15}),record('b',.25,0,{vx:-.5,vz:15})),1000)[0];
  assert.equal(rub.contactLevel,'FROTTEMENT');
  assert.equal(rub.effects[0].deltaVelocity[1],0,'anti-launch: zero vertical impulse');
  assert.ok(rub.effects[0].velocityLoss<.005,'frottement loses virtually no speed');
  assert.ok(Math.abs(rub.effects[0].yawImpulse)<.05,'frottement produces almost no rotation');

  const normal=new PlayerCollisionSystem('norm').update(records(record('a',-.25,0,{vx:2.5,vz:15}),record('b',.25,0,{vx:-2.5,vz:12})),1000)[0];
  assert.equal(normal.contactLevel,'NORMAL');
  assert.equal(normal.effects[0].deltaVelocity[1],0,'anti-launch: zero vertical impulse');
  assert.ok(normal.intensity>rub.intensity,'normal contact has greater intensity than rubbing');

  const heavy=new PlayerCollisionSystem('heavy').update(records(record('a',-.25,0,{vx:6,vz:20}),record('b',.25,0,{vx:-6,vz:5})),1000)[0];
  assert.equal(heavy.contactLevel,'CHOC');
  assert.equal(heavy.effects[0].deltaVelocity[1],0,'anti-launch: zero vertical impulse');
  for(const e of heavy.effects){
    assert.ok(Math.hypot(...e.deltaVelocity)<=C.maxLinearImpulse,'strictly clamped linear impulse');
    assert.ok(Math.abs(e.yawImpulse)<=C.maxAngularImpulse,'strictly clamped angular impulse');
  }
});

test('Landing grace attenuates collision impact when bike just landed',()=>{
  const normalSys=new PlayerCollisionSystem('normal');
  const normalContact=normalSys.update(records(record('a',-.25,0,{vx:2}),record('b',.25,0,{vx:-2})),1000)[0];

  const landingSys=new PlayerCollisionSystem('landing');
  const bLanding=record('b',.25,0,{vx:-2});
  bLanding.state.landing=.8;
  const landingContact=landingSys.update(records(record('a',-.25,0,{vx:2}),bLanding),1000)[0];

  assert.ok(landingContact.intensity<normalContact.intensity,'landing grace reduces collision intensity');
  assert.ok(Math.abs(landingContact.intensity/normalContact.intensity-C.landingGraceMultiplier)<1e-4);
});
