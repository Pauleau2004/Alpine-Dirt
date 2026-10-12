// Versioned with the current circuit and its ten mandatory timing gates.
export const CIRCUIT_ID='alpine-dirt-ten-gates-v3';
export const RECORD_LIMIT=5;
export const LAP_RECORD_KEY=`motocross.${CIRCUIT_ID}.record`;
export const cleanPlayerName=name=>String(name??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,16)||'PLAYER';
export function validLapRecord(record,circuitId=CIRCUIT_ID) {
  return !!record&&record.circuit===circuitId&&typeof record.name==='string'&&record.name.trim().length>0&&record.name.length<=16&&Number.isFinite(record.time)&&record.time>5&&Number.isFinite(record.savedAt);
}
export function improvedLapRecord(previous,time,name,now=Date.now(),circuitId=CIRCUIT_ID) {
  if(!Number.isFinite(time)||time<=5||(validLapRecord(previous,circuitId)&&time>=previous.time))return null;
  return {circuit:circuitId,time,name:cleanPlayerName(name),savedAt:now};
}
const playerKey=name=>cleanPlayerName(name).normalize('NFKC').toLowerCase();
export function normalizeLapRecords(value,circuitId=CIRCUIT_ID) {
  const entries=Array.isArray(value)?value:Array.isArray(value?.records)?value.records:validLapRecord(value,circuitId)?[value]:[];
  const players=new Map();
  for(const entry of entries)if(validLapRecord(entry,circuitId)) {
    const key=playerKey(entry.name),old=players.get(key);
    if(!old||entry.time<old.time)players.set(key,{...entry});
  }
  return [...players.values()].sort((a,b)=>a.time-b.time||a.savedAt-b.savedAt||a.name.localeCompare(b.name)).slice(0,RECORD_LIMIT);
}
export function improvedLapRecords(records,time,name,now=Date.now(),circuitId=CIRCUIT_ID) {
  const key=playerKey(name),previous=records.find(r=>playerKey(r.name)===key);
  const next=improvedLapRecord(previous,time,name,now,circuitId);if(!next)return null;
  const updated=normalizeLapRecords([...records.filter(r=>playerKey(r.name)!==key),next],circuitId);
  return updated.some(r=>playerKey(r.name)===key&&r.time===time)?updated:null;
}
