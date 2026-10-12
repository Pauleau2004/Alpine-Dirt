import * as THREE from 'three';
import {MOTORCYCLE_COLLISION_CONFIG as CONFIG,heading} from '../../shared/collisions.js';

export class CollisionDebug {
  constructor(scene) {
    this.scene=scene;this.meshes=new Map();
    this.geometry=new THREE.CapsuleGeometry(CONFIG.radius,Math.max(0.1,CONFIG.length-CONFIG.radius*2),4,8);
    this.geometry.rotateX(Math.PI/2);
    this.normal=new THREE.MeshBasicMaterial({color:0x57e3d6,wireframe:true,transparent:true,opacity:.6});
    this.contact=new THREE.MeshBasicMaterial({color:0xff8658,wireframe:true,transparent:true,opacity:.8});
  }
  update(clientOrPoses,visible,activeIds=[]) {
    const poses=clientOrPoses instanceof Map?clientOrPoses:new Map([[clientOrPoses.playerId,clientOrPoses.game.physics]]);
    const active=clientOrPoses instanceof Map?activeIds:(clientOrPoses.race?.collisions?.activePlayers??[]);
    if(!(clientOrPoses instanceof Map)) {
      for(const [id,r] of clientOrPoses.remotes)if(!r.disconnected&&r.bike.group.visible)poses.set(id,r.pose);
    }
    for(const [id,m] of this.meshes)if(!poses.has(id)){this.scene.remove(m);this.meshes.delete(id);}
    for(const [id,p] of poses) {
      let m=this.meshes.get(id);
      if(!m){
        m=new THREE.Mesh(this.geometry,this.normal);
        m.scale.y=CONFIG.verticalTolerance/(2*CONFIG.radius);
        this.scene.add(m);this.meshes.set(id,m);
      }
      m.visible=visible;
      m.position.copy(p.position);
      const rot=p.rotation.toArray?p.rotation.toArray():p.rotation;
      const f=heading(rot);
      m.rotation.y=Math.atan2(f.x,f.z);
      m.material=active.includes(id)?this.contact:this.normal;
    }
  }
  static formatText(last) {
    if(!last)return 'CONTACTS · Prêt';
    return `CONTACT TYPE: ${last.kind.toUpperCase()} (${last.contactLevel})\nRELATIVE SPEED: ${last.relativeSpeed.toFixed(1)} m/s\nANGLE: ${last.angleDeg}°\nIMPACT: ${last.intensity.toFixed(2)}\nPERSISTENT: ${last.persistent ? 'OUI' : 'NON'}\nPÉNÉTRATION: ${Math.max(0,last.depth).toFixed(3)} m`;
  }
  dispose(){for(const m of this.meshes.values())this.scene.remove(m);this.meshes.clear();this.geometry.dispose();this.normal.dispose();this.contact.dispose();}
}
