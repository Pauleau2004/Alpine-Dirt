import { randomBytes,randomUUID } from 'node:crypto';
import { createTrack } from '../src/tracks/createTrack.js';
import { DEFAULT_MAP_ID,isMapId,mapInfo,MAPS } from '../shared/maps.js';
import { MAX_PLAYERS,PLAYER_COLORS,COLOR_NAMES,NETWORK_HZ } from '../shared/multiplayer.js';
import { MULTIPLAYER_POST_RACE_CONFIG,MAP_VOTE_CONFIG,getEligibleMaps,selectRandomVoteChoices,determineVoteWinner,tallyVotes } from '../shared/mapVote.js';
import { RaceManager } from './RaceManager.js';
import { nickname,roomCode,requireValue,validateState,RateLimiter,chatText } from './NetworkValidator.js';
import { isOwnerConnection as localOwnerConnection } from './HostIdentity.js';
import { ConnectionGuard,peerAddress } from './RequestSecurity.js';

export class RoomManager {
  constructor(io,{now=Date.now,lanUrl='http://localhost:3000',reconnectMs=5000,isOwnerConnection=localOwnerConnection,postRaceConfig={},voteConfig={},availableMaps=MAPS,randomFn=Math.random,...raceOptions}={}) {
    this.io=io;this.now=now;this.lanUrl=lanUrl;this.reconnectMs=reconnectMs;this.raceOptions=raceOptions;
    const mergedVote={...MULTIPLAYER_POST_RACE_CONFIG.mapVote,...(voteConfig.mapVote||{}),...(postRaceConfig.mapVote||{})};
    this.postRaceConfig={
      ...MULTIPLAYER_POST_RACE_CONFIG,
      ...voteConfig,
      ...postRaceConfig,
      mapVote:mergedVote
    };
    if(voteConfig.resultsDurationSeconds!==undefined)this.postRaceConfig.resultsDurationSeconds=voteConfig.resultsDurationSeconds;
    if(voteConfig.durationSeconds!==undefined)this.postRaceConfig.mapVote.durationSeconds=voteConfig.durationSeconds;
    if(voteConfig.transitionSeconds!==undefined)this.postRaceConfig.mapAnnouncementDurationSeconds=voteConfig.transitionSeconds;
    if(postRaceConfig.durationSeconds!==undefined)this.postRaceConfig.mapVote.durationSeconds=postRaceConfig.durationSeconds;
    if(postRaceConfig.transitionSeconds!==undefined)this.postRaceConfig.mapAnnouncementDurationSeconds=postRaceConfig.transitionSeconds;

    this.availableMaps=availableMaps;this.randomFn=randomFn;
    this.rooms=new Map();this.sessions=new Map();this.track=createTrack();this.tracks=new Map([[DEFAULT_MAP_ID,this.track]]);
    this.isOwnerConnection=isOwnerConnection;
    this.connections=new ConnectionGuard({now});
    io.on('connection',socket=>this.connect(socket));
    this.timer=setInterval(()=>this.tick(),1000/NETWORK_HZ);this.timer.unref();
  }
  close(){clearInterval(this.timer);}
  connect(socket) {
    const now=this.now,token=socket.handshake.auth?.token;
    if(typeof token!=='string'||!(/^[a-f0-9]{32,64}$/i.test(token))){socket.disconnect(true);return;}
    const address=peerAddress(socket.request),connection=this.connections.acquire(address);
    if(!connection){socket.disconnect(true);return;}
    const idle=setTimeout(()=>{if(!socket.data.player)socket.disconnect(true);},15000);idle.unref();
    socket.once('disconnect',()=>{clearTimeout(idle);connection.release();});
    const packets=new RateLimiter(100,180,now);
    socket.onAny(()=>{if(!packets.take())socket.disconnect(true);});
    socket.data.isServerOwner=!!this.isOwnerConnection(socket);
    const commands=new RateLimiter(6,14,now),states=new RateLimiter(NETWORK_HZ*1.5,8,now),chats=new RateLimiter(3,6,now);
    const handle=(event,fn)=>socket.on(event,(data,ack)=>{
      const reply=typeof ack==='function'?ack:()=>{};
      try {requireValue(socket.connected,'Connexion interrompue.');requireValue(commands.take()&&connection.commands.take(),'Trop de demandes. Réessayez dans un instant.');reply({ok:true,...fn(data??{})});}
      catch(error){reply({ok:false,error:error.message||'Demande invalide.'});}
    });
    handle('joinLocal',data=>{
      requireValue(!socket.data.player,'Vous êtes déjà dans un salon.');
      const name=nickname(data.name),code='MXTEAM';
      let room=this.rooms.get(code);
      if(!room){room={code,permanent:true,players:new Map(),hostId:null,laps:2,state:'LOBBY',race:null,emptySince:null,mapId:DEFAULT_MAP_ID,lastPlayedTrackId:null,resultsEndAt:null,mapVote:null,nextMapId:null,announcementEndAt:null};this.rooms.set(code,room);}
      requireValue(['LOBBY','RESULTS','MAP_VOTE','MAP_ANNOUNCEMENT'].includes(room.state),'La course est en cours. Revenez au salon après son arrivée.');
      this.releaseDisconnectedOwner(room,socket);
      requireValue(room.players.size<MAX_PLAYERS,`Le salon est complet (${MAX_PLAYERS} joueurs).`);
      const player=this.addPlayer(room,socket,token,name);
      this.broadcast(room);return {room:this.roomState(room),playerId:player.id};
    });
    handle('createRoom',data=>{
      requireValue(socket.data.isServerOwner,'Seul le PC hôte peut créer une partie. Rejoignez le salon local.');
      requireValue(!socket.data.player,'Vous êtes déjà dans un salon.');
      requireValue(this.rooms.size<100,'Le serveur ne peut plus créer de salon.');
      const name=nickname(data.name);let code;
      const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      do{code=[...randomBytes(6)].map(n=>alphabet[n%alphabet.length]).join('');}while(this.rooms.has(code)||code==='MXTEAM');
      const room={code,players:new Map(),hostId:null,laps:2,state:'LOBBY',race:null,emptySince:null,mapId:DEFAULT_MAP_ID,lastPlayedTrackId:null,resultsEndAt:null,mapVote:null,nextMapId:null,announcementEndAt:null};this.rooms.set(code,room);
      const player=this.addPlayer(room,socket,token,name);room.hostId=player.id;
      this.broadcast(room);return {room:this.roomState(room),playerId:player.id};
    });
    handle('joinRoom',data=>{
      requireValue(!socket.data.player,'Vous êtes déjà dans un salon.');
      const room=this.rooms.get(roomCode(data.code));requireValue(room,'Ce salon n’existe plus.');
      requireValue(['LOBBY','RESULTS','MAP_VOTE','MAP_ANNOUNCEMENT'].includes(room.state),'Cette course a déjà commencé. Attendez le retour au salon.');
      const name=nickname(data.name);this.releaseDisconnectedOwner(room,socket);
      requireValue(room.players.size<MAX_PLAYERS,`Le salon est complet (${MAX_PLAYERS} joueurs).`);
      const player=this.addPlayer(room,socket,token,name);this.broadcast(room);return {room:this.roomState(room),playerId:player.id};
    });
    handle('playerReady',data=>{
      const [room,p]=this.member(socket);
      requireValue(room.state==='LOBBY','La course a déjà commencé.');
      requireValue(typeof data.ready==='boolean','Statut invalide.');
      p.ready=data.ready;
      this.broadcast(room);
      return {};
    });
    handle('setLaps',data=>{const [room,p]=this.member(socket);this.host(room,p);requireValue(room.state==='LOBBY','Le nombre de tours ne peut plus changer.');requireValue([1,2,3,5].includes(data.laps),'Choisissez 1, 2, 3 ou 5 tours.');room.laps=data.laps;this.broadcast(room);return {};});
    handle('setMap',data=>{const [room,p]=this.member(socket);this.host(room,p);requireValue(room.state==='LOBBY','Le circuit ne peut plus changer pendant une course.');requireValue(isMapId(data.mapId),'Circuit inconnu.');room.mapId=data.mapId;for(const player of room.players.values())player.ready=false;this.broadcast(room);return {};});
    handle('startRace',()=>{
      const [room,p]=this.member(socket);this.host(room,p);
      requireValue(room.state==='LOBBY','La course a déjà commencé.');
      const players=[...room.players.values()].filter(p=>p.connected);
      requireValue(players.length>=2,'Il faut au moins deux joueurs.');
      requireValue(players.every(p=>p.ready),'Tous les joueurs doivent être prêts.');
      const mapId=room.mapId??DEFAULT_MAP_ID;
      if(!this.tracks.has(mapId))this.tracks.set(mapId,createTrack(mapId));
      room.race=new RaceManager(this.tracks.get(mapId),players,room.laps,now(),{...this.raceOptions,recordStore:this.storeFor(room)});
      room.state='COUNTDOWN';
      this.broadcast(room);
      return {};
    });
    handle('raceLoaded',data=>{const [room,p]=this.member(socket);requireValue(room.race?.id===data.raceId&&room.state==='COUNTDOWN','Départ expiré.');room.race.loaded(p.id,now());this.broadcast(room);return {};});
    handle('resetBike',data=>{const [room,p]=this.member(socket);requireValue(room.race?.id===data.raceId&&room.state==='RACING','La course n’est pas active.');const result=room.race.resetPlayer(p.id,now());requireValue(result,'Veuillez patienter avant de vous replacer.');return result;});
    handle('requestBoost',data=>{
      const [room,p]=this.member(socket);requireValue(room.race?.id===data.raceId&&room.state==='RACING','La course n’est pas active.');
      const activation=room.race.requestBoost(p.id,now());requireValue(activation,'Boost indisponible : restez dernier jusqu’à la fin de la recharge.');
      this.io.to(room.code).emit('playerBoostStarted',activation);
      return {boostActivated:activation};
    });
    handle('voteTrack',data=>{
      const [room,p]=this.member(socket);
      requireValue(room.state==='MAP_VOTE'&&room.mapVote,'Le vote n’est pas actif.');
      requireValue(now()<room.mapVote.endsAt,'Le vote est terminé.');
      requireValue(room.mapVote.choices.some(c=>c.id===data.trackId),'Circuit non proposé dans le vote.');
      room.mapVote.votes.set(p.id,data.trackId);
      const voteState=this.voteState(room);
      this.io.to(room.code).emit('mapVoteUpdated',voteState);
      this.broadcast(room);
      return {ok:true,trackId:data.trackId};
    });
    handle('returnLobby',()=>{
      const [room,p]=this.member(socket);this.host(room,p);
      requireValue(['RESULTS','FINISHED','MAP_VOTE','MAP_ANNOUNCEMENT'].includes(room.state),'Attendez la fin de la course.');
      this.returnToLobbyAfterVote(room);
      return {};
    });
    handle('leaveRoom',()=>{if(socket.data.player)this.remove(socket.data.player,true);return {};});
    handle('timeSync',data=>{if(socket.data.player&&Number.isFinite(data.ping)){socket.data.player.ping=Math.round(Math.max(0,Math.min(999,data.ping)));}return {serverTime:now()};});
    handle('chatMessage',data=>{
      const [room,p]=this.member(socket);
      requireValue(chats.take(),'Veuillez patienter avant d’envoyer un autre message.');
      const text=chatText(data.text);
      const msg={playerId:p.id,name:p.name,color:p.color,text,time:now()};
      this.io.to(room.code).emit('chatMessage',msg);
      return {};
    });
    socket.on('playerState',data=>{
      if(!socket.connected||!states.take())return;
      const p=socket.data.player,room=p&&this.rooms.get(p.roomCode);if(!room?.race||room.state!=='RACING'||data?.raceId!==room.race.id)return;
      const state=validateState(data);if(state)room.race.accept(p.id,state,now());
    });
    socket.on('disconnect',()=>{if(socket.data.player)this.remove(socket.data.player,false);});
    const previous=this.sessions.get(token);
    if(previous&&!previous.connected&&now()-previous.disconnectedAt<=this.reconnectMs) {
      const room=this.rooms.get(previous.roomCode);
      if(room&&previous.address===address&&(!previous.isServerOwner||socket.data.isServerOwner)){previous.socket=socket;previous.connected=true;previous.disconnectedAt=null;socket.data.player=previous;socket.join(room.code);room.emptySince=null;room.race?.reconnect(previous.id,now());if(!room.hostId&&previous.isServerOwner)room.hostId=previous.id;socket.emit('sessionRestored',{playerId:previous.id,room:this.roomState(room)});this.broadcast(room);}
    }
  }
  releaseDisconnectedOwner(room,socket) {
    const owner=room.players.get(room.hostId);
    if(socket.data.isServerOwner&&room.state==='LOBBY'&&owner&&!owner.connected){
      this.sessions.delete(owner.token);room.players.delete(owner.id);room.hostId=null;
    }
  }
  addPlayer(room,socket,token,name) {
    requireValue(!this.sessions.has(token),'Cette session est déjà utilisée.');
    requireValue(![...room.players.values()].some(p=>p.name.normalize('NFKC').toLowerCase()===name.normalize('NFKC').toLowerCase()),'Ce pseudo est déjà utilisé dans le salon.');
    const isServerOwner=socket.data.isServerOwner;
    if(!isServerOwner&&!room.players.get(room.hostId))requireValue(room.players.size<MAX_PLAYERS-1,`Une place est réservée au PC hôte (${MAX_PLAYERS-1} invités maximum).`);
    const used=new Set([...room.players.values()].map(p=>p.color));const color=PLAYER_COLORS.find(c=>!used.has(c));
    const player={id:randomUUID(),roomCode:room.code,name,color,colorName:COLOR_NAMES[PLAYER_COLORS.indexOf(color)],socket,token,address:peerAddress(socket.request),isServerOwner,ready:false,ping:0,joinedAt:this.now(),connected:true,disconnectedAt:null};
    room.players.set(player.id,player);if(isServerOwner&&!room.hostId)room.hostId=player.id;this.sessions.set(token,player);socket.data.player=player;socket.join(room.code);return player;
  }
  member(socket) {const p=socket.data.player,room=p&&this.rooms.get(p.roomCode);requireValue(room&&p.connected&&p.socket===socket&&room.players.get(p.id)===p,'Vous n’êtes pas dans un salon.');return [room,p];}
  host(room,p) {requireValue(p.isServerOwner&&room.hostId===p.id,'Seul le PC hôte peut effectuer cette action.');}
  remove(player,permanent) {
    const room=this.rooms.get(player.roomCode);if(!room)return;
    player.connected=false;player.ready=false;player.disconnectedAt=this.now();player.socket.leave(room.code);player.socket.data.player=null;
    room.race?.disconnect(player.id,permanent,this.now());
    if(room.mapVote){
      room.mapVote.votes.delete(player.id);
      this.io.to(room.code).emit('mapVoteUpdated',this.voteState(room));
    }
    if(room.state==='COUNTDOWN'&&room.race?.startAt===null)room.race.loaded(null,this.now());
    if(permanent){room.players.delete(player.id);this.sessions.delete(player.token);}
    const connected=[...room.players.values()].filter(p=>p.connected).sort((a,b)=>a.joinedAt-b.joinedAt);
    if(room.hostId===player.id&&permanent){
      room.hostId=null;
      if(room.state!=='LOBBY'){
        room.state='LOBBY';room.race=null;room.mapVote=null;room.nextMapId=null;
        for(const p of room.players.values())p.ready=false;
        this.io.to(room.code).emit('notice','Le PC hôte a quitté la course. Retour au salon en attendant son retour.');
      }
    }
    if(connected.length===0){room.emptySince??=this.now();if(permanent||room.players.size===0){for(const p of room.players.values())this.sessions.delete(p.token);this.rooms.delete(room.code);return;}}
    this.broadcast(room);
  }
  voteState(room) {
    if(!room.mapVote)return null;
    const v=room.mapVote;
    const counts=tallyVotes(v.choices,v.votes);
    return {
      choices:v.choices,
      endsAt:v.endsAt,
      serverTime:this.now(),
      counts,
      votes:Object.fromEntries(v.votes),
      previousTrackId:v.previousTrackId,
      eligibleMapIds:v.eligibleMapIds,
      winner:v.winner,
      isTie:v.isTie
    };
  }
  startMapVote(room,now) {
    const previousTrackId=room.lastPlayedTrackId??room.mapId??DEFAULT_MAP_ID;
    const eligible=getEligibleMaps(this.availableMaps,previousTrackId);
    const choices=selectRandomVoteChoices(eligible,this.postRaceConfig.mapVote.numberOfChoices,this.randomFn);
    room.state='MAP_VOTE';
    room.mapVote={
      choices,
      endsAt:now+this.postRaceConfig.mapVote.durationSeconds*1000,
      votes:new Map(),
      previousTrackId,
      eligibleMapIds:eligible.map(m=>m.id),
      winner:null,
      isTie:false
    };
    this.io.to(room.code).emit('mapVoteStarted',this.voteState(room));
    this.broadcast(room);
  }
  concludeMapVote(room,now) {
    const outcome=determineVoteWinner(room.mapVote.choices,room.mapVote.votes,this.randomFn);
    room.mapVote.winner=outcome.winner;
    room.mapVote.isTie=outcome.isTie;
    room.mapVote.counts=outcome.counts;
    room.nextMapId=outcome.winner.id;
    room.state='MAP_ANNOUNCEMENT';
    room.announcementEndAt=now+this.postRaceConfig.mapAnnouncementDurationSeconds*1000;
    this.io.to(room.code).emit('mapVoteEnded',{
      winner:outcome.winner,
      isTie:outcome.isTie,
      counts:outcome.counts,
      totalVotes:outcome.totalVotes,
      announcementEndAt:room.announcementEndAt
    });
    this.io.to(room.code).emit('nextTrackSelected',{
      trackId:outcome.winner.id,
      track:outcome.winner,
      isTie:outcome.isTie
    });
    this.broadcast(room);
  }
  returnToLobbyAfterVote(room) {
    const nextMap=room.nextMapId??room.mapId??DEFAULT_MAP_ID;
    room.state='LOBBY';
    room.mapId=nextMap;
    room.lastPlayedTrackId=nextMap;
    room.race=null;
    room.mapVote=null;
    room.nextMapId=null;
    room.resultsEndAt=null;
    room.announcementEndAt=null;
    for(const player of room.players.values()){
      player.ready=false;
    }
    this.broadcast(room);
  }
  roomState(room) {
    return {
      code:room.code,
      mapId:room.mapId??DEFAULT_MAP_ID,
      mapTitle:mapInfo(room.mapId).title,
      permanent:!!room.permanent,
      hostId:room.hostId,
      hostPresent:!!room.players.get(room.hostId)?.connected,
      laps:room.laps,
      state:room.state,
      resultsEndAt:room.resultsEndAt,
      announcementEndAt:room.announcementEndAt,
      wifiUrl:`${this.lanUrl}/jouer`,
      shareUrl:room.permanent?`${this.shareBaseUrl??this.lanUrl}/jouer`:`${this.lanUrl}/?room=${room.code}`,
      serverTime:this.now(),
      record:this.storeFor(room)?.record??null,
      records:this.storeFor(room)?.records??[],
      recordSaveError:!!this.storeFor(room)?.error,
      lastPlayedTrackId:room.lastPlayedTrackId??null,
      mapVote:this.voteState(room),
      players:[...room.players.values()].filter(p=>p.connected||room.state!=='LOBBY').map(p=>({id:p.id,name:p.name,color:p.color,colorName:p.colorName,ready:p.ready,ping:p.ping,connected:p.connected})),
      race:room.race?.snapshot(this.now())??null
    };
  }
  storeFor(room){return this.raceOptions.recordStores?.get(room.mapId??DEFAULT_MAP_ID)??this.raceOptions.recordStore;}
  broadcast(room) {this.io.to(room.code).emit('roomState',this.roomState(room));}
  tick() {
    const now=this.now();
    for(const room of this.rooms.values()) {
      for(const p of [...room.players.values()])if(!p.connected&&now-p.disconnectedAt>this.reconnectMs)this.remove(p,true);
      if(!this.rooms.has(room.code))continue;
      const race=room.race;
      if(!race){
        if(!room.lastLobbyBroadcast||now-room.lastLobbyBroadcast>=2000){room.lastLobbyBroadcast=now;this.broadcast(room);}
        continue;
      }
      if(room.state==='COUNTDOWN') {
        if(race.startAt===null&&now-race.createdAt>15000){room.state='LOBBY';room.race=null;for(const p of room.players.values())p.ready=false;this.io.to(room.code).emit('notice','Le chargement a expiré. Remettez-vous prêts.');this.broadcast(room);continue;}
        if(race.startAt!==null&&now>=race.startAt){room.state='RACING';this.broadcast(room);}
      }
      for(const collision of race.tick(now))this.io.to(room.code).emit('playerCollision',collision);
      for(const reset of race.resetEvents.splice(0))this.io.to(room.code).emit('playerReset',reset);
      if(race.finished&&room.state==='RACING'){
        room.state='RESULTS';
        room.lastPlayedTrackId=room.mapId??DEFAULT_MAP_ID;
        room.resultsEndAt=now+this.postRaceConfig.resultsDurationSeconds*1000;
        this.broadcast(room);
      }
      else if((room.state==='RESULTS'||room.state==='FINISHED')&&this.postRaceConfig.mapVote.enabled&&room.resultsEndAt!==null&&now>=room.resultsEndAt){
        room.resultsEndAt=null;
        this.startMapVote(room,now);
      }
      else if(room.state==='MAP_VOTE'&&room.mapVote&&now>=room.mapVote.endsAt){
        this.concludeMapVote(room,now);
      }
      else if((room.state==='MAP_ANNOUNCEMENT'||room.state==='NEXT_TRACK')&&room.announcementEndAt!==null&&now>=room.announcementEndAt){
        room.announcementEndAt=null;
        this.returnToLobbyAfterVote(room);
      }
      if(room.state!=='LOBBY')this.io.to(room.code).volatile.emit('raceState',{...race.snapshot(now),state:room.state});
    }
  }
}
