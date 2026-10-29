// #29 AC8, AC9, AC10: the concurrency limit over ten worktrees, a heavy command's cpu.slot lease (through the repo's lease
// script where there is one, a timing failure's load, the slot in the lease table under its session) and the reuse of a
// last verdict whose inputs haven't changed. Real git repositories, real processes, the real lease table over the real record.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeClaim, runHeavy, verdictMemory } from '../../../packages/gate/src/index.ts';
import type { ExecCheck, Executed } from '../../../packages/gate/src/index.ts';
import { commitFiles, git, makeRepo, mustFail, NODE, session, sleep, write } from './helpers.ts';
import { heldSlots, leaseWorld, maxOverlap, SLOT } from './h-d.ts';

type Plant8 = 'ignores-limit' | 'own-slot-queue';
const lines = (file: string): string[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);

// ---- AC8
const SLEEPER = "const fs=require('fs');const [id,log]=process.argv.slice(1);fs.appendFileSync(log,'S '+id+' '+Date.now()+'\\n');setTimeout(()=>{fs.appendFileSync(log,'E '+id+' '+Date.now()+'\\n')},300)";
async function tenWorktrees(plant?: Plant8): Promise<void> {
  const w = await leaseWorld(8); // cpu.slot is a pool of 4
  const stopTicks = w.ticker();
  try {
    const log = join(w.dir, 'log.txt');
    writeFileSync(log, '');
    const worktrees = Array.from({ length: 10 }, (_, i) => {
      const { dir } = makeRepo({ 'src/a.ts': `export const a = ${i};\n` });
      write(dir, { 'src/a.ts': `export const a = ${i + 100};\n` }); // an uncommitted change: the claim covers a snapshot
      const checks: ExecCheck[] = [1, 2].map((n) => ({ id: `w${i}c${n}`, argv: [NODE, '-e', SLEEPER, `w${i}c${n}`, log] }));
      return { dir, checks, session: session() };
    });
    let peak = 0;
    const sampler = setInterval(() => void heldSlots(w).then((n) => { peak = Math.max(peak, n); }), 15);
    const executed: Executed[] = await Promise.all(worktrees.map((t) => executeClaim({ repo: t.dir, session: t.session, table: w.table, checks: t.checks, ...(plant ? { plant } : {}) })));
    clearInterval(sampler);
    peak = Math.max(peak, await heldSlots(w));

    const all = executed.flatMap((e) => e.checks);
    expect(all.length, 'every one of the 20 checks of the ten worktrees ran and is reported').toBe(20);
    for (const c of all) expect(c.exit, `check ${c.id} exits 0: ${c.output}`).toBe(0);
    const starts = new Map<string, number>();
    const ends = new Map<string, number>();
    for (const l of lines(log)) { const [k, id, t] = l.split(' '); (k === 'S' ? starts : ends).set(id!, Number(t)); }
    expect(starts.size, 'the log shows all 20 checks started').toBe(20);
    expect(ends.size, 'the log shows all 20 checks ended').toBe(20);
    const overlap = maxOverlap([...starts].map(([id, s]) => [s, ends.get(id)!] as [number, number]));
    expect(overlap, `never more than half the 8 cores run checks at once (the log's own stamps overlap ${overlap} deep)`).toBeLessThanOrEqual(4);
    expect(maxOverlap(all.map((c) => [c.started_at, c.ended_at] as [number, number])), 'the runner\'s own started/ended stamps never overlap more than 4 deep').toBeLessThanOrEqual(4);
    // Queued per worktree: a worktree's checks run in turn.
    for (const e of executed) {
      const [first, second] = e.checks;
      expect(second!.started_at, `worktree ${first!.id}: its second check starts after its first ended`).toBeGreaterThanOrEqual(first!.ended_at);
    }
    // Through the real lease table, never a queue of the runner's own.
    expect(peak, 'the slots held show in the lease table (peak seen)').toBeGreaterThanOrEqual(1);
    expect(peak, `the lease table never holds more than the pool's 4 cpu.slot leases (peak ${peak})`).toBeLessThanOrEqual(4);
    for (const c of all) expect(c.lease, `check ${c.id} ran under a cpu.slot lease`).not.toBeNull();
    const acquired = (await w.events('lease.acquired')).filter((e) => (e.data as { resource?: { kind?: string } }).resource?.kind === 'cpu.slot');
    expect(acquired.length, 'one cpu.slot lease was acquired for each of the 20 checks').toBe(20);
    const holders = new Set(worktrees.map((t) => t.session));
    for (const e of acquired) expect(holders.has((e.data as { holder: string }).holder), 'each lease is held by a worktree\'s session').toBe(true);
  } finally {
    stopTicks();
    await w.close();
  }
}
describe('AC8 ten worktrees claiming at once never exceed the concurrency limit', () => {
  it('AC8 ten worktrees with two checks each, on a table of 8 cores, never run more than 4 checks at once and every check runs under a cpu.slot lease', async () => {
    await tenWorktrees();
  }, 120_000);
  it('AC8 (wrong program) a runner that ignores the limit runs all ten at once and fails this test', async () => {
    await mustFail('ignores-limit', () => tenWorktrees('ignores-limit'));
  }, 120_000);
  it('AC8 (wrong program) a runner that keeps its own slot queue takes no cpu.slot lease and fails this test', async () => {
    await mustFail('own-slot-queue', () => tenWorktrees('own-slot-queue'));
  }, 120_000);
});

// ---- AC9
const HEAVY = "const fs=require('fs');const [marker,go,code]=process.argv.slice(1);fs.writeFileSync(marker,'started');while(!fs.existsSync(go)){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20)}process.exit(Number(code||0))";
type PlantHeavy = 'own-slot-queue' | 'ignores-lease-script' | 'no-load-reading';
async function heavy(o: { plant?: PlantHeavy; leaseScript: boolean }): Promise<void> {
  const w = await leaseWorld(4); // cpu.slot is a pool of 2
  const stopTicks = w.ticker();
  try {
    const { dir } = makeRepo({ 'src/a.ts': 'export const a = 1;\n', 'package.json': '{"name":"shop"}\n' });
    const marker = join(w.dir, 'command-started');
    const go = join(w.dir, 'go');
    const leaseMarker = join(w.dir, 'lease-script-ran');
    if (o.leaseScript) {
      write(dir, { 'scripts/lease': `#!/bin/sh\necho "$@" > '${leaseMarker}'\nexec "$@"\n` });
      chmodSync(join(dir, 'scripts/lease'), 0o755);
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', 'lease script']);
    }
    // Two other sessions fill the pool.
    const others = [session(), session()];
    for (const h of others) {
      const got = await w.table.lease({ holder: h }, SLOT, 'exclusive');
      expect(got.status, 'the pool of 2 is filled by two other sessions').toBe('granted');
    }
    const mine = session();
    const argv = [NODE, '-e', HEAVY, marker, go, '0'];
    const running = runHeavy({ repo: dir, session: mine, table: w.table, argv, inputs: ['src/**'], memory: verdictMemory(), ...(o.plant ? { plant: o.plant } : {}) });
    await sleep(400);
    expect(existsSync(marker), 'while every slot is held by others, the full build/e2e command has not started').toBe(false);
    expect(existsSync(leaseMarker), 'nor has the repo\'s lease script run').toBe(false);
    expect((await w.table.leases()).filter((v) => v.lease.resource.kind === 'cpu.slot' && v.lease.holder === mine).length, 'no cpu.slot lease is held under the session while it waits').toBe(0);
    // One other session ends: its slot frees and the heavy run gets it.
    await w.endSession(others[0]!);
    const deadline = Date.now() + 15_000;
    while (!existsSync(marker) && Date.now() < deadline) await sleep(30);
    expect(existsSync(marker), 'once a slot frees, the command starts').toBe(true);
    const during = (await w.table.leases()).filter((v) => v.lease.resource.kind === 'cpu.slot' && v.lease.holder === mine);
    expect(during.length, 'while it runs, the lease table shows a cpu.slot lease under its session').toBe(1);
    const acquired = (await w.events('lease.acquired')).filter((e) => (e.data as { holder?: string }).holder === mine);
    expect(acquired.length, 'the record\'s lease.acquired names the session\'s cpu.slot lease').toBe(1);
    expect((acquired[0]!.data as { resource: { kind: string } }).resource.kind).toBe('cpu.slot');
    if (o.leaseScript) {
      expect(existsSync(leaseMarker), 'the command ran through the repo\'s lease script').toBe(true);
      expect(readFileSync(leaseMarker, 'utf8'), 'the lease script was handed the command').toContain(marker);
    } else {
      expect(existsSync(leaseMarker), 'a repo without a lease script runs the command directly').toBe(false);
    }
    writeFileSync(go, 'go');
    const result = await running;
    expect(result.exit, 'the command ended 0').toBe(0);
    expect(result.outcome).toBe('passed');
    expect(result.reused).toBe(false);
    expect(result.lease?.holder, 'the result names the lease it held').toBe(mine);
    expect(result.lease?.resource.kind).toBe('cpu.slot');
    await sleep(100);
    expect((await w.table.leases()).filter((v) => v.lease.holder === mine).length, 'the slot is released when the command ends').toBe(0);
  } finally {
    stopTicks();
    await w.close();
  }
}
async function timingFailure(plant?: PlantHeavy): Promise<void> {
  const w = await leaseWorld(8);
  try {
    const { dir } = makeRepo({ 'src/a.ts': 'x\n' });
    const result = await runHeavy({
      repo: dir, session: session(), table: w.table, argv: [NODE, '-e', 'process.exit(1)'], inputs: ['src/**'], memory: verdictMemory(),
      timing: true, load: () => ({ avg1: 13.5, cores: 8 }), ...(plant ? { plant } : {}),
    });
    expect(result.outcome, 'the timing check failed').toBe('failed');
    expect(result.exit).toBe(1);
    expect(result.load, 'a timing failure records the machine\'s load').toEqual({ avg1: 13.5, cores: 8 });
  } finally {
    await w.close();
  }
}
describe('AC9 a full build or e2e suite waits for a cpu.slot lease', () => {
  it('AC9 the command waits while the pool is full, then runs under a cpu.slot lease shown in the lease table under its session', async () => {
    await heavy({ leaseScript: false });
  }, 60_000);
  it('AC9 where the repo has a lease script the command runs through it, after the slot is held', async () => {
    await heavy({ leaseScript: true });
  }, 60_000);
  it('AC9 each timing failure records the machine\'s load', async () => {
    await timingFailure();
  }, 60_000);
  it('AC9 (wrong program) a runner that keeps its own slot queue starts at once with no lease and fails this test', async () => {
    await mustFail('own-slot-queue', () => heavy({ plant: 'own-slot-queue', leaseScript: false }));
  }, 60_000);
  it('AC9 (wrong program) a runner that ignores the repo\'s lease script fails this test', async () => {
    await mustFail('ignores-lease-script', () => heavy({ plant: 'ignores-lease-script', leaseScript: true }));
  }, 60_000);
  it('AC9 (wrong program) a runner that records no load on a timing failure fails this test', async () => {
    await mustFail('no-load-reading', () => timingFailure('no-load-reading'));
  }, 60_000);
});

// ---- AC10
async function reuse(o: { plant?: 'no-reuse'; fails?: boolean }): Promise<void> {
  const w = await leaseWorld(8);
  try {
    const { dir } = makeRepo({ 'src/a.ts': 'export const a = 1;\n', 'docs/readme.md': 'hello\n' });
    const counter = join(w.dir, 'runs');
    const argv = [NODE, '-e', `require('fs').appendFileSync(${JSON.stringify(counter)},'run\\n');process.exit(${o.fails ? 1 : 0})`];
    const memory = verdictMemory();
    const go = () => runHeavy({ repo: dir, session: session(), table: w.table, argv, inputs: ['src/**'], memory, ...(o.plant ? { plant: o.plant } : {}) });
    const want = o.fails ? 'failed' : 'passed';
    const first = await go();
    expect([first.reused, first.outcome, lines(counter).length], 'the first run runs the command').toEqual([false, want, 1]);
    const second = await go();
    expect(lines(counter).length, 'inputs unchanged since the last verdict: the command does not run again').toBe(1);
    expect(second.reused, 'the last verdict is reused').toBe(true);
    expect(second.outcome, 'and it is that verdict').toBe(want);
    expect(second.lease, 'a reused verdict takes no slot').toBeNull();
    write(dir, { 'docs/readme.md': 'changed, but not an input\n' });
    const third = await go();
    expect([third.reused, lines(counter).length], 'a change outside the declared inputs still reuses the verdict').toEqual([true, 1]);
    write(dir, { 'src/a.ts': 'export const a = 2;\n' });
    const fourth = await go();
    expect([fourth.reused, lines(counter).length], 'an input changed: it runs again').toEqual([false, 2]);
    const fifth = await go();
    expect([fifth.reused, lines(counter).length], 'and the new verdict is reused in turn').toEqual([true, 2]);
    memory.dropEvidence();
    const sixth = await go();
    expect([sixth.reused, lines(counter).length], 'once the last verdict\'s evidence is gone it runs its command again instead of reusing it').toEqual([false, 3]);
    commitFiles(dir, { 'src/b.ts': 'new\n' }, 'more');
    const seventh = await go();
    expect([seventh.reused, lines(counter).length], 'a new input file in the declared inputs runs again').toEqual([false, 4]);
  } finally {
    await w.close();
  }
}
describe('AC10 a full build or e2e suite whose inputs haven\'t changed gets the last verdict', () => {
  it('AC10 unchanged inputs reuse the last verdict; a changed input, or removed evidence, runs again', async () => {
    await reuse({});
  }, 60_000);
  it('AC10 a failed verdict is reused as the failed verdict', async () => {
    await reuse({ fails: true });
  }, 60_000);
  it('AC10 (wrong program) a runner that always runs again fails this test', async () => {
    await mustFail('no-reuse', () => reuse({ plant: 'no-reuse' }));
  }, 60_000);
});
