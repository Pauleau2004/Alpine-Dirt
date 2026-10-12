import test from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../src/Track.js';
import { wrapAngle } from '../src/math.js';

const track=new Track();
test('Every bend is level, bump-free and connected without a steering kink',()=>{
  let cornerSamples=0,minimumRadius=Infinity;
  for(let i=0;i<track.count;i++) {
    const u=i/track.count,s=track.sectionAt(u),p=track.at(u);
    if(s.kind==='corner') {
      cornerSamples++;
      assert.equal(track.obstacleHeight(u),0,'no obstacle may extend into a corner');
      assert.equal(track.profile(u),s.fromHeight,'no hill crest or ripple inside a corner');
      assert.ok(Math.abs(p.pitch)<.0001,'the rendered/raycast surface must also be level');
    }
    const headingChange=Math.abs(wrapAngle(track.at(u+1/track.length).yaw-track.at(u-1/track.length).yaw));
    minimumRadius=Math.min(minimumRadius,2/Math.max(headingChange,1e-9));
    assert.ok(p.position.distanceTo(track.at((i+1)/track.count).position)<.8,'no seam or gap in the loop');
  }
  assert.ok(cornerSamples>400);
  assert.ok(minimumRadius>16,`bend too tight: ${minimumRadius.toFixed(1)} m radius`);
  assert.ok(track.at(0).position.distanceTo(track.at(1).position)<1e-9);
});

test('Take-offs and landings remain aligned, with clear exit and braking zones',()=>{
  for(const f of track.features) {
    const end=f.start+f.rise+f.top+f.fall,s=track.sectionAt(f.start);
    assert.equal(s.kind,'straight');assert.equal(track.sectionAt(end),s);
    const distanceToEnd=(s.end-s.start)-f.offset-(f.rise+f.top+f.fall)*track.length;
    assert.ok(f.offset>=12,'allow the bike to straighten after the preceding corner');
    assert.ok(distanceToEnd>=20,'reserve at least 20 m to settle and brake before turning');
    const heading=track.at(f.start).yaw;
    for(let u=f.start-10/track.length;u<=end+18/track.length;u+=.5/track.length) {
      assert.equal(track.sectionAt(u),s,'the whole approach and run-out must stay straight');
      assert.ok(Math.abs(wrapAngle(track.at(u).yaw-heading))<.0001,'jump must not aim away from its landing');
      assert.ok(Math.abs(track.at(u).pitch)<.55,'no abrupt, excessively steep ramp');
    }
    for(const u of [f.start,end])assert.ok(Math.abs(track.obstacleHeight(u))<1e-10,'ramp must join the base surface cleanly');
  }
  for(let distance=-10;distance<95;distance+=1) {
    const u=distance/track.length;
    assert.equal(track.sectionAt(u).kind,'straight','a clear start grid and starting straight');
    assert.equal(track.obstacleHeight(u),0);
    assert.equal(track.at(u).pitch,0);
  }
});

test('Rhythm sections have rounded, spaced waves on level ground, away from timing gates',()=>{
  for(const index of [3,5]) {
    const waves=track.features.filter(f=>f.section===index);
    assert.equal(waves.length,3);
    for(let i=0;i<waves.length;i++) {
      const f=waves[i];assert.ok(f.height<=.8);
      assert.equal(track.baseProfile(f.start),track.baseProfile(f.start+f.rise+f.fall));
      if(i)assert.ok(Math.abs((f.start-waves[i-1].start)*track.length-9)<.01);
    }
  }
  assert.equal(track.obstacleHeight(0),0);assert.equal(track.obstacleHeight(.5),0);
  // Non-neighbouring sections must not overlap: 16 m ribbon plus separation.
  const count=320;
  for(let i=0;i<count;i++)for(let j=i+1;j<count;j++) {
    if(Math.min(j-i,count-j+i)*track.length/count<45)continue;
    const a=track.at(i/count).position,b=track.at(j/count).position;
    assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>22,'separate lanes must remain distinct and readable');
  }
});
