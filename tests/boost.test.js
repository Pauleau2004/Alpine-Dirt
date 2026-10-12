import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { io } from 'socket.io-client';
import { LastPlaceBoostManager,boostStrength } from '../shared/lastPlaceBoost.js';
import { createGameServer } from '../server/server.js';

const racers=n=>Array.from({length:n},(_,i)=>({id:String(i),progress:.49-i*.02,finishTime:null,disconnected:false,dnf:false}));
test('Boost unlocks on validated leader progress, then charges only the dynamic last racer for ten seconds',()=>{
  for(const n of [2,4,6,7]) {
    const rows=racers(n),m=new LastPlaceBoostManager('race',n===7?'soloRace':'multiplayerRace'),last=String(n-1);
    m.update(0,rows,false);m.update(50000,rows);assert.equal(m.boostSystemUnlocked,false);assert.equal(m.activate(last),null);
    rows[0].progress=.5;m.update(51000,rows);assert.equal(m.boostSystemUnlocked,true);assert.equal(m.lastPlacePlayerId,last);
    assert.equal(m.stateFor(last).state,'CHARGING');assert.equal(m.stateFor('0').state,'INELIGIBLE');
    m.update(60999,rows);assert.equal(m.stateFor(last).state,'CHARGING');assert.equal(m.activate(last),null);
    m.update(61000,rows);assert.equal(m.stateFor(last).state,'READY');assert.equal(m.stateFor(last).chargeSeconds,10);
    m.update(100000,rows);assert.equal(m.stateFor(last).chargeSeconds,10);assert.equal(m.activate('0'),null);
    const event=m.activate(last);assert.equal(event.endTime-event.startTime,2500);assert.equal(m.activate(last),null);
    m.update(102499,rows);assert.equal(m.stateFor(last).state,'ACTIVE');
    m.update(102500,rows);assert.equal(m.stateFor(last).state,'CHARGING');assert.equal(m.stateFor(last).chargeSeconds,0);
  }
});
test('Overtakes clear partial and ready charges immediately; an activated boost finishes after an overtake',()=>{
  const rows=racers(3),m=new LastPlaceBoostManager('race','multiplayerRace');rows[0].progress=.6;
  m.update(0,rows);m.update(7000,rows);assert.equal(m.stateFor('2').chargeSeconds,7);
  [rows[1],rows[2]]=[rows[2],rows[1]];m.update(7001,rows);assert.equal(m.stateFor('2').chargeSeconds,0);assert.equal(m.stateFor('2').state,'INELIGIBLE');
  [rows[1],rows[2]]=[rows[2],rows[1]];m.update(7002,rows);assert.equal(m.stateFor('2').chargeSeconds,0);
  m.update(17002,rows);assert.equal(m.stateFor('2').state,'READY');
  [rows[1],rows[2]]=[rows[2],rows[1]];m.update(17003,rows);assert.equal(m.activate('2'),null);assert.equal(m.stateFor('2').available,false);
  m.update(27003,rows);const event=m.activate('1');assert.ok(event);
  [rows[1],rows[2]]=[rows[2],rows[1]];m.update(27500,rows);assert.equal(m.stateFor('1').state,'ACTIVE');assert.ok(boostStrength(m.stateFor('1'),27500)>0);
  m.update(29503,rows);assert.equal(m.stateFor('1').state,'INELIGIBLE');assert.equal(m.stateFor('1').chargeSeconds,0);
  for(let i=0;i<25;i++){[rows[1],rows[2]]=[rows[2],rows[1]];m.update(30000+i*10,rows);assert.equal(m.stateFor(m.lastPlacePlayerId).chargeSeconds,0);}
});
test('Disconnect, respawn, finish, replay, disabled modes and backward clocks cannot retain or farm a charge',()=>{
  const rows=racers(3),m=new LastPlaceBoostManager('race','soloRace');rows[0].progress=.6;m.update(0,rows);m.update(10000,rows);
  rows[2].disconnected=true;m.update(10001,rows);assert.equal(m.lastPlacePlayerId,'1');assert.equal(m.stateFor('2').available,false);
  m.update(20001,rows);assert.ok(m.activate('1'));m.resetPlayer('1');m.update(20002,rows);assert.equal(m.stateFor('1').state,'CHARGING');
  m.update(20010,rows);m.update(10000,rows);assert.ok(m.stateFor('1').chargeSeconds>=0);
  rows[1].finishTime=21;m.update(21000,[rows[1],rows[0],rows[2]]);assert.equal(m.lastPlacePlayerId,'0');
  rows[0].finishTime=22;m.update(22000,rows,false);assert.equal(m.lastPlacePlayerId,null);assert.equal(m.activate('0'),null);
  const fresh=new LastPlaceBoostManager('next','soloRace');fresh.update(0,racers(3));assert.equal(fresh.boostSystemUnlocked,false);
  const disabled=new LastPlaceBoostManager('off','soloRace',{modes:{soloRace:false}});disabled.update(999999,rows);assert.equal(disabled.boostSystemUnlocked,false);
});

for(const count of [2,6])test(`LAN with ${count} sockets authorizes only the last rider and ignores forged duration, id and availability`,async()=>{
  let now=10000;const server=await createGameServer({port:0,host:'127.0.0.1',now:()=>now,countdownMs:0}),sockets=[];
  const request=(s,event,data={})=>new Promise((resolve,reject)=>s.timeout(2000).emit(event,data,(error,r)=>error?reject(error):resolve(r)));
  try {
    for(let i=0;i<count;i++) {const socket=io(`http://127.0.0.1:${server.port}`,{transports:['websocket'],auth:{token:randomBytes(24).toString('hex')},reconnection:false});sockets.push(socket);await new Promise(resolve=>socket.once('connect',resolve));await request(socket,'joinLocal',{name:`Rider${i}`});await request(socket,'playerReady',{ready:true});}
    await request(sockets[0],'startRace');const room=server.manager.rooms.get('MXTEAM'),race=room.race,rows=[...race.records.values()];
    for(const s of sockets)await request(s,'raceLoaded',{raceId:race.id});server.manager.tick();
    assert.equal((await request(sockets.at(-1),'requestBoost',{raceId:race.id,boostAvailable:true})).ok,false);
    for(let step=0;step<523;step++) {
      now+=50;
      rows.forEach((r,i)=>{const at=race.track.at(step*.001*(1-i*.01)-(2+Math.floor(i/2)*3.4)/race.track.length);at.position.y+=.9;assert.ok(race.accept(r.id,{seq:step,position:at.position.toArray()},now));});
      if(step===450)assert.equal(race.boost.boostSystemUnlocked,false);
    }
    const last=rows.at(-1);assert.equal(race.boost.lastPlacePlayerId,last.id);
    const chargedAt=race.boost.stateFor(last.id).chargeStartTime+10000;
    now=chargedAt-1;server.manager.tick();assert.equal((await request(sockets.at(-1),'requestBoost',{raceId:race.id})).ok,false);
    now=chargedAt;server.manager.tick();assert.equal(race.boost.stateFor(last.id).state,'READY');
    assert.equal((await request(sockets[0],'requestBoost',{raceId:race.id,playerId:last.id,boostAvailable:true})).ok,false);
    const notifications=sockets.map(s=>new Promise(resolve=>s.once('playerBoostStarted',resolve)));
    const allowed=await request(sockets.at(-1),'requestBoost',{raceId:race.id,durationSeconds:999,endTime:now+999999,boostAvailable:true});assert.ok(allowed.ok);
    assert.equal(allowed.boostActivated.endTime-allowed.boostActivated.startTime,2500);
    for(const event of await Promise.all(notifications))assert.equal(event.playerId,last.id);
    assert.equal((await request(sockets.at(-1),'requestBoost',{raceId:race.id})).ok,false);
    now+=2500;server.manager.tick();assert.equal(race.boost.stateFor(last.id).state,'CHARGING');
    if(count===6){
      now+=10000;server.manager.tick();assert.equal(race.boost.stateFor(last.id).state,'READY');
      for(let change=0;change<4;change++) {
        const oldLast=race.boost.lastPlacePlayerId,order=race.standings(),previous=race.records.get(order.at(-2).id),r=race.records.get(oldLast);
        now+=250;const at=race.track.at(previous.nearU+.003);at.position.y+=.9;
        assert.ok(race.accept(oldLast,{seq:r.lastSeq+1,position:at.position.toArray()},now));
        assert.notEqual(race.boost.lastPlacePlayerId,oldLast);assert.equal(race.boost.stateFor(oldLast).state,'INELIGIBLE');
        assert.equal(race.boost.stateFor(race.boost.lastPlacePlayerId).chargeSeconds,0);
      }
      const leaving=race.boost.lastPlacePlayerId;assert.notEqual(leaving,rows[0].id);
      await request(sockets[rows.findIndex(r=>r.id===leaving)],'leaveRoom');assert.notEqual(race.boost.lastPlacePlayerId,leaving);assert.equal(race.boost.totalRacers,5);
    }
    assert.equal((await request(sockets[0],'requestBoost',{raceId:'old-race'})).ok,false);
  }finally{sockets.forEach(s=>s.disconnect());await server.close();}
});
