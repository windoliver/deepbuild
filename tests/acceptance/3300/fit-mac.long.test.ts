// #3300 criterion 4: "On a fit reference Mac (mains power, Low Power Mode off, thermal state nominal, load under the
// core count), `tests/acceptance/896/` and `tests/acceptance/854/` pass on main once the redraft lands, each test's line
// recorded"
//
// By hand only (scripts/lanes.mjs byHand and timed; README: Criterion 4): hours of release builds, Metal and timed
// runs, on a reference Mac with the machine to itself.
//   NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3300 fit-mac.long.test.ts --testTimeout=0
// Each suite runs as the lanes run it, one file at a time: its folder, the redraft inside it included, with the first
// drafts the lanes run by hand only (scripts/lanes.mjs byHand, set there by `redrafted`) left out. Every test must
// pass: one failed fails, and one skipped ran nothing on this machine, so it is INCONCLUSIVE, never a pass. Each test's
// line (file, full name, status, ms) is printed. Off a fit reference Mac, before or after a suite, the test skips as
// INCONCLUSIVE, naming what is off.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { join, relative } from 'node:path';
import { expect, test, type TestContext } from 'vitest';
import { AC4, lanes, REPO, scratch } from './helpers.ts';

interface Benchmark { fingerprint(): Record<string, unknown>; references: Record<string, unknown>[] }
const { fingerprint, references } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as Benchmark;
const { byHand } = await lanes();

/** What keeps this machine from being a fit reference Mac now, or an empty list. */
function unfit(): string[] {
  const machine = fingerprint();
  const off: string[] = [];
  const hardware = ['model', 'chip', 'memoryBytes'];
  if (!references.some((reference) => hardware.every((key) => machine[key] === reference[key]))) off.push(`not a reference Mac: ${hardware.map((key) => `${key} ${JSON.stringify(machine[key] ?? null)}`).join(', ')}`);
  if (machine['power'] !== 'ac') off.push(`power is ${JSON.stringify(machine['power'] ?? null)}, not mains`);
  if (machine['lowPowerMode'] !== false) off.push(`Low Power Mode is ${JSON.stringify(machine['lowPowerMode'] ?? null)}, not off`);
  if (machine['thermalState'] !== 'nominal') off.push(`thermal state is ${JSON.stringify(machine['thermalState'] ?? null)}, not nominal`);
  const [load] = loadavg(), cores = availableParallelism();
  if (!(load! < cores)) off.push(`load ${load} is not under the ${cores} cores`);
  return off;
}

interface Report { numTotalTests: number; testResults: { name: string; assertionResults: { fullName: string; status: string; duration?: number }[] }[] }

function suite(ctx: TestContext, folder: string): void {
  const before = unfit();
  if (before.length) ctx.skip(`INCONCLUSIVE (not a fit reference Mac before ${folder}): ${before.join('; ')}`);
  const out = join(scratch(), 'report.json');
  const left = byHand.filter((path: string) => path.startsWith(`${folder}/`) && path.endsWith('.ts')).map((path: string) => path.slice(folder.length + 1));
  const args = [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--root', folder, '--no-file-parallelism', ...left.flatMap((path: string) => ['--exclude', path]), '--reporter=json', `--outputFile=${out}`];
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')));
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', env: { ...env, NO_COLOR: '1' }, timeout: 8 * 3_600_000, killSignal: 'SIGKILL', maxBuffer: 1 << 28 });
  rmSync(join(REPO, folder, 'node_modules', '.vite'), { recursive: true, force: true });
  expect(r.error, `vitest ran ${folder}: ${r.error?.message}`).toBeUndefined();
  expect(existsSync(out), `vitest wrote a report for ${folder} (exit ${r.status}): ${String(r.stderr).slice(-2000)}`).toBe(true);
  const report = JSON.parse(readFileSync(out, 'utf8')) as Report;
  const lines = report.testResults.flatMap((file) => file.assertionResults.map((t) => ({ line: `${relative(REPO, file.name)}: ${t.fullName}: ${t.status} ${Math.round(t.duration ?? 0)} ms`, status: t.status })));
  for (const { line } of lines) console.log(`${AC4} ${line}`);
  const after = unfit();
  console.log(`${AC4} ${folder}: ${lines.filter((l) => l.status === 'passed').length} passed of ${lines.length}, the first drafts run by hand left out (${left.join(', ')}); fit after: ${after.length ? after.join('; ') : 'yes'}`);
  expect(lines.filter((l) => l.status === 'failed').map((l) => l.line), `${folder} passes: no test fails`).toEqual([]);
  if (after.length) ctx.skip(`INCONCLUSIVE (not a fit reference Mac after ${folder}): ${after.join('; ')}`);
  expect(lines.filter((l) => l.status !== 'passed').map((l) => l.line), `every test of ${folder} ran and passed; a skipped one ran nothing here`).toEqual([]);
  expect(lines.length, `${folder} has tests`).toBeGreaterThan(0);
  expect(r.status, `${folder}'s run exits 0: ${String(r.stderr).slice(-2000)}`).toBe(0);
}

test(`${AC4} on a fit reference Mac tests/acceptance/896/ passes, the redraft in its first draft's place, each test's line recorded`, (ctx) => suite(ctx, 'tests/acceptance/896'), 10 * 3_600_000);
test(`${AC4} on a fit reference Mac tests/acceptance/854/ passes, the redraft in its first draft's place, each test's line recorded`, (ctx) => suite(ctx, 'tests/acceptance/854'), 10 * 3_600_000);
