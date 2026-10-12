import test from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../src/Track.js';
import { CheckpointSystem } from '../src/CheckpointSystem.js';
import { LapCheckpointSystem } from '../src/LapCheckpointSystem.js';
import { TimeTrial,formatTime,BEST_TIME_KEY } from '../src/TimeTrial.js';
import { Settings } from '../src/Settings.js';

function memory(){const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v))};}
function cross(system,index){
  const gate=system.gates[index];
  const before=gate.position.clone().addScaledVector(gate.tangent,-.3);before.y+=1;
  const after=gate.position.clone().addScaledVector(gate.tangent,.3);after.y+=1;
  system.previous=before;
  return system.update(after,1/120,{distance:0});
}
test('Respawn markers can be skipped and never validate a timed checkpoint',()=>{
  const track=new Track(),c=new CheckpointSystem(track),timing=new LapCheckpointSystem(track);
  assert.equal(cross(c,3),3);assert.equal(cross(c,21),21);assert.equal(c.respawn(),c.gates[21]);
  assert.equal(timing.passed,0);assert.equal(cross(timing,0).missingCheckpoint,true);
});
test('All ten timing gates reject reverse travel and out-of-corridor crossings',()=>{
  const c=new LapCheckpointSystem(new Track());assert.equal(c.gates.length,10);
  for(let i=1;i<10;i++) {
    assert.ok(Math.abs(c.gates[i].u-i/10)<1e-8);c.passed=i-1;
    const gate=c.gates[i];c.previous=gate.position.clone().addScaledVector(gate.tangent,1);
    assert.equal(c.update(gate.position.clone().addScaledVector(gate.tangent,-1)),null);
    const side=gate.tangent.clone().set(gate.tangent.z,0,-gate.tangent.x).multiplyScalar(9);
    c.previous=gate.position.clone().add(side).addScaledVector(gate.tangent,-.1);
    assert.equal(c.update(gate.position.clone().add(side).addScaledVector(gate.tangent,.1)),null);assert.equal(c.next,i);
  }
});
test('Skipping any one of nine checkpoints prevents the finish from validating a lap',()=>{
  for(let skipped=1;skipped<10;skipped++) {
    const c=new LapCheckpointSystem(new Track());
    for(let i=1;i<10;i++)if(i!==skipped)cross(c,i);
    const missing=cross(c,0);assert.equal(missing.missingCheckpoint,true);assert.equal(missing.expected,skipped);
    for(let i=skipped;i<10;i++){const event=cross(c,i);assert.equal(event.checkpoint,true);assert.equal(event.index,i);}
    assert.equal(c.next,0);const lap=cross(c,0);assert.equal(lap.lap,true);assert.equal(lap.valid,true);assert.equal(c.passed,0);
    assert.equal(cross(c,0).missingCheckpoint,true,'finish cannot be counted twice');
  }
});
test('Duplicate or out-of-order gates never advance the expected checkpoint',()=>{
  const c=new LapCheckpointSystem(new Track());assert.equal(cross(c,3),null);assert.equal(c.next,1);
  cross(c,1);assert.equal(cross(c,1),null);assert.equal(c.next,2);assert.ok(c.progressAt(.8)<.2);
  for(let i=2;i<10;i++)cross(c,i);assert.equal(cross(c,0).lap,true);
});
test('Respawn retains elapsed time, rewinds earned gates and never grants skipped ones',()=>{
  const track=new Track(),c=new LapCheckpointSystem(track),trial=new TimeTrial(null);trial.reset('trial');trial.update(20,null);
  for(let i=1;i<=6;i++)cross(c,i);
  c.resetPosition(track.at(.7).position,.7);assert.equal(c.passed,6);assert.equal(c.update(track.at(.7).position),null);
  c.resetPosition(track.at(.47).position,.47);assert.equal(c.passed,4);
  c.resetPosition(track.at(.81).position,.81);assert.equal(c.passed,4,'forward reset cannot award gates 5..8');
  assert.equal(cross(c,0).expected,5);assert.equal(trial.lapTime,20);
  for(let i=5;i<10;i++)cross(c,i);assert.equal(cross(c,0).lap,true);
});
test('A teleport across a timing gate is ignored',()=>{
  const c=new LapCheckpointSystem(new Track()),gate=c.gates[1];
  c.previous=gate.position.clone().addScaledVector(gate.tangent,-7);
  assert.equal(c.update(gate.position.clone().addScaledVector(gate.tangent,7)),null);assert.equal(c.passed,0);
});
test('Old course records are retained without mixing with the new course',()=>{
  const storage=memory();storage.setItem('motocross.alpine.v1.best','29.5');storage.setItem('motocross.alpine.v2.best','65');
  const trial=new TimeTrial(storage);assert.equal(trial.best,null);trial.reset('trial');
  trial.update(40,{lap:true,valid:true,fraction:1});
  assert.equal(storage.getItem('motocross.alpine.v1.best'),'29.5');
  assert.equal(storage.getItem('motocross.alpine.v2.best'),'65');assert.equal(Number(storage.getItem(BEST_TIME_KEY)),40);
});
test('Time trials keep counting beyond two laps and persist later improvements, but not invalid laps',()=>{
  const storage=memory(),trial=new TimeTrial(storage);trial.reset('trial');
  for(const [time,valid] of [[40,true],[35,true],[32,true],[20,false],[34,true]]){
    trial.update(time-1,null);trial.update(1,{lap:true,valid,fraction:1});
    assert.equal(trial.finished,false);assert.equal(trial.lapTime,0);
  }
  assert.equal(trial.lap,6);assert.equal(trial.results.length,5);assert.equal(trial.total,161);assert.equal(trial.best,32);
  assert.equal(new TimeTrial(storage).best,32);
  trial.update(3,null);assert.equal(trial.total,164);assert.equal(trial.lapTime,3);
  trial.reset('trial');assert.equal(trial.lap,1);assert.equal(trial.results.length,0);assert.equal(trial.best,32);
  trial.reset('practice');trial.update(60,{lap:true,valid:true,fraction:1});assert.equal(trial.lapTime,0);
  assert.equal(formatTime(32.412),'00:32.412');
});
test('Settings validate values and survive storage failure',()=>{
  const storage=memory(),s=new Settings(storage);s.set('camera','wide');s.set('sensitivity',9);s.set('quality','potato');
  const restored=new Settings(storage);assert.equal(restored.values.camera,'wide');assert.equal(restored.values.sensitivity,1.6);assert.equal(restored.values.quality,'medium');
  s.set('camera','firstPerson');assert.equal(new Settings(storage).values.camera,'firstPerson');
  const unavailable={getItem(){throw new Error('Blocked');},setItem(){throw new Error('Blocked');}};
  assert.doesNotThrow(()=>{const s=new Settings(unavailable);s.set('fps',true);new TimeTrial(unavailable);});
});
