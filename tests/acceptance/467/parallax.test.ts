// AC4 #467.2680a499: A parallax group's offset equals its closed form in the camera pose and t at 1,000 random times,
// and adding a terrain cell never changes another cell's tile
// (this file carries its first clause; terrain.test.ts the second)
//
// AC6 #467.0c9e76a0: In a 4.7 s looping document, a cloud band with repeat [170, 0] and drift [170 ÷ 4.7, 0] u/s and a
// near band with repeat [340, 0] and drift [340 ÷ 4.7, 0] u/s pass, their offsets at 0 and at 4.7 s equal within 1e-3 u;
// a marquee band with repeat [881, 0] in a 4.8 s loop with drift [−183.5, 0] u/s travels 880.8 u and is refused at
// check, naming the group and the 0.2 u jump; and a planted check that compares offsets without the repeat's modulo
// refuses the cloud band and fails, naming it
//
// A group's offset is `deep-canvas-render path`'s frame `parallax.offset` for the group (#160's `path`, every platform),
// and the closed form is the design's, computed here in f64: origin + the camera's position × (1 − rate) + drift × t,
// wrapped by repeat with a floored modulo. The camera is #149's 2D `camera@1`; its position is its `target`. The
// tolerance is the issue's for a parallax offset, 1e-3 u. The planted check is `check`'s `planted:
// "parallax_without_modulo"`. README: The surface under test; Readings.
import { describe, expect, it } from 'vitest';
import {
  AC, CAM_X, CAM_Y, CLOUDS, FLICKS, HILLS, LOOP_S, NEAR, bands, cameraParallax, check, closedForm, describeErrors, failsNaming,
  fl, keyedAt, marquee, none, numbersIn, parallaxOffsets, seeded, useBin, wrappedGap, type Issue, type JsonObject,
} from './helpers.ts';

const bin = useBin('deep-canvas-render');
const TOLERANCE = 1e-3;

describe(`${AC[4]} a parallax group's offset in closed form`, () => {
  it(`${AC[4]} the offset equals its closed form in the camera pose and t at 1,000 random times`, () => {
    const rand = seeded(4672);
    const times = Array.from({ length: 1000 }, () => Math.floor(rand() * fl(10)));
    const got = parallaxOffsets(bin(), cameraParallax(), 'hills', times, 'the hills under a moving camera');
    const off = times.flatMap((t, i) => {
      const cam: [number, number] = [keyedAt(CAM_X, t), keyedAt(CAM_Y, t)];
      const want = closedForm(HILLS, cam, t / FLICKS);
      const gap = Math.max(...[0, 1].map((a) => wrappedGap(got[i]![a]!, want[a]!, HILLS.repeat[a]!)));
      return gap > TOLERANCE ? [`at ${t} flicks (camera [${cam.map((c) => c.toFixed(4)).join(', ')}]): offset [${got[i]!.join(', ')}], closed form [${want.map((w) => w.toFixed(6)).join(', ')}], ${gap.toExponential(3)} u apart`] : [];
    });
    expect(off, `every offset within ${TOLERANCE} u of its closed form (${off.length} of 1,000 aren't):\n${off.slice(0, 20).join('\n')}`).toEqual([]);
  });
});

/** Each band the check refuses in the bands document: what a planted check must give, naming the band. */
function loopProblems(answer: JsonObject, errors: Issue[]): string[] {
  const named = ['clouds', 'near'].flatMap((g) => errors.filter((e) => e.ids.includes(g)).map((e) => `the ${g} band is refused at check (${e.code}), though it travels a whole number of repeats a loop`));
  return named.length || answer['ok'] === true ? named : [`the bands document is refused at check: ${describeErrors(errors)}`];
}

describe(`${AC[6]} parallax bands in a loop`, () => {
  it(`${AC[6]} the cloud band and the near band pass, their offsets at 0 and at 4.7 s equal within 1e-3 u`, () => {
    const d = bands();
    const { answer, errors } = check(bin(), d);
    none(loopProblems(answer, errors), 'the bands pass the check');
    expect(answer['ok'], `the bands document passes the check: ${describeErrors(errors)}`).toBe(true);
    for (const [group, p] of [['clouds', CLOUDS], ['near', NEAR]] as const) {
      const [start, end, mid] = parallaxOffsets(bin(), d, group, [0, fl(LOOP_S), fl(LOOP_S / 2)], `the ${group} band`);
      const want = closedForm(p, [0, 0], LOOP_S / 2);
      expect(Math.abs(mid![0] - want[0]), `the ${group} band drifts: half way through the loop its offset is ${mid![0]}, its closed form ${want[0]}`).toBeLessThanOrEqual(TOLERANCE);
      for (const a of [0, 1]) expect(Math.abs(end![a]! - start![a]!), `the ${group} band's offset on axis ${a} at 4.7 s (${end![a]}) equals its offset at 0 (${start![a]}) within 1e-3 u`).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  it(`${AC[6]} the marquee band, which travels 880.8 u in its 4.8 s loop, is refused at check, naming the group and the 0.2 u jump`, () => {
    const { answer, errors } = check(bin(), marquee());
    expect(answer['ok'], 'the marquee is refused at check').toBe(false);
    const named = errors.filter((e) => e.ids.includes('marquee'));
    expect(named.length, `an error names the marquee group: ${describeErrors(errors)}`).toBeGreaterThan(0);
    const jumps = named.flatMap((e) => numbersIn(e.raw)).filter((v) => Math.abs(Math.abs(v) - 0.2) <= TOLERANCE);
    expect(jumps.length, `the error carries the 0.2 u jump as a number: ${JSON.stringify(named.map((e) => e.raw)).slice(0, 1500)}`).toBeGreaterThan(0);
  });

  it(`${AC[6]} a planted check that compares offsets without the repeat's modulo refuses the cloud band and fails, naming it`, () => {
    const { answer, errors } = check(bin(), bands(), { planted: 'parallax_without_modulo' });
    failsNaming(loopProblems(answer, errors), 'clouds', 'the check without the repeat\'s modulo');
  });
});
