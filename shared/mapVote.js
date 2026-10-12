import { MAPS } from './maps.js';

export const MULTIPLAYER_POST_RACE_CONFIG = Object.freeze({
  resultsDurationSeconds: 20,
  mapVote: Object.freeze({
    enabled: true,
    durationSeconds: 10,
    numberOfChoices: 2,
    excludeLastPlayedTrack: true
  }),
  mapAnnouncementDurationSeconds: 5,
  returnToLobbyAfterVote: true,
  resetReadyStatusOnLobbyReturn: true,
  autoStartNextRace: false,
  hostMustStartNextRace: true
});

export const MAP_VOTE_CONFIG = MULTIPLAYER_POST_RACE_CONFIG;

/**
 * Returns eligible maps excluding the one that was just played.
 * If candidateTrack.id !== previousTrackId.
 * Fallback to allMaps if filtered list is empty.
 */
export function getEligibleMaps(allMaps = MAPS, lastPlayedTrackId = null) {
  if (!lastPlayedTrackId) return [...allMaps];
  const eligible = allMaps.filter(track => track.id !== lastPlayedTrackId);
  return eligible.length > 0 ? eligible : [...allMaps];
}

/**
 * Randomly picks up to `count` distinct maps from eligibleMaps.
 * Guarantees no duplicates.
 * If fewer maps than `count` exist, returns all available eligible maps.
 */
export function selectRandomVoteChoices(eligibleMaps, count = 2, randomFn = Math.random) {
  if (!Array.isArray(eligibleMaps) || eligibleMaps.length === 0) return [];
  const pool = [...eligibleMaps];
  if (pool.length <= count) return pool;

  // Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/**
 * Tallies votes for each choice and returns a mapping of trackId => count.
 */
export function tallyVotes(choices, votesByPlayer) {
  const counts = {};
  for (const choice of choices) {
    counts[choice.id] = 0;
  }
  if (votesByPlayer) {
    const entries = votesByPlayer instanceof Map ? votesByPlayer.entries() : Object.entries(votesByPlayer);
    for (const [, trackId] of entries) {
      if (counts[trackId] !== undefined) {
        counts[trackId]++;
      }
    }
  }
  return counts;
}

/**
 * Determines the winning map based on player votes.
 * In case of a tie or if no votes were cast, randomly selects between the tied candidates.
 */
export function determineVoteWinner(choices, votesByPlayer, randomFn = Math.random) {
  if (!choices || choices.length === 0) {
    return { winner: null, counts: {}, isTie: false, totalVotes: 0 };
  }
  if (choices.length === 1) {
    const counts = tallyVotes(choices, votesByPlayer);
    return {
      winner: choices[0],
      counts,
      isTie: false,
      totalVotes: counts[choices[0].id] ?? 0
    };
  }

  const counts = tallyVotes(choices, votesByPlayer);
  let maxVotes = -1;
  let topChoices = [];

  for (const choice of choices) {
    const count = counts[choice.id] ?? 0;
    if (count > maxVotes) {
      maxVotes = count;
      topChoices = [choice];
    } else if (count === maxVotes) {
      topChoices.push(choice);
    }
  }

  const isTie = topChoices.length > 1;
  const pickedIndex = isTie ? Math.floor(randomFn() * topChoices.length) : 0;
  const winner = topChoices[pickedIndex] ?? choices[0];
  const totalVotes = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return {
    winner,
    counts,
    isTie,
    totalVotes
  };
}
