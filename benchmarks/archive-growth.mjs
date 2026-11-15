// #2365: measure the added-megabyte pass, not fixture construction or the initial 100 MB copy.
// The perf lane's targets judge one warm-up and five fresh-process samples with the issue's exact limits.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint, judgeLimit } from '../scripts/benchmark.mjs';
import { append, write } from '../tests/acceptance/2365/probe/fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const task = JSON.parse(readFileSync(join(root, 'benchmarks/budgets.json'), 'utf8')).tasks.find((t) => t.id === 'archive-growth');
if (!task?.targets) throw Error('archive-growth has no frozen targets');
if (process.argv[2] === 'judge') {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const report = input.current;
  if (!Array.isArray(report?.runs) || report.runs.length !== 6) {
    console.log(JSON.stringify({ status: 'BLOCKED', reason: 'expected one warm-up and five pass readings' }));
  } else {
    const samples = report.runs.slice(1);
    const targets = {};
    for (const name of ['ms', 'maxGapMs', 'rise']) targets[name] = judgeLimit({ limit: task.targets[name], runs: samples.map((r) => r[name]), fingerprint: report.machine, loads: samples.map((r) => r.load) });
    targets.added = { status: report.runs.every((r) => Number.isSafeInteger(r.added) && r.added >= 0 && r.added < task.targets.added) ? 'PASS' : 'FAIL', runs: report.runs.map((r) => r.added) };
    if (report.runs.some((r) => r.error)) targets.pass = { status: 'FAIL', reason: 'an archive pass left a copy undone' };
    const status = ['FAIL', 'BLOCKED', 'INCONCLUSIVE'].find((s) => Object.values(targets).some((v) => v.status === s)) ?? 'PASS';
    console.log(JSON.stringify({ status, targets, reason: Object.entries(targets).filter(([, v]) => v.status !== 'PASS').map(([k, v]) => `${k}: ${v.reason ?? v.status}`).join('; ') }));
  }
} else {
  const directory = mkdtempSync(join(tmpdir(), 'deep-archive-growth-'));
  const id = '23651000-0000-4000-a000-000000000100';
  const path = (home) => join(home, '.claude/projects/-tmp-dh2365-work-long-session', `${id}.jsonl`);
  const pass = (home, now) => {
    const load = { start: loadavg()[0] };
    const result = spawnSync(process.execPath, ['--expose-gc', join(root, 'tests/acceptance/2365/probe/pass.mjs'), home, 'pass', String(now)], { encoding: 'utf8', timeout: 600_000 });
    load.end = loadavg()[0];
    if (result.status !== 0) throw Error(`archive-growth child failed: ${result.stderr}`);
    const line = result.stdout.split('\n').find((l) => l.includes('"at":"result"'));
    if (!line) throw Error('archive-growth child reported no result');
    const reading = { ...JSON.parse(line), load };
    if (reading.error) throw Error(reading.error);
    return reading;
  };
  try {
    const home = join(directory, 'seed');
    mkdirSync(join(home, '.claude/projects/-tmp-dh2365-work-long-session'), { recursive: true });
    const before = write(path(home), 100_000_000);
    if (before.toolShare < 0.935 || before.toolShare > 0.95 || before.longest < 2_000_000) throw Error('archive-growth fixture differs from the issue');
    pass(home, 1_800_000_000_000);
    append(path(home), 1_000_000);
    const runs = [];
    for (let n = 0; n < 6; n++) {
      const copy = join(directory, `sample-${n}`);
      cpSync(home, copy, { recursive: true });
      runs.push(pass(copy, 1_800_003_600_000));
      rmSync(copy, { recursive: true, force: true });
    }
    console.log(JSON.stringify({ task: task.id, machine: fingerprint(), source: { bytes: before.bytes, toolShare: before.toolShare, longest: before.longest }, fixture: createHash('sha256').update(readFileSync(new URL('../tests/acceptance/2365/probe/fixture.mjs', import.meta.url))).digest('hex'), runs }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
