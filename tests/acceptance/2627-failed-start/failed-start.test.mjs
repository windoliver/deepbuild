// #2627 AC1: a failed start of tests/proof-binaries-lease-loss.test.mjs leaves nothing. See README.md.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ROOT, environment, holdBuildSlots, kill, release, reported, scratch, sleep, tracker, verdict } from './helpers.mjs';

const FILE = 'tests/proof-binaries-lease-loss.test.mjs';
const HOLD_LIMIT_MS = 3 * 60_000; // the build slots held, on a loaded machine
const EXIT_LIMIT_MS = 11 * 60_000; // the file's process exits within this of its start, whatever its own wait
const SETTLE_MS = 60_000; // after the exit, the fixture's processes have this long to be gone

test('#2627.b782c214 when the builder\'s ready file does not appear within proof-binaries-lease-loss\'s wait, the test fails, its file\'s process exits and no process of its fixture (owner, lease, proof-bin-build and its worker, build.mjs and its worker) is left alive', { timeout: 19 * 60_000 }, async (t) => {
  assert.ok(existsSync(join(ROOT, 'packages/cli/dist/main.js')), 'BLOCKED: build the CLI first (npm run build --workspaces)');
  // The throttle reads DEEP_THROTTLE_TABLE only inside a test run; outside one the holders would take the machine's slots.
  assert.ok(process.env.NODE_TEST_CONTEXT, 'BLOCKED: run this file under node --test');

  const box = scratch(), env = environment(box), holders = [], procs = tracker(box.tmp);
  let runner = null, ended = false, code = null;
  t.after(() => {
    // Everything this test started, by number and start: the fixture's first (so a lease never gets a slot), then the
    // holders, then the scratch folder.
    for (const p of procs.kept.values()) kill(p);
    if (runner && !ended) try { runner.kill('SIGKILL'); } catch {}
    release(holders);
    rmSync(box.dir, { recursive: true, force: true });
  });
  // The surface: every build slot of the run's own throttle table is held, so `scripts/lease`'s build grant, and with
  // it the builder, can't start until the file has reported. Its ready file can't appear within any wait.
  await holdBuildSlots(box, env, holders, HOLD_LIMIT_MS);

  const out = join(box.dir, 'file.tap'), fd = openSync(out, 'w');
  const started = Date.now();
  runner = spawn(process.execPath, ['--test', '--test-reporter=tap', FILE], { cwd: ROOT, env, stdio: ['ignore', fd, fd], detached: true });
  closeSync(fd);
  procs.root(runner.pid);
  let tookMs = null;
  runner.on('exit', (c, s) => { code = c ?? s; ended = true; tookMs = Date.now() - started; });

  let readyBeforeResult = false;
  while (!ended && Date.now() - started < EXIT_LIMIT_MS) {
    procs.look();
    const tap = readFileSync(out, 'utf8');
    // build.mjs itself: node with that script and nothing after it (every stage above names it among its own arguments).
    if (!reported(tap)) readyBeforeResult ||= [...procs.kept.values()].some((p) => /^\S+\s+\S*\/build\.mjs$/.test(p.args.trim()));
    await sleep(250);
  }
  const fileExited = ended;
  procs.look();
  const tap = readFileSync(out, 'utf8');
  // The setup's own check: the builder must not have started before the result, or this is no failed start.
  assert.equal(readyBeforeResult, false, `INVALID: the fixture's build.mjs ran before the file reported, so the start wasn't held\n${tap}`);

  // After the exit, what the fixture started has a while to go; nothing new may start meanwhile.
  const settle = Date.now();
  while (Date.now() - settle < SETTLE_MS) {
    procs.look();
    if (!procs.left().length) break;
    await sleep(500);
  }
  procs.look();
  const redact = (text) => text.replaceAll(box.dir, '<scratch>').replaceAll(ROOT, '<repo>').replaceAll(homedir(), '~');
  const left = procs.left().map(({ pid, args }) => `${pid} ${redact(args)}`);

  const result = verdict(tap, code);
  assert.deepEqual(
    { result: result === 'pass' ? 'passed' : 'did not pass', fileExited, left },
    { result: 'did not pass', fileExited: true, left: [] },
    `the file ${fileExited ? `exited (${code}) ${Math.round(tookMs / 1000)} s after its start` : `still ran after ${EXIT_LIMIT_MS / 60_000} min`}; ` +
    `alive ${SETTLE_MS / 1000} s after that: ${left.length}; the holders still held: ${holders.filter((h) => h.child.exitCode === null).length}\n--- the file's TAP ---\n${redact(tap)}`,
  );
});
