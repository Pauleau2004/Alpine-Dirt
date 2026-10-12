// Timing, recovery and ranking must identify the same road at stacked crossings.
// Maps without stacked lanes keep their existing projection.
export function checkpointRouteNear(track, position, fallback = null) {
  return track.nearestCheckpoint?.(position)
    ?? fallback
    ?? track.nearest(position.x, position.z, position.y);
}
