import * as THREE from 'three';
import { Track } from '../Track.js';
import { lerp, smoothstep } from '../math.js';

// Survey of the supplied plan, clockwise from the finish on the left straight.
// Image x/y coordinates become world x/z; the third value sets the MX relief.
export const CANYON_REFERENCE_LINE = [
  [203,300,11], [215,220,13], [235,140,18], [280,102,20],
  [328,125,19], [377,192,16], [425,224,14], [473,194,17],
  [532,120,23], [580,103,25], [625,138,24], [655,210,21],
  [665,277,18], [635,323,16], [575,338,14], [480,338,12],
  [370,338,10], [295,353,9], [260,385,8], [248,426,8],
  [270,470,9], [330,498,11], [440,504,12], [550,502,13],
  [650,485,16], [740,488,20], [825,498,22], [915,518,19],
  [1020,537,14], [1140,548,11], [1240,551,10], [1281,534,11],
  [1298,493,12], [1281,452,13], [1240,435,14], [1150,435,15],
  [1060,435,14], [1018,417,13], [1000,375,12], [1018,333,13],
  [1060,315,15], [1150,316,18], [1240,320,20], [1286,301,21],
  [1305,255,22], [1286,209,23], [1240,190,24], [1150,184,23],
  [1050,181,22], [955,188,20], [891,211,17],
  [857,266,13], [841,345,9], [829,420,6], [825,498,6],
  [823,588,8], [816,691,13], [790,773,17], [745,806,19],
  [699,785,21], [651,722,25], [599,657,29], [549,633,31],
  [501,660,30], [465,724,26], [421,801,22], [371,837,20],
  [308,831,18], [262,799,17], [244,749,16], [246,684,14],
  [243,628,12], [216,582,10], [178,546,8], [161,503,7],
  [169,445,8], [185,382,10], [196,338,11],
].map(([x,z,y]) => [x-740,z-460,y]);

const wrap = u => ((u % 1) + 1) % 1;
const ease = t => {
  t = Math.max(0, Math.min(1, t));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

function roundedSurvey(curve) {
  const n = Math.ceil(curve.getLength()), raw = curve.getSpacedPoints(n), points = [];
  for (let i = 0; i < n; i++) {
    const p = new THREE.Vector3(); let sum = 0;
    for (let d = -21; d <= 21; d++) {
      const w = Math.exp(-0.5 * (d / 7) ** 2);
      p.addScaledVector(raw[(i + d + n) % n], w);
      sum += w;
    }
    points.push(p.divideScalar(sum));
  }
  const result = new THREE.CatmullRomCurve3(points, true, 'centripetal');
  result.arcLengthDivisions = 16000;
  return result;
}

export class CanyonTrack {
  constructor() {
    this.width = 14;
    this.id = 'canyon';
    this.title = 'Canyon Rouge MX';
    this.circuitId = 'canyon-rouge-mx-v5';
    this.number = '04';
    this.respawnCount = 96;
    this.altitudeAware = true;
    this.startLabel = 'DEPART / ARRIVEE';
    this.strictRoute = true;
    this.treeScale = 1.15;

    // Keep the compact reference layout, with more room between its bends.
    this.layoutScale = 0.250;
    const raw = new THREE.CatmullRomCurve3(CANYON_REFERENCE_LINE.map(([x,z,y]) => new THREE.Vector3(x * this.layoutScale, (y-11)*.42, z * this.layoutScale)), true, 'centripetal');
    this.curve = roundedSurvey(raw);
    this.length = this.curve.getLength();
    this.count = Math.ceil(this.length / 0.5);
    this.baseSamples = this.curve.getSpacedPoints(this.count);
    const startHeight=this.baseSamples[0].y;
    this.baseSamples.forEach(p=>p.y-=startHeight);
    this.samples = this.baseSamples.map(p => p.clone());
    this.buildSpatialIndex();

    // Branch-specific anchors also disambiguate the two crossing levels.
    const anchor = (x, z, from = 0, to = 1) => {
      let best = Infinity, u = 0;
      for (let i = Math.floor(from * this.count); i < Math.ceil(to * this.count); i++) {
        const p = this.samples[i], d = (p.x - (x - 740) * this.layoutScale) ** 2 + (p.z - (z - 460) * this.layoutScale) ** 2;
        if (d < best) { best = d; u = i / this.count; }
      }
      return u;
    };
    this.landmarks = {
      leftBerm: anchor(248, 426),
      rightBerm: anchor(1000, 375),
      bridge: anchor(825, 498, 0.2, 0.55),
      underpass: anchor(825, 498, 0.55, 0.85)
    };

    this.features = [];
    const obstacle = (u, kind, rise, top, fall, height, label, targetSpeed = 15) => ({
      start: wrap(u), kind, rise: rise / this.length, top: top / this.length, fall: fall / this.length, height, label, targetSpeed
    });
    const rhythm = (x, z, number, spacing = 10, height = 0.28) => {
      const u = anchor(x, z);
      for (let i = 0; i < number; i++) {
        this.features.push(obstacle(u + i * spacing / this.length, 'roller', spacing * 0.45, 0, spacing * 0.55, height + (i % 3) * 0.025, i === 0 ? 'BOSSES EN SERIE' : null, 14.5));
      }
    };

    rhythm(566, 338, 3);
    rhythm(380, 500, 3);
    rhythm(1040, 540, 3);
    rhythm(1175, 186, 4);
    rhythm(836, 366, 2, 10, 0.25);
    rhythm(825, 570, 2, 11, 0.28);

    // Obstacles & jumps
    this.features.push(
      obstacle(anchor(633, 164), 'jump', 11, 3, 16, .75, 'STEP-DOWN DU CANYON', 14.5),
      obstacle(anchor(671, 750), 'jump', 12, 3, 16, .7, 'STEP-UP DU CANYON', 14.5),
      obstacle(anchor(459, 735), 'jump', 11, 3, 17, .8, 'TABLE DE LA DESCENTE', 14.5)
    );

    // One genuine gap: no deck, road, shoulders or collider span the opening.
    const lipIndex=Math.round(this.landmarks.bridge*this.count)-10;
    this.gaps=[{id:1,takeoffU:lipIndex/this.count,landingU:(lipIndex+20)/this.count,
      underpassU:this.landmarks.underpass,name:'SAUT DU CANYON'}];
    this.features.push({...obstacle((lipIndex/this.count)-32/this.length,'jump',32,0,
      10+30,1.4,'SAUT DU CANYON',18),approachSpeed:15,gap:true});
    this.samples.forEach((p,i)=>p.y=this.profile(i/this.count));
    this.shapeGap();
    for(const g of this.gaps) {
      g.takeoffLip=this.at(g.takeoffU).position;
      g.landingStart=this.at(g.landingU).position;
      g.underpassPos=this.at(g.underpassU).position;
    }

    // Banking follows actual turn direction, not fixed lap fractions.
    this.berms = [];
    for (let i = 0; i < this.count; i += 4) {
      const u = i / this.count, k = this.curvature(u);
      if (k > 0.024 && !this.berms.some(b => Math.abs(b.apex - u) * this.length < 55)) {
        this.berms.push({ apex: u, turnSign: -Math.sign(this.signedCurvature(u)), maxAngleDeg: 18, label: 'APPUI FLUIDE' });
      }
    }

    this.aiSpeedZones = [];
    // 24 ordered gates follow the route, each marked by a visual checkpoint arch.
    this.timingUs = Array.from({length:24},(_,i)=>{
      const u=i/24,g=this.gaps[0];
      return u>g.takeoffU-5/this.length&&u<g.landingU+12/this.length?g.landingU+14/this.length:u;
    }).sort((a,b)=>a-b);
    this.respawnUs=Array.from({length:this.respawnCount},(_,i)=>i/this.respawnCount)
      .filter(u=>!this.gaps.some(g=>u>g.takeoffU-28/this.length&&u<g.landingU+24/this.length));
    this.signs = this.features.filter(f => f.label).map(f => [wrap(f.start - 10 / this.length), f.label]);
    this.cornerMarkers = [];
    this.sections = Array.from({ length: Math.ceil(this.length / 5) }, (_, i) => ({
      kind: this.curvature(i * 5 / this.length) > 0.016 ? 'corner' : 'straight',
      start: i * 5, end: (i + 1) * 5, length: 5
    }));
    this.group = new THREE.Group();
    this.group.name = this.title;
    this.buildSpatialIndex();
  }

  isGap(u) {
    return this.gaps?.some(g=>wrap(u)>g.takeoffU&&wrap(u)<g.landingU)??false;
  }

  shapeGap() {
    const g=this.gaps[0],center=this.at(this.landmarks.bridge);
    const hermite=(a,b,da,db,t,length)=>(2*t**3-3*t*t+1)*a+(t**3-2*t*t+t)*da*length+(-2*t**3+3*t*t)*b+(t**3-t*t)*db*length;
    const approach=32,reception=30,span=(g.landingU-g.takeoffU)*this.length;
    const startU=g.takeoffU-approach/this.length,endU=g.landingU+reception/this.length;
    const start=this.profile(startU),end=this.profile(endU);
    const startGrade=(this.profile(startU+.5/this.length)-this.profile(startU-.5/this.length));
    const endGrade=(this.profile(endU+.5/this.length)-this.profile(endU-.5/this.length));
    const lip=this.baseProfile(g.takeoffU)+1.4,landing=lip-2.3;
    for(let i=0;i<=this.count;i++) {
      const u=i/this.count,m=(u-this.landmarks.bridge)*this.length;
      // A straight launch and landing line avoids being thrown sideways in the air.
      if(Math.abs(m)<50) {
        const blend=1-smoothstep(30,50,Math.abs(m));
        this.samples[i].x=lerp(this.samples[i].x,center.position.x+Math.sin(center.yaw)*m,blend);
        this.samples[i].z=lerp(this.samples[i].z,center.position.z+Math.cos(center.yaw)*m,blend);
      }
      const d=(u-g.takeoffU)*this.length,after=(u-g.landingU)*this.length;
      if(d>=-approach&&d<=0)this.samples[i].y=hermite(start,lip,startGrade,.22,(d+approach)/approach,approach);
      else if(after>=0&&after<=reception)this.samples[i].y=hermite(landing,end,-.20,endGrade,after/reception,reception);
      else if(d>0&&after<0) {
        const t=d/span;
        this.samples[i].y=lerp(lip,landing,t)+4*.7*t*(1-t);
      }
    }
  }

  at(u) {
    const n = wrap(u) * this.count, i0 = Math.floor(n), i1 = (i0 + 1) % this.count;
    const f = n - i0;
    const p0 = this.samples[i0], p1 = this.samples[i1];
    const position = new THREE.Vector3().lerpVectors(p0, p1, f);
    const tangent = new THREE.Vector3().subVectors(p1, p0).normalize();
    const yaw = Math.atan2(tangent.x, tangent.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, tangent.y)));
    return { position, tangent, yaw, pitch, u: wrap(u), heightTolerance: 5 };
  }

  widthAt(u) {
    const m=Math.min(wrap(u),1-wrap(u))*this.length;
    const g=this.gaps?.[0],landing=g?(wrap(u-g.landingU+.5)-.5)*this.length:100;
    const reception=smoothstep(-18,-2,landing)*(1-smoothstep(16,38,landing));
    return this.width+Math.max(1*(1-smoothstep(16,34,m)),3*reception);
  }

  signedCurvature(u) {
    const a = this.at(u - 4 / this.length), b = this.at(u + 4 / this.length);
    return Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) / 8;
  }

  curvature(u) {
    const a = this.at(u - 2 / this.length), b = this.at(u + 2 / this.length);
    let dyaw = b.yaw - a.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    return Math.abs(dyaw) / 4;
  }

  sectionAt(u) {
    return this.sections[Math.min(this.sections.length - 1, Math.floor(wrap(u) * this.length / 5))];
  }

  baseProfile(u) {
    const n = wrap(u) * this.count, i = Math.floor(n);
    return lerp(this.baseSamples[i].y, this.baseSamples[(i + 1) % this.count].y, n - i);
  }

  obstacleHeight(u) {
    let h = 0;
    for (const f of this.features) {
      if(f.gap)continue;
      const d = wrap(u - f.start);
      h += f.height * (ease(d / f.rise) - ease((d - f.rise - f.top) / f.fall));
    }
    return h;
  }

  profile(u) {
    const m = (wrap(u + 0.5) - 0.5) * this.length;
    let base = this.baseProfile(u);
    // Level grid at y=0, with a long smooth transition into the first climb.
    base*=ease((Math.abs(m)-18)/22);
    return base + this.obstacleHeight(u);
  }

  bankAt(u) {
    const k = this.signedCurvature(u);
    let strength = smoothstep(0.005, 0.024, Math.abs(k));
    // Keep takeoff and reception transverse profiles straight and predictable.
    for (const f of this.features) {
      const d = (wrap(u - f.start + 0.5) - 0.5) * this.length;
      const end = (f.rise + f.top + f.fall) * this.length;
      strength *= 1 - smoothstep(-10, 0, d) * (1 - smoothstep(end, end + 12, d));
    }
    strength *= smoothstep(14, 32, Math.min(wrap(u), 1 - wrap(u)) * this.length);
    return { angleDeg: 18 * strength, angleRad: 18 * Math.PI / 180 * strength, turnSign: -Math.sign(k), strength };
  }

  crossHeight(u, side) {
    const bank = this.bankAt(u), outside = side * bank.turnSign;
    // Gentle progressive bowl (18° max): smooth continuous curve rising on the outside
    // to give comfortable centripetal banking without any destabilizing ruts.
    const slope = Math.tan(18 * Math.PI / 180), transition = 3.5;
    const v = Math.max(0, outside + 1);
    const cup = 0.03 * outside + (slope - 0.03) * (v < transition ? v * v / (2 * transition) : v - transition / 2) - (slope - 0.03) / (2 * transition);
    return bank.strength * cup;
  }

  surfaceHeightAt(u, side = 0) {
    const at = this.at(u), half = this.widthAt(u) / 2;
    if (Math.abs(side) <= half) return at.position.y + this.crossHeight(u, side);
    const x = at.position.x + Math.cos(at.yaw) * side, z = at.position.z - Math.sin(at.yaw) * side;
    return this.shoulderHeight(u, side, x, z) - 0.035;
  }

  buildSpatialIndex() {
    this.spatialCells = new Map();
    this.cellSize = 20;
    for (let i = 0; i < this.count; i++) {
      const a = this.samples[i], b = this.samples[(i + 1) % this.count];
      for (let x = Math.floor(Math.min(a.x, b.x) / 20); x <= Math.floor(Math.max(a.x, b.x) / 20); x++) {
        for (let z = Math.floor(Math.min(a.z, b.z) / 20); z <= Math.floor(Math.max(a.z, b.z) / 20); z++) {
          const key = `${x},${z}`;
          if (!this.spatialCells.has(key)) this.spatialCells.set(key, []);
          this.spatialCells.get(key).push(i);
        }
      }
    }
  }

  nearest(x, z, y = null) {
    const size = this.cellSize, cx = Math.floor(x / size), cz = Math.floor(z / size);
    let best = Infinity, bestIndex = Infinity, result = null;
    for (let radius = 0; radius < 32; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
          for (const i of this.spatialCells.get(`${cx + dx},${cz + dz}`) ?? []) {
            const a = this.samples[i], b = this.samples[(i + 1) % this.count];
            const vx = b.x - a.x, vz = b.z - a.z;
            const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz)));
            const px = a.x + vx * t, pz = a.z + vz * t;
            const horizontal = (x - px) ** 2 + (z - pz) ** 2;
            // A surface above the rider is not their running surface. This also
            // keeps the chase camera on the lower route at the edge of the gap.
            const dy=y===null?0:y-lerp(a.y,b.y,t)-.8;
            const d=horizontal+(dy*(dy<-.5?1.5:.7))**2;
            if (d < best || (d === best && i < bestIndex)) {
              best = d;
              bestIndex = i;
              result = { u: (i + t) / this.count, distance: Math.sqrt(horizontal), height: lerp(a.y, b.y, t), x: px, z: pz };
            }
          }
        }
      }
      const outside = Math.min(x - (cx - radius) * size, (cx + radius + 1) * size - x, z - (cz - radius) * size, (cz + radius + 1) * size - z);
      if (best <= outside * outside) return result;
    }
    return result ?? Track.prototype.nearest.call(this, x, z);
  }

  // Canyon landscape heightfield with red cliffs, jagged crags and basin
  terrainHeight(x, z, near = this.nearest(x, z)) {
    const ridge = 7 * Math.exp(-(((x + 38) / 52) ** 2) - ((z - 68) / 52) ** 2);
    const east = 5 * Math.exp(-(((x - 85) / 58) ** 2) - ((z + 55) / 68) ** 2);
    const natural = -4 + ridge + east + .7 * Math.sin(x * 0.038 + z * 0.02) + .5 * Math.sin(z * 0.065 - x * 0.024);
    const at = this.at(near.u), side = (x - at.position.x) * Math.cos(at.yaw) - (z - at.position.z) * Math.sin(at.yaw);
    const half = this.widthAt(near.u) / 2;
    const bed = at.position.y + this.crossHeight(near.u, Math.max(-half, Math.min(half, side))) - 1.1;
    let height = lerp(bed, natural, smoothstep(half + 2, half + 6, near.distance));

    // Excavate a continuous tunnel corridor for the lower track under the bridge
    const lower = this.at(this.landmarks.underpass), dx = x - lower.position.x, dz = z - lower.position.z;
    const along = dx * Math.sin(lower.yaw) + dz * Math.cos(lower.yaw);
    if (Math.abs(along) < 38) {
      const p = this.at(this.landmarks.underpass + along / this.length);
      const lateral = Math.abs((x - p.position.x) * Math.cos(p.yaw) - (z - p.position.z) * Math.sin(p.yaw));
      const weight = (1 - smoothstep(8, 14, lateral)) * (1 - smoothstep(26, 38, Math.abs(along)));
      height = lerp(height, Math.min(height, p.position.y - 1.1), weight);
    }
    const upper=this.at(this.landmarks.bridge);
    const ux=x-upper.position.x,uz=z-upper.position.z;
    const longitudinal=ux*Math.sin(upper.yaw)+uz*Math.cos(upper.yaw);
    const lateral=Math.abs(ux*Math.cos(upper.yaw)-uz*Math.sin(upper.yaw));
    // Cut the ground as well as the road, including both shoulder strips.
    const excavation=(1-smoothstep(7,16,Math.abs(longitudinal)))*(1-smoothstep(13,19,lateral));
    height=lerp(height,Math.min(height,lower.position.y-1.2),excavation);
    return height;
  }

  rampSupport(u) {
    const m = Math.abs(wrap(u - this.landmarks.bridge + 0.5) - 0.5) * this.length;
    return 1 - smoothstep(13, 29, m);
  }

  shoulderWidth(u,side) {
    const k=this.signedCurvature(u),inside=side*Math.sign(k)>0;
    // Inner shoulders must not fold over in the tightest part of an S-bend.
    return inside?Math.max(.65,Math.min(3,.84/Math.max(.001,Math.abs(k))-this.widthAt(u)/2)):3;
  }

  shoulderHeight(u,side,x,z) {
    const half=this.widthAt(u)/2,edge=this.at(u).position.y+this.crossHeight(u,Math.sign(side)*half)+.035;
    const d=Math.abs(side)-half,width=this.shoulderWidth(u,side),t=Math.max(0,Math.min(1,d/width));
    const bank=this.bankAt(u),outside=side*bank.turnSign>0;
    const support=edge+(outside?.35*bank.strength:0)*ease(t)-.15*t;
    const end=lerp(this.terrainHeight(x,z)+.05,support,this.rampSupport(u));
    // The first two thirds provide a forgiving run-off, followed by a soft earth edge.
    return lerp(support,end,smoothstep(.65,1,t));
  }

  sceneryAllowed(x, z) {
    const near = this.nearest(x, z);
    const halfWidth = (this.widthAt(near.u) || this.width) / 2;
    const center=this.at(this.landmarks.bridge).position;
    if(Math.hypot(x-center.x,z-center.z)<20)return false;
    return near.distance > halfWidth + 4.5;
  }

  // One curved road surface plus separate shoulder strips: no overlapping
  // tilted meshes or hidden collider shelves inside the banked corners.
  createRibbon(width, offset, material, world, RAPIER) {
    const shoulder = width > this.width, positions = [], colors = [], indices = [], c = new THREE.Color();
    const strips = shoulder ? [[-1, 4], [1, 4]] : [[0, 16]];
    for (const [edge, lanes] of strips) {
      const base = positions.length / 3;
      for (let i = 0; i <= this.count; i++) {
        const u = i / this.count, p = this.samples[i % this.count];
        const prev = this.samples[(i + this.count - 1) % this.count], next = this.samples[(i + 1) % this.count];
        const dx = next.x - prev.x, dz = next.z - prev.z, len = Math.hypot(dx, dz), half = this.widthAt(u) / 2;
        for (let j = 0; j <= lanes; j++) {
          const t=j/lanes,extra=shoulder?this.shoulderWidth(u,edge):0;
          const side=shoulder?(edge<0?-half-extra+extra*t:half+extra*t):(2*t-1)*half;
          const x = p.x + dz / len * side, z = p.z - dx / len * side;
          let y = p.y + this.crossHeight(u, side) + offset;
          if (shoulder) {
            y = this.shoulderHeight(u, side, x, z);
          }
          positions.push(x, y, z);
          const wear = 0.95 + 0.045 * Math.cos(side * 1.4) + 0.012 * Math.sin(i * 0.17 + j * 0.8);
          c.set(material.color).multiplyScalar(wear);
          colors.push(c.r, c.g, c.b);
          if (i < this.count && j < lanes && !this.isGap((i+.5)/this.count)) {
            const a = base + i * (lanes + 1) + j, b = a + lanes + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
          }
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    mesh.name = shoulder ? 'canyon-shoulders' : 'canyon-banked-road';
    mesh.receiveShadow = true;
    this.group.add(mesh);
    if (world && RAPIER) world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices)).setFriction(0.68));
    return mesh;
  }

  // Earthen cut faces close each ramp without spanning the void or the lower lane.
  buildGapFaces(world,RAPIER) {
    const positions=[],indices=[];
    for(const g of this.gaps)for(const u of [g.takeoffU,g.landingU]) {
      const at=this.at(u),half=this.widthAt(u)/2;
      const base=positions.length/3;
      for(const depth of [0,1.2])for(const side of [-half-3,half+3]) {
        positions.push(at.position.x+Math.cos(at.yaw)*side,at.position.y+.02-depth,
          at.position.z-Math.sin(at.yaw)*side);
      }
      indices.push(base,base+2,base+1,base+1,base+2,base+3);
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0x81432d,roughness:1,side:THREE.DoubleSide}));
    mesh.name='canyon-gap-faces';mesh.castShadow=true;mesh.receiveShadow=true;this.group.add(mesh);
    if(world&&RAPIER)world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions),new Uint32Array(indices)).setFriction(.68));
  }

  build(scene, world, RAPIER) {
    // Red Canyon / Ochre Sandstone terrain
    const size = 380, n = 160, positions = [], colors = [], indices = [], color = new THREE.Color();
    for (let z = 0; z <= n; z++) {
      for (let x = 0; x <= n; x++) {
        const px = (x / n - 0.5) * size, pz = (z / n - 0.5) * size;
        positions.push(px, this.terrainHeight(px, pz), pz);

        // Warm canyon red clay / ochre landscape colors
        const rockWarmth = 0.035 + 0.006 * Math.sin(px * 0.032) * Math.cos(pz * 0.026);
        color.setHSL(rockWarmth, 0.52, 0.38 + 0.018 * Math.sin(px * 0.048) * Math.cos(pz * 0.055), THREE.SRGBColorSpace);
        colors.push(color.r, color.g, color.b);

        if (x < n && z < n) {
          const a = z * (n + 1) + x, b = a + n + 1;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      flatShading: true
    }));
    mesh.receiveShadow = true;
    this.group.add(mesh);

    if (world && RAPIER) world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices)).setFriction(0.8));

    // Dirt ribbons: dark ochre base shoulder (16.5m) and vibrant red clay racing line (13m)
    this.createRibbon(16.5, 0, { color: 0x8a452a }, world, RAPIER);
    this.createRibbon(this.width, 0.035, { color: 0xb54e32 }, world, RAPIER);
    this.buildGapFaces(world, RAPIER);

    scene.add(this.group);
  }
}
