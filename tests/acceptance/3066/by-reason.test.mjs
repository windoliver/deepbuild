// #3066 AC1, first sentence: every `alone` entry carries one of the three reasons, and `--by-reason` prints counts that
// sum to the list's length. Read on this checkout itself: `node scripts/lanes.mjs alone --by-reason`, and lanes.mjs's
// exported `alone` and `aloneReasons` through lanes-read.mjs (README: The shapes).
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKOUT, LONG, REASONS, byReason, counts, lanesOf } from './helpers.mjs';

// `binary`, `timing`, or `shared` followed by the resource it names.
const reasonIn = (value) => (typeof value === 'string' && (/^(?:binary|timing)\b/.test(value) || /^shared\W+\w/.test(value)) ? value.match(/^\w+/)[0] : null);

test("#3066.08445d81 `node scripts/lanes.mjs alone --by-reason` prints a count for each of binary, timing and shared, the counts sum to the alone list's length, and every alone entry carries one of the three", LONG, () => {
  const { lists, reasons } = lanesOf(CHECKOUT);
  assert.ok(lists.alone?.length > 100, `scripts/lanes.mjs exports no alone list of this repository's size: ${lists.alone?.length}`);

  const run = byReason(CHECKOUT);
  assert.equal(run.status, 0, `\`node scripts/lanes.mjs alone --by-reason\` did not exit 0\n${run.all}`);
  const printed = counts(run.stdout);
  assert.deepEqual(Object.keys(printed).sort(), [...REASONS].sort(), `\`node scripts/lanes.mjs alone --by-reason\` does not print a count line for each of ${REASONS.join(', ')}\n${run.all}`);
  assert.equal(REASONS.reduce((sum, reason) => sum + printed[reason], 0), lists.alone.length, `the counts --by-reason prints (${JSON.stringify(printed)}) do not sum to the alone list's length\n${run.all}`);

  assert.ok(reasons, 'scripts/lanes.mjs exports no aloneReasons, the reason each alone entry carries');
  const held = new Map(reasons);
  const without = lists.alone.filter((entry) => !reasonIn(held.get(entry)));
  assert.deepEqual(without, [], `${without.length} alone entries carry none of ${REASONS.join(', ')} (a shared one names its resource): ${without.slice(0, 20).map((entry) => `${entry} (${JSON.stringify(held.get(entry))})`).join(', ')}`);
  const tally = Object.fromEntries(REASONS.map((reason) => [reason, lists.alone.filter((entry) => reasonIn(held.get(entry)) === reason).length]));
  assert.deepEqual(printed, tally, 'the counts --by-reason prints are not the counts of the reasons the alone entries carry');
});
