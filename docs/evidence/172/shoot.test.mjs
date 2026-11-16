// Takes the #172 taste pictures from the web player's pages in a browser (tests/acceptance/172 README: The taste call):
// the suite's lab (a world, a logic item that keeps score and a readout) and its piece with four stages, each exported
// by `deep-show run` to the web, served over HTTP by the suite's own server and opened in headless Google Chrome with
// WebGPU on. Writes beside itself:
//   player-lab.png             the lab playing, 1 s in: its first kick's ball in flight toward the goal
//   player-stage-descent.png   the piece opened at #stage=descent, the fourth stage's settled frame
//   player-bad-fragment.png    the piece opened at #t=abc: at its start, with the notice naming the fragment
//   player-lab.webm            the lab playing from its start to its end: Chrome's screencast of the page at its own
//                              size, each frame at its own time, sampled at 30 frames a second, encoded by ffmpeg
// and prints each SHA-256. The suite's helpers register vitest hooks, so it runs under vitest. From the repository
// root, after `cargo build --locked -p deep-show`:
//   node node_modules/vitest/vitest.mjs run --root docs/evidence/172 shoot.test.mjs --testTimeout=900000
// Needs Google Chrome and ffmpeg on PATH.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const BIN = join(REPO, 'target', 'debug', 'deep-show');
const { CHROME, Server, exportLab, exportOnce, stagesDoc, webReceiptOf } = await import(join(REPO, 'tests', 'acceptance', '172', 'helpers.ts'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const VIEW = { width: 960, height: 600 };

/** Google Chrome headless with WebGPU on, driven over its DevTools protocol in one flat session. */
async function chrome() {
  const profile = mkdtempSync(join(tmpdir(), 'deep-172-shoot-chrome-'));
  const args = ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--use-mock-keychain',
    '--password-store=basic', '--disable-background-networking', '--disable-component-update', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${profile}`, 'about:blank'];
  const proc = spawn(CHROME, args, { detached: true, stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let k = 0; k < 600 && !(existsSync(portFile) && readFileSync(portFile, 'utf8').split('\n').length >= 2); k++) await sleep(100);
  const [port, path] = readFileSync(portFile, 'utf8').split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port.trim()}${path.trim()}`);
  await new Promise((done) => ws.addEventListener('open', done));
  let n = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id !== undefined) { pending.get(m.id)?.(m); pending.delete(m.id); } else for (const l of listeners) if (l.method === m.method) l.on(m.params, m.sessionId);
  });
  const send = (method, params = {}, sessionId) => new Promise((done, fail) => {
    const id = ++n;
    pending.set(id, (m) => (m.error ? fail(Error(`${method}: ${m.error.message}`)) : done(m.result)));
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return {
    send, on: (method, on) => listeners.push({ method, on }),
    async close() { await send('Browser.close').catch(() => {}); try { process.kill(-proc.pid, 'SIGKILL'); } catch {} rmSync(profile, { recursive: true, force: true }); },
  };
}

/** A page of `url` at the view's size, once its player is ready; its session's calls. */
async function open(c, url) {
  const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => c.send(m, p, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  const evaluate = async (expression, gesture = false) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: gesture })).result?.value;
  for (let k = 0; k < 600; k++) {
    if (await evaluate(`(() => { const p = document.querySelector('deep-player'); return !!(p && p.ready); })()`)) return { send, evaluate, sessionId };
    await sleep(100);
  }
  const notices = await evaluate(`[...document.querySelectorAll('[data-deep-notice]')].map((e) => e.textContent)`);
  throw Error(`${url}: the player isn't ready within 60 s; notices ${JSON.stringify(notices)}`);
}
const picture = async (page) => Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
const shot = (name, bytes) => { writeFileSync(join(HERE, name), bytes); console.log(`${name}  ${sha(bytes)}`); };

it('takes the #172 taste pictures', async () => {
const work = mkdtempSync(join(tmpdir(), 'deep-172-shoot-'));
const server = new Server();
const c = await chrome();
try {
  mkdirSync(join(work, 'evidence'), { recursive: true });
  const lab = exportLab(BIN, join(work, 'evidence'), join(work, 'lab'), 'the lab');
  const stages = join(work, 'stages');
  webReceiptOf(exportOnce(BIN, join(work, 'evidence'), stagesDoc(), stages, 'the piece with stages'), 'the piece with stages');

  // The lab: a picture 6 s in, and a recording of a play from its start to its end.
  let origin = await server.start(lab.out);
  let page = await open(c, `${origin}/index.html`);
  const frames = [];
  c.on('Page.screencastFrame', (p, session) => {
    if (session !== page.sessionId) return;
    frames.push({ t: p.metadata.timestamp, data: Buffer.from(p.data, 'base64') });
    c.send('Page.screencastFrameAck', { sessionId: p.sessionId }, session).catch(() => {});
  });
  await page.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  const ended = await page.evaluate(`new Promise((done) => { const p = document.querySelector('deep-player'); setTimeout(() => done(false), 60000);
    p.addEventListener('ended', () => done(true), { once: true }); p.currentTime = 0; p.play(); })`, true);
  if (!ended) throw Error('the lab never played to its end');
  await page.send('Page.stopScreencast');
  await page.evaluate(`void (document.querySelector('deep-player').currentTime = 1)`);
  await sleep(300);
  shot('player-lab.png', await picture(page));
  // The recording: the screencast's frames by their own timestamps, sampled at 30 frames a second.
  frames.sort((a, b) => a.t - b.t);
  const dir = join(work, 'frames');
  mkdirSync(dir);
  const t0 = frames[0].t;
  const last = frames[frames.length - 1].t;
  let k = 0;
  for (let at = t0; at <= last; at += 1 / 30) {
    const f = frames.filter((x) => x.t <= at).pop() ?? frames[0];
    writeFileSync(join(dir, `${String(k++).padStart(5, '0')}.jpg`), f.data);
  }
  const webm = join(work, 'player-lab.webm');
  const enc = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', join(dir, '%05d.jpg'), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '0', '-crf', '32', webm]);
  if (enc.status !== 0) throw Error(`ffmpeg: ${enc.stderr}`);
  shot('player-lab.webm', readFileSync(webm));
  await server.stop();

  // The piece with stages: opened at its fourth stage, and at a fragment it can't read.
  origin = await server.start(stages);
  page = await open(c, `${origin}/index.html#stage=descent`);
  await sleep(500);
  shot('player-stage-descent.png', await picture(page));
  page = await open(c, `${origin}/index.html#t=abc`);
  await sleep(500);
  shot('player-bad-fragment.png', await picture(page));
} finally {
  await c.close();
  await server.stop();
  rmSync(work, { recursive: true, force: true });
}
}, 900_000);
