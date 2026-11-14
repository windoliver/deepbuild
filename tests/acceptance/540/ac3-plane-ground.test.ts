// AC3 #540.c9bfe882: On a level plane y = 0 seen from a camera 10 m up, looking 30° below the horizon, a press at the
// view's centre writes a ground point 17.3205 m (10 ÷ tan 30°) ahead of the camera's foot, within 1/1024 m; a press
// above the horizon writes ground none; and a planted ray test that also meets the plane behind the camera writes a
// point for that press and fails, naming the entry
//
// The scene (fixtures.ts `planeDoc`): a camera at (0, 10, 0) aimed at (0, 0, 10 ÷ tan 30°), fov 90° on 800 × 800, a
// plate drawn on y = 0 and the point control `aim` with `on: {plane: {y: 0}}`. Through `deep-show run`: the scene
// presented, the scope read, a click at the view's centre (400, 400) and one at (400, 100), 36.9° above the view's
// axis and so 6.9° above the horizon, whose ray never meets the plane ahead of the eye (its line meets it behind). The
// planted `ground_meets_behind_eye` meets the whole line through the pointer with the plane, behind the eye too.
import { describe, expect, it } from 'vitest';
import { AHEAD, PLANE_POSE, planeDoc } from './fixtures.ts';
import { fmt, meetLine, meetPlane, off, rayAt, STEP_1024, type V2 } from './geometry.ts';
import {
  AC, DOC, Script, TIMEOUT, binOf, cameraOf, entriesOf, entryName, failsNaming, none, prebuild, presented, runShow, scenario, show, useTemp,
  valueOf, type JsonObject, type Planted,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(3);
const CENTRE: V2 = [400, 400];
const ABOVE: V2 = [400, 100];

function judge(planted?: Planted): { failures: string[]; above: JsonObject | null } {
  const s = new Script();
  s.present(D, planeDoc());
  const seen = s.scope();
  const [centreDown, centreUp] = s.click(CENTRE);
  const [aboveDown, aboveUp] = s.click(ABOVE);
  const r = runShow(binOf(), scenario(temp(), [{ id: D, size: PLANE_POSE.size }], s.calls, planted), 'AC3 the presses');
  presented(r[0]!, 'the level plane');
  const cam = cameraOf(r[seen]!, 'the scope');
  expect(off([...cam.position, ...cam.target, cam.fov], [...PLANE_POSE.eye, ...PLANE_POSE.target, PLANE_POSE.fov!]), `the fixture: the scope shows the camera 10 m up looking 30° down (it shows ${fmt(cam.position)} to ${fmt(cam.target)})`).toBeLessThan(1e-9);

  const failures: string[] = [];
  const press = (i: number, j: number): JsonObject | null => entriesOf(r, [i, j], 'aim').find((e) => valueOf(e).phase === 'press') ?? null;
  const centre = press(centreDown, centreUp);
  const want = meetPlane(rayAt(PLANE_POSE, CENTRE), 0)!;
  if (!centre) failures.push(`the press at the view's centre writes no press entry of aim: ${show(r[centreDown]!['appended'] ?? null)}`);
  else {
    const g = valueOf(centre).ground;
    if (!g || off(g, want) > STEP_1024) failures.push(`${entryName(centre)} writes ground ${g ? fmt(g, 6) : 'none'}, not within 1/1024 m of ${fmt(want, 6)}, 17.3205 m ahead of the camera's foot`);
    else if (Math.abs(Math.hypot(g[0], g[2]) - AHEAD) > STEP_1024) failures.push(`${entryName(centre)}'s ground point lies ${Math.hypot(g[0], g[2]).toFixed(6)} m from the camera's foot, not 17.3205 m within 1/1024 m`);
  }
  const above = press(aboveDown, aboveUp);
  if (!above) failures.push(`the press above the horizon writes no press entry of aim: ${show(r[aboveDown]!['appended'] ?? null)}`);
  else if (valueOf(above).ground !== null) failures.push(`${entryName(above)} writes ground ${fmt(valueOf(above).ground!, 4)} for a press above the horizon, a point the line through the pointer meets only behind the eye; it writes none`);
  return { failures, above };
}

describe(`${AC[3]} a ground point on a level plane is where the pointer's ray meets it ahead of the eye`, () => {
  it(`${AC[3]} the centre press writes a ground point 17.3205 m ahead of the camera's foot within 1/1024 m, and a press above the horizon writes ground none`, () => {
    // The test's own geometry: the centre ray meets y = 0 at 10 ÷ tan 30° = 17.3205 m; the upper press's ray meets it only behind the eye.
    expect(Math.abs(AHEAD - 17.3205)).toBeLessThan(1e-4);
    expect(meetPlane(rayAt(PLANE_POSE, ABOVE), 0), 'the fixture: the press above the horizon meets the plane nowhere ahead').toBeNull();
    expect(meetLine(rayAt(PLANE_POSE, ABOVE), 0)![2], 'the fixture: its line meets the plane behind the camera').toBeLessThan(0);
    none(judge().failures, 'the presses at the centre and above the horizon');
  }, TIMEOUT);

  it(`${AC[3]} planted ground_meets_behind_eye writes a point for the press above the horizon and fails, naming the entry`, () => {
    const twin = judge('ground_meets_behind_eye');
    expect(twin.above && valueOf(twin.above).ground, 'under the planted ray test the press above the horizon writes a point').not.toBeNull();
    failsNaming(twin.failures, [/the press entry of aim at t \d+/, /above the horizon/], 'the planted ground_meets_behind_eye');
  }, TIMEOUT);
});
