import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createTrack } from './tracks/createTrack.js';
import { Bike } from './Bike.js';
import { BikePhysics } from './BikePhysics.js';
import { CameraController } from './CameraController.js';
import { InputManager } from './InputManager.js';
import { CheckpointSystem } from './CheckpointSystem.js';
import { LapCheckpointSystem } from './LapCheckpointSystem.js';
import { TimeTrial,formatTime } from './TimeTrial.js';
import { Settings } from './Settings.js';
import { UI } from './UI.js';
import { Scenery } from './Scenery.js';
import { ParticleSystem } from './ParticleSystem.js';
import { damp } from './math.js';
import { MultiplayerClient } from './network/MultiplayerClient.js';
import { LapRecord } from './LapRecord.js';
import { SpectatorController } from './SpectatorController.js';
import { CheckpointRecovery,resetRecoveryMarker } from '../shared/checkpointRecovery.js';
import { cleanPlayerName } from '../shared/lapRecord.js';
import { isDevAuthorized } from './devAuth.js';

export class Game {
  async init() {
    await RAPIER.init();
    this.settings=new Settings();this.state='menu';
    this.debug=isDevAuthorized()&&new URLSearchParams(location.search).get('debug')==='1';
    this.time=0;this.fps=60;this.accumulator=0;this.fixedDt=1/120;this.countdown=0;
    const skyColor=0xafd4e4;
    this.renderer=new THREE.WebGLRenderer({canvas:document.querySelector('#game'),antialias:true,powerPreference:'high-performance'});
    this.renderer.setClearColor(skyColor);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(skyColor);this.scene.fog=new THREE.Fog(skyColor,115,385);
    this.camera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,.1,650);
    this.scene.add(new THREE.HemisphereLight(0xdeeff3,0x758651,1.65));
    this.sun=new THREE.DirectionalLight(0xffefcf,2.5);this.sun.position.set(-50,80,-40);this.sun.castShadow=true;
    Object.assign(this.sun.shadow.camera,{left:-38,right:38,top:38,bottom:-38,near:1,far:190});
    this.sun.shadow.normalBias=.035;this.sun.shadow.bias=-.0002;this.sun.shadow.mapSize.set(1024,1024);this.scene.add(this.sun,this.sun.target);
    this.world=new RAPIER.World({x:0,y:-9.81,z:0});this.world.timestep=this.fixedDt;
    this.track=createTrack('alpine');this.track.build(this.scene,this.world,RAPIER);
    this.scenery=new Scenery(this.scene,this.track);
    this.particles=new ParticleSystem(this.scene);
    this.physics=new BikePhysics(RAPIER,this.world);this.physics.reset(this.track.at(0));
    this.bike=new Bike(this.scene);
    for(let i=0;i<120;i++){this.physics.beforeStep(this.fixedDt,{throttle:0,brake:0,steer:0});this.world.step();this.physics.afterStep();}
    this.bike.update(this.physics,1,this.fixedDt);
    this.cameraController=new CameraController(this.camera,this.track);
    this.checkpoints=new CheckpointSystem(this.track);this.lapCheckpoints=new LapCheckpointSystem(this.track);this.trial=new TimeTrial();
    this.checkpointRecovery=new CheckpointRecovery(this.lapCheckpoints);
    this.lapRecord=new LapRecord();this.spectator=new SpectatorController(this);this.serverRecords=null;try{for(const k of Object.keys(localStorage))if(k.startsWith('motocross.ghost.'))localStorage.removeItem(k);}catch{}this.fetchServerRecords();
    this.input=new InputManager(action=>this.action(action),()=>!!this.multiplayer?.inRace);this.ui=new UI(this);
    this.multiplayer=new MultiplayerClient(this);
    this.ui.setScreen('menu');this.applySettings();
    window.addEventListener('resize',()=>this.resize());
    this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();this.pause();this.ui.toast('Le contexte graphique a été interrompu. Rechargez la page.',30);});
    this.lastTime=performance.now();this.frame=this.frame.bind(this);requestAnimationFrame(this.frame);
    this.multiplayer.init();
    return this;
  }

  fetchServerRecords() {
    return this.requestRecords(`/api/record?map=${this.track.id}`);
  }
  requestRecords(url,options) {
    const track=this.track,revision=this.recordsRequest=(this.recordsRequest??0)+1;
    return fetch(url,options).then(r=>{if(!r.ok)throw new Error('Records unavailable');return r.json();}).then(data=>{
      if(this.track===track&&this.recordsRequest===revision)this.serverRecords=data.records??[];
    }).catch(()=>{});
  }
  resize() {
    this.renderer.setSize(innerWidth,innerHeight);this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();
  }
  loadMap(id) {
    if(this.track.id===id)return;
    for(const group of [this.track.group,this.scenery.group]){
      const geometries=new Set(),materials=new Set(),textures=new Set();
      group.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.geometry)geometries.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){materials.add(m);if(m.map)textures.add(m.map);}});
      this.scene.remove(group);for(const r of [...geometries,...materials,...textures])r.dispose();
    }
    this.world.free();this.world=new RAPIER.World({x:0,y:-9.81,z:0});this.world.timestep=this.fixedDt;
    this.track=createTrack(id);this.track.build(this.scene,this.world,RAPIER);this.scenery=new Scenery(this.scene,this.track);
    this.physics=new BikePhysics(RAPIER,this.world);this.physics.reset(this.track.at(0));
    if (this.bike) {
      this.bike.dispose?.();
      if (this.bike.group?.parent) this.scene.remove(this.bike.group);
    }
    this.bike = new Bike(this.scene);
    this.bike.update(this.physics,1,.01);
    this.cameraController.track=this.track;this.cameraController.snap();
    this.checkpoints=new CheckpointSystem(this.track);this.lapCheckpoints=new LapCheckpointSystem(this.track);
    this.checkpointRecovery=new CheckpointRecovery(this.lapCheckpoints);
    this.trial=this.track.id==='alpine'?new TimeTrial():new TimeTrial(undefined,`motocross.${this.track.circuitId}.best`);
    this.lapRecord=new LapRecord(undefined,this.track.circuitId);this.particles.clear();
    const skyColor = 0xafd4e4;
    this.scene.background.set(skyColor);
    this.renderer.setClearColor(skyColor);
    this.scene.fog.color.set(skyColor);
    this.scene.fog.near = 115;
    this.scene.fog.far = 385;
    if(this.particles?.mesh?.material?.uniforms?.color)this.particles.mesh.material.uniforms.color.value.set(this.track.id==='terrerouge'?0xb85233:this.track.id==='canyon'?0xaf583d:0xbba37d);
    this.accumulator=0;this.input.clear();
    this.serverRecords=null;this.fetchServerRecords();
  }

  applySettings() {
    const s=this.settings.values;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,{low:1,medium:1.5,high:2}[s.quality]));
    this.renderer.shadowMap.enabled=s.shadows&&s.quality!=='low';
    const size=s.quality==='high'?2048:1024;
    if(this.sun.shadow.mapSize.x!==size){this.sun.shadow.mapSize.set(size,size);this.sun.shadow.map?.dispose();this.sun.shadow.map=null;}
    this.scene.traverse(o=>{if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])m.needsUpdate=true;}});
    if(this.particles){this.particles.mesh.visible=s.particles;this.particles.mesh.material.uniforms.pixelScale.value=this.renderer.getPixelRatio();if(!s.particles)this.particles.clear();}
    this.resize();
  }
  start(mode,options={}) {
    if(!['trial','practice'].includes(mode))throw new Error('Mode inconnu');
    if(this.multiplayer.active)this.multiplayer.leave();
    if(mode==='trial')this.fetchServerRecords();
    this.bike.setColor(0xd7f36d);
    this.lapBoosted=false;
    const flyingStart=mode==='trial'&&!!options.flyingStart;
    this.trial.reset(mode,{flyingStart});this.checkpoints.reset();this.lapCheckpoints.reset();
    this.checkpointRecovery.reset();
    if(flyingStart) {
      this.lapCheckpoints.setLaunching(true);
      const spawn=this.track.at(0.75);
      const lastIndex=this.checkpoints.gates.findLastIndex(g=>g.u<=0.75+1e-6);
      if(lastIndex>=0)this.checkpoints.last=lastIndex;
      this.physics.reset(spawn);
      this.checkpoints.resetPosition(this.physics.position);
      this.lapCheckpoints.resetPosition(this.physics.position,spawn.u);
    } else {
      this.physics.reset(this.track.at(0));
    }
    this.cameraController.snap();
    this.input.clear();this.input.enabled=true;this.accumulator=0;
    this.state=mode==='trial'?'countdown':'playing';this.countdown=3;this.ui.setScreen(this.state);document.activeElement?.blur();
    this.particles?.clear();
    if(mode==='practice')this.ui.toast('À vous la piste · W accélère · S freine · R vous replace',5);
    else if(flyingStart)this.ui.toast('🚀 Départ lancé · Prenez de l’élan jusqu’à la ligne !',4);
  }
  action(action) {
    if(action==='debug'){if(isDevAuthorized())this.debug=!this.debug;return;}
    if(action==='blur'){this.pause();return;}
    if(action==='pause') {if(this.state==='settings')this.closeSettings();else if(this.state==='paused')this.resume();else this.pause();}
    if(action==='camera'&&['playing','countdown','net-arrived'].includes(this.state)){
      const cycle={close:'wide',wide:'firstPerson',firstPerson:'close'};
      const next=cycle[this.settings.values.camera]??'close';
      this.settings.set('camera',next);
      const labels={close:'proche',wide:'large',firstPerson:'première personne'};
      this.ui.toast(`Caméra ${labels[next]}`,1.5);
    }
    if(action==='reset'&&this.state==='playing')this.resetBike();
    if(action==='boost'&&this.state==='playing'&&this.input.enabled&&this.multiplayer.inRace)this.multiplayer.requestBoost();
  }
  resetBike(automatic=false) {
    if(this.multiplayer.inRace){this.multiplayer.resetBike();return;}
    if(this.trial.mode==='trial'&&this.trial.isLaunching){
      const spawn=this.track.at(0.75);
      this.physics.reset(spawn);
      this.checkpoints.reset();
      const lastIndex=this.checkpoints.gates.findLastIndex(g=>g.u<=0.75+1e-6);
      if(lastIndex>=0)this.checkpoints.last=lastIndex;
      this.checkpoints.resetPosition(this.physics.position);
      this.lapCheckpoints.setLaunching(true);
      this.lapCheckpoints.resetPosition(this.physics.position,spawn.u);
      this.cameraController.snap();this.particles?.clear();this.input.clear();
      this.ui.toast(`${automatic?'Sortie de piste':'Moto replacée'} · Repère d’élan (75%)`,3);
      return;
    }
    const missed=this.checkpointRecovery.pending,spawn=this.checkpointRecovery.spawn()??this.checkpoints.respawn();
    if(missed)resetRecoveryMarker(this.checkpoints,spawn,spawn.position);
    this.physics.reset(spawn);this.checkpoints.resetPosition(this.physics.position);this.lapCheckpoints.resetPosition(this.physics.position,spawn.u);this.cameraController.snap();this.particles?.clear();this.input.clear();
    this.checkpointRecovery.reset();
    this.ui.toast(missed?'Checkpoint manqué · repassez sous la banderole':`${automatic?'Retour sur la piste':'Moto replacée'} · repère ${this.checkpoints.last+1}`,3);
  }
  pause() {
    if(!['playing','countdown'].includes(this.state))return;
    if(this.multiplayer.inRace)this.multiplayer.paused=true;
    this.resumeState=this.state;this.state='paused';this.input.clear();this.input.enabled=false;this.ui.setScreen('paused');
  }
  resume() {this.multiplayer.paused=false;this.state=this.resumeState||'playing';this.input.clear();this.input.enabled=true;this.accumulator=0;this.ui.setScreen(this.state);document.activeElement?.blur();}
  showMenu() {if(this.multiplayer.active)this.multiplayer.leave();this.state='menu';this.input.clear();this.input.enabled=false;if(this.bike?.rider)this.bike.rider.visible=true;this.physics.reset(this.track.at(0));this.bike.update(this.physics,1,.1);this.ui.setScreen('menu');this.particles?.clear();}
  openSettings() {this.settingsReturn=this.state;if(['playing','countdown'].includes(this.state))this.pause();this.state='settings';this.input.clear();this.input.enabled=false;this.ui.setScreen('settings');}
  closeSettings() {this.state=this.settingsReturn==='menu'?'menu':'paused';this.ui.setScreen(this.state);document.activeElement?.blur();}
  fixedUpdate() {
    if(this.multiplayer.inRace){this.multiplayer.fixedUpdate(this.fixedDt);return;}
    if(!['playing','countdown'].includes(this.state))return;
    const dt=this.fixedDt;
    const near=this.track.nearest(this.physics.position.x,this.physics.position.z);
    const input=this.state==='countdown'?{throttle:0,brake:1,steer:0}:this.input.read();
    const trackBoost=this.track.getBoostAt?.(this.physics.position,near.u)?1:0;
    this.physics.beforeStep(dt,input,this.settings.values.sensitivity,near.distance<(this.track.widthAt?.(near.u)??this.track.width)/2+.4,trackBoost);this.world.step();this.physics.afterStep();

    if(this.state==='countdown') {this.countdown-=dt;if(this.countdown<=0){this.state='playing';this.ui.setScreen('playing');this.ui.toast('C’est parti !',1.5);}return;}
    const postNear=this.track.nearest(this.physics.position.x,this.physics.position.z,this.physics.position.y);
    if(this.physics.boostStrength>0)this.lapBoosted=true;
    this.checkpoints.update(this.physics.position);
    const event=this.trial.mode==='trial'?this.lapCheckpoints.update(this.physics.position,postNear):null;
    this.trial.update(dt,event);
    this.checkpointRecovery.update(this.physics.position,postNear,this.trial.total*1000,event,this.trial.mode==='trial'&&!this.trial.isLaunching&&!this.trial.finished);
    if(this.checkpointRecovery.due(this.trial.total*1000))this.resetBike(true);
    if(event?.launchCompleted)this.ui.toast('🏁 Chrono lancé ! Tour 1 · tours illimités',2.5);
    if(event?.checkpoint)this.ui.toast(`Checkpoint ${event.index} / ${this.lapCheckpoints.gates.length} validé`,1.3);
    if(event?.missingCheckpoint)this.ui.toast(`Tour incomplet · franchissez le checkpoint ${event.expected} / ${this.lapCheckpoints.gates.length}`,3);
    if(event?.lap){
      this.ui.toast(`Tour terminé · ${formatTime(this.trial.results.at(-1).time)}`,3);
      if(event.valid&&!this.debug&&!this.lapBoosted){
        const lapTime=this.trial.results.at(-1).time;
        let name=this.lapRecord.name;try{name=cleanPlayerName(localStorage.getItem('motocross.nickname')||name);}catch{}
        this.lapRecord.setName(name);
        this.lapRecord.submit(lapTime);
        this.requestRecords(`/api/trial-record?map=${this.track.id}`,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({time:lapTime,name})
        });
      }
      this.lapBoosted=this.physics.boostStrength>0;
    }
    if(this.trial.finished){this.state='finished';this.input.enabled=false;this.input.clear();this.ui.setScreen('finished');}
    if(this.physics.position.y<-30||Math.abs(this.physics.position.x)>235||Math.abs(this.physics.position.z)>235)this.resetBike(true);
    if(this.settings.values.particles)this.particles?.update(dt,this.physics,postNear.distance<7);
  }
  frame(now) {
    const dt=Math.min((now-this.lastTime)/1000,.1);this.lastTime=now;this.time+=dt;this.fps=damp(this.fps,1/Math.max(dt,.001),2,dt);
    this.multiplayer.tick();
    this.accumulator+=dt;
    while(this.accumulator>=this.fixedDt){this.fixedUpdate();this.accumulator-=this.fixedDt;}
    const networkDriving=this.multiplayer.inRace&&!this.multiplayer.arrivedShown&&!this.multiplayer.resultsShown;
    if(['playing','countdown'].includes(this.state)||networkDriving)this.bike.update(this.physics,this.accumulator/this.fixedDt,dt);
    this.multiplayer.updateRemotes(dt);
    const spectating=this.spectator.update(dt);
    if(['menu','solo','map-select','multiplayer','create-room','join-room','lobby'].includes(this.state)||(this.state==='settings'&&this.settingsReturn==='menu'))this.cameraController.menu(this.time);
    else if(!spectating&&(['playing','countdown'].includes(this.state)||networkDriving))this.cameraController.update(dt,this.bike,this.physics,this.settings.values.camera);
    const p=this.spectator.current?.bike.group.position??this.bike.group.position;this.sun.position.set(p.x-45,p.y+72,p.z-35);this.sun.target.position.copy(p);
    this.ui.update(dt,this.time);this.camera.updateMatrixWorld();this.multiplayer.render(dt);this.renderer.render(this.scene,this.camera);requestAnimationFrame(this.frame);
  }
}
