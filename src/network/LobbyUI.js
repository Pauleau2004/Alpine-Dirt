import { MAX_PLAYERS } from '../../shared/multiplayer.js';
import { escapeHTML,recordCard,raceTable,spectatorPanel } from '../RacePresentation.js';
import { MAPS,mapInfo } from '../../shared/maps.js';
import { trackPreview } from '../tracks/MapSelectionUI.js';
import { createTrack } from '../tracks/createTrack.js';
import '../tracks/maps.css';
export { escapeHTML } from '../RacePresentation.js';

const button=(action,label,primary=false,disabled=false)=>`<button type="button" data-action="net-${action}" class="menu-button ${primary?'primary':''}" ${disabled?'disabled':''}><span>${label}</span><span aria-hidden="true">↗</span></button>`;

const playerRowsMarkup=(players,hostId)=>players.map(p=>`
  <div class="lobby-player">
    <i style="background:${p.color}"></i>
    <div>
      <strong style="color:${p.color}">${escapeHTML(p.name)}</strong>
      ${p.id===hostId?'<b class="host-tag">HÔTE</b>':''}
      <small>${p.colorName}</small>
    </div>
    <span class="ready-state ${p.ready?'ready':''}">${p.ready?'PRÊT':'PAS PRÊT'}</span>
    <small>${p.ping} ms</small>
  </div>
`).join('');

const lobbyNoteText=(room,players,c)=>!room.hostPresent?'En attente du propriétaire sur le PC hôte.'
  :players.length<2?'Il faut au moins deux joueurs.'
  :players.every(p=>p.ready)?(c.host?'Tous les joueurs sont prêts. Cliquez sur LANCER LA COURSE pour démarrer.':'Tous les joueurs sont prêts. En attente du départ donné par l’hôte.')
  :`En attente de ${players.filter(p=>!p.ready).length} joueur(s) pas prêt(s).`;


export class LobbyUI {
  constructor(client) {
    this.client=client;this.error='';this.lastHud=0;this.tracks=new Map();
    this.hud=document.createElement('div');this.hud.className='network-standings';this.hud.hidden=true;client.game.ui.root.append(this.hud);
    client.game.ui.root.addEventListener('submit',async event=>{
      if(event.target.id==='net-chat-form'){
        event.preventDefault();
        const input=document.getElementById('net-chat-input');
        if(!input)return;
        const text=input.value.trim();
        if(!text)return;
        input.value='';
        try{await this.client.sendChat(text);}
        catch(err){this.client.game.ui.toast(err.message||'Erreur envoi chat',3);}
        return;
      }
      const form=event.target.closest('[data-network]');if(!form)return;event.preventDefault();this.submit(form);
    });
    window.addEventListener('keydown',event=>{
      if(event.code==='Enter'&&!event.repeat){
        if(!['lobby','net-arrived','net-results'].includes(this.client.game.state))return;
        const input=document.getElementById('net-chat-input');
        if(!input)return;
        if(document.activeElement!==input){
          event.preventDefault();
          input.focus();
        }
      }
      if(event.code==='Escape'){
        const input=document.getElementById('net-chat-input');
        if(input&&document.activeElement===input){
          input.blur();
        }
      }
    });
    client.game.ui.root.addEventListener('change',event=>{
      if(event.target.id==='network-laps')this.perform(()=>client.request('setLaps',{laps:Number(event.target.value)}));
      if(event.target.id==='network-map')this.perform(()=>client.request('setMap',{mapId:event.target.value}));
    });
    client.game.ui.root.addEventListener('click',event=>{
      const voteBtn=event.target.closest('[data-action="net-vote-track"]');
      if(voteBtn&&voteBtn.dataset.track){
        this.client.voteTrack(voteBtn.dataset.track);
      }
    });
  }
  getTrack(id){
    if(!this.tracks.has(id))this.tracks.set(id,createTrack(id));
    return this.tracks.get(id);
  }
  name(){try{return this.currentName??localStorage.getItem('motocross.nickname')??'';}catch{return this.currentName??'';}}
  wrapper(title,content,eyebrow='MULTIJOUEUR LOCAL') {
    return `<div class="scrim"></div><section class="dialog net-dialog ${this.client.game.state==='net-vote'?'map-vote-dialog':this.client.game.state==='net-announcement'?'next-track-dialog':''}"><div class="eyebrow">${eyebrow}</div><h2>${title}<span>.</span></h2>${content}<p class="network-error" role="alert">${escapeHTML(this.error)}</p></section>`;
  }
  chatPanel(extraClass='') {
    return `
      <div class="net-chat ${extraClass}">
        <div class="net-chat-header">CHAT DU SALON</div>
        <div class="net-chat-messages" id="net-chat-messages" aria-live="polite">
          ${this.renderChatMessages()}
        </div>
        <form class="net-chat-form" id="net-chat-form">
          <input id="net-chat-input" type="text" maxlength="200" placeholder="Appuyez sur Entrée pour parler…" autocomplete="off">
          <button type="submit" title="Envoyer">↗</button>
        </form>
      </div>
    `;
  }
  renderChatMessages() {
    const history=this.client.chatHistory||[];
    if(history.length===0){
      return `<div class="net-chat-empty">Aucun message pour l’instant.</div>`;
    }
    return history.map(m=>`
      <div class="net-chat-msg">
        <b style="color:${m.color}">${escapeHTML(m.name)} :</b>
        <span>${escapeHTML(m.text)}</span>
      </div>
    `).join('');
  }
  appendChatMessage(msg) {
    const container=document.getElementById('net-chat-messages');
    if(!container)return;
    const empty=container.querySelector('.net-chat-empty');
    if(empty)empty.remove();
    const el=document.createElement('div');
    el.className='net-chat-msg';
    el.innerHTML=`<b style="color:${msg.color}">${escapeHTML(msg.name)} :</b> <span>${escapeHTML(msg.text)}</span>`;
    container.appendChild(el);
    while(container.children.length>100){
      container.firstElementChild.remove();
    }
    container.scrollTop=container.scrollHeight;
  }
  scrollChatToBottom() {
    const container=document.getElementById('net-chat-messages');
    if(container)container.scrollTop=container.scrollHeight;
  }
  render(type) {
    const c=this.client,g=c.game,s=g.ui.screen;g.ui.root.classList.toggle('is-multiplayer',c.active);
    if(type==='multiplayer')s.innerHTML=this.wrapper('Roulez ensemble',`<p>De 2 à ${MAX_PLAYERS} joueurs sur le même Wi-Fi ou réseau Ethernet.</p>${button('local','Jouer en réseau local',true)}${button('menu','Menu principal')}<p class="network-note">Un salon permanent, le même lien à chaque course. Aucun code à créer.</p>`);
    if(type==='create-room')s.innerHTML=this.wrapper('Créer une partie',`<form data-network="create"><label for="network-name">Votre pseudo</label><input id="network-name" name="name" maxlength="16" required autocomplete="nickname" value="${escapeHTML(this.name())}" placeholder="Votre pseudo"><button class="menu-button primary" type="submit">Créer le salon</button></form>${button('back','Retour')}`);
    if(type==='join-room') {
      const direct=c.localJoin||!!c.joinCode,title=c.localJoin?'Salon local':c.joinInfo?`Partie de ${escapeHTML(c.joinInfo.hostName)}`:'Rejoindre la partie';
      s.innerHTML=this.wrapper(title,`<form data-network="join"><label for="network-name">Votre pseudo</label><input id="network-name" name="name" maxlength="16" required autocomplete="nickname" value="${escapeHTML(this.name())}" placeholder="Votre pseudo">${direct?'':`<label for="network-code">Code du salon</label><input id="network-code" name="code" maxlength="6" minlength="6" required placeholder="MX82KD" autocapitalize="characters" autocomplete="off">`}<p class="network-error">${escapeHTML(c.joinError)}</p><button type="submit" class="menu-button primary" ${c.joinError?'disabled':''}>Rejoindre</button></form>${button('back','Retour')}`);
    }
    if(type==='lobby'&&c.room)this.renderLobby();
    if(type==='net-loading')s.innerHTML=this.wrapper('Chargement',`<p>Installation des joueurs sur la grille…</p><div class="network-loading"></div>`,'DÉPART DE COURSE');
    if(type==='net-arrived'){
      s.innerHTML=spectatorPanel(c.standing,c.race?.standings?.length??c.room?.players?.length??1,'net-leave','Quitter la partie')+this.chatPanel('is-spectating');
      this.scrollChatToBottom();
    }
    if(type==='net-results'){
      const remaining=c.room?.resultsEndAt?Math.max(0,Math.ceil((c.room.resultsEndAt-c.serverNow())/1000)):null;
      s.innerHTML=this.wrapper('Résultats',`
        <div id="network-results"></div>
        ${remaining!==null?`
        <div class="results-countdown-banner">
          <span class="results-countdown-label">PROCHAIN VOTE DANS</span>
          <strong id="results-timer" class="results-countdown-timer">${remaining}s</strong>
        </div>`:''}
        ${this.chatPanel()}
        ${button('lobby','Retour immédiat au lobby',true,!c.host)}
        ${button('leave','Menu principal')}
        <p class="network-note">${c.host?'Tout le monde revient dans ce salon.':'L’hôte peut ramener tout le monde au lobby.'}</p>
      `,'COURSE TERMINÉE');
      this.updateResults();
      this.scrollChatToBottom();
    }
    if(type==='net-vote')this.renderVote();
    if(type==='net-announcement')this.renderNextTrack();
  }
  renderLobby() {
    const c=this.client,room=c.room;
    if(!room)return;
    const dialog=c.game.ui.screen.querySelector('.dialog.net-dialog');
    const prevScroll=dialog?dialog.scrollTop:0;
    const players=room.players.filter(p=>p.connected),canStart=c.host&&players.length>=2&&players.every(p=>p.ready);
    const currentMap=mapInfo(room.mapId);
    const shareUrl=room.permanent?(room.wifiUrl||room.shareUrl):room.shareUrl;
    this.recordsKey=JSON.stringify(room.records);
    c.game.ui.screen.innerHTML=this.wrapper('Salon multijoueur',`
      <div class="lobby-next-map-card">
        <span class="next-map-label">PROCHAINE MAP</span>
        <strong>MAP ${currentMap.number} · ${currentMap.title}</strong>
      </div>
      <div data-map-records="${currentMap.id}" aria-label="Records de ${escapeHTML(currentMap.title)}">
        ${recordCard(room.records??[],'RÉSEAU LOCAL',room.recordSaveError)}
      </div>
      <label for="share-link">Lien à garder et à envoyer à vos amis</label>
      <div class="share-row">
        <input id="share-link" readonly value="${escapeHTML(shareUrl)}">
        <button type="button" data-action="net-copy">${this.copied?'LIEN COPIÉ':'COPIER LE LIEN'}</button>
      </div>
      <div class="lobby-caption">
        <span>${players.length} / ${MAX_PLAYERS} joueurs</span>
        <span>${room.permanent?'SALON PERMANENT':room.code}</span>
      </div>
      <div class="lobby-players">
        ${playerRowsMarkup(players,room.hostId)}
      </div>
      <div class="setting-row">
        <label for="network-map">Choix du circuit</label>
        <select id="network-map" ${c.host?'':'disabled'}>
          ${MAPS.map(m=>`<option value="${m.id}" ${m.id===(room.mapId??'alpine')?'selected':''}>${m.number} · ${m.title}</option>`).join('')}
        </select>
      </div>
      <div class="setting-row">
        <label for="network-laps">Tours</label>
        <select id="network-laps" ${c.host?'':'disabled'}>
          ${[1,2,3,5].map(n=>`<option value="${n}" ${n===room.laps?'selected':''}>${n}</option>`).join('')}
        </select>
      </div>
      ${button('ready',c.me?.ready?'Annuler · je ne suis plus prêt':'Prêt',!c.me?.ready)}
      ${button('start','Lancer la course',true,!canStart)}
      <p class="network-note lobby-status-note">
        ${lobbyNoteText(room,players,c)}
      </p>
      ${this.chatPanel()}
      ${button('leave','Quitter le salon')}
    `,'MÊME RÉSEAU · MÊME PISTE');

    if(prevScroll>0){
      const newDialog=c.game.ui.screen.querySelector('.dialog.net-dialog');
      if(newDialog)newDialog.scrollTop=prevScroll;
    }
    this.scrollChatToBottom();
  }
  updateLobby() {
    const c=this.client,room=c.room;
    if(!room||c.game.state!=='lobby')return;
    const dialog=c.game.ui.screen.querySelector('.dialog.net-dialog');
    const playersEl=c.game.ui.screen.querySelector('.lobby-players');
    if(!dialog||!playersEl){
      this.renderLobby();
      return;
    }
    const players=room.players.filter(p=>p.connected);
    const canStart=c.host&&players.length>=2&&players.every(p=>p.ready);
    const currentMap=mapInfo(room.mapId);

    const mapTitleEl=dialog.querySelector('.lobby-next-map-card strong');
    if(mapTitleEl)mapTitleEl.textContent=`MAP ${currentMap.number} · ${currentMap.title}`;

    const recordsEl=dialog.querySelector('[data-map-records]');
    if(recordsEl){
      const expectedAttr=currentMap.id;
      const recKey=JSON.stringify(room.records);
      if(recordsEl.getAttribute('data-map-records')!==expectedAttr||this.recordsKey!==recKey){
        recordsEl.setAttribute('data-map-records',expectedAttr);
        recordsEl.setAttribute('aria-label',`Records de ${escapeHTML(currentMap.title)}`);
        recordsEl.innerHTML=recordCard(room.records??[],'RÉSEAU LOCAL',room.recordSaveError);
        this.recordsKey=recKey;
      }
    }

    const captionSpan=dialog.querySelector('.lobby-caption span:first-child');
    if(captionSpan)captionSpan.textContent=`${players.length} / ${MAX_PLAYERS} joueurs`;

    const newPlayersHtml=playerRowsMarkup(players,room.hostId);
    if(playersEl.innerHTML!==newPlayersHtml){
      const pScroll=playersEl.scrollTop;
      playersEl.innerHTML=newPlayersHtml;
      if(pScroll>0)playersEl.scrollTop=pScroll;
    }

    const mapSelect=dialog.querySelector('#network-map');
    if(mapSelect){
      mapSelect.disabled=!c.host;
      if(document.activeElement!==mapSelect&&mapSelect.value!==(room.mapId??'alpine')){
        mapSelect.value=room.mapId??'alpine';
      }
    }

    const lapsSelect=dialog.querySelector('#network-laps');
    if(lapsSelect){
      lapsSelect.disabled=!c.host;
      if(document.activeElement!==lapsSelect&&Number(lapsSelect.value)!==room.laps){
        lapsSelect.value=String(room.laps);
      }
    }

    const readyBtn=dialog.querySelector('[data-action="net-ready"]');
    if(readyBtn){
      const isReady=!!c.me?.ready;
      readyBtn.classList.toggle('primary',!isReady);
      const readySpan=readyBtn.querySelector('span:first-child');
      if(readySpan)readySpan.textContent=isReady?'Annuler · je ne suis plus prêt':'Prêt';
    }

    const startBtn=dialog.querySelector('[data-action="net-start"]');
    if(startBtn){
      startBtn.disabled=!canStart;
    }

    const leaveBtn=dialog.querySelector('[data-action="net-leave"]');
    const noteEl=dialog.querySelector('.lobby-status-note')||(leaveBtn?.previousElementSibling?.matches('.network-note')?leaveBtn.previousElementSibling:null);
    if(noteEl){
      noteEl.textContent=lobbyNoteText(room,players,c);
    }

    const errEl=dialog.querySelector('.network-error');
    if(errEl)errEl.textContent=this.error;
  }
  renderVote() {
    const c=this.client,v=c.mapVote||c.room?.mapVote;
    if(!v)return;
    const choices=v.choices||[];
    const myVote=v.votes?.[c.playerId]??null;
    const counts=v.counts||{};
    const remaining=Math.max(0,Math.ceil((v.endsAt-c.serverNow())/1000));
    c.game.ui.screen.innerHTML=this.wrapper('Choisissez le prochain circuit',`
      <div class="vote-timer-banner">
        <span class="vote-timer-label">TEMPS RESTANT</span>
        <strong id="vote-timer" class="vote-timer-clock">${String(remaining).padStart(2,'0')}</strong>
      </div>
      <div class="map-vote-cards">
        ${choices.map(choice=>{
          const isVoted=myVote===choice.id;
          const count=counts[choice.id]??0;
          const t=this.getTrack(choice.id);
          return `
            <button type="button" class="map-vote-card ${isVoted?'voted':''}" data-action="net-vote-track" data-track="${choice.id}">
              <div class="vote-card-header">
                <span class="vote-card-num">MAP ${choice.number}</span>
                <span class="vote-card-label">${choice.label}</span>
              </div>
              <strong class="vote-card-title">${choice.title}</strong>
              <div class="vote-card-preview">${trackPreview(t)}</div>
              <p class="vote-card-desc">${choice.description}</p>
              <div class="vote-card-footer">
                <span class="vote-count-badge" id="vote-badge-${choice.id}"><strong>${count}</strong> ${count>1?'votes':'vote'}</span>
                <span class="vote-tag-btn">${isVoted?'✓ VOTÉ':'VOTER'}</span>
              </div>
            </button>
          `;
        }).join('')}
      </div>
      <p class="network-note" id="vote-user-note">${myVote?`Votre vote : ${choices.find(ch=>ch.id===myVote)?.title??myVote}. Vous pouvez changer d’avis jusqu’à la fin du chrono.`:'Cliquez sur un circuit pour voter. Vous pouvez changer d’avis jusqu’à la fin du chrono.'}</p>
      ${button('leave','Quitter la partie')}
    `,'CHOISISSEZ LE PROCHAIN CIRCUIT');
  }
  updateVote() {
    const c=this.client,v=c.mapVote||c.room?.mapVote;
    if(!v||c.game.state!=='net-vote')return;
    const choices=v.choices||[];
    const myVote=v.votes?.[c.playerId]??null;
    const counts=v.counts||{};
    for(const choice of choices){
      const count=counts[choice.id]??0;
      const badge=document.getElementById(`vote-badge-${choice.id}`);
      if(badge)badge.innerHTML=`<strong>${count}</strong> ${count>1?'votes':'vote'}`;
      const card=document.querySelector(`[data-action="net-vote-track"][data-track="${choice.id}"]`);
      if(card){
        const isVoted=myVote===choice.id;
        card.classList.toggle('voted',isVoted);
        const tag=card.querySelector('.vote-tag-btn');
        if(tag)tag.textContent=isVoted?'✓ VOTÉ':'VOTER';
      }
    }
    const note=document.getElementById('vote-user-note');
    if(note){
      note.textContent=myVote
        ?`Votre vote : ${choices.find(ch=>ch.id===myVote)?.title??myVote}. Vous pouvez changer d’avis jusqu’à la fin du chrono.`
        :'Cliquez sur un circuit pour voter. Vous pouvez changer d’avis jusqu’à la fin du chrono.';
    }
  }
  updateVoteTimer() {
    const c=this.client,v=c.mapVote||c.room?.mapVote;
    if(!v)return;
    const timerEl=document.getElementById('vote-timer');
    if(timerEl){
      const remaining=Math.max(0,Math.ceil((v.endsAt-c.serverNow())/1000));
      timerEl.textContent=String(remaining).padStart(2,'0');
    }
  }
  updateResultsTimer() {
    const c=this.client;
    if(!c.room?.resultsEndAt)return;
    const timerEl=document.getElementById('results-timer');
    if(timerEl){
      const remaining=Math.max(0,Math.ceil((c.room.resultsEndAt-c.serverNow())/1000));
      timerEl.textContent=`${remaining}s`;
    }
  }
  renderNextTrack() {
    const c=this.client,v=c.mapVote||c.room?.mapVote;
    const winner=v?.winner??(c.nextTrack?.track??null);
    const isTie=v?.isTie||c.nextTrack?.isTie;
    const t=winner?this.getTrack(winner.id):null;
    const remaining=c.room?.announcementEndAt?Math.max(0,Math.ceil((c.room.announcementEndAt-c.serverNow())/1000)):5;
    c.game.ui.screen.innerHTML=this.wrapper('Prochaine course',`
      <div class="next-track-card">
        <span class="next-track-num">MAP ${winner?.number??'—'} · ${winner?.label??''}</span>
        <strong class="next-track-title">${winner?.title??'Circuit'}</strong>
        <div class="next-track-preview">${t?trackPreview(t):''}</div>
        <p class="next-track-desc">${winner?.description??''}</p>
      </div>
      <div class="announcement-countdown-banner">
        <span class="announcement-countdown-label">RETOUR AU LOBBY DANS</span>
        <strong id="announcement-timer" class="announcement-countdown-timer">${remaining}s</strong>
      </div>
      <p class="network-note">Retour automatique au salon pour préparer la prochaine manche…</p>
      ${button('leave','Quitter la partie')}
    `,isTie?'ÉGALITÉ — TIRAGE ALÉATOIRE':'VOTE TERMINÉ');
  }
  updateAnnouncementTimer() {
    const c=this.client;
    if(!c.room?.announcementEndAt)return;
    const timerEl=document.getElementById('announcement-timer');
    if(timerEl){
      const remaining=Math.max(0,Math.ceil((c.room.announcementEndAt-c.serverNow())/1000));
      timerEl.textContent=`${remaining}s`;
    }
  }
  updateNextTrack() {
    if(this.client.game.state==='net-announcement'&&!document.querySelector('.next-track-dialog')){
      this.renderNextTrack();
    }
  }
  async copyLink() {
    const input=document.querySelector('#share-link');let copied=false;
    if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(input.value);copied=true;}catch{}}
    if(!copied){input.focus();input.select();try{copied=document.execCommand('copy');}catch{}}
    const copyBtn=document.querySelector('[data-action="net-copy"]');
    if(copied){
      this.copied=true;
      this.client.game.ui.toast('LIEN COPIÉ',2);
      if(copyBtn)copyBtn.textContent='LIEN COPIÉ';
      setTimeout(()=>{
        this.copied=false;
        const btn=document.querySelector('[data-action="net-copy"]');
        if(btn)btn.textContent='COPIER LE LIEN';
      },2500);
    }
    else this.client.game.ui.toast('Lien sélectionné · appuyez sur Ctrl+C',3);
  }
  async perform(fn) {
    if(this.client.busy)return;this.client.busy=true;this.error='';
    try{await fn();}catch(error){this.error=error.message;this.client.game.ui.toast(error.message,5);this.render(this.client.game.state);}finally{this.client.busy=false;}
  }
  async submit(form) {
    const data=new FormData(form);this.currentName=String(data.get('name')??'');
    await this.perform(()=>this.client.enter(this.client.localJoin?'joinLocal':form.dataset.network==='create'?'createRoom':'joinRoom',this.currentName,this.client.joinCode||String(data.get('code')??'').toUpperCase()));
  }
  action(action) {
    const c=this.client;this.error='';
    if(action==='net-local'){c.openLocal();return;}
    if(action==='net-create'){c.screen('create-room');return;}
    if(action==='net-join'){c.openJoin();return;}
    if(action==='net-back'){c.openMenu();return;}
    if(action==='net-menu'||action==='net-leave'){c.leave();c.game.showMenu();return;}
    if(action==='net-copy'){this.copyLink();return;}
    if(action==='net-ready')this.perform(()=>c.request('playerReady',{ready:!c.me?.ready}));
    if(action==='net-start')this.perform(()=>c.request('startRace'));
    if(action==='net-lobby')this.perform(()=>c.request('returnLobby'));
  }
  updateResults() {
    const target=document.querySelector('#network-results');if(!target)return;
    const c=this.client,markup=raceTable(c.race?.standings??[],c.playerId)+recordCard(c.records??[],'RÉSEAU LOCAL',c.recordSaveError);
    if(this.resultMarkup!==markup||this.resultTarget!==target){target.innerHTML=markup;this.resultMarkup=markup;this.resultTarget=target;}
    const button=document.querySelector('[data-action="net-lobby"]');if(button)button.disabled=!this.client.host;
  }
  hideHud(){this.hud.hidden=true;this.client.game.ui.root.classList.remove('is-multiplayer');}
  updateHud() {
    const c=this.client;this.hud.hidden=!c.inRace||c.game.state==='net-results'||c.game.state==='net-vote'||c.game.state==='net-announcement';
    if(this.hud.hidden||!c.race?.standings||performance.now()-this.lastHud<150)return;this.lastHud=performance.now();
    const key=JSON.stringify([c.playerId,c.race.standings.map(p=>[p.id,p.place,p.name,p.color,p.disconnected,p.time!==null,p.dnf])]);
    if(key===this.hudKey)return;
    this.hudKey=key;
    this.hud.innerHTML=`<div class="network-hud-label">CLASSEMENT</div>${c.race.standings.map(p=>`<div class="network-rank ${p.id===c.playerId?'is-me':''}"><b>${p.place}</b><span style="color:${p.color}">${escapeHTML(p.name)}</span><small>${p.disconnected?'DÉCO.':p.time!==null?'ARRIVÉ':p.dnf?'DNF':''}</small></div>`).join('')}`;
  }
}
