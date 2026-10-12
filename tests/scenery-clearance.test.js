import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Scenery} from '../src/Scenery.js';
import {createTrack} from '../src/tracks/createTrack.js';
import {MAPS} from '../shared/maps.js';

globalThis.document={createElement:()=>({getContext:()=>({fillRect(){},fillText(){}})})};
const matrix=new THREE.Matrix4(),point=new THREE.Vector3(),centre=new THREE.Vector3();
function footprint(mesh,index) {
  mesh.getMatrixAt(index,matrix);centre.setFromMatrixPosition(matrix);
  let radius=0,minY=Infinity,maxY=-Infinity;
  const vertices=mesh.geometry.attributes.position;
  for(let v=0;v<vertices.count;v++){
    point.fromBufferAttribute(vertices,v).applyMatrix4(matrix);
    radius=Math.max(radius,Math.hypot(point.x-centre.x,point.z-centre.z));
    minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);
  }
  return {x:centre.x,z:centre.z,radius,minY,maxY};
}
for(const map of MAPS)test(`${map.title}: decorative geometry and signboards leave the entire racing lane clear`,()=>{
  const track=createTrack(map.id),scene=new THREE.Scene(),scenery=new Scenery(scene,track);
  scene.updateMatrixWorld(true);
  const margins={'scenery-mountains':30,'scenery-tree-lower':6,'scenery-tree-upper':6,'scenery-trunks':6,'scenery-rocks':4};
  for(const [name,margin] of Object.entries(margins)){
    const mesh=scenery.group.getObjectByName(name);assert.ok(mesh);
    for(let i=0;i<mesh.count;i++){
      const f=footprint(mesh,i),near=track.nearest(f.x,f.z),half=(track.widthAt?.(near.u)??track.width)/2;
      assert.ok(near.distance-half-f.radius>=margin-.001,`${name} ${i} at u=${near.u}: its full footprint must clear the road by ${margin} m`);
    }
  }
  // Real post geometry is checked against the nearest branch at its height,
  // including crossing tracks; flat paint and overhead start banners are exempt.
  for(const name of ['track-edge-posts','track-edge-caps','checkpoint-frames','checkpoint-feet']){
    const mesh=scenery.group.getObjectByName(name);
    for(let i=0;i<mesh.count;i++){
      const f=footprint(mesh,i);if(f.maxY< -100)continue;
      const near=track.nearest(f.x,f.z,(f.minY+f.maxY)/2);
      if(f.maxY<near.height||f.minY>near.height+4)continue;
      const half=(track.widthAt?.(near.u)??track.width)/2;
      assert.ok(near.distance-half-f.radius>0,`${name} ${i} encroaches on the lane at u=${near.u}`);
    }
  }
  for(const group of scenery.group.children.filter(g=>g.name==='corner-chevron'||g.userData.checkpointIndex>0)){
    for(const mesh of group.children.filter(m=>m.geometry?.type==='PlaneGeometry')){
      // Check the actual corners of each sign, not just the supporting pole.
      const vertices=mesh.geometry.attributes.position;
      for(let i=0;i<vertices.count;i++){
        point.fromBufferAttribute(vertices,i).applyMatrix4(mesh.matrixWorld);
        const near=track.nearest(point.x,point.z,point.y);
        if(point.y>near.height+4||point.y<near.height)continue;
        const half=(track.widthAt?.(near.u)??track.width)/2;
        assert.ok(near.distance>half+.4,`${group.name} sign overhangs the road at u=${near.u}`);
      }
    }
  }
  scene.traverse(o=>{o.geometry?.dispose();if(o.material){o.material.map?.dispose();o.material.dispose();}if(o.isInstancedMesh)o.dispose();});
});
