// #3547, criterion 5 and the Scope's fourth line: the run prints one line, the shards it removed and the bytes du gave
// for them, and with none to remove it prints nothing new. Written blind from the issue at base 2edb19ff4 (README).
// What a run prints is its process's output: each line claimShards says, printed as scripts/affected.mjs prints it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AN_HOUR, FOUR_DAYS, TEST, baseLine, bytesFigure, claimOnce, countFigure, duBytes, listing, make, newLines, redact, sandbox, shardsIn, weigh } from './helpers.mjs';

const gb = (bytes) => `${bytes} bytes (${(bytes / 1e9).toFixed(2)} GB)`;

test("#3547.12729b73 the run's line gives the count and the bytes of what it removed: one line more than the merge base prints, with 4 for the four shards it removed and the bytes du gave for them", TEST, async (t) => {
  const box = sandbox(t);
  // Eight shards, each with build products of its own weight. Shards 5 to 8 are four days old; the two the run is
  // given are an hour old, so what it removes is those four by any reading. Four is no removed shard's number and no
  // number of the rule's, so a 4 on the line is the count.
  const units = [6, 6, 7, 9, 3, 5, 4, 2];
  const old = [5, 6, 7, 8];
  await make(box, units.map((unit, index) => (old.includes(index + 1) ? FOUR_DAYS : AN_HOUR)), { fill: (k) => weigh(box, k, units[k - 1]) });
  const each = new Map(units.map((unit, index) => [index + 1, duBytes(box, index + 1)]));
  const bytes = old.reduce((sum, k) => sum + each.get(k), 0);
  const all = [...each.values()].reduce((sum, of) => sum + of, 0);

  const run = await claimOnce(box, 2);
  assert.deepEqual(run.given, [1, 2], `a run that claims two was given ${run.given.join(' and ') || 'no shard'}, not shards 1 and 2\n${run.shown()}`);
  const more = newLines(box, run.lines, run.given);
  const gone = units.map((unit, index) => index + 1).filter((k) => !shardsIn(box).includes(k));
  assert.equal(more.length, 1, `the run printed ${more.length} lines beyond the ones the merge base prints for the shards it was given, not the one line that gives the count and the bytes of what it removed; it removed ${gone.length ? `shards ${gone.join(', ')}` : 'nothing'}, and ~/deepbuild-shards holds ${listing(box).join(', ')}\n${run.shown()}`);
  assert.deepEqual(gone, old, `the run removed ${gone.length ? `shards ${gone.join(', ')}` : 'nothing'}, not shards 5, 6, 7 and 8, the four last made a tree four days before that no process holds\n${run.shown()}`);
  const line = redact(box, more[0]);
  assert.ok(countFigure(more[0], 4), `the run's line does not give the count of the shards it removed, 4, as a number of its own: ${line}`);
  assert.ok(bytesFigure(more[0], bytes), `the run's line does not give the bytes du gave for the shards it removed, ${gb(bytes)}: ${old.map((k) => `shard ${k} ${each.get(k)}`).join(', ')}; the eight shards together held ${gb(all)}: ${line}`);
});

test('#3547.12729b73 a run that removes nothing prints the lines the merge base prints: one line for each shard it is given, made or reused, and no other, with no shard yet, with shards an hour old, and with a shard four days old that a live process holds', TEST, async (t) => {
  const box = sandbox(t);
  const same = (run, expected, when) => {
    assert.deepEqual([...run.lines].sort(), expected.sort(), `${when}, a run that removes nothing does not print the lines the merge base prints, which are:\n${redact(box, expected.join('\n'))}\n${run.shown()}`);
    assert.equal(run.stderr, '', `${when}, a run that removes nothing printed to stderr, where the merge base prints nothing\n${run.shown()}`);
    assert.equal(run.status, 0, `${when}, the run ended with ${run.signal ?? `exit ${run.status}`}\n${run.shown()}`);
  };

  const first = await claimOnce(box, 1);
  assert.deepEqual(first.given, [1], `with no shard yet, a run that claims one was given ${first.given.join(' and ') || 'no shard'}\n${first.shown()}`);
  same(first, [baseLine(box, 1, 'made')], 'with no shard yet');

  const second = await claimOnce(box, 2);
  assert.deepEqual(second.given, [1, 2], `with one shard made a moment before, a run that claims two was given ${second.given.join(' and ') || 'no shard'}\n${second.shown()}`);
  same(second, [baseLine(box, 1, 'reused'), baseLine(box, 2, 'made')], 'with one shard made a moment before');

  // Shards 1 and 2 an hour old; shard 3 four days old and held by the run that last used it, alive throughout.
  const holder = await make(box, [AN_HOUR, AN_HOUR, FOUR_DAYS], { keep: [3] });
  const third = await claimOnce(box, 2);
  assert.deepEqual(third.given, [1, 2], `with shards 1 and 2 an hour old and shard 3 held, a run that claims two was given ${third.given.join(' and ') || 'no shard'}\n${third.shown()}`);
  assert.deepEqual(listing(box), ['1', '2', '3', '3.lock'], `the run was to remove nothing: shards 1 and 2 are an hour old, and a live process (pid ${holder.pid}) holds shard 3; afterwards ~/deepbuild-shards holds ${listing(box).join(', ')}\n${third.shown()}`);
  same(third, [baseLine(box, 1, 'reused'), baseLine(box, 2, 'reused')], 'with shards 1 and 2 an hour old and shard 3, four days old, held by a live process');

  await holder.release();
  await holder.end();
});
