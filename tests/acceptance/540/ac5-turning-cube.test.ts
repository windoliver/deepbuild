// AC5 #540.4d24f725: A 1 m cube at the origin turning about +Y at 90°/s by a channel, the target of a point control
// with on surface, seen by an orthographic camera looking along −Z: a press at 0.5 s whose ray passes x = 0.2, y = 0
// writes point (0.2, 0, 0.5071) within 1/1024 m and normal (0.7071, 0, 0.7071) within 1e-4, as the cube stands turned
// 45° when the CPU evaluates it at the press's flick; a planted hit that meets the cube at rest writes (0.2, 0, 0.5)
// with normal (0, 0, 1) and fails, naming the entry; and a press beside the cube writes hit and surface none, and with
// targets [] the same control is refused at check, naming the control
//
// The scene (fixtures.ts `cubeDoc`): `cube`, a 1 m `mark.box@1` at the origin whose `at.rot` y the channel `spin` keys
// at 90°/s, the point control `aim` (`on: surface`, `targets: [cube]`), under an orthographic camera at (0, 0, 10)
// looking along −Z, 4 m across 400 × 400 px. Through `deep-show run`: the scene presented, a click whose press comes
// at exactly 0.5 s on the scenario's clock (the flick a press's entry is stamped at, #504) at (220, 200) px, the ray
// x = 0.2, y = 0; a click beside the cube at (350, 200), x = 1.5; and the same scene with `targets: []` shown as a
// second document. Expected: the test's own f64 face of the cube turned 45° about +Y, normal (sin 45°, 0, cos 45°), met
// by the ray. The planted `surface_at_rest` meets the cube as it stands at rest.
import { describe, expect, it } from 'vitest';
import { CUBE_POSE, DEG_PER_S, cubeDoc } from './fixtures.ts';
import { fmt, off, rad, STEP_1024, type V2, type V3 } from './geometry.ts';
import {
  AC, DOC, FLICKS, MS, Script, TIMEOUT, binOf, entriesOf, entryName, failsNaming, isObject, issuesOf, none, prebuild, presented, runShow,
  scenario, show, showCall, useTemp, valueOf, type JsonObject, type Planted,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(5);
const D_EMPTY = DOC(51);
const AT = FLICKS / 2;
const ON: V2 = [220, 200];
const BESIDE: V2 = [350, 200];
/** Where the ray x = 0.2, y = 0 along −Z meets the cube turned θ about +Y, and that face's normal. */
function hitAt(theta: number): { point: V3; normal: V3 } {
  const normal: V3 = [Math.sin(rad(theta)), 0, Math.cos(rad(theta))];
  return { point: [0.2, 0, (0.5 - normal[0] * 0.2) / normal[2]], normal };
}
const TURNED = hitAt((DEG_PER_S * AT) / FLICKS);

function judge(planted?: Planted): { failures: string[]; press: JsonObject | null; refusal: JsonObject } {
  const s = new Script();
  s.present(D, cubeDoc(['cube']));
  s.until(AT - 200 * MS);
  const [down, up] = s.click(ON);
  const [bDown, bUp] = s.click(BESIDE);
  const empty = s.calls.push(showCall(D_EMPTY, cubeDoc([]), s.now + MS)) - 1;
  const r = runShow(binOf(), scenario(temp(), [{ id: D, size: CUBE_POSE.size }, { id: D_EMPTY, size: CUBE_POSE.size }], s.calls, planted), 'AC5 the presses on the cube');
  presented(r[0]!, 'the turning cube with targets [cube]');
  expect(s.calls[down]!['at'], 'the fixture: the press comes at 0.5 s').toBe(AT);

  const failures: string[] = [];
  const press = entriesOf(r, [down, up], 'aim').find((e) => valueOf(e).phase === 'press') ?? null;
  if (!press) failures.push(`the press at 0.5 s writes no press entry of aim: ${show(r[down]!['appended'] ?? null)}`);
  else {
    const name = entryName(press);
    if (press['t'] !== AT) failures.push(`${name} is stamped at ${String(press['t'])}, not at 0.5 s (${AT}), the flick the cube stands turned 45° at`);
    const v = valueOf(press);
    if (!v.hit || v.hit.set !== 0) failures.push(`${name} writes hit ${show(v.hit)}, not {set 0, key [0, 0]}`);
    const sf = v.surface;
    if (!sf || off(sf.point, TURNED.point) > STEP_1024 || !sf.normal || off(sf.normal, TURNED.normal) > 1e-4) {
      failures.push(`${name} writes point ${sf ? fmt(sf.point, 6) : 'none'} and normal ${sf?.normal ? fmt(sf.normal, 6) : 'none'}, not (0.2, 0, 0.5071) within 1/1024 m and (0.7071, 0, 0.7071) within 1e-4, the cube turned 45° at the press's flick`);
    }
  }
  const beside = entriesOf(r, [bDown, bUp], 'aim').find((e) => valueOf(e).phase === 'press') ?? null;
  if (!beside) failures.push(`the press beside the cube writes no press entry of aim: ${show(r[bDown]!['appended'] ?? null)}`);
  else if (valueOf(beside).hit !== null || valueOf(beside).surface !== null) failures.push(`${entryName(beside)}, beside the cube, writes hit ${show(valueOf(beside).hit)} and surface ${show(valueOf(beside).surface)}, not none`);
  return { failures, press, refusal: r[empty]! };
}

describe(`${AC[5]} a surface hit meets the item as the CPU evaluates it at the press's flick`, () => {
  it(`${AC[5]} the press at 0.5 s writes point (0.2, 0, 0.5071) and normal (0.7071, 0, 0.7071); a press beside writes hit and surface none; targets [] is refused at check, naming the control`, () => {
    expect(off(TURNED.point, [0.2, 0, 0.5071]), 'the test\'s own geometry: the turned face meets the ray at (0.2, 0, 0.5071)').toBeLessThan(1e-4);
    expect(off(TURNED.normal, [0.7071, 0, 0.7071])).toBeLessThan(1e-4);
    const run = judge();
    none(run.failures, 'the presses on and beside the turning cube');
    const issues = issuesOf(run.refusal).filter((i) => i['severity'] === 'error');
    expect(run.refusal['outcome'], `the control with targets [] is refused at check: ${show(run.refusal, 1500)}`).not.toBe('presented');
    const naming = issues.filter((i) => !['unknown_kind', 'unknown_field'].includes(String(i['code'])) && (
      (Array.isArray(i['ids']) && i['ids'].includes('aim')) || (typeof i['path'] === 'string' && /^controls\/aim(\/|$)/.test(i['path'])) || (isObject(i['actual']) && i['actual']['control'] === 'aim')));
    expect(naming.length, `an error, other than an unknown kind or field, names the control aim: ${show(issues, 1500)}`).toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${AC[5]} planted surface_at_rest writes (0.2, 0, 0.5) with normal (0, 0, 1) and fails, naming the entry`, () => {
    const twin = judge('surface_at_rest');
    const sf = twin.press ? valueOf(twin.press).surface : null;
    expect(sf && off(sf.point, [0.2, 0, 0.5]), 'under the planted hit the press meets the cube at rest, (0.2, 0, 0.5)').toBeLessThanOrEqual(STEP_1024);
    expect(sf?.normal && off(sf.normal, [0, 0, 1]), 'with normal (0, 0, 1)').toBeLessThan(1e-4);
    failsNaming(twin.failures, [/the press entry of aim at t \d+/, /0\.5071/], 'the planted surface_at_rest');
  }, TIMEOUT);
});
