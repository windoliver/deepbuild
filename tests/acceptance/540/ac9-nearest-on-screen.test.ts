// AC9 #540.3d447f83: Inside the margin the nearest on screen wins: two 1 px point marks 4 px apart on screen, at 5 m and
// 50 m, with a press 1 px from the far one and 3 px from the near one, name the far one; at equal screen distance the
// nearer in depth wins, the same on 100 runs. A planted pick by nearest depth fails, naming the press
//
// The scene (fixtures.ts `pointsDoc`): `near`, a 1 px point at depth 5 on the centre of pixel (500, 500), and `far`, a
// 1 px point at depth 50 on the centre of pixel (504, 500), 4 px apart; the point control `aim` (`targets: [near,
// far]`, `margin: 3`) under the camera at the origin looking along −Z, fov 90° on 1000 × 1000. Through `deep-show run`: a
// click at (503.5, 500.5), 1 px from `far`'s pixel centre and 3 px from `near`'s, then 100 clicks at (502.5, 500.5), 2
// px from each, in one run. The planted `point_pick_nearest_depth` takes the target pixel nearest in depth inside the
// margin.
import { describe, expect, it } from 'vitest';
import { EYE_POSE, FAR_AT, FAR_PX, NEAR_AT, NEAR_PX, pointsDoc } from './fixtures.ts';
import { off, project, type V2 } from './geometry.ts';
import {
  AC, DOC, Script, TIMEOUT, binOf, entriesOf, entryName, failsNaming, none, prebuild, presented, runShow, scenario, show, useTemp, valueOf,
  type JsonObject, type Planted,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(9);
const NEARER_FAR: V2 = [503.5, 500.5];
const BETWEEN: V2 = [502.5, 500.5];
const RUNS = 100;
const named = (e: JsonObject | null): string => { const h = e ? valueOf(e).hit : null; return h === null ? 'nothing' : h.set === 0 ? 'near' : h.set === 1 ? 'far' : show(h); };

function judge(planted?: Planted): { failures: string[]; first: JsonObject | null } {
  const s = new Script();
  s.present(D, pointsDoc());
  const first = s.click(NEARER_FAR);
  const ties = [...Array(RUNS).keys()].map(() => s.click(BETWEEN));
  const r = runShow(binOf(), scenario(temp(), [{ id: D, size: EYE_POSE.size }], s.calls, planted), 'AC9 the presses between two points');
  presented(r[0]!, 'the two points');
  const press = (c: [number, number]): JsonObject | null => entriesOf(r, c, 'aim').find((e) => valueOf(e).phase === 'press') ?? null;
  const failures: string[] = [];
  const p = press(first);
  if (named(p) !== 'far') failures.push(`${p ? entryName(p) : 'the press'} at (503.5, 500.5), 1 px from far and 3 px from near on screen, names ${named(p)}, not far, the nearest on screen`);
  const wrong = ties.map(press).map((e, i) => ({ i, e, n: named(e) })).filter((x) => x.n !== 'near');
  if (wrong.length) failures.push(`${wrong.length} of ${RUNS} presses at equal screen distance name another than near, the nearer in depth: ${wrong.slice(0, 3).map((x) => `press ${x.i + 1}, ${x.e ? entryName(x.e) : 'no entry'}, names ${x.n}`).join('; ')}`);
  return { failures, first: p };
}

describe(`${AC[9]} inside the margin the target nearest on screen wins, then the nearer in depth`, () => {
  it(`${AC[9]} the press 1 px from the far point names it; at equal screen distance the nearer in depth wins, the same on 100 presses`, () => {
    expect(off(project(EYE_POSE, NEAR_AT)!, NEAR_PX), 'the test\'s own geometry: near lands on pixel (500, 500)\'s centre').toBeLessThan(1e-9);
    expect(off(project(EYE_POSE, FAR_AT)!, FAR_PX), 'and far on pixel (504, 500)\'s').toBeLessThan(1e-9);
    none(judge().failures, 'the presses between the two points');
  }, TIMEOUT);

  it(`${AC[9]} planted point_pick_nearest_depth names near for the press 1 px from far and fails, naming the press`, () => {
    const twin = judge('point_pick_nearest_depth');
    expect(named(twin.first), 'under the planted pick the press 1 px from far names near').toBe('near');
    failsNaming(twin.failures, [/the press entry of aim at t \d+ at \(503\.5, 500\.5\)/], 'the planted point_pick_nearest_depth');
  }, TIMEOUT);
});
