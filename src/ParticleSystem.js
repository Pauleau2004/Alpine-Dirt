import * as THREE from 'three';
import { clamp,seededRandom } from './math.js';
export class ParticleSystem {
  constructor(scene,count=220) {
    this.count=count;this.cursor=0;this.carry=0;this.random=seededRandom(45);
    this.positions=new Float32Array(count*3);this.velocities=new Float32Array(count*3);this.life=new Float32Array(count);this.maxLife=new Float32Array(count);this.sizes=new Float32Array(count);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('life',new THREE.BufferAttribute(this.life,1).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('size',new THREE.BufferAttribute(this.sizes,1).setUsage(THREE.DynamicDrawUsage));
    const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{color:{value:new THREE.Color(0xbba37d)},pixelScale:{value:1}},vertexShader:`attribute float life;attribute float size;varying float alpha;uniform float pixelScale;void main(){vec4 p=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*p;gl_PointSize=clamp(size*pixelScale*420.0/max(1.0,-p.z),0.0,90.0);alpha=clamp(life,0.0,1.0)*0.24;}`,fragmentShader:`uniform vec3 color;varying float alpha;void main(){float d=length(gl_PointCoord-0.5)*2.0;if(d>1.0)discard;gl_FragColor=vec4(color,alpha*pow(1.0-d,1.4));\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`});
    this.mesh=new THREE.Points(geometry,material);this.mesh.frustumCulled=false;scene.add(this.mesh);
  }
  clear(){this.life.fill(0);this.mesh.geometry.attributes.life.needsUpdate=true;this.carry=0;}
  update(dt,bike,onDirt) {
    for(let i=0;i<this.count;i++)if(this.life[i]>0){
      this.life[i]=Math.max(0,this.life[i]-dt);const k=i*3;
      this.positions[k]+=this.velocities[k]*dt;this.positions[k+1]+=this.velocities[k+1]*dt;this.positions[k+2]+=this.velocities[k+2]*dt;
      this.velocities[k]*=1-dt*.9;this.velocities[k+2]*=1-dt*.9;this.sizes[i]+=dt*.55;
    }
    const speed=Math.abs(bike.speed),rear=bike.wheels[1];
    if(rear.grounded&&onDirt&&speed>1.5){
      this.carry+=dt*clamp((speed*1.5+bike.throttle*14+bike.slip*40)*(1+(bike.boostStrength??0)*.22),0,85);
      while(this.carry>=1){
        this.carry--;const i=this.cursor++%this.count,k=i*3,r=this.random;
        this.positions[k]=rear.point.x+(r()-.5)*.22;this.positions[k+1]=rear.point.y+.15;this.positions[k+2]=rear.point.z+(r()-.5)*.22;
        this.velocities[k]=-Math.sin(bike.yaw)*(1+speed*.06)+(r()-.5)*1.6;
        this.velocities[k+1]=.5+r()*.8;
        this.velocities[k+2]=-Math.cos(bike.yaw)*(1+speed*.06)+(r()-.5)*1.6;
        this.life[i]=.6+r()*.8;this.sizes[i]=.12+r()*.19;
      }
    }
    for(const name of ['position','life','size'])this.mesh.geometry.attributes[name].needsUpdate=true;
  }
  emitContact(point,normal,intensity=0.3){
    if(!point)return;
    const num=Math.min(6,Math.max(2,Math.round(intensity*8)));
    for(let n=0;n<num;n++){
      const i=this.cursor++%this.count,k=i*3,r=this.random;
      this.positions[k]=point[0]+(r()-.5)*.25;
      this.positions[k+1]=point[1]+(r()-.5)*.20;
      this.positions[k+2]=point[2]+(r()-.5)*.25;
      this.velocities[k]=(normal?normal[0]*1.2:0)+(r()-.5)*1.8;
      this.velocities[k+1]=.6+r()*1.0;
      this.velocities[k+2]=(normal?normal[2]*1.2:0)+(r()-.5)*1.8;
      this.life[i]=.35+r()*.35;
      this.sizes[i]=.12+r()*.15;
    }
    for(const name of ['position','life','size'])this.mesh.geometry.attributes[name].needsUpdate=true;
  }
}
