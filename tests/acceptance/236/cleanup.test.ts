// #236 AC7 (the decoy), AC10 and AC11: cleanup stops what the run owns, found by its token and start time, its
// process group and the forks the supervisor watched, and nothing else. The trees are fixtures/tree.c; every
// PID comes from the files the fixture writes, never from the supervisor (README, AC7, AC10, AC11).
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { alive, bins, cleanup, hasRunToken, own, ownPidDir, pidsIn, proc, runId, sub, tempDir, waitFor } from './helpers.ts';
import { dataOf, openWorld } from './world.ts';
import type { SupervisorOptions } from '../../../packages/supervisor/src/index.ts';

afterEach(cleanup, 30_000);

const one = async (dir: string, role: string, timeoutMs = 5000): Promise<number> =>
  waitFor(() => pidsIn(dir)[role]?.[0], timeoutMs, `the tree's ${role} helper to write its PID file in ${dir}`);

describe('AC7 #236.61bc1ccd a decoy that looks like ours but has no run token survives cleanup', () => {
  it('AC7 the same program, started by hand in the run\'s folder with no token, survives cleanup of the run, while the run\'s own processes are stopped', async () => {
    const b = bins();
    const dir = tempDir();
    const cwd = sub(dir, 'run');
    const runPids = ownPidDir(sub(dir, 'pids'));
    const decoyPids = ownPidDir(sub(dir, 'decoy'));
    const w = await openWorld();
    try {
      const run = runId();
      const started = await w.sup.start({ run, cwd, argv: [b.tree, runPids, 'late'], grant: { read: [b.dir], write: [runPids] } });
      expect(started.status, JSON.stringify(started)).toBe('started');
      const decoy = spawn(b.tree, [decoyPids, 'late'], { cwd, env: { PATH: '/usr/bin:/bin' }, detached: true, stdio: 'ignore' });
      own(decoy.pid);
      const decoys = [await one(decoyPids, 'server'), await one(decoyPids, 'g')];
      const mine = [await one(runPids, 'server'), await one(runPids, 'g')];
      for (const pid of decoys) expect(hasRunToken(pid), `BLOCKED: the decoy ${pid} carries a run token`).toBe(false);
      await waitFor(() => decoys.every((pid) => proc(pid)?.command.includes('tree') || proc(pid)?.command === 'sleep 600'), 3000, 'the decoy to settle');
      const result = await w.sup.cleanup(run);
      for (const pid of decoys) {
        expect(alive(pid), `the decoy ${pid} (no run token) was stopped by cleanup of ${run}`).toBe(true);
        expect(result.stopped, `cleanup says it stopped the decoy ${pid}`).not.toContain(pid);
      }
      for (const pid of mine) expect(alive(pid), `the run's process ${pid} is still running after cleanup`).toBe(false);
    } finally {
      await w.close();
    }
  }, 60_000);
});

/** AC10's scenario: the server forks "a" (setsid, keeps the token) and "b" (empty environment, the run's group) and exits. */
async function split(plant?: SupervisorOptions['plant']): Promise<void> {
  const b = bins();
  const dir = tempDir();
  const cwd = sub(dir, 'run');
  const pids = ownPidDir(sub(dir, 'pids'));
  const w = await openWorld({ resources: [{ kind: 'port', keys: ['4100'] }], ...(plant ? { plant } : {}) });
  try {
    const run = runId();
    const started = await w.sup.start({ run, cwd, argv: [b.tree, pids, 'split'], grant: { read: [b.dir], write: [pids] }, leases: [{ kind: 'port', key: '4100' }] });
    if (started.status !== 'started') throw Error(`BLOCKED: ${run} didn't start: ${JSON.stringify(started)}`);
    expect(started.leases).toContainEqual({ kind: 'port', key: '4100' });
    // The server exits (its helpers may still hold its output pipes, so this waits on the PID, not on wait()).
    await waitFor(() => !alive(started.pid), 10_000, `the server (${started.pid}) to exit`);
    const a = await one(pids, 'a');
    const bb = await one(pids, 'b');
    // The scenario as the criterion states it.
    const pa = await waitFor(() => { const p = proc(a); return p && p.ppid === 1 ? p : undefined; }, 3000, `helper a (${a}) to have PPID 1`);
    const pb = await waitFor(() => { const p = proc(bb); return p && p.ppid === 1 && p.command === 'sleep 600' ? p : undefined; }, 3000, `helper b (${bb}) to exec with PPID 1`);
    expect(pa.pgid, 'BLOCKED: helper a has its own process group').toBe(a);
    expect(hasRunToken(a), 'BLOCKED: helper a keeps the run token').toBe(true);
    expect(pb.pgid, 'BLOCKED: helper b stays in the run\'s group').toBe(started.pgid);
    expect(hasRunToken(bb), 'BLOCKED: helper b has no run token').toBe(false);

    const result = await w.sup.cleanup(run);
    for (const [role, pid] of [['a', a], ['b', bb]] as const) {
      if (alive(pid)) throw Error(`helper ${role} (PID ${pid}) is still running after cleanup of ${run}`);
    }
    expect(result.outcome).toBe('clean');
    expect(result.stopped).toEqual(expect.arrayContaining([a, bb]));
    // The lease ends only once both are gone: its release comes after each one's end in the record.
    const events = await w.events();
    const ended = (pid: number) => events.find((e) => e.kind === 'process.ended' && dataOf(e).run === run && dataOf(e).pid === pid);
    const released = events.find((e) => e.kind === 'lease.released' && (dataOf(e).resource as { key?: string } | undefined)?.key === '4100');
    expect(events.some((e) => e.kind === 'lease.acquired' && (dataOf(e).resource as { key?: string } | undefined)?.key === '4100'), 'the run\'s port lease was recorded').toBe(true);
    expect(released, 'the port lease was released').toBeDefined();
    for (const pid of [a, bb]) {
      const end = ended(pid);
      expect(end, `the record has process.ended for ${pid}`).toBeDefined();
      expect(released!.log_pos, `the lease ended before ${pid} was gone`).toBeGreaterThan(end!.log_pos);
    }
  } finally {
    await w.close();
  }
}

describe('AC10 #236.e12544e6 a helper that calls setsid and one that drops its environment are both stopped', () => {
  it('AC10 cleanup stops the setsid helper by ID and the bare helper as a member of the group, and the lease ends after both are gone', async () => {
    await split();
  }, 60_000);

  it('AC10 (wrong program) a supervisor that stops only token-bearing members of the recorded group leaves the setsid helper running, and fails naming its PID', async () => {
    await expect(split('stops-token-bearing-group-members')).rejects.toThrow(/helper a \(PID \d+\) is still running/);
  }, 60_000);

  it('AC10 (wrong program) a supervisor that requires a token of every group member leaves the bare helper running, and fails naming its PID', async () => {
    await expect(split('requires-token-in-group')).rejects.toThrow(/helper b \(PID \d+\) is still running/);
  }, 60_000);
});

/** AC11's scenario: the server's helper waits 100 ms, forks a grandchild and exits; the grandchild calls setsid and execs bare. */
async function late(plant?: SupervisorOptions['plant']): Promise<void> {
  const b = bins();
  const dir = tempDir();
  const cwd = sub(dir, 'run');
  const pids = ownPidDir(sub(dir, 'pids'));
  const w = await openWorld(plant ? { plant } : {});
  try {
    const run = runId();
    const started = await w.sup.start({ run, cwd, argv: [b.tree, pids, 'late'], grant: { read: [b.dir], write: [pids] } });
    if (started.status !== 'started') throw Error(`BLOCKED: ${run} didn't start: ${JSON.stringify(started)}`);
    const g = await one(pids, 'g');
    const pg = await waitFor(() => { const p = proc(g); return p && p.ppid === 1 && p.command === 'sleep 600' ? p : undefined; }, 3000, `the grandchild (${g}) to exec with PPID 1`);
    expect(pg.pgid, 'BLOCKED: the grandchild has its own session and group').toBe(g);
    expect(hasRunToken(g), 'BLOCKED: the grandchild has an empty environment').toBe(false);
    // Recorded when it appears: before any cleanup, by ID and start time.
    let tracked: Record<string, unknown> | undefined;
    try {
      const e = await waitFor(async () => (await w.events('process.tracked')).find((x) => dataOf(x).run === run && dataOf(x).pid === g), 3000, `process.tracked for ${g}`);
      tracked = dataOf(e);
    } catch { /* judged below, after cleanup */ }
    await w.sup.cleanup(run);
    if (alive(g)) throw Error(`the grandchild (PID ${g}) is still running after cleanup of ${run}`);
    expect(tracked, `the grandchild (PID ${g}) wasn't recorded within 3 s of appearing`).toBeDefined();
    expect(tracked!.start, `the grandchild's recorded start time`).toBe(pg.start);
  } finally {
    await w.close();
  }
}

describe('AC11 #236.7688dfa8 on macOS a grandchild that appears late and leaves the group is recorded and stopped', () => {
  it('AC11 the grandchild is recorded by ID and start time when it appears, and cleanup stops it', async () => {
    await late();
  }, 60_000);

  it('AC11 (wrong program) a supervisor that records only the processes it started leaves the grandchild running, and fails naming its PID', async () => {
    await expect(late('records-only-started')).rejects.toThrow(/the grandchild \(PID \d+\) is still running/);
  }, 60_000);
});
