// #594 acceptance, criterion 1, which only the reference Mac and the #337 branch's dependency tree
// can prove: a second preflight finishes in under 5 minutes, perf included. Run it by hand on the
// reference Mac, in a checkout of spike/337-gpui-decision with the #594 fix merged in:
//   DEEP_594_CHECKOUT=<that checkout> node --test tests/acceptance/594/reference.live.test.mjs
// It runs that checkout's preflight twice: the first fills the build directories, the second is
// judged. Off the reference Mac, without the variable, or in a checkout without the #337 tree, it
// fails with BLOCKED in its message; nothing skips.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fingerprint } from '../../../scripts/benchmark.mjs';

const reference = { model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30, power: 'ac', lowPowerMode: false, thermalState: 'nominal' };

test('criterion 1: with the #337 branch\'s dependency tree, a second preflight on the reference Mac finishes in under 5 minutes, perf included', () => {
  const machine = fingerprint();
  const off = Object.entries(reference).filter(([key, value]) => machine[key] !== value).map(([key, value]) => `${key} is ${JSON.stringify(machine[key])}, not ${JSON.stringify(value)}`);
  if (off.length || !machine.macosBuild) assert.fail(`BLOCKED: not the reference Mac (Mac15,7, M3 Pro, 36 GB, mains power, Low Power Mode off, thermal state nominal): ${[...off, ...machine.macosBuild ? [] : ['the macOS build is missing']].join('; ')}`);
  const checkout = process.env.DEEP_594_CHECKOUT;
  if (!checkout || !existsSync(join(checkout, 'scripts/preflight.mjs'))) assert.fail('BLOCKED: set DEEP_594_CHECKOUT to a checkout of spike/337-gpui-decision with the #594 fix merged');
  const git = (...args) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8' });
  const base = git('merge-base', 'HEAD', 'origin/main').trim();
  const added = git('diff', base, '--', 'Cargo.lock').split('\n').filter((line) => /^\+name = /.test(line));
  if (!added.some((line) => /gpui/.test(line))) assert.fail(`BLOCKED: ${checkout}'s Cargo.lock adds no gpui package over its merge base, so it is not the #337 dependency tree`);
  const env = { ...process.env };
  delete env.DEEP_594_CHECKOUT;
  const preflight = () => {
    const started = performance.now();
    const result = spawnSync(process.execPath, ['scripts/preflight.mjs'], { cwd: checkout, env, encoding: 'utf8', timeout: 3_600_000, maxBuffer: 512 * 1024 * 1024 });
    return { ...result, ms: performance.now() - started, output: `${result.stdout}${result.stderr}` };
  };
  preflight();
  const second = preflight();
  const tail = second.output.split('\n').slice(-60).join('\n');
  // perf must have run to a verdict: a BLOCKED perf, or none, means the time left perf out.
  assert.match(second.output, /^PASS perf \(/m, `the second preflight's perf did not pass:\n${tail}`);
  const elapsed = Number(second.output.match(/preflight elapsed: ([\d.]+) s/)?.[1]);
  assert.ok(Number.isFinite(elapsed), `the second preflight printed no preflight elapsed time:\n${tail}`);
  assert.ok(elapsed < 300 && second.ms < 300_000, `the second preflight took ${elapsed} s (${(second.ms / 1000).toFixed(1)} s wall), not under 300 s:\n${tail}`);
});
