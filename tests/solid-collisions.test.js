import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {capsuleContact,sweepCapsules,solveMotorcycles,heading,MOTORCYCLE_COLLISION_CONFIG as C} from '../shared/collisions.js';
import {PlayerCollisionSystem} from '../server/PlayerCollisionSystem.js';
import {CollisionResponse} from '../src/network/CollisionResponse.js';
import {MotorcycleConstraints} from '../src/network/MotorcycleConstraints.js';
import {BikePhysics} from '../src/BikePhysics.js';
import {validateState} from '../server/NetworkValidator.js';
import {RaceManager} from '../server/RaceManager.js';
import {Track} from '../src/Track.js';

const pose=(id,x,z,vx=0,vz=0,yaw=0)=>({id,x,y:1,z,vx,vz,forward:{x:Math.sin(yaw),z:Math.cos(yaw)}});
const previous=ps=>new Map(ps.map(p=>[p.id,{...p}]));
const clear=ps=>{for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){const h=capsuleContact(ps[i],ps[j]);assert.ok(!h||h.depth<1e-5,`${ps[i].id}/${ps[j].id} penetration ${h?.depth}`);}};
const record=p=>({id:p.id,position:new THREE.Vector3(p.x,p.y,p.z),lastAt:1000,resetVersion:0,finishTime:null,state:{position:[p.x,p.y,p.z],rotation:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.atan2(p.forward.x,p.forward.z)).toArray(),velocity:[p.vx,0,p.vz],grounded:true,seq:0}});
const views=rs=>[...rs.values()].map(r=>({...pose(r.id,r.position.x,r.position.z,...[r.state.velocity[0],r.state.velocity[2]]),y:r.position.y,forward:heading(r.state.rotation)}));

test('Full depenetration of coincident, collinear, parallel and crossed chassis',()=>{
  for(const yaw of [0,.3,Math.PI/2,Math.PI])for(const z of [0,.1,.6,1.4]){
    const ps=[pose('a',0,0),pose('b',0,z,0,0,yaw)];solveMotorcycles(ps);clear(ps);
    assert.equal(ps[0].y,1);assert.equal(ps[1].y,1);
  }
});
test('Continuous rear, head-on and lateral impacts at 65 m/s never exchange sides',()=>{
  for(const dt of [1/120,1/30,.15,.25])for(const kind of ['rear','head','side']){
    const side=kind==='side',ps=side?[pose('a',-1,0,65,10),pose('b',1,0,-65,10)]:[pose('a',0,-1.5,0,65),pose('b',0,1.5,0,kind==='rear'?5:-65,kind==='head'?Math.PI:0)];
    const old=previous(ps);for(const p of ps){p.x+=p.vx*dt;p.z+=p.vz*dt;}solveMotorcycles(ps,old);clear(ps);
    assert.ok(side?ps[0].x<ps[1].x:ps[0].z<ps[1].z);
    if(side)assert.equal(ps[0].vz,10,'tangent speed preserved');
    if(dt>=1/30)assert.ok(side?ps[0].vx<=ps[1].vx+1e-5:ps[0].vz<=ps[1].vz+1e-5);
  }
});
test('Continuous casts include changing orientation and vertical crossing',()=>{
  const a0=pose('a',-.8,0),a={...a0,forward:{x:1,z:0}},b=pose('b',0,0);
  const hit=sweepCapsules(a0,a,b,b);assert.ok(hit&&hit.time<1);
  const high={...pose('a',-3,0),y:2},low={...high,x:3,y:0};
  assert.ok(sweepCapsules(high,low,b,b));
  const above={...high,y:5},aboveEnd={...above,x:3};assert.equal(sweepCapsules(above,aboveEnd,b,b),null);
});
test('Sustained side pressure for ten seconds stays separated and keeps forward travel',()=>{
  const ps=[pose('a',-.31,0,0,15),pose('b',.31,0,0,15)];
  for(let i=0;i<1200;i++){const old=previous(ps);ps[0].vx+=8/120;ps[1].vx-=8/120;for(const p of ps){p.x+=p.vx/120;p.z+=p.vz/120;}solveMotorcycles(ps,old);clear(ps);assert.ok(ps[0].x<ps[1].x);}
  assert.ok(ps.every(p=>Math.abs(p.vz-15)<1e-6&&p.z>149));
});
test('Twelve riders in a pile-up fully separate without vertical velocity or instability',()=>{
  const ps=Array.from({length:12},(_,i)=>pose(String(i),(i%3)*.12,Math.floor(i/3)*.12,i%2?20:-20,30,i*.23));
  solveMotorcycles(ps);clear(ps);
  for(let step=0;step<120;step++){const old=previous(ps);for(const p of ps){p.x+=p.vx/120;p.z+=p.vz/120;}solveMotorcycles(ps,old);clear(ps);}
  assert.ok(ps.every(p=>[p.x,p.z,p.vx,p.vz].every(Number.isFinite)&&p.y===1));
});
test('Swept pile-up preserves the order of twelve bikes regardless of solver enumeration',()=>{
  for(const reversed of [false,true]){
    const sorted=Array.from({length:12},(_,i)=>pose(String(i),i*.9,0,i===0?65:0));
    const ps=reversed?[...sorted].reverse():sorted,old=previous(ps);sorted[0].x+=65*.25;
    solveMotorcycles(ps,old);clear(ps);
    for(let i=1;i<sorted.length;i++)assert.ok(sorted[i].x>sorted[i-1].x,'a neighbour pushed by another neighbour must not tunnel');
  }
});
test('Server blocks every packet, even inside the cosmetic contact cooldown',()=>{
  const system=new PlayerCollisionSystem('r'),rs=new Map([record(pose('a',0,-1.5,0,65)),record(pose('b',0,1.5))].map(r=>[r.id,r]));
  for(let i=0;i<30;i++){
    const r=rs.get('a'),state={...r.state,position:[r.position.x,1,r.position.z+2],velocity:[0,0,65],collisionAck:r.collision?.revision??0};
    system.constrain(rs,'a',state,1000+i*10);clear(views(rs));assert.ok(rs.get('a').position.z<rs.get('b').position.z);
  }
  assert.ok(system.pending.length<30,'cosmetic cooldown remains active');
});
test('Unacknowledged corrections survive packet loss, deduplicate, and reject wrong reset/forged acknowledgements',()=>{
  const system=new PlayerCollisionSystem('r'),rs=new Map([record(pose('a',-1,0,65)),record(pose('b',1,0,-65))].map(r=>[r.id,r]));
  const a=rs.get('a'),packet={...a.state,position:[2,1,0],collisionAck:0};
  system.constrain(rs,'a',packet,1000);clear(views(rs));const pos=a.position.clone();
  const rebased=system.rebase(a,packet);assert.ok(Math.abs(rebased.position[0]-pos.x)<1e-6);
  system.constrain(rs,'a',packet,1100);clear(views(rs));assert.ok(a.position.distanceTo(pos)<.01);
  assert.equal(system.rebase(a,{...packet,collisionAck:999999}),null);
  assert.equal(system.rebase(a,{...packet,resetVersion:1}),null);
  rs.get('b').disconnected=true;system.update(rs,1200);assert.equal(system.previous.has('b'),false);
  assert.equal(validateState({seq:1,raceId:'r',collisionAck:-1}),null);
});
test('Race acceptance validates the blocked position before timing gates and publishes corrections in snapshots',()=>{
  const race=new RaceManager(new Track(),[{id:'a'},{id:'b'}],2,1000,{countdownMs:0});
  for(const id of ['a','b'])race.loaded(id,1000);
  for(const p of [pose('a',-1,0,65),pose('b',1,0,-65)]){const r=race.records.get(p.id),fixture=record(p);r.position.copy(fixture.position);r.state=fixture.state;r.started=true;}
  let checked=false;
  race.records.get('a').timing.update=position=>{checked=true;const b=race.records.get('b');assert.ok(position.x<b.position.x,'timing must not see the rejected crossing');return null;};
  const a=race.records.get('a');
  assert.ok(race.accept('a',{...a.state,seq:1,position:[3,1,0]},1100));assert.ok(checked);clear(views(race.records));
  const frame=race.snapshot(1100).players.find(p=>p.id==='a');assert.ok(frame.collision.revision>0);assert.deepEqual(frame.position,frame.state.position);
  const reset=race.resetPlayer('a',2000);assert.ok(reset);assert.equal(race.records.get('a').collision,null);
  assert.equal(race.accept('a',{...a.state,seq:2,position:[0,1,0],velocity:[0,0,0],resetVersion:0},2100),false,'pre-respawn packets are ignored');
});
await RAPIER.init();
test('Authority corrections block physics immediately, smooth only rendering and apply once across event/snapshot duplicates',()=>{
  const world=new RAPIER.World({x:0,y:0,z:0}),bike=new BikePhysics(RAPIER,world),response=new CollisionResponse();
  bike.reset({position:new THREE.Vector3(),yaw:0});bike.body.setLinvel({x:1,y:2,z:40},true);
  const correction={version:0,revision:1,offset:[0,0,-.25],constraints:[{normal:[0,0,-1],speed:0}]};
  assert.equal(response.reconcile(correction,bike,0),true);assert.ok(bike.body.linvel().z<=0);assert.equal(bike.body.linvel().y,2);
  assert.equal(bike.position.z,-.25);assert.equal(bike.position.z+response.visualOffset.z,0);
  const offset=response.renderOffset(1/60).z;assert.ok(offset>0&&offset<.25);
  assert.equal(response.reconcile(correction,bike,0),false);assert.equal(bike.position.z,-.25);
  assert.equal(response.reconcile({...correction,revision:2},bike,1),false);
  assert.equal(bike.body.isCcdEnabled(),true);world.free();
});
test('Client prediction blocks a 65 m/s crossing with a 150 ms delayed remote frame',()=>{
  const world=new RAPIER.World({x:0,y:0,z:0}),bike=new BikePhysics(RAPIER,world),system=new MotorcycleConstraints();
  bike.reset({position:new THREE.Vector3(-3,.04,0),yaw:0});bike.body.setLinvel({x:65,y:0,z:0},true);
  const remote={latest:{serverTime:1000,resetVersion:0,state:{position:[3,1,0],velocity:[-20,0,0],rotation:[0,0,0,1]}}};
  const old=system.pose(bike,'a');bike.position.x=3;bike.body.setTranslation(bike.position,true);
  system.step(bike,'a',old,new Map([['b',remote]]),1150,.10);
  const proxy=system.proxies.get('b'),own=system.pose(bike,'a');clear([own,proxy]);assert.ok(own.x<proxy.x);assert.ok(own.vx<=proxy.vx+1e-5);
  assert.equal(world.bodies.len(),1,'no extra mass or wheel-ray obstacles');world.free();
});
