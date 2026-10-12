export const MAX_PLAYERS=12;
export const NETWORK_HZ=30;
export const INTERPOLATION_MS=100;
export const PLAYER_COLORS=['#ee695b','#669cef','#83ca6c','#efa24e','#bc88e9','#63d7d5','#f1d85a','#ee86bd','#edf2e8','#aab7ce','#b9916c','#55a99a'];
export const COLOR_NAMES=['ROUGE','BLEU','VERT','ORANGE','VIOLET','CYAN','JAUNE','ROSE','BLANC','ARGENT','SABLE','TURQUOISE'];
export const ROOM_PATTERN=/^[A-HJ-NP-Z2-9]{6}$/;
export function gridSpawn(track,index) {
  const spawn=track.at(-(2+Math.floor(index/2)*3.4)/track.length);
  const side=index%2?1.6:-1.6;
  spawn.position.x+=Math.cos(spawn.yaw)*side;
  spawn.position.z-=Math.sin(spawn.yaw)*side;
  return spawn;
}
export function serializeSpawn(spawn) {return {position:spawn.position.toArray(),yaw:spawn.yaw,pitch:spawn.pitch,u:spawn.u};}
