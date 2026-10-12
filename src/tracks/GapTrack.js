import * as THREE from 'three';
import { Track } from '../Track.js';
import { lerp, smoothstep } from '../math.js';

// Image coordinates preserve the reference proportions in the aerial plan.
// The route starts below the upper-left crossing, travelling north.
const imagePoint = (x, z) => new THREE.Vector3((x - 760) * .32, 1, (z - 560) * .32);
export const REFERENCE_POINTS = [
  [594,500], [594,435], [594,370], [594,300], [590,230],
  [555,183], [475,161], [365,161], [265,174], [195,208],
  [168,260], [170,307], [205,347], [265,366], [350,370],
  [440,370], [494,370], [555,370], [633,370], [740,370],
  [850,370], [952,370], [1070,374], [1190,373], [1265,350],
  [1306,308], [1305,261], [1267,219], [1195,187], [1105,167],
  [1030,157], [1000,163], [975,180], [958,205], [952,235],
  [952,270], [952,300], [952,334], [952,406], [952,450], [960,488], [986,530],
  [1019,588], [1020,640], [1002,690], [1002,726], [997,786],
  [993,839], [1018,896], [1087,938], [1180,953], [1273,938],
  [1342,896], [1367,839], [1342,782], [1273,740],
  [1180,725], [1140,726], [1040,726], [964,726], [870,734],
  [790,735], [707,735], [643,722], [606,689], [594,642],
  [594,576], [594,538],
].map(([x,z]) => [(x-760)*.32, (z-560)*.32, 1]);

const wrap = u => ((u % 1) + 1) % 1;

export class GapTrack {
  constructor() {
    this.width = 24;
    this.id = 'gaptrack';
    this.title = 'Gap Circuit';
    this.circuitId = 'gap-circuit-v5';
    this.number = '03';
    this.respawnCount = 64;
    this.strictRoute = true;
    this.treeScale = 1.65;
    this.river = [[-248,56],[-237,83],[-203,109],[-174,135],[-144,169],[-128,215],[-125,260]];
    const pts = REFERENCE_POINTS.map(([x,z,y]) => new THREE.Vector3(x,y,z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.curve.arcLengthDivisions = 16000;
    this.length = this.curve.getLength();
    this.count = Math.ceil(this.length / .5);
    this.samples = this.curve.getSpacedPoints(this.count);

    // Locate each anchor on its own branch, never by an obsolete lap fraction.
    const anchor = (x,z,from,to) => {
      const target=imagePoint(x,z);let best=Infinity,index=0;
      for(let i=Math.floor(from*this.count);i<Math.ceil(to*this.count);i++) {
        const d=this.samples[i].distanceToSquared(target);
        if(d<best){best=d;index=i;}
      }
      return index/this.count;
    };
    this.gaps = [
      {id:1, takeoffU:anchor(555,370,.15,.4), landingU:anchor(633,370,.15,.4), underpassU:anchor(594,370,0,.1)},
      {id:2, takeoffU:anchor(952,334,.4,.7), landingU:anchor(952,406,.4,.7), underpassU:anchor(952,370,.2,.5)},
      {id:3, takeoffU:anchor(1040,726,.75,.98), landingU:anchor(964,726,.75,.98), underpassU:anchor(1002,726,.55,.8)},
    ];
    this.adjustGapLips();
    // Rhythmic whoops and rollers across long straights; leave the grid, turns and gap jump corridors clear.
    const bumpDefs = [
      // Sector 1: Northwest rhythm whoops (8 whoops)
      { m: 139, length: 8, height: 0.45 },
      { m: 146, length: 8, height: 0.45 },
      { m: 153, length: 8, height: 0.45 },
      { m: 160, length: 8, height: 0.45 },
      { m: 167, length: 8, height: 0.45 },
      { m: 174, length: 8, height: 0.45 },
      { m: 181, length: 8, height: 0.45 },
      { m: 188, length: 8, height: 0.45 },
      // Sector 2: Approach to Gap Jump 1 (2 rollers)
      { m: 314, length: 14, height: 0.55 },
      { m: 328, length: 14, height: 0.55 },
      // Sector 3: Post-Gap Jump 1 central backstraight (3 wave rollers)
      { m: 458, length: 14, height: 0.55 },
      { m: 472, length: 14, height: 0.55 },
      { m: 486, length: 14, height: 0.55 },
      // Sector 4: High East plateau rhythm section (4 rollers)
      { m: 692, length: 14, height: 0.55 },
      { m: 706, length: 14, height: 0.55 },
      { m: 720, length: 14, height: 0.55 },
      { m: 734, length: 14, height: 0.55 },
      // Sector 5: South Central straight (2 rollers)
      { m: 1058, length: 14, height: 0.55 },
      { m: 1074, length: 14, height: 0.55 },
      // Sector 6: Post-Gap Jump 3 western straight (3 wave rollers)
      { m: 1332, length: 14, height: 0.55 },
      { m: 1346, length: 14, height: 0.55 },
      { m: 1360, length: 14, height: 0.55 },
      // Sector 7: Final sprint to the finish line (1 roller)
      { m: 1444, length: 14, height: 0.55 },
    ];
    this.bumps = bumpDefs.filter(b => !this.gaps.some(g =>
      b.m+b.length/2>g.landingU*this.length && b.m-b.length/2<g.landingU*this.length+g.receptionLength+8
    )).map(b => ({ centerU: b.m / this.length, length: b.length, height: b.height }));
    for(const bump of this.bumps)for(let i=0;i<=this.count;i++) {
      const distance=(i/this.count-bump.centerU)*this.length;
      if(Math.abs(distance)<bump.length/2) {
        this.samples[i].y+=bump.height*Math.cos(Math.PI*distance/bump.length)**2;
      }
    }
    for(const g of this.gaps) {
      g.name=`GAP JUMP ${g.id}`;
      g.takeoffLip=this.at(g.takeoffU).position;
      g.landingStart=this.at(g.landingU).position;
      g.underpassPos=this.at(g.underpassU).position;
      g.corridor={minX:Math.min(g.takeoffLip.x,g.landingStart.x)-15,maxX:Math.max(g.takeoffLip.x,g.landingStart.x)+15,minZ:Math.min(g.takeoffLip.z,g.landingStart.z)-15,maxZ:Math.max(g.takeoffLip.z,g.landingStart.z)+15};
    }
    this.features=this.gaps.map(g=>({kind:'jump',start:g.takeoffU-25/this.length,rise:25/this.length,top:0,fall:(g.landingU-g.takeoffU)+g.receptionLength/this.length,height:3,approachSpeed:18.5,targetSpeed:21,label:g.name}));
    this.aiSpeedZones=[]; // The existing controller reads curvature from this spline.
    this.cornerMarkers=[];
    // Ten ordered timing checkpoints cleanly distributed along the circuit:
    // Placed on flat straights and gentle approaches, away from whoops, rollers and underpasses,
    // and never immediately after jump landings or in flight corridors.
    const checkpointDistances = [0, 110, 240, 350, 545, 670, 785, 980, 1180, 1395];
    this.timingUs = checkpointDistances.map(m => m / this.length);
    this.respawnUs=Array.from({length:this.respawnCount},(_,i)=>i/this.respawnCount)
      .filter(u=>!this.gaps.some(g=>u>g.takeoffU-12/this.length&&u<g.landingU+(g.receptionLength+5)/this.length));
    this.signs=this.gaps.map(g=>[g.takeoffU-30/this.length,g.name]);
    this.sections=Array.from({length:Math.ceil(this.length/5)},(_,i)=>({kind:this.curvature(i*5/this.length)>.015?'corner':'straight',start:i*5,end:(i+1)*5,length:5}));
    this.group=new THREE.Group();
    this.group.name=this.title;
    this.buildSpatialIndex();
  }

  adjustGapLips() {
    // Preserve the 19-degree takeoffs and extend the downhill receptions.
    // Only the racing line spans the void; neither road mesh nor collider does.
    for(const g of this.gaps) {
      g.receptionLength=75;
      const lip=this.samples[Math.round(g.takeoffU*this.count)];
      const previous=this.samples[Math.round(g.takeoffU*this.count)-2];
      const direction=lip.clone().sub(previous).setY(0).normalize();
      for(let i=0;i<=this.count;i++) {
        const d=(i/this.count-g.takeoffU)*this.length;
        const landing=(i/this.count-g.landingU)*this.length;
        const approach=g.id===2?30:48, base=g.id===2?6:1, reception=8.6;
        // Keep the touchdown corridor aligned with the launch before returning to the bend.
        if(g.id===2&&d>0&&landing<100) {
          const blend=.45*(1-smoothstep(30,100,landing));
          this.samples[i].x=lerp(this.samples[i].x,lip.x+direction.x*d,blend);
          this.samples[i].z=lerp(this.samples[i].z,lip.z+direction.z*d,blend);
        }
        if(g.id===2&&i/this.count>g.underpassU+30/this.length&&d < -approach) {
          this.samples[i].y=1+5*smoothstep(0,60,(i/this.count-g.underpassU)*this.length-30);
        }
        if(d>=-approach&&d<=0) {
          const t=(d+approach)/approach;
          this.samples[i].y=base+(10-base)*(-2*t*t*t+3*t*t)+approach*(g.id===1?.355:.34)*(t*t*t-t*t);
        } else if(landing>=0&&landing<=g.receptionLength) {
          // Hold the landing grade through the fast touchdown zone, then ease to level.
          const grade=(reception-1)/65;
          if(landing<=55)this.samples[i].y=reception-grade*landing;
          else {
            const t=(landing-55)/20;
            this.samples[i].y=1+10*grade-20*grade*(t-t*t*t+.5*t*t*t*t);
          }
        } else if(d>0&&landing<0) {
          const t=d/((g.landingU-g.takeoffU)*this.length);
          this.samples[i].y=lerp(10,reception,t)+4*1.6*t*(1-t);
        }
      }
    }
  }

  isGap(u) {
    u = wrap(u);
    return this.gaps.some(g => u >= g.takeoffU && u <= g.landingU);
  }

  gapAt(u) {
    u = wrap(u);
    return this.gaps.find(g => u >= g.takeoffU && u <= g.landingU) ?? null;
  }

  at(u) {
    const at = Track.prototype.at.call(this, u);
    at.heightTolerance = 6;
    return at;
  }

  sectionAt(u) {
    return this.sections[Math.min(this.sections.length - 1, Math.floor(wrap(u) * this.length / 5))];
  }

  widthAt(u) {
    return this.width+Math.max(...this.gaps.map(g => {
      const d=wrap(u-g.landingU)*this.length;
      return (g.id===2?14:2)*(1-smoothstep(g.receptionLength-20,g.receptionLength,d));
    }));
  }

  riverDistance(x,z) {
    let distance=Infinity;
    for(let i=1;i<this.river.length;i++) {
      const [ax,az]=this.river[i-1],[bx,bz]=this.river[i],dx=bx-ax,dz=bz-az;
      const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)));
      distance=Math.min(distance,Math.hypot(x-ax-t*dx,z-az-t*dz));
    }
    return distance;
  }

  sceneryAllowed(x, z) {
    if (this.riverDistance(x, z) < 23) return false;
    const near = this.nearest(x, z);
    const halfWidth = (this.widthAt(near.u) || this.width) / 2;
    if (near.distance < halfWidth + 5.5) return false;
    // Keep the 3 gap jump flight zones completely unobstructed
    for (const g of this.gaps) {
      if (x >= g.corridor.minX && x <= g.corridor.maxX && z >= g.corridor.minZ && z <= g.corridor.maxZ) {
        return false;
      }
      if (Math.hypot(x - g.underpassPos.x, z - g.underpassPos.z) < 22) {
        return false;
      }
    }
    return true;
  }

  buildSpatialIndex() {
    this.spatialCells = new Map();
    this.cellSize = 24;
    for (let i = 0; i < this.count; i++) {
      const a = this.samples[i], b = this.samples[i + 1];
      const minX = Math.floor(Math.min(a.x, b.x) / this.cellSize);
      const maxX = Math.floor(Math.max(a.x, b.x) / this.cellSize);
      const minZ = Math.floor(Math.min(a.z, b.z) / this.cellSize);
      const maxZ = Math.floor(Math.max(a.z, b.z) / this.cellSize);
      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          const key = `${x},${z}`;
          if (!this.spatialCells.has(key)) this.spatialCells.set(key, []);
          this.spatialCells.get(key).push(i);
        }
      }
    }
  }

  nearestCheckpoint(position) {
    // A rider may use the full 24 m road. At a crossing, horizontal distance
    // to the OTHER centreline must not outweigh the height of the actual road.
    // This projection is only for checkpoints/ranking: terrain and physics
    // keep their existing nearest() queries and geometry.
    const branch=this.nearest(position.x, position.z, position.y, 3);
    // Height selects the road, not progress on a ramp: projecting a chassis
    // above a slope in 3D would otherwise place it ahead of a gate too early.
    const centre=Math.floor(branch.u*this.count),radius=Math.ceil(40*this.count/this.length);
    let best=Infinity,result=branch;
    for(let offset=-radius;offset<=radius;offset++) {
      const i=(centre+offset+this.count)%this.count,a=this.samples[i],b=this.samples[i+1];
      const vx=b.x-a.x,vz=b.z-a.z;
      const t=Math.max(0,Math.min(1,((position.x-a.x)*vx+(position.z-a.z)*vz)/(vx*vx+vz*vz)));
      const x=a.x+vx*t,z=a.z+vz*t,d2=(position.x-x)**2+(position.z-z)**2;
      if(d2<best){best=d2;result={u:(i+t)/this.count,distance:Math.sqrt(d2),height:lerp(a.y,b.y,t),x,z};}
    }
    return result;
  }

  nearest(x, z, y = null, heightWeight = .7) {
    const size = this.cellSize, cx = Math.floor(x / size), cz = Math.floor(z / size);
    let best = Infinity, bestIndex = Infinity, result = null;

    // Check spatial cells outwards
    for (let radius = 0; radius < 32; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
          for (const i of this.spatialCells.get(`${cx + dx},${cz + dz}`) ?? []) {
            const a = this.samples[i], b = this.samples[i + 1];
            const vx = b.x - a.x, vz = b.z - a.z;
            const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz)));
            const px = a.x + vx * t, pz = a.z + vz * t, py = lerp(a.y, b.y, t);

            let d2 = (x - px) ** 2 + (z - pz) ** 2;
            if (y !== null) {
              // 3D altitude discrimination for overlapping bridges/underpasses
              const dy = y - py;
              d2 += (dy * heightWeight) ** 2;
            }

            if (d2 < best || (d2 === best && i < bestIndex)) {
              best = d2;
              bestIndex = i;
              result = {
                u: (i + t) / this.count,
                distance: Math.sqrt((x - px) ** 2 + (z - pz) ** 2),
                height: py,
                x: px,
                z: pz
              };
            }
          }
        }
      }
      const outside = Math.min(x - (cx - radius) * size, (cx + radius + 1) * size - x, z - (cz - radius) * size, (cz + radius + 1) * size - z);
      if (best <= outside * outside) return result;
    }
    return result ?? Track.prototype.nearest.call(this, x, z);
  }

  curvature(u) {
    const a = this.at(u - 2 / this.length), b = this.at(u + 2 / this.length);
    return Math.abs(Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw))) / 4;
  }

  terrainHeight(x, z, near = this.nearest(x, z, 1.0)) {
    // Natural undulating outdoor motocross terrain
    const natural = 0.5 + 1.8 * Math.sin(x * 0.022) * Math.cos(z * 0.026) + 1.1 * Math.sin(z * 0.045 + x * 0.015);

    // Keep underpass areas cleanly excavated at ground level
    let groundTarget = near.height - 0.85;
    if (this.isGap(near.u)) {
      // Near upper jumps, keep meadow on natural terrain below the flying bridge
      groundTarget = natural;
    }

    const meadow=lerp(groundTarget, natural, smoothstep(this.width/2, 30, near.distance));
    return lerp(-2.5,meadow,smoothstep(13,23,this.riverDistance(x,z)));
  }

  createRibbon(width, offset, material, world, RAPIER) {
    const lanes = 4;
    const shoulder = width > this.width;
    const positions = [], colors = [], indices = [];
    const c = new THREE.Color();

    // Group samples into continuous track segments, breaking at each of the 3 gaps
    let currentSegment = [];
    const segments = [];

    for (let i = 0; i < this.count; i++) {
      const u = i / this.count;
      if (this.isGap(u)) {
        if (currentSegment.length > 0) {
          segments.push(currentSegment);
          currentSegment = [];
        }
      } else {
        currentSegment.push(i);
      }
    }
    if (currentSegment.length > 0) {
      // Connect wrap-around segment if applicable
      if (segments.length > 0 && !this.isGap(0) && !this.isGap((this.count - 1) / this.count)) {
        segments[0] = currentSegment.concat(segments[0]);
      } else {
        segments.push(currentSegment);
      }
    }

    // Build geometry for each disconnected segment
    for (const seg of segments) {
      if (seg.length < 2) continue;
      const segStartVertex = positions.length / 3;

      for (let s = 0; s < seg.length; s++) {
        const i = seg[s];
        const p = this.samples[i % this.count];
        const prev = this.samples[(i + this.count - 1) % this.count];
        const next = this.samples[(i + 1) % this.count];
        const dx = next.x - prev.x, dz = next.z - prev.z, len = Math.hypot(dx, dz) || 1;

        const laneWidth = this.widthAt(i / this.count);
        const fullWidth = laneWidth + (shoulder ? 4.0 : 0);

        for (let j = 0; j <= lanes; j++) {
          const side = (j / lanes - 0.5) * fullWidth;
          const drop = shoulder ? 0.9 * smoothstep(laneWidth / 2 - 0.1, laneWidth / 2 + 2, Math.abs(side)) : 0;
          positions.push(p.x + dz / len * side, p.y + offset - drop, p.z - dx / len * side);

          c.set(material.color).multiplyScalar(0.97 + 0.03 * Math.sin(i * 1.31 + j * 12.37));
          colors.push(c.r, c.g, c.b);

          if (s < seg.length - 1 && j < lanes) {
            const a = segStartVertex + s * (lanes + 1) + j;
            const b = a + lanes + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
          }
        }
      }

      if(shoulder) {
        // Earthen sides support the ramps without spanning any of the voids.
        for(const side of [0,lanes])for(let j=0;j<seg.length-1;j++) {
          const a=segStartVertex+j*(lanes+1)+side,b=a+lanes+1;
          const base=positions.length/3;
          for(const top of [a,b]) {
            const x=positions[top*3],y=positions[top*3+1],z=positions[top*3+2];
            positions.push(x,Math.min(y-.15,this.terrainHeight(x,z)),z);
            colors.push(.34,.26,.15);
          }
          indices.push(a,base,b,b,base,base+1);
        }
      }

      // Add solid lip face at the end of takeoff ramp (vertical drop face)
      const lastSampleIdx = seg[seg.length - 1];
      const lastU = (lastSampleIdx % this.count) / this.count;
      const isTakeoffEnd = this.gaps.some(g => Math.abs(lastU - g.takeoffU) < 0.005);
      if (isTakeoffEnd && !shoulder) {
        const lipBaseVertex = positions.length / 3;
        const p = this.samples[lastSampleIdx % this.count];
        const prev = this.samples[(lastSampleIdx + this.count - 1) % this.count];
        const dx = p.x - prev.x, dz = p.z - prev.z, len = Math.hypot(dx, dz) || 1;
        const laneWidth = this.widthAt(lastU);

        // Add 2 lower vertices for the lip drop face
        positions.push(p.x + dz / len * (-laneWidth / 2), p.y + offset - 1.8, p.z - dx / len * (-laneWidth / 2));
        positions.push(p.x + dz / len * ( laneWidth / 2), p.y + offset - 1.8, p.z - dx / len * ( laneWidth / 2));
        colors.push(0.35, 0.25, 0.18, 0.35, 0.25, 0.18);

        const topL = segStartVertex + (seg.length - 1) * (lanes + 1);
        const topR = topL + lanes;
        indices.push(topL, lipBaseVertex, topR, topR, lipBaseVertex, lipBaseVertex + 1);
      }

      // Add receptive entry bevel face at the start of landing ramp (sloping forward/downward)
      const firstSampleIdx = seg[0];
      const firstU = (firstSampleIdx % this.count) / this.count;
      const isLandingStart = this.gaps.some(g => Math.abs(firstU - g.landingU) < 0.005);
      if (isLandingStart && !shoulder) {
        const entryBaseVertex = positions.length / 3;
        const p = this.samples[firstSampleIdx % this.count];
        const next = this.samples[(firstSampleIdx + 1) % this.count];
        const dx = next.x - p.x, dz = next.z - p.z, len = Math.hypot(dx, dz) || 1;
        const laneWidth = this.widthAt(firstU);

        // Add 2 lower vertices sloping backward/downward into the void (absorbing entry transition)
        positions.push(p.x - dx / len * 1.5 + dz / len * (-laneWidth / 2), p.y + offset - 1.8, p.z - dz / len * 1.5 - dx / len * (-laneWidth / 2));
        positions.push(p.x - dx / len * 1.5 + dz / len * ( laneWidth / 2), p.y + offset - 1.8, p.z - dz / len * 1.5 - dx / len * ( laneWidth / 2));
        colors.push(0.35, 0.25, 0.18, 0.35, 0.25, 0.18);

        const topL = segStartVertex;
        const topR = topL + lanes;
        indices.push(topL, entryBaseVertex, topR, topR, entryBaseVertex, entryBaseVertex + 1);
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
      side: THREE.DoubleSide
    }));
    mesh.receiveShadow = true;
    this.group.add(mesh);

    if (world && RAPIER) {
      world.createCollider(
        RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices)).setFriction(0.65)
      );
    }
    return mesh;
  }

  build(scene, world, RAPIER) {
    // Large surrounding natural terrain mesh
    const size = 520, n = 160;
    const positions = [], colors = [], indices = [];
    const color = new THREE.Color();

    for (let z = 0; z <= n; z++) {
      for (let x = 0; x <= n; x++) {
        const px = (x / n - 0.5) * size;
        const pz = (z / n - 0.5) * size;
        positions.push(px, this.terrainHeight(px, pz), pz);

        // Rich dirt/grass shading
        color.setHSL(0.265 + 0.010 * Math.sin(x * 0.2), 0.38, 0.35 + 0.015 * Math.sin(x * 0.6 + z * 0.4), THREE.SRGBColorSpace);

        // Slightly earthier tone in the excavated underpass hollows
        for (const g of this.gaps) {
          if (Math.hypot(px - g.underpassPos.x, pz - g.underpassPos.z) < 22) {
            color.setHSL(0.11, 0.32, 0.42, THREE.SRGBColorSpace);
          }
        }
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

    world.createCollider(
      RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices)).setFriction(0.8)
    );

    // Build the track ribbon (shoulder + racing surface) with true air gap voids
    this.createRibbon(this.width + 4, 0.0, { color: 0x947c58 }, world, RAPIER);
    this.createRibbon(this.width, 0.035, { color: 0xd3ac76 }, world, RAPIER);

    // Low-poly water along the southwest edge, as in the reference.
    const waterPositions=[],waterIndices=[];
    this.river.forEach(([x,z],i)=>{
      const a=this.river[Math.max(0,i-1)],b=this.river[Math.min(this.river.length-1,i+1)];
      const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
      for(const side of [-1,1])waterPositions.push(x+dz/len*15*side,-1,z-dx/len*15*side);
      if(i) {const j=i*2;waterIndices.push(j-2,j,j-1,j-1,j,j+1);}
    });
    const waterGeometry=new THREE.BufferGeometry();
    waterGeometry.setAttribute('position',new THREE.Float32BufferAttribute(waterPositions,3));
    waterGeometry.setIndex(waterIndices);waterGeometry.computeVertexNormals();
    const water=new THREE.Mesh(waterGeometry,new THREE.MeshStandardMaterial({color:0x4b99b2,roughness:.8,side:THREE.DoubleSide,flatShading:true}));
    water.name='southwest-river';this.group.add(water);
    scene.add(this.group);
  }
}
