// Shared by the #1405 acceptance tests. The code is reached only through what the issue names:
// `judgeInstructions` and `measure` exported by scripts/benchmark.mjs (README: Surfaces).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const benchmarkUrl = pathToFileURL(join(root, 'scripts/benchmark.mjs')).href;

// The exports, imported per test so a base without one fails each test by name.
export async function benchmark(...names) {
  const module = await import(benchmarkUrl);
  for (const name of names) assert.equal(typeof module[name], 'function', `scripts/benchmark.mjs exports no ${name}()`);
  return module;
}

// The seed the fixture tests pass: any fixed number; the README fixes none.
export const SEED = 1405;
export const THRESHOLD = 0.01;

// Twenty merge-base counts, one per round, each a multiple of 50 so that 2% of it is a whole count.
export const BASES = Array.from({ length: 20 }, (_, round) => 1_000_000_000 + round * 7_900);
// Pairs whose differences (current / base - 1) are `rises`, one per round, rounded to whole counts.
export const pairsAt = (rises) => rises.map((rise, round) => ({ current: Math.round(BASES[round] * (1 + rise)), base: BASES[round] }));

// What judgeInstructions(pairs, [], seed) reads, with the pairs handed over as a copy.
export async function judged(pairs, seed = SEED) {
  const { judgeInstructions } = await benchmark('judgeInstructions');
  return judgeInstructions(structuredClone(pairs), [], seed);
}
export const shown = (result) => JSON.stringify({ ...result, pairs: undefined });

// The two p values the result carries, each a probability (README: Surfaces).
export function pValues(result) {
  for (const field of ['pAbove', 'pBelow']) {
    assert.ok(typeof result?.[field] === 'number' && result[field] >= 0 && result[field] <= 1, `the result carries ${field}, a p value: ${shown(result)}`);
  }
  return { pAbove: result.pAbove, pBelow: result.pBelow };
}

export function macOnly() {
  if (process.platform !== 'darwin') assert.fail('BLOCKED: instructions retired are read from macOS\'s /usr/bin/time -l');
}

// A scratch directory removed after the file's last test.
const cleanups = [];
after(() => { for (const directory of cleanups) rmSync(directory, { recursive: true, force: true }); });
export function scratch(prefix = 'deep-perf-1405-') {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanups.push(directory);
  return directory;
}

// The planted two-thread spin bench, built by cc into `directory`.
export function buildHandoff(directory) {
  const binary = join(directory, 'handoff');
  execFileSync('cc', ['-O2', '-Wall', '-Werror', '-o', binary, fileURLToPath(new URL('fixtures/handoff.c', import.meta.url))], { stdio: 'pipe' });
  return binary;
}
// The bench's size: 200 handoffs of 100,000 spins a turn, 0.1 to 1.5 s a run at load 280 to 310 on this
// Mac's 18 cores, where 12 runs spread 948 M to 3,834 M instructions (README: How the tests plant).
export const HANDOFFS = 200;
export const WORK = 100_000;

// The 1-minute load average against the cores.
export const conditions = () => ({ load: loadavg()[0], cores: availableParallelism() });
// After a test's assertions pass: a run whose load wasn't above the cores before and after it is a
// reading, not proof of a criterion stated at that load, so the test is skipped as INCONCLUSIVE with what it saw.
export function loadedAboveCores(t, before, after) {
  const seen = `load average ${before.load.toFixed(1)} before and ${after.load.toFixed(1)} after, on ${before.cores} cores`;
  t.diagnostic(seen);
  if (!(before.load > before.cores && after.load > after.cores)) t.skip(`INCONCLUSIVE: the criterion is stated at a load above the cores; this run saw ${seen}`);
}

// measure's two sides as judgeInstructions takes them: one pair per measured round, in round order.
export function roundPairs(now, then) {
  assert.ok(Array.isArray(now?.instructions) && Array.isArray(then?.instructions), `measure returns each side's counts per round: ${JSON.stringify([now, then])}`);
  assert.equal(now.instructions.length, 20, `20 measured rounds: ${JSON.stringify(now.instructions)}`);
  assert.equal(then.instructions.length, 20, `20 measured rounds: ${JSON.stringify(then.instructions)}`);
  const pairs = now.instructions.map((current, round) => ({ current, base: then.instructions[round] }));
  for (const [round, pair] of pairs.entries()) {
    for (const side of ['current', 'base']) assert.ok(Number.isSafeInteger(pair[side]) && pair[side] > 0, `round ${round}: ${side} is ${JSON.stringify(pair[side])}, not a count`);
  }
  return { pairs, uncounted: [...new Set([...(now.uncounted ?? []), ...(then.uncounted ?? [])])] };
}
export const spreadOf = (pairs) => {
  const differences = pairs.map(({ current, base }) => current / base - 1);
  return Math.max(...differences) - Math.min(...differences);
};
export const percent = (fraction) => `${(fraction * 100).toFixed(1)}%`;
