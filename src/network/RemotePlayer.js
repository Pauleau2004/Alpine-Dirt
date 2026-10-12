import * as THREE from 'three';
import { Bike } from '../Bike.js';
import { NetworkInterpolation } from './NetworkInterpolation.js';
import { boostStrength } from '../../shared/lastPlaceBoost.js';
export class RemotePlayer {
  constructor(game,player) {
    this.game=game;this.player=player;this.bike=new Bike(game.scene,{color:player.color,remote:true});this.buffer=new NetworkInterpolation();
    this.bike.group.visible=false;
    this.label=document.createElement('div');this.label.className='remote-name';this.label.textContent=player.name;this.label.style.color=player.color;this.label.hidden=true;game.ui.root.append(this.label);
    this.projected=new THREE.Vector3();this.euler=new THREE.Euler(0,0,0,'YXZ');
    this.pose={previousPosition:new THREE.Vector3(),position:new THREE.Vector3(),previousRotation:new THREE.Quaternion(),rotation:new THREE.Quaternion(),config:{wheelRadius:.36},wheels:[{},{}]};
  }
  receive(frame) {
    if(this.latest&&frame.resetVersion===this.latest.resetVersion&&frame.serverTime<this.latest.serverTime)return;
    this.latest=frame;
    this.disconnected=frame.disconnected||frame.dnf;
    const state=frame.state??{position:frame.position,rotation:new THREE.Quaternion().setFromEuler(new THREE.Euler(-frame.spawn.pitch,frame.spawn.yaw,0,'YXZ')).toArray(),speed:0,steer:0,pitch:frame.spawn.pitch,roll:0,throttle:0,suspension:[.60,.60],compression:[.05,.05]};
    this.buffer.push({...state,serverTime:frame.serverTime},frame.resetVersion);
  }
  update(now,dt) {
    const s=this.buffer.sample(now),p=this.pose;
    if(!s||this.disconnected){this.bike.group.visible=false;this.label.hidden=true;return;}
    this.bike.group.visible=true;
    p.position.fromArray(s.position);p.previousPosition.copy(p.position);p.rotation.fromArray(s.rotation);p.previousRotation.copy(p.rotation);
    p.yaw=this.euler.setFromQuaternion(p.rotation,'YXZ').y;p.grounded=s.grounded;p.slip=0;
    p.boostStrength=boostStrength(this.game.multiplayer.boostFor(this.player.id),now);
    this.label.classList.toggle('is-boosting',p.boostStrength>0);
    for(const key of ['speed','steer','pitch','roll','throttle'])p[key]=s[key];
    for(let i=0;i<2;i++)p.wheels[i]={length:s.suspension[i],compression:s.compression[i]};
    this.bike.update(p,1,dt);
  }
  updateLabel() {
    const p=this.pose;
    if(!this.bike.group.visible||this.game.spectator.current?.id===this.player.id){this.label.hidden=true;return;}
    this.projected.copy(p.position);this.projected.y+=1.75;this.projected.project(this.game.camera);
    const distance=this.game.camera.position.distanceTo(p.position);
    this.label.hidden=this.projected.z>1||this.projected.z<-1||distance>90||Math.abs(this.projected.x)>1||Math.abs(this.projected.y)>1;
    if(!this.label.hidden){this.label.style.left=`${(this.projected.x*.5+.5)*innerWidth}px`;this.label.style.top=`${(-this.projected.y*.5+.5)*innerHeight}px`;}
  }
  dispose(){this.bike.dispose();this.label.remove();}
}
