// Takes the #169 taste pictures from the walkthrough's playable page in a browser: the #169 acceptance suite's 3D
// walkthrough (four stages, an explode toggle, three finishes), exported by `deep-show run` as a page at 640 × 360 and
// 30 fps, then opened from disk in Google Chrome with networking off (the suite's own driver, `Headless`, which proves
// it off with a canary request first) and stepped by the page's own keys. Writes beside itself:
//   page-start.png      the page at its start (plate, together, lagoon)
//   page-exploded.png   after the explode key
//   page-lagoon.png     at the shell stage, finish lagoon
//   page-orchid.png     the same, finish orchid
//   page-graphite.png   the same, finish graphite
//   page-stepping.webm  stepping through the four stages and the toggle, 10 frames a second, encoded by ffmpeg
// and prints each SHA-256. Run from the repository root after
// `cargo build --locked --bin deep-show --no-default-features --features full`:
//   node --experimental-transform-types docs/evidence/169/shoot.mjs
// Needs Google Chrome and ffmpeg on PATH.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const BIN = join(REPO, 'target', 'debug', 'deep-show');
const { DOC, Headless, WALK_RATE, WALK_SIZE, pageExport, present, scenarioOf, walkthrough } = await import(join(REPO, 'tests', 'acceptance', '169', 'helpers.ts'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const work = mkdtempSync(join(tmpdir(), 'deep-169-shoot-'));
const h = await Headless.open();
try {
  const out = join(work, 'page');
  const sc = scenarioOf({ evidence: join(work, 'evidence'), docs: [DOC.walk], calls: [present(DOC.walk, walkthrough()), pageExport(DOC.walk, out, { size: WALK_SIZE, rate: WALK_RATE })] });
  const run = spawnSync(BIN, ['run'], { input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  const reply = JSON.parse(run.stdout.trim()).replies?.[1];
  if (reply?.outcome !== 'exported') throw Error(`the page wasn't exported: ${JSON.stringify(reply).slice(0, 2000)} ${run.stderr.slice(-2000)}`);
  console.log(`page: ${reply.receipt.states} states, ${reply.receipt.edges} edges, ${reply.receipt.bytes} bytes, ${reply.receipt.timing.wall.toFixed(1)} s`);

  const page = await h.load(out, 'the walkthrough page');
  // The driver's protocol session, for the view's size and its pictures.
  const send = (method, params) => page.cdp.send(method, params, page.session);
  await send('Emulation.setDeviceMetricsOverride', { width: 760, height: 560, deviceScaleFactor: 2, mobile: false });
  const picture = async () => Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
  /** Presses `key` and waits until the page has landed (no edge playing), keeping pictures meanwhile into `frames`. */
  const step = async (key, frames) => {
    await page.press(key);
    await sleep(80);
    for (let k = 0; k < 200 && (await page.now()).edge; k++) {
      if (frames) frames.push(await picture());
      else await sleep(50);
    }
  };
  const shot = async (name) => { const b = await picture(); writeFileSync(join(HERE, name), b); console.log(`${name}  ${sha(b)}  (state ${(await page.now()).state})`); };
  await sleep(500);
  await shot('page-start.png');
  await step('e');
  await shot('page-exploded.png');
  await step('e');
  await step('s');
  await shot('page-lagoon.png');
  await step('o');
  await shot('page-orchid.png');
  await step('g');
  await shot('page-graphite.png');
  await step('l');
  await step('p');

  // The recording: the four stages in turn, apart and together again, a frame each 100 ms or so.
  const frames = [];
  for (const key of ['s', 'c', 'a', 'e', 'p', 'e']) {
    await step(key, frames);
    for (let k = 0; k < 6; k++) { frames.push(await picture()); await sleep(60); }
  }
  const outside = page.outside();
  if (outside.length) throw Error(`the page requested ${outside.join(', ')}`);
  const dir = join(work, 'frames');
  mkdirSync(dir);
  frames.forEach((b, k) => writeFileSync(join(dir, `${String(k).padStart(4, '0')}.png`), b));
  const webm = join(HERE, 'page-stepping.webm');
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '10', '-i', join(dir, '%04d.png'), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-pix_fmt', 'yuv420p', '-an', '-fflags', '+bitexact', webm], { encoding: 'utf8' });
  if (ff.status !== 0) throw Error(`ffmpeg: ${ff.stderr}`);
  console.log(`page-stepping.webm  ${sha(readFileSync(webm))}  (${frames.length} frames)`);
} finally {
  await h.close();
  rmSync(work, { recursive: true, force: true });
}
