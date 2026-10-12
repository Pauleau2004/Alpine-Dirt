import * as THREE from 'three';
import { clamp,damp,wrapAngle } from './math.js';
export class CameraController {
  constructor(camera,track) {
    this.camera=camera;this.track=track;this.yaw=0;this.target=new THREE.Vector3();
    this.desired=new THREE.Vector3();this.look=new THREE.Vector3();this.ready=false;
    this.shake=0;
  }
  applyCollisionShake(intensity=0.2) {
    this.shake=Math.min(0.06,this.shake+intensity*0.035);
  }
  snap() {this.ready=false;this.camera.up.set(0,1,0);}
  update(dt,bike,physics,cameraMode='close') {
    const wide=cameraMode==='wide'||cameraMode===true;
    const firstPerson=cameraMode==='firstPerson';
    if(bike?.rider)bike.rider.visible=!firstPerson;
    const speed=Math.abs(physics.speed),factor=clamp(speed/30,0,1);

    if(firstPerson) {
      const q=bike.group.quaternion;
      const headOffset=new THREE.Vector3(0,1.10,.22).applyQuaternion(q);
      this.desired.copy(bike.group.position).add(headOffset);

      const forward=new THREE.Vector3(0,0,1).applyQuaternion(q);
      const right=new THREE.Vector3(1,0,0).applyQuaternion(q);
      const up=new THREE.Vector3(0,1,0).applyQuaternion(q);

      const camUp=new THREE.Vector3(0,1,0).lerp(up,.40).normalize();
      this.camera.up.copy(camUp);

      const lookDist=14+factor*8;
      this.look.copy(this.desired).addScaledVector(forward,lookDist).addScaledVector(right,-physics.steer*2.2);

      if(!this.ready){this.camera.position.copy(this.desired);this.target.copy(this.look);this.ready=true;}
      this.camera.position.lerp(this.desired,1-Math.exp(-24*dt));
      this.target.lerp(this.look,1-Math.exp(-18*dt));this.camera.lookAt(this.target);

      const targetFov=72+factor*14+(physics.boostStrength??0)*3;
      const fov=damp(this.camera.fov,targetFov,2.5,dt);
      if(Math.abs(fov-this.camera.fov)>.005){this.camera.fov=fov;this.camera.updateProjectionMatrix();}
      return;
    }

    this.camera.up.set(0,1,0);
    this.yaw+=wrapAngle(physics.yaw-this.yaw)*(this.ready?1-Math.exp(-4.8*dt):1);
    const sin=Math.sin(this.yaw),cos=Math.cos(this.yaw),distance=(wide?9.5:6.1)+factor*1.7;
    const p=bike.group.position;
    this.desired.set(p.x-sin*distance,p.y+(wide?4.8:2.8)+factor*.4,p.z-cos*distance);
    const near=this.track.nearest(this.desired.x,this.desired.z,this.track.altitudeAware?p.y:undefined);
    this.desired.y=Math.max(this.desired.y,this.track.terrainHeight(this.desired.x,this.desired.z,near)+1.1,near.distance<7?near.height+1.1:-100);
    this.look.set(p.x+sin*(3.6+factor*2)+cos*physics.steer*2,p.y+.65,p.z+cos*(3.6+factor*2)-sin*physics.steer*2);
    if(!this.ready){this.camera.position.copy(this.desired);this.target.copy(this.look);this.ready=true;}
    this.camera.position.lerp(this.desired,1-Math.exp(-5*dt));
    this.target.lerp(this.look,1-Math.exp(-7*dt));this.camera.lookAt(this.target);
    const fov=damp(this.camera.fov,60+factor*12+(physics.boostStrength??0)*2,2.5,dt);
    if(Math.abs(fov-this.camera.fov)>.005){this.camera.fov=fov;this.camera.updateProjectionMatrix();}
    if(this.shake>0.001){
      this.camera.position.x+=(Math.random()-.5)*this.shake;
      this.camera.position.y+=(Math.random()-.5)*this.shake*.6;
      this.shake=Math.max(0,this.shake-dt*0.4);
    }
  }
  menu(time) {
    this.camera.up.set(0,1,0);
    const p=this.track.at(.02).position;
    this.camera.position.set(p.x-19+Math.sin(time*.06)*3,p.y+10,p.z-16);
    this.camera.lookAt(p.x+8,p.y+.3,p.z+11);
    this.camera.fov=59;this.camera.updateProjectionMatrix();this.ready=false;
  }
}
