// AC7 #540.cd0a870f: In lockstep at 20 Hz with a delay of 4 steps, a box drawn around 6 of 10 units moving across its
// edge at 10 m/s selects those 6 on every copy; a planted box that keeps only its corners and selects at the apply step
// takes 4 and fails, naming the entry
//
// The match (fixtures.ts `lockstepDoc`): `net@1` with 2 players, step rate 20, delay 4 and window 0; ten units fed by
// `army` (all moving along +x at 10 m/s, 0.5 m a step); the point control `box` (`on: {plane: {y: 0}}`, `drag: box`,
// `targets: [units]`); `orders`, a logic item reading `box` that selects the units a release's keys name (programs.ts).
// Seen from straight above, 40 m across 800 × 800. Through `deep-show run`: the match's document presented, the scope
// read, a box drag from (240, 240) to (560, 560) px, the ground square x, z in [−8, 8], released at exactly 1 s (step
// 20), and `match` over 40 steps (every copy over a test relay). At the gesture six units lie inside the square; four
// steps later two of them (4 and 5) have crossed its +x edge. The planted `box_keys_at_apply` fills the release's unit
// keys at the step the entry applies, from the units' positions then, and keeps nothing from the gesture but corners.
import { describe, expect, it } from 'vitest';
import { DELAY, MATCH_POSE, MATCH_STEP, MOVING_ARMY, SQUARE, SQUARE_PRESS, SQUARE_RELEASE, lockstepDoc } from './fixtures.ts';
import type { V2 } from './geometry.ts';
import {
  AC, DOC, FLICKS, FRAME, MS, Script, TIMEOUT, arr, binOf, entriesOf, entriesText, entryName, failsNaming, isObject, lastArray, none, num, obj,
  once, prebuild, presented, putEvidence, runShow, scenario, show, stepsOf, useTemp, valueOf, type JsonObject, type Planted,
} from './helpers.ts';
import { UNITS, armyProgram, ordersProgram, unitAt } from './programs.ts';

prebuild();
const temp = useTemp();
const D = DOC(7);
const RELEASE_AT = FLICKS;
const PRESS_AT = RELEASE_AT - 4 * FRAME;
const SIX = [0, 1, 2, 3, 4, 5];
/** The slots whose units stand inside the square after step k (the test's own positions, as `army` writes them). */
const insideAt = (k: number): number[] => [...Array(UNITS).keys()].filter((i) => { const [x, , z] = unitAt(MOVING_ARMY, i, k); return Math.abs(x) < SQUARE && Math.abs(z) < SQUARE; });

interface Run { failures: string[]; release: JsonObject | null; selections: (number[] | null)[] }
function judge(planted?: Planted): Run {
  const ev = temp();
  const army = armyProgram(MOVING_ARMY);
  const orders = ordersProgram();
  for (const p of [army, orders]) putEvidence(ev, p.bytes);
  const s = new Script();
  s.present(D, lockstepDoc(army, orders));
  s.scope();
  s.until(PRESS_AT - 200 * MS);
  const p0 = SQUARE_PRESS, p1 = SQUARE_RELEASE;
  const drag = s.drag([p0, ...[1, 2].map((i): V2 => [p0[0] + ((p1[0] - p0[0]) * i) / 3, p0[1] + ((p1[1] - p0[1]) * i) / 3]), p1]);
  const mt = s.match(D, 40);
  const r = runShow(binOf(), scenario(ev, [{ id: D, size: MATCH_POSE.size }], s.calls, planted), 'AC7 the box in lockstep');
  presented(r[0]!, 'the match');
  expect(s.calls[drag[drag.length - 1]!]!['at'], 'the fixture: the box is released at 1 s, step 20').toBe(RELEASE_AT);

  const failures: string[] = [];
  const releases = entriesOf(r, drag, 'box').filter((e) => valueOf(e).phase === 'release');
  const release = releases.length === 1 ? releases[0]! : null;
  const selections: (number[] | null)[] = [];
  if (!release) failures.push(`the box drag writes ${entriesText(entriesOf(r, drag, 'box'))}, not one release`);
  else {
    const name = entryName(release);
    const units = valueOf(release).units;
    const keys = units ? units.keys.filter((k) => k !== null && k[1] === 1).map((k) => k[0]).sort((a, b) => a - b) : null;
    if (!units || units.truncated || units.keys.length !== keys?.length || JSON.stringify(keys) !== JSON.stringify(SIX)) failures.push(`${name} records units ${show(units)}, not the 6 drawn inside the box at the gesture, slots 0 to 5 with generation 1, untruncated (it takes ${keys?.length ?? 0})`);
    const t = typeof release['t'] === 'number' ? release['t'] : NaN;
    if (!(t >= RELEASE_AT + DELAY * MATCH_STEP)) failures.push(`${name} is stamped at ${String(release['t'])}, less than 4 match steps (${DELAY * MATCH_STEP} flicks) after the gesture at ${RELEASE_AT}`);
  }
  const m = obj(r[mt]!, 'the match');
  expect(m['code'], `the match call answers, not refuses: ${show(m, 1500)}`).toBeUndefined();
  const copies = arr(m['copies'], 'the match: copies').filter(isObject);
  if (copies.length !== 2) failures.push(`the match reports ${copies.length} copies, not 2`);
  for (const c of copies) {
    const player = num(c['player'], 'a copy\'s player');
    const steps = stepsOf(c['steps'], `copy ${player}`);
    const selected = lastArray(steps, 'orders.selected');
    const got = selected ? selected.flatMap((v, i) => (v === 1 ? [i] : [])) : null;
    selections.push(got);
    if (JSON.stringify(got) !== JSON.stringify(SIX)) failures.push(`copy ${player} selects ${got?.length ?? 0} units ${show(got)}, not those 6 ${show(SIX)}, reading ${release ? entryName(release) : 'no release'}`);
    if (JSON.stringify(lastArray(steps, 'orders.releases')) !== '[1]') failures.push(`copy ${player} reads ${show(lastArray(steps, 'orders.releases'))} releases, not 1`);
  }
  return { failures, release, selections };
}

const honest = once(() => judge());

describe(`${AC[7]} a box in lockstep records the units drawn inside it at the gesture, so every copy selects what the player saw`, () => {
  it(`${AC[7]} the box drawn around 6 of 10 moving units selects those 6 on every copy`, () => {
    // The test's own fixture: six inside at the gesture (steps 19 to 20), four once the entry applies (steps 24 to 26).
    for (const k of [19, 20]) expect(insideAt(k), `the fixture: units 0 to 5 lie inside the square at step ${k}`).toEqual(SIX);
    for (const k of [24, 25, 26]) expect(insideAt(k), `the fixture: units 0 to 3 alone lie inside the square at step ${k}`).toEqual([0, 1, 2, 3]);
    none(honest().failures, 'the release, its unit keys and every copy\'s selection');
  }, TIMEOUT);

  it(`${AC[7]} planted box_keys_at_apply takes 4 and fails, naming the entry`, () => {
    const twin = judge('box_keys_at_apply');
    expect(twin.selections, 'under the planted box every copy selects the 4 units inside the square at the apply step').toEqual([[0, 1, 2, 3], [0, 1, 2, 3]]);
    failsNaming(twin.failures, [/takes 4|selects 4 units/, /the release entry of box at t \d+/], 'the planted box_keys_at_apply');
  }, TIMEOUT);
});
