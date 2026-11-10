// AC1 #1897.b9031214: "Jumping to a time equals playing to it, by hash"
//
// Through `deep-show run`'s `determinism` call (#488's, here with `compare: "same_machine"`) and the core's
// `document.determinism` check kind on a claim (#403's verdict path, #1162's requirement form). On one machine the
// design compares canonical renders' raw pixels "hashed on the GPU, 16 bytes read back" (Determinism: Semantics), so
// each side of each time carries `pixel_hash`, the 128-bit GPU reduction, and the two must be equal at every time; the
// verdict on the requirement passes, saying its result holds on `machines: same` (Determinism: "every result says
// machines: any or same"; Determinism class: a same-machine result "passes the same-machine check that seeking equals
// playing, on the GPU pixel hash"). The board is #488's ticking board (a `test.tick@1` item stepping at 60 Hz with a
// checkpoint every 0.5 s, a slide and a label), over its named times. Wrong programs: the base (no `pixel_hash`, and
// its verdict row says `machines: any`); #488's planted `checkpoint_nearest_in_distance`, a seek that restores the
// checkpoint nearest in distance and so shows 0.5 s's step one flick early, which the hash comparison and the verdict
// must both catch at 352,799,999 flicks.
import { describe, expect, it } from 'vitest';
import {
  AC, BEFORE_SECOND_CHECKPOINT, CHECKPOINT, DOC, TICK, TICK_BOARD, TIMEOUT, VERDICT, arr, blocked, determinismClaim, failsNaming, hash128,
  int, namedTimes, noGpu, none, obj, present, presented, requirementRow, runShow, scenario, show, useShow, useTemp, type JsonObject,
} from './helpers.ts';

const shows = useShow([TICK]);
const temp = useTemp();

interface Compared { t: number; play: string; seek: string }
/** A same-machine `determinism` reply: each time's play and seek sides by their GPU pixel hashes. */
function compared(reply: JsonObject, times: number[], what: string): Compared[] {
  if (noGpu(reply)) blocked(`no GPU to hash the canonical renders on here: ${show(reply)}`);
  expect(reply['outcome'], `${what} compared: ${show(reply)}`).toBe('compared');
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i) => {
    const f = obj(v, `${what}: frames[${i}]`);
    return {
      t: int(f['t'], `${what}: frames[${i}].t`),
      play: hash128(obj(f['play'], `${what}: frames[${i}].play`)['pixel_hash'], `${what}: frames[${i}].play.pixel_hash`),
      seek: hash128(obj(f['seek'], `${what}: frames[${i}].seek`)['pixel_hash'], `${what}: frames[${i}].seek.pixel_hash`),
    };
  });
  expect(frames.map((f) => f.t), `${what}: one comparison per time asked, ascending`).toEqual(times);
  return frames;
}
/** Seek against play by hash, in time order; each failure names the flick and both hashes. */
const hashFailures = (frames: Compared[]): string[] =>
  frames.filter((f) => f.play !== f.seek).map((f) => `at ${f.t} flicks seeking to it hashes ${f.seek}, playing to it ${f.play}`);

function seekAndPlay(planted?: string): { frames: Compared[]; row: JsonObject } {
  const times = namedTimes();
  const check = { at_times: times, compare: 'same_machine' };
  const calls = [present(TICK_BOARD), { call: 'determinism', doc: DOC, display_hz: 144, ...check }, VERDICT];
  const [shown, det, verdict] = runShow(shows.bin(TICK), scenario(temp(), calls, { claims: determinismClaim(check), planted }), planted ? `the ticking board (planted ${planted})` : 'the ticking board');
  presented(shown!, 'the ticking board');
  return { frames: compared(det!, times, 'seek against play'), row: requirementRow(verdict!, 'the verdict') };
}

describe(`${AC[1]} jumping to a time equals playing to it, by hash`, () => {
  it(`${AC[1]} on the ticking board, at every named time the seek's GPU pixel hash equals the play's, the step at 0.5 s changes the hash, and document.determinism passes holding on machines: same`, () => {
    const { frames, row } = seekAndPlay();
    none(hashFailures(frames), 'seek against play by the GPU pixel hash');
    const at = (t: number): Compared => frames.find((f) => f.t === t)!;
    expect(at(BEFORE_SECOND_CHECKPOINT).play, 'the hash sees the pixels: the tick\'s step at 0.5 s changes it').not.toBe(at(CHECKPOINT).play);
    expect(row['result'], `document.determinism on the claim passes: ${show(row)}`).toBe('PASS');
    expect(row['machines'], `a same-machine comparison of GPU pixel hashes holds on the same machine only: ${show(row)}`).toBe('same');
  }, TIMEOUT);

  it(`${AC[1]} a planted seek that restores the checkpoint nearest in distance (checkpoint_nearest_in_distance) fails by hash at 352,799,999 flicks, naming the flick, in the call and in the verdict`, () => {
    expect(BEFORE_SECOND_CHECKPOINT).toBe(352_799_999);
    const { frames, row } = seekAndPlay('checkpoint_nearest_in_distance');
    const failures = hashFailures(frames);
    failsNaming(failures, /^at 352799999 flicks/, 'the planted seek (checkpoint_nearest_in_distance)');
    expect(failures[0], 'the first time whose hashes differ is one flick before the second checkpoint').toMatch(/^at 352799999 flicks/);
    expect(row['result'], `document.determinism fails the planted seek: ${show(row)}`).toBe('FAIL');
    const issues = arr(row['issues'], 'the verdict row: issues').map((v, i) => obj(v, `the verdict row: issues[${i}]`));
    expect(issues.some((i) => i['t'] === BEFORE_SECOND_CHECKPOINT), `an issue names t = 352,799,999 flicks: ${show(issues as JsonObject[], 2000)}`).toBe(true);
  }, TIMEOUT);
});
