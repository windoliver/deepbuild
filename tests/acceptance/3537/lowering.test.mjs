import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { loop, manifest, marked, measured, names, recordOf, rowOf, rowsSaid, scriptOf, staged, task, within, working } from './helpers.mjs';

const OLD = 100_000_000;
const NEW = 50_000_000;
const NO_WORK = '{"held":512}';
const BENCHMARKS = {
  matched: loop(20_000, working({ records: 3000 })),
  silent: loop(20_000, NO_WORK),
  thinned: loop(20_000, working({ records: 4000 })),
};
const MATCHED_DOING_THE_SAME_FOR_LESS = loop(14_000, working({ records: 3000 }));
const THINNED_DOING_LESS = loop(200, working({ records: 40 }));

async function play(box) {
  const ceilings = { matched: OLD, silent: OLD, thinned: OLD };
  const budgets = () => manifest(Object.keys(BENCHMARKS).map((id) => task(id, { peakBytes: ceilings[id] })));
  const benchmarks = Object.fromEntries(Object.entries(BENCHMARKS).map(([id, benchmark]) => [scriptOf(id), benchmark]));
  const repo = await marked(box, { 'benchmarks/budgets.json': budgets(), ...benchmarks });
  const lowering = (id, more, message) => {
    ceilings[id] = NEW;
    return repo.commit({ 'benchmarks/budgets.json': budgets(), ...more }, message);
  };
  const commits = {
    matched: lowering('matched', { [scriptOf('matched')]: MATCHED_DOING_THE_SAME_FOR_LESS }, 'Lower the peakBytes ceiling of matched and do the same work in fewer rounds'),
    silent: lowering('silent', {}, 'Lower the peakBytes ceiling of silent'),
    thinned: lowering('thinned', { [scriptOf('thinned')]: THINNED_DOING_LESS }, 'Lower the peakBytes ceiling of thinned and do less in its benchmark'),
  };
  const run = await measured(box, repo, 15);
  const records = Object.fromEntries(Object.entries(commits).map(([id, commit]) => [id, recordOf(box, run, commit, `the commit that lowers the ceiling of ${id}`)]));
  return { commits, records };
}
const scene = staged(after, play);

const refusalOf = (record, ...named) => record.tests.find(({ state, note }) => ['FAIL', 'BLOCKED'].includes(state) && named.every((what) => names(note, what)));
const lowers = (id) => `lowers ${id}'s peakBytes ceiling from ${OLD} to ${NEW}`;

test('AC3 #3537.a2b0a773 a fixture change that lowers a ceiling on a task that reports no work is refused, naming the task, with work reported and equal on both sides it passes as the first criterion of #2665 has it, and a lowering whose five runs reported less is refused, naming both values', within(20), async () => {
  const { commits, records } = await scene();

  assert.ok(records.silent.state !== 'PASS' && refusalOf(records.silent, 'silent'), `the window took ${commits.silent}, which ${lowers('silent')}, a task whose run reports no work (its report is ${NO_WORK}): the record isn't refused by a FAIL or BLOCKED row naming silent: ${rowsSaid(records.silent)}`);
  assert.ok(!refusalOf(records.matched, 'silent'), `INCONCLUSIVE (scene): a FAIL or BLOCKED row names silent on ${commits.matched} too, which leaves silent as it was, so the refusal on ${commits.silent} isn't shown to be the lowering's: ${rowsSaid(records.matched)}`);

  const matched = rowOf(records.matched, 'matched');
  assert.ok(matched && !refusalOf(records.matched, 'matched'), `the window refused ${commits.matched}, which ${lowers('matched')}, a task whose runs report the same work on both sides, {"records":3000}: ${rowsSaid(records.matched)}`);
  assert.equal(matched.state, 'PASS', `matched didn't pass on ${commits.matched}, which ${lowers('matched')} with its work reported and equal on both sides: ${rowsSaid(records.matched)}`);
  const entries = (records.matched.lowered ?? []).filter((entry) => entry?.id === 'matched' && entry?.metric === 'peakBytes');
  assert.equal(entries.length, 1, `the record of ${commits.matched} doesn't name matched's lowered peakBytes ceiling once: ${JSON.stringify(records.matched.lowered ?? null)}`);
  const [{ old: before, new: lowered, runs }] = entries;
  assert.ok(before === OLD && lowered === NEW, `the record of ${commits.matched} names ${before} and ${lowered} as matched's old and new peakBytes ceilings, not ${OLD} and ${NEW}`);
  assert.ok(Array.isArray(runs) && runs.length === 5 && runs.every((reading) => Number.isFinite(reading) && reading > 0 && reading <= NEW), `the record of ${commits.matched} doesn't name the five readings matched was judged on, each within its new ceiling ${NEW}: ${JSON.stringify(runs ?? null)}`);

  assert.ok(records.thinned.state !== 'PASS' && refusalOf(records.thinned, 'thinned', 4000, 40), `the window took ${commits.thinned}, which ${lowers('thinned')} on five runs that reported less, records 40 where the merge base's runs report records 4000: the record isn't refused by a FAIL or BLOCKED row naming thinned, 4000 and 40: ${rowsSaid(records.thinned)}`);
});
