// #3258.940c680d: "On the pinned backend, #524's banner, its rope and the behavior kit's soft fixtures read 0, and a rope
// dragged over a box's top edge and down its side for 2 s reads 0 at the corner. Any that reads more is listed in the PR
// with its step, and its fixture changes only through its proposal"
//
// The pinned backend is this checkout's `deep-physics` as shipped. Its behavior kit holds no soft fixture at the base
// (README: Where the issue and the base disagree), so beside #524's banner and rope this reads its two lab documents that
// hold soft bodies, and whatever soft fixtures the kit has: each kit fixture whose world holds a soft body, over its own
// steps and track.
//
// The rope is dragged: 61 particles 0.025 m apart lie on a box, 5 cm of the rope past its top edge, its end pinned to a
// kinematic body that goes straight down the side at 0.4 m/s for 2 s. Read back from the same build's bake, each particle's
// straight moves against the box: ten or more particles go from the top to the side, ten or more go in by the top face and
// come out of the side one (each cuts the corner, the two normals at a right angle), and none comes out of the face opposite
// the one it went in by, so by the issue's far side nothing is through. The box is thicker than the rope's gaps, so it is the
// particles' to hold.
import { describe, expect, it } from 'vitest';
import { prebuild } from '../191/helpers.ts';
import {
  AC, CRATE, DRAG_STEPS, LABS, ROPE, TIMEOUT, arr, audit, bakes, draggedRope, isObject, labOf, none, obj, pathsOf, pinned, readOf,
  ropeAndBanner, str, told, zeroFailures, type JsonObject, type Lab, type V3,
} from './helpers.ts';

prebuild(['shipped']);
const ID = AC[5];
/** 5 s, as #524's audits of its labs. */
const STEPS = 600;
const holdsSoft = (world: JsonObject | undefined): boolean => isObject(world?.['soft']) && Object.keys(world['soft']).length > 0;

type Face = readonly [axis: 0 | 1 | 2, side: 1 | -1];
const FACES: readonly Face[] = ([0, 1, 2] as const).flatMap((a): Face[] => [[a, 1], [a, -1]]);
/** Each time a particle's straight moves between its states take it out of the crate: the face it went in by and the one it came out of. */
function ways(path: readonly V3[]): { into: Face | null; out: Face }[] {
  const beyond = (p: V3, [a, s]: Face): number => s * (p[a] - (a === 1 ? CRATE[1] : 0)) - CRATE[a];
  const all: { into: Face | null; out: Face }[] = [];
  let into: Face | null = null;
  for (let k = 1; k < path.length; k++) {
    let [from, to] = [0, 1];
    let [entered, left]: [Face | null, Face | null] = [null, null];
    for (const f of FACES) {
      const [a, b] = [beyond(path[k - 1]!, f), beyond(path[k]!, f)];
      if (a > 0 && b > 0) from = 2;
      else if (a > 0 && a / (a - b) > from) [from, entered] = [a / (a - b), f];
      else if (b > 0 && a / (a - b) < to) [to, left] = [a / (a - b), f];
    }
    if (from >= to) continue;
    if (entered) into = entered;
    if (left) { all.push({ into, out: left }); into = null; }
  }
  return all;
}

describe(`${ID} what doesn't pass through reads 0 on the pinned backend`, () => {
  it(`${ID} #524's banner and its rope, its labs that hold soft bodies and the behavior kit's soft fixtures read 0`, () => {
    const kit = arr(pinned([{ call: 'behavior_fixtures' }])[0]!['fixtures'], 'behavior_fixtures: fixtures').map((f, i) => obj(f, `fixtures[${i}]`)).filter((f) => holdsSoft(isObject(f['world']) ? f['world'] : undefined));
    const labs = (Object.keys(LABS) as Lab[]).filter((n) => holdsSoft(labOf(n).doc));
    expect(labs, 'the labs that hold soft bodies').toEqual(['bridge', 'banner']);
    const clean: [string, JsonObject][] = [
      ['#524\'s banner and its rope', audit(ropeAndBanner(), STEPS)],
      ...labs.map((n): [string, JsonObject] => [`the ${n} lab`, audit(labOf(n), STEPS)]),
      ...kit.map((f): [string, JsonObject] => [`the kit's ${str(f['name'], 'a fixture\'s name')}`, { call: 'audit', world: f['world'] ?? null, track: f['track'] ?? [], steps: f['steps'] ?? STEPS }]),
    ];
    console.log(`the behavior kit's soft fixtures: ${kit.length}`);
    const replies = pinned(clean.map(([, c]) => c));
    const reads = clean.map(([name], i) => ({ name, r: readOf(replies[i], name) }));
    for (const { name, r } of reads) console.log(`${name}: ${told(r)}`);
    none(reads.flatMap(({ name, r }) => zeroFailures(r, name)), 'the audits of soft bodies that pass through nothing');
  }, 2 * TIMEOUT);

  it(`${ID} a rope dragged over a box's top edge and down its side for 2 s reads 0 at the corner`, () => {
    const w = draggedRope();
    const what = 'the rope dragged over the edge';
    const [baked, reply] = pinned([bakes(w, DRAG_STEPS), audit(w, DRAG_STEPS)]);
    const path = pathsOf(baked, ROPE, DRAG_STEPS, what);
    const onTop = (p: V3): boolean => p[0] < CRATE[0] && p[1] > 2 * CRATE[1];
    const onSide = (p: V3): boolean => p[0] > CRATE[0] - 0.01 && p[1] < 2 * CRATE[1] - 0.05;
    const dragged = path[0]!.filter((p, i) => onTop(p) && onSide(path[DRAG_STEPS]![i]!)).length;
    const left = path[0]!.flatMap((_, i) => ways(path.map((s) => s[i]!)));
    const cut = left.filter((x) => x.into?.[0] === 1 && x.into[1] === 1 && x.out[0] === 0 && x.out[1] === 1).length;
    const far = left.filter((x) => x.into !== null && x.into[0] === x.out[0] && x.into[1] !== x.out[1]).length;
    console.log(`${what}: ${dragged} particles go from the top to the side; ${cut} go in by the top and out of the side, ${far} out of the face opposite the one they went in by, of ${left.length} times one leaves the box`);
    expect([dragged >= 10, cut >= 10, far], `the fixture: ten particles or more go over the edge (${dragged}), ten or more cut its corner (${cut}), and none comes out of a far side`).toEqual([true, true, 0]);
    const r = readOf(reply, what);
    console.log(`${what}: ${told(r)}`);
    none(zeroFailures(r, what), `the audit of ${what}`);
  }, 2 * TIMEOUT);
});
