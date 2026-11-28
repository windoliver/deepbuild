// #3502, fifth criterion: #3441's tick lists are played through the new pin's cap with no patch of ours for it, and
// the counts are recorded; under the thermal cap, 600 ticks exactly 1/60 s apart present more than 300 frames; the
// merge base presents 300 and fails, naming the count (README: The cap).
//
// The cap played is the tree's own: its rule is taken as text from vendor/gpui-pre, built by rustc into a small
// program and fed each list's tick times (cap.mjs). Run on the merge base, this same test plays the merge base's
// rule and fails on its 300, naming it.
// Run: node --test tests/acceptance/3502/cap.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EVIDENCE, read, REPO, treeVersion } from './common.mjs';
import { judgeUnpatched, listName, LISTS, play, treeRule } from './cap.mjs';

/** Where the counts are kept for #3441 (README: The records). */
const COUNTS = `${EVIDENCE}/cap-counts.json`;
const BOUND = 300;
const FIRST = LISTS.findIndex(({ cap, hz, ticks, jitter_us: jitter }) => cap === 'thermal' && hz === 60 && ticks === 600 && !jitter);

/** The recorded counts against the ones just played: each list recorded, with the count this run counted. */
function recordProblems(counts, release) {
  const text = read(REPO, COUNTS);
  if (text === null) return [`the counts aren't recorded: no ${COUNTS}`];
  let record;
  try { record = JSON.parse(text); } catch { return [`${COUNTS} is no JSON`]; }
  const problems = record?.release === release ? [] : [`${COUNTS} records the counts of gpui-pre ${record?.release ?? 'no release'}, and the tree is ${release}`];
  for (const [index, list] of LISTS.entries()) {
    const entry = (Array.isArray(record?.lists) ? record.lists : []).find((each) => ['cap', 'hz', 'ticks', 'jitter_us', 'seed'].every((key) => each?.[key] === list[key]));
    if (!entry) problems.push(`${COUNTS} records no count for the list: ${listName(list)}`);
    else if (entry.presented !== counts[index]) problems.push(`${COUNTS} records ${entry.presented} presented for the list ${listName(list)}, and the pin's cap presents ${counts[index]}`);
  }
  return problems;
}

test('AC5 #3502.0a92cc25 #3441\'s tick lists, played through the pin\'s own cap with no patch of ours for it: under the thermal cap 600 ticks exactly 1/60 s apart present more than 300 frames, and the counts are recorded', { timeout: 600_000 }, () => {
  const { rule, edition } = treeRule();
  assert.deepEqual(judgeUnpatched(), [], "the cap's rule in vendor/gpui-pre is the pinned release's, line for line");
  const counts = play(rule, LISTS, edition);
  const release = treeVersion(REPO, 'gpui-pre');
  console.log(`the cap of gpui-pre ${release}, as ${rule.shape}:\n${LISTS.map((list, index) => `  ${listName(list)}: ${counts[index]} presented`).join('\n')}`);
  assert.ok(counts[FIRST] > BOUND, `under the thermal cap, ${listName(LISTS[FIRST])} presented ${counts[FIRST]} frames, not more than ${BOUND} (the rule played is the ${rule.shape} vendor/gpui-pre ${release} holds)`);
  assert.deepEqual(recordProblems(counts, release), []);
});
