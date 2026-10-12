import { MAX_PLAYERS, PLAYER_COLORS, COLOR_NAMES } from '../shared/multiplayer.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { io as connect } from 'socket.io-client';
import { Track } from '../src/Track.js';
import { RaceManager } from '../server/RaceManager.js';
import { createGameServer } from '../server/server.js';
import { selectLanInterface } from '../server/lanAddress.js';
import { nickname,roomCode,validateState,RateLimiter } from '../server/NetworkValidator.js';
import { NetworkInterpolation } from '../src/network/NetworkInterpolation.js';

const state=(position,seq=0)=>({raceId:'test',seq,timestamp:1000,position,rotation:[0,0,0,1],velocity:[0,0,12],angularVelocity:[0,0,0],speed:12,steer:0,pitch:0,roll:0,throttle:1,suspension:[.6,.6],compression:[.05,.05],grounded:true});
test('Permanent local link needs no room code and survives an empty salon and server restart',async()=>{
  let server=await createGameServer({port:0,host:'127.0.0.1',advertisedHost:'192.168.1.23'});
  const port=server.port,sockets=[];
  const call=(socket,event,data={})=>new Promise((resolve,reject)=>socket.timeout(2000).emit(event,data,(error,result)=>error?reject(error):resolve(result)));
  const make=async()=>{const socket=connect(`http://127.0.0.1:${port}`,{transports:['websocket'],auth:{token:randomBytes(24).toString('hex')},reconnection:false});sockets.push(socket);await new Promise(resolve=>socket.once('connect',resolve));return socket;};
  try {
    const first=await make(),joined=await call(first,'joinLocal',{name:'Pilote A'});assert.ok(joined.ok);assert.equal(joined.room.permanent,true);
    assert.equal(joined.room.shareUrl,`http://192.168.1.23:${port}/jouer`);
    const second=await make(),friend=await call(second,'joinLocal',{name:'Ami'});assert.equal(friend.room.code,joined.room.code);
    assert.equal(friend.room.hostId,joined.playerId);
    await call(first,'leaveRoom');await call(second,'leaveRoom');assert.equal(server.manager.rooms.size,0);
    const again=await call(first,'joinLocal',{name:'Pilote A'});assert.equal(again.room.shareUrl,joined.room.shareUrl);
    sockets.forEach(s=>s.disconnect());await server.close();
    server=await createGameServer({port,host:'127.0.0.1',advertisedHost:'192.168.1.23'});
    const restarted=await call(await make(),'joinLocal',{name:'Ami'});assert.equal(restarted.room.shareUrl,joined.room.shareUrl);assert.equal(restarted.room.hostId,restarted.playerId);
    assert.equal((await fetch(`http://127.0.0.1:${port}/jouer`)).status,200);
  }finally{sockets.forEach(s=>s.disconnect());await server.close();}
});
test('Wi-Fi IPv4 takes priority over Ethernet, VPN, virtual adapters and loopback',()=>{
  const ip=address=>[{family:'IPv4',address,internal:false}];
  const interfaces={'Ethernet':ip('192.168.1.10'),'Wi-Fi':ip('192.168.1.147'),'Virtual Wi-Fi':ip('10.0.0.5'),'VPN':ip('10.0.0.1'),'Loopback':[{family:'IPv4',address:'127.0.0.1',internal:true}]};
  assert.equal(selectLanInterface(interfaces).address,'192.168.1.147');assert.equal(selectLanInterface(interfaces).wifi,true);
  interfaces['Wi-Fi']=ip('169.254.1.3');assert.equal(selectLanInterface(interfaces).name,'Ethernet');
  assert.equal(selectLanInterface({}),null);
});
test('Network schema and rate limiter reject malformed and excessive packets',()=>{
  assert.equal(nickname(' Pilote A '),'Pilote A');assert.throws(()=>nickname('<script>'));assert.throws(()=>nickname('a'.repeat(17)));assert.throws(()=>roomCode('no'));
  const packet=state([0,1,0]);assert.ok(validateState(packet));
  assert.equal(validateState({...packet,position:[NaN,1,0]}),null);assert.equal(validateState({...packet,rotation:[0,0,0,0]}),null);assert.equal(validateState({...packet,seq:'1'}),null);
  let now=0;const limiter=new RateLimiter(20,3,()=>now);assert.ok(limiter.take());assert.ok(limiter.take());assert.ok(limiter.take());assert.equal(limiter.take(),false);now=100;assert.ok(limiter.take());
});
test('Remote interpolation uses the 100 ms buffer and snaps only on explicit reset',()=>{
  const buffer=new NetworkInterpolation();buffer.push({...state([0,1,0]),serverTime:1000},0);buffer.push({...state([10,1,0]),serverTime:1050},0);
  assert.equal(buffer.sample(1125).position[0],5);
  buffer.push({...state([999,1,0]),serverTime:1020},0);assert.equal(buffer.frames.length,2);
  buffer.push({...state([50,1,0]),serverTime:1100},1);assert.equal(buffer.sample(1125).position[0],50);
});
test('Server counts ten ordered gates for six riders, ranks them and handles the finish deadline',()=>{
  const track=new Track(),players=Array.from({length:6},(_,i)=>({id:String(i),name:`Rider${i}`,color:'#fff'}));
  let now=10000;const race=new RaceManager(track,players,1,now,{countdownMs:3000,finishTimeoutMs:1000});
  // This timing fixture puts pairs on the identical centreline. Collision
  // acceptance and separated physical riders are covered in solid-collisions.
  race.collisions.config={...race.collisions.config,enabled:false};
  players.forEach(p=>race.loaded(p.id,now));assert.equal(race.startAt,13000);
  assert.equal(race.accept('0',state(race.records.get('0').position.toArray()),now),false);
  now=race.startAt;let step=0;
  for(;step<1200&&!race.records.get('0').finishTime;step++){
    now+=50;
    for(let i=0;i<5;i++) {
      const u=step*.001-(2+Math.floor(i/2)*3.4)/track.length;
      const p=track.at(u).position;p.y+=.85;
      assert.equal(race.accept(String(i),state(p.toArray(),step),now),true);
    }
  }
  assert.equal(race.records.get('0').completedLaps,1);assert.ok(race.records.get('0').finishTime>40);
  assert.equal(race.finished,false,'others may keep racing');
  const bad=state([0,100,0],50000);assert.equal(race.accept('5',bad,now),false,'teleports cannot finish a race');
  now+=1100;race.tick(now);assert.equal(race.finished,true);assert.equal(race.records.get('5').dnf,true);
  assert.equal(race.standings()[0].completedLaps,1);
});
test('Server refuses a full loop that bypasses one timing checkpoint',()=>{
  const track=new Track(),players=[{id:'cut',name:'Cut',color:'#fff'},{id:'clean',name:'Clean',color:'#eee'}];
  let now=10000;const race=new RaceManager(track,players,1,now,{countdownMs:0});players.forEach(p=>race.loaded(p.id,now));
  for(let step=0;step<1020;step++) {
    now+=50;const u=step*.001-2/track.length,at=track.at(u);
    for(const id of ['cut','clean']) {
      if(race.records.get(id).finishTime!==null)continue;
      const position=at.position.clone();position.y+=.85;
      if(id==='cut') {
        const offset=Math.max(0,1-Math.abs(u-.3)/.02)*9;
        position.x+=Math.cos(at.yaw)*offset;position.z-=Math.sin(at.yaw)*offset;
      }
      assert.equal(race.accept(id,state(position.toArray(),step),now),true);
    }
  }
  const cut=race.records.get('cut'),clean=race.records.get('clean');
  assert.equal(cut.completedLaps,0);assert.equal(cut.finishTime,null);assert.equal(cut.timing.next,3);
  assert.ok(cut.progress<.3);assert.equal(clean.completedLaps,1);
  const snapshot=race.standings().find(r=>r.id==='cut');assert.equal(snapshot.timingCount,10);assert.equal(snapshot.timingPassed,2);
});
test('Socket.IO supports twelve clients, ready checks, guest departure, reconnect and owner-controlled replay',async()=>{
  let now=10000;const server=await createGameServer({port:0,host:'127.0.0.1',advertisedHost:'127.0.0.1',now:()=>now,countdownMs:3000});
  const sockets=[];
  const request=(s,event,data={})=>new Promise((resolve,reject)=>s.timeout(2000).emit(event,data,(error,response)=>error?reject(error):resolve(response)));
  const make=async()=>{const s=connect(`http://127.0.0.1:${server.port}`,{transports:['websocket'],auth:{token:randomBytes(24).toString('hex')},reconnection:false});sockets.push(s);await new Promise(resolve=>s.once('connect',resolve));return s;};
  try {
    const first=await make(),created=await request(first,'createRoom',{name:'Pilote A'});assert.ok(created.ok);
    const code=created.room.code;
    assert.equal(MAX_PLAYERS,12);
    assert.equal((await (await fetch(`http://127.0.0.1:${server.port}/api/server-info`)).json()).maxPlayers,12);
    for(let i=1;i<MAX_PLAYERS;i++){now++;const s=await make();assert.ok((await request(s,'joinRoom',{name:`Ami${i}`,code})).ok);}
    const extra=await make();assert.equal((await request(extra,'joinRoom',{name:'Treizieme',code})).ok,false);
    assert.equal((await request(first,'startRace')).ok,false);
    assert.equal((await request(sockets[1],'setLaps',{laps:1})).ok,false);
    assert.ok((await request(first,'setLaps',{laps:1})).ok);
    for(const s of sockets.slice(0,MAX_PLAYERS))assert.ok((await request(s,'playerReady',{ready:true})).ok);
    assert.ok((await request(first,'startRace')).ok);
    const room=server.manager.rooms.get(code),raceId=room.race.id;
    assert.equal(room.race.records.size,12);
    assert.equal(new Set([...room.players.values()].map(p=>p.color)).size,12);
    assert.ok([...room.players.values()].every(p=>PLAYER_COLORS.includes(p.color)&&COLOR_NAMES.includes(p.colorName)));
    assert.equal(new Set([...room.race.records.values()].map(r=>r.spawn.position.join(','))).size,12);
    for(const s of sockets.slice(0,MAX_PLAYERS))assert.ok((await request(s,'raceLoaded',{raceId})).ok);
    assert.ok(room.race.startAt>now);now=room.race.startAt+1;server.manager.tick();assert.equal(room.state,'RACING');
    first.emit('raceFinished',{time:1});first.emit('checkpointPassed',{lap:99});await new Promise(resolve=>setTimeout(resolve,30));assert.equal(room.state,'RACING');
    const oldHost=room.hostId;assert.ok((await request(sockets[MAX_PLAYERS-1],'leaveRoom')).ok);assert.equal(room.hostId,oldHost);assert.equal(room.state,'RACING');
    const reconnecting=sockets[2],id=reconnecting.id;
    reconnecting.disconnect();await new Promise(resolve=>setTimeout(resolve,30));
    const restored=new Promise(resolve=>reconnecting.once('sessionRestored',resolve));reconnecting.connect();const restoredData=await restored;
    assert.ok(restoredData.playerId);assert.notEqual(reconnecting.id,id);assert.equal(room.state,'RACING');
    for(const r of room.race.records.values())r.dnf=true;server.manager.tick();assert.ok(room.state==='RESULTS'||room.state==='FINISHED');
    assert.equal((await request(sockets[1],'returnLobby')).ok,false);
    assert.ok((await request(first,'returnLobby')).ok);assert.equal(room.state,'LOBBY');assert.equal(room.race,null);
    for(const s of sockets.slice(0,MAX_PLAYERS-1))assert.ok((await request(s,'playerReady',{ready:true})).ok);
    assert.ok((await request(first,'startRace')).ok);assert.notEqual(room.race.id,raceId);
    for(const s of sockets.slice(0,MAX_PLAYERS-1))await request(s,'leaveRoom');assert.equal(server.manager.rooms.has(code),false);
  } finally {sockets.forEach(s=>s.disconnect());await server.close();}
});
