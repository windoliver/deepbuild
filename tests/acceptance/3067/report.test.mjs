// #3067.eebd7d07, its first sentence: `load --report` over a fixture log prints the share of minutes above the cores
// and the shares by class, summing to 100% with `outside`. A fixture is copied to `load.log` in the test's own table
// folder; the lines asserted are the ones section 6 states (README: The surface).
import assert from 'node:assert/strict';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CLASSES, load, running, sandbox, until } from './helpers.mjs';

/** `load --report` over `fixture`: what it printed, by line. */
async function report(t, fixture) {
  const box = sandbox(t);
  copyFileSync(new URL(`fixtures/${fixture}`, import.meta.url), join(box.table, 'load.log'));
  const run = load(box, ['--report']);
  let out = '';
  run.stdout.on('data', (chunk) => { out += chunk; });
  await until(() => !running(run), 30_000);
  assert.ok(!running(run), `load --report was still running after 30 s\n${run.output()}`);
  await run.done;
  return { out, lines: out.split('\n').map((line) => line.trimEnd()) };
}
/** The share lines: `<name> <p>%`, with what follows on the line, for a class or `outside`. */
const shares = (lines) => lines.map((line) => line.match(/^(\S+) (\d+\.\d)%(.*)$/)).filter((found) => found && [...CLASSES, 'outside'].includes(found[1]))
  .map(([, name, share, rest]) => ({ name, share, rest }));

test('#3067.eebd7d07 load --report over a fixture log prints the share of minutes above the cores, then one line a class and one for outside over the minutes above that were read, adding up to 100.0, and the count of failed samples', { timeout: 60_000 }, async (t) => {
  const { out, lines } = await report(t, 'above.log');
  // 8 samples: 6 at a load over the cores (3 of them failed), one at a load equal to the cores and one below.
  assert.match(out, /^75(\.0+)?% of minutes above the cores \(6 of 8\)/m, `the share of minutes above the cores\n${out}`);
  const printed = shares(lines);
  // Over the 3 read above: test 2 + 1 (two grants in one minute, none in the others), build 0.5 + 1, outside
  // 2.5 + 3 + 2, of 12 in all. The 2 minutes not above hold test 9 and build 6, and would make it test 42.1%.
  assert.deepEqual(printed.map(({ name, share }) => `${name} ${share}%`).sort(), ['build 12.5%', 'outside 62.5%', 'test 25.0%'], `one line a class that held a grant and one for outside, each a share of the mean of all\n${out}`);
  assert.equal(printed.reduce((sum, { share }) => sum + Math.round(10 * Number(share)), 0), 1000, `the shares add up to 100.0\n${out}`);
  for (const { name, rest } of printed) if (name !== 'outside') assert.equal(rest.trim(), '', `the ${name} line is "<name> <p>%"\n${out}`);
  // outside's line goes on with its own three shares: compile 1.5, node 3.6 and other 2.4 of outside's 7.5, as
  // shares of all (12.5, 30.0, 20.0) or of outside (20.0, 48.0, 32.0); section 6 doesn't say which, or in what form.
  const { rest } = printed.find(({ name }) => name === 'outside');
  for (const name of ['compile', 'node', 'other']) assert.ok(rest.includes(name), `outside's line names its ${name} share\n${out}`);
  const numbers = [...rest.matchAll(/\d+(?:\.\d+)?/g)].map(([number]) => Number(number)).sort((a, b) => a - b);
  assert.ok([[12.5, 20, 30], [20, 32, 48]].some((expected) => expected.length === numbers.length && expected.every((value, k) => Math.abs(value - numbers[k]) < 0.051)),
    `outside's line goes on with its three shares, 12.5, 30.0 and 20.0 of all or 20.0, 48.0 and 32.0 of outside; it has ${JSON.stringify(numbers)}\n${out}`);
  // It names the count of failed samples: 3, all of them above the cores.
  assert.ok(lines.some((line) => /fail/i.test(line) && /(^|[^\d.])3([^\d.]|$)/.test(line)), `it names the count of failed samples, 3\n${out}`);
});

test('#3067.eebd7d07 load --report\'s shares add up to 100.0 where each is a third: no 33.3% three times', { timeout: 60_000 }, async (t) => {
  const { out, lines } = await report(t, 'thirds.log');
  assert.match(out, /^100(\.0+)?% of minutes above the cores \(1 of 1\)/m, `the share of minutes above the cores\n${out}`);
  const printed = shares(lines);
  assert.deepEqual(printed.map(({ name }) => name).sort(), ['build', 'outside', 'test'], `one line a class that held a grant and one for outside\n${out}`);
  for (const { name, share } of printed) assert.ok(['33.3', '33.4'].includes(share), `${name}'s share is a third to one decimal, not ${share}\n${out}`);
  assert.equal(printed.reduce((sum, { share }) => sum + Math.round(10 * Number(share)), 0), 1000, `the shares add up to 100.0\n${out}`);
});

test('#3067.eebd7d07 load --report over a log with no minute above the cores prints that share and no shares by class', { timeout: 60_000 }, async (t) => {
  const { out, lines } = await report(t, 'calm.log');
  // A load equal to the cores isn't above them.
  assert.match(out, /^0(\.0+)?% of minutes above the cores \(0 of 3\)/m, `the share of minutes above the cores\n${out}`);
  assert.deepEqual(shares(lines), [], `no shares with no sample above the cores\n${out}`);
  assert.ok(!lines.some((line) => new RegExp(`^(${[...CLASSES, 'outside'].join('|')})\\b`).test(line)), `no line for a class or outside\n${out}`);
});
