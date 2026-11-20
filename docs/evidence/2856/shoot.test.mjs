// Takes the #2856 taste pictures from the web player's pages in a browser (tests/acceptance/2856 README: The taste
// call): #172's lab with its 600-step track, exported to the web by `deep-show run`, served by the #2856 suite's test
// server and opened in headless Google Chrome with WebGPU on, all through that suite's own helpers. Writes beside
// itself:
//   player-stopped.png          the lab played from its start under the suite's shim, whose frame call throws at step
//                               300: the stopped notice over the frame the player held
//   player-script-refused.png   the lab's page with its element script served as text/plain: the line and its link
// and prints each SHA-256. The suite's helpers register vitest hooks, so it runs under vitest. From the repository
// root, after `cargo build --locked --bin deep-show --no-default-features --features full`:
//   node node_modules/vitest/vitest.mjs run --root docs/evidence/2856 shoot.test.mjs --testTimeout=3600000 --hookTimeout=180000
// Needs Google Chrome.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const BIN = join(REPO, 'target', 'debug', 'deep-show');
const { STOP_STEP, closePage, elementScriptOf, exportLab, openPage, waitFor } = await import(join(REPO, 'tests', 'acceptance', '2856', 'helpers.ts'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
/** The page as the browser shows it, over the tab's own DevTools session. */
const picture = async (page) => Buffer.from((await page.tab.cdp.send('Page.captureScreenshot', { format: 'png' }, page.tab.session)).data, 'base64');
const shot = (name, bytes) => { writeFileSync(join(HERE, name), bytes); console.log(`${name}  ${sha(bytes)}`); };

it('takes the #2856 taste pictures', async () => {
  const work = mkdtempSync(join(tmpdir(), 'deep-2856-shoot-'));
  let page;
  try {
    const lab = exportLab(BIN, work, join(work, 'lab'), 'the lab');
    // The lab stopped by the shim's throw at step 300: the stopped notice over the frame the player held.
    page = await openPage(lab.out, { shim: { stopAt: STOP_STEP } });
    await page.tab.mustBeReady('the lab');
    await page.tab.evaluate(`(() => { window.__deep2856.armed = true; const p = document.querySelector('deep-player'); p.currentTime = 0; p.play(); })()`, 60_000, true);
    if (!(await waitFor(page.tab, 'window.__deep2856.next !== null', 180_000))) throw Error(`the shim's throw at step ${STOP_STEP} never came`);
    await sleep(1_000);
    shot('player-stopped.png', await picture(page));
    await closePage(page);
    // The lab's page with its element script served as text/plain: the browser refuses it, and the line shows.
    const script = elementScriptOf(readFileSync(join(lab.out, 'index.html'), 'utf8'), 'the lab');
    page = await openPage(lab.out, { odd: { path: script.path, type: 'text/plain' } });
    if (!(await waitFor(page.tab, `document.readyState === 'complete'`, 60_000))) throw Error('the page whose script was refused never loaded');
    await sleep(1_000);
    shot('player-script-refused.png', await picture(page));
  } finally {
    await closePage(page);
    rmSync(work, { recursive: true, force: true });
  }
});
