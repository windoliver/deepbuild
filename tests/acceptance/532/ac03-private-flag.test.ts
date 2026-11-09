// Criterion 3 (no upstream test): "A program that sets a private flag in its memory on a press of A and writes it
// nowhere until a press of Reveal, on a track with A pressed and no Reveal, passes logic.determinism; a planted
// restore that zeroes that flag leaves every step hash and array equal and still fails, on the full-state hash of
// the first checkpoint after the seek and on the continuation probe that presses Reveal from both states, naming
// the array that differs; and a planted check that compares step hashes alone passes that planted restore"
//
// Through `deep-logic determinism` (logic.determinism, sampled at 1.5 s: step 90) and `bake` (README: deep-logic).
// `secret` (programs.ts) keeps its flag at byte 8192, which no region holds; A is pressed at step 30 of 240 and
// Reveal never. `restore_keeps_regions_only` restores a checkpoint's globals and the bytes of the item's read and
// write regions and leaves the rest of memory zero, so a restore after step 30 loses the flag and nothing else;
// `check_compares_step_hashes` is a logic.determinism that compares only the step hashes of its runs.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, bakeCall, bakeOf, determinismCall, determinismOf, firstDiff, layoutFor, logicBin, onMac, piece, prebuild, rows, yours, type BakeSpec, type JsonObject } from './helpers.ts';
import { layoutProbe, secret } from './programs.ts';

prebuild(() => { logicBin(); });

const ID = 'flag';
const WRITES = { shown: { type: 'i32' as const }, tick: { type: 'i32' as const } };
const STEPS = 240;
const SPEC: BakeSpec = { steps: STEPS, track: [yours('a', 30, 1)] };
const AT_TIMES = [1.5];
let built: JsonObject | undefined;
function secretPiece(): JsonObject {
  if (built) return built;
  const l = layoutFor({ program: layoutProbe(), reads: ['a', 'reveal'], writes: WRITES }, ['a', 'reveal']);
  built = piece({ seed: 532_03, controls: ['a', 'reveal'], items: { [ID]: { program: secret(l), reads: ['a', 'reveal'], writes: WRITES } } });
  return built;
}
const restoresSpec: BakeSpec = { ...SPEC, restores: [0, 60, 120, 180].map((from) => ({ from, steps: STEPS - from })) };

describe(`${AC[3]} a private flag in memory: only full-state hashes and the Reveal probe see a restore that loses it`, () => {
  it(`${AC[3]} with A pressed and no Reveal, logic.determinism passes the program`, () => {
    const [bake, det] = onMac([bakeCall(secretPiece(), SPEC), determinismCall(secretPiece(), SPEC, AT_TIMES)]);
    const b = bakeOf(bake!, 'the bake');
    expect(b.steps.map((s) => s.arrays[`${ID}.shown`]?.[0]), 'shown stays 0: no Reveal on the track').toEqual(Array(STEPS).fill(0));
    const d = determinismOf(det!, 'logic.determinism');
    expect(d.failures, 'logic.determinism finds nothing').toEqual([]);
    expect(d.verdict, 'logic.determinism passes').toBe('PASS');
  }, TIMEOUT);

  it(`${AC[3]} a planted restore that zeroes the flag (restore_keeps_regions_only) keeps every step hash and array and fails logic.determinism on the full-state hash of checkpoint 120 and on the Reveal probe, naming ${ID}.shown`, () => {
    const [straightReply] = onMac([bakeCall(secretPiece(), restoresSpec)]);
    const [plantedReply, det] = onMac([bakeCall(secretPiece(), restoresSpec), determinismCall(secretPiece(), SPEC, AT_TIMES)], ['restore_keeps_regions_only']);
    const straight = bakeOf(straightReply!, 'the straight bake');
    const planted = bakeOf(plantedReply!, 'the bake with restore_keeps_regions_only');
    for (const r of planted.restores) {
      expect(firstDiff(rows(r.steps, ID), rows(straight.steps.filter((s) => s.step >= r.from), ID)), `restored from ${r.from} under the planted restore, every step hash and array equals playing's`).toBeNull();
    }
    const from60 = planted.restores.find((r) => r.from === 60)?.checkpoints[ID]?.find((c) => c.step === 120)?.deep_hash;
    expect(from60, 'the planted restore from 60 reaches checkpoint 120').toBeDefined();
    expect(from60, 'and its full-state hash there differs from playing\'s: the flag is gone').not.toBe(straight.checkpoints[ID]?.find((c) => c.step === 120)?.deep_hash);
    const d = determinismOf(det!, 'logic.determinism with restore_keeps_regions_only');
    expect(d.verdict, 'logic.determinism fails the planted restore').toBe('FAIL');
    const deep = d.failures.filter((f) => f.run === 'seek');
    expect(deep.filter((f) => f.field !== 'deep_hash'), 'no seek fails on a step hash or an array').toEqual([]);
    expect(deep.map((f) => [f.from, f.checkpoint]), `the seek restored from 60 fails on the full-state hash of checkpoint 120, the first after it, and no other: ${JSON.stringify(d.failures)}`).toEqual([[60, 120]]);
    const reveal = d.failures.filter((f) => f.run === 'probe' && f.control === 'reveal');
    expect(reveal.length, `the continuation probe that presses Reveal fails: ${JSON.stringify(d.failures)}`).toBeGreaterThan(0);
    expect(reveal.every((f) => f.array === `${ID}.shown`), 'it names the array that differs, flag.shown').toBe(true);
    expect(d.failures.filter((f) => f.run === 'probe' && f.control !== 'reveal'), 'the probe that presses A passes: both states then hold the flag').toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} a planted check that compares step hashes alone (check_compares_step_hashes) passes that planted restore`, () => {
    const [det] = onMac([determinismCall(secretPiece(), SPEC, AT_TIMES)], ['restore_keeps_regions_only', 'check_compares_step_hashes']);
    const d = determinismOf(det!, 'logic.determinism comparing step hashes alone, with restore_keeps_regions_only');
    expect([d.verdict, d.failures], 'step hashes alone pass the restore that lost the flag').toEqual(['PASS', []]);
  }, TIMEOUT);
});
