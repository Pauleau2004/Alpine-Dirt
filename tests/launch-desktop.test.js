import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const launcherPath = fileURLToPath(new URL('../scripts/launch-desktop.mjs', import.meta.url));
const rootPath = fileURLToPath(new URL('..', import.meta.url));

test('root exposes one launcher that uses the server-backed desktop start command', () => {
  const commandFiles = readdirSync(rootPath).filter(name => name.toLowerCase().endsWith('.cmd'));
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(commandFiles, ['Alpine Dirt.cmd']);
  assert.equal(packageJson.scripts.start, 'node scripts/launch-desktop.mjs');
});

test('desktop launch opens localhost after the production game responds', async () => {
  assert.ok(existsSync(launcherPath), 'the root desktop launcher needs its server startup module');
  const { launchDesktopGame } = await import(pathToFileURL(launcherPath).href);
  let openedUrl = null;
  let openedResponse = null;
  const server = await launchDesktopGame({
    port: 0,
    openBrowser: async url => {
      openedUrl = url;
      openedResponse = await fetch(url);
    },
  });
  try {
    assert.equal(openedUrl, `http://localhost:${server.port}`);
    assert.equal(openedResponse.status, 200);
    assert.match(await openedResponse.text(), /<title>Alpine Dirt<\/title>/);
    const recordsResponse = await fetch(`${openedUrl}/api/record?map=alpine`);
    assert.equal(recordsResponse.status, 200);
    assert.deepEqual((await recordsResponse.json()).records, []);
  } finally {
    await server.close();
  }
});
