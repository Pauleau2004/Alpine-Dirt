import * as THREE from 'three';
import { seededRandom } from './math.js';
import { LapCheckpointSystem } from './LapCheckpointSystem.js';

export class Scenery {
  constructor(scene,track) {
    this.group=new THREE.Group();scene.add(this.group);
    this.track=track;this.random=seededRandom(2026);this.dummy=new THREE.Object3D();
    // Use the widest lane, including jump receptions, and the full footprint
    // of each object. A centre-only check lets broad peaks cover the road.
    this.maxHalfWidth=Math.max(...track.samples.map((_,i)=>(track.widthAt?.(i/track.count)??track.width)/2));
    const random=this.random;
    const mat=(color)=>new THREE.MeshStandardMaterial({color,flatShading:true,roughness:1});

    // Repeated scenery stays in a small number of GPU draw calls.
    const treeCount=330;
    const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.14,.22,1.7,5),mat(0x71604a),treeCount);
    const lower=new THREE.InstancedMesh(new THREE.ConeGeometry(1.4,3.6,7),mat(0x3e694a),treeCount);
    const upper=new THREE.InstancedMesh(new THREE.ConeGeometry(1.05,2.9,7),mat(0x507b4b),treeCount);
    this.trees=[trunks,lower,upper];
    trunks.name='scenery-trunks';lower.name='scenery-tree-lower';upper.name='scenery-tree-upper';
    let i=0;
    while(i<treeCount) {
      const x=(random()-.5)*370,z=(random()-.5)*370,near=track.nearest(x,z);
      if(near.distance<10||Math.hypot(x+13,z+18)<18||track.sceneryAllowed?.(x,z)===false)continue;
      const y=track.terrainHeight(x,z,near),scale=(.8+random()*1.1)*(track.treeScale??1),rotation=random()*Math.PI*2;
      if(near.distance<this.maxHalfWidth+1.4*scale+6)continue;
      this.instance(trunks,i,x,y+.8*scale,z,scale,scale,scale,rotation);
      this.instance(lower,i,x,y+2.7*scale,z,scale,scale,scale,rotation);
      this.instance(upper,i,x,y+4.1*scale,z,scale,scale,scale,rotation+.4);
      const color=new THREE.Color().setHSL(.27+random()*.045,.25+random()*.12,.28+random()*.06);
      lower.setColorAt(i,color);upper.setColorAt(i,color.clone().multiplyScalar(1.13));i++;
    }
    this.trees.forEach(m=>{m.castShadow=true;m.receiveShadow=true;this.group.add(m);});
    const rocks=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),mat(0x969e89),72);
    rocks.name='scenery-rocks';
    for(let i=0;i<72;i++){
      const s=.35+random()*1.8;
      let x,z,near;do{x=(random()-.5)*315;z=(random()-.5)*315;near=track.nearest(x,z);}while(near.distance<this.maxHalfWidth+s*1.3+4||track.sceneryAllowed?.(x,z)===false);
      this.instance(rocks,i,x,track.terrainHeight(x,z,near)+s*.23,z,s*1.3,s*.75,s,random()*6.28);
    }
    rocks.castShadow=true;rocks.receiveShadow=true;this.group.add(rocks);
    // A ring of broad, faceted peaks frames the playable valley.
    const peaks=new THREE.InstancedMesh(new THREE.ConeGeometry(1,1,7,2),mat(0x78938a),34);
    const snow=new THREE.InstancedMesh(new THREE.ConeGeometry(1,1,7),mat(0xd8e2d7),12);
    peaks.name='scenery-mountains';snow.name='scenery-snow';
    for(let i=0;i<34;i++){
      const a=i/34*Math.PI*2;let r=255+random()*70,x=Math.sin(a)*r,z=Math.cos(a)*r;
      const h=40+random()*73,w=34+random()*32,rot=random()*6.28;
      // Keep the whole mountain base beyond the riding and chase-camera area.
      while(track.nearest(x,z).distance<this.maxHalfWidth+w+30){r+=12;x=Math.sin(a)*r;z=Math.cos(a)*r;}
      this.instance(peaks,i,x,h/2-9,z,w,h,w*.75,rot);
      peaks.setColorAt(i,new THREE.Color().setHSL(.36+random()*.1,.12,.47+random()*.13));
      if(i<12)this.instance(snow,i,x,h*.9-9+.12,z,w*.205,h*.2,w*.75*.205,rot);
    }
    this.group.add(peaks,snow);
    const clouds=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshBasicMaterial({color:0xecf3ed}),54);
    for(let i=0;i<18;i++){
      const x=(random()-.5)*570,z=(random()-.5)*570,y=72+random()*40;
      for(let j=0;j<3;j++)this.instance(clouds,i*3+j,x+j*8,y+random()*2,z,10+random()*8,2.8+random()*2,5+random()*4,random());
    }
    this.group.add(clouds);
    this.addTrackFurniture(mat);
  }
  instance(mesh,i,x,y,z,sx,sy,sz,ry=0) {
    const d=this.dummy;d.position.set(x,y,z);d.rotation.set(0,ry,0);d.scale.set(sx,sy,sz);d.updateMatrix();mesh.setMatrixAt(i,d.matrix);
  }
  addTrackFurniture(mat) {
    const track=this.track;
    const count=Math.floor(track.length/7),posts=new THREE.InstancedMesh(new THREE.BoxGeometry(.11,.75,.11),mat(0xe5ebcc),count*2),caps=new THREE.InstancedMesh(new THREE.BoxGeometry(.13,.18,.13),mat(0x4a653b),count*2);
    posts.name='track-edge-posts';caps.name='track-edge-caps';
    for(let i=0;i<count;i++)for(let side=0;side<2;side++){
      const p=track.at(i/count);
      if(track.isGap?.(p.u)){this.instance(posts,i*2+side,0,-999,0,0,0,0);this.instance(caps,i*2+side,0,-999,0,0,0,0);continue;}
      const sign=side?1:-1,edge=(track.widthAt?.(p.u)??track.width)/2+.7,x=p.position.x+Math.cos(p.yaw)*edge*sign,z=p.position.z-Math.sin(p.yaw)*edge*sign;
      const near=track.nearest(x,z);
      if(near&&near.distance<((track.widthAt?.(near.u)??track.width)/2+.15)){this.instance(posts,i*2+side,0,-999,0,0,0,0);this.instance(caps,i*2+side,0,-999,0,0,0,0);continue;}
      const surface=track.surfaceHeightAt?.(p.u,edge*sign)??p.position.y;
      this.instance(posts,i*2+side,x,surface+.28,z,1,1,1,p.yaw);
      this.instance(caps,i*2+side,x,surface+.61,z,1,1,1,p.yaw);
    }
    posts.castShadow=true;this.group.add(posts,caps);
    // Visual arches use the very same locations and orientations as validation.
    const timingGates=new LapCheckpointSystem(track).gates;
    const start=timingGates[0],gate=new THREE.Group();gate.position.copy(start.position);gate.rotation.y=start.yaw;this.group.add(gate);
    gate.name=`checkpoint-banner-${timingGates.length}`;gate.userData={checkpointIndex:0,number:timingGates.length,clearance:4.65};
    this.checkpointBanners=[gate];
    const box=(w,h,d,material,x,y,z,parent=gate)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
    if(track.id==='gaptrack') {
      // Checkerboard ends match the reference gantry; the timing plane is at u=0.
      for(const side of [-1,1])for(let x=0;x<3;x++)for(let y=0;y<2;y++) {
        box(.45,.4,.29,mat((x+y)%2?0x223c33:0xebeedc),side*(4.5+x*.45),4.85+y*.4,0);
      }
    }
    const dark=mat(0x223c33),light=mat(0xebeedc),lime=mat(0xcfe879);
    box(.24,5.4,.24,dark,-6.6,2.6,0);box(.24,5.4,.24,dark,6.6,2.6,0);
    box(13.5,.80,.26,dark,0,5.05,0);
    const label=this.textPlane(track.startLabel??`${(track.title??'Alpine Dirt').toUpperCase()} · ${timingGates.length} / ${timingGates.length}`,11,.68,'#d7ef7a','#223c33');label.position.set(0,5.05,-.143);label.rotation.y=Math.PI;gate.add(label);
    const back=label.clone();back.position.z=.143;back.rotation.y=0;gate.add(back);
    for(let x=0;x<12;x++)for(let z=0;z<2;z++)box(1,.025,.6,(x+z)%2?dark:light,x-5.5,.073,(z-.5)*.6);
    box(.40,1.1,.40,lime,-6.6,.5,0);box(.40,1.1,.40,lime,6.6,.5,0);
    if(track.id==='gaptrack')gate.scale.x=(track.width+1.2)/13.2;
    if(track.id==='canyon'||track.id==='terrerouge')gate.scale.x=((track.widthAt?.(0)??track.width)+1.2)/13.2;
    // Numbered checkpoint posts on each side of the track (no overhead crossbeam).
    // Frames (2 posts per gate), feet and ground lines share geometry and only three draw calls.
    const bannerCount=track.hideCheckpointFurniture?0:timingGates.length-1,unit=new THREE.BoxGeometry(1,1,1);
    const frames=new THREE.InstancedMesh(unit,dark,bannerCount*2);
    const feet=new THREE.InstancedMesh(unit,lime,bannerCount*2);
    const lines=new THREE.InstancedMesh(unit,lime,bannerCount);
    frames.name='checkpoint-frames';feet.name='checkpoint-feet';lines.name='checkpoint-lines';
    frames.castShadow=true;frames.receiveShadow=true;feet.castShadow=true;feet.receiveShadow=true;
    this.group.add(frames,feet,lines);
    const place=(mesh,index,at,x,y,z,w,h,d,pitch=0)=>{
      const c=Math.cos(at.yaw),s=Math.sin(at.yaw),dummy=this.dummy;
      dummy.position.set(at.position.x+c*x+s*z,at.position.y+y,at.position.z-s*x+c*z);
      dummy.rotation.set(pitch,at.yaw,0,'YXZ');dummy.scale.set(w,h,d);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);
    };
    const postHeight=2.5,footHeight=0.9;
    for(let i=1;i<=bannerCount;i++) {
      const at=timingGates[i],index=i-1,banner=new THREE.Group();
      const laneWidth=track.widthAt?.(at.u)??track.width,halfWidth=laneWidth/2+1.68;
      banner.name=`checkpoint-banner-${String(i).padStart(2,'0')}`;
      banner.position.copy(at.position);banner.rotation.y=at.yaw;
      banner.userData={checkpointIndex:i,number:i,clearance:Infinity};
      this.checkpointBanners.push(banner);this.group.add(banner);
      for(let side=0;side<2;side++) {
        const x=(side?1:-1)*(halfWidth+.22);
        const base=(track.surfaceHeightAt?.(at.u,x)??at.position.y)-at.position.y;
        place(frames,index*2+side,at,x,base+postHeight/2,0,.26,postHeight,.26);
        place(feet,index*2+side,at,x,base+footHeight/2,0,.42,footHeight,.42);
      }
      place(lines,index,at,0,.073,0,laneWidth,.025,.28,-at.pitch);
      const text=`CHECKPOINT ${String(i).padStart(2,'0')} / ${timingGates.length}`;
      const signW=1.8,signH=0.52,signY=1.92;
      for(const side of [-1,1]) {
        const postX=side*(halfWidth+.22);
        const base=(track.surfaceHeightAt?.(at.u,postX)??at.position.y)-at.position.y;
        const front=this.textPlane(text,signW,signH,'#d7ef7a','#223c33');
        front.position.set(postX,base+signY,-.14);front.rotation.y=Math.PI;banner.add(front);
        const rear=front.clone();rear.position.z=.14;rear.rotation.y=0;banner.add(rear);
      }
    }
    // Direction chevrons mark the outside of the most technical corners.
    for(const u of track.cornerMarkers)for(let j=0;j<3;j++){
      const p=track.at(u+j*3.5/track.length),ahead=track.at(u+12/track.length),sign=new THREE.Group();
      const side=Math.sin(ahead.yaw-p.yaw)>0?-1:1;
      const offset=((track.widthAt?.(p.u)??track.width)/2+2)*side;
      sign.name='corner-chevron';sign.userData.u=p.u;
      sign.position.copy(p.position);sign.position.x+=Math.cos(p.yaw)*offset;sign.position.z-=Math.sin(p.yaw)*offset;sign.position.y=track.surfaceHeightAt?.(p.u,offset)??p.position.y;sign.rotation.y=p.yaw+Math.PI;
      box(.09,1.1,.09,dark,0,.45,0,sign);
      const board=this.textPlane(side>0?'‹':'›',.8,.65,'#d7ef7a','#223c33');board.position.y=.95;sign.add(board);this.group.add(sign);
    }
  }
  textPlane(text,width,height,foreground,background) {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
    const ctx=canvas.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,512,128);ctx.fillStyle=foreground;ctx.font=`700 ${text.length<3?115:44}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,69);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:texture,side:THREE.FrontSide}));
  }
}
