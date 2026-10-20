import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const metrics = ['p50Ms', 'p95Ms', 'peakBytes'];

export function summarize(samples) {
  if (!samples.length || samples.some(({ ms, peakBytes }) => !Number.isFinite(ms) || ms < 0 || !Number.isSafeInteger(peakBytes) || peakBytes <= 0))
    throw Error('Invalid or missing benchmark samples');
  const times = samples.map(({ ms }) => ms).sort((a, b) => a - b);
  return { p50Ms: times[Math.ceil(times.length * 0.5) - 1], p95Ms: times[Math.ceil(times.length * 0.95) - 1], peakBytes: Math.max(...samples.map(({ peakBytes }) => peakBytes)) };
}

export function parsePeakRss(output, platform) {
  const pattern = platform === 'darwin' ? /^\s*(\d+)\s+maximum resident set size\s*$/m : /^peak_rss_kb=(\d+)$/m;
  const bytes = Number(output.match(pattern)?.[1]) * (platform === 'darwin' ? 1 : 1024);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw Error('Missing or invalid native peak RSS');
  return bytes;
}

// User plus system CPU seconds of the command and every child it waited for, in ms.
export function parseCpuMs(output, platform) {
  const match = platform === 'darwin' ? output.match(/^\s*[\d.]+ real\s+([\d.]+) user\s+([\d.]+) sys\s*$/m) : output.match(/^cpu_s=([\d.]+) ([\d.]+)$/m);
  const ms = Math.round((Number(match?.[1]) + Number(match?.[2])) * 1000);
  if (!Number.isSafeInteger(ms) || ms < 0) throw Error('Missing or invalid CPU time');
  return ms;
}

// stream shows the command's output as it runs instead of capturing it.
export function measureOnce(command, cwd, stream = false) {
  if (!['darwin', 'linux'].includes(process.platform)) throw Error('BLOCKED: native peak RSS requires macOS or Linux');
  const flags = process.platform === 'darwin' ? ['-l'] : ['-f', 'peak_rss_kb=%M\ncpu_s=%U %S'];
  const directory = mkdtempSync(join(tmpdir(), 'deep-benchmark-time-'));
  const timing = join(directory, 'time');
  try {
    const started = performance.now();
    const result = spawnSync('/usr/bin/time', [...flags, '-o', timing, ...command], stream
      ? { cwd, stdio: ['ignore', 'inherit', 'inherit'] }
      : { cwd, encoding: 'utf8', timeout: 300_000, maxBuffer: 32 * 1024 * 1024 });
    const elapsedMs = performance.now() - started;
    if (result.error) throw result.error;
    const report = readFileSync(timing, 'utf8');
    const peakBytes = parsePeakRss(report, process.platform);
    return { elapsedMs, cpuMs: parseCpuMs(report, process.platform), peakBytes, status: result.status, output: stream ? '' : result.stdout + result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// Alternates current and merge-base runs so both see the same machine load: one warmup round, then 20 rounds.
// Returns [current] or [current, base].
export function measure(command, cwd, base) {
  const sides = base ? [[command, cwd], [base.command, base.cwd]] : [[command, cwd]];
  const samples = sides.map(() => []);
  for (let round = 0; round <= 20; round++) {
    sides.forEach(([argv, directory], side) => {
      const result = measureOnce(argv, directory);
      if (result.status !== 0) throw Error(`${argv[0]} exited ${result.status}: ${result.output}`);
      if (round) samples[side].push({ ms: result.elapsedMs, peakBytes: result.peakBytes });
    });
  }
  return samples.map(summarize);
}

// Builds unmeasured, so a checkout and its merge base are both timed warm. The check lanes run
// the same builds and report their errors, so a failure here is left for them.
export function warm(cwd) {
  const steps = [['npm', 'run', 'build'], ['cargo', 'test', '--workspace', '--locked', '--no-run']];
  // The #56 spike keeps its dependencies apart from the root's, and its benches are perf tasks.
  if (existsSync(join(cwd, 'spikes/hub-core/package-lock.json'))) steps.unshift(['npm', 'ci', '--prefix', 'spikes/hub-core', '--no-audit', '--no-fund']);
  for (const [command, ...args] of steps) spawnSync(command, args, { cwd, stdio: 'ignore' });
}

export function validateBudgets(current, base) {
  if (!Array.isArray(current?.tasks)) throw Error('Missing budget tasks');
  if (base?.preflight && !isDeepStrictEqual(current.preflight, base.preflight)) throw Error('Budget preflight changed or disappeared; restore its frozen definition');
  if (base?.harness && !isDeepStrictEqual(current.harness, base.harness)) throw Error('Budget harness changed or disappeared; restore its frozen definition');
  for (const established of base?.tasks ?? []) {
    if (!isDeepStrictEqual(current.tasks.find(({ id }) => id === established.id), established))
      throw Error(`Budget ${established.id} changed or disappeared; restore its frozen definition`);
  }
  const ids = new Set();
  for (const task of [...current.tasks, ...(current.preflight ? [{ id: 'preflight', ...current.preflight }] : [])]) {
    if (!task.id || ids.has(task.id)) throw Error('Missing or duplicate budget id');
    ids.add(task.id);
    if (task.id !== 'preflight' && (!Array.isArray(task.command) || !task.command.length || task.command.some((part) => typeof part !== 'string' || !part))) throw Error(`${task.id}: invalid command`);
    if (!Number.isFinite(task.margin) || task.margin < 0) throw Error(`${task.id}: invalid margin`);
    if (typeof task.initialReason !== 'string' || !task.initialReason.trim()) throw Error(`${task.id}: first measurement requires a reason`);
    const allowed = task.id === 'preflight' ? ['elapsedMs', 'peakBytes'] : metrics;
    if (!task.limits || Object.entries(task.limits).some(([key, value]) => !allowed.includes(key) || !Number.isFinite(value) || value <= 0)) throw Error(`${task.id}: invalid limits`);
  }
  if (!ids.size) throw Error('No budget task was measured');
}

// p95 has only absolute caps: between identical binaries on a shared machine, the tail of 20
// interleaved samples still moves past a 50% margin in a few runs out of a hundred, and p50 does not.
export function compare(budget, current, base, keys = metrics) {
  for (const metric of keys) {
    if (!Number.isFinite(current[metric]) || current[metric] <= 0) throw Error(`${budget.id}: missing ${metric}`);
    if (budget.limits[metric] !== undefined && current[metric] >= budget.limits[metric]) throw Error(`${budget.id}: ${metric} ${current[metric]} reached cap ${budget.limits[metric]}`);
    if (base && (!Number.isFinite(base[metric]) || base[metric] <= 0)) throw Error(`${budget.id}: missing base ${metric}`);
    if (base && metric !== 'p95Ms' && current[metric] > base[metric] * (1 + budget.margin)) throw Error(`${budget.id}: ${metric} ${current[metric]} regressed beyond base ${base[metric]} + ${budget.margin * 100}%`);
  }
  return base ? { status: 'PASS' } : { status: 'INITIAL', reason: budget.initialReason };
}
