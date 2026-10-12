import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LapRecordStore } from '../server/LapRecordStore.js';
import { LapRecord } from '../src/LapRecord.js';
import { CIRCUIT_ID,LAP_RECORD_KEY,normalizeLapRecords } from '../shared/lapRecord.js';
import { SpectatorController } from '../src/SpectatorController.js';
import { Track } from '../src/Track.js';
import { RaceManager } from '../server/RaceManager.js';
import { createGameServer } from '../server/server.js';
import { TimeTrial } from '../src/TimeTrial.js';
import { LapCheckpointSystem } from '../src/LapCheckpointSystem.js';

test('Named browser record survives reload and nickname changes without accepting slower laps or old circuits',()=>{
  const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
  const first=new LapRecord(storage);first.setName('Pilote A');assert.ok(first.submit(65.123));
  const reload=new LapRecord(storage);reload.setName('Ami');
  assert.equal(reload.name,'Ami');assert.equal(reload.record.name,'Pilote A');
  assert.equal(reload.submit(70,'Pilote A'),false);assert.equal(reload.submit(65.123,'Pilote A'),false);
  assert.equal(reload.submit(NaN),false);assert.equal(reload.submit(-1),false);
  assert.ok(reload.submit(64.5));assert.equal(new LapRecord(storage).record.name,'Ami');
  data.set(LAP_RECORD_KEY,JSON.stringify({...reload.record,circuit:'old-two-gates'}));assert.equal(new LapRecord(storage).record,null);
  data.set(LAP_RECORD_KEY,'broken');assert.equal(new LapRecord(storage).record,null);
  const unavailable=new LapRecord({getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}});
  unavailable.submit(70,'Pilote A');assert.equal(unavailable.saved,false);assert.equal(unavailable.record.name,'Pilote A');
});

test('Server record persists atomically across restarts, ties and overlapping improvements',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'motocross-record-')),path=join(dir,'records.json');
  const server=await createGameServer({port:0,host:'127.0.0.1',recordPath:path});
  server.recordStore.submit(80,'Pilote A');server.recordStore.submit(78,'Alice');server.recordStore.submit(79,'Bob');server.recordStore.submit(78,'Tie');server.recordStore.submit(76.345,'Ami');
  await server.close();
  const file=JSON.parse(await readFile(path,'utf8'));assert.equal(file.records[0].name,'Ami');assert.equal(file.records[0].time,76.345);assert.equal(file.circuit,CIRCUIT_ID);
  const restarted=await createGameServer({port:0,host:'127.0.0.1',recordPath:path});
  try {
    const response=await fetch(`http://127.0.0.1:${restarted.port}/api/record`);
    assert.deepEqual((await response.json()).records,file.records);
    assert.equal(restarted.recordStore.submit(85,'Alice'),false);
  }finally{await restarted.close();}
  await writeFile(path,'invalid');assert.equal((await new LapRecordStore(path).load()).record,null);
});

test('Top five keeps one personal best per nickname, sorts improvements and migrates existing records',async()=>{
  const store=new LapRecordStore();
  for(let i=0;i<9;i++)store.submit(80+i,`Player${i}`,100+i);
  assert.equal(store.records.length,5);assert.deepEqual(store.records.map(r=>r.name),['Player0','Player1','Player2','Player3','Player4']);
  assert.equal(store.submit(83,'PLAYER1'),false);assert.ok(store.submit(76,'PLAYER1',200));
  assert.equal(store.records.length,5);assert.equal(store.record.name,'PLAYER1');assert.equal(store.records[1].name,'Player0');
  assert.ok(store.submit(78,'Player6',201));assert.equal(store.records[1].name,'Player6');assert.equal(store.records.at(-1).name,'Player3');
  const dir=await mkdtemp(join(tmpdir(),'motocross-migrate-')),path=join(dir,'record.json');
  await writeFile(path,JSON.stringify(store.record));
  const migrated=await new LapRecordStore(path).load();assert.deepEqual(migrated.records,[store.record]);
  migrated.submit(81,'New');await migrated.flush();assert.equal(JSON.parse(await readFile(path,'utf8')).records.length,2);
  const oldSeven=Array.from({length:7},(_,i)=>({...store.record,name:`Old${i}`,time:60+i}));
  await writeFile(path,JSON.stringify({circuit:CIRCUIT_ID,records:oldSeven}));
  assert.deepEqual((await new LapRecordStore(path).load()).records,oldSeven.slice(0,5));
  assert.deepEqual(normalizeLapRecords([{...store.record,circuit:'another-map',time:10},...oldSeven]),oldSeven.slice(0,5),'records from other maps never enter this circuit podium');
});

test('Server publishes every rider’s best completed lap, persists only ten-gate validated laps and keeps a DNF best lap',()=>{
  const track=new Track(),store=new LapRecordStore(),players=[{id:'a',name:'Alice',color:'#ffffff'},{id:'b',name:'Bob',color:'#dddddd'},{id:'cut',name:'Cut',color:'#aaaaaa'}];
  let now=10000;const race=new RaceManager(track,players,3,now,{countdownMs:0,recordStore:store});
  // Isolate record validation: these synthetic riders occupy identical poses.
  race.collisions.config={...race.collisions.config,enabled:false};
  players.forEach(p=>race.loaded(p.id,now));
  for(let step=0;step<2030;step++) {
    now+=step<1010?60:50;
    for(const player of players) {
      const u=step*.001-2/track.length,at=track.at(u),position=at.position.clone();position.y+=.85;
      if(player.id==='cut') {const d=((u%1)+1)%1,offset=Math.max(0,1-Math.abs(d-.3)/.02)*9;position.x+=Math.cos(at.yaw)*offset;position.z-=Math.sin(at.yaw)*offset;}
      assert.ok(race.accept(player.id,{position:position.toArray(),seq:step},now));
    }
  }
  const a=race.records.get('a'),b=race.records.get('b');assert.equal(a.lapTimes.length,2);assert.ok(a.lapTimes[1]<a.lapTimes[0]);
  race.disconnect('b',true);
  const rows=race.snapshot(now).standings;
  assert.equal(rows.find(p=>p.id==='a').bestLap,Math.min(...a.lapTimes));
  assert.equal(rows.find(p=>p.id==='b').bestLap,Math.min(...b.lapTimes));assert.equal(rows.find(p=>p.id==='b').dnf,true);
  assert.equal(rows.find(p=>p.id==='cut').bestLap,null);
  assert.equal(store.record.name,'Alice');assert.equal(store.record.time,a.lapTimes[1]);
});

test('Multiplayer: boost disqualifies lap from recordStore while keeping race lapTime and marking bestLapBoosted',()=>{
  const track=new Track(),store=new LapRecordStore(),players=[{id:'fast',name:'FastClean',color:'#ffffff'},{id:'booster',name:'Booster',color:'#dddddd'}];
  let now=10000;const race=new RaceManager(track,players,2,now,{countdownMs:0,recordStore:store});
  players.forEach(p=>race.loaded(p.id,now));
  const booster=race.records.get('booster'),fast=race.records.get('fast');
  booster.boostUsedInLap=true;
  for(let step=0;step<1020;step++) {
    now+=50;
    for(const player of players) {
      const u=step*.001-2/track.length,at=track.at(u),position=at.position.clone();position.y+=.85;
      assert.ok(race.accept(player.id,{position:position.toArray(),seq:step},now));
    }
  }
  assert.equal(fast.lapTimes.length,1);
  assert.equal(booster.lapTimes.length,1);
  assert.equal(store.records.length,1);
  assert.equal(store.record.name,'FastClean');
  assert.equal(store.records.some(r=>r.name==='Booster'),false);
  const standings=race.standings();
  assert.equal(standings.find(p=>p.id==='booster').bestLapBoosted,true);
  assert.equal(standings.find(p=>p.id==='fast').bestLapBoosted,false);
});

function spectatorFixture() {
  const calls=[],remotes=new Map(['a','b','c'].map(id=>[id,{bike:{group:{visible:true}},pose:{yaw:0,speed:10,steer:0}}]));
  const standings=['me','a','b','c'].map((id,i)=>({id,name:id,place:i+1,lap:1,time:id==='me'?70:null,dnf:false,disconnected:false}));
  const game={state:'net-arrived',settings:{values:{camera:'close'}},multiplayer:{inRace:true,playerId:'me',remotes,race:{laps:3,standings}},cameraController:{snap:()=>calls.push('snap'),update:(_dt,bike)=>calls.push(bike)},ui:{screen:{querySelector:()=>null,querySelectorAll:()=>[]}}};
  return {game,calls,standings,spectator:new SpectatorController(game)};
}
test('Spectator automatically follows only unfinished connected riders, cycles targets and cleans up on results/replay',()=>{
  const {game,calls,standings,spectator:s}=spectatorFixture();
  assert.equal(s.update(.016),true);assert.equal(s.current.id,'a');assert.equal(calls[0],'snap');
  s.update(.016);assert.equal(calls.filter(c=>c==='snap').length,1,'no repeated camera cuts');
  s.cycle(1);s.update(.016);assert.equal(s.current.id,'b');
  standings.find(r=>r.id==='b').time=72;s.update(.016);assert.equal(s.current.id,'a');
  standings.find(r=>r.id==='a').disconnected=true;s.update(.016);assert.equal(s.current.id,'c');
  standings.find(r=>r.id==='c').dnf=true;s.update(.016);assert.equal(s.current,null);assert.equal(s.active,true);
  standings.find(r=>r.id==='a').disconnected=false;s.update(.016);assert.equal(s.current.id,'a');
  game.state='net-results';assert.equal(s.update(.016),false);assert.equal(s.targetId,null);
  game.state='playing';assert.equal(s.update(.016),false);
});

test('TimeTrial flyingStart allows out-lap run-up from 75% track and commences official lap 1 at finish line', () => {
  const track = new Track();
  const check = new LapCheckpointSystem(track);
  const trial = new TimeTrial();

  function crossGate(system, index) {
    const gate = system.gates[index];
    const before = gate.position.clone().addScaledVector(gate.tangent, -0.3); before.y += 1;
    const after = gate.position.clone().addScaledVector(gate.tangent, 0.3); after.y += 1;
    system.previous = before;
    return system.update(after);
  }

  // Reset in trial mode with flyingStart
  trial.reset('trial', { flyingStart: true });
  check.reset();
  check.setLaunching(true);

  assert.equal(trial.flyingStart, true);
  assert.equal(trial.isLaunching, true);
  assert.equal(trial.lap, 0);
  assert.equal(check.launching, true);

  // Cross gate 8 and 9 during launch: should NOT increment passed or finish lap
  const ev8 = crossGate(check, 8);
  assert.equal(check.launching, true);
  assert.equal(ev8?.launching, true);
  trial.update(1.0, ev8);
  assert.equal(trial.isLaunching, true);
  assert.equal(trial.lap, 0);

  const ev9 = crossGate(check, 9);
  assert.equal(check.launching, true);
  assert.equal(ev9?.launching, true);
  trial.update(1.0, ev9);
  assert.equal(trial.isLaunching, true);
  assert.equal(trial.lap, 0);

  // Cross start/finish line (Gate 0)
  const launchCross = crossGate(check, 0);
  assert.ok(launchCross?.launchCompleted, 'Crossing line triggers launchCompleted');
  assert.equal(check.launching, false, 'LapCheckpointSystem leaves launch mode');

  trial.update(0.016, launchCross);
  assert.equal(trial.isLaunching, false, 'TimeTrial leaves launch mode');
  assert.equal(trial.lap, 1, 'Official Lap 1 starts now');
  assert.ok(trial.lapTime < 0.1, 'Lap 1 time starts from line crossing');

  // Complete Lap 1 through all 10 gates (1..9, then 0)
  for (let i = 1; i < check.gates.length; i++) {
    const ev = crossGate(check, i);
    trial.update(5.0, ev);
    assert.equal(ev?.checkpoint, true, `Gate ${i} should be validated`);
    assert.equal(ev.index, i);
  }

  // Cross finish line for Lap 1
  const lap1Finish = crossGate(check, 0);
  assert.equal(lap1Finish?.lap, true);
  assert.equal(lap1Finish.valid, true);
  trial.update(5.0, lap1Finish);

  assert.equal(trial.lap, 2, 'Moves to Lap 2');
  assert.equal(trial.results.length, 1, '1 lap recorded');
  assert.equal(trial.results[0].valid, true);

  // Complete Lap 2
  for (let i = 1; i < check.gates.length; i++) {
    const ev = crossGate(check, i);
    trial.update(5.0, ev);
  }
  const lap2Finish = crossGate(check, 0);
  trial.update(5.0, lap2Finish);

  assert.equal(trial.finished, false, 'Flying-start trial continues after 2 laps');
  assert.equal(trial.lap, 3, 'Lap 3 begins immediately');
  assert.equal(trial.results.length, 2, '2 laps recorded in results');
  assert.ok(trial.best > 0, 'Best lap is recorded');
});

test('POST /api/trial-record accepts valid solo time trial laps into the server leaderboard and rejects cheats', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motocross-trial-record-')), path = join(dir, 'records.json');
  const server = await createGameServer({ port: 0, host: '127.0.0.1', recordPath: path });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const res = await fetch(`${base}/api/trial-record?map=alpine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time: 48.5, name: 'SoloRider' })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.records.length, 1);
    assert.equal(data.records[0].name, 'SoloRider');
    assert.equal(data.records[0].time, 48.5);

    const cheat = await fetch(`${base}/api/trial-record?map=alpine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time: 10.0, name: 'Hacker' })
    });
    assert.equal(cheat.status, 403);

    const badMap = await fetch(`${base}/api/trial-record?map=invalid_map`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time: 50.0, name: 'Rider' })
    });
    assert.equal(badMap.status, 403);

    const boostSubmission = await fetch(`${base}/api/trial-record?map=alpine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time: 45.0, name: 'BoostUser', boost: true })
    });
    assert.equal(boostSubmission.status, 403);
  } finally {
    await server.close();
  }
});
