import {MOTORCYCLE_COLLISION_CONFIG as CONFIG,heading,solveMotorcycles} from '../../shared/collisions.js';

// Horizontal chassis capsules share the server's continuous solver. Rapier CCD
// remains enabled on the terrain body. Separate motorcycle constraints avoid
// changing chassis mass, wheel raycasts, suspension or launching bikes vertically.
export class MotorcycleConstraints {
  constructor(){this.proxies=new Map();this.contacts=[];this.renderPrevious=new Map();}
  clear(){this.proxies.clear();this.contacts=[];this.renderPrevious.clear();}
  pose(bike,id){const v=bike.body.linvel();return {id,x:bike.position.x,y:bike.position.y,z:bike.position.z,vx:v.x,vz:v.z,forward:heading(bike.rotation.toArray())};}
  step(bike,id,before,remotes,now,dt) {
    const own=this.pose(bike,id),players=[own],previous=new Map([[id,before]]),active=new Set();
    for(const [remoteId,remote] of remotes) {
      const frame=remote.latest,s=frame?.state;if(!s||frame.disconnected||frame.dnf||frame.finished)continue;
      active.add(remoteId);
      const sampleTime=Math.min(frame.serverTime,Math.max(frame.serverTime-600,s.timestamp??frame.serverTime));
      const age=Math.max(0,now-sampleTime),prediction=Math.min(age,CONFIG.maxPredictionMs)/1000;
      const target={id:remoteId,x:s.position[0]+s.velocity[0]*prediction,y:s.position[1]+s.velocity[1]*prediction,z:s.position[2]+s.velocity[2]*prediction,vx:age<CONFIG.maxPredictionMs?s.velocity[0]:0,vz:age<CONFIG.maxPredictionMs?s.velocity[2]:0,forward:heading(s.rotation),version:frame.resetVersion};
      let proxy=this.proxies.get(remoteId);
      if(!proxy||proxy.version!==frame.resetVersion){proxy={...target};this.proxies.set(remoteId,proxy);this.renderPrevious.delete(remoteId);}
      previous.set(remoteId,{...proxy});
      // An in-flight pre-impact packet must not restore the closing velocity
      // that this client just removed, otherwise repeated contacts add energy.
      const blocked=proxy.blocked&&sampleTime<=proxy.blocked.at?proxy.blocked:null;
      if(blocked){const n=blocked.normal,closing=(target.vx-blocked.vx)*n.x+(target.vz-blocked.vz)*n.z;if(closing<0){target.vx-=n.x*closing;target.vz-=n.z*closing;}const advance=(target.x-proxy.x)*n.x+(target.z-proxy.z)*n.z;if(advance<0){target.x-=n.x*advance;target.z-=n.z*advance;}}
      const fresh=proxy.stamp!==frame.serverTime;
      if(fresh){proxy.vx=target.vx;proxy.vz=target.vz;proxy.stamp=frame.serverTime;}
      if(age>=CONFIG.maxPredictionMs)proxy.vx=proxy.vz=0;
      const blend=1-Math.exp(-dt/.10);
      proxy.x+=proxy.vx*dt;proxy.z+=proxy.vz*dt;
      proxy.x+=(target.x-proxy.x)*blend;proxy.z+=(target.z-proxy.z)*blend;
      proxy.y=target.y;proxy.forward=target.forward;
      players.push(proxy);
    }
    for(const key of this.proxies.keys())if(!active.has(key))this.proxies.delete(key);
    this.contacts=solveMotorcycles(players,previous);
    for(const hit of this.contacts)for(const [p,sign] of [[hit.a,1],[hit.b,-1]])if(p.id!==id){p.blocked={at:now,normal:{x:hit.normal.x*sign,z:hit.normal.z*sign},vx:p.vx,vz:p.vz};}
    const v=bike.body.linvel();bike.body.setLinvel({x:own.vx,y:v.y,z:own.vz},true);
    bike.position.x=own.x;bike.position.z=own.z;bike.body.setTranslation(bike.position,true);
  }
  // Correct the rendered envelopes too: interpolation must not draw riders
  // through each other even while an authoritative correction is easing out.
  render(localBike,localPhysics,id,remotes,offset) {
    const make=(id,group)=>({id,x:group.position.x,y:group.position.y,z:group.position.z,vx:0,vz:0,forward:heading(group.quaternion.toArray()),group});
    localBike.group.position.x+=offset.x;localBike.group.position.z+=offset.z;
    const players=[make(id,localBike.group)];
    for(const [remoteId,remote] of remotes)if(remote.bike.group.visible&&!remote.latest?.finished){
      const proxy=this.proxies.get(remoteId),group=remote.bike.group;
      if(proxy){const distance=Math.hypot(proxy.x-localPhysics.position.x,proxy.z-localPhysics.position.z),blend=Math.max(0,Math.min(1,(35-distance)/20));group.position.x+=(proxy.x-group.position.x)*blend;group.position.z+=(proxy.z-group.position.z)*blend;group.position.y+=(proxy.y-group.position.y)*blend;}
      players.push({...make(remoteId,group),pose:remote.pose});
    }
    solveMotorcycles(players,this.renderPrevious);
    this.renderPrevious=new Map(players.map(p=>[p.id,{...p}]));
    for(const p of players){p.group.position.x=p.x;p.group.position.z=p.z;if(p.pose)p.pose.position.copy(p.group.position);}
  }
}
