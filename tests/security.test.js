import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { io } from 'socket.io-client';
import { createGameServer } from '../server/server.js';
import { createRequestPolicy,ConnectionGuard } from '../server/RequestSecurity.js';
import { isOwnerConnection } from '../server/HostIdentity.js';
import { MovementGuard } from '../server/MovementGuard.js';
import { RaceManager } from '../server/RaceManager.js';
import { Track } from '../src/Track.js';
import { validateState } from '../server/NetworkValidator.js';

const token=()=>randomBytes(24).toString('hex');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const call=(s,event,data={})=>new Promise((resolve,reject)=>s.timeout(2000).emit(event,data,(error,r)=>error?reject(error):resolve(r)));
const rawStatus=(url,headers)=>new Promise((resolve,reject)=>{const r=httpRequest(url,{headers},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});r.once('error',reject);r.end();});
async function client(server,auth={},options={}) {
  const s=io(`http://127.0.0.1:${server.port}`,{transports:['websocket'],reconnection:false,auth:{token:token(),...auth},...options});
  await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});return s;
}

test('Production rejects direct record writes, external origins and DNS rebinding over HTTP and WebSocket',async()=>{
  const server=await createGameServer({port:0,host:'127.0.0.1'}),base=`http://127.0.0.1:${server.port}`;
  try {
    for(const map of ['alpine','hillside','gaptrack','canyon','quarry','../../other']) {
      const r=await fetch(`${base}/api/trial-record?map=${map}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({time:5.001,name:'Pilote A',isHost:true,debug:false})});
      assert.equal(r.status,403);
    }
    assert.ok([...server.recordStores.values()].every(s=>s.records.length===0));
    for(const headers of [{Host:`attacker.invalid:${server.port}`},{Origin:'http://attacker.invalid'},{Origin:'null'},{Host:`attacker.invalid:${server.port}`,Origin:`http://attacker.invalid:${server.port}`}]) {
      assert.equal(await rawStatus(`${base}/api/server-info`,headers),403,JSON.stringify(headers));
      await assert.rejects(client(server,{}, {extraHeaders:headers}));
    }
    const r=await fetch(base);assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(r.headers.get('content-security-policy'),/wasm-unsafe-eval/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');
    assert.equal(await rawStatus(base,{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate'}),200,'shared links still open from another application');
    for(const path of ['/server/server.js','/data/lap-record.json','/.env','/@fs/C:/Windows/win.ini'])assert.equal((await fetch(base+path)).status,404);
  }finally{await server.close();}
});

test('Host policy ignores claimed names, IDs, headers and public debug tokens',()=>{
  const socket={request:{socket:{remoteAddress:'203.0.113.9'},headers:{host:'localhost:3000','x-forwarded-for':'127.0.0.1','x-real-ip':'127.0.0.1',forwarded:'for=127.0.0.1'}},handshake:{auth:{isHost:true,isServerOwner:true,name:'Pilote A',dev_auth:'test_runner_dev_mode'}}};
  assert.equal(isOwnerConnection(socket),false);
  const policy=createRequestPolicy(['hote-test.local']);
  const req=headers=>({headers,socket:{localPort:3000}});
  for(const host of ['attacker.invalid:3000','localhost.attacker.invalid:3000','localhost:3000@attacker.invalid','localhost:1234','localhost:3000/a'])assert.equal(policy(req({host})),false);
  assert.ok(policy(req({host:'hote-test.local:3000',origin:'http://hote-test.local:3000'})));
});

test('Development HTTP cannot expose server files, stored records or test scripts',async()=>{
  const server=await createGameServer({port:0,host:'127.0.0.1',dev:true});
  try {
    const base=`http://127.0.0.1:${server.port}`;
    for(const path of ['/server/HostIdentity.js','/server/RaceManager.js?raw','/tests/security.test.js','/scripts/launch-desktop.mjs'])assert.equal((await fetch(base+path)).status,403,path);
    assert.equal((await fetch(base+'/src/main.js')).status,200,'client sources remain available to the development browser');
  }finally{await server.close();}
});

test('Guests cannot control the host, another racer, or duplicate an active nickname; chat text cannot spoof its author',async()=>{
  const ownerToken=token(),server=await createGameServer({port:0,host:'127.0.0.1',countdownMs:0,isOwnerConnection:s=>s.handshake.auth.token===ownerToken}),sockets=[];
  try {
    const owner=await client(server,{token:ownerToken}),guest=await client(server,{name:'Pilote A',isHost:true,dev_auth:'test_runner_dev_mode'});sockets.push(owner,guest);
    const a=await call(owner,'joinLocal',{name:'Pilote A'});
    assert.equal((await call(guest,'joinLocal',{name:'ＰＩＬＯＴＥ Ａ'})).ok,false);
    const b=await call(guest,'joinLocal',{name:'Ami'});assert.ok(b.ok);assert.equal(b.room.hostId,a.playerId);
    const room=server.manager.rooms.get(a.room.code);
    for(const [event,data] of [['createRoom',{name:'Pilote A'}],['setLaps',{laps:1}],['setMap',{mapId:'canyon'}],['startRace',{}],['returnLobby',{}]])assert.equal((await call(guest,event,{...data,playerId:a.playerId,hostId:b.playerId,isServerOwner:true})).ok,false,event);
    await call(owner,'playerReady',{ready:true});await call(guest,'playerReady',{ready:true});await call(owner,'startRace');
    const race=room.race;await call(owner,'raceLoaded',{raceId:race.id});await call(guest,'raceLoaded',{raceId:race.id});server.manager.tick();
    const hostRecord=race.records.get(a.playerId),hostPosition=hostRecord.position.toArray();
    await call(guest,'resetBike',{raceId:race.id,playerId:a.playerId,spawn:[0,0,0]});
    assert.equal(hostRecord.resetVersion,0);assert.deepEqual(hostRecord.position.toArray(),hostPosition);
    guest.emit('raceFinished',{raceId:race.id,playerId:a.playerId,time:.1});guest.emit('checkpointPassed',{lap:999});
    const received=new Promise(resolve=>owner.once('chatMessage',resolve));
    const payload='<img src=x onerror=alert(1)>';
    assert.ok((await call(guest,'chatMessage',{text:payload,name:'Pilote A',color:'red',playerId:a.playerId})).ok);
    const chat=await received;assert.equal(chat.name,'Ami');assert.equal(chat.playerId,b.playerId);assert.equal(chat.color,room.players.get(b.playerId).color);assert.equal(chat.text,payload);
    assert.equal(hostRecord.completedLaps,0);assert.equal(hostRecord.finishTime,null);
    assert.ok((await call(owner,'timeSync')).ok,'host stays responsive after refused attempts');
  }finally{sockets.forEach(s=>s.disconnect());await server.close();}
});

test('A stolen guest reconnection token cannot restore a session from a different TCP source',async()=>{
  const sessionToken=token(),server=await createGameServer({port:0,host:'127.0.0.1',isOwnerConnection:()=>false}),sockets=[];
  try {
    const real=await client(server,{token:sessionToken});sockets.push(real);
    const joined=await call(real,'joinLocal',{name:'Ami'}),p=server.manager.sessions.get(sessionToken);assert.equal(p.address,'127.0.0.1');
    real.disconnect();await wait(30);
    const thief=await client(server,{token:sessionToken},{localAddress:'127.0.0.2'});sockets.push(thief);await wait(30);
    assert.equal(p.connected,false);assert.equal((await call(thief,'playerReady',{ready:true})).ok,false);assert.equal((await call(thief,'joinLocal',{name:'Ami'})).ok,false);
    thief.disconnect();
    const restored=new Promise(resolve=>real.once('sessionRestored',resolve));real.connect();assert.equal((await restored).playerId,joined.playerId);
  }finally{sockets.forEach(s=>s.disconnect());await server.close();}
});

test('Reconnect flooding consumes a shared bounded budget and unknown-event floods disconnect only the sender',async()=>{
  let now=1000;const guard=new ConnectionGuard({now:()=>now,maxConnections:3,maxPerAddress:2});
  const a=guard.acquire('a'),b=guard.acquire('a');assert.equal(guard.acquire('a'),null);
  assert.ok(guard.acquire('b'));assert.equal(guard.acquire('c'),null);a.release();a.release();assert.equal(guard.total,2);assert.ok(guard.acquire('c'));
  b.release();assert.equal(guard.total,2);
  const flood=new ConnectionGuard({now:()=>now});for(let i=0;i<24;i++)flood.acquire('a').release();assert.equal(flood.acquire('a'),null);now+=500;assert.ok(flood.acquire('a'));
  const server=await createGameServer({port:0,host:'127.0.0.1'}),sockets=[];
  try {
    const normal=await client(server),bad=await client(server);sockets.push(normal,bad);
    const closed=new Promise(resolve=>bad.once('disconnect',resolve));for(let i=0;i<220;i++)bad.emit('unknownEvent',{i});await closed;
    assert.ok((await call(normal,'timeSync')).ok);
  }finally{sockets.forEach(s=>s.disconnect());await server.close();}
});

test('Movement tolerance cannot be multiplied by packet count, backdated timestamps or idle time',()=>{
  const guard=new MovementGuard(10000);let distance=0;
  for(let i=0;i<1000;i++)if(guard.accept(.2,10000))distance+=.2;
  assert.ok(distance<=1.200001);
  assert.equal(guard.accept(1,9999),false);assert.equal(guard.accept(18,100000),false);
  const fast=new MovementGuard(0);let accepted=0;
  for(let ms=0;ms<1000;ms+=10)if(fast.accept(1,ms))accepted++;
  assert.ok(accepted<=66,'one second never allows more than 65 m plus one jitter reserve');
  const jitter=new MovementGuard(0);assert.ok(jitter.accept(.8,0));assert.ok(jitter.accept(6.5,100));assert.ok(jitter.accept(9.5,250));
});

test('Repeated impossible positions cause an authoritative reset without awarding gates or records',()=>{
  const track=new Track(),race=new RaceManager(track,[{id:'a',name:'Pilote A',color:'#fff'}],1,10000,{countdownMs:0});race.loaded('a',10000);
  const r=race.records.get('a'),original=r.position.toArray();
  for(let i=0;i<6;i++)assert.equal(race.accept('a',{seq:i,resetVersion:0,position:[original[0]+50,original[1],original[2]],velocity:[0,0,0]},10050+i),false);
  assert.equal(r.resetVersion,1);assert.equal(race.resetEvents[0].reason,'invalid-state');assert.equal(r.completedLaps,0);assert.equal(r.timing.passed,0);assert.equal(r.lapTimes.length,0);
  assert.equal(race.accept('a',{seq:100,resetVersion:0,position:r.position.toArray(),velocity:[0,0,0]},10100),false);
  assert.equal(race.accept('a',{seq:100,resetVersion:1,position:r.position.toArray(),velocity:[0,0,0]},10100),true);
  race.disconnect('a');assert.equal(race.accept('a',{seq:101,resetVersion:1,position:r.position.toArray(),velocity:[0,0,0]},10101),false);
});

test('Malformed and excessive vector states never reach physics or server timing',()=>{
  const base={raceId:'r',seq:0,timestamp:0,position:[0,1,0],rotation:[0,0,0,1],velocity:[0,0,12],angularVelocity:[0,0,0],speed:12,steer:0,pitch:0,roll:0,throttle:1,suspension:[.6,.6],compression:[.1,.1],grounded:true};
  assert.ok(validateState(base));
  for(const part of [{seq:-1},{seq:Infinity},{position:[NaN,0,0]},{position:[0,0,300]},{velocity:[65,0,65]},{rotation:[0,0,0,0]},{collisionAck:-1},{resetVersion:'1'},{suspension:Array(100).fill(.6)}])assert.equal(validateState({...base,...part}),null);
});
