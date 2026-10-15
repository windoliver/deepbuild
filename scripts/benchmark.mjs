import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

export function measureOnce(command, cwd) {
  if (!['darwin', 'linux'].includes(process.platform)) throw Error('BLOCKED: native peak RSS requires macOS or Linux');
  const flags = process.platform === 'darwin' ? ['-l'] : ['-f', 'peak_rss_kb=%M'];
  const directory = mkdtempSync(join(tmpdir(), 'deep-benchmark-time-'));
  const timing = join(directory, 'time');
  try {
    const started = performance.now();
    const result = spawnSync('/usr/bin/time', [...flags, '-o', timing, ...command], { cwd, encoding: 'utf8', timeout: 300_000, maxBuffer: 32 * 1024 * 1024 });
    const elapsedMs = performance.now() - started;
    if (result.error) throw result.error;
    const peakBytes = parsePeakRss(readFileSync(timing, 'utf8'), process.platform);
    return { elapsedMs, peakBytes, status: result.status, output: result.stdout + result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function measure(command, cwd) {
  const samples = [];
  for (let index = 0; index < 6; index++) {
    const result = measureOnce(command, cwd);
    if (result.status !== 0) throw Error(`${command[0]} exited ${result.status}: ${result.output}`);
    if (index) samples.push({ ms: result.elapsedMs, peakBytes: result.peakBytes }); // One warmup, then five observations.
  }
  return summarize(samples);
}

export function validateBudgets(current, base) {
  if (!Array.isArray(current?.tasks)) throw Error('Missing budget tasks');
  if (base?.preflight && !isDeepStrictEqual(current.preflight, base.preflight)) throw Error('Budget preflight changed or disappeared; restore its frozen definition');
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
    for (const limits of [task.limits, ...(task.previousLimits ? [task.previousLimits] : [])]) {
      const allowed = task.id === 'preflight' ? ['elapsedMs', 'peakBytes'] : metrics;
      if (!limits || Object.entries(limits).some(([key, value]) => !allowed.includes(key) || !Number.isFinite(value) || value <= 0)) throw Error(`${task.id}: invalid limits`);
    }
  }
  if (!ids.size) throw Error('No budget task was measured');
}

export function compare(budget, current, base, keys = metrics) {
  for (const metric of keys) {
    if (!Number.isFinite(current[metric]) || current[metric] <= 0) throw Error(`${budget.id}: missing ${metric}`);
    if (budget.limits[metric] !== undefined && current[metric] >= budget.limits[metric]) throw Error(`${budget.id}: ${metric} ${current[metric]} reached cap ${budget.limits[metric]}`);
    if (base && (!Number.isFinite(base[metric]) || base[metric] <= 0)) throw Error(`${budget.id}: missing base ${metric}`);
    if (base && current[metric] > base[metric] * (1 + budget.margin)) throw Error(`${budget.id}: ${metric} ${current[metric]} regressed beyond base ${base[metric]} + ${budget.margin * 100}%`);
  }
  return base ? { status: 'PASS' } : { status: 'INITIAL', reason: budget.initialReason };
}
