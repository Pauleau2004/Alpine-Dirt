import * as THREE from 'three';
import { lerp, smoothstep } from './math.js';

// A closed course made from actual straights and eight progressive bends.
// Each vertex is [x, z, corner setback in metres, level of the whole corner].
// The upper plateau is reached on the east straight and left on the west one.
const CORNERS = [
  [-128,-90,32,2], [108,-108,30,2], [130,82,30,5], [43,121,30,5],
  [12,6,25,5], [-58,-8,26,5], [-91,108,32,5], [-148,64,25,5],
];
const START_OFFSET = 75; // Leaves 100 m of clear straight before the first bend.
const wrap = u => ((u % 1) + 1) % 1;
const ease = (a,b,x) => {
  const t=Math.max(0,Math.min(1,(x-a)/(b-a)));
  return t*t*t*(t*(t*6-15)+10);
};

// The first/last three control points are collinear: curvature approaches zero
// at the straight connections instead of steering abruptly into a circular arc.
class ProgressiveBend extends THREE.Curve {
  constructor(entry,vertex,exit) {
    super();this.arcLengthDivisions=300;
    this.controls=[entry,entry.clone().lerp(vertex,.28),entry.clone().lerp(vertex,.56),exit.clone().lerp(vertex,.56),exit.clone().lerp(vertex,.28),exit];
  }
  getPoint(t,target=new THREE.Vector3()) {
    const weights=[1,5,10,10,5,1];target.set(0,0,0);
    for(let i=0;i<6;i++)target.addScaledVector(this.controls[i],weights[i]*(1-t)**(5-i)*t**i);
    return target;
  }
}
function createLayout() {
  const corners=CORNERS.map(([x,z,setback,height],i)=>{
    const position=new THREE.Vector3(x,0,z),previous=CORNERS[(i+CORNERS.length-1)%CORNERS.length],next=CORNERS[(i+1)%CORNERS.length];
    const toward=p=>position.clone().add(new THREE.Vector3(p[0]-x,0,p[1]-z).normalize().multiplyScalar(setback));
    return {position,height,entry:toward(previous),exit:toward(next)};
  });
  const curve=new THREE.CurvePath(),sections=[];let length=0;
  const add=(kind,index,part,fromHeight,toHeight)=>{
    const size=part.getLength();curve.add(part);
    sections.push(Object.freeze({kind,index,start:length,end:length+size,length:size,fromHeight,toHeight}));length+=size;
  };
  for(let i=0;i<corners.length;i++) {
    const c=corners[i],next=corners[(i+1)%corners.length];
    add('straight',i,new THREE.LineCurve3(c.exit,next.entry),c.height,next.height);
    add('corner',i,new ProgressiveBend(next.entry,next.position,next.exit),next.height,next.height);
  }
  return {curve,sections:Object.freeze(sections),length};
}
const LAYOUT=createLayout();

// Obstacles are specified in metres from the exit of a named bend, never as
// arbitrary percentages. Their entire take-off/landing lies on one straight.
// The gaps are deliberate: build speed, land upright, then brake before turning.
const OBSTACLES = [
  {section:1,offset:24,kind:'jump',rise:7,top:6,fall:10,height:1.2,label:'SAUT 01'},
  {section:1,offset:72,kind:'jump',rise:10,top:8,fall:16,height:1.85,label:'SAUT 02'},
  ...[.45,.65,.45].map((height,i)=>({section:3,offset:16+i*9,kind:'roller',rise:3.8,top:0,fall:4.2,height,...(i===0?{label:'VAGUES'}:{})})),
  ...[.22,.30,.22].map((height,i)=>({section:5,offset:14+i*9,kind:'roller',rise:2.8,top:0,fall:3.2,height,...(i===0?{label:'MINI-BOSSES'}:{})})),
  {section:7,offset:25,kind:'jump',rise:14,top:10,fall:21,height:3.1,label:'GRAND SAUT'},
];
export const TRACK_FEATURES = Object.freeze(OBSTACLES.map(f=>{
  const section=LAYOUT.sections.find(s=>s.kind==='straight'&&s.index===f.section);
  if(f.offset<12||f.offset+f.rise+f.top+f.fall>section.length-20)throw new Error('Track obstacle encroaches on a corner approach');
  return Object.freeze({...f,start:(section.start+f.offset-START_OFFSET)/LAYOUT.length,rise:f.rise/LAYOUT.length,top:f.top/LAYOUT.length,fall:f.fall/LAYOUT.length});
}));

// One shared sampled surface for rendering, raycasts and checkpoint placement.
export class Track {
  constructor() {
    this.width = 12;
    this.features=TRACK_FEATURES;
    this.curve=LAYOUT.curve;this.sections=LAYOUT.sections;this.length=LAYOUT.length;
    this.count=Math.ceil(this.length/.56);
    this.samples = Array.from({length:this.count+1},(_,i) => {
      const u=i/this.count,p=this.curve.getPoint(wrap(u+START_OFFSET/this.length));
      p.y = this.profile(u);
      return p;
    });
    this.signs=[[(LAYOUT.sections[0].end-START_OFFSET-22)/this.length,'VIRAGE 01'],
      ...this.features.filter(f=>f.label).map(f=>[f.start-9/this.length,f.label])];
    this.cornerMarkers=this.sections.filter(s=>s.kind==='corner').map(s=>wrap((s.start+s.length*.38-START_OFFSET)/this.length));
    this.group = new THREE.Group();
    this.group.name = 'Alpine Dirt';
  }
  sectionAt(u) {
    const distance=wrap(u+START_OFFSET/this.length)*this.length;
    return this.sections.find(s=>distance<=s.end);
  }
  baseProfile(u) {
    const distance=wrap(u+START_OFFSET/this.length)*this.length,s=this.sectionAt(u);
    // All turns are level, including entry/exit; height changes occur only on
    // the two long straights, with eight flat metres at both ends.
    if(s.fromHeight===s.toHeight)return s.fromHeight;
    return lerp(s.fromHeight,s.toHeight,ease(s.start+8,s.end-8,distance));
  }
  obstacleHeight(u) {
    u=wrap(u);let height=0;
    for(const f of this.features)height+=f.height*(ease(f.start,f.start+f.rise,u)-ease(f.start+f.rise+f.top,f.start+f.rise+f.top+f.fall,u));
    return height;
  }
  profile(u) {
    return this.baseProfile(u)+this.obstacleHeight(u);
  }
  at(u) {
    u = ((u % 1) + 1) % 1;
    const index = u * this.count, i = Math.floor(index), t = index - i;
    const a = this.samples[i], b = this.samples[i+1];
    const p = a.clone().lerp(b,t);
    const tangent = b.clone().sub(a).normalize();
    return { position: p, tangent, yaw: Math.atan2(tangent.x, tangent.z), pitch: Math.asin(tangent.y), u };
  }
  nearest(x, z) {
    let best = Infinity, result = null;
    for (let i=0; i<this.count; i++) {
      const a = this.samples[i], b = this.samples[i+1];
      const dx=b.x-a.x, dz=b.z-a.z;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));
      const px=a.x+dx*t, pz=a.z+dz*t, d=(x-px)**2+(z-pz)**2;
      if (d<best) { best=d; result={ u:(i+t)/this.count, distance:Math.sqrt(d), height:lerp(a.y,b.y,t), x:px,z:pz }; }
    }
    return result;
  }
  terrainHeight(x,z, near = this.nearest(x,z)) {
    const natural = -1.8 + 2.2 * Math.sin(x*0.018) * Math.cos(z*0.021) + 1.1 * Math.sin(z*0.041+x*0.014);
    // Keep the coarse meadow safely below the detailed whoops and jump mesh.
    return lerp(near.height - 0.85, natural, smoothstep(6.5, 20, near.distance));
  }
  createRibbon(width, offset, material, physics, RAPIER) {
    const positions=[], colors=[], indices=[];
    const c = new THREE.Color();
    const lanes=4;
    for(let i=0;i<=this.count;i++) {
      const p=this.samples[i], prev=this.samples[(i+this.count-1)%this.count], next=this.samples[(i+1)%this.count];
      const dx=next.x-prev.x,dz=next.z-prev.z, len=Math.hypot(dx,dz);
      for(let j=0;j<=lanes;j++) {
        const side=(j/lanes-.5)*width;
        const shoulderDrop=width>14?0.9*smoothstep(5.9,8,Math.abs(side)):0;
        positions.push(p.x+dz/len*side,p.y+offset-shoulderDrop,p.z-dx/len*side);
        c.set(material.color); c.multiplyScalar(0.965+0.035*Math.sin(i*1.31+j*12.37)); colors.push(c.r,c.g,c.b);
        if(i<this.count&&j<lanes) { const a=i*(lanes+1)+j,b=a+lanes+1; indices.push(a,b,a+1,b,b+1,a+1); }
      }
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:1,side:THREE.DoubleSide}));
    mesh.receiveShadow=true; this.group.add(mesh);
    if(physics) physics.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions),new Uint32Array(indices)).setFriction(0.65));
    return mesh;
  }
  build(scene, world, RAPIER) {
    const size=490, n=140, positions=[], colors=[], indices=[];
    const c=new THREE.Color();
    for(let z=0;z<=n;z++) for(let x=0;x<=n;x++) {
      const px=(x/n-.5)*size,pz=(z/n-.5)*size;
      positions.push(px,this.terrainHeight(px,pz),pz);
      c.setHSL(0.27+0.010*Math.sin(x*.4),0.40,0.35+0.016*Math.sin(x*1.2+z*.7),THREE.SRGBColorSpace); colors.push(c.r,c.g,c.b);
      if(x<n&&z<n) {const a=z*(n+1)+x,b=a+n+1; indices.push(a,b,a+1,b,b+1,a+1);}
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geometry.setIndex(indices);geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,flatShading:true}));
    mesh.receiveShadow=true;this.group.add(mesh);
    world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions),new Uint32Array(indices)).setFriction(0.8));
    this.createRibbon(16,0,{color:0x998462},world,RAPIER);
    this.createRibbon(this.width,0.035,{color:0xc6a274},world,RAPIER);
    scene.add(this.group);
  }
}
