import { MAPS } from '../../shared/maps.js';
import { createTrack } from './createTrack.js';
import { LapCheckpointSystem } from '../LapCheckpointSystem.js';
import { formatTime } from '../TimeTrial.js';
import './maps.css';

const previews = new Map();
export function trackPreview(track, detail = false) {
  const box = new Float64Array([Infinity, Infinity, -Infinity, -Infinity]);
  for (const p of track.samples) {
    box[0] = Math.min(box[0], p.x);
    box[1] = Math.min(box[1], p.z);
    box[2] = Math.max(box[2], p.x);
    box[3] = Math.max(box[3], p.z);
  }
  let path = track.samples.filter((_, i) => i % 4 === 0).map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(' ') + 'Z';
  if (track.id === 'canyon' && track.gaps?.length) {
    let move = true;
    path = track.samples.filter((_, i) => i % 2 === 0).map((p, i) => {
      if (track.isGap(i * 2 / track.count)) { move = true; return ''; }
      const command = move ? 'M' : 'L'; move = false; return `${command}${p.x},${p.z}`;
    }).join(' ') + `L${track.samples[0].x},${track.samples[0].z}`;
  }
  const startAt = track.at(0), start = startAt.position;
  const canyon = track.id === 'canyon', redEarth = canyon || track.id === 'terrerouge';
  const shoulder = redEarth ? '#773c2b' : '#a08660';
  const dirt = redEarth ? '#c36947' : '#d3b483';
  const finish = canyon ? `<line x1="${start.x - Math.cos(startAt.yaw) * 7}" y1="${start.z + Math.sin(startAt.yaw) * 7}" x2="${start.x + Math.cos(startAt.yaw) * 7}" y2="${start.z - Math.sin(startAt.yaw) * 7}" stroke="#fff2da" stroke-width="2.5"/>` : '';
  const crossing = canyon && !track.gaps?.length ? track.samples.filter((_, i) => Math.abs(i / track.count - track.landmarks.bridge) * track.length < 15).map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.z}`).join(' ') : '';
  const bridge = crossing ? `<path d="${crossing}" fill="none" stroke="${shoulder}" stroke-width="17"/><path d="${crossing}" fill="none" stroke="${dirt}" stroke-width="12"/>` : '';
  const gates = detail ? new LapCheckpointSystem(track).gates : [];
  const gaps = track.gaps ? track.gaps.map(g => `<line x1="${g.takeoffLip.x}" y1="${g.takeoffLip.z}" x2="${g.landingStart.x}" y2="${g.landingStart.z}" stroke="#f4dfac" stroke-width="5" stroke-dasharray="3 2"/><circle cx="${g.takeoffLip.x}" cy="${g.takeoffLip.z}" r="3.5" fill="#f4dfac"/><circle cx="${g.landingStart.x}" cy="${g.landingStart.z}" r="3.5" fill="#99d9c1"/>`).join('') : '';
  return `<svg viewBox="${box[0] - 15} ${box[1] - 18} ${box[2] - box[0] + 30} ${box[3] - box[1] + 36}" aria-label="Vue aérienne du circuit" role="img"><path d="${path}" fill="none" stroke="${shoulder}" stroke-width="16"/><path d="${path}" fill="none" stroke="${dirt}" stroke-width="12"/><path d="${path}" fill="none" stroke="#eaf0cb" stroke-width=".7" stroke-dasharray="2 3"/>${gaps}${bridge}${finish}${gates.map((g, i) => `<circle cx="${g.position.x}" cy="${g.position.z}" r="2.5" fill="#d9ef82"/><text x="${g.position.x + 4}" y="${g.position.z - 3}" fill="#f5ffe2" font-size="5">${i || 'D'}</text>`).join('')}<circle cx="${start.x}" cy="${start.z}" r="4" fill="#e6fc92"/></svg>`;
}

function escName(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ladderHTML(records, mapTitle, unavailable = false) {
  const LIMIT = 5;
  const rows = Array.from({ length: LIMIT }, (_, i) => {
    const r = records[i];
    return `<li class="ladder-row${r ? '' : ' ladder-empty'}"><span class="ladder-rank">${i + 1}</span><span class="ladder-name">${r ? escName(r.name) : 'À établir'}</span><strong class="ladder-time">${formatTime(r?.time ?? null)}</strong></li>`;
  }).join('');
  return `<div class="trial-ladder"><label class="ladder-title">🏆 TOP 5 · SERVEUR · <span>${escName(mapTitle)}</span></label>${unavailable ? '<p>Serveur de records indisponible.</p>' : `<ol class="ladder-list">${rows}</ol>`}</div>`;
}

export class MapSelectionUI {
  constructor(game) {
    this.game = game;
    this.targetMode = 'trial';
    this.returnTo = 'solo';
    this._ladderRecords = [];
    this._ladderRequest = 0;
    try {
      this.flyingStart = localStorage.getItem('motocross.flyingStart') === 'true';
    } catch {
      this.flyingStart = false;
    }
  }
  open(targetMode = 'trial', returnTo = 'solo') {
    this.targetMode = targetMode;
    this.returnTo = returnTo;
    this.game.state = 'map-select';
    if (targetMode === 'trial') {
      this._ladderRecords = this.game.serverRecords ?? [];
      this._ladderUnavailable = false;
      this.render();
      this._loadLadder().then(current => { if (current) this.render(); });
    } else {
      this.game.ui.setScreen('map-select');
    }
  }
  async _loadLadder() {
    const track = this.game.track, request = ++this._ladderRequest;
    await this.game.fetchServerRecords();
    if (request !== this._ladderRequest || this.game.track !== track || this.game.state !== 'map-select') return false;
    this._ladderRecords = this.game.serverRecords ?? [];
    this._ladderUnavailable = this.game.serverRecords === null;
    return true;
  }
  render() {
    const g = this.game;
    const modeMeta = {
      trial: {
        eyebrow: 'CONTRE-LA-MONTRE · 2 TOURS CHRONO',
        desc: 'Enchaînez les tours sans limite et tentez de battre votre record.',
        confirm: 'Lancer le contre-la-montre'
      },
      practice: {
        eyebrow: 'ENTRAÎNEMENT LIBRE',
        desc: 'Sélectionnez le circuit sur lequel rouler librement, explorer les bosses et vous entraîner.',
        confirm: 'Partir rouler'
      },
    };
    const meta = modeMeta[this.targetMode] || {
      eyebrow: 'DEUX TRACÉS · UNE MÊME CONDUITE',
      desc: 'Sélectionnez votre circuit.',
      confirm: 'Continuer'
    };
    const ladder = this.targetMode === 'trial' ? ladderHTML(this._ladderRecords, g.track.title, this._ladderUnavailable) : '';
    const startOptions = this.targetMode === 'trial' ? `
      <div class="start-mode-container">
        <label class="start-mode-label">TYPE DE DÉPART DU TOUR :</label>
        <div class="start-mode-toggle">
          <button type="button" aria-pressed="${!this.flyingStart}" class="start-mode-btn ${!this.flyingStart ? 'active' : ''}" data-start-mode="standing">
            <span class="start-mode-icon">🚦</span>
            <span class="start-mode-text"><strong>Départ arrêté</strong><small>Départ sur la ligne à l'arrêt (0 km/h)</small></span>
          </button>
          <button type="button" aria-pressed="${this.flyingStart}" class="start-mode-btn ${this.flyingStart ? 'active' : ''}" data-start-mode="flying">
            <span class="start-mode-icon">🚀</span>
            <span class="start-mode-text"><strong>Tour lancé (75%)</strong><small>Dernier quart du tracé pour franchir la ligne lancé</small></span>
          </button>
        </div>
      </div>
    ` : '';
    g.ui.screen.innerHTML = `<div class="scrim"></div><section class="dialog map-dialog"><div class="eyebrow">${meta.eyebrow}</div><h2>Choix du circuit<span>.</span></h2><p class="map-mode-desc">${meta.desc}</p><div class="map-selection-layout"><div class="map-choices">${MAPS.map(m => {
      if (!previews.has(m.id)) previews.set(m.id, createTrack(m.id));
      const t = previews.get(m.id);
      return `<button type="button" class="map-choice ${g.track.id === m.id ? 'selected' : ''}" data-map="${m.id}" aria-pressed="${g.track.id === m.id}"><span>MAP ${m.number} · ${m.label}</span>${trackPreview(t)}<strong>${m.title}</strong><small>${m.description}</small><small>${Math.round(t.length)} m · ${new LapCheckpointSystem(t).gates.length} passages obligatoires</small></button>`;
    }).join('')}</div>${ladder ? `<aside class="map-sidebar">${ladder}</aside>` : ''}</div>${startOptions}<footer class="map-footer"><button class="menu-button primary" data-action="map-confirm"><span>${meta.confirm}</span><span aria-hidden="true">↗</span></button><div class="dialog-actions-row"><button class="menu-button" data-action="map-plan"><span>Voir le tracé</span><span aria-hidden="true">↗</span></button><button class="menu-button" data-action="map-back"><span>Retour</span><span aria-hidden="true">↵</span></button></div></footer></section>`;
    g.ui.screen.querySelectorAll('[data-map]').forEach(button => {
      button.onclick = () => {
        g.loadMap(button.dataset.map);
        if (this.targetMode === 'trial') {
          this._ladderRecords = g.serverRecords ?? [];
          this._ladderUnavailable = false;
          this.render();
          this._loadLadder().then(current => { if (current) this.render(); });
        } else {
          this.render();
        }
      };
      button.ondblclick = () => { this.confirm(); };
    });
    g.ui.screen.querySelectorAll('[data-start-mode]').forEach(btn => {
      btn.onclick = () => {
        this.flyingStart = btn.dataset.startMode === 'flying';
        try {
          localStorage.setItem('motocross.flyingStart', String(this.flyingStart));
        } catch { }
        this.render();
      };
    });
  }
  confirm() {
    const g = this.game;
    if (this.targetMode === 'trial') { g.start('trial', { flyingStart: this.flyingStart }); return; }
    if (this.targetMode === 'practice') { g.start('practice'); return; }
    this.back();
  }
  plan() {
    const g = this.game;
    g.ui.screen.innerHTML = `<div class="scrim"></div><section class="dialog map-plan"><div class="eyebrow">VUE AÉRIENNE · ${g.track.title}</div>${trackPreview(g.track, true)}<p>Point clair : départ / arrivée · ligne pointillée : racing line · numéros : checkpoints dans l'ordre.</p><button class="menu-button" data-action="map-plan-back">Retour aux circuits ↵</button></section>`;
  }
  back() { const g = this.game; g.state = this.returnTo ?? 'solo'; g.ui.setScreen(g.state); }
}
