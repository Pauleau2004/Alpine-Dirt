import { networkInterfaces } from 'node:os';
import { isIPv4 } from 'node:net';

const normalize=address=>String(address??'').toLowerCase().replace(/^::ffff:/,'').split('%')[0];
export function isServerAddress(address,interfaces=networkInterfaces()) {
  const peer=normalize(address);
  if(peer==='::1'||(isIPv4(peer)&&peer.startsWith('127.')))return true;
  return !!peer&&Object.values(interfaces).flat().some(entry=>entry&&normalize(entry.address)===peer);
}
export function isOwnerConnection(socket) {
  // Use the TCP peer, never a nickname, auth flag, Host or forwarded header.
  return isServerAddress(socket.request.socket.remoteAddress);
}
