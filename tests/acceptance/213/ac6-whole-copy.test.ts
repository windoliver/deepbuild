// AC6 #213.8ba60177: "A step whose writer changed 300 scattered ranges gives the reader one whole copy marked
// 0xFFFFFFFF, in play and after a seek alike; and a mirror naming the reader's own array is refused at check, naming
// it"
//
// Through `deep-logic` (README): `scatter` changes 300 single elements at step 9 and nothing else; `watch` mirrors
// scatter.cells and copies its list and its checksum of the mirror out; `plain` reads scatter.cells plainly. Every item
// checkpoints every 10 steps, so the checkpoint before step 10 holds the 300 pending ranges, and a seek to 10 is #531's
// restore of it for one step.

import { describe, expect, it } from 'vitest';
import {
  CRITERIA, TIMEOUT, WHOLE, arr, bakeCall, bakeSteps, checkCall, ints, isObject, layoutOf, listText, logic, mentions, obj, piece, rangeList,
  readEntry, show, stepsOf, useBuilds, type JsonObject, type JsonValue, type LogicStep,
} from './helpers.ts';
import { MIRROR_WRITES, PLAIN_WRITES, mirrorReader, plainReader, scatter, selfish, sumOf } from './programs.ts';

const ID = CRITERIA[6];
useBuilds(['logic']);

const BYTES = 4096 * 8;
const AT = 131_072;
const EVERY = { every: 10 };
const ARRAY = 'scatter.cells';

function scatterPiece(listAt: number): JsonObject {
  return piece({
    seed: 213,
    items: {
      scatter: { program: scatter(), writes: { cells: { type: 'f64', count: 4096 } }, checkpoint: EVERY },
      watch: { program: mirrorReader({ name: 'watch', pages: 4, global: 'cells_at', mirrorAt: AT, bytes: BYTES, listAt }), writes: MIRROR_WRITES, mirrors: [{ array: ARRAY, at: 'cells_at' }], checkpoint: EVERY },
      plain: { program: plainReader({ name: 'plain6', pages: 4, readsAt: AT, bytes: BYTES }), reads: [ARRAY], writes: PLAIN_WRITES, checkpoint: EVERY },
    },
  });
}
/** watch's step: its list and whether its mirror's checksum is plain's. */
function seen(s: LogicStep, what: string): { list: string; count: number; same: boolean } {
  const list = rangeList(ints(s.arrays['watch.list'], `${what}: watch.list`), `${what}: watch.list`);
  const same = sumOf(ints(s.arrays['watch.sum'], `${what}: watch.sum`)) === sumOf(ints(s.arrays['plain.sum'], `${what}: plain.sum`));
  return { list: listText(list), count: list.count, same };
}

describe(`${ID} more than 256 pending ranges become one whole copy, in play and after a seek, and a mirror of the reader's own array is refused`, () => {
  it(`${ID} scatter changes 300 scattered elements at step 9: watch's step 10 reads one whole copy marked 0xFFFFFFFF, its mirror plain's read, in play and in a seek to step 10 from the checkpoint before it`, () => {
    const [checked] = logic([checkCall(scatterPiece(0))]);
    const listAt = readEntry(layoutOf(checked!, 'watch', 'the scatter piece'), ARRAY, 'ranges', 'watch').offset;
    expect(readEntry(layoutOf(checked!, 'plain', 'the scatter piece'), ARRAY, null, 'plain').offset, 'plain\'s read is its first read entry, at 0').toBe(0);
    const [baked] = logic([bakeCall(scatterPiece(listAt), 12, { restores: [{ from: 10, steps: 1 }], arrays: ['watch.list', 'watch.sum', 'plain.sum'] })]);
    const steps = bakeSteps(baked!, 12, 'the scatter');
    const played = seen(steps[10]!, 'play\'s step 10');
    expect(played, 'play\'s step 10: one whole copy, marked 0xFFFFFFFF, equal to plain\'s read').toEqual({ list: listText({ count: WHOLE, ranges: [] }), count: WHOLE, same: true });
    const restores = arr(baked!['restores'], 'the scatter: restores');
    expect(restores.length, 'the seek answered').toBe(1);
    const r = obj(restores[0], 'the scatter: restores[0]');
    expect(r['from'], 'the seek to 10 restores the checkpoint before step 10').toBe(10);
    const at = stepsOf(r['steps'], 'the seek: steps').find((x) => x.step === 10);
    expect(at, 'the seek runs step 10').toBeDefined();
    expect(seen(at!, 'the seek\'s step 10'), 'after the seek, step 10 reads the same whole copy, equal to plain\'s read').toEqual(played);
    expect(at!.arrays['watch.sum'], 'and the same mirror as play').toEqual(steps[10]!.arrays['watch.sum']);
  }, TIMEOUT);

  it(`${ID} a logic item whose mirror names its own array is refused at check, naming the array`, () => {
    const p = piece({ seed: 213, items: { selfish: { program: selfish(), writes: { cells: { type: 'f64', count: 16 } }, mirrors: [{ array: 'selfish.cells', at: 'self_at' }] } } });
    const [checked] = logic([checkCall(p)]);
    expect([checked?.['ok'], checked?.['code'], checked?.['item']], `the check refuses selfish: ${show(checked)}`).toEqual([false, 'logic_refused', 'selfish']);
    const refusals = arr(checked!['refusals'], 'the refusal: refusals').filter(isObject);
    expect(refusals.some((x) => Object.entries(x).some(([k, v]) => k !== 'what' && k !== 'rule' && mentions(v, 'selfish.cells'))),
      `a refusal names the mirrored array selfish.cells in a field of its own (README: mirror), not only in its prose: ${show(refusals as JsonValue)}`).toBe(true);
  }, TIMEOUT);
});
