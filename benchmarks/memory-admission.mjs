// What a run used and what the next is admitted on, for the perf lane's budgets (issue #3220): node
// benchmarks/memory-admission.mjs. One process opens a record and the supervisor in a temp folder and runs one sandboxed
// program that holds 64 MiB for 2 s, so every scan of it keeps its peak and CPU, and reads what it used; then keeps
// 10,000 keys' clean peaks and decides 1,000 admissions of a key with three clean runs, printing the median time of one.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { openAsks } from '../packages/asks/dist/index.js';
import { admitOn, CLASS_MB, KeyHistory } from '../packages/hub/dist/admission.js';
import { contents, keyId } from '../packages/hub/dist/shared-runs.js';
import { openRecord } from '../packages/record/dist/index.js';
import { openSupervisor } from '../packages/supervisor/dist/index.js';

const KEYS = 10_000;
const DECISIONS = 1000;
const root = mkdtempSync(join(tmpdir(), 'deep-admission-bench-'));
try {
  // A run's scans keep its peak: one sandboxed program holding 64 MiB for 2 s.
  const record = await openRecord({ path: join(root, 'record.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * 86_400_000 } } } });
  const work = join(root, 'run');
  const run = 'run:BENCH3220';
  try {
    const hold = 'const b = Buffer.alloc(64 << 20, 1); setTimeout(() => console.log(b.length), 2000)';
    writeFileSync(join(root, 'hold.cjs'), hold);
    mkdirSync(work);
    const started = await sup.start({ run, argv: [process.execPath, join(root, 'hold.cjs')], cwd: work, grant: { read: [dirname(dirname(process.execPath)), root], write: [work] } });
    if (started.status !== 'started') throw Error(`the program didn't start: ${JSON.stringify(started)}`);
    await sup.wait(run);
    await sup.cleanup(run);
    const used = sup.used(run);
    if (!(used?.memory_peak_mb >= 64) || !(used?.cpu_s > 0)) throw Error(`its scans keep its peak and CPU: ${JSON.stringify(used)}`);
    console.log(`a run holding 64 MiB recorded a peak of ${used.memory_peak_mb} MB and ${used.cpu_s} CPU s`);
  } finally {
    await sup.close();
    await record.close();
  }

  // Deciding one admission with 10,000 keys kept: a check's key in a checkout of two files, with three clean runs.
  const dir = join(root, 'checkout');
  mkdirSync(join(dir, 'test'), { recursive: true });
  writeFileSync(join(dir, 'test/alloc.mjs'), 'export {};\n');
  writeFileSync(join(dir, 'test/alloc.json'), '{"mib": 480}\n');
  const paths = ['test/alloc.json', 'test/alloc.mjs'];
  const history = new KeyHistory();
  for (let n = 0; n < KEYS - 1; n++) history.add(`check-${n % 100}`, { id: `key-${n}`, stem: `stem-${n % 500}`, paths }, 500 + (n % 200));
  const id = keyId('stem-target', paths, await contents(dir, paths));
  for (const peak of [580, 600, 610]) history.add('alloc', { id, stem: 'stem-target', paths }, peak);
  const times = [];
  for (let n = 0; n < DECISIONS; n++) {
    const t0 = performance.now();
    const { peaks } = await history.of('alloc', 'stem-target', dir);
    const admitted = admitOn(peaks, 900, CLASS_MB.check);
    times.push(performance.now() - t0);
    if (admitted.mb !== 610 || admitted.on !== 'runs') throw Error(`a key with three clean runs is admitted on their 95th percentile: ${JSON.stringify(admitted)}`);
  }
  times.sort((a, b) => a - b);
  console.log(`one admission with ${KEYS} keys kept: median ${times[DECISIONS / 2].toFixed(3)} ms, p95 ${times[Math.floor(DECISIONS * 0.95)].toFixed(3)} ms (target under 1 ms on the reference Mac)`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
