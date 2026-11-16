// #1830 AC3: #568's redrafted judge suite passes on any machine, and fails on a planted judgeLimit that ignores loads.
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, renameSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { root, scratch, show, twins } from './helpers.ts';

const REDRAFT = 'tests/acceptance/568-redraft-1830/';
const FILE = `${REDRAFT}judge.test.mjs`;

/** `node --test` on one file, with node's TAP summary read back. */
function nodeTest(cwd: string, env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', FILE], { cwd, env, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  const count = (name: string): number => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(result.stdout)?.[1] ?? Number.NaN);
  return { result, pass: count('pass'), fail: count('fail'), skipped: count('skipped'), todo: count('todo'), cancelled: count('cancelled'), output: show(result) };
}

function passes(run: ReturnType<typeof nodeTest>, where: string): void {
  expect(run.fail, `no test fails ${where}:\n${run.output}`).toBe(0);
  expect(run.cancelled, `no test is cancelled ${where}:\n${run.output}`).toBe(0);
  expect(run.skipped + run.todo, `no test is skipped ${where}:\n${run.output}`).toBe(0);
  expect(run.pass, `the suite's tests pass ${where}:\n${run.output}`).toBeGreaterThan(0);
  expect(run.result.status, run.output).toBe(0);
}

/** A scratch checkout holding a copy of the redraft folder, with `twin` as scripts/benchmark.mjs beside the real module. */
function beside(twin: string): string {
  const at = scratch();
  cpSync(join(root, 'scripts'), join(at, 'scripts'), { recursive: true });
  renameSync(join(at, 'scripts/benchmark.mjs'), join(at, 'scripts/benchmark.real.mjs'));
  copyFileSync(join(twins, 'judge', twin), join(at, 'scripts/benchmark.mjs'));
  cpSync(join(root, REDRAFT), join(at, REDRAFT), { recursive: true });
  return at;
}

test('AC3 #1830.7a035631 #568\'s redrafted judge suite passes on this machine, loaded or not, and on planted machines of 2 cores at load 300 and 256 cores at load 0.1', () => {
  expect(existsSync(join(root, FILE)), `${FILE} is missing: #568's judge suite has no blind redraft`).toBe(true);
  passes(nodeTest(root), `on this machine (${availableParallelism()} cores, load ${loadavg()[0]})`);
  for (const [cores, load] of [[2, 300], [256, 0.1]] as const) {
    const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(join(twins, 'machine.mjs')).href}`.trim(), PLANT_CORES: String(cores), PLANT_LOAD: String(load) };
    passes(nodeTest(root, env), `on a planted machine of ${cores} cores at load ${load}`);
  }
});

test('AC3 #1830.7a035631 a copy of #568\'s redrafted judge suite passes beside the real judgeLimit and fails beside a planted judgeLimit that ignores loads', () => {
  expect(existsSync(join(root, FILE)), `${FILE} is missing: #568's judge suite has no blind redraft`).toBe(true);
  passes(nodeTest(beside('honest.mjs')), 'in a scratch checkout beside the real scripts/benchmark.mjs');
  const wrong = nodeTest(beside('ignores-loads.mjs'));
  expect(wrong.fail, `beside a judgeLimit that ignores loads, a test fails:\n${wrong.output}`).toBeGreaterThan(0);
  expect(wrong.result.status, wrong.output).not.toBe(0);
});
