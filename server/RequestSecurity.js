import { hostname,networkInterfaces } from 'node:os';
import { RateLimiter } from './NetworkValidator.js';

export const peerAddress=request=>String(request.socket.remoteAddress??'').toLowerCase().replace(/^::ffff:/,'').split('%')[0];
// Socket.IO upgrades bypass Express: both must check Host and Origin.
// Comparing Origin to an arbitrary Host alone still permits DNS rebinding.
export function createRequestPolicy(extraHosts=[]) {
  const names=new Set(['localhost','127.0.0.1','[::1]',hostname().toLowerCase(),`${hostname().toLowerCase()}.local`,...extraHosts.filter(Boolean).map(v=>v.toLowerCase()),...Object.values(networkInterfaces()).flat().filter(Boolean).map(e=>e.address.includes(':')?`[${e.address.split('%')[0]}]`:e.address)]);
  return request=>{
    try {
      const host=request.headers.host;
      if(typeof host!=='string'||/[\s/@\\?#]/.test(host))return false;
      const target=new URL(`http://${host}`);
      if(!names.has(target.hostname)||Number(target.port||80)!==request.socket.localPort)return false;
      if(request.headers['sec-fetch-site']==='cross-site'&&request.headers['sec-fetch-mode']!=='navigate')return false;
      const origin=request.headers.origin;
      return origin===undefined||origin===target.origin;
    }catch{return false;}
  };
}

// Limits survive reconnects; expired source entries are bounded and pruned.
export class ConnectionGuard {
  constructor({now=Date.now,maxConnections=128,maxPerAddress=24}={}){this.now=now;this.maxConnections=maxConnections;this.maxPerAddress=maxPerAddress;this.entries=new Map();this.total=0;}
  acquire(address) {
    const now=this.now();
    for(const [key,p] of this.entries)if(!p.active&&now-p.last>60000)this.entries.delete(key);
    let p=this.entries.get(address);
    if(!p){if(this.entries.size>=256)return null;p={active:0,last:now,opens:new RateLimiter(2,24,this.now),commands:new RateLimiter(30,100,this.now)};this.entries.set(address,p);}
    p.last=now;
    if(this.total>=this.maxConnections||p.active>=this.maxPerAddress||!p.opens.take())return null;
    p.active++;this.total++;let released=false;
    return {commands:p.commands,release:()=>{if(released)return;released=true;p.active--;this.total--;p.last=this.now();}};
  }
}

export const PRIVATE_DEV_FILES=['.env','.env.*','**/.git/**','**/.codex/**','**/.agents/**','**/server/**','**/data/**','**/tests/**','**/scripts/**','**/.qa/**','**/*.pem','**/*.key'];
