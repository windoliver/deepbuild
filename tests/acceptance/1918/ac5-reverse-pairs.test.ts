// #1918.4bdfb685: a test backend that wraps Rapier but iterates contact pairs in reverse gives an occurrence list equal to
// Rapier's, byte for byte, for a four-legged table landing and a ball hitting a floor, since `a` is the lower ID, normals
// point from `a` to `b` and ties sort by shape-use index.
//
// The test backend is deep-physics built with the cargo feature `test-reverse-pairs` (README: The test backend): it reads
// the engine's contact pairs last to first, each from its second shape's side. The table (shape uses: 0 its top, 1 to 4
// its legs) drops flat 0.2 m onto the floor, so its four legs touch at one step, four rows tied on (step, kind, a, b) that
// only the shape-use index orders; the ball drops 1 m. Both land at ≥ 1.98 m/s, so each contact_begin has its hit.
// "Byte for byte": the rows as JSON with every sign of zero kept, and the bake's `occurrences_hash`. The twin
// `--planted occurrences_in_engine_order` keeps what the backend reads, in its order and orientation, so the reversed
// backend's list must differ from Rapier's: the equality can fail.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, TIMEOUT, bake, box, canonical, caught, dynamic, floor, listFailures, none, normalFailures, occurrencesHash, pairFailures, physics,
  prebuild, prebuildReversed, reversedBin, rowsOf, sphere, world, type JsonObject, type PhysicsPlanted, type Row, type Want,
} from './helpers.ts';

prebuild();
prebuildReversed();

const ID = CRITERIA[5];
/** 0.6 s: both land and settle, and nothing falls asleep (0.5 s after settling). */
const STEPS = 72;
const MATERIALS = { ground: { friction: 0.6, restitution: 0, density: 1000 }, wood: { friction: 0.5, restitution: 0, density: 600 } };
const LEGS: [number, number, number][] = [[0.55, 0.22, 0.35], [-0.55, 0.22, 0.35], [-0.55, 0.22, -0.35], [0.55, 0.22, -0.35]];
const table = world({
  contact_materials: MATERIALS,
  shapes: { floor: box([5, 0.1, 5]), top: box([0.6, 0.03, 0.4]), leg: box([0.03, 0.22, 0.03]) },
  bodies: {
    floor: floor('ground', [5, 0.1, 5]),
    table: { kind: 'dynamic', shapes: [{ shape: 'top', contact_material: 'wood', offset: { pos: [0, 0.47, 0] } }, ...LEGS.map((pos) => ({ shape: 'leg', contact_material: 'wood', offset: { pos } }))], pose: { pos: [0, 0.2, 0] } },
  },
});
const ball = world({
  contact_materials: MATERIALS,
  shapes: { floor: box([5, 0.1, 5]), ball: sphere(0.1) },
  bodies: { floor: floor('ground', [5, 0.1, 5]), ball: dynamic('ball', 'wood', [0, 1.1, 0]) },
});
/** What the fixtures' landings write (floor < table; ball < floor), tied rows by shape use. */
const LEGS_TOUCH: Want[] = [
  ...[1, 2, 3, 4].map((leg) => ({ kind: 'contact_begin', a: 'floor', b: 'table', aUse: 0, bUse: leg })),
  ...[1, 2, 3, 4].map((leg) => ({ kind: 'hit', a: 'floor', b: 'table', aUse: 0, bUse: leg })),
];
const BALL_TOUCH: Want[] = [{ kind: 'contact_begin', a: 'ball', b: 'floor', aUse: 0, bUse: 0 }, { kind: 'hit', a: 'ball', b: 'floor', aUse: 0, bUse: 0 }];

interface Baked { rows: Row[]; hash: string; text: string }
function bakeBoth(w: JsonObject, what: string, planted?: PhysicsPlanted): { rapier: Baked; reversed: Baked } {
  const one = (bin: string | undefined, who: string): Baked => {
    const [r] = physics([bake(w, STEPS, { read: [] })], { ...(bin ? { bin } : {}), ...(planted ? { planted } : {}), where: who });
    const rows = rowsOf(r, `${what} on ${who}`);
    return { rows, hash: occurrencesHash(r, `${what} on ${who}`), text: canonical(r!['occurrences']) };
  };
  return { rapier: one(undefined, 'Rapier'), reversed: one(reversedBin(), 'the reversed test backend') };
}
/** The two lists byte for byte: the same rows, signs of zero kept, and the same occurrences_hash. */
function sameFailures(x: { rapier: Baked; reversed: Baked }, what: string): string[] {
  const f: string[] = [];
  if (x.rapier.text !== x.reversed.text) f.push(`${what}: the reversed backend's list differs from Rapier's:\n    Rapier:   ${x.rapier.text.slice(0, 1500)}\n    reversed: ${x.reversed.text.slice(0, 1500)}`);
  if (x.rapier.hash !== x.reversed.hash) f.push(`${what}: occurrences_hash ${x.reversed.hash} on the reversed backend, ${x.rapier.hash} on Rapier`);
  return f;
}

describe(`${ID} a test backend iterating contact pairs in reverse gives Rapier's occurrence list byte for byte`, () => {
  it(`${ID} (equal) for a four-legged table landing and a ball hitting a floor, the reversed backend's list is Rapier's byte for byte: a the lower ID, normals from a to b, ties by shape-use index`, () => {
    const t = bakeBoth(table, 'the table');
    const b = bakeBoth(ball, 'the ball');
    const step = t.rapier.rows[0]?.step;
    none([
      ...listFailures(t.rapier.rows, LEGS_TOUCH, 'the table on Rapier'),
      ...t.rapier.rows.filter((r) => r.step !== step).map((r) => `the table on Rapier: the legs don't all touch at one step: ${r.kind} ${r.bUse} at step ${r.step}, the first at ${step}`),
      ...t.rapier.rows.flatMap((r) => normalFailures(r, [0, 1, 0], 'the table on Rapier')),
      ...listFailures(b.rapier.rows, BALL_TOUCH, 'the ball on Rapier'),
      ...b.rapier.rows.flatMap((r) => normalFailures(r, [0, -1, 0], 'the ball on Rapier')),
      ...pairFailures([...t.rapier.rows, ...b.rapier.rows], 'Rapier'),
    ], 'Rapier\'s lists are the landings the fixtures write');
    expect(t.rapier.hash, 'two different lists hash differently').not.toBe(b.rapier.hash);
    none([...sameFailures(t, 'the table'), ...sameFailures(b, 'the ball')], 'the reversed backend\'s lists are Rapier\'s byte for byte');
  }, TIMEOUT);

  it(`${ID} (twin) occurrences_in_engine_order, which keeps the pairs in the order and orientation the backend reads them, gives the reversed backend another list than Rapier's`, () => {
    caught(sameFailures(bakeBoth(table, 'the table (planted)', 'occurrences_in_engine_order'), 'the table (planted)'), 'occurrences_in_engine_order');
  }, TIMEOUT);
});
