// Criterion 1 (no upstream test): "A logic item with 32 MiB of memory that writes the same 3 of its 64 KiB pages
// each step, one of them by memory.fill, with a checkpoint every 60 steps, stores 192 KiB of pages plus its globals
// in each checkpoint but the first and every eighth, which hold the whole 32 MiB; a seek from each of 24
// checkpoints gives the same full-state hashes and continuation probes as a straight run; and a planted page
// tracker that misses pages memory.fill wrote fails logic.determinism on the full-state hash of the first
// checkpoint after the seek, naming that checkpoint"
//
// Through `deep-logic bake` (its seeks and probes, and this suite's `ring`) and `determinism` (README). `pages3`
// (programs.ts) writes pages 0, 200 (a store) and 400 (a memory.fill) every step of 1,440, on a seeded knob track,
// with a checkpoint every 60 steps and a ring budget (256 MiB) that keeps all 25. The ring's checkpoints 0, 480,
// 960 and 1,440 (the first and every eighth) hold the whole 32 MiB; the other 21 hold those three pages and the
// globals. A seek 30 steps past each of the 24 checkpoints below the last restores it and gives playing's step
// hashes up to the next checkpoint, that checkpoint's full-state hash and a continuation probe's. With
// `tracker_skips_memory_fill` the fill page leaves the checkpoints between whole ones, so logic.determinism at
// 23.5 s (step 1,410) fails each seek from one of them on the full-state hash of the checkpoint 60 steps on.
import { describe, expect, it } from 'vitest';
import {
  AC, MIB, PAGE, TIMEOUT, bakeCall, bakeOf, checkCall, determinismCall, determinismOf, entryAt, judgeSeeks, logicBin, none, offsetOf,
  onMac, piece, prebuild, ringOf, seeksAndProbes, sliderTrack, type Entry, type JsonObject,
} from './helpers.ts';
import { FILL_PAGE, PAGES3_PAGES, STORE_PAGE, pages3 } from './programs.ts';

prebuild(() => { logicBin(); pages3(); });

const ID = 'pages';
const EVERY = 60;
const STEPS = 1440;
/** The 24 checkpoints below the last, each sought 30 steps on. */
const FROM = Array.from({ length: 24 }, (_, i) => i * EVERY);
const TARGETS = FROM.map((c) => c + 30);
const WHOLE = [0, 480, 960, 1440];
const THREE = [0, STORE_PAGE, FILL_PAGE];
/** Large enough to keep all 25 checkpoints: 4 whole (128 MiB) and 21 of 192 KiB. */
const RING_BUDGET = 256 * MIB;
const AT_TIMES = [23.5];
const SAMPLED = 1410;
const track = (): Entry[] => sliderTrack('knob', 547_01, STEPS, 40, 10);
const probeEntries = (s: number): Entry[] => [entryAt('knob', s + 2, 5)];
const pieceOf = (): JsonObject => piece({
  seed: 547, controls: ['knob'],
  items: { [ID]: { program: pages3(), reads: ['knob'], writes: { sum: { type: 'i32' } }, budget: { memory: 32 }, checkpoint: { every: EVERY, budget: RING_BUDGET } } },
});

describe(`${AC[1]} checkpoints between whole ones keep the pages written since the one before`, () => {
  it(`${AC[1]} each checkpoint but the first and every eighth holds the 3 written pages (192 KiB) and the globals, those hold the whole 32 MiB, and a seek from each of 24 checkpoints equals playing`, () => {
    const [checked] = onMac([checkCall(pieceOf())]);
    expect(offsetOf(checked!, ID, 'reads', 'knob'), 'the knob slider\'s slot is at offset 0 of the read region').toBe(0);
    expect(offsetOf(checked!, ID, 'writes', 'sum'), 'sum is at offset 0 of the write region').toBe(0);

    // What the base lacks first: the ring as the bake leaves it, on a short bake.
    const [short] = onMac([bakeCall(pieceOf(), { steps: EVERY + 1, track: track() })]);
    const shortRing = ringOf(short!, 'a 61-step bake')[ID];
    expect(shortRing?.checkpoints.map((c) => [c.step, c.whole]), 'a 61-step bake keeps checkpoint 0 whole and checkpoint 60 as pages').toEqual([[0, true], [60, false]]);

    const [reply] = onMac([bakeCall(pieceOf(), { steps: STEPS, track: track(), ...seeksAndProbes(TARGETS, probeEntries, 20) })]);
    const b = bakeOf(reply!, 'the 1,440-step bake');
    expect(b.traps, 'pages3 never traps').toEqual([]);
    expect(b.steps.length, 'the bake holds every step').toBe(STEPS);
    const notThree = b.steps.filter((s) => JSON.stringify(s.items[ID]?.pages) !== JSON.stringify(THREE)).map((s) => `${s.step}: ${JSON.stringify(s.items[ID]?.pages)}`);
    expect(notThree, `every step writes pages ${THREE.join(', ')} and no other (the store page and the memory.fill page among them)`).toEqual([]);

    const ring = b.ring[ID]!;
    expect(ring.budget, 'the ring\'s budget is checkpoint.budget').toBe(RING_BUDGET);
    expect(ring.spacing, 'within its budget, the ring keeps its spacing of 60').toBe(EVERY);
    expect(ring.checkpoints.map((c) => c.step), 'the ring keeps every checkpoint, 0 to 1,440').toEqual(Array.from({ length: STEPS / EVERY + 1 }, (_, i) => i * EVERY));
    const wrong: string[] = [];
    for (const [i, c] of ring.checkpoints.entries()) {
      if (WHOLE.includes(c.step)) {
        if (i % 8 !== 0) wrong.push(`checkpoint ${c.step} is the ring's ${i}th, not the first or an eighth`);
        if (!c.whole || c.memory !== PAGES3_PAGES * PAGE || c.pages.length !== PAGES3_PAGES) wrong.push(`checkpoint ${c.step}, the first or an eighth, holds ${c.memory} bytes of memory in ${c.pages.length} pages (whole: ${c.whole}), not the whole ${32 * MIB}`);
      } else if (c.whole || c.memory !== 3 * PAGE || JSON.stringify(c.pages) !== JSON.stringify(THREE)) {
        wrong.push(`checkpoint ${c.step} holds ${c.memory} bytes of memory in pages ${JSON.stringify(c.pages.slice(0, 8))}${c.pages.length > 8 ? '…' : ''} (whole: ${c.whole}), not ${3 * PAGE} (192 KiB) in pages ${THREE.join(', ')}`);
      }
      if (c.globals <= 0) wrong.push(`checkpoint ${c.step} holds no globals (pages3 keeps $knob and $acc there)`);
      if (c.bytes < c.memory + c.globals) wrong.push(`checkpoint ${c.step} counts ${c.bytes} bytes, less than its memory and globals`);
    }
    none(wrong, 'each checkpoint but the first and every eighth stores 192 KiB of pages plus its globals, and those hold the whole 32 MiB');

    expect(b.seeks.map((s) => s.from), 'each seek restores the checkpoint 30 steps before it').toEqual(FROM);
    none(judgeSeeks(b, ID, TARGETS, EVERY), 'a seek from each of 24 checkpoints gives playing\'s full-state hashes, step hashes and continuation probes');

    const det = determinismOf(onMac([determinismCall(pieceOf(), { steps: STEPS, track: track() }, AT_TIMES)])[0]!, 'logic.determinism of pages3');
    expect(det.failures, 'logic.determinism finds nothing').toEqual([]);
    expect(det.verdict, 'logic.determinism passes pages3').toBe('PASS');
  }, TIMEOUT);

  it(`${AC[1]} a planted page tracker that misses pages memory.fill wrote (tracker_skips_memory_fill) fails logic.determinism on the full-state hash of the first checkpoint after each seek from a checkpoint of pages, naming that checkpoint`, () => {
    const det = determinismOf(onMac([determinismCall(pieceOf(), { steps: STEPS, track: track() }, AT_TIMES)], ['tracker_skips_memory_fill'])[0]!, 'logic.determinism with tracker_skips_memory_fill');
    expect(det.verdict, 'logic.determinism fails the planted tracker').toBe('FAIL');
    const seeks = det.failures.filter((f) => f.run === 'seek');
    const ofPages = FROM.filter((c) => !WHOLE.includes(c) && c <= SAMPLED);
    expect(seeks.map((f) => f.from).sort((a, b) => a! - b!), `each seek from a checkpoint of pages fails, and none from a whole one: ${JSON.stringify(det.failures).slice(0, 1200)}`).toEqual(ofPages);
    for (const f of seeks) {
      expect(f.item, 'the failure names pages3\'s item').toBe(ID);
      expect(f.field, `the seek from ${f.from} fails on a full-state hash`).toBe('deep_hash');
      expect(f.checkpoint, `the seek from ${f.from} names checkpoint ${f.from! + EVERY}, the first after it`).toBe(f.from! + EVERY);
    }
    expect(seeks.find((f) => f.from === 60)?.checkpoint, 'the seek from checkpoint 60 names checkpoint 120').toBe(120);
  }, TIMEOUT);
});
