// #236 AC3, AC4 (the supervisor's half) and AC6: what a process started through the supervisor may touch.
// It may read its folder and what its grant names, write only where its grant names, connect only to the
// hosts and sockets its grant names; anything else is denied by the sandbox, whoever the caller is.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bins, cleanup, closeListeners, expectDenied, sha256, startHub, stopHub, sub, tcpListener, tempDir, tried, ulid, runId, waitFor,
} from './helpers.ts';
import { dataOf, openWorld } from './world.ts';
import type { SupervisorOptions } from '../../../packages/supervisor/src/index.ts';

afterEach(async () => { await closeListeners(); await cleanup(); }, 30_000);

describe('AC3 #236.c43ad465 anything your agent built runs in the platform sandbox; digests by the parent', () => {
  it('AC3 a read, write or network call outside what it declared is denied by the sandbox, while each one inside works, and the output\'s digests are the parent\'s', async () => {
    const b = bins();
    const dir = tempDir();
    const cwd = sub(dir, 'run');
    const data = sub(dir, 'data');
    const out = sub(dir, 'out');
    const secret = sub(tempDir(), 'secret');
    const other = sub(tempDir(), 'other');
    writeFileSync(join(data, 'in.txt'), 'declared input\n');
    writeFileSync(join(secret, 'key.txt'), 'not declared\n');
    const granted = await tcpListener();
    const stranger = await tcpListener();
    const file = join(out, 'tries.json');
    const marker = `digest me ${ulid()}`;
    const w = await openWorld();
    try {
      const run = runId();
      const started = await w.sup.start({
        run, cwd,
        argv: [b.probe, '-o', file, 'read', join(data, 'in.txt'), 'read', join(secret, 'key.txt'), 'write', join(out, 'w.txt'), 'write', join(other, 'w.txt'),
          'tcp', String(granted.port), 'tcp', String(stranger.port), 'print', marker],
        grant: { read: [b.dir, data], write: [out], hosts: [`127.0.0.1:${granted.port}`] },
      });
      expect(started.status, JSON.stringify(started)).toBe('started');
      const exit = await w.sup.wait(run);
      await w.sup.cleanup(run);
      // What it declared works, so a sandbox that refuses everything doesn't pass.
      expect(tried(file, 'read', join(data, 'in.txt')).ok, 'a read of a declared path').toBe(true);
      expect(tried(file, 'write', join(out, 'w.txt')).ok, 'a write under a declared path').toBe(true);
      expect(tried(file, 'tcp', String(granted.port)).ok, 'a connect to the granted host').toBe(true);
      expect(granted.text(), 'the granted host got the line').toContain('hello from probe');
      // Outside what it declared, the sandbox refuses.
      expectDenied(tried(file, 'read', join(secret, 'key.txt')), 'an undeclared read');
      expectDenied(tried(file, 'write', join(other, 'w.txt')), 'an undeclared write');
      expect(existsSync(join(other, 'w.txt')), 'the undeclared write left a file').toBe(false);
      expectDenied(tried(file, 'tcp', String(stranger.port)), 'a connect to a host the grant doesn\'t name');
      expect(stranger.connections, 'the host the grant doesn\'t name was reached').toBe(0);
      // Evidence digests: the parent's hashes of the bytes it read from the process.
      expect(exit.code).toBe(0);
      expect(exit.evidence.stdout, 'stdout\'s digest is the SHA-256 of what the process wrote').toBe(sha256(`${marker}\n`));
      expect(exit.evidence.stderr, 'stderr\'s digest is the SHA-256 of nothing').toBe(sha256(''));
    } finally {
      await w.close();
    }
  }, 60_000);
});

describe('AC4 #236.cc0de139 an undeclared write is refused by the sandbox itself, and the refusal recorded', () => {
  it('AC4 a child of a read-only job (its MCP server, say) that writes outside what the job declared is refused, and the record names the run and the path', async () => {
    const b = bins();
    const dir = tempDir();
    const job = sub(dir, 'job');
    const out = sub(dir, 'out');
    const target = join(job, 'notes.md');
    const w = await openWorld();
    try {
      const run = runId();
      const started = await w.sup.start({
        run, cwd: job,
        argv: [b.probe, '-o', join(out, 'job.json'), 'spawn', b.probe, '-o', join(out, 'server.json'), 'write', target],
        grant: { read: [b.dir], write: [out] },
      });
      expect(started.status, JSON.stringify(started)).toBe('started');
      await w.sup.wait(run);
      await w.sup.cleanup(run);
      expectDenied(tried(join(out, 'server.json'), 'write', target), 'the job\'s child writing a file the job didn\'t declare');
      expect(existsSync(target), 'the refused write left a file').toBe(false);
      const denial = await waitFor(async () => (await w.events('sandbox.denied')).find((e) => dataOf(e).run === run && dataOf(e).target === target), 15_000,
        `a sandbox.denied event naming ${run} and ${target}`);
      expect(String(dataOf(denial).operation), 'the refusal names a write').toMatch(/write/);
    } finally {
      await w.close();
    }
  }, 60_000);
});

/** A test caller that sets up no sandbox of its own: it passes the supervisor only argv, a folder and a grant. */
async function bareCaller(plant?: SupervisorOptions['plant']): Promise<void> {
  const b = bins();
  const dir = tempDir();
  const hub = await startHub(sub(dir, 'root'));
  const cwd = sub(dir, 'run');
  const out = sub(dir, 'out');
  const outside = join(sub(tempDir(), 'elsewhere'), 'w.txt');
  const file = join(out, 'tries.json');
  const w = await openWorld(plant ? { plant } : {});
  try {
    const run = runId();
    const started = await w.sup.start({ run, cwd, argv: [b.probe, '-o', file, 'unix', hub.socket, 'write', outside], grant: { read: [b.dir], write: [out] } });
    expect(started.status, JSON.stringify(started)).toBe('started');
    await w.sup.wait(run);
    await w.sup.cleanup(run);
    const connect = tried(file, 'unix', hub.socket);
    if (connect.ok) throw Error(`the hub's socket ${hub.socket} accepted a connection from ${run}, started with no sandbox of the caller's`);
    expectDenied(connect, 'a connect to the hub\'s socket');
    const write = tried(file, 'write', outside);
    if (write.ok || existsSync(outside)) throw Error(`${run} wrote ${outside}, outside its declared paths, with no sandbox of the caller's`);
    expectDenied(write, 'a write outside its declared paths');
  } finally {
    await w.close();
    await stopHub(hub);
  }
}

describe('AC6 #236.347ac606 a caller that sets up no sandbox still gets one', () => {
  it('AC6 a process started through the supervisor by a test caller can\'t reach the hub\'s socket or write outside its declared paths', async () => {
    await bareCaller();
  }, 60_000);

  it('AC6 (wrong program) a supervisor that leaves the sandbox to its caller fails this test, naming the hub\'s socket', async () => {
    await expect(bareCaller('sandbox-left-to-caller')).rejects.toThrow(/hub's socket .* accepted a connection/);
  }, 60_000);
});
