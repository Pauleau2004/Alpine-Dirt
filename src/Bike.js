import * as THREE from 'three';
import { damp } from './math.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function batchStatic(parent,exclude=new Set()) {
  const batches=new Map();
  for(const child of [...parent.children])if(child.isMesh&&!exclude.has(child)) {
    child.updateMatrix();let geometry=child.geometry.clone().applyMatrix4(child.matrix);
    if(geometry.index){const expanded=geometry.toNonIndexed();geometry.dispose();geometry=expanded;}
    if(!batches.has(child.material))batches.set(child.material,[]);batches.get(child.material).push(geometry);
    parent.remove(child);child.geometry.dispose();
  }
  for(const [material,parts] of batches){parent.add(new THREE.Mesh(mergeGeometries(parts),material));parts.forEach(g=>g.dispose());}
}

function rod(parent,a,b,radius,material) {
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,1,7),material);
  parent.add(mesh);alignRod(mesh,a,b);return mesh;
}
function alignRod(mesh,a,b) {
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.scale.y=a.distanceTo(b);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());
}
export class Bike {
  constructor(scene,{color=0xd7f36d,remote=false}={}) {
    this.group=new THREE.Group();scene.add(this.group);this.spin=0;
    const mat=(color)=>new THREE.MeshStandardMaterial({color,roughness:.73,flatShading:true});
    const green=mat(color),dark=mat(0x17272c),black=mat(0x252c2b),metal=mat(0xaabbb7),white=mat(0xf6f3df),orange=mat(0xe6753f);this.paint=green;
    const box=(w,h,d,m,x,y,z,parent=this.group)=>{
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);mesh.position.set(x,y,z);parent.add(mesh);return mesh;
    };
    box(.28,.28,.35,metal,0,-.08,-.1); // engine
    box(.26,.12,.84,dark,0,.34,-.13); // seat
    box(.43,.29,.40,green,0,.17,.27).rotation.x=-.2;
    box(.34,.12,.52,green,0,.30,-.66).rotation.x=.10;
    box(.22,.09,.60,green,0,.13,.80).rotation.x=-.1;
    box(.32,.35,.07,white,0,.33,.61).rotation.x=-.24;
    box(.34,.25,.42,white,0,.05,-.46);
    for(const x of [-.13,.13]) {
      rod(this.group,new THREE.Vector3(x,-.3,-.1),new THREE.Vector3(x,.3,.48),.035,orange);
      rod(this.group,new THREE.Vector3(x,-.3,-.1),new THREE.Vector3(x,.27,-.55),.035,orange);
      rod(this.group,new THREE.Vector3(x,.27,-.55),new THREE.Vector3(x,.3,.48),.026,orange);
    }
    rod(this.group,new THREE.Vector3(.18,-.1,.15),new THREE.Vector3(.20,.24,-.65),.055,metal);
    this.steering=new THREE.Group();this.steering.position.set(0,.49,.48);this.group.add(this.steering);
    rod(this.steering,new THREE.Vector3(-.46,0,0),new THREE.Vector3(.46,0,0),.027,metal);
    box(.19,.065,.08,dark,-.42,0,0,this.steering);box(.19,.065,.08,dark,.42,0,0,this.steering);
    this.wheels=[.85,-.85].map((z)=>{
      const pivot=new THREE.Group();pivot.position.set(0,-.48,z);this.group.add(pivot);
      const spin=new THREE.Group();pivot.add(spin);
      const tire=new THREE.Mesh(new THREE.TorusGeometry(.286,.079,6,20),black);tire.rotation.y=Math.PI/2;spin.add(tire);
      const rim=new THREE.Mesh(new THREE.TorusGeometry(.216,.019,5,16),metal);rim.rotation.y=Math.PI/2;spin.add(rim);
      for(let i=0;i<8;i++) {const a=i*Math.PI/4;rod(spin,new THREE.Vector3(0,0,0),new THREE.Vector3(0,Math.sin(a)*.21,Math.cos(a)*.21),.008,metal);}
      for(let i=0;i<14;i++) {const a=i*Math.PI/7;const tread=box(.17,.035,.06,black,0,Math.sin(a)*.358,Math.cos(a)*.358,spin);tread.rotation.x=-a;}
      return {pivot,spin};
    });
    this.forks=[-.13,.13].map(x=>rod(this.group,new THREE.Vector3(x,.42,.5),new THREE.Vector3(x,-.48,.85),.029,metal));
    this.swingarms=[-.16,.16].map(x=>rod(this.group,new THREE.Vector3(x,-.2,-.15),new THREE.Vector3(x,-.48,-.85),.035,metal));
    this.shock=rod(this.group,new THREE.Vector3(0,.23,-.36),new THREE.Vector3(0,-.35,-.63),.048,orange);
    this.rider=new THREE.Group();this.group.add(this.rider);
    box(.34,.42,.23,dark,0,.67,-.16,this.rider).rotation.x=.3;
    box(.35,.12,.23,green,0,.86,-.07,this.rider).rotation.x=.3;
    const helmet=new THREE.Mesh(new THREE.IcosahedronGeometry(.205,1),white);helmet.position.set(0,1.03,.03);this.rider.add(helmet);
    box(.32,.10,.13,dark,0,1.04,.19,this.rider);
    box(.36,.035,.26,green,0,1.15,.15,this.rider);
    for(const x of [-1,1]) {
      rod(this.rider,new THREE.Vector3(x*.16,.8,-.04),new THREE.Vector3(x*.3,.64,.15),.062,dark);
      rod(this.rider,new THREE.Vector3(x*.3,.64,.15),new THREE.Vector3(x*.4,.50,.47),.049,dark);
      rod(this.rider,new THREE.Vector3(x*.12,.47,-.28),new THREE.Vector3(x*.22,.17,.05),.080,dark);
      rod(this.rider,new THREE.Vector3(x*.22,.17,.05),new THREE.Vector3(x*.20,-.21,-.14),.063,white);
      box(.15,.12,.25,white,x*.21,-.24,-.10,this.rider);
    }
    if(remote){
      for(const wheel of this.wheels)batchStatic(wheel.spin);
      batchStatic(this.rider);batchStatic(this.steering);
      batchStatic(this.group,new Set([...this.forks,...this.swingarms,this.shock]));
    }
    this.group.traverse(o=>{if(o.isMesh){o.castShadow=!remote;o.receiveShadow=!remote;}});
  }
  setColor(color){this.paint.color.set(color);}
  dispose(){const geometries=new Set(),materials=new Set();this.group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());this.group.removeFromParent();}
  update(physics,alpha,dt) {
    this.group.position.lerpVectors(physics.previousPosition,physics.position,alpha);
    this.group.quaternion.slerpQuaternions(physics.previousRotation,physics.rotation,alpha);
    this.spin+=physics.speed*dt/physics.config.wheelRadius;
    this.steering.rotation.y=physics.steer;
    for(let i=0;i<2;i++) {
      const w=this.wheels[i],physical=physics.wheels[i];
      w.pivot.position.y=damp(w.pivot.position.y,(.12-physical.length)/Math.cos(physics.roll),25,dt);
      w.pivot.rotation.y=i===0?physics.steer:0;w.spin.rotation.x=this.spin;
    }
    this.forks.forEach((m,i)=>alignRod(m,new THREE.Vector3(i? .13:-.13,.42,.5),new THREE.Vector3(i?.13:-.13,this.wheels[0].pivot.position.y,.85)));
    this.swingarms.forEach((m,i)=>alignRod(m,new THREE.Vector3(i?.16:-.16,-.2,-.15),new THREE.Vector3(i?.16:-.16,this.wheels[1].pivot.position.y,-.85)));
    alignRod(this.shock,new THREE.Vector3(0,.23,-.36),new THREE.Vector3(0,this.wheels[1].pivot.position.y*.7,-.63));
    const compression=(physics.wheels[0].compression+physics.wheels[1].compression)*.5;
    this.rider.position.y=damp(this.rider.position.y,-compression*.55,12,dt);
    this.rider.rotation.x=damp(this.rider.rotation.x,-physics.pitch*.20+physics.throttle*.04,6,dt);
  }
}
