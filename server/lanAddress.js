import { networkInterfaces } from 'node:os';
import { isIPv4 } from 'node:net';
export function selectLanInterface(interfaces=networkInterfaces()) {
  const candidates=[];
  for(const [name,addresses] of Object.entries(interfaces))for(const a of addresses??[]) {
    if(a.internal||!(a.family==='IPv4'||a.family===4)||!isIPv4(a.address)||a.address.startsWith('169.254.'))continue;
    const virtual=/virtual|vmware|vbox|vethernet|hyper-v|docker|wsl|vpn|wireguard|tailscale|zerotier|\btap\b|\btun\b/i.test(name);
    const privateIP=/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
    const wifi=/wi[ -]?fi|wlan|wireless|sans.?fil|^wl\w/i.test(name);
    const score=(virtual?-200:100)+(privateIP?40:0)+(wifi?80:/ethernet|^en\d|^eth\d/i.test(name)?20:0);
    candidates.push({address:a.address,name,wifi,score});
  }
  candidates.sort((a,b)=>b.score-a.score);return candidates[0]??null;
}
export function lanAddress(interfaces=networkInterfaces()){return selectLanInterface(interfaces)?.address??null;}
