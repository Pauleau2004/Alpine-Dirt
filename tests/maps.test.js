import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io } from 'socket.io-client';
import { Track } from '../src/Track.js';
import { createTrack } from '../src/tracks/createTrack.js';
import { LapCheckpointSystem } from '../src/LapCheckpointSystem.js';
import { LapRecord } from '../src/LapRecord.js';
import { LapRecordStore } from '../server/LapRecordStore.js';
import { createGameServer } from '../server/server.js';
import { MAPS } from '../shared/maps.js';
const hill=createTrack('hillside');

test('Map selection preserves every original sample, obstacle and timing gate',()=>{
  const original=new Track(),selected=createTrack('alpine');
  assert.deepEqual(selected.samples,original.samples);assert.deepEqual(selected.features,original.features);assert.equal(new LapCheckpointSystem(selected).gates.length,10);
  assert.equal(hill.width,12);assert.ok(hill.length>original.length*1.6&&hill.length<2500);
});
test('Hillside lanes do not intersect, hairpins have space, grades are smooth and obstacles stay outside bends',()=>{
  const heights=hill.samples.map(p=>p.y);assert.ok(Math.max(...heights)-Math.min(...heights)>32);
  let maxSlope=0,maxCurve=0,minGap=Infinity;
  for(let i=0;i<hill.count;i+=5){maxSlope=Math.max(maxSlope,Math.abs(hill.at(i/hill.count).pitch));maxCurve=Math.max(maxCurve,hill.curvature(i/hill.count));for(let j=i+1;j<hill.count;j+=5){if(Math.min(j-i,hill.count-j+i)*hill.length/hill.count<35)continue;const a=hill.samples[i],b=hill.samples[j];minGap=Math.min(minGap,Math.hypot(a.x-b.x,a.z-b.z));}}
  assert.ok(minGap>17);assert.ok(1/maxCurve>8.5);assert.ok(maxSlope<.36);
  for(const f of hill.features)for(let m=-8;m<(f.rise+f.top+f.fall)*hill.length+20;m+=2)assert.ok(hill.curvature(f.start+m/hill.length)<.014);
  const gates=new LapCheckpointSystem(hill);assert.ok(gates.gates.length>=32);assert.ok(hill.cornerMarkers.length>12);
});
function cross(timing,index,skip=false) {
  const at=timing.gates[index],before=at.position.clone().addScaledVector(at.tangent,-1),after=at.position.clone().addScaledVector(at.tangent,1);
  if(skip){for(const p of [before,after]){p.x+=Math.cos(at.yaw)*10;p.z-=Math.sin(at.yaw)*10;}}
  timing.previous=before;timing.routeU=at.u-1/hill.length;return timing.update(after,{u:at.u+1/hill.length,distance:skip?10:0});
}
test('Every hillside gate is compulsory in order; nonuniform sectors rank and rewind correctly',()=>{
  const clean=new LapCheckpointSystem(hill);
  for(let i=1;i<clean.gates.length;i++)assert.equal(cross(clean,i)?.index,i);
  assert.equal(cross(clean,0)?.lap,true);
  for(let skip=1;skip<clean.gates.length;skip++){
    const timing=new LapCheckpointSystem(hill);for(let i=1;i<timing.gates.length;i++)cross(timing,i,i===skip);
    assert.ok(!cross(timing,0)?.lap);assert.equal(timing.next,skip);
  }
  const timing=new LapCheckpointSystem(hill);for(let i=1;i<8;i++)cross(timing,i);
  assert.ok(timing.progressAt(.99)<timing.gates[8].u);timing.resetPosition(hill.at(timing.gates[4].u+.001).position,timing.gates[4].u+.001);assert.equal(timing.passed,4);
});
test('Driving across the grass to a nearby parallel lane cannot advance timing progress',()=>{
  const timing=new LapCheckpointSystem(hill),a=hill.at(.2477),b=hill.at(.5139);
  timing.passed=timing.gates.findLastIndex(g=>g.u<a.u);timing.resetPosition(a.position,a.u);const earned=timing.passed;
  for(let i=1;i<=60;i++)timing.update(a.position.clone().lerp(b.position,i/60));
  assert.equal(timing.passed,earned);assert.equal(timing.routeLost,true);assert.ok(timing.progressAt(b.u)<timing.gates[earned+1].u);
  for(let i=1;i<=60;i++)timing.update(b.position.clone().lerp(a.position,i/60));assert.equal(timing.routeLost,false);
});
test('Hillside spatial acceleration returns the same exact nearest segment as the original exhaustive search',()=>{
  for(let x=-245;x<=245;x+=17)for(let z=-245;z<=245;z+=19){const fast=hill.nearest(x,z),reference=Track.prototype.nearest.call(hill,x,z);assert.ok(Math.abs(fast.distance-reference.distance)<1e-9);assert.ok(Math.abs(fast.u-reference.u)<1e-9);assert.ok(Math.abs(fast.height-reference.height)<1e-9);}
});
test('Both maps preserve an independent named top three in browser and server files',async()=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const a=new LapRecord(storage),b=new LapRecord(storage,MAPS[1].circuitId);a.submit(65,'Pilote A');b.submit(155,'Pilote A');b.submit(150,'Max');b.submit(160,'Leo');b.submit(165,'Tom');
  assert.equal(new LapRecord(storage).record.time,65);assert.equal(new LapRecord(storage,MAPS[1].circuitId).records.length,4);assert.equal(b.record.name,'Max');
  const dir=await mkdtemp(join(tmpdir(),'motocross-maps-'));
  try {const paths=[join(dir,'alpine.json'),join(dir,'hillside.json')];for(let i=0;i<2;i++){const store=new LapRecordStore(paths[i],MAPS[i].circuitId);store.submit(i?150:65,'Pilote A');await store.flush();const loaded=await new LapRecordStore(paths[i],MAPS[i].circuitId).load();assert.equal(loaded.record.time,i?150:65);}}
  finally{await rm(dir,{recursive:true,force:true});}
});
test('Six LAN clients use the host-selected map, its gates, boost and records; guests cannot change it',async()=>{
  let now=10000;const server=await createGameServer({port:0,host:'127.0.0.1',advertisedHost:'127.0.0.1',now:()=>now,countdownMs:0,isOwnerConnection:socket=>socket.handshake.auth.owner===true});
  const sockets=[],ids=[];
  const call=(s,event,data={})=>new Promise((resolve,reject)=>s.timeout(2000).emit(event,data,(error,result)=>error?reject(error):resolve(result)));
  try {
    for(let i=0;i<6;i++){const s=io(`http://127.0.0.1:${server.port}`,{transports:['websocket'],auth:{token:randomBytes(24).toString('hex'),owner:i===0},reconnection:false});sockets.push(s);await new Promise(resolve=>s.once('connect',resolve));ids.push((await call(s,'joinLocal',{name:`Rider ${i}`})).playerId);}
    assert.equal((await call(sockets[1],'setMap',{mapId:'hillside'})).ok,false);
    assert.equal((await call(sockets[0],'setMap',{mapId:'invalid'})).ok,false);
    for(const s of sockets)await call(s,'playerReady',{ready:true});
    assert.ok((await call(sockets[0],'setMap',{mapId:'hillside'})).ok);
    const room=server.manager.rooms.get('MXTEAM');assert.ok([...room.players.values()].every(p=>!p.ready));
    for(const s of sockets)await call(s,'playerReady',{ready:true});assert.ok((await call(sockets[0],'startRace')).ok);
    const race=room.race;assert.equal(race.track.id,'hillside');assert.equal(race.snapshot(now).mapId,'hillside');assert.equal(race.records.size,6);
    for(const s of sockets)await call(s,'raceLoaded',{raceId:race.id});server.manager.tick();
    assert.equal((await call(sockets[0],'setMap',{mapId:'alpine'})).ok,false);
    let seq=0;for(let m=-2;m<hill.length+15;m+=2){now+=100;for(let i=0;i<6;i++){const id=ids[i];if(race.records.get(id).finishTime!==null)continue;const at=hill.at((m-Math.floor(i/2)*3.4)/hill.length),p=at.position.clone();p.y+=.9;const packet={seq:seq++,position:p.toArray(),rotation:[0,0,0,1],velocity:[0,0,10],grounded:true};assert.ok(race.accept(id,packet,now));}if(m>hill.length*.51)assert.equal(race.boost.boostSystemUnlocked,true);}
    assert.ok(race.standings().some(r=>r.completedLaps===1));assert.equal(server.recordStore.records.length,0);assert.equal(server.recordStores.get('hillside').records.length,5);
    assert.ok(race.standings().every(r=>r.timingCount===hill.timingUs.length));
  }finally{for(const s of sockets)s.disconnect();await server.close();}
});
