// AC9 #211.4d368ad6: "A page written at step 150, moved out at step 200, loaded again at step 300, written at step 350
// and moved out at step 400: a seek to step 240 loads it at step 300 with its step-200 bytes, by the hash checkpoint 240
// names, and every deep hash matches the straight run's; a planted store that keeps one copy per page number and
// overwrites it on write-back loads the step-400 bytes and fails, naming the page and step 300"
//
// Through `deep-logic` (README): a scripted item (programs.ts: script) with pages {max 64, slots 4, moves 2, lead 4}
// and a checkpoint every 60 steps. Page 9 lands in slot 0 at step 3; step 150 writes V1 at its offsets 0 and 65,532;
// page 10 replaces it at step 200 (asked at 196), so page 9's step-200 bytes are V1's; page 9 lands again, in slot 1,
// at step 300 (asked at 296); step 350 writes V2 at its offsets 4 and 65,528; page 11 replaces it at step 400 (asked
// at 396). Every step copies slot 1's words at offsets 0 and 4 into `seen`. The bake runs 480 steps, then a seek to
// step 240: #531's restore of checkpoint 240, played 120 steps (to checkpoint 360). `store_keeps_one_copy_per_page`
// keeps one copy of each page number in the store, overwritten by each write-back.

import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, arrayOf, bakeCall, bakeOf, logic, none, pagesOf, piece, sha256, show, useBuilds, type Bake, type LogicPlanted } from './helpers.ts';
import { script, scriptWrites } from './programs.ts';

const ID = AC(9);
useBuilds(['logic']);

const PAGE = 9;
const V1 = 0x15015015;
const V2 = 0x35035035;
const program = script({
  name: 'versions', slots: 4, moves: 2, init: [{ page: PAGE, slot: 0 }],
  at: {
    150: [{ write: { slot: 0, offset: 0, value: V1, bytes: 4 } }, { write: { slot: 0, offset: 65_532, value: V1, bytes: 4 } }],
    196: [{ ask: { page: 10, slot: 0 } }],
    296: [{ ask: { page: PAGE, slot: 1 } }],
    350: [{ write: { slot: 1, offset: 4, value: V2, bytes: 4 } }, { write: { slot: 1, offset: 65_528, value: V2, bytes: 4 } }],
    396: [{ ask: { page: 11, slot: 1 } }],
  },
  reads: [{ slot: 1, offset: 0, bytes: 4 }, { slot: 1, offset: 4, bytes: 4 }],
});
/** Page 9's bytes as step 200 moved it out: zeros, V1 at offsets 0 and 65,532. */
function step200Bytes(): Buffer {
  const b = Buffer.alloc(65_536);
  b.writeInt32LE(V1 | 0, 0);
  b.writeInt32LE(V1 | 0, 65_532);
  return b;
}
function run(planted: LogicPlanted[]): Bake {
  const p = piece({ seed: 211_09, items: { versions: { program, writes: scriptWrites(2), pages: pagesOf({ max: 64, slots: 4, moves: 2, lead: 4 }), checkpoint: { every: 60 } } } });
  const [reply] = logic([bakeCall(p, 480, { restores: [{ from: 240, steps: 120 }] })], { planted });
  return bakeOf(reply!, 480, `the page's versions${planted.length ? ` (planted ${planted.join(', ')})` : ''}`);
}
/** The judge: the seek to step 240 loads page 9 at step 300 with its step-200 bytes (V1 at 0, nothing yet at 4). */
function judge(b: Bake): string[] {
  const at300 = b.restores[0]?.steps.find((s) => s.step === 300);
  if (!at300) return ['the seek to step 240 ran no step 300'];
  const [w0, w4] = arrayOf(at300, 'versions.seen', 'the seek');
  return w0 === (V1 | 0) && w4 === 0 ? [] : [`page ${PAGE}, step 300: the seek to step 240 loads words ${w0}, ${w4} at offsets 0 and 4, not its step-200 bytes ${V1 | 0}, 0`];
}

describe(`${ID} page versions are kept by hash, so a seek loads the bytes its checkpoint names`, () => {
  it(`${ID} a seek to step 240 loads page 9 at step 300 with its step-200 bytes, by the hash checkpoint 240 names, and every deep hash matches the straight run's`, () => {
    const b = run([]);
    expect(b.traps, 'the run never traps').toEqual([]);
    expect(arrayOf(b.steps[300]!, 'versions.seen', 'the straight run'), 'the straight run loads page 9 at step 300 with V1 and no V2').toEqual([V1 | 0, 0]);
    expect(arrayOf(b.steps[399]!, 'versions.seen', 'the straight run'), 'and holds V1 and V2 by step 399').toEqual([V1 | 0, V2 | 0]);
    const cp240 = (b.checkpoints['versions'] ?? []).find((c) => c.step === 240);
    expect(cp240?.map?.[String(PAGE)], `checkpoint 240's page map names page 9 by the SHA-256 of its step-200 bytes: ${show(cp240?.raw)}`).toBe(sha256(step200Bytes()));
    none(judge(b), 'the seek to step 240');
    expect(b.restores[0]!.from, 'the seek restores checkpoint 240').toBe(240);
    const straight = new Map((b.checkpoints['versions'] ?? []).map((c) => [c.step, c.deep_hash]));
    const seek = b.restores[0]!.checkpoints['versions'] ?? [];
    expect(seek.map((c) => c.step), 'the seek reaches checkpoints 240, 300 and 360').toEqual([240, 300, 360]);
    expect(seek.filter((c) => straight.get(c.step) !== c.deep_hash).map((c) => c.step), 'every deep hash matches the straight run\'s').toEqual([]);
  }, TIMEOUT);

  it(`${ID} (planted store_keeps_one_copy_per_page) loads the step-400 bytes and fails, naming the page and step 300`, () => {
    const b = run(['store_keeps_one_copy_per_page']);
    const at300 = b.restores[0]?.steps.find((s) => s.step === 300);
    expect(at300 && arrayOf(at300, 'versions.seen', 'the planted seek'), 'the planted store loads page 9\'s step-400 bytes at step 300 (V1 and V2)').toEqual([V1 | 0, V2 | 0]);
    const failures = judge(b);
    expect(failures.length, 'the judge that passes the real store fails the planted one').toBeGreaterThan(0);
    expect(failures.every((f) => f.includes(`page ${PAGE}`) && f.includes('step 300')), `the failure names page ${PAGE} and step 300: ${failures.join(' | ')}`).toBe(true);
  }, TIMEOUT);
});
