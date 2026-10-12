import * as THREE from 'three';
import { CanyonTrack } from './CanyonTrack.js';
import { lerp, smoothstep } from '../math.js';

const wrap=u=>((u%1)+1)%1;
// Reference-image survey: western start, outer loop, then the nested inner esses.
export const TERRE_ROUGE_LINE=[
  [112,215],[114,186],[122,161],[151,145],[205,133],[264,124],[328,117],
  [376,120],[411,139],[441,163],[458,194],[462,238],[460,282],
  [455,318],[445,333],[433,324],[427,295],[426,253],[421,214],
  [410,185],[385,165],[347,158],[304,160],[258,165],[215,170],
  [188,182],[174,204],[169,226],[176,245],[195,259],[230,269],
  [270,282],[306,290],[330,290],[343,279],[329,267],[302,261],
  [276,255],[251,244],[228,228],[216,214],[227,205],[249,215],
  [273,232],[301,242],[330,248],[355,262],[372,284],[373,306],
  [357,322],[325,328],[287,330],[259,327],[242,312],[222,297],
  [208,301],[194,323],[180,337],[163,332],[154,309],[145,281],
  [132,253],[120,232]
];

export class TerreRougeTrack {
  constructor() {
    this.id='terrerouge';this.title='Les Esses de Terre Rouge';this.number='05';
    this.circuitId='terre-rouge-mx-v3';this.width=10;this.strictRoute=true;
    this.respawnCount=72;this.treeScale=.85;this.gaps=[];
    this.startLabel='TERRE ROUGE · DÉPART / ARRIVÉE';
    const raw=new THREE.CatmullRomCurve3(TERRE_ROUGE_LINE.map(([x,z])=>new THREE.Vector3((x-270)*.9,0,(z-225)*.9)),true,'centripetal');
    raw.arcLengthDivisions=16000;
    const n=Math.ceil(raw.getLength()),survey=raw.getSpacedPoints(n),fair=[];
    for(let i=0;i<n;i++) {
      const p=new THREE.Vector3();let sum=0;
      for(let d=-18;d<=18;d++){const w=Math.exp(-.5*(d/6)**2);p.addScaledVector(survey[(i+d+n)%n],w);sum+=w;}
      fair.push(p.divideScalar(sum));
    }
    this.curve=new THREE.CatmullRomCurve3(fair,true,'centripetal');this.curve.arcLengthDivisions=16000;
    this.length=this.curve.getLength();this.count=Math.ceil(this.length/.45);
    this.samples=this.curve.getSpacedPoints(this.count);
    this.baseSamples=this.samples.map(p=>p.clone());
    this.features=[];
    const anchor=(x,z)=>{
      const px=(x-270)*.9,pz=(z-225)*.9;let best=Infinity,index=0;
      this.samples.forEach((p,i)=>{const d=(p.x-px)**2+(p.z-pz)**2;if(d<best){best=d;index=i;}});
      return index/this.count;
    };
    this.landmarks={offcamber:anchor(271,164),compression:anchor(461,253),ruts:anchor(177,236),narrow:anchor(270,282)};
    const feature=(x,z,kind,rise,top,fall,height,label)=>({start:anchor(x,z),kind,rise:rise/this.length,top:top/this.length,fall:fall/this.length,height,label,targetSpeed:kind==='jump'?17:12});
    // Five tables on separate straights; long downslopes leave braking room before the esses.
    this.features.push(feature(205,133,'jump',11,5,22,1.6,'GRANDE TABLE DU PLATEAU'));
    this.features.push(feature(461,223,'jump',10,4,21,1.25,'TABLE DE LA DESCENTE'));
    this.features.push(feature(428,280,'jump',10,4,20,1.35,'STEP-UP DU RETOUR'));
    this.features.push(feature(198,260,'jump',10,4,19,1.15,'TABLE DES ESSES'));
    this.features.push(feature(337,327,'jump',9,3,18,1.05,'SAUT DU VALLON'));
    const rhythm=anchor(340,159);
    for(let i=0;i<3;i++)this.features.push({start:rhythm+i*6/this.length,kind:'roller',rise:2.6/this.length,top:0,fall:3.4/this.length,height:.22,label:i===0?'WHOOPS COURTS':null,targetSpeed:12});
    // Added terrain features use existing straight sections; the survey and widths stay fixed.
    const obstacle=(metres,kind,rise,top,fall,height,label)=>({start:metres/this.length,kind,rise:rise/this.length,top:top/this.length,fall:fall/this.length,height,label,targetSpeed:kind==='jump'?17:12});
    for(let i=0;i<4;i++)this.features.push(obstacle(250+i*7,'roller',3,0,4,[.26,.34,.34,.26][i],i===0?'WHOOPS DU PLATEAU':null));
    this.features.push(
      obstacle(1138,'roller',6,1,8,.6,'DOUBLE VAGUE INTÉRIEURE'),
      obstacle(1157,'roller',6,1,8,.75,null),
      obstacle(1280,'compression',11,3,14,-.65,'CUVETTE DES ESSES'),
      obstacle(1645,'jump',9,3,20,1,'TABLE DU RETOUR')
    );
    const start=this.samples[0];this.datum=this.naturalHeight(start.x,start.z);
    this.pond={x:(332-270)*.9,z:(202-225)*.9,radiusX:17,radiusZ:10};
    this.pond.level=this.naturalHeight(this.pond.x,this.pond.z)-this.datum-1;
    this.samples.forEach((p,i)=>{
      const u=i/this.count,grid=Math.min(u,1-u)*this.length;
      const compression=-1.3*this.window(u,this.landmarks.compression,28);
      p.y=(this.naturalHeight(p.x,p.z)-this.datum+compression)*smoothstep(16,36,grid)+this.obstacleHeight(u);
    });
    this.sections=Array.from({length:Math.ceil(this.length/5)},(_,i)=>({kind:this.curvature(i*5/this.length)>.018?'corner':'straight',start:i*5,end:(i+1)*5,length:5}));
    const apexes=[];
    for(let m=25;m<this.length-25;m+=2) {
      const u=m/this.length,k=this.curvature(u);
      if(k>.032&&k>=this.curvature(u-2/this.length)&&k>this.curvature(u+2/this.length)&&apexes.every(a=>Math.abs(a-u)*this.length>24))apexes.push(u);
    }
    this.timingUs=[0,...apexes,...Array.from({length:15},(_,i)=>(i+1)/16).filter(u=>apexes.every(a=>Math.abs(a-u)*this.length>22)&&!this.inObstacle(u,10))].sort((a,b)=>a-b);
    this.respawnUs=Array.from({length:this.respawnCount},(_,i)=>i/this.respawnCount).filter(u=>!this.inObstacle(u,8));
    this.berms=apexes.map(apex=>({apex,turnSign:-Math.sign(this.signedCurvature(apex)),maxAngleDeg:19}));
    this.aiSpeedZones=[];this.cornerMarkers=[];
    this.signs=this.features.filter(f=>f.label).map(f=>[wrap(f.start-10/this.length),f.label]);
    this.group=new THREE.Group();this.group.name=this.title;this.buildSpatialIndex();
  }
  window(u,center,metres) {return 1-smoothstep(metres*.45,metres,Math.abs(wrap(u-center+.5)-.5)*this.length);}
  inObstacle(u,margin=0) {
    return this.features.some(f=>{const d=wrap(u-f.start+margin/this.length)*this.length;return d<(f.rise+f.top+f.fall)*this.length+2*margin;});
  }
  naturalHeight(x,z) {
    return 2+10*Math.exp(-(((x-90)/105)**2)-((z+66)/80)**2)
      +3.7*Math.sin(x*.016+z*.012)+1.8*Math.sin(z*.028-x*.01);
  }
  isGap(){return false;}
  widthAt(u) {
    const grid=1-smoothstep(18,36,Math.min(wrap(u),1-wrap(u))*this.length);
    return 10+2*grid-1.2*this.window(u,this.landmarks.narrow,24);
  }
  bankAt(u) {
    const k=this.signedCurvature(u),grid=smoothstep(18,36,Math.min(wrap(u),1-wrap(u))*this.length);
    const strength=smoothstep(.009,.06,Math.abs(k))*grid*(this.inObstacle(u,10)?0:1);
    return {strength,turnSign:-Math.sign(k),angleDeg:19*strength,angleRad:19*Math.PI/180*strength};
  }
  crossHeight(u,side) {
    const bank=this.bankAt(u),outside=side*bank.turnSign;
    // Broad carved support with two shallow, rounded lines; no sharp wheel traps.
    const bowl=bank.strength*(.07*outside+.035*outside*outside);
    const rut=bank.strength*(-.07*Math.exp(-(((side+1.8)/.65)**2))-.06*Math.exp(-(((side-.9)/.65)**2)));
    const camber=.085*this.window(u,this.landmarks.offcamber,25)*(this.inObstacle(u,10)?0:1);
    return bowl+rut+side*camber;
  }
  rampSupport(){return 0;}
  shoulderWidth(u,side) {
    const a=this.at(u-1/this.length),b=this.at(u+1/this.length);
    const k=Math.atan2(Math.sin(b.yaw-a.yaw),Math.cos(b.yaw-a.yaw))/2;
    return side*Math.sign(k)>0?Math.max(.25,Math.min(2,.8/Math.max(.001,Math.abs(k))-this.widthAt(u)/2)):2;
  }
  sceneryAllowed(x,z){return this.nearest(x,z).distance>19;}
  terrainHeight(x,z,near=this.nearest(x,z)) {
    const at=this.at(near.u),half=this.widthAt(near.u)/2;
    const side=(x-at.position.x)*Math.cos(at.yaw)-(z-at.position.z)*Math.sin(at.yaw);
    const bed=at.position.y+this.crossHeight(near.u,Math.max(-half,Math.min(half,side)))-.9;
    const natural=this.naturalHeight(x,z)-this.datum-.55;
    let height=lerp(bed,natural,smoothstep(half+2,half+9,near.distance));
    const p=this.pond,r=Math.hypot((x-p.x)/p.radiusX,(z-p.z)/p.radiusZ);
    const pond=(1-smoothstep(.8,1.35,r))*smoothstep(half+4,half+10,near.distance);
    return lerp(height,p.level-.8,pond);
  }
  buildDecorations(scene) {
    const mat = (color, roughness = 0.7, metalness = 0.1) =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness });

    // 1. PADDOCK VILLAGE (x in [-185, -155], z in [-35, 30])
    const tentColors = [
      { roof: 0xd32f2f, trim: 0xffffff, x: -168, z: -25 }, // Honda / GasGas Red
      { roof: 0x1976d2, trim: 0xffffff, x: -168, z: -10 }, // Yamaha Factory Blue
      { roof: 0xf57c00, trim: 0x212121, x: -168, z: 5 },   // KTM Trophy Orange
      { roof: 0x388e3c, trim: 0x111111, x: -168, z: 20 }   // Kawasaki Green
    ];

    const tentPolesGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6);
    const poleMat = mat(0xcccccc, 0.3, 0.8);
    const tableGeo = new THREE.BoxGeometry(1.6, 0.8, 0.7);
    const standGeo = new THREE.BoxGeometry(0.5, 0.45, 0.3);

    for (const t of tentColors) {
      const tentGroup = new THREE.Group();
      tentGroup.position.set(t.x, 0, t.z);

      // 4 metal poles
      for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
        const pole = new THREE.Mesh(tentPolesGeo, poleMat);
        pole.position.set(dx, 1.3, dz);
        tentGroup.add(pole);
      }

      // Canopy roof (pyramid)
      const roofGeo = new THREE.ConeGeometry(3.2, 1.4, 4);
      roofGeo.rotateY(Math.PI / 4);
      const roof = new THREE.Mesh(roofGeo, mat(t.roof, 0.6));
      roof.position.set(0, 3.1, 0);
      tentGroup.add(roof);

      // Valence trim band
      const trimGeo = new THREE.BoxGeometry(4.3, 0.35, 4.3);
      const trim = new THREE.Mesh(trimGeo, mat(t.trim, 0.6));
      trim.position.set(0, 2.4, 0);
      tentGroup.add(trim);

      // Workbench & bike stand inside
      const bench = new THREE.Mesh(tableGeo, mat(0x37474f, 0.5));
      bench.position.set(-1.2, 0.4, 0);
      tentGroup.add(bench);

      const stand = new THREE.Mesh(standGeo, mat(t.roof, 0.4));
      stand.position.set(0.6, 0.22, 0);
      tentGroup.add(stand);

      this.group.add(tentGroup);
    }

    // 2. SUPPORT RACE HAULER TRUCK
    const truckGroup = new THREE.Group();
    truckGroup.position.set(-182, 0, -8);
    truckGroup.rotation.y = Math.PI / 2;

    const trailer = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.6, 12.0), mat(0x212121, 0.4, 0.2));
    trailer.position.set(0, 2.2, 0);
    truckGroup.add(trailer);

    const cab = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.2, 3.6), mat(0xd32f2f, 0.3, 0.4));
    cab.position.set(0, 2.0, 7.8);
    truckGroup.add(cab);

    const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = mat(0x111111, 0.9);
    for (const z of [-4.5, -3.2, 5.5, 7.5]) {
      for (const x of [-1.6, 1.6]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(x, 0.55, z);
        truckGroup.add(w);
      }
    }
    this.group.add(truckGroup);

    // 3. MARSHALLS OBSERVATION TOWER (Tour de contrôle en bois)
    const towerGroup = new THREE.Group();
    towerGroup.position.set(-156, 0, -3);

    const legGeo = new THREE.CylinderGeometry(0.12, 0.15, 4.5, 6);
    const timberMat = mat(0x5d4037, 0.9);
    for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
      const leg = new THREE.Mesh(legGeo, timberMat);
      leg.position.set(dx, 2.25, dz);
      towerGroup.add(leg);
    }
    const platform = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, 3.2), mat(0x795548, 0.8));
    platform.position.set(0, 3.8, 0);
    towerGroup.add(platform);

    const booth = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 2.6), mat(0x8d6e63, 0.7));
    booth.position.set(0, 5.0, 0);
    towerGroup.add(booth);

    const towerRoof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 0.9, 4), mat(0x3e2723, 0.8));
    towerRoof.rotateY(Math.PI / 4);
    towerRoof.position.set(0, 6.4, 0);
    towerGroup.add(towerRoof);

    this.group.add(towerGroup);

    // 4. OASIS POND PIER & SHORE ROCKS
    const pond = this.pond;
    const pierGroup = new THREE.Group();
    pierGroup.position.set(pond.x - 12, pond.level, pond.z);

    const deck = new THREE.Mesh(new THREE.BoxGeometry(7.0, 0.2, 2.2), mat(0x6d4c41, 0.8));
    deck.position.set(0, 0.1, 0);
    pierGroup.add(deck);

    const pileGeo = new THREE.CylinderGeometry(0.1, 0.1, 2.5, 6);
    for (const x of [-2.8, 0, 2.8]) {
      for (const z of [-0.9, 0.9]) {
        const p = new THREE.Mesh(pileGeo, timberMat);
        p.position.set(x, -1.0, z);
        pierGroup.add(p);
      }
    }

    const rockGeo = new THREE.DodecahedronGeometry(0.8, 0);
    const rockMat = mat(0x8d5b4c, 0.9);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 7) {
      const rx = pond.x + Math.cos(a) * (pond.radiusX + 1.2);
      const rz = pond.z + Math.sin(a) * (pond.radiusZ + 1.2);
      const rMesh = new THREE.Mesh(rockGeo, rockMat);
      rMesh.position.set(rx, pond.level + 0.3, rz);
      rMesh.scale.set(1 + Math.sin(a * 3) * 0.3, 0.8, 1 + Math.cos(a * 2) * 0.3);
      this.group.add(rMesh);
    }
    this.group.add(pierGroup);

    // 5. SAFETY FENCES WITH SPONSOR BANNERS AT KEY TURNS
    const bannerLocations = [
      { u: 0.08, side: -1, count: 4, color: 0xd32f2f }, // Grande Table
      { u: 0.23, side: 1, count: 4, color: 0x1976d2 },  // Descente
      { u: 0.83, side: -1, count: 4, color: 0xf57c00 }  // Vallon
    ];

    const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.8, 6);
    const panelGeo = new THREE.BoxGeometry(2.4, 0.85, 0.06);

    for (const b of bannerLocations) {
      for (let j = 0; j < b.count; j++) {
        const u = b.u + (j - b.count / 2) * (3.0 / this.length);
        const at = this.at(u);
        const half = this.widthAt(u) / 2;
        const offset = (half + 5.5) * b.side;
        const bx = at.position.x + Math.cos(at.yaw) * offset;
        const bz = at.position.z - Math.sin(at.yaw) * offset;
        const near = this.nearest(bx, bz);
        const nearHalf = this.widthAt(near.u) / 2;
        if (near.distance - nearHalf < 4.5) continue; // Minimum 4.5m safety clearance

        const by = (this.surfaceHeightAt?.(u, offset) ?? at.position.y);
        const panelGroup = new THREE.Group();
        panelGroup.position.set(bx, by, bz);
        panelGroup.rotation.y = at.yaw + (b.side < 0 ? 0 : Math.PI);

        const panelMesh = new THREE.Mesh(panelGeo, mat(b.color, 0.5));
        panelMesh.position.set(0, 0.85, 0);
        panelGroup.add(panelMesh);

        const post = new THREE.Mesh(postGeo, timberMat);
        post.position.set(0, 0.8, 0);
        panelGroup.add(post);

        this.group.add(panelGroup);
      }
    }

    // 6. FLAG POSTS AT THE 6 TABLE JUMP CRESTS
    const flagMat = mat(0xffeb3b, 0.4);
    const flagGeo = new THREE.BoxGeometry(0.7, 0.45, 0.02);
    const flagPoleGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6);
    for (const f of this.features.filter(feat => feat.kind === 'jump')) {
      const at = this.at(f.start);
      const half = this.widthAt(f.start) / 2;
      for (const side of [-1, 1]) {
        const offset = (half + 1.2) * side;
        const fx = at.position.x + Math.cos(at.yaw) * offset;
        const fz = at.position.z - Math.sin(at.yaw) * offset;
        const fy = (this.surfaceHeightAt?.(f.start, offset) ?? at.position.y);

        const flagGroup = new THREE.Group();
        flagGroup.position.set(fx, fy, fz);
        flagGroup.rotation.y = at.yaw;

        const pole = new THREE.Mesh(flagPoleGeo, mat(0xeeeeee, 0.3, 0.6));
        pole.position.set(0, 1.1, 0);
        flagGroup.add(pole);

        const flag = new THREE.Mesh(flagGeo, flagMat);
        flag.position.set(side > 0 ? 0.35 : -0.35, 1.9, 0);
        flagGroup.add(flag);

        this.group.add(flagGroup);
      }
    }
  }
  build(scene,world,RAPIER) {
    const size=440,n=180,positions=[],colors=[],indices=[],color=new THREE.Color();
    for(let z=0;z<=n;z++)for(let x=0;x<=n;x++) {
      const px=(x/n-.5)*size,pz=(z/n-.5)*size,near=this.nearest(px,pz);
      positions.push(px,this.terrainHeight(px,pz,near),pz);
      // Ochre earth beside the track fades into dry scrub on the perimeter.
      const grass=smoothstep(12,32,near.distance);
      color.setHSL(lerp(.055,.22,grass),lerp(.48,.24,grass),.32+.018*Math.sin(px*.09)*Math.cos(pz*.07),THREE.SRGBColorSpace);
      colors.push(color.r,color.g,color.b);
      if(x<n&&z<n){const a=z*(n+1)+x,b=a+n+1;indices.push(a,b,a+1,b,b+1,a+1);}
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    const ground=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));ground.name='terre-rouge-terrain';ground.receiveShadow=true;this.group.add(ground);
    if(world&&RAPIER)world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions),new Uint32Array(indices)).setFriction(.8));
    this.createRibbon(this.width+4,0,{color:0x87452d},world,RAPIER).name='terre-rouge-shoulders';
    this.createRibbon(this.width,.035,{color:0xba6945},world,RAPIER).name='terre-rouge-road';
    const water=new THREE.Mesh(new THREE.CircleGeometry(1,48),new THREE.MeshStandardMaterial({color:0x2e7d7a,roughness:.15,metalness:.25,transparent:true,opacity:0.9}));
    water.rotation.x=-Math.PI/2;water.scale.set(this.pond.radiusX,this.pond.radiusZ,1);
    water.position.set(this.pond.x,this.pond.level,this.pond.z);water.name='terre-rouge-irrigation-pond';
    this.group.add(water);

    // Éléments spécifiques du circuit (paddock, tentes, ponton, banderoles, drapeaux)
    this.buildDecorations(scene);

    scene.add(this.group);
  }
}

// Reuse the proven road mesher and spatial queries without constructing or changing Canyon.
for(const method of ['at','signedCurvature','curvature','sectionAt','obstacleHeight','surfaceHeightAt','buildSpatialIndex','nearest','shoulderHeight','createRibbon']) {
  TerreRougeTrack.prototype[method]=CanyonTrack.prototype[method];
}
