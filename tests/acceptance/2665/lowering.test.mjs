// #2665: one real scene, as the issue's Proof asks. A fixture repository whose budgets hold six tasks, a commit that
// lowers two peakBytes ceilings, and the commit after it, both measured by one real window (`throttle.mjs window`) on a
// stand-in reference Mac at a quiet load. Each test reads the records the window left. The scene runs once, on the
// first test's turn.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { loop, manifest, marked, recordOf, row, sandbox, SLOW, task, timed, windowOver } from './helpers.mjs';

const box = sandbox({ after });
const LOOP = loop(20_000);
// The tasks with no ceiling: no test reads their rows, so a shorter count does.
const SHORT = loop(2_000);
// A child the count can't follow: /bin/sh is a platform binary, so nothing in it logs the child it waits for.
const UNCOUNTABLE = loop(2_000, '/usr/bin/true; ');
// Far above the instructions /usr/bin/time -l reads for /bin/sh alone (about 140 million here), so a count that leaves the
// child out, or reads 0, passes it.
const UNCOUNTABLE_CEILING = 5_000_000_000;

async function play() {
  // The peak the loop holds, by the test's own reading. Every ceiling below is a multiple of it.
  const peak = Math.max(...timed(box, LOOP).map(({ peakBytes }) => peakBytes));
  const ceilings = {
    // AC1: lowered from 4× to 1/0.88×: within the new one, and 12% under it, which isn't more than 20%.
    held: { old: 4 * peak, new: Math.round(peak / 0.88) },
    // AC3: lowered from 1/0.83× to 1/1.32×: within the old one, and over the new one by more than the 5% margin.
    tight: { old: Math.round(peak / 0.83), new: Math.round(peak / 1.32) },
    // AC6: 75% under its ceiling.
    roomy: 4 * peak,
  };
  const tasks = (held, tight) => manifest([
    task('held', LOOP, { peakBytes: held }),
    task('tight', LOOP, { peakBytes: tight }),
    task('roomy', LOOP, { peakBytes: ceilings.roomy }),
    task('open-a', SHORT, {}),
    task('open-b', SHORT, {}, { criteria: ['#9665.0badc0de'] }),
    task('uncountable', UNCOUNTABLE, { instructions: UNCOUNTABLE_CEILING }),
  ]);
  const repo = await marked(box, { 'benchmarks/budgets.json': tasks(ceilings.held.old, ceilings.tight.old) });
  const lowering = repo.commit({ 'benchmarks/budgets.json': tasks(ceilings.held.new, ceilings.tight.new) }, 'Lower the peakBytes ceilings of held and tight');
  const next = repo.commit({ 'notes.txt': 'Notes no task reads, changed.\n' }, 'Change the notes');
  const run = await windowOver(box, repo);
  return { peak, ceilings, lowering, next, run };
}
let played;
const scene = () => (played ??= play());
const recorded = (s, name) => recordOf(box, s.run, s[name], name === 'lowering' ? 'the commit that lowers two ceilings' : 'the commit after the lowering');
/** A row's verdict on one ceiling, failing at the assertion when the row or the verdict is missing. */
function verdict(record, id, metric) {
  const found = row(record, id);
  assert.ok(found, `the record of ${record.commit} has no row for ${id}: ${JSON.stringify(record.tests)}`);
  assert.ok(found.limits?.[metric], `${id}'s row in the record of ${record.commit} has no verdict on its ${metric} ceiling: ${JSON.stringify(found)}`);
  return found.limits[metric];
}

test('#2665.54342405 a fixture change that lowers an established task\'s peakBytes limit, whose five runs are within the new limit, passes, and its window record names the old limit, the new one and the five readings', SLOW, async () => {
  const s = await scene();
  const { old: before, new: after } = s.ceilings.held;
  const record = recorded(s, 'lowering');
  const held = row(record, 'held');
  assert.ok(held, `the window refused ${s.lowering}, which lowers held's peakBytes limit from ${before} to ${after}: ${record.tests.map(({ id, state, note }) => `${id} ${state}: ${note}`).join('; ')}`);
  assert.equal(held.state, 'PASS', `held didn't pass on ${s.lowering}, which lowers its peakBytes limit from ${before} to ${after}: ${JSON.stringify(held)}`);
  const lowered = (record.lowered ?? []).filter(({ id, metric }) => id === 'held' && metric === 'peakBytes');
  assert.equal(lowered.length, 1, `the record of ${s.lowering} doesn't name held's lowered peakBytes limit once: ${JSON.stringify(record.lowered ?? null)}`);
  const [entry] = lowered;
  assert.equal(entry.old, before, `the record names ${entry.old} as held's old peakBytes limit, not ${before}`);
  assert.equal(entry.new, after, `the record names ${entry.new} as held's new peakBytes limit, not ${after}`);
  assert.ok(Array.isArray(entry.runs) && entry.runs.length === 5, `the record doesn't name the five readings held was judged on: ${JSON.stringify(entry.runs)}`);
  for (const reading of entry.runs) {
    assert.ok(Number.isFinite(reading) && Math.abs(reading - s.peak) <= 0.1 * s.peak, `${reading} isn't a reading of held's command, which peaks near ${s.peak} bytes: ${JSON.stringify(entry.runs)}`);
    assert.ok(reading <= after, `a reading of ${reading} is over held's new limit ${after}, which the fixture's runs stay within: ${JSON.stringify(entry.runs)}`);
  }
});

test('#2665.9583c77c the commit that lowers a ceiling is judged against the old one, and the next commit against the new one', SLOW, async () => {
  const s = await scene();
  const { old: before, new: after } = s.ceilings.tight;
  const lowering = verdict(recorded(s, 'lowering'), 'tight', 'peakBytes');
  assert.equal(lowering.limit, before, `the commit ${s.lowering}, which lowers tight's peakBytes ceiling from ${before} to ${after}, was judged against ${lowering.limit}, not the old one its merge base holds: ${JSON.stringify(lowering)}`);
  assert.equal(lowering.status, 'PASS', `the commit ${s.lowering} read ${lowering.status} on tight's old ceiling ${before}, which its runs are within: ${JSON.stringify(lowering)}`);
  const next = verdict(recorded(s, 'next'), 'tight', 'peakBytes');
  assert.equal(next.limit, after, `the commit ${s.next} after the lowering was judged against ${next.limit}, not tight's new ceiling ${after}: ${JSON.stringify(next)}`);
  assert.equal(next.status, 'FAIL', `the commit ${s.next} read ${next.status} on tight's new ceiling ${after}, which each of its runs is over by more than the 5% margin: ${JSON.stringify(next)}`);
});

test('#2665.5222fad8 a count that can\'t be read is missing, never 0, and its ceiling reads INCONCLUSIVE', SLOW, async () => {
  const s = await scene();
  const record = recorded(s, 'next');
  const ceiling = verdict(record, 'uncountable', 'instructions');
  assert.ok(Array.isArray(ceiling.runs) && ceiling.runs.length >= 5, `uncountable's instructions ceiling names no readings: ${JSON.stringify(ceiling)}`);
  assert.deepEqual(ceiling.runs.filter((reading) => reading !== null), [], `uncountable's command waits for a child no count covers, so each of its counts is missing (null), never 0 or a part: ${JSON.stringify(ceiling)}`);
  assert.equal(ceiling.limit, UNCOUNTABLE_CEILING, `uncountable's instructions ceiling was judged against ${ceiling.limit}: ${JSON.stringify(ceiling)}`);
  assert.equal(ceiling.status, 'INCONCLUSIVE', `uncountable's instructions ceiling read ${ceiling.status} with every count missing: ${JSON.stringify(ceiling)}`);
  assert.notEqual(row(record, 'uncountable').state, 'PASS', `uncountable passed with its count missing: ${JSON.stringify(row(record, 'uncountable'))}`);
});

test('#2665.9afb008a a window\'s record lists each task with no ceiling by name with their count, and each task more than 20% under its ceiling with both numbers', SLOW, async () => {
  const s = await scene();
  const record = recorded(s, 'next');
  const none = record.noCeiling;
  for (const id of ['open-a', 'open-b']) assert.ok(none?.tasks?.includes(id), `the record of ${s.next} doesn't list ${id}, a task with no ceiling: ${JSON.stringify(none ?? null)}`);
  assert.deepEqual([...none.tasks].sort(), ['open-a', 'open-b'], `the record of ${s.next} lists a task with a ceiling among those with none: ${JSON.stringify(none)}`);
  assert.equal(none.count, 2, `the record of ${s.next} counts ${none.count} tasks with no ceiling, not 2: ${JSON.stringify(none)}`);
  const slack = record.slack ?? [];
  const roomy = slack.find(({ id }) => id === 'roomy');
  assert.ok(roomy, `the record of ${s.next} doesn't list roomy, whose reading is 75% under its ceiling ${s.ceilings.roomy}: ${JSON.stringify(record.slack ?? null)}`);
  assert.equal(roomy.metric, 'peakBytes', `roomy's entry names another ceiling than peakBytes: ${JSON.stringify(roomy)}`);
  assert.equal(roomy.limit, s.ceilings.roomy, `roomy's entry names ${roomy.limit} as its ceiling, not ${s.ceilings.roomy}: ${JSON.stringify(roomy)}`);
  assert.ok(Number.isFinite(roomy.reading) && Math.abs(roomy.reading - s.peak) <= 0.1 * s.peak, `roomy's entry names ${roomy.reading} as its reading; its command peaks near ${s.peak} bytes: ${JSON.stringify(roomy)}`);
  assert.deepEqual(slack.map(({ id }) => id).sort(), ['roomy'], `the record of ${s.next} lists a task that isn't more than 20% under a ceiling (held is 12% under its ${s.ceilings.held.new}, tight over its ${s.ceilings.tight.new}): ${JSON.stringify(slack)}`);
});
