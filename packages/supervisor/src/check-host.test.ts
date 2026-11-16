// A timed-out check must cancel a queued start, not wait forever for somebody else's lease to become free.
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { openAsks } from '@deepbuild/asks';
import { openRecord } from '@deepbuild/record';
import { checkHost, openSupervisor } from './index.js';

it('closing a check cancels its held start before the occupied lease is released', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-check-scope-')));
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor = await openSupervisor({ record, asks, now: Date.now,
    settings: { asks: { unblock: { deadline_ms: 60_000 } } }, resources: [{ kind: 'scope.fixture', keys: ['one'] }] });
  const launch = { argv: [process.execPath, '-e', 'process.stdin.resume();setTimeout(()=>{},60000)'], cwd: dir,
    input: Buffer.from('fixture'), grant: { read: [process.execPath] }, leases: [{ kind: 'scope.fixture' }] };
  const scope = checkHost(supervisor);
  try {
    assert.equal((await supervisor.start({ ...launch, run: 'run:occupied' })).status, 'started');
    const pending = scope.host.start({ ...launch, run: 'run:held' });
    for (const until = Date.now() + 5000; Date.now() < until; await sleep(20)) {
      if (await supervisor.status('run:held').then(s => s.state === 'held', () => false)) break;
    }
    assert.equal((await supervisor.status('run:held')).state, 'held', 'the test really occupies the only lease');
    const closing = scope.close().then(() => true);
    let timer: NodeJS.Timeout | undefined;
    try {
      assert.equal(await Promise.race([closing, new Promise<boolean>(done => { timer = setTimeout(() => done(false), 1500); })]), true,
        'closing a timed-out check must cancel its held start without waiting for another run');
      assert.equal((await pending).status, 'BLOCKED', 'a cancelled start never launches later');
      assert.equal(await supervisor.lives('run:occupied'), true, 'the other run stays alive');
      await assert.rejects(scope.host.start({ ...launch, run: 'run:late' }), /check ended/);
      assert.equal((await record.read({ after: 0, limit: 1000 })).some(e => e.kind === 'process.tracked' && (e.data as { run: string }).run === 'run:held'), false);
    } finally {
      clearTimeout(timer);
      // The test alone owns both tokens; explicitly cancel the queue before releasing its occupied lease.
      await supervisor.cleanup('run:held');
      await closing;
    }
  } finally { await supervisor.cleanup('run:occupied'); await supervisor.close(); await record.close(); rmSync(dir, { recursive: true, force: true }); }
}, 60_000);

it('a rejected duplicate run never becomes this check\'s cleanup target', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-check-owner-')));
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 60_000 } } } });
  const scope = checkHost(supervisor);
  const launch = { run: 'run:somebodyelse', argv: [process.execPath, '-e', 'setTimeout(()=>{},60000)'], cwd: dir, input: Buffer.from('fixture'), grant: { read: [process.execPath] } };
  try {
    assert.equal((await supervisor.start(launch)).status, 'started');
    await assert.rejects(scope.host.start(launch), /already started/);
    await scope.close();
    assert.equal(await supervisor.lives(launch.run), true, 'a run this scope never started must survive its cleanup');
  } finally { await supervisor.cleanup(launch.run); await supervisor.close(); await record.close(); rmSync(dir, { recursive: true, force: true }); }
}, 60_000);
