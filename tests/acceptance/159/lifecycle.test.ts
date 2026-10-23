// #159 AC7 and AC15: a job's processes from start to proven gone. A CLI still running 5 s after its final result is
// stopped with its group, and what lingered is recorded; a quiet job busy on CPU keeps running; work that conflicts
// with a job stays blocked while any of its processes is still active, after a result, a cancel or a lost
// connection; a stop no one confirmed reads stopping; and a binary swapped after it was verified never runs.
import { dirname } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { alive, cleanup, install, processesNaming, reported, reportsOf, sleep, sub, tempDir, ulid, waitFor, type Proc } from './helpers.ts';
import { job, openWorld, room, type World } from './world.ts';
import type { JobRecord } from '../../../packages/runner/src/index.ts';

afterEach(cleanup, 30_000);

const GRACE_MS = 5000;
/** The time it takes to signal a group and see it gone, beyond the grace. */
const SLACK_MS = 2000;

/** Polls the job's stdout, as the runner read it, until it holds the final result; resolves with when it did. */
async function resultSeen(w: World, id: string, timeoutMs = 30_000): Promise<number> {
  await waitFor(async () => (await w.runner.output(id)).includes('"type":"result"'), timeoutMs, `${id}'s final result`);
  return Date.now();
}

describe('AC7 #159.7555bf15 a CLI that lingers after its result is stopped with its group; a busy quiet one keeps running', () => {
  it('AC7 a fake CLI that prints its final result and keeps running is stopped with its group within 5 s of the grace, and the job records what lingered; a fake CLI that prints nothing for its whole output timeout while busy on CPU keeps running', async () => {
    const bin = install(sub(tempDir(), 'bin'));
    const w = await openWorld({ loginPath: `${dirname(bin)}:/usr/bin:/bin` });
    try {
      await room(w);
      // Lingering: the CLI and a helper it forked into its group keep running after the result.
      const started = await w.runner.submit(job('read', 'Answer.\n@spawn-sleeper 600\n@linger 600000'));
      const at = await resultSeen(w, started.job);
      const stdout = await w.runner.output(started.job);
      const cli = Number(reported(stdout, 'start').pid);
      const helper = Number(reported(stdout, 'spawn').pid);
      await waitFor(() => !alive(cli) && !alive(helper), GRACE_MS + SLACK_MS + 1000, `the lingering CLI (pid ${cli}) and its helper (pid ${helper}) to be stopped`);
      const took = Date.now() - at;
      expect(took, `the group was gone ${took} ms after the final result`).toBeLessThanOrEqual(GRACE_MS + SLACK_MS);
      const rec = await w.runner.wait(started.job);
      const lingered = JSON.stringify(rec.lingered ?? []);
      expect(lingered, `the job records the CLI (pid ${cli}) as lingering: ${lingered}`).toContain(String(cli));
      expect(lingered, `the job records the helper (pid ${helper}) as lingering: ${lingered}`).toContain(String(helper));

      // Quiet but busy: 8 s with no output against a 2 s output timeout, on CPU the whole time.
      const busy = await w.runner.submit(job('read', 'Think hard.\n@busy 8000', { output_timeout_ms: 2000 }));
      const pid = await waitFor(async () => (await w.runner.status(busy.job)).pid, 15_000, `${busy.job}'s process`);
      await sleep(5000);
      expect(alive(pid), 'the busy CLI was stopped while it printed nothing but used CPU').toBe(true);
      const end = await w.runner.wait(busy.job);
      expect(end.state, JSON.stringify(end)).toBe('finished');
      expect(end.result, 'it ran to its own result').toBe('fake done');
      expect(end.stop?.cause, 'it was not stopped for its silence').not.toBe('timed_out');
    } finally {
      await w.close();
    }
  }, 120_000);
});

/** The job's processes still running: the fake at `bin` and anything it forked into the job's group. */
function jobProcesses(bin: string, rec: JobRecord): Proc[] {
  const procs = processesNaming(bin).filter((p) => !/ --version| auth status/.test(p.args));
  return rec.pgid ? [...procs, ...processesNaming('/bin/sleep').filter((p) => p.pgid === rec.pgid)] : procs;
}
/** Starts conflicting work (the same lease) through the supervisor and checks it starts only once the job's processes are all gone. */
async function conflictWaits(w: World, bin: string, id: string, what: string): Promise<void> {
  const rec = await w.runner.status(id);
  expect(jobProcesses(bin, rec).length, `${what}: the job still has a process at this point (the scenario formed)`).toBeGreaterThan(0);
  const other = `run:${ulid()}`;
  const startedAt = w.sup.start({ run: other, cwd: sub(tempDir(), 'other'), argv: ['/usr/bin/true'], leases: [{ kind: 'worktree', key: 'wt-1' }] })
    .then((s) => ({ s, left: jobProcesses(bin, rec).map((p) => p.pid) }));
  const got = await Promise.race([startedAt, sleep(90_000).then(() => undefined)]);
  if (!got) throw Error(`${what}: the conflicting work never started, 90 s on`);
  expect(got.s.status, JSON.stringify(got.s)).toBe('started');
  expect(got.left, `${what}: conflicting work started while the job's process was still active`).toEqual([]);
  await w.sup.wait(other);
  await w.sup.cleanup(other);
}

describe('AC15 #159.75e393da conflicting work waits for the job\'s processes; an unconfirmed stop reads stopping; only verified bytes run', () => {
  it('AC15 after a final result, a cancel or a lost connection, a job whose process is still writing keeps conflicting work blocked until the process is gone; a stop that isn\'t confirmed reads stopping, never stopped; a binary swapped after it was verified and before launch never runs', async () => {
    const lease = [{ kind: 'worktree', key: 'wt-1' }];
    const bin = install(sub(tempDir(), 'bin'));
    const w = await openWorld({ loginPath: `${dirname(bin)}:/usr/bin:/bin` });
    try {
      await room(w);
      // After a final result: a child keeps writing for 3 s.
      const a = await w.runner.submit(job('read', 'Done.\n@keep-writing 3000', { leases: lease }));
      await resultSeen(w, a.job);
      await conflictWaits(w, bin, a.job, 'after a final result');
      await w.runner.wait(a.job);

      // After a cancel: the CLI ignores SIGTERM and keeps a helper; the stop isn't confirmed until both are gone.
      const b = await w.runner.submit(job('read', 'Working.\n@ignore-term\n@spawn-sleeper 600\n@sleep 600000', { leases: lease }));
      const bPid = await waitFor(async () => (await w.runner.status(b.job)).pid, 15_000, `${b.job}'s process`);
      await waitFor(async () => reportsOf(await w.runner.output(b.job)).some((r) => r.cmd === 'spawn'), 15_000, `${b.job}'s helper`);
      const cancelled = await w.runner.cancel(b.job);
      expect(cancelled.state, 'right after a cancel, with the CLI still running, the job reads').toBe('stopping');
      const conflict = conflictWaits(w, bin, b.job, 'after a cancel');
      const deadline = Date.now() + 90_000;
      let state = cancelled.state;
      while (state !== 'stopped' && Date.now() < deadline) {
        const rec = await w.runner.status(b.job);
        state = rec.state;
        const left = jobProcesses(bin, rec).map((p) => p.pid);
        if (state === 'stopped' && left.length) throw Error(`the job reads stopped while its processes ${left.join(', ')} still run`);
        if (state !== 'stopped') expect(state, 'an unconfirmed stop reads').toBe('stopping');
        await sleep(50);
      }
      expect(state, `the cancelled job (pid ${bPid}) was never confirmed stopped`).toBe('stopped');
      await conflict;

      // After a lost connection: the CLI closes its output with no result and keeps running and writing.
      const c = await w.runner.submit(job('read', 'Working.\n@close-output\n@keep-writing 3000\n@linger 3000', { leases: lease }));
      await waitFor(async () => (await w.runner.status(c.job)).pid, 15_000, `${c.job}'s process`);
      await sleep(300);
      await conflictWaits(w, bin, c.job, 'after a lost connection');
      const cEnd = await w.runner.wait(c.job);
      expect(cEnd.state, 'a job whose output closed with no result did not finish').not.toBe('finished');

      // A binary swapped after it was verified (between two jobs), before the next launch.
      const first = await w.runner.run(job('read', 'One.'));
      expect(first.state, JSON.stringify(first)).toBe('finished');
      install(dirname(bin), { evil: true, version: '9.9.9' });
      const second = await w.runner.run(job('read', 'Two.'));
      const out = await w.runner.output(second.job);
      expect(out.includes('EVIL RAN'), 'the binary swapped in after verification ran as a job').toBe(false);
      expect(['finished', 'refused'], `the job after the swap: ${JSON.stringify(second)}`).toContain(second.state);
      if (second.state === 'finished') expect(reported(out, 'start').version, 'it ran the verified bytes').toBe('2.1.304');
    } finally {
      await w.close();
    }

    // A binary swapped while it was being verified (during its `--version` run), before the launch.
    const slow = install(sub(tempDir(), 'slow'), { slowVersion: 2 });
    let swapped = false;
    const watch = setInterval(() => {
      if (swapped) return;
      if (processesNaming(slow).some((p) => / --version/.test(p.args))) {
        swapped = true;
        setTimeout(() => install(dirname(slow), { evil: true, version: '9.9.9' }), 300);
      }
    }, 10);
    const v = await openWorld({ loginPath: `${dirname(slow)}:/usr/bin:/bin` });
    try {
      await room(v);
      const rec = await v.runner.run(job('read', 'Three.'));
      if (!swapped) throw Error('the runner launched the job without running `claude --version` to verify it, so no swap could be timed after its verification');
      const out = await v.runner.output(rec.job);
      expect(out.includes('EVIL RAN'), 'the binary swapped in after its verification ran as a job').toBe(false);
      expect(['finished', 'refused'], `the job after the swap: ${JSON.stringify(rec)}`).toContain(rec.state);
      if (rec.state === 'finished') expect(reported(out, 'start').version, 'it ran the verified bytes').toBe('2.1.304');
    } finally {
      clearInterval(watch);
      await v.close();
    }
  }, 400_000);
});
