import {MULTIPLAYER_COLLISION_CONFIG as CONFIG,clamp,heading,capsuleContact,solveMotorcycles} from '../shared/collisions.js';

export class PlayerCollisionSystem {
  constructor(raceId,config=CONFIG) {this.raceId=raceId;this.config=config;this.contacts=new Map();this.previous=new Map();this.lastEvents=new Map();this.pending=[];this.sequence=0;this.count=0;this.lastIntensity=0;this.lastRelativeSpeed=0;}
  removePlayer(id) {
    this.previous.delete(id);
    for(const [key,c] of this.contacts)if(c.a===id||c.b===id){this.contacts.delete(key);this.lastEvents.delete(key);}
    this.pending=this.pending.filter(e=>e.playerA!==id&&e.playerB!==id);
  }
  view(r,now) {
    if(r.disconnected||r.dnf||r.finishTime!==null||now<(r.checkpointProtectionUntil??0))return null;
    const s=r.state;if(!s)return null;
    return {id:r.id,x:r.position.x,y:r.position.y,z:r.position.z,vx:s.velocity[0],vz:s.velocity[2],forward:heading(s.rotation??[0,0,0,1]),grounded:s.grounded,landing:s.landing||0,version:r.resetVersion,now};
  }
  ledger(r) {
    r.collisionOffsets??=new Map([[0,[0,0,0]]]);
    r.collision??={revision:0,offset:[0,0,0],constraints:[],version:r.resetVersion};
    return r.collision;
  }
  // Rebase packets in flight so they cannot undo an authoritative block.
  rebase(r,state) {
    const correction=this.ledger(r),offset=r.collisionOffsets.get(state.collisionAck??0);
    if(!offset||(state.resetVersion??0)!==r.resetVersion)return null;
    return {...state,position:state.position.map((v,i)=>v+correction.offset[i]-offset[i]),velocity:[...(state.velocity??[0,0,0])]};
  }
  constrain(records,id,state,now) {
    const r=records.get(id),rebased=this.rebase(r,state);if(!rebased)return null;
    if(!this.config.enabled||now<(r.checkpointProtectionUntil??0))return rebased;
    const views=[...records.values()].map(p=>this.view(p,now)).filter(Boolean);
    const previous=new Map(views.map(p=>[p.id,{...p}]));
    const proposed={id,x:rebased.position[0],y:rebased.position[1],z:rebased.position[2],vx:rebased.velocity[0],vz:rebased.velocity[2],forward:heading(rebased.rotation??[0,0,0,1]),grounded:rebased.grounded,version:r.resetVersion,now};
    if(!previous.has(id))previous.set(id,{...proposed,x:r.position.x,y:r.position.y,z:r.position.z});
    const players=views.filter(p=>p.id!==id);players.push(proposed);players.sort((a,b)=>a.id.localeCompare(b.id));
    const before=new Map(players.map(p=>[p.id,{...p}])),hits=solveMotorcycles(players,previous,this.config);
    r.state=rebased;r.position.set(...rebased.position);
    this.commit(records,players,before,hits,now);
    return r.state;
  }
  commit(records,players,before,hits,now) {
    for(const p of players) {
      const r=records.get(p.id),old=before.get(p.id),dx=p.x-old.x,dz=p.z-old.z,correction=this.ledger(r);
      if(Math.hypot(dx,dz)>1e-7||Math.hypot(p.vx-old.vx,p.vz-old.vz)>1e-7) {
        const constraints=hits.filter(h=>h.a.id===p.id||h.b.id===p.id).map(h=>{const sign=h.a.id===p.id?1:-1,n={x:h.normal.x*sign,z:h.normal.z*sign};return {normal:[n.x,0,n.z],speed:p.vx*n.x+p.vz*n.z};});
        r.collision={revision:correction.revision+1,offset:[correction.offset[0]+dx,0,correction.offset[2]+dz],constraints,version:r.resetVersion};
        r.collisionOffsets.set(r.collision.revision,r.collision.offset);
        if(r.collisionOffsets.size>256)r.collisionOffsets.delete(r.collisionOffsets.keys().next().value);
        r.collisionAt=now;
      }
      r.position.x=p.x;r.position.z=p.z;
      r.state={...r.state,position:r.position.toArray(),velocity:[p.vx,r.state.velocity[1],p.vz]};
      this.previous.set(p.id,{...p});
    }
    const touched=new Set();
    for(const hit of hits) {
      const {a,b,normal:n}=hit,key=`${a.id}:${b.id}`,old=this.contacts.get(key);touched.add(key);
      this.contacts.set(key,{a:a.id,b:b.id,lastAt:now,normal:n});
      // Only sound, shake, speed loss and wobble have a cooldown.
      if(now-(this.lastEvents.get(key)??-Infinity)<this.config.contactCooldownMs)continue;
      const event=this.event(hit,!!old,now,records);this.pending.push(event);this.lastEvents.set(key,now);
      if(!old){this.count++;this.lastIntensity=event.intensity;this.lastRelativeSpeed=event.relativeSpeed;}
    }
    for(const [key,pair] of this.contacts)if(!touched.has(key)){
      const a=players.find(p=>p.id===pair.a),b=players.find(p=>p.id===pair.b),hit=a&&b&&capsuleContact(a,b,this.config);
      if(!hit||hit.depth< -this.config.releaseSlop)this.contacts.delete(key);
    }
  }
  event(hit,persistent,now,records) {
    const c=this.config,{a,b,normal:n,relativeSpeed,closing}=hit;
    const aligned=a.forward.x*b.forward.x+a.forward.z*b.forward.z;
    const longitudinal=Math.max(Math.abs(n.x*a.forward.x+n.z*a.forward.z),Math.abs(n.x*b.forward.x+n.z*b.forward.z));
    const kind=aligned<-.55&&longitudinal>.6?'frontal':aligned>.55&&longitudinal>.6?'rear':'side';
    const context=(!a.grounded||!b.grounded?c.airborneMultiplier:1)*((a.landing>.15||b.landing>.15)?c.landingGraceMultiplier:1);
    const multiplier=kind==='side'?c.sideContactMultiplier*(1-clamp((aligned-.2)/.8,0,1)*.25):kind==='rear'?c.rearImpactMultiplier:c.frontalImpactMultiplier;
    const intensity=(persistent?0:clamp(.16+closing*c.pushStrength,0,c.maxLinearImpulse)*multiplier)*context;
    const loss=persistent?0:c.velocityLoss*clamp(closing/14,0,1)*(kind==='side'?.08:kind==='rear'?.75:1.4)*context;
    const behindA=(a.x-b.x)*a.forward.x+(a.z-b.z)*a.forward.z<0;
    const contactLevel=relativeSpeed<2.5||(kind==='side'&&closing<1.5)?'FROTTEMENT':(relativeSpeed>6.5||kind==='frontal')?'CHOC':'NORMAL';
    const effects=[a,b].map((p,k)=>{
      const sign=k===0?1:-1,behind=k===0?behindA:!behindA,push=kind==='rear'&&!behind?c.rearPushedForwardRatio:1;
      return {playerId:p.id,version:p.version,deltaVelocity:[n.x*sign*intensity*push,0,n.z*sign*intensity*push],velocityLoss:kind==='rear'&&!behind?0:loss,yawImpulse:clamp((n.x*p.forward.z-n.z*p.forward.x)*sign*intensity*.05,-c.maxAngularImpulse,c.maxAngularImpulse),correction:[0,0,0],authority:records.get(p.id).collision,contactLevel};
    });
    return {raceId:this.raceId,sequence:++this.sequence,playerA:a.id,playerB:b.id,point:hit.point,direction:[n.x,0,n.z],intensity,relativeSpeed,angleDeg:Math.round(Math.acos(clamp(aligned,-1,1))*180/Math.PI),contactLevel,kind,persistent,depth:hit.depth,timestamp:now,effects};
  }
  update(records,now) {
    if(!this.config.enabled)return [];
    const players=[...records.values()].map(r=>this.view(r,now)).filter(Boolean).sort((a,b)=>a.id.localeCompare(b.id));
    const ids=new Set(players.map(p=>p.id));for(const id of this.previous.keys())if(!ids.has(id))this.removePlayer(id);
    const before=new Map(players.map(p=>[p.id,{...p}]));
    this.commit(records,players,before,solveMotorcycles(players,this.previous,this.config),now);
    return this.pending.splice(0);
  }
  snapshot() {return {count:this.count,active:this.contacts.size,activePlayers:[...new Set([...this.contacts.values()].flatMap(c=>[c.a,c.b]))],lastIntensity:this.lastIntensity,relativeSpeed:this.lastRelativeSpeed};}
}
