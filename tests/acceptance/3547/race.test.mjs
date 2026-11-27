// #3547, criterion 4 and the Scope's second line: a run takes a shard's lock before it removes it, so a second run is
// never given the folder half removed, and two runs never remove one shard. Written blind from the issue at base
// 2edb19ff4 (README). The first run is stopped, by its own process group, at the moment the first entry leaves shard
// 4's folder, so the removal stands half done while the second run claims; then it goes on.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AN_HOUR, FOUR_DAYS, TEST, ballast, countFigure, entriesOf, howGiven, leftOf, listing, make, missingIn, newLines, original, remains, sandbox, shardsIn, standing, start, untilRemoval } from './helpers.mjs';

// Shard 4 holds 5,000 folders more, so its removal lasts long enough to be stopped part way.
const heavy = (box) => (k) => { if (k === 4) ballast(box, 4, 5_000); };
const never = (box, run) => `the first run removed nothing: no entry left shard 4, last made a tree four days before and held by no process, and ~/deepbuild-shards still holds ${listing(box).join(', ')}; "while one process removes shard 4" never happened, so nothing shows what a second run is given then\n${run.shown()}`;
const late = (first, run) => `the first run had ended before the test saw an entry leave shard ${first.touched}, so no second run claimed while shard 4 was being removed\n${run.shown()}`;

test("#3547.e7ae7186 while one process removes shard 4, a second that claims shards is never given shard 4's folder half removed: it is given another, or shard 4 made new", TEST, async (t) => {
  const box = sandbox(t);
  // The run that made the shards holds shards 2 and 3, so the second run's claim reaches shard 4; shard 5 is free.
  const holder = await make(box, [AN_HOUR, AN_HOUR, AN_HOUR, FOUR_DAYS, AN_HOUR], { keep: [2, 3], fill: heavy(box) });
  const before = entriesOf(box, 4);
  // The second run has loaded the script and waits, so its claim starts the moment the first is stopped.
  const second = await start(box, 'the second run');
  const first = await untilRemoval(box, 1, [4], 'the first run');
  if (first.touched === null) assert.fail(never(box, await first.finish()));
  if (!first.stopped) assert.fail(late(first, await first.finish()));

  // The first run stands still, shard 4 half removed.
  const half = `shard 4 ${standing(box, 4, before)}${listing(box).includes('4.lock') ? ', its lock held' : ', with no lock'}`;
  const given = await second.claim(2);
  const said = `while the first run was removing shard 4 (${half}), the second run asked for two shards and was given ${given.length ? `shard ${given.join(' and ')}` : 'none'}`;
  assert.equal(given.length, 2, `${said}: it is to be given another, or shard 4 made new\n${second.shown()}`);
  if (given.includes(4)) {
    assert.equal(howGiven(box, second.lines(), 4), 'made', `${said}: shard 4's folder as the first run was removing it, not shard 4 made new\n${second.shown()}`);
    assert.ok(!original(box, 4), `${said}: shard 4's folder still holds what the first run was removing, so it is not shard 4 made new\n${second.shown()}`);
  }
  for (const k of given) assert.deepEqual(missingIn(box, k), [], `${said}: shard ${k} does not hold the worktree's tree, it lacks ${missingIn(box, k).join(', ')}\n${second.shown()}`);

  // The first run goes on and ends; what the second holds stays whole, and nothing is left of the shard 4 it removed:
  // at that path there is nothing, or shard 4 made new, with a lock only while the second run holds it.
  const run = await first.finish();
  for (const k of given) assert.deepEqual(missingIn(box, k), [], `${said}; once the first run went on, shard ${k}, which the second run holds, lost ${missingIn(box, k).join(', ')}: it was given a folder the first run was still removing\n${run.shown()}\n${second.shown()}`);
  assert.deepEqual(remains(box, 4), [], `${said}; once the first run had ended, shard 4's folder still held ${remains(box, 4).join(' and ')} of the shard it was removing\n${run.shown()}\n${second.shown()}`);
  if (shardsIn(box).includes(4)) assert.deepEqual(missingIn(box, 4), [], `${said}; once the first run had ended, ~/deepbuild-shards/4 was neither gone nor shard 4 made new: it lacks ${missingIn(box, 4).join(', ')}\n${run.shown()}\n${second.shown()}`);
  assert.deepEqual(leftOf(box, 4).filter((name) => name !== '4'), given.includes(4) ? ['4.lock'] : [], `${said}; once the first run had ended, ~/deepbuild-shards held ${leftOf(box, 4).join(', ')} of shard 4, ${given.includes(4) ? 'which the second run holds' : 'which no run holds'}\n${run.shown()}\n${second.shown()}`);

  await second.release();
  await second.end();
  await holder.release();
  await holder.end();
});

test('#3547.e7ae7186 while one process removes shard 4, a second run that is given a lower shard does not remove shard 4 too: two runs never remove one shard', TEST, async (t) => {
  const box = sandbox(t);
  await make(box, [AN_HOUR, AN_HOUR, AN_HOUR, FOUR_DAYS], { fill: heavy(box) });
  const before = entriesOf(box, 4);
  const second = await start(box, 'the second run');
  const first = await untilRemoval(box, 1, [4], 'the first run');
  if (first.touched === null) assert.fail(never(box, await first.finish()));
  if (!first.stopped) assert.fail(late(first, await first.finish()));

  // The first run stands still, shard 4 half removed; the second claims one shard, a lower one, and so looks at shard 4 only to remove it.
  const half = `shard 4 ${standing(box, 4, before)}${listing(box).includes('4.lock') ? ', its lock held' : ', with no lock'}`;
  const given = await second.claim(1);
  const said = `while the first run was removing shard 4 (${half}), the second run asked for one shard and was given ${given.length ? `shard ${given.join(' and ')}` : 'none'}`;
  assert.ok(given.length === 1 && given[0] < 4, `${said}, not one of the free shards below 4\n${second.shown()}`);
  const more = newLines(box, second.lines(), given);
  assert.deepEqual(more, [], `${said}, and printed a line the merge base does not print: it removed shard 4, or says it did, while the first run was removing it\n${second.shown()}`);
  assert.deepEqual(missingIn(box, given[0]), [], `${said}, which lacks ${missingIn(box, given[0]).join(', ')}\n${second.shown()}`);
  await second.release();
  await second.end();

  // The first run goes on: shard 4 was removed once, by it.
  const run = await first.finish();
  const lines = newLines(box, run.lines, run.given);
  assert.deepEqual(leftOf(box, 4), [], `once both runs had ended, ~/deepbuild-shards still held ${leftOf(box, 4).join(', ')} of shard 4\n${run.shown()}`);
  assert.ok(lines.length === 1 && countFigure(lines[0], 1), `shard 4 was removed once, by the first run, whose one line is to give a count of 1; beyond the merge base's lines it printed ${lines.length} lines\n${run.shown()}`);
  assert.deepEqual(shardsIn(box), [1, 2, 3], `afterwards ~/deepbuild-shards holds shards ${shardsIn(box).join(', ')}, not 1, 2 and 3\n${run.shown()}`);
});
