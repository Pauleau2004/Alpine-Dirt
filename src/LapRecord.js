import { CIRCUIT_ID,LAP_RECORD_KEY,normalizeLapRecords,improvedLapRecords,cleanPlayerName } from '../shared/lapRecord.js';

export class LapRecord {
  constructor(storage=globalThis.localStorage,circuitId=CIRCUIT_ID) {
    this.circuitId=circuitId;this.key=`motocross.${circuitId}.record`;
    this.storage=storage;this.records=[];this.name='PLAYER';this.saved=true;
    try {
      const record=JSON.parse(storage?.getItem(this.key)??'null');
      this.records=normalizeLapRecords(record,circuitId);
      this.name=cleanPlayerName(storage?.getItem('motocross.nickname'));
    }catch{/* Keep playing if browser storage is unavailable. */}
  }
  get record(){return this.records[0]??null;}
  setName(name) {
    this.name=cleanPlayerName(name);
    try{this.storage?.setItem('motocross.nickname',this.name);}catch{}
    return this.name;
  }
  submit(time,name=this.name) {
    const next=improvedLapRecords(this.records,time,name,Date.now(),this.circuitId);
    if(!next)return false;
    this.records=next;
    try{this.storage.setItem(this.key,JSON.stringify({circuit:this.circuitId,records:next}));this.saved=true;}catch{this.saved=false;}
    return true;
  }
}
