import { MAX_PLAYERS } from '../shared/multiplayer.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { io } from 'socket.io-client';
import { isServerAddress,isOwnerConnection } from '../server/HostIdentity.js';
import { createGameServer } from '../server/server.js';

test('Host identity uses the TCP source on the server PC and ignores client names, auth claims and forwarded headers',()=>{
  const interfaces={'Wi-Fi':[{address:'192.168.1.23'}],Ethernet:[{address:'fe80::abcd%3'}]};
  for(const peer of ['127.0.0.1','::1','::ffff:127.0.0.1','192.168.1.23','::ffff:192.168.1.23','fe80::abcd%7'])assert.equal(isServerAddress(peer,interfaces),true);
  for(const peer of ['192.168.1.24','192.168.1.2','',undefined])assert.equal(isServerAddress(peer,interfaces),false);
  assert.equal(isOwnerConnection({request:{socket:{remoteAddress:'203.0.113.15'},headers:{host:'localhost:3000','x-forwarded-for':'127.0.0.1'}},handshake:{auth:{isHost:true,name:'Pilote A'}}}),false);
});

test('Eleven guests can arrive first but only the server owner can start, replay and recover the host role',async()=>{
  let now=10000;const ownerToken=randomBytes(24).toString('hex'),refreshToken=randomBytes(24).toString('hex');
  const options={port:0,host:'127.0.0.1',now:()=>now,countdownMs:0,isOwnerConnection:s=>[ownerToken,refreshToken].includes(s.handshake.auth.token)};
  let server=await createGameServer(options);const sockets=[];
  const call=(s,event,data={})=>new Promise((resolve,reject)=>s.timeout(2000).emit(event,data,(error,r)=>error?reject(error):resolve(r)));
  const make=async(token=randomBytes(24).toString('hex'))=>{const s=io(`http://127.0.0.1:${server.port}`,{transports:['websocket'],reconnection:false,auth:{token,isHost:true,name:'Pilote A'}});sockets.push(s);await new Promise(resolve=>s.once('connect',resolve));return s;};
  try {
    for(let i=0;i<MAX_PLAYERS-1;i++) {const guest=await make(),r=await call(guest,'joinLocal',{name:i===0?'Pilote A':`Ami${i}`});assert.ok(r.ok);assert.equal(r.room.hostId,null);assert.equal(r.room.hostPresent,false);await call(guest,'playerReady',{ready:true});}
    const extra=await make();assert.equal((await call(extra,'joinLocal',{name:'Invite 12'})).ok,false);
    assert.equal((await call(extra,'createRoom',{name:'Pilote A'})).ok,false);
    assert.equal((await call(sockets[0],'setLaps',{laps:1})).ok,false);assert.equal((await call(sockets[0],'startRace')).ok,false);
    now+=1000;const owner=await make(ownerToken),joined=await call(owner,'joinLocal',{name:'Mon pseudo'});assert.ok(joined.ok);assert.equal(joined.room.hostId,joined.playerId);assert.equal(joined.room.players.length,MAX_PLAYERS);
    const room=server.manager.rooms.get(joined.room.code);
    await call(owner,'setLaps',{laps:1});await call(owner,'playerReady',{ready:true});assert.ok((await call(owner,'startRace')).ok);
    const raceId=room.race.id;for(const s of [...sockets.slice(0,MAX_PLAYERS-1),owner])assert.ok((await call(s,'raceLoaded',{raceId})).ok);server.manager.tick();assert.equal(room.state,'RACING');
    owner.disconnect();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(room.hostId,joined.playerId);assert.equal(server.manager.roomState(room).hostPresent,false);
    assert.equal((await call(sockets[0],'returnLobby')).ok,false);
    const restored=new Promise(resolve=>owner.once('sessionRestored',resolve));owner.connect();const data=await restored;assert.equal(data.playerId,joined.playerId);assert.equal(data.room.hostId,joined.playerId);assert.equal(data.room.hostPresent,true);
    for(const r of room.race.records.values())r.dnf=true;server.manager.tick();
    assert.equal((await call(sockets[0],'returnLobby')).ok,false);assert.ok((await call(owner,'returnLobby')).ok);
    now+=1000;for(const s of [...sockets.slice(0,MAX_PLAYERS-1),owner])await call(s,'playerReady',{ready:true});assert.ok((await call(owner,'startRace')).ok);
    assert.ok((await call(owner,'leaveRoom')).ok);assert.equal(room.hostId,null);assert.equal(room.state,'LOBBY');assert.equal(room.race,null);assert.ok([...room.players.values()].every(p=>!p.ready));
    now+=1000;const back=await call(owner,'joinLocal',{name:'Mon pseudo'});assert.ok(back.ok);assert.equal(room.hostId,back.playerId);
    owner.disconnect();await new Promise(resolve=>setTimeout(resolve,30));
    const refreshed=await make(refreshToken),refresh=await call(refreshed,'joinLocal',{name:'Mon pseudo'});assert.ok(refresh.ok);assert.equal(room.hostId,refresh.playerId);assert.equal(room.players.size,MAX_PLAYERS);
    refreshed.disconnect();await new Promise(resolve=>setTimeout(resolve,30));now+=6000;server.manager.tick();assert.equal(room.hostId,null);assert.equal(room.state,'LOBBY');
    sockets.forEach(s=>s.disconnect());await server.close();
    server=await createGameServer(options);
    const guest=await make();assert.equal((await call(guest,'joinLocal',{name:'Pilote A'})).room.hostId,null);
    const restartedOwner=await make(ownerToken),again=await call(restartedOwner,'joinLocal',{name:'Mon pseudo'});assert.equal(again.room.hostId,again.playerId);
  }finally{sockets.forEach(s=>s.disconnect());await server.close();}
});
