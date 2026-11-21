// Criterion 7: "Chapter 1 writes a carry record of roster (12 i32: 3 units of 4 values) and gold (1 i32) at its last
// step; chapter 2, whose carry_in names that shape and accepts chapter 1's layout, opened with the record reads the 3
// units and the gold at step 0, and a replay of chapter 2 reads the record by hash from its track to the same
// full-state hashes; a record whose roster has 16 values is refused, naming roster; a record from a program with
// another layout is refused, naming both layouts; and chapter 2 opened without a record reads a u32 0 and zeros"
//
// Through `deep-logic`, the app (README: deep-logic). Chapter 1 (fixtures.ts) exports a state layout and asks for a
// carry record of roster and gold at its last step, 599; chapter 2's carry_in names that shape and accepts chapter
// 1's layout, and it writes what its read region held at step 0. In order:
//   - chapter 1 baked for 600 steps writes one record, at step 599, a file named by its sha256 whose fields are its
//     layout (the sha256 of its layout bytes), its program and document by hash, the step and step 599's roster and
//     gold (rosterAt, goldAt), which are also the arrays chapter 1's own step 599 wrote;
//   - `open_carry` opens it into chapter 2: step 0 reads a u32 1, the 12 roster values in order and the gold; the
//     run's track holds the record's entry at step 0, by hash; a bake of chapter 2 on that track gives the same
//     full-state hash at every checkpoint and the same arrays at every step;
//   - the record rewritten with a roster of 16 values (named by its own sha256) is refused, naming roster;
//   - chapter 1's program with another layout writes a record that is refused, naming its layout and chapter 1's;
//   - chapter 2 baked with no record reads a u32 0 and zeros at step 0, over the garbage its init left there.
// Wrong programs it fails: the base (no carry, carry_in or open_carry); a record at another step, of other values,
// arrays or layout; arrays read in another order than carry_in's; a replay that ignores the record's entry; a check
// of shape or layout that passes; a module that leaves the read region unfilled without a record.
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AC, DIGEST, TIMEOUT, bake, carryOpened, carryRefused, check, none, one, openCarryCall, prebuild, readRecord, sha256, useTemp, type StepRecord } from './helpers.ts';
import {
  CARRY_IN_BYTES, CHAPTER1, CHAPTER1_STEPS, CHAPTER2, GOT, GOT_WITHOUT, LAST_STEP, chapter1Piece, chapter2Piece, chapter2Regions, goldAt, gotWith, layoutOf, programs, rosterAt,
} from './fixtures.ts';

prebuild();
const temp = useTemp();

/** Chapter 2's steps in each of its runs: two checkpoints after the opened state. */
const STEPS_2 = 121;
/** What a step of chapter 2 wrote, in GOT's order. */
const got = (s: StepRecord | undefined): unknown[] => GOT.map((n) => s?.arrays[`${CHAPTER2}.${n}`]?.[0]);

describe(`${AC[7]} carry records: chapter 1's roster and gold carried into chapter 2 at step 0`, () => {
  it(`${AC[7]} chapter 1's record opens chapter 2 with the 3 units and the gold at step 0 and replays by hash; a roster of 16 values and another layout are refused; without a record chapter 2 reads a u32 0 and zeros`, () => {
    const entryOf = chapter2Regions();
    expect(entryOf.entries.find((e) => e.region === 'reads' && e.name === 'carry_in')?.size, `chapter 2's read region has a carry_in entry of a u32 and 13 i32 (README: The read region): ${JSON.stringify(entryOf.entries)}`).toBe(CARRY_IN_BYTES);
    const p = programs();
    const dir = temp();
    const piece1 = chapter1Piece(p, 'v1');
    const piece2 = chapter2Piece(p);
    const checked1 = check(piece1, 'check of chapter 1')[CHAPTER1]!;

    // Chapter 1 writes its record at its last step.
    const run1 = bake(piece1, CHAPTER1_STEPS, 'chapter 1 baked', { saves_dir: dir });
    expect(run1.carries.map((c) => [c.item, c.step]), `chapter 1 writes one carry record, at its last step ${LAST_STEP}`).toEqual([[CHAPTER1, LAST_STEP]]);
    const written = run1.carries[0]!;
    const rec = readRecord(join(dir, `${written.hash}.carry`), 'chapter 1\'s record');
    expect(sha256(rec.bytes), 'the record\'s file reads back whole: its bytes have the sha256 that names it').toBe(written.hash);
    expect(rec.from['layout'], 'the record names chapter 1\'s state layout: the sha256 of the bytes at layout_at').toBe(layoutOf('v1'));
    expect([checked1.hash, checked1.program], 'the record names chapter 1\'s program by hash').toContain(rec.from['program']);
    expect(String(rec.from['document']), 'the record names chapter 1\'s document by hash').toMatch(DIGEST);
    expect(rec.step, 'the record is of chapter 1\'s last step').toBe(LAST_STEP);
    expect(rec.arrays, 'the record holds roster (12 i32: 3 units of 4 values) and gold (1 i32), as step 599 left them').toEqual({ roster: rosterAt(LAST_STEP), gold: [goldAt(LAST_STEP)] });
    const last = run1.steps.find((s) => s.step === LAST_STEP);
    expect([last?.arrays[`${CHAPTER1}.roster`], last?.arrays[`${CHAPTER1}.gold`]], 'they are the arrays chapter 1\'s own last step wrote').toEqual([rec.arrays['roster'], rec.arrays['gold']]);

    // Chapter 2 opened with the record reads it at step 0, and a replay reads it by hash from its track.
    const opened = carryOpened(one(openCarryCall(piece2, dir, written.hash, STEPS_2), 'open_carry of chapter 1\'s record into chapter 2'), 'open_carry');
    expect(opened.record, 'it opens chapter 1\'s record').toBe(written.hash);
    const step0 = opened.steps.find((s) => s.step === 0);
    expect(got(step0), 'at step 0 chapter 2 reads a u32 1, then the 3 units of 4 values and the gold, in carry_in\'s order').toEqual(gotWith(rosterAt(LAST_STEP), goldAt(LAST_STEP)));
    const entries = opened.track.filter((e) => 'carry' in e);
    expect(entries, 'the record enters chapter 2\'s input track as one entry at step 0, by hash (README: The record\'s entry)').toEqual([{ t: 0, seq: 0, carry: written.hash, writer: 'you', player: 1 }]);
    expect(opened.track.length, 'and the track holds nothing else').toBe(1);
    const replay = bake(piece2, STEPS_2, 'a replay of chapter 2 on that track', { saves_dir: dir, track: opened.track });
    const hashes = (cps: Record<string, { step: number; deep_hash: string }[]>): string[] => (cps[CHAPTER2] ?? []).map((c) => `${c.step} ${c.deep_hash}`);
    expect(hashes(opened.checkpoints).length, 'the opened run takes checkpoints at steps 0 and 60 at least').toBeGreaterThanOrEqual(2);
    expect(hashes(replay.checkpoints), 'the replay gives the opened run\'s full-state hash at every checkpoint').toEqual(hashes(opened.checkpoints));
    none(opened.steps.flatMap((s) => {
      const r = replay.steps.find((x) => x.step === s.step);
      return JSON.stringify(r?.arrays) === JSON.stringify(s.arrays) ? [] : [`step ${s.step}: the replay writes ${JSON.stringify(r?.arrays)}, the opened run ${JSON.stringify(s.arrays)}`];
    }), 'the replay writes the opened run\'s arrays at every step');

    // A record whose roster has 16 values.
    const wide = Buffer.from(JSON.stringify({ from: rec.from, step: rec.step, arrays: { roster: [...rosterAt(LAST_STEP), 1, 2, 3, 4], gold: [goldAt(LAST_STEP)] } }));
    writeFileSync(join(dir, `${sha256(wide)}.carry`), wide);
    const r16 = carryRefused(one(openCarryCall(piece2, dir, sha256(wide), STEPS_2), 'open_carry of a record whose roster has 16 values'), 'a roster of 16 values');
    expect([r16.code, r16.record], 'a record of another shape is refused, naming the record').toEqual(['carry_refused', sha256(wide)]);
    expect(r16.differs.filter((d) => d['what'] === 'array').map((d) => d['array']), `naming roster, and only roster: ${JSON.stringify(r16.differs)}`).toEqual(['roster']);

    // A record from a program with another layout.
    const other = bake(chapter1Piece(p, 'v2'), CHAPTER1_STEPS, 'chapter 1 with another layout, baked', { saves_dir: dir }).carries;
    expect(other.map((c) => c.step), 'chapter 1 with another layout writes its record at its last step too').toEqual([LAST_STEP]);
    expect(readRecord(join(dir, `${other[0]!.hash}.carry`), 'the other layout\'s record').from['layout'], 'its record names the other layout').toBe(layoutOf('v2'));
    const rl = carryRefused(one(openCarryCall(piece2, dir, other[0]!.hash, STEPS_2), 'open_carry of a record from a program with another layout'), 'another layout');
    expect([rl.code, rl.record], 'a record whose layout carry_in doesn\'t accept is refused, naming the record').toEqual(['carry_refused', other[0]!.hash]);
    const layout = rl.differs.find((d) => d['what'] === 'layout');
    expect(layout, `naming the layouts: ${JSON.stringify(rl.differs)}`).toBeDefined();
    expect([layout!['record'], layout!['accepts']], 'both layouts: the record\'s and the one chapter 2 accepts, chapter 1\'s').toEqual([layoutOf('v2'), [layoutOf('v1')]]);

    // Chapter 2 opened without a record.
    const plain = bake(piece2, STEPS_2, 'chapter 2 baked without a record');
    expect(got(plain.steps.find((s) => s.step === 0)), 'without a record, step 0 reads a u32 0 and zeros, never what was in the region before').toEqual(GOT_WITHOUT);
  }, TIMEOUT);
});
