import { io } from 'socket.io-client';
import * as THREE from 'three';
import { NETWORK_HZ,INTERPOLATION_MS,ROOM_PATTERN } from '../../shared/multiplayer.js';
import { RemotePlayer } from './RemotePlayer.js';
import { LobbyUI } from './LobbyUI.js';
import { CollisionResponse } from './CollisionResponse.js';
import { MotorcycleConstraints } from './MotorcycleConstraints.js';
import { CollisionDebug } from './CollisionDebug.js';
import { boostStrength } from '../../shared/lastPlaceBoost.js';
import { collisionAudio } from '../CollisionAudio.js';
import { SlipstreamSystem } from './SlipstreamSystem.js';

export class MultiplayerClient {
  constructor(game) {
    this.game=game;this.ui=new LobbyUI(this);this.socket=null;this.room=null;this.playerId=null;this.race=null;this.remotes=new Map();
    this.offset=0;this.ping=0;this.bestPing=Infinity;this.sent=0;this.received=0;this.seq=0;this.paused=false;this.busy=false;this.intentional=false;
    this.collisions=new CollisionResponse();this.collisionVersion=0;this.SHOW_MULTIPLAYER_COLLIDERS=false;
    this.motorcycleConstraints=new MotorcycleConstraints();
    this.boostActivations=new Map();this.boostPending=false;
    this.slipstream=new SlipstreamSystem(game);
    this.mapVote=null;this.nextTrack=null;this.chatHistory=[];
  }
  get active(){return !!this.room;}
  get inRace(){return !!this.race&&!['LOBBY','RESULTS','FINISHED','MAP_VOTE','MAP_ANNOUNCEMENT','NEXT_TRACK'].includes(this.room?.state);}
  get me(){return this.room?.players.find(p=>p.id===this.playerId);}
  get standing(){return this.race?.standings.find(p=>p.id===this.playerId);}
  get host(){return this.room?.hostId===this.playerId;}
  serverNow(){return Date.now()+this.offset;}
  init() {
    if(location.pathname==='/jouer'){this.openLocal();return;}
    const code=new URLSearchParams(location.search).get('room');
    if(code)this.openJoin(code.toUpperCase());
  }
  screen(type){this.game.state=type;this.game.input.clear();this.game.input.enabled=false;this.game.ui.setScreen(type);}
  openMenu(){this.screen('multiplayer');}
  openLocal(){this.localJoin=true;this.joinCode='';this.joinError='';this.joinInfo=null;this.screen('join-room');}
  async openJoin(code='') {
    this.localJoin=false;this.joinCode=code;this.joinInfo=null;this.joinError='';this.screen('join-room');
    if(!code)return;
    if(!ROOM_PATTERN.test(code)){this.joinError='Lien de salon invalide.';this.ui.render('join-room');return;}
    try{const response=await fetch(`/api/rooms/${code}`);const data=await response.json();if(!response.ok)throw new Error(data.error);this.joinInfo=data;}
    catch{this.joinError='Salon introuvable ou serveur indisponible.';}
    if(this.game.state==='join-room')this.ui.render('join-room');
  }
  async connect() {
    if(this.socket?.connected)return;
    if(this.socket)this.socket.disconnect();
    this.intentional=false;
    const bytes=crypto.getRandomValues(new Uint8Array(24)),token=[...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');
    const socket=io({autoConnect:false,auth:{token},timeout:4000,reconnectionAttempts:7,reconnectionDelay:500,reconnectionDelayMax:900,randomizationFactor:.1});this.socket=socket;
    socket.on('roomState',room=>{if(this.playerId)this.receiveRoom(room);else this.pendingRoom=room;});
    socket.on('raceState',race=>{if(this.race?.id===race.id){this.race=race;this.room.state=race.state;this.receiveRace();}});
    socket.on('playerCollision',event=>{
      if(!this.inRace||this.room.state!=='RACING'||this.resetting||this.arrivedShown||this.resultsShown)return;
      const received=this.collisions.receive(event,{raceId:this.race.id,playerId:this.playerId,version:this.collisionVersion,now:this.serverNow(),bike:this.game.physics});
      if(received&&!event.persistent){
        this.game.cameraController?.applyCollisionShake(event.intensity);
        this.game.particles?.emitContact(event.point,event.direction,event.intensity);
        collisionAudio.play(event.intensity);
      }
    });
    socket.on('playerBoostStarted',event=>this.receiveBoost(event));
    socket.on('playerReset',event=>this.receiveReset(event));
    socket.on('mapVoteStarted',vote=>{
      this.mapVote=vote;
      this.screen('net-vote');
      this.ui.render('net-vote');
    });
    socket.on('mapVoteUpdated',vote=>{
      this.mapVote=vote;
      if(this.game.state==='net-vote')this.ui.updateVote();
    });
    socket.on('mapVoteEnded',result=>{
      if(this.mapVote){
        this.mapVote.winner=result.winner;
        this.mapVote.isTie=result.isTie;
        this.mapVote.counts=result.counts;
      }
      if(this.room&&result.announcementEndAt)this.room.announcementEndAt=result.announcementEndAt;
      this.screen('net-announcement');
      this.ui.render('net-announcement');
    });
    socket.on('nextTrackSelected',data=>{
      this.nextTrack=data;
    });
    socket.on('chatMessage',msg=>{
      this.chatHistory.push(msg);
      if(this.chatHistory.length>100)this.chatHistory.shift();
      this.ui.appendChatMessage(msg);
    });
    socket.on('hostChanged',p=>this.game.ui.toast(`${p.name} est maintenant l’hôte.`,3));
    socket.on('notice',message=>this.game.ui.toast(message,4));
    socket.on('sessionRestored',data=>{
      this.playerId=data.playerId;this.disconnectedAt=null;this.receiveRoom(data.room,true);
      this.game.ui.toast('Connexion rétablie',2);
    });
    socket.on('disconnect',()=>{
      if(this.intentional||this.socket!==socket)return;
      this.disconnectedAt=Date.now();this.collisions.clear();this.boostActivations.clear();this.game.physics.boostStrength=0;this.game.input.clear();this.game.input.enabled=false;
      this.game.ui.toast('Connexion interrompue · reconnexion…',6);
    });
    socket.on('connect',()=>{this.syncClock().catch(()=>{});});
    await new Promise((resolve,reject)=>{
      const done=()=>{socket.off('connect_error',fail);resolve();};
      const fail=()=>{socket.off('connect',done);socket.disconnect();reject(new Error('Serveur indisponible. Sur le PC hôte, lancez npm run build puis npm start.'));};
      socket.once('connect',done);socket.once('connect_error',fail);socket.connect();
    });
    clearInterval(this.sendTimer);clearInterval(this.pingTimer);
    this.sendTimer=setInterval(()=>this.sendState(),1000/NETWORK_HZ);
    this.pingTimer=setInterval(()=>this.syncClock().catch(()=>{}),2000);
    await this.syncClock();
  }
  request(event,data={}) {
    return new Promise((resolve,reject)=>{
      if(!this.socket?.connected){reject(new Error('Connexion au serveur interrompue.'));return;}
      this.socket.timeout(4000).emit(event,data,(error,response)=>{
        if(error)reject(new Error('Le serveur ne répond pas.'));else if(!response?.ok)reject(new Error(response?.error||'Demande refusée.'));else resolve(response);
      });
    });
  }
  async syncClock() {
    const start=Date.now(),response=await this.request('timeSync',{ping:this.ping}),end=Date.now();
    this.ping=end-start;
    if(this.ping<=this.bestPing+8){this.offset=response.serverTime-(start+end)/2;this.bestPing=Math.min(this.bestPing,this.ping);}
  }
  async enter(event,name,code) {
    await this.connect();const result=await this.request(event,{name,code});
    this.playerId=result.playerId;this.pendingRoom=null;this.receiveRoom(result.room);
    this.game.lapRecord.setName(name);
    try{localStorage.setItem('motocross.nickname',name);}catch{}
    history.replaceState(null,'',this.room.permanent?'/jouer':('/?room=' + this.room.code));
  }
  receiveRoom(room,restored=false) {
    if(this.room&&room.code!==this.room.code)return;
    this.room=room;this.record=room.record??null;this.records=room.records??[];this.received++;
    this.mapVote=room.mapVote??this.mapVote;
    this.game.bike.setColor(this.me?.color??0xd7f36d);
    if(room.state==='LOBBY') {
      this.race=null;this.mapVote=null;this.nextTrack=null;this.resultsShown=false;this.arrivedShown=false;
      this.clearRemotes();this.game.loadMap(room.mapId??'alpine');this.paused=false;
      if(this.game.state==='lobby'&&this.game.ui.screen.querySelector('.lobby-players')){
        this.ui.updateLobby();
      }else{
        this.screen('lobby');
      }
      return;
    }
    if(room.state==='RESULTS'||room.state==='FINISHED') {
      if(!this.resultsShown){this.resultsShown=true;this.screen('net-results');}
      else if(this.game.state!=='net-results'){this.screen('net-results');}
      this.ui.updateResults();
      return;
    }
    if(room.state==='MAP_VOTE') {
      if(this.game.state!=='net-vote')this.screen('net-vote');
      this.ui.updateVote();
      return;
    }
    if(room.state==='MAP_ANNOUNCEMENT'||room.state==='NEXT_TRACK') {
      if(this.game.state!=='net-announcement')this.screen('net-announcement');
      this.ui.updateNextTrack();
      return;
    }
    const fresh=this.race?.id!==room.race?.id;
    this.race=room.race;
    if(fresh)this.prepare();
    if(restored&&!fresh){const own=this.race?.players.find(p=>p.id===this.playerId);if(own)this.restore(own);this.paused=false;}
    this.receiveRace();
  }
  prepare() {
    this.clearRemotes();this.seq=0;this.paused=false;this.arrivedShown=false;this.resultsShown=false;this.mapVote=null;this.nextTrack=null;
    this.game.loadMap(this.race.mapId??'alpine');
    const g=this.game;g.trial.reset('multiplayer');g.checkpoints.reset();g.lapCheckpoints.reset();g.particles.clear();
    const own=this.race.players.find(p=>p.id===this.playerId);if(!own)return;
    this.spawn=own.spawn;this.applySpawn(this.spawn,own.resetVersion);g.cameraController.snap();g.accumulator=0;
    this.screen('net-loading');
    this.ensureRemotes();
    this.request('raceLoaded',{raceId:this.race.id}).catch(error=>g.ui.toast(error.message));
  }
  applySpawn(spawn,version=0) {
    this.collisions.clear();this.motorcycleConstraints.clear();this.collisionVersion=version;
    const g=this.game;g.physics.reset({...spawn,position:new THREE.Vector3(...spawn.position)});g.bike.update(g.physics,1,.01);g.checkpoints.resetPosition(g.physics.position);g.lapCheckpoints.resetPosition(g.physics.position,spawn.u);g.cameraController.snap();g.particles.clear();
  }
  restore(frame) {
    this.applySpawn(frame.spawn,frame.resetVersion);
    this.checkpointProtectionUntil=frame.checkpointProtectionUntil??0;
    if(frame.collision){this.collisions.revision=frame.collision.revision;this.collisions.offset=[...frame.collision.offset];}
    if(frame.state){const s=frame.state,b=this.game.physics;b.position.fromArray(s.position);b.previousPosition.copy(b.position);b.pitch=s.pitch;b.roll=s.roll;b.yaw=new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...s.rotation),'YXZ').y;b.updateRotation();b.previousRotation.copy(b.rotation);b.body.setTranslation(b.position,true);b.body.setRotation(b.rotation,true);b.body.setLinvel(new THREE.Vector3(...s.velocity),true);this.seq=Math.max(this.seq,s.seq+1);}
  }
  ensureRemotes() {
    for(const p of this.room?.players??[])if(p.id!==this.playerId&&!this.remotes.has(p.id)&&p.connected)this.remotes.set(p.id,new RemotePlayer(this.game,p));
    for(const [id,remote] of this.remotes)if(!this.room?.players.some(p=>p.id===id&&p.connected)){remote.dispose();this.remotes.delete(id);}
  }
  receiveReset(event) {
    if(event?.raceId!==this.race?.id||event.playerId!==this.playerId||event.version<=this.collisionVersion)return;
    this.boostActivations.delete(this.playerId);this.slipstream.reset();
    this.applySpawn(event.spawn,event.version);this.checkpointProtectionUntil=event.protectionUntil??0;this.game.input.clear();
    if(event.reason==='checkpoint')this.game.ui.toast('Checkpoint manqué · repassez sous la banderole',3);
    if(event.reason==='invalid-state')this.game.ui.toast('Déplacement incohérent · position corrigée par le serveur',3);
  }
  collisionRemotes() {
    const now=this.serverNow();
    return new Map([...this.remotes].filter(([,r])=>now>=(r.latest?.checkpointProtectionUntil??0)));
  }
  receiveRace() {
    this.record=this.race?.record??this.record;this.records=this.race?.records??this.records;this.recordSaveError=this.race?.recordSaveError;
    this.received++;this.ensureRemotes();
    for(const p of this.race?.players??[])if(p.id!==this.playerId)this.remotes.get(p.id)?.receive(p);
    const frame=this.race?.players.find(p=>p.id===this.playerId);
    if(frame?.resetVersion>this.collisionVersion)this.receiveReset({raceId:this.race.id,playerId:this.playerId,version:frame.resetVersion,spawn:frame.spawn,reason:frame.resetReason,protectionUntil:frame.checkpointProtectionUntil});
    if(!this.resetting&&frame?.resetVersion===this.collisionVersion)this.collisions.reconcile(frame.collision,this.game.physics,this.collisionVersion);
    const own=this.standing;
    if(own){this.game.checkpoints.last=own.respawn;this.game.lapCheckpoints.passed=own.timingPassed??0;}
    if((this.room?.state==='RESULTS'||this.room?.state==='FINISHED')&&!this.resultsShown){this.resultsShown=true;this.screen('net-results');}
    else if(this.room?.state==='MAP_VOTE'){if(this.game.state!=='net-vote')this.screen('net-vote');}
    else if(this.room?.state==='MAP_ANNOUNCEMENT'||this.room?.state==='NEXT_TRACK'){if(this.game.state!=='net-announcement')this.screen('net-announcement');}
    else if(own?.time!==null&&own?.time!==undefined&&!this.arrivedShown&&!this.resultsShown){this.arrivedShown=true;this.screen('net-arrived');}
    if(this.game.state==='net-results')this.ui.updateResults();
    if(this.game.state==='net-vote')this.ui.updateVote();
    if(this.game.state==='net-announcement')this.ui.updateNextTrack();
  }
  tick() {
    if(this.disconnectedAt&&Date.now()-this.disconnectedAt>6000){this.leave();this.screen('multiplayer');this.game.ui.toast('Connexion perdue. Rejoignez à nouveau le salon.',5);return;}
    if(this.game.state==='net-results'){this.ui.updateResultsTimer();}
    if(this.game.state==='net-vote'){this.ui.updateVoteTimer();}
    if(this.game.state==='net-announcement'){this.ui.updateAnnouncementTimer();}
    if(!this.inRace||!this.socket?.connected||this.arrivedShown||this.resultsShown)return;
    const g=this.game;
    if(this.race?.startAt!==null&&this.race?.startAt!==undefined) {
      g.countdown=Math.max(0,(this.race.startAt-this.serverNow())/1000);
      const state=g.countdown>0?'countdown':'playing';
      if(!this.paused&&g.state!==state){g.state=state;g.ui.setScreen(state);if(state==='playing')g.ui.toast('GO !',1.4);}
      g.input.enabled=!this.paused&&state==='playing';
    }
  }
  fixedUpdate(dt) {
    const g=this.game;
    if(!this.socket?.connected||!this.race||this.race.startAt===null||this.arrivedShown||this.resultsShown)return;
    const countdown=this.serverNow()<this.race.startAt;
    const input=countdown||this.paused?{throttle:0,brake:1,steer:0}:g.input.read();
    const near=g.track.nearest(g.physics.position.x,g.physics.position.z);
    if(!countdown)this.collisions.step(g.physics,dt);
    const before=this.motorcycleConstraints.pose(g.physics,this.playerId);
    g.physics.beforeStep(dt,input,g.settings.values.sensitivity,near.distance<(g.track.widthAt?.(near.u)??g.track.width)/2+.4,countdown?0:boostStrength(this.boostFor(this.playerId),this.serverNow()));g.world.step();g.physics.afterStep();
    if(!countdown){
      if(this.serverNow()>=(this.checkpointProtectionUntil??0))this.motorcycleConstraints.step(g.physics,this.playerId,before,this.collisionRemotes(),this.serverNow(),dt);
      else this.motorcycleConstraints.clear();
      const slip=this.slipstream.update(dt,g.physics,this.remotes);
      if(slip.inDraft){
        const f=g.physics.scratch.forward;
        g.physics.body.addForce({x:f.x*slip.force,y:0,z:f.z*slip.force},true);
      }
    }
    if(countdown){g.physics.position.x=this.spawn.position[0];g.physics.position.z=this.spawn.position[2];g.physics.body.setTranslation(g.physics.position,true);const v=g.physics.body.linvel();g.physics.body.setLinvel({x:0,y:v.y,z:0},true);}
    if(Math.abs(g.physics.position.x)>235||Math.abs(g.physics.position.z)>235||g.physics.position.y<-30)this.resetBike();
    if(g.settings.values.particles){
      g.particles.update(dt,g.physics,near.distance<7);
    }
  }
  sendState() {
    if(!this.socket?.connected||!this.inRace||!this.race||this.race.startAt===null||this.serverNow()<this.race.startAt||this.arrivedShown||this.resultsShown||this.resetting)return;
    const b=this.game.physics,v=b.body.linvel();
    this.socket.volatile.emit('playerState',{raceId:this.race.id,seq:this.seq++,collisionAck:this.collisions.revision,resetVersion:this.collisionVersion,timestamp:this.serverNow(),position:b.position.toArray(),rotation:b.rotation.toArray(),velocity:[v.x,v.y,v.z],angularVelocity:[b.pitchRate,b.yawRate,b.rollRate],speed:b.speed,steer:b.steer,pitch:b.roll,roll:b.roll,throttle:b.throttle,suspension:b.wheels.map(w=>w.length),compression:b.wheels.map(w=>w.compression),grounded:!!b.grounded});this.sent++;
  }
  boostFor(playerId) {
    const state=this.race?.boost?.players.find(p=>p.playerId===playerId),event=this.boostActivations.get(playerId);
    const row=this.race?.standings.find(p=>p.id===playerId);
    const frame=this.race?.players.find(p=>p.id===playerId);
    if(playerId===this.playerId&&(this.disconnectedAt||this.resetting||frame?.resetVersion!==this.collisionVersion))return state?{...state,state:'INELIGIBLE'}:null;
    if(!row||row.disconnected||row.dnf||row.time!==null||this.room?.state!=='RACING')return state?{...state,state:'INELIGIBLE'}:null;
    if(event&&this.serverNow()<event.endTime&&event.resetVersion===frame?.resetVersion&&!(this.race.serverTime>event.startTime&&state?.state!=='ACTIVE'))return {...state,...event,state:'ACTIVE'};
    return state??null;
  }
  receiveBoost(event) {
    if(!this.inRace||event?.raceId!==this.race?.id||this.room?.state!=='RACING'||!Number.isFinite(event.startTime)||!Number.isFinite(event.endTime)||event.endTime<=this.serverNow())return;
    if(event.resetVersion!==this.race.players.find(p=>p.id===event.playerId)?.resetVersion)return;
    const previous=this.boostActivations.get(event.playerId);if(previous&&previous.sequence>=event.sequence)return;
    this.boostActivations.set(event.playerId,event);
    if(event.playerId===this.playerId)this.game.ui.toast('BOOST ACTIVÉ',1.5);
  }
  async requestBoost() {
    if(this.boostPending||this.resetting||!this.socket?.connected||!this.inRace||this.paused||this.arrivedShown||this.resultsShown)return;
    this.boostPending=true;
    try{const result=await this.request('requestBoost',{raceId:this.race.id});this.receiveBoost(result.boostActivated);}
    catch(error){if(this.boostFor(this.playerId)?.state==='READY')this.game.ui.toast(error.message,2);}
    finally{this.boostPending=false;}
  }
  async voteTrack(trackId) {
    if(!this.socket?.connected||this.room?.state!=='MAP_VOTE'||!this.mapVote)return;
    try{
      await this.request('voteTrack',{trackId});
      if(this.mapVote){
        this.mapVote.votes??={};
        this.mapVote.votes[this.playerId]=trackId;
        this.ui.updateVote();
      }
    }catch(error){
      this.game.ui.toast(error.message,2);
    }
  }
  async resetBike() {
    if(this.resetting||!this.inRace)return;this.resetting=true;this.collisions.clear();
    try{const response=await this.request('resetBike',{raceId:this.race.id});if(response.version>=this.collisionVersion){this.boostActivations.delete(this.playerId);this.applySpawn(response.spawn,response.version);this.checkpointProtectionUntil=response.protectionUntil??0;this.game.input.clear();this.game.ui.toast('Moto replacée',1.5);}}catch(error){this.game.ui.toast(error.message,2);}finally{this.resetting=false;}
  }
  updateRemotes(dt){
    for(const remote of this.remotes.values())remote.update(this.serverNow(),dt);
    if(this.inRace&&!this.arrivedShown&&!this.resultsShown&&this.serverNow()>=(this.checkpointProtectionUntil??0))this.motorcycleConstraints.render(this.game.bike,this.game.physics,this.playerId,this.collisionRemotes(),this.collisions.renderOffset(dt));
  }
  render(dt){
    for(const remote of this.remotes.values())remote.updateLabel();
    const show=this.inRace&&(this.game.debug||this.SHOW_MULTIPLAYER_COLLIDERS);
    if(show&&!this.collisionDebug)this.collisionDebug=new CollisionDebug(this.game.scene);
    this.collisionDebug?.update(this,show);this.ui.updateHud();
  }
  clearRemotes(){for(const remote of this.remotes.values())remote.dispose();this.remotes.clear();this.collisions.clear();this.motorcycleConstraints.clear();this.checkpointProtectionUntil=0;this.boostActivations.clear();this.boostPending=false;this.game.physics.boostStrength=0;this.collisionDebug?.dispose();this.collisionDebug=null;this.slipstream?.reset();}
  async sendChat(text) {
    if(!text||!text.trim())return;
    return this.request('chatMessage',{text:text.trim()});
  }
  leave() {
    this.intentional=true;const socket=this.socket;
    if(socket?.connected)socket.timeout(1000).emit('leaveRoom',{},()=>socket.disconnect());else socket?.disconnect();
    clearInterval(this.sendTimer);clearInterval(this.pingTimer);this.socket=null;this.room=null;this.race=null;this.playerId=null;this.disconnectedAt=null;this.chatHistory=[];this.clearRemotes();this.game.bike.setColor(0xd7f36d);this.ui.hideHud();history.replaceState(null,'',location.pathname);
  }
  debugText(){
    const c=this.race?.collisions,distances=[...this.remotes.values()].filter(r=>r.bike.group.visible).map(r=>r.pose.position.distanceTo(this.game.physics.position));
    let text=`\nRÉSEAU · ${NETWORK_HZ} Hz · Ping ${this.ping} ms\nSocket ${this.socket?.connected?'OUI':'NON'} · ${this.room?.players.length??0} joueurs\nSalon ${this.room?.code??'—'} · Joueur ${this.playerId?.slice(0,8)??'—'}\nPaquets ↑ ${this.sent} ↓ ${this.received} · Tampon ${INTERPOLATION_MS} ms`+(c?`\nCONTACTS · ${c.active} actifs / ${c.count} chocs\nChoc ${(c.lastIntensity??0).toFixed(2)} m/s · Rel. ${(c.relativeSpeed??0).toFixed(1)} m/s\nMoto proche ${distances.length?Math.min(...distances).toFixed(2)+' m':'—'}`:'');
    const v=this.room?.mapVote||this.mapVote;
    if(v){
      const remaining=Math.max(0,(v.endsAt-this.serverNow())/1000).toFixed(1);
      const cur=this.room?.mapId??'—';
      const last=v.previousTrackId??this.room?.lastPlayedTrackId??'—';
      const eligible=(v.eligibleMapIds??[]).join(', ')||'—';
      const choices=(v.choices??[]).map(ch=>ch.id).join(', ')||'—';
      const votesLines=(v.choices??[]).map(ch=>`${ch.id} = ${v.counts?.[ch.id]??0}`).join('\n');
      text+=`\n\nCurrent track:\n${cur}\nLast played track:\n${last}\nEligible maps:\n${eligible}\nVote choices:\n${choices}\nVote remaining:\n${remaining} sec\nVotes:\n${votesLines}`;
    }
    return text;
  }
}
