import { formatTime } from './TimeTrial.js';
import { RECORD_LIMIT } from '../shared/lapRecord.js';
import './race-presentation.css';

export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function recordCard(record,scope='CE NAVIGATEUR',saveError=false) {
  const records=Array.isArray(record)?record:record?[record]:[];
  return `<div class="circuit-record"><label>TOP ${RECORD_LIMIT} · RECORDS DU CIRCUIT <span>· ${scope}</span></label><ol>${Array.from({length:RECORD_LIMIT},(_,i)=>{const r=records[i];return `<li><span>${i+1}</span><b>${r?escapeHTML(r.name):'À établir'}</b><strong>${formatTime(r?.time)}</strong></li>`;}).join('')}</ol>${saveError?'<small>Records en mémoire · sauvegarde indisponible</small>':''}</div>`;
}
export function raceTable(rows,playerId) {
  return `<table class="race-table"><thead><tr><th scope="col">#</th><th scope="col">PILOTE</th><th scope="col">TEMPS</th><th scope="col">MEILLEUR TOUR</th></tr></thead><tbody>${rows.map(p=>`<tr class="result-row ${p.id===playerId?'is-human':''}" data-rider-id="${escapeHTML(p.id)}"><td>${p.place}</td><th scope="row" style="color:${p.color}">${escapeHTML(p.name)}</th><td>${p.time!==null?formatTime(p.time):p.disconnected?'DÉCONNECTÉ':'NON TERMINÉ'}</td><td data-best-lap>${formatTime(p.bestLap)}${p.bestLapBoosted?' <small style="color:#facc15;font-size:0.75em;font-weight:bold" title="Tour non homologué pour le Top 5 (boost utilisé)">⚡ BOOST</small>':''}</td></tr>`).join('')}</tbody></table>`;
}
export function spectatorPanel(standing,total,exitAction,exitText) {
  return `<section class="spectator-panel" aria-label="Mode spectateur"><div class="spectator-finish">ARRIVÉ · ${standing?.place} / ${total} <span>${formatTime(standing?.time)}</span></div><div class="spectator-view"><button type="button" data-action="spectate-prev" aria-label="Pilote précédent">‹</button><div><label>SPECTATEUR</label><strong data-spectator-name>Recherche d’un pilote…</strong><small data-spectator-status>Les autres pilotes terminent</small></div><button type="button" data-action="spectate-next" aria-label="Pilote suivant">›</button></div><div class="spectator-bottom"><span>VOTRE MEILLEUR TOUR <b>${formatTime(standing?.bestLap)}</b></span><button type="button" data-action="${exitAction}">${exitText} ↗</button></div></section>`;
}
