// #2330: the actual server's stop connection represents completed cleanup, not just a closed listener.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, it } from 'vitest';

// Build the real server's native prerequisites from this checkout, never borrow another tree's executables.
beforeAll(() => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../../supervisor/build-helper.mjs', import.meta.url))], { stdio: 'inherit' });
  execFileSync(process.execPath, [fileURLToPath(new URL('../../../scripts/throttle.mjs', import.meta.url)), 'build', '--wait', '30', '--',
    'cargo', 'build', '--locked', '--offline', '-p', 'deep-hook'], { stdio: 'inherit', env: { ...process.env, CARGO_BUILD_JOBS: '2' } });
}, 180_000);

async function connect(root: string) {
  const socket = net.connect(join(root, 'hub.sock'));
  const lines: Record<string, unknown>[] = [];
  const waiters: ((line: Record<string, unknown>) => void)[] = [];
  let buffer = '';
  socket.on('error', () => {});
  socket.on('data', (chunk) => {
    buffer += chunk;
    for (let i; (i = buffer.indexOf('\n')) >= 0;) {
      const line = JSON.parse(buffer.slice(0, i)) as Record<string, unknown>; buffer = buffer.slice(i + 1);
      const waiter = waiters.shift(); if (waiter) waiter(line); else lines.push(line);
    }
  });
  const next = () => new Promise<Record<string, unknown>>((done) => {
    const line = lines.shift(); if (line) done(line); else waiters.push(done);
  });
  const closed = new Promise<void>((done) => socket.once('close', done));
  const send = (o: object) => socket.write(`${JSON.stringify({ v: 1, ...o })}\n`);
  await next();
  send({ hello: 'cli', token: readFileSync(join(root, 'control.token'), 'utf8').trim() });
  expect((await next()).role).toBe('cli');
  return { socket, next, closed, send };
}

it.each([false, true])('only the stop requester stays open while cleanup is pending (queued frame: %s)', async (queued) => {
  const home = mkdtempSync('/tmp/stop-connection-'), root = join(home, 'dev');
  mkdirSync(root);
  const hub = spawn(process.execPath, ['--import', fileURLToPath(new URL('./source-hub.mjs', import.meta.url)),
    fileURLToPath(new URL('../../cli/src/main.ts', import.meta.url)), 'hub', 'run', '--root', root], {
    env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors = '';
  hub.stderr.on('data', (chunk) => { errors += chunk; });
  const exit = new Promise((done) => hub.once('exit', done));
  try {
    await new Promise((done, reject) => {
      hub.stdout.once('data', done);
      hub.once('exit', () => reject(Error(`hub exited before ready: ${errors}`)));
    });
    const requester = await connect(root), other = await connect(root);
    requester.send({ id: 'ready', method: 'hub.health', params: {} });
    expect((await requester.next()).id).toBe('ready');
    const db = new DatabaseSync(join(root, 'ledger.db'));
    db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    let closed = false;
    void requester.closed.then(() => { closed = true; });
    try {
      if (queued) requester.socket.write(`${JSON.stringify({ v: 1, id: 'stop', method: 'hub.stop', params: {} })}\n${JSON.stringify({ v: 1, origin: 'test', id: 'after-stop' })}\n`);
      else requester.send({ id: 'stop', method: 'hub.stop', params: {} });
      expect((await requester.next()).result).toEqual({ stopping: true });
      // Unrelated connections still close at once (#823); only the requester's lifetime changes.
      await other.closed;
      await new Promise((done) => setTimeout(done, 50));
      expect(closed, 'the core cannot have persisted its clean stop while the real write lock is held').toBe(false);
    } finally {
      db.exec('ROLLBACK'); db.close();
    }
    await requester.closed;
    await exit;
    expect(hub.exitCode, errors).toBe(0);
    expect(readFileSync(join(root, 'hub.state'), 'utf8').trim()).toBe('stopped');
    requester.socket.destroy(); other.socket.destroy();
  } finally {
    if (hub.exitCode === null && hub.signalCode === null) hub.kill('SIGTERM');
    await exit;
    rmSync(home, { recursive: true, force: true });
  }
}, 60_000);
