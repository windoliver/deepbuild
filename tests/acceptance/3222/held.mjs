// The canvas core held busy by this suite (#3222, criterion 2's second sentence; README.md, "The held-busy run").
// The spike's harness starts its own hub under a home this suite gives it, with this suite's world file, and waits at a
// gate; this suite then fills the canvas core's line with calls of its own that the world file's fault holds, a few
// seconds each, through the hub's socket as `deep show` reaches it (`canvas.show` on a cli connection with the
// control token), opens the gate once the first of them is answered, and reads what the harness timed.
// Processes are stopped only by PID: the harness, and the hub it names in its ready line.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { AC2, HARNESS, REPO } from './validate.mjs';

/** How long the world file's fault keeps each held call's frame from settling: #393's late frame (`fault.ms`). */
export const HOLD_MS = 1500;
/** The calls this suite holds the core with, all sent at once. */
export const HELD = 4;
/** The least wait a harness must read for its first call: under the holds still ahead of it at the go line. */
export const MIN_WAIT_MS = 1000;
/** The planted twin's switch: the harness with each call timed from its start in the core. */
export const PLANT = 'times-from-core-start';
// A generous bound for every wait here: the Mac this runs on is shared and often loaded far past its cores.
const DEADLINE_MS = 10 * 60_000;

/** Resolves with `promise`, or fails naming `what` once `ms` have passed. */
function within(promise, what, ms = DEADLINE_MS) {
  let timer;
  // deadline: only turns a hang into a failure that names what never came.
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${AC2}: no ${what} within ${ms / 1000} s`)), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

/** The environment the harness runs in: this one, with HOME moved to the test's home and none of the hub's settings. */
function harnessEnv(home, world) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('DEEP_') || k.startsWith('GIT_') || k.startsWith('CLAUDE') || k.startsWith('CODEX') || k === 'NODE_OPTIONS') continue;
    env[k] = v;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), DEEP_HUB_TEST_SHOW: world };
}

/** A cli connection to the hub under `home`, holding its control token, as `deep show` connects. */
async function connect(home) {
  const root = join(home, '.deepbuild');
  const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
  const sock = net.connect(join(root, 'hub.sock'));
  const waiting = new Map();
  let buffer = '', stage = 0, ids = 0, opened, failed;
  const open = new Promise((resolve, reject) => { opened = resolve; failed = reject; });
  sock.setEncoding('utf8');
  sock.on('error', (error) => failed(error));
  sock.on('data', (chunk) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      const line = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      if (stage === 0) { stage = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`); }
      else if (stage === 1) { stage = 2; if (line.role === 'cli') opened(); else failed(Error(`the hub refused the cli hello: ${JSON.stringify(line)}`)); }
      else { waiting.get(line.id)?.(line); waiting.delete(line.id); }
    }
  });
  await within(open, 'cli hello from the harness\'s hub');
  return {
    call: (method, params) => new Promise((resolve) => { const id = `h3222#${++ids}`; waiting.set(id, resolve); sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`); }),
    close: () => sock.destroy(),
  };
}

/** The document each held call shows: two plain rects, a board an agent might draw. */
const board = (n) => ({
  format: 1, profile: 'board', title: `Held ${n}`, description: `A board shown by the #3222 suite to hold the canvas core, number ${n}.`, size: [320, 200],
  items: {
    back: { id: 'back', kind: 'rect@1', name: 'Backdrop', order: 'a0', params: { box: [0, 0, 320, 200], paint: { fill: { role: 'ground' } } } },
    bar: { id: 'bar', kind: 'rect@1', name: 'Bar', order: 'a1', params: { box: [16, 120, 40 * n, 16], paint: { fill: { role: 'muted' } } } },
  },
});
const heldDoc = (n) => `01JB3222H${String(n).padStart(17, '0')}`;

/**
 * Runs the harness (`node docs/spikes/3222/harness.mjs --sessions 1 --patches --gate --home <home> --out <file>`, and
 * with `--plant times-from-core-start` for the twin) against a canvas core this suite holds busy. Returns the
 * harness's output and what the test knows of the hold: when the go line went (`goAt`), the earliest the held calls
 * could all have ended (`heldUntil`), and when the last held call was answered (`lastHeld`).
 */
export async function heldRun({ plant = false } = {}) {
  const cli = join(REPO, 'packages/cli/dist/main.js');
  assert.ok(existsSync(cli), `${AC2} BLOCKED: packages/cli/dist/main.js is not built; run npm run build --workspaces first`);
  assert.ok(['debug', 'release'].some((p) => existsSync(join(REPO, 'target', p, 'deep-show'))), `${AC2} BLOCKED: no canvas core is built under target/; run cargo build --bin deep-show first`);
  assert.ok(existsSync(join(REPO, HARNESS)), `${AC2} BLOCKED: ${HARNESS} is not in this checkout: the spike's harness hasn't been written, so nothing can be held to the wait it reads`);

  // Short: the hub's socket path must fit in 104 bytes.
  const tmp = realpathSync(mkdtempSync('/tmp/dh3222-'));
  const home = join(tmp, 'h');
  mkdirSync(home);
  const world = join(tmp, 'world.json');
  const outFile = join(tmp, 'out.json');
  // The fault holds every frame the core renders while the world holds it, for HOLD_MS from its admission.
  writeFileSync(world, `${JSON.stringify({ fault: { holds: 'asset_decode', ms: HOLD_MS } })}\n`);
  const args = [HARNESS, '--sessions', '1', '--patches', '--gate', '--home', home, '--out', outFile, ...(plant ? ['--plant', PLANT] : [])];
  const harness = spawn(process.execPath, args, { cwd: REPO, env: harnessEnv(home, world), stdio: ['pipe', 'pipe', 'pipe'] });
  let said = '';
  harness.stderr.setEncoding('utf8').on('data', (d) => { said = (said + d).slice(-4000); });
  const exited = new Promise((resolve) => harness.on('exit', (code, signal) => resolve({ code, signal })));
  let hub;
  let conn;
  try {
    const first = new Promise((resolve) => {
      const lines = createInterface({ input: harness.stdout });
      lines.once('line', resolve);
      harness.once('exit', () => resolve(undefined));
    });
    const line = await within(first, 'ready line from the harness');
    let ready;
    try { ready = JSON.parse(line ?? ''); } catch { ready = undefined; }
    assert.ok(ready?.ready === true && Number.isInteger(ready.hub), `${AC2}: the harness's first line is not {"ready": true, "hub": <pid>}: ${JSON.stringify(line)}; it said: ${said}`);
    hub = ready.hub;

    conn = await connect(home);
    const heldFrom = Date.now();
    const held = Array.from({ length: HELD }, (_, i) => conn.call('canvas.show', { doc: heldDoc(i + 1), document: JSON.stringify(board(i + 1)), include: ['issues', 'pixels'] })
      .then((reply) => ({ reply, at: Date.now() })));
    await within(Promise.race(held), 'answer to the first held call');
    // The held calls joined the line long before the first was answered; the harness's calls go behind them, in a
    // world with no fault, so only the held calls are held.
    writeFileSync(world, '{}\n');
    const goAt = Date.now();
    harness.stdin.end('go\n');
    const answered = await within(Promise.all(held), 'answer to every held call');
    for (const [i, { reply }] of answered.entries()) {
      const r = reply.result ?? {};
      assert.ok(r.outcome === 'presented' && Array.isArray(r.snapshots) && r.snapshots.length === 1, `${AC2} BLOCKED: held call ${i + 1} wasn't presented with its snapshot, so it may not have held the core: ${JSON.stringify(reply).slice(0, 600)}`);
    }
    const lastHeld = Math.max(...answered.map(({ at }) => at));
    const { code, signal } = await within(exited, 'exit of the harness');
    assert.equal(code, 0, `${AC2}: the harness exited ${code ?? signal}: ${said}`);
    assert.ok(existsSync(outFile), `${AC2}: the harness wrote no --out file`);
    const out = JSON.parse(readFileSync(outFile, 'utf8'));
    return { out, held: { goAt, heldUntil: heldFrom + HELD * HOLD_MS, minWaitMs: MIN_WAIT_MS }, lastHeld };
  } finally {
    conn?.close();
    if (harness.exitCode === null && harness.signalCode === null) {
      harness.kill('SIGTERM');
      await within(exited, 'exit of the harness after SIGTERM', 60_000).catch(() => harness.kill('SIGKILL'));
    }
    if (hub && alive(hub)) try { process.kill(hub, 'SIGKILL'); } catch { /* gone */ }
    rmSync(tmp, { recursive: true, force: true });
  }
}
