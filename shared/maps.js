export const DEFAULT_MAP_ID='alpine';
export const MAPS=Object.freeze([
  // New technical reference circuit; existing layouts keep their own records.
  Object.freeze({id:'alpine',number:'01',title:'Alpine Dirt',label:'Circuit original',circuitId:'alpine-dirt-ten-gates-v3',description:'Le circuit original · rapide et roulant'}),
  Object.freeze({id:'hillside',number:'02',title:'Coteaux de la Zorn',label:'Circuit vallonné',circuitId:'zorn-hillside-v1',description:'Lacets courts · relief vallonné · rythme & compressions'}),
  Object.freeze({id:'gaptrack',number:'03',title:'Gap Circuit',label:'Circuit aérien',circuitId:'gap-circuit-v5',description:'3 gap jumps dans le vide · croisements superposés · relief aérien'}),
  Object.freeze({id:'canyon',number:'04',title:'Canyon Rouge MX',label:'Circuit motocross & dévers',circuitId:'canyon-rouge-mx-v5',description:'Piste large 14 m · relief doux · vrai gap & réception large'}),
  Object.freeze({id:'terrerouge',number:'05',title:'Les Esses de Terre Rouge',label:'Circuit technique',circuitId:'terre-rouge-mx-v3',description:'6 sauts · whoops & double vague · cuvette et esses techniques'}),
  Object.freeze({id:'sprint',number:'06',title:'Sprint du Soleil',label:'Sprint motocross',circuitId:'sprint-soleil-v2',description:'Épingle & esses · 3 sauts de relance · objectif 40–50 s'}),
]);
export const mapInfo=id=>MAPS.find(map=>map.id===id)??MAPS[0];
export const isMapId=id=>MAPS.some(map=>map.id===id);
