// AC7 #213.62c17765: "In an item that reads one control and mirrors two arrays, the read region holds the control's
// entries, then mirror 0's range list, then mirror 1's, at the offsets the item's layout digest gives; and a planted
// fill that writes the mirrors' lists before the reads moves the control's count and fails the read region's digest
// check, naming the item"
//
// Through `deep-logic` (README): `panel` reads the slider `knob` and mirrors left.vals (mirror 0) and right.vals
// (mirror 1); every step it copies the first 4,800 bytes of its read region into `panel.region`. Its layout comes from
// `check` (a program built for no digest first); the program that runs exports that layout's digest as
// `regions_digest`, so check admits it only where the layout is the one it was built for. The track presses knob once
// at step 2 and twice at step 4.

import { describe, expect, it } from 'vitest';
import {
  CRITERIA, LIST_BYTES, TIMEOUT, WHOLE, bakeCall, bakeSteps, checkCall, entryAt, ints, layoutOf, listText, logic, none, piece, rangeList,
  readEntry, show, useBuilds, type JsonObject, type Layout, type LayoutEntry,
} from './helpers.ts';
import { PANEL_BYTES, left, leftRuns, panel, right, rightRuns } from './programs.ts';

const ID = CRITERIA[7];
useBuilds(['logic']);

const STEPS = 7;
const TRACK = [entryAt('knob', 2, 0.25), entryAt('knob', 4, 0.5, 0), entryAt('knob', 4, 0.75, 1)];
/** The values knob's slot holds at each step: one entry at step 2, two at step 4, none else. */
const knobAt = (k: number): number[] => (k === 2 ? [0.25] : k === 4 ? [0.5, 0.75] : []);

function panelPiece(digest?: string): JsonObject {
  return piece({
    seed: 213, controls: ['knob'],
    items: {
      left: { program: left(), writes: { vals: { type: 'f64', count: 1000 } } },
      right: { program: right(), writes: { vals: { type: 'i32', count: 500 } } },
      panel: {
        program: panel(digest), reads: ['knob'], writes: { region: { type: 'i32', count: PANEL_BYTES / 4 } },
        mirrors: [{ array: 'left.vals', at: 'left_at' }, { array: 'right.vals', at: 'right_at' }],
      },
    },
  });
}
interface Slots { control: LayoutEntry; m0: LayoutEntry; m1: LayoutEntry }
const slotsOf = (l: Layout, what: string): Slots => ({
  control: readEntry(l, 'knob', null, what), m0: readEntry(l, 'left.vals', 'ranges', what), m1: readEntry(l, 'right.vals', 'ranges', what),
});
/** The panel's layout as `check` gives it under `planted` (or the real module). */
function layoutUnder(planted?: 'mirror_lists_before_reads'): Layout {
  const [checked] = logic([checkCall(panelPiece())], planted ? { planted } : {});
  return layoutOf(checked!, 'panel', planted ? 'the panel, planted' : 'the panel');
}

describe(`${ID} the read region holds the reads first, then each mirror's list in mirrors order, where the layout says`, () => {
  it(`${ID} panel's read region holds knob's entries, then left.vals' list, then right.vals', at the offsets of the layout whose digest its program exports`, () => {
    const l = layoutUnder();
    const { control, m0, m1 } = slotsOf(l, 'the panel');
    expect(control.offset < m0.offset && m0.offset < m1.offset, `the control's slot (${control.offset}), then mirror 0's list (${m0.offset}), then mirror 1's (${m1.offset})`).toBe(true);
    expect([m0.size, m1.size], 'each list is a u32 count and 256 ranges').toEqual([LIST_BYTES, LIST_BYTES]);
    expect(m1.offset + LIST_BYTES, 'the panel copies out everything up to the end of mirror 1\'s list').toBeLessThanOrEqual(PANEL_BYTES);
    const p = panelPiece(l.digest);
    const [checked, baked] = logic([checkCall(p), bakeCall(p, STEPS, { track: TRACK, arrays: ['panel.region'] })]);
    expect(layoutOf(checked!, 'panel', 'the panel exporting its digest').digest, 'check admits the program that exports the layout\'s digest').toBe(l.digest);
    const steps = bakeSteps(baked!, STEPS, 'the panel');
    const fails: string[] = [];
    for (const s of steps) {
      const words = ints(s.arrays['panel.region'], `step ${s.step}: panel.region`);
      const b = Buffer.alloc(words.length * 4);
      words.forEach((w, i) => b.writeInt32LE(w, 4 * i));
      const k = s.step;
      const count = b.readUInt32LE(control.offset);
      const values = Array.from({ length: Math.min(count, 16) }, (_, j) => b.readDoubleLE(control.offset + 16 + 16 * j));
      if (show(values) !== show(knobAt(k))) fails.push(`step ${k}: knob's slot at ${control.offset} holds ${count} entries ${show(values)}, not ${show(knobAt(k))}`);
      const at = (e: LayoutEntry): number[] => Array.from({ length: LIST_BYTES / 4 }, (_, i) => b.readUInt32LE(e.offset + 4 * i));
      for (const [e, name, runs] of [[m0, 'mirror 0 (left.vals)', leftRuns], [m1, 'mirror 1 (right.vals)', rightRuns]] as const) {
        const list = rangeList(at(e), `step ${k}: ${name}`);
        if (k === 0) {
          if (list.count !== 0 && list.count !== WHOLE) fails.push(`step 0: ${name}'s list at ${e.offset} is ${listText(list)}, neither empty nor a whole copy`);
        } else if (list.count !== runs(k - 1).length || show(list.ranges) !== show(runs(k - 1))) {
          fails.push(`step ${k}: ${name}'s list at ${e.offset} is ${listText(list)}, not its writer's step ${k - 1} ranges ${show(runs(k - 1))}`);
        }
      }
    }
    none(fails, 'the panel\'s read region, step by step');
  }, TIMEOUT);

  it(`${ID} (planted mirror_lists_before_reads) the fill that writes the lists before the reads moves knob's count, and check refuses the panel's program, naming the item`, () => {
    const real = layoutUnder();
    const planted = layoutUnder('mirror_lists_before_reads');
    const r = slotsOf(real, 'the panel');
    const q = slotsOf(planted, 'the panel, planted');
    expect(q.control.offset, `the planted fill moves knob's count from ${r.control.offset}`).not.toBe(r.control.offset);
    expect(q.control.offset > q.m0.offset && q.control.offset > q.m1.offset, `the planted fill writes both lists (${q.m0.offset}, ${q.m1.offset}) before knob's slot (${q.control.offset})`).toBe(true);
    expect(planted.digest, 'the planted layout\'s digest differs').not.toBe(real.digest);
    const [checked] = logic([checkCall(panelPiece(real.digest))], { planted: 'mirror_lists_before_reads' });
    expect([checked?.['ok'], checked?.['code'], checked?.['item']], `the planted fill's check refuses the program built for the real layout, naming panel: ${show(checked)}`).toEqual([false, 'logic_refused', 'panel']);
  }, TIMEOUT);
});
