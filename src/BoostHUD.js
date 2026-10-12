import { LAST_PLACE_BOOST_CONFIG } from '../shared/lastPlaceBoost.js';
import './boost.css';

export class BoostHUD {
  constructor(game,ui) {
    this.game=game;this.ui=ui;this.root=document.createElement('section');this.root.id='boost-hud';this.root.hidden=true;
    this.root.innerHTML='<div><strong>BOOST</strong><span></span></div><div class="boost-meter" role="progressbar" aria-label="Recharge du boost" aria-valuemin="0" aria-valuemax="100"><i></i></div><small></small>';
    ui.root.append(this.root);this.label=this.root.querySelector('strong');this.value=this.root.querySelector('span');this.meter=this.root.querySelector('.boost-meter');this.fill=this.root.querySelector('i');this.hint=this.root.querySelector('small');
    this.control=document.createElement('span');this.control.innerHTML='<kbd>ESPACE</kbd> Boost';this.control.hidden=true;ui.root.querySelector('.ride-controls').append(this.control);
  }
  update() {
    const g=this.game,m=g.multiplayer,multi=m?.inRace;
    if(!multi){this.control.hidden=true;this.root.hidden=true;return;}
    const data=m.race.boost,id=m.playerId;
    const now=m.serverNow();
    const state=m.boostFor(id),last=data?.lastPlacePlayerId===id;
    this.control.hidden=false;
    this.root.hidden=g.state!=='playing'||!data?.unlocked||!last||!state||!['CHARGING','READY','ACTIVE'].includes(state.state);
    if(!this.root.hidden) {
      const recharge=data.rechargeSeconds??LAST_PLACE_BOOST_CONFIG.rechargeSeconds,active=state.state==='ACTIVE',ready=state.state==='READY';
      // Display interpolation only; reaching 100% here never grants a charge.
      const charged=state.chargeStartTime===null?0:Math.min(recharge,Math.max(0,(now-state.chargeStartTime)/1000));
      const progress=active?Math.max(0,(state.endTime-now)/(data.durationSeconds*1000)):ready?1:charged/recharge;
      this.root.dataset.state=state.state;this.label.textContent=active?'BOOST ACTIF':ready?'BOOST PRÊT':'BOOST';
      this.value.textContent=active?`${Math.max(0,(state.endTime-now)/1000).toFixed(1)} s`:ready?'ESPACE':`${Math.max(0,Math.ceil(recharge-charged))} s`;
      this.fill.style.width=`${progress*100}%`;this.meter.setAttribute('aria-valuenow',String(Math.round(progress*100)));
      this.hint.textContent=active?'Poussée moteur':ready?'Espace pour activer':'Restez dernier pour recharger';
    }
    if(g.debug&&data) {
      const rows=m.race.standings,participants=rows.filter(r=>!r.disconnected&&!r.dnf);
      this.ui.elements.debug.textContent+=`\nBOOST · SERVEUR\nBoost unlocked: ${data.unlocked}\nLeader lap progress: ${(data.leaderProgress%1).toFixed(2)}\nCurrent last racer: ${data.lastPlacePlayerId??'—'}\nHuman position: ${participants.findIndex(r=>r.id===id)+1} / ${data.totalRacers}\nServer boost state: ${state?.state??'LOCKED'}\nCharge: ${(state?.chargeSeconds??0).toFixed(1)} / ${data.rechargeSeconds}\nBoost remaining: ${(state?.remainingSeconds??0).toFixed(1)} s`;
    }
  }
}
