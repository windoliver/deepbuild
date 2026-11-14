import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAsks } from '@deepbuild/asks';
import { openRecord } from '@deepbuild/record';
import { afterEach, expect, test } from 'vitest';
import { openSupervisor } from './index.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

// A guarded path is kept whole: a run that may write everything else can't move a folder above it aside and put its
// own in its place, which would leave the guard on a path no longer there.
test('a run as you can rename no folder above a guarded path', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'supervisor-')));
  dirs.push(dir);
  mkdirSync(join(dir, 'tools', '1.0', 'bin'), { recursive: true });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } }, guarded: [join(dir, 'tools', '1.0', 'bin')] });
  try {
    const script = 'mv tools/1.0 tools/old; mv tools tools-old; mkdir -p elsewhere && echo ok > elsewhere/f && mv elsewhere moved';
    const started = await sup.start({ run: 'run:TEST', argv: ['/bin/sh', '-c', script], cwd: dir, grant: { run_as_you: true } });
    expect(started.status).toBe('started');
    await sup.wait('run:TEST');
    expect(existsSync(join(dir, 'tools', '1.0', 'bin'))).toBe(true);
    // Folders above nothing guarded move as before.
    expect(existsSync(join(dir, 'moved', 'f'))).toBe(true);
  } finally {
    await sup.close();
    await record.close();
  }
}, 60_000);

// Past the newest 64 cleaned, a clean run leaves the supervisor's memory (#824); its handle still answers as it did,
// from the record, so a stack taken down long after its run ended, or a terminal stopped twice, sees its cleanup and no error.
test('a clean run forgotten past the newest 64 still answers status and cleanup from the record', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'supervisor-')));
  dirs.push(dir);
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  try {
    for (let i = 0; i < 66; i++) {
      const run = `run:R${String(i).padStart(3, '0')}`;
      const started = await sup.start({ run, argv: ['/usr/bin/true'], cwd: dir, grant: { run_as_you: true } });
      expect(started.status).toBe('started');
      await sup.wait(run);
      expect((await sup.cleanup(run)).outcome).toBe('clean');
    }
    expect((await sup.status('run:R000')).state).toBe('cleaned');
    expect(await sup.cleanup('run:R000')).toMatchObject({ run: 'run:R000', outcome: 'clean', left: [] });
    await expect(sup.cleanup('run:NEVER')).rejects.toThrow('is no run of this supervisor');
  } finally {
    await sup.close();
    await record.close();
  }
}, 180_000);

// The denial stream filters by the subsystem macOS's sandbox reports carry, so `log` isn't sent every message the
// machine writes. On a macOS whose reports carry another one (planted here: the filter names a subsystem no report
// has) the canary never shows through it, and the stream starts again on the sender alone. Without that second
// start no denial is recorded, and this fails waiting for it.
test.skipIf(process.platform !== 'darwin')('a refused write is recorded on a macOS whose sandbox reports carry another subsystem', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'supervisor-')));
  dirs.push(dir);
  mkdirSync(join(dir, 'in'));
  mkdirSync(join(dir, 'outside'));
  const target = join(dir, 'outside', 'w.txt');
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } }, plant: 'reports-other-subsystem' });
  try {
    const started = await sup.start({ run: 'run:DENIED', argv: ['/usr/bin/touch', target], cwd: join(dir, 'in'), grant: { write: [join(dir, 'in')] } });
    expect(started.status).toBe('started');
    await sup.wait('run:DENIED');
    expect(existsSync(target)).toBe(false);
    const denied = async () => (await record.read({ after: 0, kinds: ['sandbox.denied'] })).filter((e) => (e.data as { run?: string; target?: string }).run === 'run:DENIED' && (e.data as { target?: string }).target === target);
    const until = Date.now() + 15_000;
    while (!(await denied()).length && Date.now() < until) await new Promise((done) => setTimeout(done, 100));
    expect((await denied()).length, `a sandbox.denied for run:DENIED naming ${target}`).toBe(1);
  } finally {
    await sup.close();
    await record.close();
  }
}, 90_000);

// A cleanup that returns leaves no scan of its run behind (#350 AC4 counts this process's children after a disable).
// The record here is slow to take the run's last event, until a timed scan of the run has started its helper process:
// the cleanup then waits that scan out.
test('a cleaned run has no scan of its sandbox still running', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'supervisor-')));
  dirs.push(dir);
  const real = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const children = () => process.getActiveResourcesInfo().filter((kind) => kind === 'ProcessWrap').length;
  let quiet = 0;
  const append: typeof real.append = async (stream, event) => {
    if (event.kind === 'run.cleaned') for (let i = 0; i < 500 && children() <= quiet; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    return real.append(stream, event);
  };
  const record = new Proxy(real, { get: (target, key) => (key === 'append' ? append : Reflect.get(target, key, target)) });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  try {
    quiet = children();
    const left: number[] = [];
    for (let i = 0; i < 5; i++) {
      expect((await sup.start({ run: `run:S${i}`, argv: ['/bin/sleep', '30'], cwd: dir, grant: { run_as_you: true } })).status).toBe('started');
      expect((await sup.cleanup(`run:S${i}`)).outcome).toBe('clean');
      // An exited child's handle closes at the end of the loop's turn: the second immediate comes after that.
      for (let turn = 0; turn < 2; turn++) await new Promise((resolve) => setImmediate(resolve));
      left.push(children() - quiet);
    }
    expect(left, 'child processes of this one still running after each of 5 cleanups').toEqual([0, 0, 0, 0, 0]);
  } finally {
    await sup.close();
    await real.close();
  }
}, 60_000);
