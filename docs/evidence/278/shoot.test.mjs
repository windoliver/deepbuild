// Takes the #278 taste pictures from the app's window (tests/acceptance/278 README: The taste call): the suite's
// eight-seat piece, played live by copies of the app through the shipped relay behind #549's door, each copy a
// `deep-show` process on the reference window (1512 × 982 points, its panel the whole window). A copy that is
// photographed runs `deep-show screen`, which draws its window at 2× once its calls are done; the others run
// `deep-show run`. Writes beside itself:
//   start-after-second-join.png   the first player's window once a second copy has joined: the app's Start
//   lobby-open.png                the window of a person who opens the piece while its match runs with `open` true: the
//                                 app's Join, which the open lobby accepts
//   next-start-after-finish.png   the first player's window after the match finished: Start again, for the four seated
//   join-and-play-again.webm      four pictures of the app's window in order, two seconds each, encoded by ffmpeg: the
//                                 Join above; that copy's window after its person's click on Join, playing; the Start
//                                 after the finish; the first player's window after its click on Start, playing again.
//                                 Each is one `deep-show screen` picture of a live room, not a continuous capture.
// and prints each SHA-256. From the repository root, after
// `cargo build --locked --bin deep-show --no-default-features --features full` and `--bin deep-relay`:
//   node node_modules/vitest/vitest.mjs run --root docs/evidence/278 shoot.test.mjs --testTimeout=3600000 --hookTimeout=180000
// Needs ffmpeg on PATH.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const { DOC, LIVE_TIMEOUT_S, roomPiece } = await import(join(REPO, 'tests', 'acceptance', '278', 'fixtures.ts'));
const { FULL, Script, framesThrough, joinedMatches, lobbyCall, relayAndDoor, useBuilds, useCertificate, useCleanup, useClosers, useTemp, world } = await import(join(REPO, 'tests', 'acceptance', '278', 'helpers.ts'));
const { putEvidence } = await import(join(REPO, 'tests', 'acceptance', '549', 'helpers.ts'));

const builds = useBuilds({ show: [FULL], relay: true });
const certs = useCertificate();
useCleanup();
const closing = useClosers();
const temp = useTemp();

/** The reference window, in points, and its scale. */
const WINDOW = [1512, 982];
const SCALE = 2;
/** The match finishes at this step, 25 s in; a copy plays up to this many. */
const FINISH_AT = 1_500;
const STEPS = FINISH_AT + 600;
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
 * the finished match, and `during` runs once the match's frames cross the door. The first player's picture. */
async function room(out, first, during = async () => {}) {
  const door = await relayAndDoor(builds, certs(), closing);
  const piece = roomPiece({ id: DOC.liveFinish, finishAt: FINISH_AT, net: { relay: door.url, timeout: LIVE_TIMEOUT_S } });
  const at = await buttonOf(piece);
  const file = join(temp(), 'link');
  const one = copy(piece, (s) => { s.click(at); s.add(lobbyCall(3, file)); s.click(at); s.playMatch(STEPS); first(s, at); }, { out });
  const link = await linkOf(file);
  for (const p of [2, 3]) {
    // The last call waits for a start that never comes, so the copy keeps its seat until it is stopped.
    void copy(piece, (s) => { s.click(at); s.playMatch(STEPS); s.playMatch(STEPS); s.playMatch(STEPS); }, { link });
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

    // The lobby while it is open, a join, and the next match's Start after the finish.
    const [open, joined, next] = [frame('open.png'), frame('joined.png'), frame('next.png')];
    const first = await room(next, (s) => { s.add(lobbyCall(4)); }, async (piece, at, link) => {
      const looking = copy(piece, () => {}, { out: open, link });
      const joining = copy(piece, (s) => { s.click(at); s.playMatch(STEPS); }, { out: joined, link });
      return [await drawn(looking, open), await drawn(joining, joined)];
    });
    shot('lobby-open.png', first.others[0]);
    shot('next-start-after-finish.png', first.picture);
    stop();

    // A play again: the first player's window after its click on the next match's Start.
    const again = frame('again.png');
    const second = await room(again, (s, at) => { s.add(lobbyCall(3)); s.click(at); s.playMatch(300); });
    stop();

    // The recording: the four pictures in order, two seconds each.
    const frames = [[open, first.others[0]], [joined, first.others[1]], [next, first.picture], [again, second.picture]];
    const list = join(temp(), 'frames.txt');
    writeFileSync(list, `${frames.map(([f]) => `file '${f}'\nduration 2`).join('\n')}\nfile '${again}'\n`);
    const webm = join(HERE, 'join-and-play-again.webm');
    const made = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=30,scale=${WINDOW[0]}:${WINDOW[1]}`, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '0', '-crf', '32', webm], { encoding: 'utf8' });
    if (made.status !== 0) throw Error(`ffmpeg didn't encode the recording: ${made.stderr.slice(-2000)}`);
    console.log(`join-and-play-again.webm  ${sha(readFileSync(webm))}`);
  } finally {
    stop();
  }
});
