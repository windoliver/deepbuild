// Takes the #278 taste pictures from the app's window (tests/acceptance/278 README: The taste call): the suite's
// eight-seat piece, played live by copies of the app through the shipped relay behind #549's door, each copy a
// `deep-show` process on the reference window (1512 × 982 points, its panel the whole window). A copy that is
// photographed runs `deep-show screen`, which draws its window at 2× once its calls are done; the others run
// `deep-show run`. Writes beside itself:
//   start-after-second-join.png   the first player's window once a second copy has joined: the app's Start
//   lobby-open.png                the window of a person who opens the piece while its match runs with `open` true: the
//                                 app's Join, which the open lobby accepts
//   next-start-after-finish.png   the first player's window after the match finished: Start again, for the four seated
//   join-and-play-again.webm      the web player in headless Chrome at the reference window's size, the room's first
//                                 player: its person clicks Join, two copies of the app join, Start shows for three
//                                 and its person clicks it, a fourth copy of the app joins the running match while
//                                 its lobby is open, the match finishes, Start shows for four and its person clicks
//                                 it: the next match plays with no Join. The page as the browser painted it, sampled
//                                 as fast as the browser gives screenshots, each held until the next, encoded by ffmpeg
// and prints each SHA-256. From the repository root, after
// `cargo build --locked --bin deep-show --no-default-features --features full` and `--bin deep-relay`:
//   node node_modules/vitest/vitest.mjs run --root docs/evidence/278 shoot.test.mjs --testTimeout=3600000 --hookTimeout=180000
// Needs Google Chrome and ffmpeg on PATH.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const { DOC, LIVE_TIMEOUT_S, roomPiece } = await import(join(REPO, 'tests', 'acceptance', '278', 'fixtures.ts'));
const { FULL, Script, exportWeb, framesThrough, joinedMatches, lobbyCall, openPlayer, relayAndDoor, useBuilds, useCertificate, useCleanup, useClosers, useTemp, webStart, world } = await import(join(REPO, 'tests', 'acceptance', '278', 'helpers.ts'));
const { putEvidence } = await import(join(REPO, 'tests', 'acceptance', '549', 'helpers.ts'));

const builds = useBuilds({ show: [FULL], relay: true });
const certs = useCertificate();
useCleanup();
const closing = useClosers();
const temp = useTemp();

/** The reference window, in points, and its scale. */
const WINDOW = [1512, 982];
const SCALE = 2;
/** The app's match finishes at this step, 25 s in, and the recorded one at this, 15 s in; a copy plays up to STEPS. */
const FINISH_AT = 1_500;
const RECORDED_FINISH_AT = 900;
const STEPS = 3_000;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const live = new Set();
/** Stops every copy this file started that still runs, by its PID. */
const stop = () => { for (const c of live) c.kill('SIGKILL'); live.clear(); };

/** One copy of the app on the reference window, its calls after `deep show` and a `scope`: `deep-show screen` when
 * `out` names the PNG its window is drawn to, else `deep-show run`. Gives its reply, or null when it was stopped. */
function copy(piece, calls, o = {}) {
  const evidence = temp();
  putEvidence(evidence, piece.program.bytes);
  const doc = String(piece.doc.id);
  const s = new Script();
  s.present(doc, piece.doc);
  s.scope();
  calls(s);
  const sc = { ...world(evidence, doc, s.calls, { relayCa: certs().ca, link: o.link }), window: WINDOW, panels: { main: { rect: [0, 0, ...WINDOW] } }, ...(o.out ? { out: o.out, scale: SCALE } : {}) };
  return new Promise((done) => {
    const child = spawn(builds.show(), [o.out ? 'screen' : 'run'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    live.add(child);
    const timer = setTimeout(() => child.kill('SIGKILL'), 300_000);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr = (stderr + d).slice(-4_000); });
    child.once('close', () => {
      clearTimeout(timer);
      live.delete(child);
      let reply = null;
      try { reply = JSON.parse(stdout.split('\n').find((l) => l !== '') ?? ''); } catch { reply = null; }
      done({ reply, stderr });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(`${JSON.stringify(sc)}\n`);
  });
}
/** A photographed copy's picture, once its window was drawn at the reference size. */
async function drawn(run, out) {
  const { reply, stderr } = await run;
  if (!reply?.ok || reply.width !== WINDOW[0] * SCALE || reply.height !== WINDOW[1] * SCALE) throw Error(`${out}: deep-show screen answered ${JSON.stringify(reply).slice(0, 1500)} ${stderr.slice(-1500)}`);
  return readFileSync(out);
}
async function until(what, ok, ms = 240_000) {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw Error(`${what} never came`);
    await sleep(100);
  }
}
const linkOf = async (file) => { await until(`the first player's link in ${file}`, () => existsSync(file) && readFileSync(file, 'utf8') !== ''); return readFileSync(file, 'utf8'); };

/** A room of three copies whose match finishes; `first` gets the first player's script after its click on Start and
 * the finished match, and `during` runs once the match's frames cross the door. The first player's picture, and what
 * `during` gave. */
async function room(out, first, during = async () => {}) {
  const door = await relayAndDoor(builds, certs(), closing);
  const piece = roomPiece({ id: DOC.liveFinish, finishAt: FINISH_AT, net: { relay: door.url, timeout: LIVE_TIMEOUT_S } });
  const at = await buttonOf(piece);
  const file = join(temp(), 'link');
  const one = copy(piece, (s) => { s.click(at); s.add(lobbyCall(3, file)); s.click(at); s.playMatch(STEPS); first(s); }, { out });
  const link = await linkOf(file);
  for (const p of [2, 3]) {
    seated(piece, at, link);
    await until(`copy ${p}'s join`, () => joinedMatches(door).length >= p);
  }
  await until('the match\'s first frame', () => framesThrough(door).length > 0);
  const others = await during(piece, at, link);
  const picture = await drawn(one, out);
  return { picture, others };
}
/** The centre of the app's Join button on the reference window, read from a first run's scope; Start is drawn there. */
async function buttonOf(piece) {
  const { reply, stderr } = await copy(piece, () => {});
  const b = reply?.replies?.[1]?.state?.join?.button;
  if (!Array.isArray(b)) throw Error(`the app shows no Join prompt for the piece: ${JSON.stringify(reply).slice(0, 1500)} ${stderr.slice(-1500)}`);
  return [b[0] + b[2] / 2, b[1] + b[3] / 2];
}

/** A copy of the app that joins through `link` and keeps its seat until it is stopped: its last call waits for a
 * start that never comes. */
const seated = (piece, at, link) => { void copy(piece, (s) => { s.click(at); s.playMatch(STEPS); s.playMatch(STEPS); s.playMatch(STEPS); }, { link }); };

it('takes the #278 taste pictures', async () => {
  const shot = (name, bytes) => { writeFileSync(join(HERE, name), bytes); console.log(`${name}  ${sha(bytes)}`); };
  const frame = (name) => join(temp(), name);
  try {
    // The Start button after the second copy joins.
    const door = await relayAndDoor(builds, certs(), closing);
    const lobby = roomPiece({ id: DOC.live, net: { relay: door.url, timeout: LIVE_TIMEOUT_S } });
    const at = await buttonOf(lobby);
    const file = join(temp(), 'link');
    const start = frame('start.png');
    const one = copy(lobby, (s) => { s.click(at); s.add(lobbyCall(2, file)); }, { out: start });
    const link = await linkOf(file);
    void copy(lobby, (s) => { s.click(at); s.playMatch(1); }, { link });
    shot('start-after-second-join.png', await drawn(one, start));
    stop();

    // The lobby while it is open, and the next match's Start after the finish: a fourth copy joins the running match.
    const [open, next] = [frame('open.png'), frame('next.png')];
    const first = await room(next, (s) => { s.add(lobbyCall(4)); }, async (piece, at, link) => {
      const looking = copy(piece, () => {}, { out: open, link });
      seated(piece, at, link);
      return drawn(looking, open);
    });
    shot('lobby-open.png', first.others);
    shot('next-start-after-finish.png', first.picture);
    stop();

    // The recording: the web player as the room's first player, in headless Chrome at the reference window's size.
    const relay = await relayAndDoor(builds, certs(), closing);
    const played = roomPiece({ id: DOC.liveFinish, finishAt: RECORDED_FINISH_AT, net: { relay: relay.url, timeout: LIVE_TIMEOUT_S } });
    const appAt = await buttonOf(played);
    const bundle = join(temp(), 'bundle');
    const exported = await exportWeb(builds.show(), temp(), played, bundle, 'the web bundle');
    if (exported.outcome !== 'presented') throw Error(`the piece wasn't exported to the web: ${exported.why}`);
    const tab = await openPlayer(certs(), bundle, closing, 'the web player');
    await tab.send('Emulation.setDeviceMetricsOverride', { width: WINDOW[0], height: WINDOW[1], deviceScaleFactor: 1, mobile: false });
    const shots = temp();
    const taken = [];
    let recording = true;
    const sampler = (async () => {
      while (recording) {
        const at = Date.now();
        const { data } = await tab.send('Page.captureScreenshot', { format: 'png' });
        const f = join(shots, `${String(taken.length).padStart(5, '0')}.png`);
        writeFileSync(f, Buffer.from(data, 'base64'));
        taken.push([f, at]);
        await sleep(40);
      }
    })();
    const centre = (b) => [b.x + b.w / 2, b.y + b.h / 2];
    /** The player's own Start once it is open for `n` players. */
    const startFor = async (n) => {
      let s = null;
      await until(`the player's Start for ${n} players`, async () => {
        s = await webStart(tab);
        const text = await tab.evaluate(`(document.querySelector('[data-deep-start]')?.textContent ?? '').trim()`);
        return s?.state === 'open' && s.button !== null && text.startsWith(`${n} of `);
      });
      return s;
    };
    await sleep(2_000);
    await tab.click(...centre((await tab.prompt()).button));
    await until('the page\'s link', async () => typeof (await tab.match())?.link === 'string');
    const pageLink = String((await tab.match()).link);
    for (const p of [2, 3]) {
      seated(played, appAt, pageLink);
      await until(`copy ${p}'s join`, () => joinedMatches(relay).length >= p);
    }
    const three = await startFor(3);
    await sleep(2_000);
    await tab.click(...centre(three.button));
    await until('the match\'s first frame', () => framesThrough(relay).length > 0);
    seated(played, appAt, pageLink);
    await until('the fourth copy\'s join', () => joinedMatches(relay).length >= 4);
    const four = await startFor(4);
    await sleep(2_000);
    await tab.click(...centre(four.button));
    await sleep(4_000);
    recording = false;
    await sampler;
    stop();
    const list = join(temp(), 'frames.txt');
    const held = taken.map(([f, at], i) => `file '${f}'\nduration ${(((taken[i + 1]?.[1] ?? at + 100) - at) / 1000).toFixed(3)}`);
    writeFileSync(list, `${held.join('\n')}\nfile '${taken.at(-1)[0]}'\n`);
    const webm = join(HERE, 'join-and-play-again.webm');
    const made = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '0', '-crf', '34', webm], { encoding: 'utf8' });
    if (made.status !== 0) throw Error(`ffmpeg didn't encode the recording: ${made.stderr.slice(-2000)}`);
    console.log(`join-and-play-again.webm  ${sha(readFileSync(webm))}  (${taken.length} screenshots over ${((taken.at(-1)[1] - taken[0][1]) / 1000).toFixed(1)} s)`);
  } finally {
    stop();
  }
});
