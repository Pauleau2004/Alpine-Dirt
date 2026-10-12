import '../style.css';
import '../network.css';
import { Game } from './Game.js';
import { isDevAuthorized } from './devAuth.js';

const game=new Game();
game.init().then(()=>{
  // Accessible uniquement en mode dev ou tests autorisés sur localhost
  if(isDevAuthorized())window.__motocross=game;
}).catch(error=>{
  console.error(error);
  document.querySelector('#ui').innerHTML='<div class="fatal"><h1>La piste n’a pas pu démarrer.</h1><p>Activez l’accélération graphique du navigateur puis rechargez cette page.</p><p>Si le problème persiste, la console du navigateur contient le détail.</p><button>Réessayer</button></div>';
  document.querySelector('.fatal button').onclick=()=>location.reload();
});
