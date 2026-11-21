// #2240.cb44a798: "`centre_of_mass` on a static body, on a kinematic body and on a character body is each refused at
// check, naming the field, and so is the point (0, 3, 0) on the 2 m box, naming the box's bounds. A planted check that
// accepts the last builds the body and fails"
//
// `check` (#2009's call) of the level world (README: The fixtures) with its body `box` made static, kinematic or a
// character body (one capsule) and writing `centre_of_mass` at a point inside its shape: each is refused by an error
// issue whose path is the field's, `bodies/box/centre_of_mass`. The base refuses the field on every body as one it
// doesn't know, so each refusal is held beside two worlds the check takes: the same body with no `centre_of_mass`, and
// a dynamic body of the same shape writing the same point. The refusal is then the kind's, of a field the reader knows.
// The point (0, 3, 0) on the dynamic 2 m box is refused at the field by an issue whose sentence names the box's bounds
// as numbers, −0.5 and 0.5, −1 and 1 (README: The refusals), while (0, −0.75, 0) is taken.
// `check_accepts_centre_outside` takes (0, 3, 0): its check lists no error and its bake builds the box, so the
// refusal's judge fails, naming the field.
import { describe, expect, it } from 'vitest';
import {
  BOX_HALF, BOX_MASS, CRITERIA, FIELD, LOW, TIMEOUT, ask, bakeRead, baked, caught, checkCall, fieldIssues, fieldPath, fieldRefusalFailures, naming,
  none, numbersIn, obj, prebuildBuilds, show, standWorld, statesOf, takenFailures, type JsonObject, type V3,
} from './helpers.ts';

prebuildBuilds(['release']);

const ID = CRITERIA[3];
/** The criterion's point, 2 m above the box's top face. */
const OUTSIDE: V3 = [0, 3, 0];
/** A capsule 1.6 m tall, a character body's one shape, and a point inside it. */
const CAPSULE: JsonObject = { kind: 'capsule', half_height: 0.5, radius: 0.3 };
const IN_CAPSULE: V3 = [0, -0.25, 0];

/**
 * The level world with its body `box` of `kind`: the 2 m box as the fixture writes it with only its kind changed, or,
 * with `capsule`, one capsule standing on the ground (a character body holds one capsule and declares no mass).
 */
function kindWorld(kind: string, capsule: boolean, centre?: V3): JsonObject {
  const w = standWorld(0, capsule ? undefined : centre);
  const bodies = obj(w['bodies'], 'the level world\'s bodies');
  const body: JsonObject = capsule
    ? { kind, shapes: [{ shape: 'capsule', contact_material: 'box' }], pose: { pos: [0, 0.81, 0] }, ...(kind === 'dynamic' ? { mass: BOX_MASS } : {}), ...(centre ? { [FIELD]: centre } : {}) }
    : { ...obj(bodies['box'], 'the box'), kind };
  return { ...w, shapes: { ...obj(w['shapes'], 'the level world\'s shapes'), capsule: CAPSULE }, bodies: { ...bodies, box: body } };
}
const KINDS: { kind: string; capsule: boolean; point: V3 }[] = [
  { kind: 'static', capsule: false, point: LOW },
  { kind: 'kinematic', capsule: false, point: LOW },
  { kind: 'character', capsule: true, point: IN_CAPSULE },
];

/** The box's bounds as a refusal names them: each face's coordinate, m (the faces across z are at x's ±0.5). */
const BOUNDS = [-BOX_HALF[0], BOX_HALF[0], -BOX_HALF[1], BOX_HALF[1]];
/** Everything wrong with the refusal of (0, 3, 0) on the box: no error issue at the field, or none whose sentence names the box's bounds. Each failure names the field. */
function outsideFailures(reply: JsonObject | undefined, what: string): string[] {
  const at = fieldIssues(reply, 'box', what);
  if (at.length === 0) return fieldRefusalFailures(reply, 'box', what);
  const bounded = at.filter((i) => BOUNDS.every((b) => numbersIn(typeof i['what'] === 'string' ? i['what'] : '').includes(b)));
  return bounded.length ? [] : [`${fieldPath('box')}: ${what} is refused, but no issue's sentence names the box's bounds (${BOUNDS.join(', ')}): ${show(at)}`];
}

describe(`${ID} centre_of_mass is a dynamic body's: another kind's is refused at check, and so is a point outside the body's shapes`, () => {
  it(`${ID} centre_of_mass on a static body, on a kinematic body and on a character body is each refused at check, naming the field, where the same body without it and a dynamic body with it are taken`, () => {
    const replies = ask(KINDS.flatMap((k) => [checkCall(kindWorld(k.kind, k.capsule, k.point)), checkCall(kindWorld(k.kind, k.capsule)), checkCall(kindWorld('dynamic', k.capsule, k.point))]));
    none(KINDS.flatMap((k, i) => [
      ...fieldRefusalFailures(replies[3 * i], 'box', `${FIELD} on a ${k.kind} body`),
      ...takenFailures(replies[3 * i + 1], `the ${k.kind} body with no ${FIELD}`),
      ...takenFailures(replies[3 * i + 2], `${FIELD} ${show(k.point)} on a dynamic body of the ${k.kind} body's shape`),
    ]), 'the three refusals by kind');
  }, TIMEOUT);

  it(`${ID} the point (0, 3, 0) on the 2 m box is refused at check, naming the field and the box's bounds, where the point (0, −0.75, 0) is taken`, () => {
    const [outside, inside] = ask([checkCall(standWorld(0, OUTSIDE)), checkCall(standWorld(0, LOW))]);
    console.log(`the point (0, 3, 0) on the 2 m box: ${show(outside?.['issues'])}`);
    none([
      ...outsideFailures(outside, 'the point (0, 3, 0) on the 2 m box'),
      ...takenFailures(inside, 'the point (0, −0.75, 0) on the 2 m box'),
    ], 'the refusal of a point outside the box');
  }, TIMEOUT);

  it(`${ID} (twin: check_accepts_centre_outside) a check that accepts the point (0, 3, 0) builds the body and fails, naming the field`, () => {
    const w = standWorld(0, OUTSIDE);
    const [checked, built] = ask([checkCall(w), bakeRead(w, 1, ['box'])], 'check_accepts_centre_outside');
    expect(takenFailures(checked, 'the point (0, 3, 0) under the planted check'), 'the planted check accepts the point (0, 3, 0)').toEqual([]);
    expect(statesOf(baked(built, 'the box with centre_of_mass (0, 3, 0) under the planted check'), 'box', 2, 'the box under the planted check').length, 'the planted check builds the body: the bake holds the box as built and after a step').toBe(2);
    const failures = outsideFailures(checked, 'the point (0, 3, 0) on the 2 m box');
    caught(failures, 'check_accepts_centre_outside');
    naming(failures, /^bodies\/box\/centre_of_mass: /, 'check_accepts_centre_outside\'s failure names the field');
  }, TIMEOUT);
});
