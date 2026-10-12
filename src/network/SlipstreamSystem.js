import * as THREE from 'three';

export const SLIPSTREAM_CONFIG = Object.freeze({
  minDistance: 1.8,
  maxDistance: 10.0, // Up to 10 metres behind leader
  maxAngle: 14 * Math.PI / 180, // +/- 14 degrees cone
  speedBonus: 0.30, // +30% top speed
  accelBonus: 0.40, // +40% acceleration
  force: 840
});

export class SlipstreamSystem {
  constructor(game, config = SLIPSTREAM_CONFIG) {
    this.game = game;
    this.config = config;
    this.inDraft = false;
    this.targetPlayer = null;
  }

  reset() {
    this.inDraft = false;
    this.targetPlayer = null;
  }

  // Update check called each frame/fixed step during multiplayer race
  update(dt, localBike, remotes) {
    const c = this.config;
    let bestTarget = null;
    let bestDist = Infinity;

    const pLocal = localBike.position;
    const fLocal = new THREE.Vector3(Math.sin(localBike.yaw), 0, Math.cos(localBike.yaw)).normalize();

    for (const remote of remotes.values()) {
      if (!remote.bike?.group?.visible || remote.disconnected) continue;
      const pRemote = remote.pose.position;

      // Relative vector from local bike to remote bike
      const dx = pRemote.x - pLocal.x;
      const dy = pRemote.y - pLocal.y;
      const dz = pRemote.z - pLocal.z;
      const dist = Math.hypot(dx, dz);

      // Must be on similar vertical elevation (|dy| < 2.2m)
      if (Math.abs(dy) > 2.2) continue;

      // Distance check: between 1.8m and 5.0m
      if (dist >= c.minDistance && dist <= c.maxDistance) {
        const toRemote = new THREE.Vector3(dx, 0, dz).normalize();
        // Dot product with local forward: must be in front
        const dotLocal = fLocal.dot(toRemote);
        if (dotLocal > Math.cos(c.maxAngle)) {
          // Check remote heading: remote should be travelling in roughly same direction
          const fRemote = new THREE.Vector3(Math.sin(remote.pose.yaw), 0, Math.cos(remote.pose.yaw)).normalize();
          if (fLocal.dot(fRemote) > 0.70) {
            // Local bike is in the draft cone!
            if (dist < bestDist) {
              bestDist = dist;
              bestTarget = remote;
            }
          }
        }
      }
    }

    if (bestTarget) {
      this.inDraft = true;
      this.targetPlayer = bestTarget;
    } else {
      this.inDraft = false;
      this.targetPlayer = null;
    }

    return {
      inDraft: this.inDraft,
      charge: this.inDraft ? 1.0 : 0.0,
      slingshotActive: false,
      speedMultiplier: this.inDraft ? (1 + c.speedBonus) : 1.0,
      accelMultiplier: this.inDraft ? (1 + c.accelBonus) : 1.0,
      force: this.inDraft ? c.force : 0,
      targetName: this.targetPlayer?.player?.name ?? null
    };
  }

  dispose() {}
}
