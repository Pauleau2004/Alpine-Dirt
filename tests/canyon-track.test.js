import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { createTrack } from '../src/tracks/createTrack.js';
import { CanyonTrack } from '../src/tracks/CanyonTrack.js';
import { LapCheckpointSystem } from '../src/LapCheckpointSystem.js';
import { MAPS, mapInfo } from '../shared/maps.js';
import { RaceManager } from '../server/RaceManager.js';
import { CameraController } from '../src/CameraController.js';

const track = createTrack('canyon');

test('The complete terrain leaves every racing lane on the intended smooth road surface', async () => {
  await RAPIER.init();
  const local = new CanyonTrack(), world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  local.build(new THREE.Scene(), world, RAPIER);
  try {
    for (let i = 0; i < local.count; i += 12) for (const fraction of [-.96, -.5, 0, .5, .96]) {
      const u = i / local.count; if(local.isGap(u))continue;
      const lane=fraction*local.widthAt(u)/2;
      const at = local.at(u), x = at.position.x + Math.cos(at.yaw) * lane, z = at.position.z - Math.sin(at.yaw) * lane;
      const expected = local.surfaceHeightAt(u, lane) + 0.035;
      const origin = expected + 3;
      const ray = new RAPIER.Ray({ x, y: origin, z }, { x: 0, y: -1, z: 0 });
      let highest = -Infinity;
      world.forEachCollider(c => { const hit = c.castRay(ray, 150, true); if (hit >= 0) highest = Math.max(highest, origin - hit); });
      assert.ok(Math.abs(highest - expected) < 0.16, `Terrain or shoulder intrudes on the racing lane at ${u}, ${lane}: ${highest - expected}`);
    }
    for(const name of ['canyon-banked-road','canyon-shoulders']) {
      const road = local.group.getObjectByName(name).geometry;
      const p = road.attributes.position, index = road.index;
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
        const up = (p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a)) - (p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a));
        assert.ok(up > 0, 'no folded or inverted road triangles');
      }
    }
  } finally { world.free(); }
});

test('Map registration: MAPS contains Map 04 Canyon Rouge MX with correct metadata', () => {
  assert.equal(MAPS.length, 6);
  const info = mapInfo('canyon');
  assert.equal(info.id, 'canyon');
  assert.equal(info.number, '04');
  assert.equal(info.circuitId, 'canyon-rouge-mx-v5');
  assert.equal(track.title, 'Canyon Rouge MX');
  assert.ok(track.length >= 1300 && track.length <= 1380, `Track length ${track.length.toFixed(1)}m must be around 1.34km`);
});

test('Level zero grid and moderate elevation retain the Canyon relief', () => {
  const heights=track.samples.map(p=>p.y),range=Math.max(...heights)-Math.min(...heights);
  assert.ok(range>8&&range<12,'rolling terrain without the old 25m cliffs');
  for(let m=-15;m<=15;m++) {
    const at=track.at(m/track.length);
    assert.ok(Math.abs(at.position.y)<1e-6&&Math.abs(at.pitch)<1e-6,'level grid at zero');
  }
});

test('Separate racing lanes stay clear except for the elevated crossover', () => {
  const count = track.count;
  let minGap = Infinity;
  for (let i = 0; i < count; i += 4) {
    for (let j = i + 1; j < count; j += 4) {
      const arcDist = Math.min(j - i, count - j + i) * (track.length / count);
      if (arcDist < 50) continue;
      const a = track.samples[i], b = track.samples[j];
      const distXZ = Math.hypot(a.x - b.x, a.z - b.z);
      const nearCrossing=u=>Math.abs(u-track.landmarks.bridge)*track.length<28;
      const nearLower=u=>Math.abs(u-track.landmarks.underpass)*track.length<28;
      if((nearCrossing(i/count)&&nearLower(j/count))||(nearLower(i/count)&&nearCrossing(j/count)))continue;
      if (distXZ < minGap) minGap = distXZ;
    }
  }
  assert.ok(minGap >= 17.0, `Minimum gap between non-adjacent lanes ${minGap.toFixed(1)}m must be >= 17m`);
});

test('Berms rise progressively on the OUTSIDE of actual left and right turns', () => {
  const sides = new Set();
  for (const u of [track.landmarks.leftBerm, track.landmarks.rightBerm]) {
    const bank = track.bankAt(u), sign = bank.turnSign; sides.add(sign);
    assert.ok(sign * track.signedCurvature(u) < 0, 'bank supports the real turn');
    assert.ok(track.crossHeight(u, sign * 6.5) > 1.5, 'raised outer lip');
    assert.ok(track.crossHeight(u, -sign * 4) <= 0, 'excavated inner line');
    const innerSlope = track.crossHeight(u, sign) - track.crossHeight(u, 0);
    const outerSlope = track.crossHeight(u, sign * 6.5) - track.crossHeight(u, sign * 5.5);
    assert.ok(outerSlope > innerSlope * 1.3, 'cupped berm, not just a tilted plane');
    assert.ok(Math.abs(Math.atan(outerSlope) * 180 / Math.PI - 18) < 0.1, 'actual outside support has an 18 degree slope');
  }
  assert.equal(sides.size, 2);
});

test('Elevation is continuously varied with broad peaks, valleys and smooth joins', () => {
  let flat = 0, maxSlope = 0;
  for (let i = 0; i < track.count; i++) {
    const pitch = track.at(i / track.count).pitch;
    flat += Math.abs(pitch) < 0.025; if(!track.isGap(i/track.count))maxSlope = Math.max(maxSlope, Math.abs(pitch));
  }
  assert.ok(flat / track.count < 0.4, 'still rolling rather than entirely flat');
  assert.ok(maxSlope < .25, 'rideable transitions below 14 degrees');
  assert.ok(track.samples[0].distanceTo(track.samples[track.count]) < 0.001);
  assert.ok(Math.abs(track.widthAt(1 - 1e-6) - track.widthAt(0)) < 0.001, 'no grid width seam');
});

test('Physical Rapier Trimesh: wheel raycast detects true banked surface normal and centripetal tilt', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const local = new CanyonTrack();
  local.createRibbon(local.width, 0.035, { color: 0xb55a30 }, world, RAPIER);

  const apexU = local.landmarks.leftBerm;
  const apexAt = local.at(apexU);
  const forward = apexAt.tangent;
  const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize();

  let detectedTilt = 0;
  let detectedColliderCount = 0;

  world.forEachCollider(collider => {
    detectedColliderCount++;
    for (const lane of [-5.8, -3.5, 0, 3.5, 5.8]) {
      const testPt = apexAt.position.clone().addScaledVector(right, lane);
      testPt.y = apexAt.position.y+10;
      const ray = new RAPIER.Ray({ x: testPt.x, y: testPt.y, z: testPt.z }, { x: 0, y: -1, z: 0 });
      const hit = collider.castRayAndGetNormal(ray, 30.0, true);
      assert.ok(hit, `Raycast must hit road at offset ${lane}m`);
      const normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
      const tiltDeg = Math.acos(Math.max(-1, Math.min(1, normal.y))) * 180 / Math.PI;
      detectedTilt = Math.max(detectedTilt, tiltDeg);
      assert.ok(normal.y > 0.7, 'Upward facing road surface');
      if (lane * local.bankAt(apexU).turnSign > 5) {
        const lateralAngle = Math.atan(Math.abs(normal.dot(right)) / normal.y) * 180 / Math.PI;
        assert.ok(Math.abs(lateralAngle - 18) < 0.6, `Collider support is 18 degrees: ${lateralAngle}`);
      }
    }
  });

  assert.ok(detectedColliderCount > 0, 'Road collider registered in Rapier world');
  assert.ok(detectedTilt >= 16.0, `Peak berm tilt ${detectedTilt.toFixed(1)}° must be >= 16°`);
  world.free();
});

test('Terrain features include four forgiving jumps and gentle rhythm bumps, all inside the lap', () => {
  assert.equal(track.features.filter(f => f.kind === 'jump').length, 4);
  assert.equal(track.features.filter(f => f.kind === 'roller').length, 17);
  for (const f of track.features) {
    assert.ok(f.start > 15 / track.length);
    assert.ok(f.start + f.rise + f.top + f.fall < 1 - 15 / track.length);
    assert.ok(f.height > 0 && f.height <= 1.8);
  }
});

test('Real jump has no road, shoulder, deck or terrain collider across the void', async () => {
  await RAPIER.init();
  const local=new CanyonTrack(),world=new RAPIER.World({x:0,y:-9.81,z:0});
  local.build(new THREE.Scene(),world,RAPIER);
  try {
    const gap=local.gaps[0],span=(gap.landingU-gap.takeoffU)*local.length;
    assert.ok(span>=9.5&&span<=10.5);
    assert.equal(local.group.getObjectByName('canyon-crossing-deck'),undefined);
    assert.ok(gap.takeoffLip.y-gap.landingStart.y>2,'lower landing tolerates a slower approach');
    assert.ok(local.widthAt(gap.landingU)>=16,'wide reception');
    for(let d=1;d<span-1;d+=1)for(const side of [-9,-5,0,5,9]) {
      const u=gap.takeoffU+d/local.length,at=local.at(u);
      const x=at.position.x+Math.cos(at.yaw)*side,z=at.position.z-Math.sin(at.yaw)*side;
      const ray=new RAPIER.Ray({x,y:at.position.y+3,z},{x:0,y:-1,z:0});
      let highest=-Infinity;
      world.forEachCollider(c=>{const hit=c.castRay(ray,30,true);if(hit>=0)highest=Math.max(highest,at.position.y+3-hit);});
      assert.ok(highest<gap.landingStart.y-2,`clear air corridor at ${d}, ${side}`);
    }
    for(const u of local.respawnUs)assert.ok(!(u>gap.takeoffU-28/local.length&&u<gap.landingU+24/local.length),'no respawn in the gap or on its kicker');
    for(const u of local.timingUs)assert.ok(!local.isGap(u),'all timing gates on solid ground');
  } finally {world.free();}
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

test('Checkpoints: 24 ordered gates, complete lap validates, skip refuses finish', () => {
  const timing = new LapCheckpointSystem(track);
  assert.equal(timing.gates.length, 24);

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
    crossGate(timingSkipped, i, i === 4);
  }
  const finishSkipped = crossGate(timingSkipped, 0);
  assert.notEqual(finishSkipped?.lap, true, 'Skipping a gate must refuse lap completion');
  assert.equal(finishSkipped?.missingCheckpoint, true);
});

test('Scenery: 24 checkpoint banners match the 24 timing gates around Canyon Rouge MX', async () => {
  globalThis.document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({
        fillStyle: '', fillRect() { }, font: '', textAlign: '', textBaseline: '', fillText() { }
      })
    })
  };
  const { Scenery } = await import('../src/Scenery.js');
  const scene = new THREE.Scene();
  const scenery = new Scenery(scene, track);
  assert.equal(scenery.checkpointBanners.length, 24);
  assert.equal(scenery.checkpointBanners[0].name, 'checkpoint-banner-24');
  for (let i = 1; i <= 23; i++) {
    assert.equal(scenery.checkpointBanners[i].name, `checkpoint-banner-${String(i).padStart(2, '0')}`);
  }
});

test('Finish is on the left straight and the plan follows both reference hairpins', () => {
  const start = track.at(0);
  assert.ok(start.position.x < -110 && start.position.z < -25);
  assert.ok(start.tangent.z < -0.98 && track.curvature(0) < 0.006);
  assert.ok(track.at(track.landmarks.leftBerm).position.x < -100);
  assert.ok(track.at(track.landmarks.rightBerm).position.x > 50);
});

test('Crossing levels have clearance and altitude-aware route detection', () => {
  const upper = track.at(track.landmarks.bridge), lower = track.at(track.landmarks.underpass);
  assert.ok(Math.hypot(upper.position.x - lower.position.x, upper.position.z - lower.position.z) < 1);
  assert.ok(upper.position.y - lower.position.y > 6);
  for (const at of [upper, lower]) for (const height of [0.5, 1.5, 2.5]) {
    const near = track.nearest(at.position.x, at.position.z, at.position.y + height);
    assert.ok(Math.abs(near.u - at.u) * track.length < 1, 'correct branch even when jumping');
  }
  for (let m = -20; m <= 20; m += 2) for (const side of [-4, 0, 4]) {
    const u = lower.u + m / track.length, p = track.at(u);
    const x = p.position.x + Math.cos(p.yaw) * side, z = p.position.z - Math.sin(p.yaw) * side;
    assert.ok(track.terrainHeight(x, z) < track.surfaceHeightAt(u, side) - 0.5, 'lower lane is excavated');
  }
});

test('Wide camera stays with the lower lane instead of snapping to the jump above it', () => {
  for(let m=-15;m<=20;m++)for(const lane of [-4,0,4]) {
    const at=track.at(track.landmarks.underpass+m/track.length),position=at.position.clone();
    position.x+=Math.cos(at.yaw)*lane;position.z-=Math.sin(at.yaw)*lane;position.y+=.96;
    const camera=new THREE.PerspectiveCamera(),controller=new CameraController(camera,track);
    controller.update(1/60,{group:{position}},{speed:12,yaw:at.yaw,steer:0},'wide');
    assert.ok(camera.position.y-position.y<5.1,'no camera jump onto the upper route');
  }
});

test('Server validates a complete Canyon lap through both levels of the crossing', () => {
  const race = new RaceManager(track, [{ id: 'rider', name: 'Rider', color: '#ffffff' }], 1, 0, { countdownMs: 0 });
  race.loaded('rider', 0);
  let seq = 0;
  for (let m = -2; m <= track.length + 2; m += 1) {
    const p = track.at(m / track.length).position;
    const now = ++seq * 100;
    assert.equal(race.accept('rider', { seq, position: [p.x, p.y + 0.96, p.z] }, now), true);
    if (race.records.get('rider').finishTime !== null) break;
  }
  const result = race.records.get('rider');
  assert.equal(result.completedLaps, 1);
  assert.ok(result.finishTime > 0);
});
