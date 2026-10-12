import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { createTrack } from '../src/tracks/createTrack.js';
import { GapTrack } from '../src/tracks/GapTrack.js';
import { LapCheckpointSystem } from '../src/LapCheckpointSystem.js';
import { BikePhysics } from '../src/BikePhysics.js';
import { capsuleContact } from '../shared/collisions.js';
import { MAPS, mapInfo } from '../shared/maps.js';
import { gridSpawn } from '../shared/multiplayer.js';
import { RaceManager } from '../server/RaceManager.js';
import { CheckpointSystem } from '../src/CheckpointSystem.js';
import { measureGapLandings } from '../scripts/gap-landings.mjs';

const track = createTrack('gaptrack');
const targetPoint = (t, u, metres = 0, lane = 0) => {
  const at = t.at(((u + metres / t.length) % 1 + 1) % 1);
  at.position.x += Math.cos(at.yaw) * lane;
  at.position.z -= Math.sin(at.yaw) * lane;
  return at;
};

test('All three gaps catch full-throttle flights on the descent across three lanes', async () => {
  const results=await measureGapLandings();
  assert.equal(results.length,36);
  for(const result of results) {
    const label=JSON.stringify(result);
    assert.ok(!result.missed&&result.onRoad,label);
    assert.ok(result.afterLanding>=0&&result.afterLanding<60,label);
    assert.ok(result.slope<-6,label);
    assert.ok(result.impact<14,label);
    if(result.speed>=32) {
      assert.ok(result.distance>60&&result.height>4,label);
      assert.ok(result.flight>2.3,label);
    }
  }
});

test('Long receptions descend continuously and meet level ground smoothly', () => {
  for(const gap of track.gaps) {
    for(let m=1;m<gap.receptionLength;m+=.5) {
      const before=track.at(gap.landingU+(m-.5)/track.length).position.y;
      const after=track.at(gap.landingU+m/track.length).position.y;
      assert.ok(after<=before+1e-6,'no secondary launch on the descent');
    }
    const end=track.at(gap.landingU+gap.receptionLength/track.length);
    assert.ok(Math.abs(end.position.y-1)<.001);
    assert.ok(Math.abs(end.pitch)<.001,'smooth exit onto level ground');
  }
});


test('Both road edges and shoulders advance through every turn without folding back', () => {
  const edge=(i,side)=>{
    const p=track.samples[i%track.count];
    const before=track.samples[(i+track.count-1)%track.count],after=track.samples[(i+1)%track.count];
    const dx=after.x-before.x,dz=after.z-before.z,length=Math.hypot(dx,dz);
    const offset=side*(track.widthAt(i/track.count)/2+2);
    return {x:p.x+dz/length*offset,z:p.z-dx/length*offset};
  };
  for(let i=0;i<track.count;i++) {
    if(track.isGap(i/track.count)||track.isGap((i+1)/track.count))continue;
    const a=track.samples[i],b=track.samples[i+1];
    for(const side of [-1,1]) {
      const from=edge(i,side),to=edge(i+1,side);
      assert.ok((to.x-from.x)*(b.x-a.x)+(to.z-from.z)*(b.z-a.z)>0,`Folded shoulder at u=${i/track.count}, side=${side}`);
    }
  }
});

test('Small rollers have gentle slopes and stay on straights outside jumps and starting grid', () => {
  assert.equal(track.bumps.length, 17);
  for(const bump of track.bumps) {
    const yCenter = track.at(bump.centerU).position.y;
    assert.ok(Math.abs(yCenter - 1.45) < .05 || Math.abs(yCenter - 1.55) < .05 || Math.abs(yCenter - 6.55) < .05, `peak elevation at ${yCenter}`);
    for(let m = -bump.length / 2; m <= bump.length / 2; m += .5) {
      const u = bump.centerU + m / track.length, at = track.at(u);
      assert.ok(Math.abs(at.pitch) < .19, 'gentle slope');
      assert.ok(track.curvature(u) < .012, 'straight segment');
      assert.ok(Math.min(u, 1 - u) * track.length > 14, 'clear starting grid');
      for(const gap of track.gaps) {
        assert.ok(u < gap.takeoffU - 48 / track.length || u > gap.landingU + (gap.receptionLength+8) / track.length, 'outside ramps and receptions');
        assert.ok(Math.abs(u - gap.underpassU) * track.length > 20, 'outside crossing');
      }
    }
  }
});

test('The repaired upper-right bend supports bikes across its full width', async () => {
  await RAPIER.init();
  const local=new GapTrack(),world=new RAPIER.World({x:0,y:-9.81,z:0});
  local.createRibbon(local.width,.035,{color:0xd3ac76},world,RAPIER);
  try {
    for(let u=.49;u<.54;u+=.001)for(const lane of [-10,-5,0,5,10]) {
      const at=targetPoint(local,u,0,lane);
      const ray=new RAPIER.Ray({x:at.position.x,y:20,z:at.position.z},{x:0,y:-1,z:0});
      let height=null;
      world.forEachCollider(c=>{const hit=c.castRayAndGetNormal(ray,25,true);if(hit){height=20-hit.timeOfImpact;assert.ok(hit.normal.y>.98,'no vertical or inverted collision surface');}});
      assert.ok(height!==null&&Math.abs(height-at.position.y-.035)<.02,'continuous road under every lane');
    }
  } finally {world.free();}
});

test('Recovery positions stay on solid road outside the jump approaches and voids', () => {
  const recovery=new CheckpointSystem(track);
  assert.equal(recovery.gates.length,recovery.count);
  for(const gate of recovery.gates)for(const gap of track.gaps) {
    assert.ok(gate.u<=gap.takeoffU-12/track.length||gate.u>=gap.landingU+(gap.receptionLength+5)/track.length);
  }
});

test('Server completes the new route for six riders, including checkpoints and last-place boost', () => {
  const players=Array.from({length:6},(_,i)=>({id:String(i),name:`Rider ${i}`,color:'#fff'}));
  const race=new RaceManager(track,players,1,1000,{countdownMs:0});
  players.forEach(p=>race.loaded(p.id,1000));
  let boosts=0;
  for(let step=0;step<2050&&!race.finished;step++) {
    const now=1000+step*50;
    for(let i=0;i<6;i++) {
      if(race.records.get(String(i)).finishTime!==null)continue;
      const at=targetPoint(track,step*.0005-(2+Math.floor(i/2)*3.4)/track.length,0,i%2?1.4:-1.4);
      at.position.y+=.9;
      assert.equal(race.accept(String(i),{seq:step,position:at.position.toArray(),velocity:[at.tangent.x*15,0,at.tangent.z*15],rotation:[0,Math.sin(at.yaw/2),0,Math.cos(at.yaw/2)],speed:15,grounded:!track.isGap(at.u)},now),true);
    }
    race.tick(now);
    for(const p of players)if(race.requestBoost(p.id,now))boosts++;
  }
  assert.ok(race.finished,'all six finish a complete ordered lap');
  assert.ok(race.standings().every(r=>r.completedLaps===1&&!r.dnf));
  assert.ok(boosts>0,'the last rider can activate the existing boost');
});

test('Reference layout: start lies below crossing 1 and both grids fit its straight', () => {
  const start=track.at(0),crossing=track.gaps[0].underpassPos;
  assert.ok(Math.abs(start.position.x-crossing.x)<.1);
  assert.ok(Math.abs(start.position.z-crossing.z-130*.32)<.5);
  assert.ok(start.tangent.z<-.99);
  const grids=[[-4.5,-3,-1.5,0,1.5,3,4.5].map(lane=>targetPoint(track,0,-3,lane)),Array.from({length:6},(_,i)=>gridSpawn(track,i))];
  for(const grid of grids)for(let i=0;i<grid.length;i++) {
    const at=grid[i];
    assert.ok(at.position.z>start.position.z);
    assert.ok(track.nearest(at.position.x,at.position.z,at.position.y).distance<track.width/2);
    for(let j=0;j<i;j++)assert.ok(at.position.distanceTo(grid[j].position)>1.4);
  }
});

test('Map registration: MAPS contains Map 03 Gap Circuit with correct metadata', () => {
  assert.equal(MAPS.length, 6);
  const info = mapInfo('gaptrack');
  assert.equal(info.id, 'gaptrack');
  assert.equal(info.number, '03');
  assert.equal(info.circuitId, 'gap-circuit-v5');
  assert.equal(track.title, 'Gap Circuit');
  assert.equal(track.width, 24);
  assert.ok(track.length > 1350 && track.length < 1550, `Length ${track.length} within 1350-1550m`);
});

test('3 True Gap Jumps: physical voids exist with no road colliders in the air', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const scene = new THREE.Scene();
  track.build(scene, world, RAPIER);

  assert.equal(track.gaps.length, 3);

  for (const g of track.gaps) {
    const midU = (g.takeoffU + g.landingU) / 2;
    assert.equal(track.isGap(midU), true, `${g.name} middle isGap`);
    assert.equal(track.isGap(g.takeoffU - 0.005), false, `${g.name} before takeoff is not gap`);
    assert.equal(track.isGap(g.landingU + 0.005), false, `${g.name} after landing is not gap`);

    // Void distance must be at least 22m and at most 30m
    const voidDistance = (g.landingU - g.takeoffU) * track.length;
    assert.ok(voidDistance >= 22 && voidDistance <= 30, `${g.name} void length = ${voidDistance.toFixed(1)}m`);

    // Vertical clearance over underpass must be > 5.0m
    const clearance = g.takeoffLip.y - g.underpassPos.y;
    assert.ok(clearance >= 5.0, `${g.name} clearance = ${clearance.toFixed(1)}m`);

    // Raycast from above the gap through the void:
    // It must NOT hit any road collider between 8m and 20m altitude
    const midX = (g.takeoffLip.x + g.landingStart.x) / 2;
    const midZ = (g.takeoffLip.y > 0 ? (g.takeoffLip.z + g.landingStart.z) / 2 : g.takeoffLip.z);
    const ray = new RAPIER.Ray({ x: midX, y: 25, z: midZ }, { x: 0, y: -1, z: 0 });

    world.forEachCollider(c => {
      const hit = c.castRay(ray, 50, true);
      if (hit >= 0) {
        const hitY = 25 - hit;
        // Hit must be ground level (< 5m), never a bridge in the air (between 6m and 22m)
        assert.ok(hitY < 5.0 || hitY > 23.0, `${g.name} must have no collider in air: hit at y=${hitY.toFixed(2)}m`);
      }
    });
  }

  world.free();
});

test('Takeoff lips have positive jump angle and landings have absorbing entry slope', () => {
  for (const g of track.gaps) {
    const takeoffIdx = Math.floor(g.takeoffU * track.count);
    const pPrev = track.samples[takeoffIdx - 2];
    const pLip = track.samples[takeoffIdx];
    const tanT = pLip.clone().sub(pPrev).normalize();
    const pitchTakeoffDeg = Math.asin(tanT.y) * 180 / Math.PI;
    assert.ok(pitchTakeoffDeg >= 15.0 && pitchTakeoffDeg <= 22.0, `${g.name} takeoff pitch = ${pitchTakeoffDeg.toFixed(1)}°`);

    const landingIdx = Math.ceil(g.landingU * track.count);
    const pLand = track.samples[landingIdx];
    const pNext = track.samples[landingIdx + 2];
    const tanL = pNext.clone().sub(pLand).normalize();
    const pitchLandingDeg = Math.asin(tanL.y) * 180 / Math.PI;
    assert.ok(pitchLandingDeg <= -6.0 && pitchLandingDeg >= -8.0, `${g.name} landing pitch = ${pitchLandingDeg.toFixed(1)}°`);
  }
});

function crossGate(timing, index, skip = false) {
  const at = timing.gates[index];
  const before = at.position.clone().addScaledVector(at.tangent, -1);
  const after = at.position.clone().addScaledVector(at.tangent, 1);
  if (skip) {
    before.x += 25;
    after.x += 25;
  }
  timing.previous = before;
  timing.routeU = at.u - 0.001;
  return timing.update(after, { u: at.u, distance: skip ? 25 : 0 });
}

test('Checkpoints enforce sequential order; clean lap validates; skips prevent lap validation', () => {
  const timing = new LapCheckpointSystem(track);
  assert.equal(timing.gates.length, 10, 'Gap Circuit must have exactly 10 checkpoints');

  // Complete lap in exact order
  for (let i = 1; i < timing.gates.length; i++) {
    const ev = crossGate(timing, i);
    assert.equal(ev?.checkpoint, true, `Gate ${i} must validate`);
    assert.equal(ev?.index, i);
  }
  const finish = crossGate(timing, 0);
  assert.equal(finish?.lap, true, 'Clean lap validates finish');

  // Skipping a gate prevents lap completion
  const timingSkipped = new LapCheckpointSystem(track);
  for (let i = 1; i < timingSkipped.gates.length; i++) {
    crossGate(timingSkipped, i, i === 5); // skip gate 5
  }
  const finishSkipped = crossGate(timingSkipped, 0);
  assert.notEqual(finishSkipped?.lap, true, 'Skipping a gate must refuse lap completion');
  assert.equal(finishSkipped?.missingCheckpoint, true);
});

test('Anti-cut: falling or cutting from a jump onto the lower road invalidates the lap', () => {
  const timing = new LapCheckpointSystem(track);
  const gap=track.gaps[0];
  const takeoffGate=timing.gates.findLastIndex(g=>g.u<gap.takeoffU);
  for(let i=1;i<=takeoffGate;i++)crossGate(timing,i);
  const atTakeoff = track.at(gap.takeoffU);
  timing.update(atTakeoff.position, { u: gap.takeoffU, distance: 0 });
  const atLower=track.at(gap.underpassU);
  timing.update(atLower.position,{u:gap.underpassU,distance:0});
  assert.equal(timing.routeLost,true,'Route lost on the lower road');

  // Attempt to cross finish line
  const finish = crossGate(timing, 0);
  assert.equal(finish?.missingCheckpoint, true);
  assert.equal(finish?.lap, undefined);
});

test('Checkpoint furniture is visible in Scenery: 10 banners created', async () => {
  globalThis.document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({
        fillStyle: '', fillRect(){}, font: '', textAlign: '', textBaseline: '', fillText(){}
      })
    })
  };
  const { Scenery } = await import('../src/Scenery.js');
  const scene = new THREE.Scene();
  const scenery = new Scenery(scene, track);
  assert.equal(scenery.checkpointBanners.length, 10);
  assert.equal(scenery.checkpointBanners[0].name, 'checkpoint-banner-10');
  for (let i = 1; i <= 9; i++) {
    assert.equal(scenery.checkpointBanners[i].name, `checkpoint-banner-${String(i).padStart(2, '0')}`);
  }
});

test('Vertical collision isolation: jumping bike and underpass bike produce zero ghost collision', () => {
  // Bike A: in the air jumping over Gap 1 at y = 16.0
  const bikeA = {
    x: -26.0,
    y: 16.0,
    z: -42.0,
    forward: { x: 1, z: 0 },
    vx: 20.0,
    vz: 0
  };
  // Bike B: driving below on the lower track under Gap 1 at y = 1.0
  const bikeB = {
    x: -26.0,
    y: 1.0,
    z: -42.0,
    forward: { x: 0, z: 1 },
    vx: 0,
    vz: 18.0
  };

  const contact = capsuleContact(bikeA, bikeB);
  assert.equal(contact, null, 'Vertical separation of 15m must yield null collision contact');
});

test('Timing checkpoints: clean distribution along entire track, away from jumps, bumps and underpasses', () => {
  assert.equal(track.timingUs.length, 10, 'Gap Circuit must have 10 timing checkpoints');
  assert.equal(track.timingUs[0], 0, 'Gate 0 must be at finish line (0)');

  for (let i = 1; i < track.timingUs.length; i++) {
    assert.ok(track.timingUs[i] > track.timingUs[i - 1], `Gate ${i} must follow Gate ${i - 1}`);
  }

  for (let i = 0; i < track.timingUs.length; i++) {
    const u = track.timingUs[i];
    const m = u * track.length;

    // Must not be in flight, takeoff lip or landing reception ramp of any gap jump
    for (const g of track.gaps) {
      const takeoffM = g.takeoffU * track.length;
      const landingM = g.landingU * track.length;
      const receptionEndM = landingM + g.receptionLength;
      const underpassM = g.underpassU * track.length;

      assert.ok(
        m < takeoffM - 10 || m > receptionEndM + 25,
        `Gate ${i} (${m.toFixed(1)}m) must not be in Gap ${g.id} jump/landing zone (${takeoffM.toFixed(1)}m - ${(receptionEndM + 25).toFixed(1)}m)`
      );

      if (i !== 0) {
        assert.ok(
          Math.abs(m - underpassM) > 20,
          `Gate ${i} (${m.toFixed(1)}m) must not be within 20m of Underpass ${g.id} (${underpassM.toFixed(1)}m)`
        );
      }
    }

    // Must not be placed directly on top of bumps or whoops
    for (const b of track.bumps) {
      const bumpM = b.centerU * track.length;
      assert.ok(
        Math.abs(m - bumpM) > b.length / 2 + 2,
        `Gate ${i} (${m.toFixed(1)}m) must not be on bump at ${bumpM.toFixed(1)}m`
      );
    }
  }

  for (let i = 1; i < track.timingUs.length; i++) {
    const dist = (track.timingUs[i] - track.timingUs[i - 1]) * track.length;
    assert.ok(dist >= 80 && dist <= 250, `Gate ${i-1} -> Gate ${i} distance ${dist.toFixed(1)}m is well proportioned`);
  }
});

