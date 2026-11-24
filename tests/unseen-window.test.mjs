// What an assistive client gets of a window nobody can see (#3232 rests on it). GPUI gives AccessKit a frame's tree, and
// has it announce, when it draws the frame, and macOS asks for no frame of a covered or minimized window. The carried
// patch (vendor/gpui-pre, `unseen`) draws such a window for a connected client. crates/deep-app/tests/unseen.rs holds when
// it draws and when it doesn't; here the real `deep-app`, on a real hub, is minimized before anything asks for its tree
// and read from outside its process. It opens one window, for the moment before it is minimized.
//
// Safety: HOME is a temporary folder for every process started; each is stopped by the PID it was started with; no
// network, no model.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const MIN = 60_000;
const skip = process.platform !== 'darwin' && 'deep-app and its window are macOS\'s';

test('a hidden window is drawn for its assistive client, and for nothing else', { skip, timeout: 60 * MIN }, () => {
  const run = spawnSync('cargo', ['test', '--locked', '-q', '-p', 'deep-app', '--test', 'unseen'], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 });
  assert.equal(run.status, 0, (run.stderr + run.stdout).slice(-3000));
  assert.match(run.stdout, /test result: ok\. 5 passed/);
});

/** A home whose record holds two open asks, as the core would have raised them, before any hub runs there. */
async function seed(home) {
  const { openAsks, askSources } = await import('../packages/asks/dist/index.js');
  const { openRecord } = await import('../packages/record/dist/index.js');
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const now = () => Date.now();
  const record = await openRecord({ path: join(root, 'ledger.db'), now });
  const session = { writer: 'core', actor: 'you', scope: 'you', session: '3f0d5c62-7d0e-4c9a-9b1e-2a4f6c8d0e12' };
  await record.append({ ...session, writer: 'hook', agent: 'claude-code', verified: true }, {
    v: 4, id: '01KB3232SS0000000000000001', kind: 'session.start', ts: now(), data: { agent: 'claude-code', worktree: root, branch: 'main', thread: session.session, billing: {}, loads: [] },
  });
  const core = await openAsks({ record, now, deliver: () => undefined });
  const { ask } = askSources().find((row) => row.source === 'deep_ask.taste').fixture;
  const asks = [];
  for (const question of ['Which header colour on the login page?', 'Which font for the printed receipt?']) {
    const key = createHash('sha256').update(question).digest('hex');
    const handle = await core.raise(session, 'deep_ask.taste', {
      ...ask, question, key, deadline: now() + 86_400_000, recommended: 'one', default: 'one', pinned_to: { ...ask.pinned_to, ref: key },
      options: [{ id: 'one', label: 'The first', decision: 'none' }, { id: 'two', label: 'The second', decision: 'none' }],
    });
    asks.push({ handle, question });
  }
  await record.close();
  // Setup finished in this home, so the first screen is the shell's.
  const { version } = JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8'));
  writeFileSync(join(root, 'setup-finished.json'), JSON.stringify({ version }));
  return asks;
}

test('the real app, minimized before a client asks, gives it the open asks and then each change', { skip, timeout: 60 * MIN }, async (t) => {
  // Short, under /tmp: the hub's socket path must fit in 104 bytes.
  const dir = realpathSync(mkdtempSync('/tmp/d3232-'));
  const started = [];
  t.after(async () => {
    for (const child of started.reverse()) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    rmSync(dir, { recursive: true, force: true });
  });
  const client = join(dir, 'unseen');
  const made = spawnSync('swiftc', ['-O', '-o', client, join(REPO, 'tests/unseen-window.swift')], { encoding: 'utf8' });
  if (made.status !== 0) return t.skip(`BLOCKED: the AppKit client didn't build: ${made.error?.message ?? made.stderr.slice(-600)}`);
  const ask = (...args) => JSON.parse(spawnSync(client, args, { encoding: 'utf8', maxBuffer: 1 << 26, timeout: 5 * MIN }).stdout);
  /** Why nothing outside a process can read its window now, or null. Behind a lock every element answers as its app. */
  const unreadable = () => {
    const gate = ask('gate');
    if (!gate.ax) return 'this process may not read other processes\' accessibility (AXIsProcessTrusted is false)';
    return gate.locked ? 'the screen is locked' : gate.asleep ? 'the display is asleep' : null;
  };
  let why = unreadable();
  if (why) return t.skip(`BLOCKED: ${why}`);
  const built = spawnSync('cargo', ['build', '--locked', '-q', '-p', 'deep-app', '--bin', 'deep-app', '-p', 'deep-hook', '--bin', 'deep-hook'], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' },
  });
  if (built.status !== 0) return t.skip(`BLOCKED: deep-app didn't build: ${built.stderr.slice(-600)}`);

  const home = join(dir, 'h');
  const asks = await seed(home);
  const confirm = join(dir, 'confirm.sh');
  writeFileSync(confirm, '#!/bin/sh\nexit 0\n');
  chmodSync(confirm, 0o700);
  const own = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:DEEP_|XDG_|NODE_OPTIONS$)/.test(key)));
  const env = { ...own, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), PATH: `${dirname(process.execPath)}:${process.env.PATH}`, LC_ALL: 'C' };
  const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { cwd: REPO, env: { ...env, DEEP_HUB_TEST_CONFIRM: confirm }, stdio: ['ignore', 'pipe', 'ignore'] });
  started.push(hub);
  const ready = await Promise.race([once(hub.stdout, 'data').then(() => true), once(hub, 'exit').then(() => false)]);
  if (!ready) return t.skip('BLOCKED: the hub didn\'t start');
  const app = spawn(join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug/deep-app'), [], { cwd: REPO, env, stdio: 'ignore' });
  started.push(app);

  const minimized = ask('minimize', String(app.pid));
  if (!minimized.window || !minimized.minimized) return t.skip(`BLOCKED: the window wasn't hidden: ${JSON.stringify(minimized)}`);
  /** What the client reads of the window once its count's line is `line`, or of the window 30 s later. */
  const reads = (line) => {
    const { minimized, nodes } = ask('read', String(app.pid), line);
    const label = (id) => nodes.find((node) => node.identifier === id)?.label ?? null;
    return { minimized, count: label('sidebar-count'), asks: asks.filter((a) => label(a.handle)?.startsWith(a.question)).length };
  };
  const first = reads('2 asks need you');
  const answered = spawnSync(process.execPath, [CLI, 'inbox', 'answer', asks[0].handle, 'one'], { cwd: REPO, env, encoding: 'utf8', timeout: 2 * MIN });
  assert.equal(answered.status, 0, `deep inbox answer: ${answered.stderr.slice(-600)}`);
  const then = reads('1 ask needs you');
  why = unreadable();
  if (why) return t.skip(`BLOCKED: ${why}, after the read`);
  const seen = { hidden: first.minimized && then.minimized, count: [first.count, then.count], asks: first.asks };
  assert.deepEqual(seen, { hidden: true, count: ['2 asks need you', '1 ask needs you'], asks: 2 });
});
