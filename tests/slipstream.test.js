import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SlipstreamSystem, SLIPSTREAM_CONFIG } from '../src/network/SlipstreamSystem.js';

test('SlipstreamSystem activates instantly within 1.8m - 10.0m behind leader and disappears immediately upon exit', () => {
  const mockScene = { add() {} };
  const mockGame = { scene: mockScene };
  const system = new SlipstreamSystem(mockGame);

  const localBike = {
    position: new THREE.Vector3(0, 1, 0),
    yaw: 0 // Heading +Z
  };

  // Remote 1: 3.5m ahead, heading same direction (+Z) -> within 1.8m - 10.0m
  const remoteAhead = {
    disconnected: false,
    bike: { group: { visible: true } },
    player: { name: 'Leader' },
    pose: {
      position: new THREE.Vector3(0, 1, 3.5),
      yaw: 0,
      grounded: true,
      throttle: 1
    }
  };

  const remotes = new Map([['leader', remoteAhead]]);

  // Step 1: inside cone -> inDraft is true instantly on the very first frame (0 delay)
  const result1 = system.update(0.016, localBike, remotes);
  assert.equal(result1.inDraft, true, 'Must enter draft immediately');
  assert.equal(result1.charge, 1.0, 'No charge-up time: 100% immediate effect');
  assert.equal(result1.targetName, 'Leader');
  assert.equal(result1.speedMultiplier, 1.30, 'Full +30% top speed bonus immediately');
  assert.equal(result1.accelMultiplier, 1.40, 'Full +40% acceleration bonus immediately');
  assert.equal(result1.force, 840, 'Immediate 840N thrust');

  // Step 2: Test distance > 10.0m (exited draft) -> bonus disappears immediately
  remoteAhead.pose.position.set(0, 1, 11.5);
  const resultFar = system.update(0.016, localBike, remotes);
  assert.equal(resultFar.inDraft, false, 'Draft ends immediately');
  assert.equal(resultFar.slingshotActive, false, 'No lingering slingshot');
  assert.equal(resultFar.speedMultiplier, 1.0, 'Bonus dropped immediately to 1.0');
  assert.equal(resultFar.force, 0, 'Thrust dropped immediately to 0');

  // Step 3: Test distance < 1.8m (too close)
  system.reset();
  remoteAhead.pose.position.set(0, 1, 1.2);
  const resultTooClose = system.update(0.016, localBike, remotes);
  assert.equal(resultTooClose.inDraft, false);
  assert.equal(resultTooClose.force, 0);

  // Step 4: Test lateral offset > 14 degrees (pulled out to overtake)
  system.reset();
  remoteAhead.pose.position.set(2.0, 1, 3.5);
  const resultSide = system.update(0.016, localBike, remotes);
  assert.equal(resultSide.inDraft, false, 'Pulling out to overtake immediately cuts draft');
  assert.equal(resultSide.force, 0);
});

