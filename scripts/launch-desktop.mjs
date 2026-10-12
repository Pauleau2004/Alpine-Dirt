import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createGameServer } from '../server/server.js';

function openInDefaultBrowser(url) {
  if (process.platform !== 'win32') {
    console.log(`Ouvrez le jeu dans votre navigateur : ${url}`);
    return;
  }
  const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  browser.once('error', error => console.error(`Impossible d'ouvrir le navigateur : ${error.message}`));
  browser.unref();
}

export async function launchDesktopGame({
  port = Number(process.env.PORT || 3000),
  advertisedHost = process.env.LAN_HOST,
  openBrowser = openInDefaultBrowser,
} = {}) {
  const server = await createGameServer({
    port,
    advertisedHost,
    recordPath: fileURLToPath(new URL('../data/lap-record.json', import.meta.url)),
  });
  const localUrl = `http://localhost:${server.port}`;
  console.log(`Alpine Dirt est prêt : ${localUrl}`);
  await openBrowser(localUrl);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const server = await launchDesktopGame();
    console.log(`Lien de jeu : ${server.manager.shareBaseUrl}/jouer`);
    const stop = () => server.close().then(() => process.exit(0));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    console.error(`Impossible de lancer Alpine Dirt : ${error.message}`);
    process.exitCode = 1;
  }
}