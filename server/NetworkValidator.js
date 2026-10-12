import { ROOM_PATTERN } from '../shared/multiplayer.js';
export class NetworkError extends Error {}
export function requireValue(condition,message) {if(!condition)throw new NetworkError(message);}
export function nickname(value) {
  requireValue(typeof value==='string','Pseudo invalide.');
  const name=value.trim().normalize('NFC');
  requireValue([...name].length>=1&&[...name].length<=16,'Le pseudo doit contenir de 1 à 16 caractères.');
  requireValue(/^[\p{L}\p{N} _.-]+$/u.test(name),'Utilisez des lettres, des chiffres, des espaces ou . _ -');
  return name;
}
export function roomCode(value) {
  requireValue(typeof value==='string','Code du salon invalide.');
  const code=value.trim().toUpperCase();requireValue(ROOM_PATTERN.test(code),'Code du salon invalide.');return code;
}
export function chatText(value) {
  requireValue(typeof value==='string','Message invalide.');
  const text=value.trim().normalize('NFC');
  requireValue([...text].length>=1&&[...text].length<=200,'Le message doit contenir entre 1 et 200 caractères.');
  return text;
}
const number=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
const vector=(v,size,min,max)=>Array.isArray(v)&&v.length===size&&v.every(x=>number(x,min,max));
export function validateState(data) {
  if(!data||typeof data!=='object'||!Number.isSafeInteger(data.seq)||data.seq<0||typeof data.raceId!=='string')return null;
  if(!Number.isSafeInteger(data.collisionAck??0)||(data.collisionAck??0)<0||!Number.isSafeInteger(data.resetVersion??0)||(data.resetVersion??0)<0)return null;
  if(!vector(data.position,3,-250,250)||!vector(data.rotation,4,-1,1)||!vector(data.velocity,3,-80,80)||!vector(data.angularVelocity,3,-8,8))return null;
  if(Math.hypot(data.velocity[0],data.velocity[2])>65)return null;
  if(Math.abs(Math.hypot(...data.rotation)-1)>.05)return null;
  if(!number(data.speed,-65,65)||!number(data.steer,-1,1)||!number(data.pitch,-1.2,1.2)||!number(data.roll,-1.2,1.2)||!number(data.throttle,0,1)||!number(data.timestamp,0,Number.MAX_SAFE_INTEGER))return null;
  if(!vector(data.suspension,2,.20,.70)||!vector(data.compression,2,0,.4)||typeof data.grounded!=='boolean')return null;
  return {seq:data.seq,collisionAck:data.collisionAck??0,resetVersion:data.resetVersion??0,position:[...data.position],rotation:[...data.rotation],velocity:[...data.velocity],angularVelocity:[...data.angularVelocity],speed:data.speed,steer:data.steer,pitch:data.pitch,roll:data.roll,throttle:data.throttle,suspension:[...data.suspension],compression:[...data.compression],grounded:data.grounded,timestamp:data.timestamp};
}
export class RateLimiter {
  constructor(rate,burst,now=Date.now) {this.rate=rate;this.burst=burst;this.tokens=burst;this.now=now;this.last=now();}
  take() {const now=Math.max(this.last,this.now());this.tokens=Math.min(this.burst,this.tokens+(now-this.last)*this.rate/1000);this.last=now;if(this.tokens<1)return false;this.tokens--;return true;}
}
