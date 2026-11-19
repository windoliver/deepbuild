// Takes the #1041 taste pictures from the web player's page in a browser (tests/acceptance/1041 README: The taste call):
// the suite's dungeon, exported by `deep-show run` to the web, served over HTTP by the suite's own server and opened in
// headless Google Chrome with WebGPU on, through the suite's own helpers. Writes beside itself:
//   player-save-controls.png   the player with its save, export and import controls, after its save at step 1,800
//   player-save-refused.png    the notice after a save the browser refused: the save at step 1,200 under a quota of 64
//                              bytes, set after the save at step 600, as the suite's quota test sets it
// and prints each SHA-256. The suite's helpers are TypeScript and assert through vitest, so it runs under vitest. From
// the repository root, after `cargo build --locked --bin deep-show --no-default-features --features full`:
//   node node_modules/vitest/vitest.mjs run --root docs/evidence/1041 shoot.test.mjs --testTimeout=900000
// Needs Google Chrome.
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const BIN = join(REPO, 'target', 'debug', 'deep-show');
const { Browser, Server, appRun, exportPiece, openPiece, playToSave, sleep } = await import(join(REPO, 'tests', 'acceptance', '1041', 'helpers.ts'));
// The piece is 16 by 9 and its canvas fills the page's width, so the view is taller than that to hold what sits under it.
const VIEW = { width: 960, height: 680, deviceScaleFactor: 2, mobile: false };

/** The page as the browser draws it at the view's size, written beside this file. */
async function shot(page, name) {
  await page.cdp.send('Emulation.setDeviceMetricsOverride', VIEW, page.session);
  await sleep(500);
  const bytes = Buffer.from((await page.cdp.send('Page.captureScreenshot', { format: 'png' }, page.session)).data, 'base64');
  writeFileSync(join(HERE, name), bytes);
  console.log(`${name}  ${createHash('sha256').update(bytes).digest('hex')}`);
}

it('takes the #1041 taste pictures', async () => {
  const work = mkdtempSync(join(tmpdir(), 'deep-1041-shoot-'));
  const server = new Server();
  const browsers = [];
  try {
    const app = appRun(BIN, join(work, 'evidence'), 'dungeon');
    exportPiece(BIN, join(work, 'evidence'), 'dungeon', join(work, 'site', 'dungeon'));
    const origin = await server.start(join(work, 'site'));
    const url = `${origin}/dungeon/index.html`;

    // The controls, once the dungeon has saved at step 1,800.
    browsers.push(await Browser.open());
    const saved = await openPiece(browsers[0], url, 'the dungeon');
    await playToSave(saved.page, 1800, app, 'the dungeon');
    await shot(saved.page, 'player-save-controls.png');

    // The notice after a refused save: the quota set after the first save, held as the suite holds it, then the second.
    browsers.push(await Browser.open());
    const refused = await openPiece(browsers[1], url, 'the dungeon under a quota');
    await playToSave(refused.page, 600, app, 'the first save');
    await browsers[1].quota(origin, 64);
    await sleep(35_000);
    await refused.page.play();
    await refused.page.reached(1200, 'the second save', 140_000);
    const said = await refused.page.noticed('save_failed', 30_000);
    await refused.page.pause();
    if (!said.length) throw Error('the page shows no notice after the refused save');
    await shot(refused.page, 'player-save-refused.png');
  } finally {
    for (const b of browsers) await b.close();
    await server.stop();
    rmSync(work, { recursive: true, force: true });
  }
}, 900_000);
