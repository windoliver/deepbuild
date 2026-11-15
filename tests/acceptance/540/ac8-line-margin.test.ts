// AC8 #540.430b1895: A 1 px `mark.line` from (−2, −10, −5) to (−2, 10, −5) m, seen from the origin along −Z with fov
// 90° on a 1,000 × 1,000 view, draws in pixel column 300. A press at column 302 with margin 3 names the line, and a
// press at column 304 names what lies under it, or nothing. A planted one-pixel readback misses the press at 302 and
// fails, naming the press
//
// The scene (fixtures.ts `railDoc`): the line `rail` and the point control `aim` (`on: {plane: {y: −10}}`, `targets:
// [rail]`, `margin: 3`) under a camera at the origin looking along −Z, fov 90° on 1000 × 1000 (a focal length of 500
// px, so x = −2 at depth 5 lands at column 500 + 500 (−2) ÷ 5 = 300). Through `deep-show run`: a click at the centre of
// column 302 (302.5, 700.5), 2 px from the line's, and one at column 304 (304.5, 700.5), 4 px from it, over nothing
// drawn. The planted `point_pick_one_pixel` reads only the object-ID pixel under the pointer.
import { describe, expect, it } from 'vitest';
import { EYE_POSE, RAIL, railDoc } from './fixtures.ts';
import { project, type V2 } from './geometry.ts';
import {
  AC, DOC, Script, TIMEOUT, binOf, entriesOf, entryName, failsNaming, none, prebuild, presented, runShow, scenario, show, useTemp, valueOf,
  type JsonObject, type Planted,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(8);
const AT_302: V2 = [302.5, 700.5];
const AT_304: V2 = [304.5, 700.5];

function judge(planted?: Planted): { failures: string[]; first: JsonObject | null } {
  const s = new Script();
  s.present(D, railDoc({ plane: { y: -10 } }));
  const [d1, u1] = s.click(AT_302);
  const [d2, u2] = s.click(AT_304);
  const r = runShow(binOf(), scenario(temp(), [{ id: D, size: EYE_POSE.size }], s.calls, planted), 'AC8 the presses beside the line');
  presented(r[0]!, 'the line');
  const failures: string[] = [];
  const press = (d: number, u: number): JsonObject | null => entriesOf(r, [d, u], 'aim').find((e) => valueOf(e).phase === 'press') ?? null;
  const first = press(d1, u1), second = press(d2, u2);
  if (!first) failures.push(`the press at column 302 writes no press entry: ${show(r[d1]!['appended'] ?? null)}`);
  else if (JSON.stringify(valueOf(first).hit) !== JSON.stringify({ set: 0, key: [0, 0] })) failures.push(`${entryName(first)} at column 302, 2 px from the line, names ${show(valueOf(first).hit)}, not the line rail {set 0, key [0, 0]}`);
  if (!second) failures.push(`the press at column 304 writes no press entry: ${show(r[d2]!['appended'] ?? null)}`);
  else if (valueOf(second).hit !== null) failures.push(`${entryName(second)} at column 304, 4 px from the line over nothing drawn, names ${show(valueOf(second).hit)}, not nothing`);
  return { failures, first };
}

describe(`${AC[8]} a point control's margin finds a thin target near the pointer`, () => {
  it(`${AC[8]} the line draws in column 300; a press at column 302 with margin 3 names it, and one at column 304 names nothing`, () => {
    for (const p of RAIL) expect(project(EYE_POSE, p)![0], 'the test\'s own geometry: the line lies on x = 300 px, so it draws in column 300').toBeCloseTo(300, 9);
    none(judge().failures, 'the presses at columns 302 and 304');
  }, TIMEOUT);

  it(`${AC[8]} planted point_pick_one_pixel misses the press at 302 and fails, naming the press`, () => {
    const twin = judge('point_pick_one_pixel');
    expect(twin.first && valueOf(twin.first).hit, 'under the planted readback the press at 302 names nothing').toBeNull();
    failsNaming(twin.failures, [/the press entry of aim at t \d+ at column 302/], 'the planted point_pick_one_pixel');
  }, TIMEOUT);
});
