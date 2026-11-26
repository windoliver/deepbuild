// Takes the #1042 taste pictures from the web player's page in a browser (tests/acceptance/1042 README: The taste call):
// the suite's yard and scroll, exported by `deep-show run` to the web, served over HTTP by the suite's own server and
// opened in headless Google Chrome with WebGPU on, through the suite's own helpers. Writes beside itself:
//   player-ray-shadow-fallback.png   the yard, whose light policy names ray-traced shadows, 2 s in, drawn by the
//                                    player with today's light
//   player-cjk-subset.png            the scroll's forty Han graphemes at its start, set in the bundle's subset of
//                                    the CJK face
//   app-yard-2s.png                  the app's own render of the yard 2 s in (a png_seq still), to hold beside the
//                                    player's picture; no test reads it
// and prints each SHA-256. The suite's helpers are TypeScript and assert through vitest, so it runs under vitest. From
// the repository root, after `cargo build --locked --bin deep-show --no-default-features --features full`:
//   node node_modules/vitest/vitest.mjs run --root docs/evidence/1042 shoot.test.mjs --testTimeout=900000
// Needs Google Chrome.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const BIN = join(REPO, 'target', 'debug', 'deep-show');
const SUITE = join(REPO, 'tests', 'acceptance', '1042');
const { appStill, exportWeb, receiptOf, scrollDoc, yardDoc } = await import(join(SUITE, 'helpers.ts'));
const { Browser, BundleServer } = await import(join(SUITE, 'web.ts'));
// Both pieces are 16 by 9 and the canvas fills the page's width.
const VIEW = { width: 960, height: 560, deviceScaleFactor: 2, mobile: false };

/** The page as the browser draws it at the view's size, once it has drawn at that size, written beside this file. */
async function shot(page, name) {
  await page.cdp.send('Emulation.setDeviceMetricsOverride', VIEW, page.session);
  await page.evaluate('the page drawn at the view\'s size', 'new Promise((drawn) => requestAnimationFrame(() => requestAnimationFrame(() => drawn(true))))');
  const bytes = Buffer.from((await page.cdp.send('Page.captureScreenshot', { format: 'png' }, page.session)).data, 'base64');
  writeFileSync(join(HERE, name), bytes);
  console.log(`${name}  ${createHash('sha256').update(bytes).digest('hex')}`);
}

it('takes the #1042 taste pictures', async () => {
  const work = mkdtempSync(join(tmpdir(), 'deep-1042-shoot-'));
  const server = new BundleServer();
  let browser;
  try {
    const site = join(work, 'site');
    for (const [name, doc] of [['yard', yardDoc()], ['scroll', scrollDoc()]]) {
      const evidence = join(work, `evidence-${name}`);
      mkdirSync(evidence, { recursive: true });
      mkdirSync(site, { recursive: true });
      receiptOf(exportWeb(BIN, evidence, doc, join(site, name), `the ${name} exported to the web`), join(site, name), `the ${name} exported to the web`);
    }
    mkdirSync(join(work, 'evidence-app'), { recursive: true });
    appStill(BIN, join(work, 'evidence-app'), yardDoc(), '2s', [640, 360], [60, 1], join(work, 'app'), "the app's still of the yard");
    const still = readFileSync(join(work, 'app', 'app-still', readdirSync(join(work, 'app', 'app-still')).find((f) => f.endsWith('.png'))));
    writeFileSync(join(HERE, 'app-yard-2s.png'), still);
    console.log(`app-yard-2s.png  ${createHash('sha256').update(still).digest('hex')}`);
    const origin = await server.start(site);
    browser = await Browser.open();

    const yard = await browser.page(`${origin}/yard/index.html`);
    await yard.ready('the yard');
    await yard.evaluate('the yard sought to 2 s', "(() => { document.querySelector('deep-player').currentTime = 2; })()");
    await shot(yard, 'player-ray-shadow-fallback.png');

    const scroll = await browser.page(`${origin}/scroll/index.html`);
    await scroll.ready('the scroll');
    await shot(scroll, 'player-cjk-subset.png');
  } finally {
    await browser?.close();
    await server.stop();
    rmSync(work, { recursive: true, force: true });
  }
}, 900_000);
