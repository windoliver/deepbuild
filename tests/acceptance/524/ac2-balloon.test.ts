// #524.f05ac03c: "A balloon with inflate 1.2 reaches the backend as a target volume ratio of 1.2, read back from the
// built body, and a world document that gives a balloon a pressure is refused, naming the field"
//
// Two balloons in one world (helpers.ts: twoBalloons): `b12`, radius 0.5 m, subdivisions 2, inflate 1.2, and `b15`, the
// same with inflate 1.5, so a ratio that isn't the document's own can't pass. `check`'s `soft` reads each built body's
// target volume ratio back from the backend's built body (README: `check`): 1.2 and 1.5, within f32's rounding (1e-6).
// The refusal: the same world with `pressure: 2` on `b12` is refused at check with an error issue whose `path` ends
// soft/b12/pressure; the world without it is admitted, so a check that refuses balloons for any other reason fails.
import { describe, expect, it } from 'vitest';
import { CRITERIA, TIMEOUT, admitted, ask, builtOf, check, errorsOf, prebuild, show, twoBalloons, type JsonObject } from './helpers.ts';

prebuild();
const ID = CRITERIA[2];
const segments = (path: unknown): string[] => (typeof path === 'string' ? path.split(/[/.]/).filter((s) => s !== '') : []);

describe(`${ID} a balloon's inflate reaches the backend as its target volume ratio, and a pressure is refused, naming the field`, () => {
  it(`${ID} a balloon with inflate 1.2 reaches the backend as a target volume ratio of 1.2, read back from the built body`, () => {
    const [reply] = ask([check(twoBalloons())]);
    const built = builtOf(reply, 'the two balloons');
    const want: Record<string, number> = { b12: 1.2, b15: 1.5 };
    for (const [id, ratio] of Object.entries(want)) {
      const b = built.soft[id];
      expect(b, `the backend built ${id}: ${show(built.soft as unknown as JsonObject)}`).toBeDefined();
      expect(b!.shape, `${id} is a balloon`).toBe('balloon');
      expect(b!.targetVolumeRatio, `${id}'s built body holds a target volume ratio`).not.toBeNull();
      expect(Math.abs(b!.targetVolumeRatio! - ratio), `${id}'s built body reads a target volume ratio of ${b!.targetVolumeRatio}, its inflate ${ratio} (within f32 rounding, 1e-6)`).toBeLessThanOrEqual(1e-6);
    }
  }, TIMEOUT);

  it(`${ID} a world document that gives a balloon a pressure is refused at check, naming the field`, () => {
    const [plain, pressed] = ask([check(twoBalloons()), check(twoBalloons({ pressure: 2 }))]);
    admitted(plain, 'the balloons without a pressure');
    const errors = errorsOf(pressed, 'the balloon given a pressure');
    const naming = errors.filter((e) => segments(e['path']).slice(-3).join('/') === 'soft/b12/pressure');
    expect(naming.map((e) => show(e)), `an error issue at soft/b12/pressure: ${show(errors)}`).not.toEqual([]);
  }, TIMEOUT);
});
