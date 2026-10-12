import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { hostname } from 'node:os';
import { Server } from 'socket.io';
import { RoomManager } from './RoomManager.js';
import { selectLanInterface } from './lanAddress.js';
import { ROOM_PATTERN,MAX_PLAYERS } from '../shared/multiplayer.js';
import { LapRecordStore } from './LapRecordStore.js';
import { MAPS,mapInfo,isMapId } from '../shared/maps.js';
import { cleanPlayerName } from '../shared/lapRecord.js';
import { createRequestPolicy,PRIVATE_DEV_FILES } from './RequestSecurity.js';

export async function createGameServer({port=3000,host='0.0.0.0',dev=false,advertisedHost,recordPath=null,...roomOptions}={}) {
  const recordStore=await new LapRecordStore(recordPath).load();
  const recordStores=new Map(await Promise.all(MAPS.map(async (m,i)=>[m.id,i===0?recordStore:await new LapRecordStore(recordPath?`${recordPath}.${m.id}.json`:null,m.circuitId).load()])));
  const app=express(),http=createServer(app);
  const network=selectLanInterface(),ip=advertisedHost??network?.address;
  const computerName=hostname().toLowerCase();
  const shareHost=advertisedHost??(/^[a-z0-9][a-z0-9-]{0,62}$/.test(computerName)?`${computerName}.local`:ip??'localhost');
  const allowRequest=createRequestPolicy([shareHost,ip]);
  http.requestTimeout=15000;http.headersTimeout=10000;http.maxHeadersCount=64;
  const io=new Server(http,{maxHttpBufferSize:8192,pingInterval:2000,pingTimeout:3000,allowRequest:(req,done)=>done(null,allowRequest(req))});
  const manager=new RoomManager(io,{...roomOptions,recordStore,recordStores,lanUrl:`http://${ip??'localhost'}:${port}`});
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    if(!allowRequest(req)){res.status(403).json({error:'Origine ou adresse du serveur refusée.'});return;}
    res.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'});
    if(!dev)res.set('Content-Security-Policy',`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://${req.headers.host}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    next();
  });
  app.use(express.json({limit:'8kb'}));
  app.get('/api/record',(req,res)=>{const map=mapInfo(req.query.map),store=recordStores.get(map.id);res.set('Cache-Control','no-store').json({mapId:map.id,record:store?.record??null,records:store?.records??[],saveError:!!store?.error});});
  const MIN_LAP_TIMES={alpine:30.0,hillside:55.0,gaptrack:45.0,canyon:45.0};
  app.post('/api/trial-record',(req,res)=>{
    const mapId=req.query.map;
    if(!isMapId(mapId))return res.status(403).json({error:'Circuit inconnu.'});
    if(req.body?.boost||req.body?.boosted||req.body?.boostStrength)return res.status(403).json({error:'Les tours avec boost ne sont pas homologués pour le classement.'});
    const map=mapInfo(mapId),store=recordStores.get(map.id);
    if(!store)return res.status(403).json({error:'Circuit inconnu.'});
    const time=Number(req.body?.time),minTime=MIN_LAP_TIMES[map.id]??25.0;
    if(!Number.isFinite(time)||time<minTime||time>600)return res.status(403).json({error:'Temps invalide.'});
    const name=cleanPlayerName(req.body?.name);
    store.submit(time,name,Date.now());
    res.json({mapId:map.id,record:store.record,records:store.records,saveError:!!store.error});
  });
  app.get('/api/server-info',(_req,res)=>res.json({localUrl:`http://localhost:${http.address()?.port??port}`,lanUrl:manager.lanUrl,playUrl:`${manager.shareBaseUrl??manager.lanUrl}/jouer`,wifiPlayUrl:`${manager.lanUrl}/jouer`,lanAvailable:!!ip,interfaceName:advertisedHost?'LAN_HOST':network?.name??null,wifi:!advertisedHost&&!!network?.wifi,maxPlayers:MAX_PLAYERS}));
  app.get('/api/rooms/:code',(req,res)=>{
    const code=req.params.code.toUpperCase(),room=ROOM_PATTERN.test(code)&&manager.rooms.get(code);
    if(!room){res.status(404).json({error:'Ce salon n’existe plus.'});return;}
    res.json({code,hostName:room.players.get(room.hostId)?.name??'un joueur',state:room.state,count:[...room.players.values()].filter(p=>p.connected).length});
  });
  const root=resolve(fileURLToPath(new URL('..',import.meta.url)));let vite;
  if(dev){const {createServer}=await import('vite');vite=await createServer({root,configFile:false,server:{middlewareMode:true,hmr:{server:http},allowedHosts:[shareHost,computerName],fs:{strict:true,deny:PRIVATE_DEV_FILES}},appType:'spa'});app.use(vite.middlewares);}
  else {
    const dist=resolve(root,'dist');app.use(express.static(dist));
    app.get('/jouer',(_req,res)=>{if(existsSync(resolve(dist,'index.html')))res.sendFile(resolve(dist,'index.html'));else res.status(503).type('text').send('Lancez npm run build puis npm start.');});
    app.get('/',(_req,res)=>res.status(503).type('text').send('Jeu non compilé. Lancez npm run build puis npm start.'));
    if(!existsSync(resolve(dist,'index.html')))console.warn('Le dossier dist est absent : lancez npm run build.');
  }
  await new Promise((resolve,reject)=>{http.once('error',reject);http.listen(port,host,resolve);});
  const actualPort=http.address().port;manager.lanUrl=`http://${ip??'localhost'}:${actualPort}`;manager.shareBaseUrl=`http://${shareHost}:${actualPort}`;
  return {http,io,manager,recordStore,recordStores,port:actualPort,ip,network,close:async()=>{manager.close();await vite?.close();await new Promise(resolve=>io.close(resolve));await Promise.all([...recordStores.values()].map(store=>store.flush()));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const port=Number(process.env.PORT||3000),override=process.env.LAN_HOST;
  if(!Number.isInteger(port)||port<1||port>65535||(override&&!isIPv4(override))){console.error('PORT ou LAN_HOST invalide.');process.exitCode=1;}
  else createGameServer({port,dev:process.argv.includes('--dev'),advertisedHost:override,recordPath:fileURLToPath(new URL('../data/lap-record.json',import.meta.url))}).then(server=>{
    console.log(`\n----------------------------------\nALPINE DIRT SERVER\n\nLocal :\nhttp://localhost:${server.port}\n\nLien permanent :\n${server.manager.shareBaseUrl}/jouer\n\nRéseau local ${server.network?.wifi?'Wi-Fi':'(Wi-Fi prioritaire)'} :\n${server.ip?server.manager.lanUrl:'Aucune IPv4 LAN détectée. Connectez le PC au Wi-Fi ou à Ethernet.'}\nInterface : ${override?'LAN_HOST':server.network?.name??'aucune'}\n\nSi les autres appareils ne peuvent pas se connecter,\nvérifiez que Node.js est autorisé dans le Pare-feu Windows\nsur les réseaux privés.\n----------------------------------\n`);
    const stop=()=>server.close().then(()=>process.exit(0));process.once('SIGINT',stop);process.once('SIGTERM',stop);
  }).catch(error=>{console.error(`Impossible de démarrer le serveur : ${error.message}`);process.exitCode=1;});
}
