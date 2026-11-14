import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
// has) the canary never shows through it, and the stream starts again on a wider filter. Without that second
// start no denial is recorded, and this fails waiting for it. The second start names the kernel as the reports'
// process, where the sandbox extension writes them, before the sender alone: sent every process's messages, `log`
// costs several times what it does sent the kernel's. A second start on the sender alone fails the last line. Where
// the kernel's messages show no report either (planted: the filter names a process that writes none), the stream
// starts a third time, on the sender alone, and a supervisor that stops at the second records no denial.
test.skipIf(process.platform !== 'darwin').each([
  ['carry another subsystem', 'reports-other-subsystem', '--predicate process == "kernel" AND sender =='],
  ['carry another subsystem and come from another process', 'reports-other-process', '--predicate sender =='],
] as const)('a refused write is recorded on a macOS whose sandbox reports %s', async (_world, plant, filter) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'supervisor-')));
  dirs.push(dir);
  mkdirSync(join(dir, 'in'));
  mkdirSync(join(dir, 'outside'));
  const target = join(dir, 'outside', 'w.txt');
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } }, plant });
  try {
    const started = await sup.start({ run: 'run:DENIED', argv: ['/usr/bin/touch', target], cwd: join(dir, 'in'), grant: { write: [join(dir, 'in')] } });
    expect(started.status).toBe('started');
    await sup.wait('run:DENIED');
    expect(existsSync(target)).toBe(false);
    const denied = async () => (await record.read({ after: 0, kinds: ['sandbox.denied'] })).filter((e) => (e.data as { run?: string; target?: string }).run === 'run:DENIED' && (e.data as { target?: string }).target === target);
    const until = Date.now() + 15_000;
    while (!(await denied()).length && Date.now() < until) await new Promise((done) => setTimeout(done, 100));
    expect((await denied()).length, `a sandbox.denied for run:DENIED naming ${target}`).toBe(1);
    const streams = spawnSync('ps', ['-A', '-o', 'ppid=,command='], { encoding: 'utf8' }).stdout.split('\n')
      .filter((line) => Number(line.trim().split(/\s+/)[0]) === process.pid && line.includes('/usr/bin/log stream'));
    expect(streams.map((line) => line.includes(filter)), `the one stream left is the narrowest that shows a report (${filter}):\n${streams.join('\n')}`).toEqual([true]);
  } finally {
    await sup.close();
    await record.close();
  }
}, 90_000);

// The stream writes nothing while no report matches its filter, so nothing tells it that its reader is gone: left a
// plain child, it ran on after a hub that was killed, until the machine's next matching report. It runs on the
// helper's leash, which ends it when the process that started it is gone, however that process went.
test.skipIf(process.platform !== 'darwin')('a process killed with its supervisor open leaves no sandbox-report stream running', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'supervisor-')));
  dirs.push(dir);
  const built = (name: string) => JSON.stringify(fileURLToPath(new URL(`../../${name}/dist/index.js`, import.meta.url)));
  const script = `
    const { openRecord } = await import(${built('record')});
    const { openAsks } = await import(${built('asks')});
    const { openSupervisor } = await import(${built('supervisor')});
    const record = await openRecord({ path: process.argv[1], now: Date.now });
    const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
    await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
    console.log('open');
    setInterval(() => undefined, 1000);`;
  const owner = spawn(process.execPath, ['--input-type=module', '-e', script, join(dir, 'ledger.db')], { stdio: ['ignore', 'pipe', 'inherit'] });
  const gone = new Promise((done) => owner.on('exit', done));
  /** Every `log stream` under the owner, by PID: its child, or its child's. */
  const streams = (): number[] => {
    const rows = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout.split('\n').map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter((m) => m !== null);
    const under = new Set([owner.pid!]);
    for (let grew = true; grew;) { grew = false; for (const m of rows) if (under.has(Number(m[2])) && !under.has(Number(m[1]))) { under.add(Number(m[1])); grew = true; } }
    return rows.filter((m) => under.has(Number(m[1])) && m[3]!.includes('/usr/bin/log stream')).map((m) => Number(m[1]));
  };
  const running = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
  let left: number[] = [];
  try {
    await new Promise<void>((opened, failed) => {
      owner.stdout.setEncoding('utf8').on('data', (text: string) => { if (text.includes('open')) opened(); });
      owner.on('exit', () => failed(Error('the process ended before its supervisor opened')));
    });
    left = streams();
    expect(left.length, 'the open supervisor runs a sandbox-report stream').toBeGreaterThan(0);
    owner.kill('SIGKILL');
    await gone;
    for (const until = Date.now() + 5_000; left.some(running) && Date.now() < until;) await new Promise((done) => setTimeout(done, 50));
    expect(left.filter(running), 'sandbox-report streams still running 5 s after their process was killed').toEqual([]);
  } finally {
    owner.kill('SIGKILL');
    for (const pid of left.filter(running)) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  }
}, 60_000);
