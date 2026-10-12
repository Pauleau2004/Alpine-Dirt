import { formatTime } from './TimeTrial.js';
import { recordCard } from './RacePresentation.js';
import { BoostHUD } from './BoostHUD.js';
import { MapSelectionUI } from './tracks/MapSelectionUI.js';
import { CollisionDebug } from './network/CollisionDebug.js';
import './checkpoint-recovery.css';
export class UI {
  constructor(game) {
    this.game=game;this.root=document.querySelector('#ui');this.messageTime=0;this.lastHud=0;
    this.root.innerHTML=`
      <div class="brand"><span class="brand-mark">M<span>×</span></span><span>ALPINE DIRT<span class="brand-sub">SOLO MOTOCROSS</span></span></div>
      <div class="top-actions">
        <span class="local-tag"><i></i> SESSION LOCALE</span>
        <button class="icon-button" id="pause-button" aria-label="Mettre en pause" title="Pause · Échap">Ⅱ</button>
      </div>
      <div id="screen"></div>
      <div id="hud" hidden>
        <div class="timing"><div><label id="lap-label">TOUR</label><strong id="lap">1 <span>/ 3</span></strong></div><div><label>TEMPS DU TOUR</label><strong id="time">00:00.000</strong></div><div><label>MEILLEUR TOUR</label><strong id="best">—:——.———</strong></div></div>
        <div class="course-progress"><span id="checkpoint-label">CHECKPOINT 01 / 10</span><div><i id="checkpoint-progress"></i></div><small id="respawn-label">RESPAWN · 01 / 36</small></div>
        <div class="map-panel"><div class="map-title">ALPINE DIRT <span>01</span></div><canvas id="minimap" width="360" height="280" aria-label="Mini-carte du circuit"></canvas></div>
        <div class="speed-panel"><svg viewBox="0 0 160 160" aria-hidden="true"><circle class="speed-track" cx="80" cy="80" r="68"/><circle id="speed-arc" cx="80" cy="80" r="68"/></svg><div><strong id="speed">0</strong><span>km/h</span></div><label id="bike-status">AU SOL</label></div>
        <div class="ride-controls"><span><kbd>W</kbd> Accélérer</span><span><kbd>S</kbd> Freiner</span><span><kbd>A</kbd><kbd>D</kbd> Tourner</span><span><kbd>R</kbd> Replacer</span><span><kbd>C</kbd> Caméra</span></div>
      </div>
      <div id="countdown" hidden></div><div id="toast" role="status" hidden></div><div id="fps" hidden></div><pre id="debug" hidden></pre>
      <div class="footer"><span>TERRE. RELIEF. LIBERTÉ.</span><span>V1.1 <i></i> CLAVIER REQUIS</span></div>`;
    this.screen=this.root.querySelector('#screen');
    this.hud=this.root.querySelector('#hud');
    this.elements=Object.fromEntries(['lap','lap-label','time','best','speed','speed-arc','bike-status','checkpoint-label','checkpoint-progress','respawn-label','countdown','toast','fps','debug'].map(id=>[id,this.root.querySelector(`#${id}`)]));
    this.map=this.root.querySelector('#minimap').getContext('2d');
    this.boostHUD=new BoostHUD(game,this);
    this.mapSelection=new MapSelectionUI(game);
    this.recoveryBanner=document.createElement('div');this.recoveryBanner.id='checkpoint-recovery';this.recoveryBanner.hidden=true;this.recoveryBanner.setAttribute('role','status');this.root.append(this.recoveryBanner);
    this.root.querySelector('#pause-button').onclick=()=>game.action('pause');
    this.root.addEventListener('click',e=>{
      const button=e.target.closest('[data-action]');if(!button)return;
      const action=button.dataset.action;
      if(action==='select-trial'){this.mapSelection.open('trial','solo');return;}
      if(action==='select-practice'){this.mapSelection.open('practice','solo');return;}
      if(action==='select-map'){this.mapSelection.open('race');return;}
      if(action==='map-confirm'){this.mapSelection.confirm();return;}
      if(action==='map-back'){this.mapSelection.back();return;}
      if(action==='map-plan'){this.mapSelection.plan();return;}
      if(action==='map-plan-back'){this.mapSelection.render();return;}
      if(action.startsWith('spectate-')){game.spectator.cycle(action==='spectate-next'?1:-1);button.blur();return;}
      if(action.startsWith('net-')){game.multiplayer.ui.action(action);return;}
      if(action==='solo'){game.state='solo';this.setScreen('solo');}
      if(action==='multiplayer')game.multiplayer.openMenu();
      if(action==='trial'||action==='practice')game.start(action);
      if(action==='settings')game.openSettings();
      if(action==='back')game.closeSettings();
      if(action==='resume')game.resume();
      if(action==='restart')game.start(game.trial.mode,{flyingStart:game.trial.flyingStart});
      if(action==='menu')game.showMenu();
      button.blur();
    });
  }
  setScreen(type) {
    this.root.classList.toggle('is-spectating',['net-arrived'].includes(type));
    this.root.classList.toggle('is-playing',['playing','countdown','net-arrived'].includes(type));
    this.root.classList.toggle('is-menu',['menu','solo','map-select','multiplayer','create-room','join-room','lobby'].includes(type));
    this.hud.hidden=!['playing','countdown','paused','net-arrived'].includes(type);
    this.screen.hidden=type==='playing'||type==='countdown';
    const mapTitle=this.root.querySelector('.map-title');mapTitle.firstChild.textContent=this.game.track.title.toUpperCase()+' ';mapTitle.querySelector('span').textContent=this.game.track.number;
    if(type==='map-select'){this.mapSelection.render();return;}
    if(['multiplayer','create-room','join-room','lobby','net-loading','net-arrived','net-results'].includes(type)){this.game.multiplayer.ui.render(type);return;}
    const button=(action,label,primary=false)=>`<button data-action="${action}" class="menu-button ${primary?'primary':''}"><span>${label}</span><span aria-hidden="true">↗</span></button>`;
    if(type==='menu'||type==='solo') {
      const isSolo=type==='solo';
      const eyebrow=isSolo?'MODE SOLO · CHOISISSEZ VOTRE MODE':'LE CIRCUIT VOUS ATTEND';
      const desc=isSolo?'Sélectionnez un mode pour choisir votre circuit.':'Trouvez votre trajectoire.';
      const nav=isSolo?
        button('select-trial','Contre-la-montre',true)+
        button('select-practice','Entraînement libre')+
        button('menu','Retour'):
        button('solo','Solo',true)+
        button('multiplayer','Multijoueur local')+
        button('settings','Paramètres');
      const title=`<h1>MOTO<span>CROSS<span class="title-dot">.</span></span></h1>`;
      const help=`<span><kbd>W</kbd><kbd>A</kbd><kbd>D</kbd> pour piloter</span><span>ZQSD et flèches compatibles</span>`;
      const trackSurface = 'm de terre';
      const obstacleLabel = 'sauts';
      const trackDesc = this.game.track.id==='hillside'?'Lacets, coteaux et lignes rapprochées.':'Des crêtes aux épingles.';
      this.screen.innerHTML=`<div class="main-menu"><div class="eyebrow"><span></span> ${eyebrow}</div>${title}<p class="menu-description">${desc}</p><nav class="menu-nav" aria-label="${isSolo?'Menu solo':'Menu principal'}">${nav}</nav><div class="menu-help">${help}</div></div><aside class="track-card"><div class="track-number">${this.game.track.number} <span>/ CIRCUIT</span></div><h2>${this.game.track.title}</h2><p>${trackDesc}</p><div class="track-facts"><span><strong>${Math.round(this.game.track.length)}</strong>${trackSurface}</span><span><strong>06</strong>joueurs LAN</span><span><strong>${String(this.game.track.features?.filter(f=>f.kind==='jump').length??0).padStart(2,'0')}</strong>${obstacleLabel}</span></div><div class="track-card-bottom"><i></i> PISTE OUVERTE <span>↗</span></div></aside>`;
    }
    if(type==='paused')this.screen.innerHTML=`<div class="scrim"></div><section class="dialog"><div class="eyebrow">UNE RESPIRATION</div><h2>En pause<span>.</span></h2><p>${this.game.multiplayer.inRace?'La course continue pour les autres. Votre moto freine.':'La piste sera toujours là.'}</p>${button('resume','Reprendre',true)}${this.game.multiplayer.inRace?'':button('restart','Recommencer')}${button('settings','Paramètres')}${button(this.game.multiplayer.inRace?'net-leave':'menu',this.game.multiplayer.inRace?'Quitter la course':'Menu principal')}</section>`;
    if(type==='settings')this.renderSettings();
    if(type==='finished') {
      const trial=this.game.trial;
      const track=this.game.track,serverRec=this.game.serverRecords??[];
      this.screen.innerHTML=`<div class="scrim"></div><section class="dialog results"><div class="eyebrow">SESSION TERMINÉE</div><h2>${trial.newBest?'Nouveau record':'Bien roulé'}<span>.</span></h2><p>${trial.results.length} tours · ${formatTime(trial.total)} au total</p><div class="lap-results">${trial.results.map((lap,i)=>`<div><span>TOUR ${i+1}</span><strong>${formatTime(lap.time)}</strong><small>${lap.valid?'VALIDÉ':'NON HOMOLOGUÉ'}</small></div>`).join('')}</div><p>Meilleur tour : <strong>${formatTime(trial.best)}</strong></p><div data-server-records>${recordCard(serverRec,'SERVEUR')}</div>${button('select-trial','Repartir',true)}${button('menu','Menu principal')}</section>`;
      this.game.fetchServerRecords().then(()=>{
        const target=this.screen.querySelector('[data-server-records]');
        if(this.game.state==='finished'&&this.game.track===track&&target)target.innerHTML=this.game.serverRecords===null?'<p>Serveur de records indisponible.</p>':recordCard(this.game.serverRecords,'SERVEUR');
      });
    }
  }
  renderSettings() {
    const s=this.game.settings.values;
    this.screen.innerHTML=`<div class="scrim"></div><section class="dialog settings"><div class="eyebrow">À VOTRE MAIN</div><h2>Paramètres<span>.</span></h2><div class="setting-row"><label for="quality">Qualité</label><select id="quality" data-setting="quality"><option value="low">Faible</option><option value="medium">Moyen</option><option value="high">Élevé</option></select></div><div class="setting-row"><label for="shadows">Ombres</label><input id="shadows" data-setting="shadows" type="checkbox" role="switch"></div><div class="setting-row"><label for="particles">Poussière</label><input id="particles" data-setting="particles" type="checkbox" role="switch"></div><div class="setting-row sensitivity"><label for="sensitivity">Sensibilité <output id="sensitivity-value">${s.sensitivity.toFixed(2)}</output></label><input id="sensitivity" data-setting="sensitivity" type="range" min="0.5" max="1.6" step="0.05"></div><div class="setting-row"><label for="camera">Caméra</label><select id="camera" data-setting="camera"><option value="close">Proche</option><option value="wide">Large</option><option value="firstPerson">Première personne</option></select></div><div class="setting-row"><label for="fps-setting">Afficher les FPS</label><input id="fps-setting" data-setting="fps" type="checkbox" role="switch"></div><p class="settings-note">Vos réglages sont enregistrés automatiquement.</p><button data-action="back" class="menu-button primary"><span>Retour</span><span>↵</span></button></section>`;
    this.screen.querySelectorAll('[data-setting]').forEach(el=>{
      const key=el.dataset.setting;
      if(el.type==='checkbox')el.checked=s[key];else el.value=s[key];
      el.addEventListener('input',()=>{
        this.game.settings.set(key,el.type==='checkbox'?el.checked:el.value);
        if(key==='sensitivity')this.screen.querySelector('#sensitivity-value').textContent=this.game.settings.values.sensitivity.toFixed(2);
        this.game.applySettings();
      });
    });
  }
  toast(message,seconds=3) {this.elements.toast.textContent=message;this.elements.toast.hidden=false;this.messageTime=seconds;}
  update(dt,time) {
    const g=this.game,b=g.physics,e=this.elements;
    if(this.messageTime>0){this.messageTime-=dt;if(this.messageTime<=0)e.toast.hidden=true;}
    e.countdown.hidden=g.state!=='countdown';
    if(!e.countdown.hidden)e.countdown.innerHTML=`<strong>${Math.max(1,Math.ceil(g.countdown))}</strong><span>PRÊT À ROULER</span>`;
    const showCollDebug=g.SHOW_COLLISION_DEBUG||(typeof window!=='undefined'&&window.SHOW_COLLISION_DEBUG);
    e.fps.hidden=!g.settings.values.fps&&!g.debug&&!showCollDebug;
    e.debug.hidden=!g.debug&&!showCollDebug;
    const recovery=g.multiplayer?.inRace?g.multiplayer.standing?.checkpointRecovery:g.trial.mode==='trial'?g.checkpointRecovery?.snapshot():null;
    const recoveryClock=g.multiplayer?.inRace?g.multiplayer.serverNow():g.trial.total*1000;
    this.recoveryBanner.hidden=!recovery||!['playing','paused'].includes(g.state)||!!g.multiplayer?.disconnectedAt;
    if(!this.recoveryBanner.hidden){
      const seconds=Math.max(1,Math.ceil((recovery.deadline-recoveryClock)/1000));
      const text=`Checkpoint manqué — retour dans ${seconds}…`;
      if(this.recoveryBanner.textContent!==text)this.recoveryBanner.textContent=text;
      e.toast.hidden=true;
    }
    if(time-this.lastHud<.07)return;this.lastHud=time;
    e.fps.textContent=`${Math.round(g.fps)} FPS`;
    const lastContact=g.multiplayer?.collisions?.lastContact;
    if(showCollDebug) {
      e.debug.textContent=CollisionDebug.formatText(lastContact);
    } else if(g.debug) {
      const v=b.body.linvel();
      e.debug.textContent=`PHYSIQUE · 120 Hz\nFPS ${Math.round(g.fps)} · ${g.renderer.info.render.calls} draw calls\nVitesse ${(b.speed*3.6).toFixed(1)} km/h\nPosition ${b.position.toArray().map(n=>n.toFixed(2)).join(' / ')}\nVélocité ${[v.x,v.y,v.z].map(n=>n.toFixed(2)).join(' / ')} m/s\nAvant ${b.wheels[0].grounded?'SOL':'AIR'} · ${(b.wheels[0].compression*100).toFixed(1)} cm\nArrière ${b.wheels[1].grounded?'SOL':'AIR'} · ${(b.wheels[1].compression*100).toFixed(1)} cm\nTangage ${(b.pitch*180/Math.PI).toFixed(1)}° · Inclinaison ${(b.roll*180/Math.PI).toFixed(1)}°\nAdhérence ${b.grip.toFixed(2)} · Glisse ${b.slip.toFixed(2)}\nDirection ${(b.steer*180/Math.PI).toFixed(1)}°`;
      if(lastContact)e.debug.textContent+='\n\n'+CollisionDebug.formatText(lastContact);
      if(g.multiplayer?.active)e.debug.textContent+=g.multiplayer.debugText();
    }
    this.boostHUD.update();
    if(this.hud.hidden)return;
    const view=g.spectator.current,visibleBike=view?.physics??b;
    const practice=g.trial.mode==='practice',multi=g.multiplayer?.inRace,standing=view??(multi?g.multiplayer.standing:null);
    const launching=g.trial.mode==='trial'&&g.trial.isLaunching;
    e['lap-label'].textContent=practice?'MODE':launching?'PHASE':'TOUR';
    e.lap.innerHTML=practice?'<span class="free-label">LIBRE</span>':launching?'<span class="free-label">ÉLAN</span>':`${multi?(standing?.lap??1):g.trial.lap} <span>/ ${multi?g.multiplayer.race.laps:(Number.isFinite(g.trial.laps)?g.trial.laps:'∞')}</span>`;
    e.time.previousElementSibling.textContent=multi?'TEMPS DE COURSE':launching?'PRISE D’ÉLAN':'TEMPS DU TOUR';
    e.time.textContent=practice?'—:——.———':launching?formatTime(g.trial.launchTime):formatTime(multi?(standing?.time??Math.max(0,(g.multiplayer.serverNow()-(g.multiplayer.race.startAt??g.multiplayer.serverNow()))/1000)):g.trial.lapTime);
    e.best.previousElementSibling.textContent=multi?'POSITION':'MEILLEUR TOUR';
    e.best.textContent=multi?`${standing?.place??1} / ${g.multiplayer.race.standings.length}`:formatTime(g.trial.best);
    e.speed.textContent=Math.round(Math.abs(visibleBike.speed)*3.6);
    e['speed-arc'].style.strokeDashoffset=427*(1-Math.min(1,Math.abs(visibleBike.speed)/32));
    e['bike-status'].textContent=view?`EN VUE · ${view.name}`:!b.grounded?'EN L’AIR':b.slip>.35?'EN GLISSE':'SUR LA TERRE';

    e['bike-status'].classList.toggle('air',!visibleBike.grounded);
    const gateCount=g.lapCheckpoints.gates.length;
    e['checkpoint-label'].textContent=practice?'ENTRAÎNEMENT LIBRE':launching?'SECTEUR D’ÉLAN · FRANCHISSEZ LA LIGNE':g.lapCheckpoints.next===0?`ARRIVÉE · ${gateCount} / ${gateCount}`:`CHECKPOINT ${String(g.lapCheckpoints.next).padStart(2,'0')} / ${gateCount}`;
    e['checkpoint-progress'].parentElement.hidden=practice;
    e['checkpoint-progress'].style.width=launching?'100%':`${g.lapCheckpoints.passed/g.lapCheckpoints.gates.length*100}%`;
    e['respawn-label'].textContent=`RESPAWN · ${String(g.checkpoints.last+1).padStart(2,'0')} / ${g.checkpoints.count}`;
    this.drawMap();
  }
  drawMap() {
    const ctx=this.map,track=this.game.track,p=this.game.physics.position;
    if(this.mapTrack!==track){this.mapTrack=track;const xs=track.samples.map(p=>p.x),zs=track.samples.map(p=>p.z);this.mapBounds={x:(Math.min(...xs)+Math.max(...xs))/2,z:(Math.min(...zs)+Math.max(...zs))/2,scale:Math.min(320/(Math.max(...xs)-Math.min(...xs)),240/(Math.max(...zs)-Math.min(...zs)))};}
    const scale=track.id==='alpine'?1.12:this.mapBounds.scale;
    const map=(x,z)=>track.id==='alpine'?[180+x*scale,140+z*scale]:[180+(x-this.mapBounds.x)*scale,140+(z-this.mapBounds.z)*scale];
    ctx.clearRect(0,0,360,280);ctx.lineJoin='round';ctx.lineCap='round';
    const recovery=this.game.checkpoints;
    // Rasterize only scenery that remains fixed during a lap. Preserve the
    // canvas text state too, so switching practice/trial keeps identical pixels.
    const key=ctx.textBaseline;
    if(!this.mapBackground||this.mapBackgroundTrack!==track||this.mapBackgroundGates!==recovery.gates||this.mapBackgroundBaseline!==key){
      const canvas=document.createElement('canvas');canvas.width=360;canvas.height=280;
      const background=canvas.getContext('2d');background.textBaseline=ctx.textBaseline;
      background.lineJoin='round';background.lineCap='round';
      this.drawMapBackground(background,track,map,scale,recovery);
      this.mapBackground=canvas;this.mapBackgroundStyle={font:background.font,textAlign:background.textAlign,textBaseline:background.textBaseline};
      this.mapBackgroundTrack=track;this.mapBackgroundGates=recovery.gates;this.mapBackgroundBaseline=key;
    }
    ctx.drawImage(this.mapBackground,0,0);Object.assign(ctx,this.mapBackgroundStyle);
    if(this.game.trial.mode!=='practice')this.game.lapCheckpoints.gates.forEach((gate,i)=>{
      const [gx,gy]=map(gate.position.x,gate.position.z);
      ctx.fillStyle=i===this.game.lapCheckpoints.next?'#d7ef78':'#f1f5e5';ctx.beginPath();ctx.arc(gx,gy,5,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#172e2c';ctx.font='bold 9px Arial';ctx.textAlign='center';ctx.textBaseline='middle';if(this.game.lapCheckpoints.gates.length<=10||i===0||i===this.game.lapCheckpoints.next)ctx.fillText(i===0?'D':String(i),gx,gy+.5);
    });
    for(const remote of this.game.multiplayer?.remotes.values()??[]){if(!remote.bike.group.visible)continue;const p=remote.bike.group.position,[x,y]=map(p.x,p.z);ctx.fillStyle=remote.player.color;ctx.beginPath();ctx.arc(x,y,4.5,0,Math.PI*2);ctx.fill();}
    const [x,y]=map(p.x,p.z);ctx.save();ctx.translate(x,y);ctx.rotate(-this.game.physics.yaw);ctx.fillStyle=this.game.multiplayer?.me?.color??'#e0fa86';ctx.strokeStyle='#233b31';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,9);ctx.lineTo(-6,-6);ctx.lineTo(6,-6);ctx.closePath();ctx.stroke();ctx.fill();ctx.restore();
  }
  drawMapBackground(ctx,track,map,scale,recovery) {
    let move=true;ctx.beginPath();track.samples.forEach((p,i)=>{if(track.id==='canyon'&&track.isGap(i/track.count)){move=true;return;}const [x,y]=map(p.x,p.z);if(move)ctx.moveTo(x,y);else ctx.lineTo(x,y);move=false;});
    ctx.strokeStyle='rgba(238,243,221,.20)';ctx.lineWidth=12;ctx.stroke();ctx.strokeStyle='rgba(238,243,221,.6)';ctx.lineWidth=2;ctx.stroke();
    if(track.gaps){
      for(const g of track.gaps){
        const [x1,y1]=map(g.takeoffLip.x,g.takeoffLip.z),[x2,y2]=map(g.landingStart.x,g.landingStart.z);
        ctx.strokeStyle='#e9d49a';ctx.lineWidth=4;ctx.beginPath();ctx.setLineDash([4,3]);ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.setLineDash([]);
        ctx.fillStyle='#e9d49a';ctx.fillRect(x1-2,y1-2,4,4);ctx.fillRect(x2-2,y2-2,4,4);
      }
    }
    if(track.id==='gaptrack'||track.id==='canyon') {
      const start=track.at(0),[sx,sy]=map(start.position.x,start.position.z);
      const dx=Math.cos(start.yaw)*track.width/2*scale,dy=-Math.sin(start.yaw)*track.width/2*scale;
      ctx.strokeStyle='#f5f5df';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(sx-dx,sy-dy);ctx.lineTo(sx+dx,sy+dy);ctx.stroke();
      ctx.fillStyle='#f5f5df';ctx.font='bold 9px Arial';
      ctx.textAlign=track.id==='canyon'?'left':'right';
      ctx.fillText(track.id==='canyon'?'ARRIVÉE':'START / FINISH',sx+(track.id==='canyon'?1:-1)*(Math.abs(dx)+4),sy-3);
    }
    for(const gate of recovery.gates){const [x,y]=map(gate.position.x,gate.position.z);ctx.fillStyle='rgba(230,240,221,.35)';ctx.fillRect(x-1,y-1,2,2);}
  }
}
