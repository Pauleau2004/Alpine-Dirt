import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { io as connect } from 'socket.io-client';
import { MAPS } from '../shared/maps.js';
import {
  MULTIPLAYER_POST_RACE_CONFIG,
  getEligibleMaps,
  selectRandomVoteChoices,
  determineVoteWinner,
  tallyVotes
} from '../shared/mapVote.js';
import { createGameServer } from '../server/server.js';

// ============================================================================
// Unit checks on pure map selection logic
// ============================================================================
test('Algorithme de vote : exclusion stricte du circuit précédent', () => {
  assert.deepEqual(getEligibleMaps(MAPS, 'alpine').map(m => m.id).sort(), ['canyon', 'gaptrack', 'hillside', 'sprint', 'terrerouge']);
  assert.deepEqual(getEligibleMaps(MAPS, 'hillside').map(m => m.id).sort(), ['alpine', 'canyon', 'gaptrack', 'sprint', 'terrerouge']);
  assert.deepEqual(getEligibleMaps(MAPS, 'gaptrack').map(m => m.id).sort(), ['alpine', 'canyon', 'hillside', 'sprint', 'terrerouge']);
  assert.deepEqual(getEligibleMaps(MAPS, 'canyon').map(m => m.id).sort(), ['alpine', 'gaptrack', 'hillside', 'sprint', 'terrerouge']);
  assert.deepEqual(getEligibleMaps(MAPS).map(m => m.id).sort(), ['alpine', 'canyon', 'gaptrack', 'hillside', 'sprint', 'terrerouge']);
});

test('Algorithme de vote : catalogue dynamique excluant la map courante', () => {
  const customMaps = [
    ...MAPS,
    { id: 'map6', title: 'Dunes' },
    { id: 'map7', title: 'Forêt' }
  ];
  const eligible = getEligibleMaps(customMaps, 'hillside');
  assert.equal(eligible.length, customMaps.length-1);
  assert.ok(!eligible.some(m => m.id === 'hillside'));
  const choices = selectRandomVoteChoices(eligible, 2);
  assert.equal(choices.length, 2);
  assert.notEqual(choices[0].id, choices[1].id);
});

// ============================================================================
// TESTS 1 à 10 : Déroulement complet du cycle post-course
// ============================================================================
test('TESTS 1 à 10 : Déroulement complet Résultats (20s) -> Vote (10s) -> Annonce (5s) -> Lobby -> Reset Prêt -> Lancement hôte', async () => {
  let now = 10000;
  const server = await createGameServer({
    port: 0,
    host: '127.0.0.1',
    advertisedHost: '127.0.0.1',
    now: () => now,
    postRaceConfig: {
      resultsDurationSeconds: 20,
      mapVote: { enabled: true, durationSeconds: 10, numberOfChoices: 2, excludeLastPlayedTrack: true },
      mapAnnouncementDurationSeconds: 5,
      returnToLobbyAfterVote: true,
      resetReadyStatusOnLobbyReturn: true,
      autoStartNextRace: false,
      hostMustStartNextRace: true
    }
  });

  const sockets = [];
  const request = (s, event, data = {}) => new Promise((resolve, reject) => s.timeout(2000).emit(event, data, (err, res) => err ? reject(err) : resolve(res)));
  const make = async () => {
    const s = connect(`http://127.0.0.1:${server.port}`, { transports: ['websocket'], auth: { token: randomBytes(24).toString('hex') }, reconnection: false });
    sockets.push(s);
    await new Promise(resolve => s.once('connect', resolve));
    return s;
  };

  try {
    // Connexion de 2 joueurs (Pilote A et Ami)
    const host = await make(), created = await request(host, 'createRoom', { name: 'Pilote A' });
    const guest = await make(), joined = await request(guest, 'joinRoom', { name: 'Ami', code: created.room.code });
    const room = server.manager.rooms.get(created.room.code);

    // Démarrage de la 1ère course sur 'alpine'
    await request(host, 'playerReady', { ready: true });
    await request(guest, 'playerReady', { ready: true });
    await request(host, 'startRace');
    for (const s of sockets) await request(s, 'raceLoaded', { raceId: room.race.id });
    now = room.race.startAt + 1;
    server.manager.tick();
    assert.equal(room.state, 'RACING');
    const firstRaceMap = room.mapId;
    assert.equal(firstRaceMap, 'alpine');

    // Fin de la course (DNF de tous les pilotes)
    for (const r of room.race.records.values()) r.dnf = true;
    server.manager.tick();

    // ------------------------------------------------------------------------
    // TEST 1 : Écran résultats pendant 20 secondes
    // ------------------------------------------------------------------------
    assert.equal(room.state, 'RESULTS', 'TEST 1: Après la fin de course, l’état doit être RESULTS');
    assert.equal(room.resultsEndAt, now + 20000, 'TEST 1: La durée des résultats doit être de 20 secondes');
    assert.equal(room.lastPlayedTrackId, 'alpine');

    // Avance de 15 secondes : toujours dans RESULTS, aucun vote actif
    now += 15000;
    server.manager.tick();
    assert.equal(room.state, 'RESULTS', 'TEST 1: À t=15s, on doit toujours être dans les résultats');
    assert.equal(room.mapVote, null, 'TEST 1: Aucun vote ne doit être ouvert pendant les 20s de résultats');

    // ------------------------------------------------------------------------
    // TEST 2 : Après exactement 20 secondes -> vote de map
    // ------------------------------------------------------------------------
    now = room.resultsEndAt; // t = 20 secondes après la fin
    server.manager.tick();
    assert.equal(room.state, 'MAP_VOTE', 'TEST 2: Après 20 secondes, l’état passe à MAP_VOTE');
    assert.ok(room.mapVote, 'TEST 2: Une session de vote est instanciée');
    assert.equal(room.mapVote.choices.length, 2, 'TEST 2: Exactement 2 choix proposés');
    assert.ok(!room.mapVote.choices.some(c => c.id === firstRaceMap), 'TEST 2: La map jouée (alpine) est exclue');

    // ------------------------------------------------------------------------
    // TEST 3 : Vote pendant 10 secondes, joueurs peuvent changer leur vote
    // ------------------------------------------------------------------------
    assert.equal(room.mapVote.endsAt, now + 10000, 'TEST 3: La durée du vote doit être de 10 secondes');
    const [choiceA, choiceB] = room.mapVote.choices;

    // Pilote A vote pour choiceA
    await request(host, 'voteTrack', { trackId: choiceA.id });
    assert.equal(room.mapVote.votes.get(created.playerId), choiceA.id);

    // Ami vote pour choiceB
    await request(guest, 'voteTrack', { trackId: choiceB.id });
    assert.equal(room.mapVote.votes.get(joined.playerId), choiceB.id);

    let counts = tallyVotes(room.mapVote.choices, room.mapVote.votes);
    assert.equal(counts[choiceA.id], 1);
    assert.equal(counts[choiceB.id], 1);

    // Ami change son vote pour choiceA
    await request(guest, 'voteTrack', { trackId: choiceA.id });
    assert.equal(room.mapVote.votes.get(joined.playerId), choiceA.id);
    counts = tallyVotes(room.mapVote.choices, room.mapVote.votes);
    assert.equal(counts[choiceA.id], 2, 'TEST 3: Ancien vote retiré et nouveau comptabilisé');
    assert.equal(counts[choiceB.id], 0);

    // Avance de 8 secondes dans le vote
    now += 8000;
    server.manager.tick();
    assert.equal(room.state, 'MAP_VOTE', 'TEST 3: À t=8s de vote, le vote reste actif');

    // ------------------------------------------------------------------------
    // TEST 4 : Après 10 secondes -> map gagnante sélectionnée
    // ------------------------------------------------------------------------
    now = room.mapVote.endsAt;
    server.manager.tick();
    assert.equal(room.state, 'MAP_ANNOUNCEMENT', 'TEST 4: Après 10s, état passe à MAP_ANNOUNCEMENT');
    assert.equal(room.nextMapId, choiceA.id, 'TEST 4: La map A ayant 2 votes est élue');
    assert.equal(room.mapVote.winner.id, choiceA.id);

    // ------------------------------------------------------------------------
    // TEST 5 : Annonce pendant 5 secondes
    // ------------------------------------------------------------------------
    assert.equal(room.announcementEndAt, now + 5000, 'TEST 5: L’annonce dure exactement 5 secondes');
    now += 3000;
    server.manager.tick();
    assert.equal(room.state, 'MAP_ANNOUNCEMENT', 'TEST 5: À t=3s d’annonce, toujours en MAP_ANNOUNCEMENT');

    // ------------------------------------------------------------------------
    // TEST 6 : Après les 5 secondes -> retour automatique au lobby
    // ------------------------------------------------------------------------
    now = room.announcementEndAt;
    server.manager.tick();
    assert.equal(room.state, 'LOBBY', 'TEST 6: Après 5s d’annonce, retour automatique en LOBBY');
    assert.equal(room.race, null);
    assert.equal(room.mapVote, null);

    // ------------------------------------------------------------------------
    // TEST 7 : Tous les joueurs sont PAS PRÊT
    // ------------------------------------------------------------------------
    const playersList = [...room.players.values()];
    assert.equal(playersList.length, 2);
    for (const p of playersList) {
      assert.equal(p.ready, false, `TEST 7: Joueur ${p.name} doit être PAS PRÊT`);
    }

    // ------------------------------------------------------------------------
    // TEST 8 : La map gagnante est affichée comme PROCHAINE MAP (room.mapId)
    // ------------------------------------------------------------------------
    assert.equal(room.mapId, choiceA.id, 'TEST 8: room.mapId est pré-sélectionné avec la map élue');

    // ------------------------------------------------------------------------
    // TEST 10 : Ne pas lancer automatiquement la course même si tous les joueurs sont prêts
    // ------------------------------------------------------------------------
    await request(host, 'playerReady', { ready: true });
    await request(guest, 'playerReady', { ready: true });
    assert.equal(room.players.get(created.playerId).ready, true);
    assert.equal(room.players.get(joined.playerId).ready, true);

    // Simulation de plusieurs ticks d'attente
    now += 5000;
    server.manager.tick();
    now += 5000;
    server.manager.tick();
    assert.equal(room.state, 'LOBBY', 'TEST 10: La course ne démarre JAMAIS automatiquement même avec tous les joueurs prêts');

    // ------------------------------------------------------------------------
    // TEST 9 : L'hôte clique sur LANCER LA COURSE -> la course démarre sur la map gagnante
    // ------------------------------------------------------------------------
    await request(host, 'startRace');
    assert.equal(room.state, 'COUNTDOWN', 'TEST 9: Démarrage uniquement sur clic de l’hôte');
    assert.equal(room.race.track.id, choiceA.id, 'TEST 9: La course se déroule bien sur la map élue');
  } finally {
    sockets.forEach(s => s.disconnect());
    await server.close();
  }
});

// ============================================================================
// TEST 11 : Multiples courses successives -> la map précédente jamais proposée
// ============================================================================
test('TEST 11: 4 courses successives -> la map venant d’être jouée n’apparaît JAMAIS dans le vote suivant', async () => {
  let now = 10000;
  const server = await createGameServer({
    port: 0,
    host: '127.0.0.1',
    advertisedHost: '127.0.0.1',
    now: () => now,
    postRaceConfig: {
      resultsDurationSeconds: 1,
      mapVote: { enabled: true, durationSeconds: 1, numberOfChoices: 2, excludeLastPlayedTrack: true },
      mapAnnouncementDurationSeconds: 1,
      returnToLobbyAfterVote: true,
      resetReadyStatusOnLobbyReturn: true,
      autoStartNextRace: false,
      hostMustStartNextRace: true
    }
  });

  const sockets = [];
  const request = (s, event, data = {}) => new Promise((resolve, reject) => s.timeout(2000).emit(event, data, (err, res) => err ? reject(err) : resolve(res)));
  const make = async () => {
    const s = connect(`http://127.0.0.1:${server.port}`, { transports: ['websocket'], auth: { token: randomBytes(24).toString('hex') }, reconnection: false });
    sockets.push(s);
    await new Promise(resolve => s.once('connect', resolve));
    return s;
  };

  try {
    const host = await make(), created = await request(host, 'createRoom', { name: 'Pilote A' });
    const guest = await make(), joined = await request(guest, 'joinRoom', { name: 'Ami', code: created.room.code });
    const room = server.manager.rooms.get(created.room.code);

    let currentMap = room.mapId;

    for (let round = 1; round <= 4; round++) {
      await request(host, 'playerReady', { ready: true });
      await request(guest, 'playerReady', { ready: true });
      await request(host, 'startRace');
      for (const s of sockets) await request(s, 'raceLoaded', { raceId: room.race.id });
      now = (room.race.startAt || now) + 1;
      server.manager.tick();
      assert.equal(room.state, 'RACING');

      // Fin de course
      for (const r of room.race.records.values()) r.dnf = true;
      server.manager.tick();
      assert.equal(room.state, 'RESULTS');
      assert.equal(room.lastPlayedTrackId, currentMap);

      // Fin des résultats -> vote
      now = room.resultsEndAt + 10;
      server.manager.tick();
      assert.equal(room.state, 'MAP_VOTE');

      // VÉRIFICATION STRICTE DE L'EXCLUSION
      assert.equal(room.mapVote.choices.length, 2);
      assert.notEqual(room.mapVote.choices[0].id, room.mapVote.choices[1].id);
      for (const c of room.mapVote.choices) {
        assert.notEqual(c.id, currentMap, `Round ${round}: La map jouée (${currentMap}) ne doit PAS être proposée`);
      }

      // Vote pour choice 0
      const wonChoice = room.mapVote.choices[0];
      await request(host, 'voteTrack', { trackId: wonChoice.id });

      // Fin du vote -> annonce
      now = room.mapVote.endsAt + 10;
      server.manager.tick();
      assert.equal(room.state, 'MAP_ANNOUNCEMENT');

      // Fin de l'annonce -> retour lobby
      now = room.announcementEndAt + 10;
      server.manager.tick();
      assert.equal(room.state, 'LOBBY');
      assert.equal(room.mapId, wonChoice.id);

      currentMap = wonChoice.id;
    }
  } finally {
    sockets.forEach(s => s.disconnect());
    await server.close();
  }
});

// ============================================================================
// TEST 12 : Maintien du salon et des connexions sans aucune déconnexion
// ============================================================================
test('TEST 12: Le salon reste le même pendant tout le cycle (aucun joueur déconnecté)', async () => {
  let now = 10000;
  const server = await createGameServer({
    port: 0,
    host: '127.0.0.1',
    advertisedHost: '127.0.0.1',
    now: () => now,
    postRaceConfig: {
      resultsDurationSeconds: 1,
      mapVote: { enabled: true, durationSeconds: 1, numberOfChoices: 2 },
      mapAnnouncementDurationSeconds: 1
    }
  });

  const sockets = [];
  const request = (s, event, data = {}) => new Promise((resolve, reject) => s.timeout(2000).emit(event, data, (err, res) => err ? reject(err) : resolve(res)));
  const make = async () => {
    const s = connect(`http://127.0.0.1:${server.port}`, { transports: ['websocket'], auth: { token: randomBytes(24).toString('hex') }, reconnection: false });
    sockets.push(s);
    await new Promise(resolve => s.once('connect', resolve));
    return s;
  };

  try {
    const host = await make(), created = await request(host, 'createRoom', { name: 'Pilote A' });
    const guest = await make(), joined = await request(guest, 'joinRoom', { name: 'Ami', code: created.room.code });
    const room = server.manager.rooms.get(created.room.code);

    const assertPlayersConnected = (stage) => {
      assert.equal(room.players.size, 2, `${stage}: 2 joueurs dans le salon`);
      assert.equal(room.players.get(created.playerId)?.connected, true, `${stage}: Host connecté`);
      assert.equal(room.players.get(joined.playerId)?.connected, true, `${stage}: Guest connecté`);
      assert.equal(sockets[0].connected, true, `${stage}: Socket host connectée`);
      assert.equal(sockets[1].connected, true, `${stage}: Socket guest connectée`);
    };

    assertPlayersConnected('Init Lobby');

    await request(host, 'playerReady', { ready: true });
    await request(guest, 'playerReady', { ready: true });
    await request(host, 'startRace');
    for (const s of sockets) await request(s, 'raceLoaded', { raceId: room.race.id });
    now = (room.race.startAt || now) + 1;
    server.manager.tick();
    assertPlayersConnected('Course en cours');

    for (const r of room.race.records.values()) r.dnf = true;
    server.manager.tick();
    assertPlayersConnected('Résultats');

    now = room.resultsEndAt + 10;
    server.manager.tick();
    assertPlayersConnected('Vote');

    now = room.mapVote.endsAt + 10;
    server.manager.tick();
    assertPlayersConnected('Annonce');

    now = room.announcementEndAt + 10;
    server.manager.tick();
    assertPlayersConnected('Retour Lobby');
  } finally {
    sockets.forEach(s => s.disconnect());
    await server.close();
  }
});
