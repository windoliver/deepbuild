// Criterion 3 (no upstream test): "A placement with start_on {on: the logic item's occurrences, kinds: [door_open],
// policy: restart} over a 2 s door clip, when the logic emits door_open at step 300 (5.000 s at 60 Hz), shows the clip
// 1.000 s in at t = 6.000 s, played straight and after a seek to 6.000 s alike; a planted start_on that starts a run
// when a frame first reads the occurrence shows the clip 0 s in after that seek and fails the frame comparison at
// 6.000 s"
//
// The row through `deep-logic` (the latch's bake). The frames through `deep-show run`: the door (doc a: the logic item
// `latch` and the placement `swing` started on `latch.occurrences`) and two references with no logic, the same clip
// placed to start at 5 s (doc b: 1.000 s in at 6 s) and at 6 s (doc c: 0 s in at 6 s). "After a seek to 6.000 s" is
// `eval` at 6 s as the presented door's first frame, and `determinism`'s seek side (a cold jump to 7 s, then 6 s);
// "played straight" is `determinism`'s play side at a 60 Hz display (every frame from 0 up to 6 s, 5.000 s among
// them). Frames are compared by their canonical renders' SHA-256 (README: Criteria to tests).
import { describe, expect, it } from 'vitest';
import { AC, DOC, TIMEOUT, bakeCall, bakeOf, evalCall, failsNaming, none, notPresented, onMac, prebuild, present, rowText, runShow, scenario, showDeterminismCall, sidesOf, snapshotOf, type JsonObject, type ShowPlanted } from './helpers.ts';
import { DOOR_KIND, DOOR_STEP, DOOR_STEPS, DOOR_T, LATCH, T6, doorDoc, doorRefDoc, latchPiece, useDoorEvidence } from './fixtures.ts';

prebuild(['deep-logic', 'deep-show']);
const doorEvidence = useDoorEvidence();

/** The door and its references at 6.000 s: frames, and the judgement. `zeroIn` is the door's seek frame when it shows
 * the 0 s in reference's picture. */
function doorFrames(planted?: ShowPlanted): { failures: string[]; zeroIn: boolean } {
  const { ev, program } = doorEvidence();
  const replies = runShow(scenario(ev, [
    present(DOC.a, doorDoc(program)), present(DOC.b, doorRefDoc('5s')), present(DOC.c, doorRefDoc('6s')),
    evalCall(DOC.a, T6), evalCall(DOC.b, T6), evalCall(DOC.c, T6),
    showDeterminismCall(DOC.a, T6), showDeterminismCall(DOC.b, T6),
  ], planted), 'the door and its references at 6.000 s');
  const [door, ref1, ref0, seekDoor, seekRef1, seekRef0, detDoor, detRef1] = replies as [JsonObject, JsonObject, JsonObject, JsonObject, JsonObject, JsonObject, JsonObject, JsonObject];
  const fixture = [notPresented(ref1, 'the reference at 5 s'), notPresented(ref0, 'the reference at 6 s')].filter((x): x is string => x !== null);
  if (fixture.length) return { failures: fixture, zeroIn: false };
  const shown = notPresented(door, 'the door (a logic@1 item and a placement started on latch.occurrences)');
  if (shown) return { failures: [shown], zeroIn: false };
  const r1 = snapshotOf(seekRef1); const r0 = snapshotOf(seekRef0); const d = snapshotOf(seekDoor);
  if ('why' in r1 || 'why' in r0) return { failures: [`the references at 6.000 s have no frame: ${'why' in r1 ? r1.why : ''} ${'why' in r0 ? r0.why : ''}`], zeroIn: false };
  const failures: string[] = [];
  if (r1.sha === r0.sha) failures.push('the references at 6.000 s draw alike, so the comparison can\'t tell 1.000 s in from 0 s in');
  let zeroIn = false;
  if ('why' in d) failures.push(`after a seek to 6.000 s the door has no frame: ${d.why}`);
  else if (d.sha !== r1.sha) {
    zeroIn = d.sha === r0.sha;
    failures.push(`after a seek to 6.000 s the door's frame isn't the clip 1.000 s in (${zeroIn ? 'it shows the clip 0 s in' : 'it shows neither 1.000 s nor 0 s in'})`);
  }
  const sd = sidesOf(detDoor, T6); const sr = sidesOf(detRef1, T6);
  if ('why' in sr) failures.push(`the reference at 5 s has no determinism frames at 6.000 s: ${sr.why}`);
  else if ('why' in sd) failures.push(`the door has no determinism frames at 6.000 s: ${sd.why}`);
  else {
    if (sd.play !== sr.play) failures.push('played straight to 6.000 s, the door\'s frame isn\'t the clip 1.000 s in');
    if (sd.seek !== sd.play) failures.push('the frame comparison at 6.000 s fails: the door\'s frame after a seek to 6.000 s differs from its frame played straight');
  }
  return { failures, zeroIn };
}

describe(`${AC[3]} a placement started on a logic item's occurrences starts at the occurrence's time, played or seeked`, () => {
  it(`${AC[3]} the latch emits door_open once, at step ${DOOR_STEP} (5.000 s)`, () => {
    const [reply] = onMac([bakeCall(latchPiece(), { steps: DOOR_STEPS })]);
    const b = bakeOf(reply!, 'the bake of the latch, declaring emits {door_open: {fields: {}}}');
    expect(b.occurrences[LATCH]?.map(rowText), 'the latch\'s list holds one door_open row, at step 300 and 5.000 s').toEqual([rowText({ step: DOOR_STEP, t: DOOR_T, kind: DOOR_KIND, a: 1, b: 0, fields: {} })]);
  }, TIMEOUT);

  it(`${AC[3]} at t = 6.000 s the door shows the clip 1.000 s in, played straight and after a seek to 6.000 s alike`, () => {
    none(doorFrames().failures, 'the door at 6.000 s');
  }, TIMEOUT);

  it(`${AC[3]} a planted start_on that starts a run when a frame first reads the occurrence (start_on_at_first_frame) shows the clip 0 s in after the seek and fails the frame comparison at 6.000 s`, () => {
    none(doorFrames().failures, 'the door at 6.000 s');
    const planted = doorFrames('start_on_at_first_frame');
    failsNaming(planted.failures, /6\.000 s/, 'start_on_at_first_frame');
    expect(planted.zeroIn, 'after the seek to 6.000 s the planted start_on shows the clip 0 s in').toBe(true);
  }, TIMEOUT);
});
