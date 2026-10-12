import * as THREE from 'three';
import { clamp, damp, wrapAngle } from './math.js';
import { LAST_PLACE_BOOST_CONFIG } from '../shared/lastPlaceBoost.js';

// Stable hybrid: Rapier integrates the chassis translation and terrain collisions.
// Two load-bearing ray springs feed forces into that body. Pitch is integrated
// from their moments; yaw and balance use an assisted single-track tire model.
export const BIKE_CONFIG = Object.freeze({
  mass: 150, wheelbase: 1.7, wheelRadius: 0.36,
  stiffness: 17000, damping: 1550, suspensionTravel: 0.38,
  restLength: 0.65, wheelGrip: 1.15, engineForce: 1420,
  brakeForce: 2300, pitchInertia: 115, maxSpeed: 32,
});
export class BikePhysics {
  constructor(RAPIER, world, config = {}) {
    this.RAPIER=RAPIER; this.world=world; this.config={...BIKE_CONFIG,...config};
    this.body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setCcdEnabled(true).lockRotations().setLinearDamping(0.015));
    this.collider=world.createCollider(RAPIER.ColliderDesc.roundCuboid(0.18,0.12,0.44,0.06).setTranslation(0,0.06,0).setMass(this.config.mass).setFriction(0.04).setRestitution(0.02),this.body);
    this.position=new THREE.Vector3(); this.previousPosition=new THREE.Vector3();
    this.rotation=new THREE.Quaternion(); this.previousRotation=new THREE.Quaternion();
    this.wheels=[this.config.wheelbase/2,-this.config.wheelbase/2].map(z=>({z,compression:0,length:this.config.restLength,grounded:false,load:0,point:new THREE.Vector3(),normal:new THREE.Vector3(0,1,0)}));
    this.yaw=0;this.pitch=0;this.roll=0;this.pitchRate=0;this.yawRate=0;this.rollRate=0;
    this.steer=0;this.throttle=0;this.speed=0;this.slip=0;this.grip=1;this.airTime=0;this.landing=0;
    this.boostStrength=0;
    this.scratch={forward:new THREE.Vector3(),right:new THREE.Vector3(),normal:new THREE.Vector3(),force:new THREE.Vector3(),point:new THREE.Vector3(),q:new THREE.Quaternion(),e:new THREE.Euler(0,0,0,'YXZ')};
  }
  reset(spawn) {
    this.boostStrength=0;
    this.yaw=spawn.yaw;this.pitch=spawn.pitch||0;this.roll=0;
    this.pitchRate=this.yawRate=this.rollRate=this.speed=this.slip=this.steer=this.throttle=this.airTime=this.landing=0;this.grip=1;
    this.position.copy(spawn.position);this.position.y+=0.96;
    this.previousPosition.copy(this.position);this.updateRotation();this.previousRotation.copy(this.rotation);
    this.body.setTranslation(this.position,true);this.body.setRotation(this.rotation,true);
    this.body.setLinvel({x:0,y:0,z:0},true);this.body.setAngvel({x:0,y:0,z:0},true);
    this.body.resetForces(true);this.body.resetTorques(true);
    for(const wheel of this.wheels) {wheel.compression=0;wheel.length=this.config.restLength;wheel.grounded=false;wheel.load=0;}
    this.world.propagateModifiedBodyPositionsToColliders();
  }
  updateRotation() {
    // Positive pitch raises the nose. Positive yaw/roll turn toward world +X
    // (rider-left when forward is +Z); InputManager maps D to negative steering.
    this.rotation.setFromEuler(this.scratch.e.set(-this.pitch,this.yaw,-this.roll,'YXZ'));
  }
  beforeStep(dt,input,sensitivity=1,onTrack=true,boost=0) {
    this.boostStrength=clamp(boost,0,1);
    const c=this.config,s=this.scratch;
    this.previousPosition.copy(this.position);this.previousRotation.copy(this.rotation);
    const p=this.body.translation(),v=this.body.linvel();
    const sin=Math.sin(this.yaw),cos=Math.cos(this.yaw);
    s.forward.set(sin,0,cos);s.right.set(cos,0,-sin);
    this.speed=v.x*sin+v.z*cos;
    const lateral=v.x*cos-v.z*sin, absSpeed=Math.abs(this.speed);
    this.throttle=damp(this.throttle,input.throttle*(1-input.brake),input.throttle?2.8:6,dt);
    const maxSteer=0.50/(1+(absSpeed/10)**1.25)+0.025;
    this.steer=damp(this.steer,input.steer*maxSteer*sensitivity,7.0/(1+absSpeed/35),dt);
    this.body.resetForces(true);this.body.resetTorques(true);
    let pitchMoment=0,contacts=0,totalLoad=0;
    const wasGrounded=this.grounded;
    // Ray axes exclude cosmetic lean: the balance assistance doesn't jack the bike up.
    for(const w of this.wheels) {
      const horizontal=w.z*Math.cos(this.pitch);
      const origin={x:p.x+sin*horizontal,y:p.y+0.12+w.z*Math.sin(this.pitch),z:p.z+cos*horizontal};
      const ray=new this.RAPIER.Ray(origin,{x:0,y:-1,z:0});
      const hit=this.world.castRayAndGetNormal(ray,c.restLength+c.wheelRadius,true,undefined,undefined,this.collider,this.body);
      w.grounded=!!hit && hit.normal.y>0.22;
      w.load=0;
      if(w.grounded) {
        contacts++;
        w.length=clamp(hit.timeOfImpact-c.wheelRadius,c.restLength-c.suspensionTravel,c.restLength);
        w.compression=c.restLength-w.length;
        w.point.set(origin.x,origin.y-hit.timeOfImpact,origin.z);
        w.normal.set(hit.normal.x,hit.normal.y,hit.normal.z).normalize();
        const pointVerticalSpeed=v.y+w.z*Math.cos(this.pitch)*this.pitchRate;
        const surfaceApproach=v.x*w.normal.x+pointVerticalSpeed*w.normal.y+v.z*w.normal.z;
        // Compression damping, softer rebound, and a progressive end-stop.
        const damping=surfaceApproach<0?c.damping:c.damping*0.72;
        const bumpStop=140000*Math.max(0,w.compression-c.suspensionTravel*0.78)**2;
        w.load=clamp(c.stiffness*w.compression-damping*surfaceApproach+bumpStop,0,c.mass*9.81*4);
        totalLoad+=w.load;
        s.force.copy(w.normal).multiplyScalar(w.load);
        this.body.addForceAtPoint(s.force,w.point,true);
        pitchMoment+=w.z*w.load*w.normal.y;
      } else { w.compression=0;w.length=damp(w.length,c.restLength,18,dt); }
    }
    this.grounded=contacts>0;
    this.airTime=this.grounded?0:this.airTime+dt;
    this.landing=Math.max(0,this.landing-dt*2.5);
    if(this.grounded&&!wasGrounded&&v.y<-2) {
      this.landing=clamp((-v.y-2)/9,0,1);
      const impactPenalty=clamp(Math.abs(this.pitch)*0.12+Math.abs(this.roll)*0.08,0,0.16);
      this.body.applyImpulse({x:-v.x*c.mass*impactPenalty,y:0,z:-v.z*c.mass*impactPenalty},true);
    }
    if(this.grounded) {
      const demand=absSpeed*absSpeed*Math.abs(Math.tan(this.steer))/c.wheelbase;
      const available=9.81*c.wheelGrip*(onTrack?1:0.66);
      const gripTarget=1/(1+0.15*(demand/available)**2);
      this.grip=damp(this.grip,clamp(gripTarget,0.34,1),gripTarget<this.grip?3:1.7,dt);
      const yawTarget=this.speed*Math.tan(this.steer)/c.wheelbase*this.grip;
      this.yawRate=damp(this.yawRate,clamp(yawTarget,-1.45,1.45),4.5,dt);
      // A saturating lateral tire response gives gradual dirt slip and recovery.
      const maxLateral=Math.min(totalLoad,c.mass*9.81*1.5)*c.wheelGrip*(onTrack?1:0.65);
      const lateralForce=-maxLateral*Math.tanh(lateral*c.mass*7.5/Math.max(1,maxLateral));
      s.force.copy(s.right).multiplyScalar(lateralForce);
      this.body.addForce(s.force,true);
      const rear=this.wheels[1];
      const traction=Math.min(rear.load*c.wheelGrip,c.engineForce);
      const boostConfig=LAST_PLACE_BOOST_CONFIG,b=this.boostStrength;
      const speedRange=clamp(absSpeed/c.maxSpeed,0,1);
      // Blend torque/power gains instead of multiplying them twice. The rear
      // tire's actual normal load still limits all engine force during a boost.
      const gain=1+b*((boostConfig.torqueMultiplier-1)*(1-speedRange)+(boostConfig.accelerationMultiplier-1)*speedRange);
      const torqueCurve=1/(1+(absSpeed/(21*(1+b*(boostConfig.maxSpeedMultiplier-1))))**1.8);
      const drive=rear.grounded?Math.min(rear.load*c.wheelGrip,this.throttle*traction*torqueCurve*gain):0;
      const brake=Math.min(absSpeed*c.mass/dt, c.brakeForce*input.brake);
      const rolling=absSpeed>0.03?Math.sign(this.speed)*(onTrack?48:145):0;
      const longitudinal=drive-Math.sign(this.speed)*brake-rolling;
      s.normal.set(0,0,0);for(const w of this.wheels) if(w.grounded) s.normal.add(w.normal);
      s.normal.normalize();s.forward.addScaledVector(s.normal,-s.forward.dot(s.normal)).normalize();
      s.force.copy(s.forward).multiplyScalar(longitudinal);
      this.body.addForceAtPoint(s.force,{x:p.x,y:p.y-0.42,z:p.z},true);
      pitchMoment+=longitudinal*0.38;
      this.pitchRate+=(pitchMoment/c.pitchInertia-this.pitchRate*3.8)*dt;
      // Idle balance and a limited roll spring replace a rider's active balancing.
      const rollTarget=clamp(Math.atan(this.speed*this.yawRate/9.81)*0.73,-0.70,0.70);
      this.rollRate+=((rollTarget-this.roll)*34-this.rollRate*9)*dt;
    } else {
      this.yawRate=damp(this.yawRate,0,1.6,dt);
      this.pitchRate+=((input.brake-input.throttle)*1.45-this.pitchRate*0.85-this.pitch*0.45)*dt;
      this.rollRate+=(input.steer*0.8-this.rollRate*2.3-this.roll*1.2)*dt;
    }
    this.slip=damp(this.slip,clamp(Math.abs(lateral)/6+(1-this.grip)*0.6,0,1),5,dt);
    this.yaw=wrapAngle(this.yaw+this.yawRate*dt);
    this.pitchRate=clamp(this.pitchRate,-2.8,2.8);
    this.pitch=clamp(this.pitch+this.pitchRate*dt,-0.88,0.88);
    if(Math.abs(this.pitch)>=0.88) this.pitchRate*=0.92;
    this.roll=clamp(this.roll+this.rollRate*dt,-0.95,0.95);
    // Quadratic air drag caps the motor naturally, including downhill coasting.
    this.body.addForce({x:-v.x*absSpeed*0.43,y:0,z:-v.z*absSpeed*0.43},true);
    this.updateRotation();this.body.setRotation(this.rotation,true);
  }
  afterStep() { this.position.copy(this.body.translation()); }
  getState() {
    const v=this.body.linvel();
    return {position:this.position.toArray(),velocity:[v.x,v.y,v.z],speed:this.speed,steer:this.steer,yaw:this.yaw,pitch:this.pitch,roll:this.roll,grip:this.grip,slip:this.slip,airTime:this.airTime,grounded:this.grounded,wheels:this.wheels.map(w=>({grounded:w.grounded,compression:w.compression,load:w.load}))};
  }
}
