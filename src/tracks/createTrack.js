import { Track } from '../Track.js';
import { HillsideTrack } from './HillsideTrack.js';
import { GapTrack } from './GapTrack.js';
import { CanyonTrack } from './CanyonTrack.js';
import { TerreRougeTrack } from './TerreRougeTrack.js';
import { SprintTrack } from './SprintTrack.js';
import { mapInfo } from '../../shared/maps.js';
export function createTrack(id='alpine') {
  const info=mapInfo(id);
  const track=info.id==='hillside'?new HillsideTrack():info.id==='gaptrack'?new GapTrack():info.id==='canyon'?new CanyonTrack():info.id==='terrerouge'?new TerreRougeTrack():info.id==='sprint'?new SprintTrack():new Track();
  return Object.assign(track,{id:info.id,title:info.title,circuitId:info.circuitId,number:info.number});
}
