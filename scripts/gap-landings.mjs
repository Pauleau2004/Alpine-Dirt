import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GapTrack } from '../src/tracks/GapTrack.js';
import { BikePhysics } from '../src/BikePhysics.js';

export async function measureGapLandings() {
  await RAPIER.init();
  const track=new GapTrack(),world=new RAPIER.World({x:0,y:-9.81,z:0});
  world.timestep=1/120;
  track.build(new THREE.Scene(),world,RAPIER);
  const bike=new BikePhysics(RAPIER,world),results=[];
  try {
    for(const gap of track.gaps)for(const speed of [21,26,32,36])for(const lane of [-6,0,6]) {
      const spawn=track.at(gap.takeoffU-12/track.length);
      spawn.position.x+=Math.cos(spawn.yaw)*lane;
      spawn.position.z-=Math.sin(spawn.yaw)*lane;
      bike.reset(spawn);
      bike.body.setLinvel({x:Math.sin(spawn.yaw)*speed,y:Math.tan(spawn.pitch)*speed,z:Math.cos(spawn.yaw)*speed},true);
      let flight=0,peak=0,launch=null,result=null;
      for(let i=0;i<1200;i++) {
        const position=bike.position.clone(),velocity=bike.body.linvel();
        bike.beforeStep(1/120,{throttle:1,brake:0,steer:0});
        if(!bike.grounded) {
          if(!launch)launch=position.clone();
          flight+=1/120;peak=Math.max(peak,position.y);
        } else {
          if(flight>.4) {
            const near=track.nearest(position.x,position.z,position.y),at=track.at(near.u);
            result={gap:gap.id,speed,lane,flight:+flight.toFixed(2),distance:+position.distanceTo(launch).toFixed(1),height:+(peak-launch.y).toFixed(1),onRoad:near.distance<track.widthAt(near.u)/2-1,lateral:+near.distance.toFixed(1),afterLanding:+((near.u-gap.landingU)*track.length).toFixed(1),slope:+(at.pitch*180/Math.PI).toFixed(1),impact:+(-velocity.y*Math.cos(at.pitch)+Math.hypot(velocity.x,velocity.z)*Math.sin(at.pitch)).toFixed(1)};
            break;
          }
          flight=0;launch=null;peak=0;
        }
        world.step();bike.afterStep();
      }
      results.push(result??{gap:gap.id,speed,lane,missed:true});
    }
  } finally {world.free();}
  return results;
}

if(process.argv[1]?.replaceAll('\\','/').endsWith('/gap-landings.mjs'))console.table(await measureGapLandings());
