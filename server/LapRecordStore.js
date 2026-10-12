import { readFile,mkdir,writeFile,rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CIRCUIT_ID,normalizeLapRecords,improvedLapRecords } from '../shared/lapRecord.js';

export class LapRecordStore {
  constructor(path=null,circuitId=CIRCUIT_ID) {this.path=path;this.circuitId=circuitId;this.records=[];this.pending=Promise.resolve();this.error=null;}
  get record(){return this.records[0]??null;}
  async load() {
    if(!this.path)return this;
    try {
      const record=JSON.parse(await readFile(this.path,'utf8'));
      this.records=normalizeLapRecords(record,this.circuitId);
    }catch(error){if(error.code!=='ENOENT')console.warn('Record du circuit illisible :',error.message);}
    return this;
  }
  submit(time,name,now=Date.now()) {
    const next=improvedLapRecords(this.records,time,name,now,this.circuitId);
    if(!next)return false;
    this.records=next;
    if(this.path) {
      // Serial, atomic replacements preserve the previous file on interruption
      // and prevent concurrent rooms from overwriting a newer record.
      this.pending=this.pending.then(async()=>{
        await mkdir(dirname(this.path),{recursive:true});
        await writeFile(`${this.path}.tmp`,JSON.stringify({circuit:this.circuitId,records:next},null,2)+'\n','utf8');
        await rename(`${this.path}.tmp`,this.path);this.error=null;
      }).catch(error=>{this.error=error.message;console.error('Sauvegarde du record impossible :',error.message);});
    }
    return true;
  }
  async flush(){await this.pending;}
}
