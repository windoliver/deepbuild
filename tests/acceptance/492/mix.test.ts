// AC1 #492.7cd93cd7: Two mix placements in either order and from two writers give identical evaluated data bit for bit,
// a channel missing from one counts as the base, and weights summing above 1 aren't normalized
// (parity/animation/mix-order-free.film).
//
// Through `deep-motion eval` on the fixture. Two placements mix on item `dot`: mix-left (weight 0.8, writer agent-a) keys
// x, y and a rotation; mix-right (weight 0.7, writer agent-b) keys x and a rotation and no y; 0.8 + 0.7 = 1.5. The closed
// form is Placement: order-free mix, base + Σ wᵢ (vᵢ − base), and for rotations the normalized sum of quaternions aligned
// to the base (the issue's Scope); mix-right's quaternion is written negated, so an unaligned sum fails. The twin swaps
// the placements' `order`, their writers and their order in the file. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, aligned, clone, evalAll, accepted, fixture, none, normalizeQ, obj, posOr, quatDistance, quatOf, quatOr, secs, seededTimes, fl, useMotion,
  type JsonObject, type Quat,
} from './helpers.ts';

const motion = useMotion();
const FILM = fixture('parity/animation/mix-order-free.film');
const BASE = { x: 10, y: 20, q: quatOf([0, 0, 1], 20) };
const W = { left: 0.8, right: 0.7 };
const LEFT_TURN = quatOf([0, 0, 1], 50);
const RIGHT_TURN = quatOf([0, 0, 1], 80);
const TIMES = seededTimes(492_01, 60, 0, fl(4));

/** The same placements with their order, writers and place in the file swapped. */
function swapped(doc: JsonObject): JsonObject {
  const out = clone(doc);
  const placements = obj(out['placements'], 'placements');
  const left = obj(placements['mix-left'], 'mix-left'); const right = obj(placements['mix-right'], 'mix-right');
  [left['order'], right['order']] = [right['order']!, left['order']!];
  [left['layer'], right['layer']] = [right['layer']!, left['layer']!];
  out['placements'] = { 'mix-right': right, 'mix-left': left };
  return out;
}

const leftX = (s: number): number => 40 + (20 - 40) * (s / 4);
const leftY = (s: number): number => 26 + (38 - 26) * (s / 4);
const rightX = (s: number): number => -10 + (6 + 10) * (s / 4);
/** base + Σ wᵢ (vᵢ − base), on x: never normalized. */
const wantX = (s: number): number => BASE.x + W.left * (leftX(s) - BASE.x) + W.right * (rightX(s) - BASE.x);
/** On y mix-right has no channel, so it counts as the base and adds nothing. */
const wantY = (s: number): number => BASE.y + W.left * (leftY(s) - BASE.y);
function wantQ(): Quat {
  const l = aligned(LEFT_TURN, BASE.q); const r = aligned(RIGHT_TURN, BASE.q); const b = BASE.q;
  return normalizeQ([0, 1, 2, 3].map((k) => b[k]! + W.left * (l[k]! - b[k]!) + W.right * (r[k]! - b[k]!)) as Quat);
}

describe(`${AC[1]} two mix placements are order-free and from two writers, a missing channel counts as the base, and weights aren't normalized`, () => {
  it(`${AC[1]} either order and writers read the same data bit for bit, and it is base + Σ wᵢ (vᵢ − base) at weights summing to 1.5`, () => {
    const [one, two] = evalAll(motion.bin(), [{ doc: FILM, times: TIMES }, { doc: swapped(FILM), times: TIMES }]);
    const a = accepted(one!, TIMES, 'the fixture');
    const b = accepted(two!, TIMES, 'the fixture with order and writers swapped');
    const failures: string[] = [];
    a.frames.forEach((f, i) => {
      const s = secs(f.t); const other = b.frames[i]!;
      const x = posOr(f, 'dot', 0); const y = posOr(f, 'dot', 1); const q = quatOr(f, 'dot');
      if (!(Math.abs(x - wantX(s)) <= 1e-9)) failures.push(`at ${f.t} flicks x reads ${x}, not ${wantX(s)}`);
      if (!(Math.abs(y - wantY(s)) <= 1e-9)) failures.push(`at ${f.t} flicks y reads ${y}, not ${wantY(s)}: the channel mix-right lacks counts as the base`);
      if (!(quatDistance(q, wantQ()) <= 1e-9)) failures.push(`at ${f.t} flicks the rotation reads ${JSON.stringify(q)}, not ${JSON.stringify(wantQ())}`);
      const left = JSON.stringify(f.items); const right = JSON.stringify(other.items);
      if (left !== right) failures.push(`at ${f.t} flicks the two orders differ: ${left.slice(0, 300)} against ${right.slice(0, 300)}`);
    });
    none(failures, 'the two mix placements at 60 seeded times');
    expect(Math.abs(wantX(0) - (BASE.x + (wantX(0) - BASE.x) / 1.5)), 'fixture: normalizing the weights would move x').toBeGreaterThan(1);
  }, TIMEOUT);
});
