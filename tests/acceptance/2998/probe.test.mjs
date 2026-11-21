// #2998 acceptance, AC1 and AC2: a supervisor closed, and a hub stopped, while a canary probe it started is running.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAsks } from '@deepbuild/asks';
import { openRecord } from '@deepbuild/record';
import { openSupervisor } from '@deepbuild/supervisor';
import { measureOnce } from '../../../scripts/benchmark.mjs';
import { afterEach, describe, expect, test } from 'vitest';
import { probesOf, REPO, running, SANDBOX_EXEC, sleep, turn } from './helpers.mjs';

const mac = process.platform === 'darwin';
const OFF_MAC = 'macOS only (the issue\'s Runs on): Linux\'s sandbox reports come through the run\'s parent, with no canary';
const DRIVER = fileURLToPath(new URL('./fixtures/stop-mid-probe.mjs', import.meta.url));
// AC2's scenario, run this many times: each a hub stopped while a probe it started was seen running.
const HUBS = 10;
const MAX_TRIES = 30;

const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('AC1 #2998.441bfb4c a supervisor closed mid-warm-up has ended and reaped every probe it started', () => {
  test.skipIf(!mac)(`AC1 close() resolves with no canary probe of this process left running or unreaped, and none starts after${mac ? '' : ` (skipped: ${OFF_MAC})`}`, async () => {
    const dir = realpathSync(mkdtempSync('/tmp/dh2998-sup-'));
    dirs.push(dir);
    const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
    const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
    // Planted: the first filter names a subsystem no report carries, so the stream warms for its whole 10 s window.
    const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } }, plant: 'reports-other-subsystem' });
    const started = new Set();
    let closed = false;
    try {
      // Wait, inside the first filter's 10 s window, until a probe this process started is running.
      let seen = null;
      const until = Date.now() + 9_000;
      while (!seen && Date.now() < until) {
        const rows = probesOf(process.pid);
        for (const p of rows) started.add(p.pid);
        seen = rows.find(running) ?? null;
        if (!seen) await turn();
      }
      expect(seen, 'INCONCLUSIVE: no /usr/bin/sandbox-exec canary probe of this process was ever seen running, so close() was never tried mid-probe').not.toBeNull();
      await sup.close();
      closed = true;
      // The moment close() resolves: every probe it started has exited and been reaped (no zombie left of this process).
      const left = probesOf(process.pid, started);
      expect(left.map((p) => `${p.pid} ${p.stat} ${p.command.slice(0, 160)}`), `the probe seen running (pid ${seen.pid}) and any other this process started are gone and reaped when close() resolves`).toEqual([]);
      // And no probe starts after close() resolves.
      const later = [];
      const quietUntil = Date.now() + 2_000;
      while (Date.now() < quietUntil) {
        for (const p of probesOf(process.pid)) if (!started.has(p.pid) && !later.some((q) => q.pid === p.pid)) later.push(p);
        await sleep(5);
      }
      expect(later.map((p) => `${p.pid} ${p.stat} ${p.command.slice(0, 160)}`), 'no canary probe whose parent is this process starts in the 2 s after close() resolves').toEqual([]);
    } finally {
      if (!closed) await sup.close();
      // A probe the base left behind ends by itself; give it time to, so the record closes with nothing writing.
      for (let i = 0; i < 100 && probesOf(process.pid, started).length; i++) await sleep(20);
      await record.close();
    }
  }, 120_000);
});

describe('AC2 #2998.c5579a7f a hub stopped mid-probe under the perf counter leaves /usr/bin/sandbox-exec out of uncounted', () => {
  test.skipIf(!mac)(`AC2 ${HUBS} hubs, each sent SIGTERM while a canary probe it started is running, never name ${SANDBOX_EXEC} in uncounted${mac ? '' : ` (skipped: ${OFF_MAC})`}`, () => {
    const runs = [];
    let tries = 0;
    // A probe lives about 50 ms, and a hub whose first filter shows the first canary starts one only, so the driver
    // can miss it: a run whose driver saw no probe running isn't the criterion's and isn't counted, and is tried again.
    while (runs.length < HUBS && tries < MAX_TRIES) {
      tries += 1;
      const run = measureOnce(['node', DRIVER], REPO);
      expect(run.status, `driver run ${tries} exited ${run.status}: ${run.output}`).toBe(0);
      const line = run.stdout.trim().split('\n').at(-1) ?? '';
      let said;
      try { said = JSON.parse(line); } catch { said = null; }
      expect(said, `driver run ${tries} printed no report: ${run.output}`).not.toBeNull();
      expect(said.exitedBeforeStop, `INCONCLUSIVE: run ${tries}'s hub exited before it was stopped: ${run.output}`).toBeNull();
      if (!said.probe) continue;
      // The counter ran and read this run: on a Mac without it, every count is missing and uncounted empty.
      expect(run.instructions !== null || run.uncounted.length > 0, `BLOCKED: run ${tries} has no reading from the perf lane's counter (instructions ${run.instructions}, uncounted [])`).toBe(true);
      runs.push({ run: tries, probe: said.probe.pid, stopMs: said.stopMs, uncounted: run.uncounted });
    }
    expect(runs.length, `INCONCLUSIVE: in ${tries} hubs only ${runs.length} were seen with a canary probe running when stopped, of the ${HUBS} needed`).toBe(HUBS);
    expect(runs.filter((r) => r.uncounted.includes(SANDBOX_EXEC)), `runs whose uncounted names ${SANDBOX_EXEC}, of ${JSON.stringify(runs)}`).toEqual([]);
  }, 900_000);
});
