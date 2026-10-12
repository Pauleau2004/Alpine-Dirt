export class SpectatorController {
  constructor(game){this.game=game;this.targetId=null;this.current=null;this.lastTargetId=null;}
  get active(){return this.game.state==='net-arrived';}
  candidates() {
    const g=this.game;
    if(g.state==='net-arrived'&&g.multiplayer.inRace)return g.multiplayer.race.standings.filter(s=>s.id!==g.multiplayer.playerId&&s.time===null&&!s.dnf&&!s.disconnected).map(s=>{
      const r=g.multiplayer.remotes.get(s.id);
      return {...s,bike:r?.bike,physics:r?.pose,laps:g.multiplayer.race.laps};
    }).filter(r=>r.bike?.group.visible);
    return [];
  }
  cycle(direction=1) {
    const riders=this.candidates();if(!riders.length)return;
    const i=riders.findIndex(r=>r.id===this.targetId);
    this.targetId=riders[(Math.max(0,i)+direction+riders.length)%riders.length].id;
  }
  reset(){this.current=null;this.targetId=null;this.lastTargetId=null;}
  update(dt) {
    if(!this.active){this.reset();return false;}
    const riders=this.candidates();
    this.current=riders.find(r=>r.id===this.targetId)??riders[0]??null;
    this.targetId=this.current?.id??null;
    if(this.current) {
      // A camera cut on target changes avoids flying across the whole circuit.
      // Tracking itself uses exactly the same damped camera as normal riding.
      if(this.lastTargetId!==this.targetId)this.game.cameraController.snap();
      this.game.cameraController.update(dt,this.current.bike,this.current.physics,this.game.settings.values.camera);
      this.lastTargetId=this.targetId;
    }
    const root=this.game.ui.screen;
    const name=root.querySelector('[data-spectator-name]'),status=root.querySelector('[data-spectator-status]');
    if(name)name.textContent=this.current?.name??'En attente des pilotes';
    if(status)status.textContent=this.current?`Position ${this.current.place} · Tour ${this.current.lap} / ${this.current.laps} · ${riders.length} en piste`:'Classement ou reconnexion en cours…';
    for(const button of root.querySelectorAll('[data-action^="spectate-"]'))button.disabled=riders.length<2;
    return true;
  }
}
