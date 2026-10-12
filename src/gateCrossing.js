// Interpolate forward plane crossings; jumps and fast passes cannot skip gates.
export function gateCrossing(previous, position, gate, halfWidth) {
  if (!previous) return null;
  if (Math.hypot(position.x-previous.x,position.y-previous.y,position.z-previous.z)>10) return null;
  const p=gate.position,sin=Math.sin(gate.yaw),cos=Math.cos(gate.yaw);
  const before=(previous.x-p.x)*sin+(previous.z-p.z)*cos;
  const after=(position.x-p.x)*sin+(position.z-p.z)*cos;
  if(before>=0||after<0)return null;
  const fraction=-before/(after-before);
  const x=previous.x+(position.x-previous.x)*fraction-p.x;
  const z=previous.z+(position.z-previous.z)*fraction-p.z;
  const y=previous.y+(position.y-previous.y)*fraction;
  if(Math.abs(x*cos-z*sin)>halfWidth||Math.abs(y-p.y)>(gate.heightTolerance??10))return null;
  return fraction;
}
