// Central motorcycle collision configuration.
// Geometry is deliberately slightly smaller than the visual bike (covering motor, frame, rider core).
// Distances: metres; linear impulses: delta-v in m/s (client multiplies by mass).
export const MOTORCYCLE_COLLISION_CONFIG=Object.freeze({
  enabled:true,
  // Simplified central envelope (excluding outer wheel edges)
  radius:.30,length:1.90,verticalTolerance:.85,
  // Contact multipliers by type
  sideContactMultiplier:.28,sideImpactMultiplier:.28,
  normalContactMultiplier:.50,
  rearImpactMultiplier:.70,
  frontalImpactMultiplier:.85,
  rearPushedForwardRatio:.35,
  // Contextual multipliers
  airborneMultiplier:.25,
  landingGraceMultiplier:.45,landingGraceDuration:.15,
  // Clamped impulses (delta-v in m/s)
  pushStrength:.20,maxLinearImpulse:2.2,maxAngularImpulse:.10,maxVerticalImpulse:0,
  maxCombinedDeltaV:3.4,
  // Velocity loss
  velocityLoss:.10,maxVelocityLoss:2.4,
  // Hard constraints have no impulse/correction budget. Only presentation is smoothed.
  skin:.002,solverIterations:160,ccdIterations:96,correctionDuration:.12,
  // Persistent contact & cooldown
  contactCooldownMs:150,persistentImpulse:.10,releaseSlop:.08,
  // Post-impact grip & stabilization assist
  postImpactGripMultiplier:.92,postImpactGripDuration:.20,recoveryAssistDuration:.35,
  // Network & timing
  maxStateAgeMs:1500,maxPredictionMs:150,respawnGraceMs:0,maxEventAgeMs:600,
  responseDuration:.09,impactWindowMs:150,
});
export const MULTIPLAYER_COLLISION_CONFIG=MOTORCYCLE_COLLISION_CONFIG;
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dot=(a,b)=>a.x*b.x+a.z*b.z;
const sub=(a,b)=>({x:a.x-b.x,z:a.z-b.z});
const add=(a,b,s)=>({x:a.x+b.x*s,z:a.z+b.z*s});
export function heading(rotation) {
  const [x,y,z,w]=rotation,fx=2*(x*z+w*y),fz=1-2*(x*x+y*y),n=Math.hypot(fx,fz)||1;
  return {x:fx/n,z:fz/n};
}
// Closest points of two finite X/Z spine segments, including parallel spines.
export function capsuleContact(a,b,c=MULTIPLAYER_COLLISION_CONFIG) {
  if(Math.abs(a.y-b.y)>c.verticalTolerance)return null;
  const half=Math.max(0,c.length/2-c.radius),p=add(a,a.forward,-half),q=add(b,b.forward,-half);
  const d1={x:a.forward.x*half*2,z:a.forward.z*half*2},d2={x:b.forward.x*half*2,z:b.forward.z*half*2};
  const r=sub(p,q),aa=dot(d1,d1),ee=dot(d2,d2),bb=dot(d1,d2),cc=dot(d1,r),ff=dot(d2,r),den=aa*ee-bb*bb;
  let s=den>1e-9?clamp((bb*ff-cc*ee)/den,0,1):0,t=(bb*s+ff)/Math.max(ee,1e-9);
  if(t<0){t=0;s=clamp(-cc/Math.max(aa,1e-9),0,1);}else if(t>1){t=1;s=clamp((bb-cc)/Math.max(aa,1e-9),0,1);}
  const pa=add(p,d1,s),pb=add(q,d2,t),delta=sub(pa,pb),distance=Math.hypot(delta.x,delta.z);
  let normal=distance>1e-6?{x:delta.x/distance,z:delta.z/distance}:sub(a,b);
  // Intersecting spines need a separating axis, not a radius-sized correction
  // along their centres (which leaves collinear bikes interpenetrating).
  if(distance<1e-6) {
    const centre=sub(a,b),axes=[{x:a.forward.z,z:-a.forward.x},{x:b.forward.z,z:-b.forward.x}];
    let best=null;
    for(const axis of axes){const signed=dot(centre,axis),depth=c.radius*2+half*(Math.abs(dot(a.forward,axis))+Math.abs(dot(b.forward,axis)))-Math.abs(signed);if(!best||depth<best.depth)best={depth,normal:{x:axis.x*(signed<0?-1:1),z:axis.z*(signed<0?-1:1)}};}
    return {...best,distance,point:[(a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2]};
  }
  let n=Math.hypot(normal.x,normal.z);
  if(n<1e-6){normal={x:-(a.vx-b.vx),z:-(a.vz-b.vz)};n=Math.hypot(normal.x,normal.z);}
  if(n<1e-6){normal={x:a.forward.z,z:-a.forward.x};n=1;}
  normal.x/=n;normal.z/=n;
  return {normal,depth:c.radius*2-distance,distance,point:[(pa.x+pb.x)/2,(a.y+b.y)/2,(pa.z+pb.z)/2]};
}

const angle=p=>Math.atan2(p.forward.x,p.forward.z);
const turn=(a,b)=>Math.atan2(Math.sin(angle(b)-angle(a)),Math.cos(angle(b)-angle(a)));
const at=(a,b,t)=>{const yaw=angle(a)+turn(a,b)*t;return {...b,x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t,forward:{x:Math.sin(yaw),z:Math.cos(yaw)}};};

// Conservative advancement of two moving, rotating capsules. The distance bound
// includes angular motion and height: no fixed sample spacing or speed cutoff.
export function sweepCapsules(a0,a,b0,b,c=CONFIG) {
  const horizontal=Math.hypot((a.x-a0.x)-(b.x-b0.x),(a.z-a0.z)-(b.z-b0.z))+(c.length/2-c.radius)*(Math.abs(turn(a0,a))+Math.abs(turn(b0,b)));
  const vertical=Math.abs((a.y-a0.y)-(b.y-b0.y));
  let t=0;
  for(let i=0;i<c.ccdIterations;i++) {
    const p=at(a0,a,t),q=at(b0,b,t),hit=capsuleContact(p,q,{...c,verticalTolerance:Infinity});
    const gap=-hit.depth-c.skin,height=Math.abs(p.y-q.y)-c.verticalTolerance;
    if(gap<=1e-7&&height<=1e-7)return {...hit,time:t,a:p,b:q,swept:t<1};
    const step=Math.max(gap>0?gap/Math.max(horizontal,1e-12):0,height>0?height/Math.max(vertical,1e-12):0);
    if(t+step>1)return null;
    t+=Math.max(step*.95,1e-9);
  }
  // An iteration limit must never turn an uncertain sweep into a missed hit.
  const p=at(a0,a,t),q=at(b0,b,t);
  return {...capsuleContact(p,q,{...c,verticalTolerance:Infinity}),time:t,a:p,b:q,swept:true};
}
const CONFIG=MOTORCYCLE_COLLISION_CONFIG;

// Mutates only horizontal positions/velocities. Terrain, suspension and jumps
// remain Rapier's responsibility. A zero inverseMass denotes a local proxy.
export function solveMotorcycles(players,previous=new Map(),c=CONFIG) {
  const contacts=new Map(),weights=p=>p.inverseMass??1;
  const record=(a,b,hit)=>{const key=`${a.id}:${b.id}`;if(!contacts.has(key))contacts.set(key,{a,b,...hit,relativeSpeed:Math.hypot(a.vx-b.vx,a.vz-b.vz),closing:Math.max(0,-dot({x:a.vx-b.vx,z:a.vz-b.vz},hit.normal))});};
  const velocity=(a,b,n)=>{const sum=weights(a)+weights(b),closing=dot({x:a.vx-b.vx,z:a.vz-b.vz},n);if(closing<0&&sum>0){a.vx-=n.x*closing*weights(a)/sum;a.vz-=n.z*closing*weights(a)/sum;b.vx+=n.x*closing*weights(b)/sum;b.vz+=n.z*closing*weights(b)/sum;}};
  // A/B can push B across C after B/C was already visited. Repeat swept
  // constraints until the entire chain is safe, independent of player order.
  for(let iteration=0;iteration<c.solverIterations;iteration++) {
    let changed=0;
    for(let i=0;i<players.length;i++)for(let j=i+1;j<players.length;j++) {
    const a=players[i],b=players[j],sum=weights(a)+weights(b);if(!sum)continue;
    const a0=previous.get(a.id)??a,b0=previous.get(b.id)??b;
    const hit=sweepCapsules(a0,a,b0,b,c);if(!hit)continue;
    const n=hit.normal,da=sub(a,hit.a),db=sub(b,hit.b),closing=dot(sub(da,db),n);
    if(closing<0){changed=Math.max(changed,-closing);record(a,b,hit);a.x-=n.x*closing*weights(a)/sum;a.z-=n.z*closing*weights(a)/sum;b.x+=n.x*closing*weights(b)/sum;b.z+=n.z*closing*weights(b)/sum;velocity(a,b,n);}
    }
    if(changed<1e-6)break;
  }
  // Re-solve all neighbours: resolving A/B may push B into C. Cooldowns and
  // airborne impact attenuation never disable these constraints.
  for(let iteration=0;iteration<c.solverIterations;iteration++) {
    let maxDepth=0,maxClosing=0;
    for(let i=0;i<players.length;i++)for(let j=i+1;j<players.length;j++) {
      const a=players[i],b=players[j],sum=weights(a)+weights(b);if(!sum)continue;
      const hit=capsuleContact(a,b,c);if(!hit||hit.depth< -c.skin*1.1)continue;
      record(a,b,hit);const n=hit.normal,depth=Math.max(0,hit.depth+c.skin);
      maxDepth=Math.max(maxDepth,depth);maxClosing=Math.max(maxClosing,-dot({x:a.vx-b.vx,z:a.vz-b.vz},n));
      a.x+=n.x*depth*weights(a)/sum;a.z+=n.z*depth*weights(a)/sum;b.x-=n.x*depth*weights(b)/sum;b.z-=n.z*depth*weights(b)/sum;velocity(a,b,n);
    }
    if(maxDepth<1e-6&&maxClosing<1e-6)break;
  }
  return [...contacts.values()];
}
