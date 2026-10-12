import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { io as connect } from 'socket.io-client';
import { MAPS } from '../shared/maps.js';
import { createTrack } from '../src/tracks/createTrack.js';
import { LapCheckpointSystem } from '../src/LapCheckpointSystem.js';
import { CheckpointRecovery } from '../shared/checkpointRecovery.js';
import { createGameServer } from '../server/server.js';

for(const map of MAPS)test(`${map.title}: a complete clean lap, including stacked lanes, never starts recovery`,()=>{
  const track=createTrack(map.id),timing=new LapCheckpointSystem(track),recovery=new CheckpointRecovery(timing);
  let laps=0,passed=0,now=0;
  const steps=Math.ceil(track.length/.75);
  for(let i=0;i<=steps+2;i++) {
    const p=track.at(i/steps+.00001).position;p.y+=1;
    const near=track.nearest(p.x,p.z,p.y),event=timing.update(p,near);
    recovery.update(p,near,now+=33,event);
    assert.equal(recovery.pending,null,`false warning at ${near.u}: ${JSON.stringify(recovery.pending)}`);
    if(event?.checkpoint)passed++;if(event?.lap)laps++;
  }
  assert.equal(laps,1);assert.equal(passed,timing.gates.length-1);
});

for(const map of MAPS)test(`${map.title}: every gate can be recovered from a solid point before it`,()=>{
  const track=createTrack(map.id),timing=new LapCheckpointSystem(track),recovery=new CheckpointRecovery(timing);
  for(const [index,gate] of timing.gates.entries()) {
    recovery.pending={index,startedAt:0,deadline:3000};
    const spawn=recovery.spawn();
    assert.ok(!track.isGap?.(spawn.u),`gate ${index}: respawn in gap`);
    assert.ok(((gate.u-spawn.u+1)%1)*track.length>=3.99);
    assert.ok(spawn.position.toArray().every(Number.isFinite));
    // Reset may rewind earlier gates when a gap needs a longer run-up, but
    // cannot move forward across the missed timing gate.
    timing.passed=index===0?timing.gates.length-1:index-1;
    timing.resetPosition(spawn.position,spawn.u);
    assert.ok(timing.passed<index||index===0);
  }
});

test('Two LAN clients receive the same automatic reset; guests cannot reset another rider',async()=>{
  let now=10000;
  const server=await createGameServer({port:0,host:'127.0.0.1',advertisedHost:'127.0.0.1',now:()=>now,countdownMs:0});
  const sockets=[],events=[[],[]];
  const request=(socket,event,data={})=>new Promise((resolve,reject)=>socket.timeout(2000).emit(event,data,(error,res)=>error?reject(error):resolve(res)));
  const make=async()=>{const socket=connect(`http://127.0.0.1:${server.port}`,{transports:['websocket'],auth:{token:randomBytes(24).toString('hex')},reconnection:false});sockets.push(socket);await new Promise(resolve=>socket.once('connect',resolve));return socket;};
  try {
    const host=await make(),a=await request(host,'createRoom',{name:'Pilote A'}),guest=await make(),b=await request(guest,'joinRoom',{name:'Ami',code:a.room.code});
    for(const s of sockets)assert.ok((await request(s,'playerReady',{ready:true})).ok);
    assert.ok((await request(host,'startRace')).ok);
    const room=server.manager.rooms.get(a.room.code),race=room.race,r=race.records.get(a.playerId),track=race.track;
    for(const s of sockets)await request(s,'raceLoaded',{raceId:race.id});
    server.manager.tick();
    sockets.forEach((s,i)=>s.on('playerReset',event=>events[i].push(event)));
    let seq=0;
    for(let u=-2/track.length;u<.103;u+=.001) {
      now+=50;const at=track.at(u),p=at.position.clone(),side=10*Math.max(0,1-Math.abs(u-.1)/.02);p.y+=.96;p.x+=Math.cos(at.yaw)*side;p.z-=Math.sin(at.yaw)*side;
      assert.ok(race.accept(r.id,{seq:seq++,resetVersion:0,position:p.toArray(),rotation:[0,0,0,1],velocity:[0,0,0],grounded:true},now));
    }
    const deadline=r.checkpointRecovery.pending.deadline;
    assert.equal(race.snapshot(now).standings.find(p=>p.id===r.id).checkpointRecovery.deadline,deadline);
    // The reset command always resolves the socket's own player, ignoring a forged ID.
    await request(guest,'resetBike',{raceId:race.id,playerId:r.id});assert.equal(r.resetVersion,0);
    now=deadline;server.manager.tick();
    await new Promise(resolve=>setTimeout(resolve,80));
    assert.equal(events[0].length,1);assert.deepEqual(events[0],events[1]);
    assert.equal(events[0][0].playerId,r.id);assert.equal(events[0][0].version,1);
    assert.equal(race.records.get(b.playerId).resetVersion,1,'guest only reset itself');
    assert.equal(r.timing.next,1);assert.equal(room.state,'RACING');
    const frame=race.snapshot(now).players.find(p=>p.id===r.id);
    assert.equal(frame.resetVersion,1);assert.equal(frame.resetReason,'checkpoint');assert.equal(frame.checkpointProtectionUntil,deadline+1000);
  }finally{sockets.forEach(s=>s.disconnect());await server.close();}
});
