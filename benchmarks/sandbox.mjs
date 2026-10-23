// The supervisor's per-check overhead, for the perf lane's budgets (issue #236): node benchmarks/sandbox.mjs.
// One process opens a record, the asks core and the supervisor in a temp folder, then starts, waits for and
// cleans up 20 runs of /usr/bin/true in the platform sandbox, interleaved with 20 bare spawns of it, and prints
// the median of each and their difference as one JSON line. The issue's 300 ms limit stays in
// tests/acceptance/236/budgets.test.ts.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAsks } from '../packages/asks/dist/index.js';
import { openRecord } from '../packages/record/dist/index.js';
import { openSupervisor } from '../packages/supervisor/dist/index.js';

const ROUNDS = 20;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const bare = () => new Promise((resolve, reject) => {
  const t0 = performance.now();
  const child = spawn('/usr/bin/true', [], { stdio: 'ignore' });
  child.on('error', reject);
  child.on('exit', () => resolve(performance.now() - t0));
});

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-sandbox-bench-')));
const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 172_800_000 } } } });
try {
  const supervised = [];
  const direct = [];
  for (let i = 0; i < ROUNDS; i++) {
    const run = `run:BENCH${String(i).padStart(4, '0')}`;
    const cwd = join(dir, String(i));
    mkdirSync(cwd);
    const t0 = performance.now();
    const started = await sup.start({ run, cwd, argv: ['/usr/bin/true'] });
    if (started.status !== 'started') throw Error(`${run} didn't start: ${JSON.stringify(started)}`);
    await sup.wait(run);
    supervised.push(performance.now() - t0);
    await sup.cleanup(run);
    direct.push(await bare());
  }
  const readings = { supervisedMs: median(supervised), bareMs: median(direct) };
  console.log(JSON.stringify({ ...readings, overheadMs: readings.supervisedMs - readings.bareMs }));
} finally {
  await sup.close();
  await record.close();
  rmSync(dir, { recursive: true, force: true });
}
