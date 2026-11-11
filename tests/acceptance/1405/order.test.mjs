// #1405 acceptance: which side `measure` runs first in each round, seen from what it runs. Each side's
// command appends its own name to one log as it starts, so the log is the order the runs began in.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { benchmark, macOnly, scratch } from './helpers.mjs';

test('over 20 rounds each side runs first 10 times', { timeout: 900_000 }, async (t) => {
  macOnly();
  const { measure } = await benchmark('measure');
  const directory = scratch();
  const logs = (side) => ['/bin/sh', '-c', `echo ${side} >> order.log`];
  measure(logs('current'), directory, { command: logs('base'), cwd: directory });
  const runs = readFileSync(join(directory, 'order.log'), 'utf8').split('\n').filter(Boolean);
  t.diagnostic(`runs in order: ${runs.join(' ')}`);
  assert.ok(runs.length >= 40, `20 measured rounds of two runs: ${runs.join(' ')}`);
  // The measured rounds are the last 20; any warm-up comes before them.
  const rounds = Array.from({ length: 20 }, (_, round) => runs.slice(runs.length - 40 + 2 * round, runs.length - 38 + 2 * round));
  for (const [round, sides] of rounds.entries()) assert.deepEqual([...sides].sort(), ['base', 'current'], `round ${round} runs each side once: ${sides.join(' ')}`);
  const first = { current: 0, base: 0 };
  for (const [side] of rounds) first[side]++;
  assert.deepEqual(first, { current: 10, base: 10 }, `which side ran first, round by round: ${rounds.map(([side]) => side).join(' ')}`);
});
