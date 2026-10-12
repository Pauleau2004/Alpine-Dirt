import * as THREE from 'three';
import { CanyonTrack } from './CanyonTrack.js';
import { smoothstep,lerp } from '../math.js';

const wrap=u=>((u%1)+1)%1;
export class SprintTrack {
  constructor() {
    this.id='sprint';this.title='Sprint du Soleil';this.number='06';
    this.circuitId='sprint-soleil-v2';this.width=12;this.strictRoute=true;
    this.respawnCount=40;this.treeScale=.8;this.gaps=[];
    this.startLabel='SPRINT DU SOLEIL · DÉPART / ARRIVÉE';
    // Compact MX loop: outer sweep, central hairpin and alternating western esses.
    const line=[[0,65],[60,65],[90,45],[100,10],[90,-25],[65,-45],[40,-35],[30,-5],[12,8],[-6,-5],[-20,-45],[-45,-65],[-75,-52],[-90,-20],[-65,0],[-40,12],[-48,35],[-50,50],[-40,65]];
    this.curve=new THREE.CatmullRomCurve3(line.map(([x,z])=>new THREE.Vector3(x*.85,0,z*.85)),true,'centripetal');
    this.curve.arcLengthDivisions=16000;
    const n=Math.ceil(this.curve.getLength()),raw=this.curve.getSpacedPoints(n),rounded=[];
    for(let i=0;i<n;i++){const p=new THREE.Vector3();let total=0;for(let d=-18;d<=18;d++){const w=Math.exp(-.5*(d/6)**2);p.addScaledVector(raw[(i+d+n)%n],w);total+=w;}rounded.push(p.divideScalar(total));}
    this.curve=new THREE.CatmullRomCurve3(rounded,true,'centripetal');this.curve.arcLengthDivisions=16000;
    this.length=this.curve.getLength();this.count=Math.ceil(this.length/.45);
    this.samples=this.curve.getSpacedPoints(this.count);this.features=[];
    const obstacle=(m,kind,rise,top,fall,height,label)=>({start:m/this.length,kind,rise:rise/this.length,top:top/this.length,fall:fall/this.length,height,label,targetSpeed:20});
    this.features.push(obstacle(14,'jump',8,3,17,.8,'TABLE DU HOLESHOT'));
    this.features.push(obstacle(269,'jump',7,3,18,1.0,'SAUT DU SOUS-BOIS'));
    this.features.push(obstacle(337,'jump',7,2,16,.95,'TABLE DU RETOUR'));
    this.features.push(obstacle(100,'roller',3,0,5,.22,'VAGUES DE LA DESCENTE'),obstacle(110,'roller',3,0,5,.27,null));
    this.samples.forEach((p,i)=>{
      const u=i/this.count,grid=Math.min(u,1-u)*this.length;
      p.y=this.naturalHeight(p.x,p.z)*smoothstep(15,32,grid)+this.obstacleHeight(u);
    });
    this.timingUs=Array.from({length:10},(_,i)=>i/10).filter(u=>!this.inObstacle(u,7));
    this.respawnUs=Array.from({length:this.respawnCount},(_,i)=>i/this.respawnCount).filter(u=>!this.inObstacle(u,8));
    this.sections=Array.from({length:Math.ceil(this.length/5)},(_,i)=>({kind:this.curvature(i*5/this.length)>.018?'corner':'straight',start:i*5,end:(i+1)*5,length:5}));
    this.signs=this.features.filter(f=>f.label).map(f=>[wrap(f.start-8/this.length),f.label]);
    this.aiSpeedZones=[];this.cornerMarkers=[];this.group=new THREE.Group();this.group.name=this.title;this.buildSpatialIndex();
  }
  naturalHeight(x,z){return 4.5*Math.exp(-((x/90)**2+((z+60)/65)**2))+1.1*Math.sin(x*.023);}
  inObstacle(u,margin=0){return this.features.some(f=>wrap(u-f.start+margin/this.length)*this.length<(f.rise+f.top+f.fall)*this.length+2*margin);}
  widthAt(u){return 12-1.5*smoothstep(16,32,Math.min(wrap(u),1-wrap(u))*this.length);}
  isGap(){return false;}
  bankAt(u){
    const k=this.signedCurvature(u),grid=smoothstep(16,32,Math.min(wrap(u),1-wrap(u))*this.length);
    let strength=smoothstep(.003,.022,Math.abs(k))*grid;
    for(const f of this.features){const d=(wrap(u-f.start+.5)-.5)*this.length,end=(f.rise+f.top+f.fall)*this.length;strength*=1-smoothstep(-10,0,d)*(1-smoothstep(end,end+12,d));}
    return {strength,turnSign:-Math.sign(k),angleDeg:18*strength,angleRad:Math.PI/10*strength};
  }
  rampSupport(){return 0;}
  sceneryAllowed(x,z){return this.nearest(x,z).distance>18;}
  terrainHeight(x,z,near=this.nearest(x,z)) {
    const at=this.at(near.u),side=(x-at.position.x)*Math.cos(at.yaw)-(z-at.position.z)*Math.sin(at.yaw);
    const bed=at.position.y+this.crossHeight(near.u,Math.max(-this.widthAt(near.u)/2,Math.min(this.widthAt(near.u)/2,side)))-.9;
    return lerp(bed,this.naturalHeight(x,z)-.8,smoothstep(this.widthAt(near.u)/2+2,18,near.distance));
  }
  build(scene,world,RAPIER) {
    const n=150,size=400,positions=[],colors=[],indices=[],color=new THREE.Color();
    for(let z=0;z<=n;z++)for(let x=0;x<=n;x++) {
      const px=(x/n-.5)*size,pz=(z/n-.5)*size,near=this.nearest(px,pz);
      positions.push(px,this.terrainHeight(px,pz,near),pz);
      color.setHSL(lerp(.09,.23,smoothstep(9,26,near.distance)),.34,.37+.018*Math.sin(px*.06)*Math.cos(pz*.06),THREE.SRGBColorSpace);colors.push(color.r,color.g,color.b);
      if(x<n&&z<n){const a=z*(n+1)+x,b=a+n+1;indices.push(a,b,a+1,b,b+1,a+1);}
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    const ground=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));ground.name='sprint-terrain';ground.receiveShadow=true;this.group.add(ground);
    if(world&&RAPIER)world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions),new Uint32Array(indices)).setFriction(.8));
    this.createRibbon(18,0,{color:0x94704b},world,RAPIER).name='sprint-shoulders';
    this.createRibbon(this.width,.035,{color:0xd2a566},world,RAPIER).name='sprint-road';scene.add(this.group);
  }
}
for(const method of ['at','signedCurvature','curvature','sectionAt','obstacleHeight','crossHeight','surfaceHeightAt','buildSpatialIndex','nearest','shoulderWidth','shoulderHeight','createRibbon'])SprintTrack.prototype[method]=CanyonTrack.prototype[method];
