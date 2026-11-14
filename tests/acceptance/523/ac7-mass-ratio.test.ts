// #523.84b7ab39: a hand box of 0.1 × 0.1 × 0.02 m at density 1,000 kg/m³ with no declared mass (0.2 kg), joined to a
// torso declared at 40 kg, raises `physics.mass_ratio` naming the joint, the hand, the torso and the ratio 200; the same
// hand declared at 5 kg (8:1), or at 4 kg (exactly 10:1), raises none; and a planted check that reads only declared
// masses misses the 200:1 hand and fails, naming the joint.
//
// Criterion 7's world (README: The fixtures), checked three times in one run of `deep-physics`'s `check` (the world
// check the physics module's issues come from at the base): the hand's mass derived, declared 5 kg, declared 4 kg.
// The issue (README: The check) is one with `code: "physics.mass_ratio"`; it names an ID when the ID
// is in its `ids` or is a word of its `what`, and its ratio is a number at `ratio`, `actual` or `actual.ratio`, or a
// number in its `what`, within 1% of 200. The torso's material has a density too (36 kg for its box), so a check that
// derives every mass, declared or not, reads 180:1 and 9:1 and fails as well. The twin `mass_ratio_declared_only`
// must fail, the failure naming the joint `wrist`.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, HAND_MASS, TIMEOUT, TORSO_MASS, answered, arr, caught, check, isObject, none, obj, physics, prebuild, show, wrist,
  type JsonObject, type Planted,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[7];
const RATIO = Math.round(TORSO_MASS / HAND_MASS);
const CODE = 'physics.mass_ratio';

const issuesOf = (reply: JsonObject | undefined, what: string): JsonObject[] =>
  arr(answered(reply, what)['issues'], `${what}: issues`).map((v, i) => obj(v, `${what}: issues[${i}]`)).filter((i) => i['code'] === CODE);
/** The issue names `id`: in its `ids`, or as a word of its `what`. */
const namesId = (issue: JsonObject, id: string): boolean =>
  (Array.isArray(issue['ids']) && issue['ids'].includes(id)) || (typeof issue['what'] === 'string' && new RegExp(`\\b${id}\\b`).test(issue['what']));
/** The ratio the issue names, structured or in its text, within 1% of 200. */
function namesRatio(issue: JsonObject): boolean {
  const actual = issue['actual'];
  const numbers = [issue['ratio'], actual, isObject(actual) ? actual['ratio'] : undefined].filter((x): x is number => typeof x === 'number');
  if (typeof issue['what'] === 'string') numbers.push(...[...issue['what'].matchAll(/\d+(?:\.\d+)?/g)].map(([n]) => Number(n)));
  return numbers.some((x) => Math.abs(x - RATIO) <= RATIO * 0.01);
}

function massFailures(planted?: Planted): string[] {
  const [derived, eight, ten] = physics([check(wrist()), check(wrist(5)), check(wrist(4))], planted, 'the hand and the torso');
  const f: string[] = [];
  const raised = issuesOf(derived, 'the 0.2 kg hand (density × volume)');
  const good = raised.filter((i) => ['wrist', 'hand', 'torso'].every((id) => namesId(i, id)) && namesRatio(i));
  if (!good.length) f.push(`no ${CODE} issue names the joint wrist, the hand, the torso and the ratio ${RATIO} for the 0.2 kg hand (density × volume) on the 40 kg torso: ${show(raised)}`);
  for (const [reply, what] of [[eight, 'the hand declared at 5 kg (8:1)'], [ten, 'the hand declared at 4 kg (exactly 10:1)']] as const) {
    const any = issuesOf(reply, what);
    if (any.length) f.push(`${what} raises ${CODE}, which only a ratio past 10:1 raises: ${show(any)}`);
  }
  return f;
}

describe(`${ID} a joint whose two dynamic bodies' masses differ by more than 10:1 raises physics.mass_ratio at check`, () => {
  it(`${ID} (ratio) the 0.2 kg hand of density × volume on a 40 kg torso raises physics.mass_ratio naming the joint, the hand, the torso and the ratio 200; at 8:1 and at exactly 10:1 none`, () => {
    none(massFailures(), 'physics.mass_ratio reads declared and derived masses');
  }, TIMEOUT);

  it(`${ID} (twin: mass_ratio_declared_only) a planted check that reads only declared masses misses the 200:1 hand and fails, naming the joint`, () => {
    const f = massFailures('mass_ratio_declared_only');
    caught(f, 'mass_ratio_declared_only, judged on the hand');
    expect(f.join('\n'), 'the failure names the joint').toContain('wrist');
  }, TIMEOUT);
});
