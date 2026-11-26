// An interim rule of #3590 (the owner's coordinator, 2026-11-26), not one of its criteria: a claim made by the command
// of `node scripts/throttle.mjs build -- <command>`, so nested in a build grant, keeps today's bounded wait: its
// bay-pair grant is logged with wait: 30 and no stall. The table, bays and HOME are the sandbox's (3590/helpers.mjs).
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { start } from './acceptance/3334/helpers.mjs';
import { fixture, PAIRS, show, showLog, tableLog, within } from './acceptance/3590/helpers.mjs';

// The claim, as helpers.mjs's `claim` makes it, but run as a command of the throttle's build class: claimPair from the
// fixture's own bays.mjs with its cwd as the root, printing one `CLAIM <json>` line, which also names the grant its
// process inherited (DEEP_THROTTLE, read before the claim). A pair is closed again at once.
const CLAIM = `const [script] = process.argv.slice(1);
const throttle = process.env.DEEP_THROTTLE ?? null;
const { claimPair } = await import(script);
const pair = claimPair(process.cwd(), (line) => console.log(line));
const isPair = pair !== null && typeof pair === 'object' && typeof pair.close === 'function';
console.log('CLAIM ' + JSON.stringify({ pid: process.pid, throttle, pair: isPair, index: isPair ? pair.index : null, refused: pair?.refused ?? null, blocked: pair?.blocked ?? null }));
if (isPair) pair.close();
`;

test('a bay-pair claim nested in a build grant keeps a 30-minute wait (interim, #3590): run as the command of throttle.mjs build on a free table with DEEP_TEST_GRANT_STALL unset, it returns a pair and its grant is logged with wait: 30 and no stall', { timeout: 300_000 }, async (t) => {
  const { box, repo } = fixture(t);
  const throttle = join(repo.worktree, 'scripts', 'throttle.mjs');
  const run = start(box, [process.execPath, throttle, 'build', '--', process.execPath, '--input-type=module', '-e', CLAIM, pathToFileURL(repo.bays).href], { cwd: repo.worktree });
  const result = await within(run.done, 3);
  assert.ok(result, `throttle.mjs build with the claim as its command had not ended after 3 min on a free table\n${run.output()}\n${showLog(box)}`);
  const line = String(result.stdout).split('\n').find((text) => text.startsWith('CLAIM '));
  let seen = null;
  try { seen = line ? JSON.parse(line.slice('CLAIM '.length)) : null; } catch {}
  assert.ok(seen, `the claim printed no CLAIM line\n${show(result)}\n${showLog(box)}`);
  assert.equal(result.status, 0, `throttle.mjs build exited ${result.status}\n${show(result)}`);
  // The claim ran nested in the build grant throttle.mjs took on the test's own table.
  const log = tableLog(box);
  const build = log.filter((entry) => entry.event === 'granted' && entry.class === 'build' && entry.pid === run.pid);
  assert.equal(build.length, 1, `the log holds ${build.length} build grants of throttle.mjs (pid ${run.pid}), not 1\n${showLog(box)}`);
  assert.equal(seen.throttle, `build:${build[0].id}`, `the claim's process inherited DEEP_THROTTLE=${seen.throttle}, not the build grant build:${build[0].id}`);
  assert.equal(seen.pair, true, `claimPair returned no pair on a free table under a build grant: ${JSON.stringify(seen)}\n${show(result)}`);
  assert.ok(Number.isInteger(seen.index) && seen.index >= 1 && seen.index <= PAIRS, `the pair's index ${seen.index} is not a grant index 1..${PAIRS}`);
  const granted = log.filter((entry) => entry.event === 'granted' && entry.class === 'bay-pair' && entry.pid === seen.pid);
  assert.equal(granted.length, 1, `the log holds ${granted.length} bay-pair grants of the claim's process (pid ${seen.pid}), not 1\n${showLog(box)}`);
  assert.equal(granted[0].grant, 'nested', `the claim's bay-pair grant is logged ${JSON.stringify(granted[0].grant)}, not nested in the build grant\n${JSON.stringify(granted[0])}`);
  assert.equal(granted[0].wait, 30, `the claim's granted entry carries ${JSON.stringify({ wait: granted[0].wait, stall: granted[0].stall })}, not wait: 30\n${JSON.stringify(granted[0])}`);
  assert.ok(!('stall' in granted[0]), `the claim's granted entry carries stall: ${granted[0].stall} beside its wait\n${JSON.stringify(granted[0])}`);
});
