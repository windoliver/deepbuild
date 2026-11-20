// AC2 #211.4818ef34: "A page given 0xAB at offset 7 at step 100, moved out at step 200 and asked for again at step 300
// reads 0xAB at offset 7 in step 304; a planted pager that skips writing back a dirty page it moves out reads 0 there
// and fails, naming the page and the step"
//
// Through `deep-logic` (README): a scripted item (programs.ts: script) with pages {max 64, slots 4, moves 2, lead 4}.
// init asks for page 5 into slot 0 (it lands at step 3); step 100 writes 0xAB at offset 7 of slot 0; step 200 asks for
// page 6 into slot 0, which moves page 5 out at step 204; step 300 asks for page 5 again, into slot 1, landing at step
// 304. Every step copies the byte at offset 7 of slot 1 into `seen`. The judge reads `seen` at step 304.
// `pager_skips_dirty_write_back` moves page 5 out without writing it back.

import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, arrayOf, bakeCall, bakeOf, logic, none, pagesOf, piece, useBuilds, type Bake, type LogicPlanted } from './helpers.ts';
import { script, scriptWrites } from './programs.ts';

const ID = AC(2);
useBuilds(['logic']);

const PAGE = 5;
const STEPS = 310;
const program = script({
  name: 'dirty', slots: 4, moves: 2, init: [{ page: PAGE, slot: 0 }],
  at: {
    100: [{ write: { slot: 0, offset: 7, value: 0xab, bytes: 1 } }],
    200: [{ ask: { page: 6, slot: 0 } }],
    300: [{ ask: { page: PAGE, slot: 1 } }],
  },
  reads: [{ slot: 1, offset: 7, bytes: 1 }],
});
function run(planted: LogicPlanted[]): Bake {
  const p = piece({ seed: 211_02, items: { dirty: { program, writes: scriptWrites(1), pages: pagesOf({ max: 64, slots: 4, moves: 2, lead: 4 }), checkpoint: { every: 60 } } } });
  const [reply] = logic([bakeCall(p, STEPS)], { planted });
  return bakeOf(reply!, STEPS, `the dirty page's run${planted.length ? ` (planted ${planted.join(', ')})` : ''}`);
}
/** The judge: page 5, asked for again at step 300, reads 0xAB at offset 7 in step 304. */
function judge(b: Bake): string[] {
  const got = arrayOf(b.steps[304]!, 'dirty.seen', 'the dirty page')[0];
  return got === 0xab ? [] : [`page ${PAGE}, step 304: offset 7 reads ${got}, not 0xAB (171), after the page was moved out dirty and loaded again`];
}

describe(`${ID} a page written, moved out and asked for again reads what was written`, () => {
  it(`${ID} page 5 given 0xAB at offset 7 at step 100, moved out at step 200, asked for again at step 300, reads 0xAB there in step 304`, () => {
    const b = run([]);
    expect(b.traps, 'the run never traps').toEqual([]);
    none(judge(b), 'the dirty page comes back');
  }, TIMEOUT);

  it(`${ID} (planted pager_skips_dirty_write_back) reads 0 there and fails, naming the page and the step`, () => {
    const b = run(['pager_skips_dirty_write_back']);
    expect(arrayOf(b.steps[304]!, 'dirty.seen', 'the planted run')[0], 'the planted pager reads 0 at offset 7 in step 304').toBe(0);
    const failures = judge(b);
    expect(failures.length, 'the judge that passes the real pager fails the planted one').toBeGreaterThan(0);
    expect(failures.every((f) => f.includes(`page ${PAGE}`) && f.includes('step 304')), `the failure names page ${PAGE} and step 304: ${failures.join(' | ')}`).toBe(true);
  }, TIMEOUT);
});
