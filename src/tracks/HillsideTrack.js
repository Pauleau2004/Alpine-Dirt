import * as THREE from 'three';
import { Track } from '../Track.js';
import { lerp,smoothstep } from '../math.js';

// Survey in reference-image coordinates, left-to-right / top-to-bottom.
// Bottom paddock straight -> right hillside -> three diagonal switchbacks ->
// wooded left descent -> lower S. Adjacent lanes never cross at ground level.
export const REFERENCE_LINE=[
  // --- SECTEUR 1 : Ligne de départ & Montée punchy (y: 2.5 -> 20) ---
  [470, 452, 2.5],   // Grille de départ
  [650, 425, 3.5],   // Ligne droite du départ (Table du départ à m=65)
  [760, 390, 7.0],   // Amorce de la première montée
  [855, 345, 12.0],  // Accélération vers le premier virage
  [890, 290, 17.0],  // Berme relevée en montée
  [875, 235, 20.0],  // Sortie du premier virage

  // --- SECTEUR 2 : Lacet court 1 & Cuvette rythmée (y: 20 -> 13 -> 16) ---
  [820, 215, 17.0],  // Plongeon dans la cuvette
  [750, 235, 14.0],  // Vagues du coteau bas
  [670, 265, 13.0],  // Creux de compression
  [620, 275, 14.0],  // Entrée du lacet court n°1
  [585, 255, 16.0],  // Relance en appui

  // --- SECTEUR 3 : Montée médiane & Step-Up du Coteau (y: 16 -> 37) ---
  [610, 215, 21.0],  // Rampe d'ascension
  [655, 175, 26.0],  // Step-Up du coteau (m=472)
  [710, 145, 30.0],  // Réception sur la terrasse médiane
  [770, 138, 33.5],  // Accélération vers la crête panoramique
  [835, 142, 36.5],  // Sommet crête est
  [860, 118, 37.0],  // Virage panoramique de crête
  [830, 95, 36.0],   // Bascule sur la crête nord

  // --- SECTEUR 4 : Crête sommitale & Camelback (y: 36 -> 32.5 -> 35) ---
  [750, 88, 34.0],   // Table des crêtes (m=685)
  [660, 82, 32.5],   // Camelback des crêtes (m=745)
  [580, 80, 33.5],   // Ondulation sommitale
  [510, 82, 35.5],   // Approche de l'épingle haute
  [455, 95, 35.0],   // Épingle de la crête

  // --- SECTEUR 5 : Descente étagée & Balcon médian (y: 35 -> 17.5) ---
  [475, 135, 31.0],  // Step-down panoramique (m=860)
  [515, 175, 26.0],  // Réception en pente douce
  [535, 220, 21.0],  // Balcon médian
  [500, 250, 18.0],  // Entrée berme médiane
  [445, 255, 17.5],  // Corde relevée

  // --- SECTEUR 6 : Relance ouest & Crête boisée (y: 17.5 -> 34 -> 30) ---
  [380, 220, 22.0],  // Montée ouest rythmée
  [335, 175, 26.5],  // Terrasse boisée
  [330, 125, 31.0],  // Rampe vers la crête ouest
  [350, 80, 34.0],   // Sommet ouest
  [315, 68, 33.0],   // Épingle panoramique ouest
  [265, 90, 30.0],   // Bascule vers la descente

  // --- SECTEUR 7 : Descente rythmée & Vagues vallonnées (y: 30 -> 6.5) ---
  [230, 140, 25.0],  // Descente dans les arbres
  [200, 195, 20.0],  // Vagues du sous-bois (m=1202)
  [180, 250, 16.0],  // Compression naturelle
  [210, 285, 13.5],  // Lacet court boisé
  [255, 295, 12.5],  // Faux-plat montant
  [300, 315, 11.5],  // Ondulation de relance
  [335, 345, 10.0],  // Entrée lacet sud-ouest
  [320, 380, 8.5],   // Épingle sud-ouest
  [265, 395, 7.5],   // Relance
  [205, 385, 6.5],   // Sortie vers le paddock

  // --- SECTEUR 8 : Descente paddock & Esses d'arrivée (y: 6.5 -> 2.5) ---
  [150, 390, 5.5],   // Plongeon vers le bas
  [95, 415, 4.5],    // Relevé du paddock ouest
  [65, 440, 3.5],    // Épingle d'entrée paddock
  [85, 470, 3.0],    // Sortie basse
  [145, 465, 3.0],   // Esse paddock 1
  [205, 440, 3.5],   // Esse paddock 2
  [250, 475, 3.0],   // Sortie d'esse
  [300, 510, 2.5],   // Courbe d'entrée sur la ligne droite
  [380, 500, 2.5],   // Ligne droite d'arrivée
];
const wrap=u=>((u%1)+1)%1;
const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*t*(t*(t*6-15)+10);};
function roundedSurvey(curve) {
  const n=Math.ceil(curve.getLength()),raw=curve.getSpacedPoints(n),points=[];
  // Survey clicks are not corner apexes. A 9 m Gaussian fairing removes the
  // little steering kinks between clicks while retaining the large silhouette.
  for(let i=0;i<n;i++) {const p=new THREE.Vector3();let sum=0;for(let d=-27;d<=27;d++){const w=Math.exp(-.5*(d/9)**2);p.addScaledVector(raw[(i+d+n)%n],w);sum+=w;}points.push(p.divideScalar(sum));}
  const result=new THREE.CatmullRomCurve3(points,true,'centripetal');result.arcLengthDivisions=16000;return result;
}

export class HillsideTrack {
  constructor() {
    this.width=12;this.id='hillside';this.title='Coteaux de la Zorn';
    this.circuitId='zorn-hillside-v1';this.number='02';this.respawnCount=64;this.strictRoute=true;
    // Downhill braking approach zones for bot drivers.
    this.aiSpeedZones=[{start:.450,end:.510,speed:14.0},{start:.640,end:.700,speed:13.5}];
    const points=REFERENCE_LINE.map(([x,z,y])=>new THREE.Vector3((x-480)*.49,y,(z-320)*.70));
    const survey=new THREE.CatmullRomCurve3(points,true,'centripetal');survey.arcLengthDivisions=16000;this.curve=roundedSurvey(survey);
    this.length=this.curve.getLength();this.count=Math.ceil(this.length/.56);
    this.baseSamples=this.curve.getSpacedPoints(this.count);
    this.features=[];
    this.samples=this.baseSamples.map(p=>p.clone());
    const obstacle=(metres,kind,rise,top,fall,height,label)=>({start:metres/this.length,kind,rise:rise/this.length,top:top/this.length,fall:fall/this.length,height,label});
    // Authentic motocross features: progressive ramps, flat tops, long landings.
    this.features=[
      obstacle(65,'jump',10,7,16,1.35,'TABLE DU DÉPART'),
      ...[.28,.38,.28].map((h,i)=>obstacle(346+i*9.0,'roller',3.8,0,4.2,h,i===0?'VAGUES DU COTEAU BAS':null)),
      obstacle(472,'jump',9,5,14,1.0,'STEP-UP DU COTEAU'),
      obstacle(685,'jump',11,8,17,1.5,'TABLE DES CRÊTES'),
      ...[.32,.40,.30].map((h,i)=>obstacle(745+i*11,'roller',4.5,0,5.0,h,i===0?'CAMELBACK DES CRÊTES':null)),
      obstacle(860,'jump',8,5,14,1.1,'STEP-DOWN PANORAMIQUE'),
      ...[.25,.35,.30,.22].map((h,i)=>obstacle(1202+i*8.5,'roller',3.8,0,4.2,h,i===0?'VAGUES DU SOUS-BOIS':null))
    ];
    for(const f of this.features)for(let m=-8;m<=(f.rise+f.top+f.fall)*this.length+20;m+=2)if(this.curvature(f.start+m/this.length)>.014)throw new Error(`Obstacle dans un virage : ${f.label}`);
    this.samples.forEach((p,i)=>p.y=this.profile(i/this.count));
    this.cornerMarkers=[];
    // Turn windows are measured from the spline itself; relief obstacles must
    // be entirely outside these windows, including braking and landing space.
    for(let m=0;m<this.length;m+=16)if(this.curvature(m/this.length)>.035)this.cornerMarkers.push(m/this.length);
    this.sections=Array.from({length:Math.ceil(this.length/5)},(_,i)=>({kind:this.curvature(i*5/this.length)>.015?'corner':'straight',start:i*5,end:(i+1)*5,length:5}));
    const apexes=[];
    for(let m=15;m<this.length-15;m+=2){const u=m/this.length,k=this.curvature(u);if(k>.035&&k>=this.curvature(u-2/this.length)&&k>this.curvature(u+2/this.length)&&apexes.every(a=>Math.abs(a-u)*this.length>25))apexes.push(u);}
    this.timingUs=[0,...apexes,...Array.from({length:31},(_,i)=>(i+1)/32).filter(u=>apexes.every(a=>Math.abs(a-u)*this.length>18))].sort((a,b)=>a-b);
    this.signs=[
      [.028,'HOLESHOT & CÔTE EST'],
      [.180,'LES LACETS DU COTEAU'],
      [.365,'CRÊTE PANORAMIQUE'],
      [.540,'BALCON VALLONNÉ'],
      [.655,'VAGUES DU SOUS-BOIS'],
      [.830,'ESSES DU PADDOCK']
    ];
    this.group=new THREE.Group();this.group.name=this.title;
    this.buildSpatialIndex();
  }
  at(u){return Track.prototype.at.call(this,u);}
  widthAt(u){const m=wrap(u)*this.length;return 12+4*smoothstep(10,38,m)*(1-smoothstep(132,180,m));}
  inPaddock(x,z){const edge=85-(x+5)*.34;return x>-92&&x<162&&z>edge+10&&z<edge+58;}
  sceneryAllowed(x,z){return !this.inPaddock(x,z);}
  buildSpatialIndex() {
    this.spatialCells=new Map();this.cellSize=24;
    for(let i=0;i<this.count;i++){
      const a=this.samples[i],b=this.samples[i+1];
      for(let x=Math.floor(Math.min(a.x,b.x)/24);x<=Math.floor(Math.max(a.x,b.x)/24);x++)for(let z=Math.floor(Math.min(a.z,b.z)/24);z<=Math.floor(Math.max(a.z,b.z)/24);z++){
        const key=`${x},${z}`;if(!this.spatialCells.has(key))this.spatialCells.set(key,[]);this.spatialCells.get(key).push(i);
      }
    }
  }
  nearest(x,z) {
    // Exact segment projection, accelerated by spatial cells. Stop only once
    // the entire unexplored region is farther away than the current result.
    // Used during terrain generation too, so loading six clients never scans
    // every one of 4,148 segments for every meadow vertex.
    const size=this.cellSize,cx=Math.floor(x/size),cz=Math.floor(z/size);let best=Infinity,bestIndex=Infinity,result=null;
    for(let radius=0;radius<32;radius++){
      for(let dx=-radius;dx<=radius;dx++)for(let dz=-radius;dz<=radius;dz++){
        if(Math.abs(dx)!==radius&&Math.abs(dz)!==radius)continue;
        for(const i of this.spatialCells.get(`${cx+dx},${cz+dz}`)??[]){
          const a=this.samples[i],b=this.samples[i+1],vx=b.x-a.x,vz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*vx+(z-a.z)*vz)/(vx*vx+vz*vz)));
          const px=a.x+vx*t,pz=a.z+vz*t,d=(x-px)**2+(z-pz)**2;
          if(d<best||(d===best&&i<bestIndex)){best=d;bestIndex=i;result={u:(i+t)/this.count,distance:Math.sqrt(d),height:lerp(a.y,b.y,t),x:px,z:pz};}
        }
      }
      const outside=Math.min(x-(cx-radius)*size,(cx+radius+1)*size-x,z-(cz-radius)*size,(cz+radius+1)*size-z);
      if(best<=outside*outside)return result;
    }
    return result??Track.prototype.nearest.call(this,x,z);
  }
  curvature(u) {const a=this.at(u-2/this.length),b=this.at(u+2/this.length);return Math.abs(Math.atan2(Math.sin(b.yaw-a.yaw),Math.cos(b.yaw-a.yaw)))/4;}
  sectionAt(u){return this.sections[Math.min(this.sections.length-1,Math.floor(wrap(u)*this.length/5))];}
  baseProfile(u) {const n=wrap(u)*this.count,i=Math.floor(n);return lerp(this.baseSamples[i].y,this.baseSamples[i+1].y,n-i);}
  obstacleHeight(u) {let h=0;for(const f of this.features){const d=wrap(u-f.start);h+=f.height*(ease(d/f.rise)-ease((d-f.rise-f.top)/f.fall));}return h;}
  profile(u){return this.baseProfile(u)+this.obstacleHeight(u);}
  terrainHeight(x,z,near=this.nearest(x,z)) {
    const slope=3+34*smoothstep(125,-128,z);
    const natural=slope+2.2*Math.sin(x*.024)*Math.cos(z*.03);
    return lerp(near.height-.9,natural,smoothstep(7,32,near.distance));
  }
  createRibbon(width,offset,material,world,RAPIER) {
    const shoulder=width>this.width,lanes=4,positions=[],colors=[],indices=[],c=new THREE.Color();
    for(let i=0;i<=this.count;i++) {
      const p=this.samples[i],prev=this.samples[(i+this.count-1)%this.count],next=this.samples[(i+1)%this.count],dx=next.x-prev.x,dz=next.z-prev.z,len=Math.hypot(dx,dz);
      const laneWidth=this.widthAt(i/this.count),fullWidth=laneWidth+(shoulder?4:0);
      for(let j=0;j<=lanes;j++) {
        const side=(j/lanes-.5)*fullWidth,drop=shoulder?0.9*smoothstep(laneWidth/2-.1,laneWidth/2+2,Math.abs(side)):0;
        positions.push(p.x+dz/len*side,p.y+offset-drop,p.z-dx/len*side);c.set(material.color).multiplyScalar(.98+.02*Math.sin(i*1.31+j*12.37));colors.push(c.r,c.g,c.b);
        if(i<this.count&&j<lanes){const a=i*(lanes+1)+j,b=a+lanes+1;indices.push(a,b,a+1,b,b+1,a+1);}
      }
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide}));mesh.receiveShadow=true;this.group.add(mesh);
    world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions),new Uint32Array(indices)).setFriction(.65));return mesh;
  }
  build(scene,world,RAPIER) {
    const size=490,n=164,positions=[],colors=[],indices=[],color=new THREE.Color();
    for(let z=0;z<=n;z++)for(let x=0;x<=n;x++) {
      const px=(x/n-.5)*size,pz=(z/n-.5)*size;
      positions.push(px,this.terrainHeight(px,pz),pz);
      color.setHSL(.265+.009*Math.sin(x*.24),.38,.36+.012*Math.sin(x*.7+z*.5),THREE.SRGBColorSpace);
      // Broad lower paddock, as in the reference; this is terrain, not a
      // shortcut or a second racing lane. Upper lanes remain separated by turf.
      const lowerEdge=85-(px+5)*.34;
      if(px>-92&&px<162&&pz>lowerEdge&&pz<lowerEdge+58)color.setHSL(.105,.30,.49+.015*Math.sin(x*.5+z*.3),THREE.SRGBColorSpace);
      colors.push(color.r,color.g,color.b);
      if(x<n&&z<n){const a=z*(n+1)+x,b=a+n+1;indices.push(a,b,a+1,b,b+1,a+1);}
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,flatShading:true}));mesh.receiveShadow=true;this.group.add(mesh);
    world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions),new Uint32Array(indices)).setFriction(.8));
    this.createRibbon(16,0,{color:0x998462},world,RAPIER);this.createRibbon(this.width,.035,{color:0xbe956a},world,RAPIER);scene.add(this.group);
  }
}
