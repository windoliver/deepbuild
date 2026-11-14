// AC6 #540.097a4bdc: Throw at a click while orbiting: in a lab whose 1 m box stands on another, after the viewer has
// orbited 40° about the target, a press over the top box's face centre derives one launch of a 1 kg ball with
// gravity_scale 0 from the press's ray.origin at 20 m/s along its ray.dir, and the ball's first contact_begin names the
// top box; orbiting another 90° and replaying the track gives the same step hashes and the same contact; and a planted
// derivation that reads the camera at replay instead of the stored ray launches along another line after the second
// orbit and fails, naming the step
//
// The lab (fixtures.ts `labDoc`): static boxes `base` and `top` (`top` on `base`), a 1 kg ball of radius 0.1 m with
// gravity_scale 0 at rest aside, and the world input `throw`, a `launch` derived from each entry of the point control
// `aim` with `from` a pose at `aim.ray.origin` and `linear` 20 × `aim.ray.dir`; the camera at (0, 1.5, 10) looks at the
// top box's centre. Through `deep-show run`: the lab presented, the scope read, the viewer's orbit of 40° about the
// target (a 160 px drag with the middle button), the scope read, a press over the centre of the top box's +Z face at
// the pixel geometry.ts projects it to under the orbited pose, `world` (the lab baked again over the span on the track),
// the press's release after the span (so the press alone derives a launch), another orbit of 90° (360 px), the scope
// read and `world` again. The planted `throw_reads_camera` derives each launch at replay from the pointer's position
// through the camera as it is then, not from the entry's stored ray.
import { describe, expect, it } from 'vitest';
import { FACE_CENTRE, LAB_POSE, LAB_TARGET, SPEED, labDoc } from './fixtures.ts';
import { cross, fmt, len, mul, off, orbitEye, project, sub, unit, type V2, type V3 } from './geometry.ts';
import {
  AC, DOC, FLICKS, MS, Script, TIMEOUT, arr, binOf, cameraOf, entriesOf, entryName, failsNaming, isObject, none, num, obj, once, prebuild,
  presented, runShow, scenario, show, str, useTemp, valueOf, type JsonObject, type JsonValue, type Planted,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(6);
const DISTANCE = len(sub(LAB_POSE.eye, LAB_TARGET));
/** The orbited eye: 40° about the target (a drag to the right lowers the azimuth). */
const EYE: V3 = orbitEye(LAB_TARGET, DISTANCE, -40, 0);
const ORBITED = { ...LAB_POSE, eye: EYE };
const PX: V2 = project(ORBITED, FACE_CENTRE)!;
const DIR: V3 = unit(sub(FACE_CENTRE, EYE));

interface Bake { hashes: string[]; ball: { pos: V3; linear: V3 }[]; first: { step: number; a: string; b: string } | null }
function bakeOf(reply: JsonObject, what: string): Bake {
  expect(reply['code'], `${what}: the world call answers, not refuses: ${show(reply, 1500)}`).toBeUndefined();
  const hashes = arr(reply['step_hashes'], `${what}: step_hashes`).map((h, i) => str(h, `${what}: step_hashes[${i}]`));
  const states = arr(obj(reply['bodies'], `${what}: bodies`)['ball'], `${what}: bodies.ball`);
  const v3 = (v: JsonValue | undefined, k: string): V3 => arr(v, k).map((x, i) => num(x, `${k}[${i}]`)) as V3;
  const ball = states.map((s, j) => { const o = obj(s, `${what}: ball[${j}]`); return { pos: v3(o['pos'], `${what}: ball[${j}].pos`), linear: v3(o['linear'], `${what}: ball[${j}].linear`) }; });
  const rows = arr(reply['occurrences'], `${what}: occurrences`).filter(isObject).filter((r) => r['kind'] === 'contact_begin');
  const firstRow = rows.sort((x, y) => Number(x['step']) - Number(y['step']))[0];
  return { hashes, ball, first: firstRow ? { step: Number(firstRow['step']), a: String(firstRow['a']), b: String(firstRow['b']) } : null };
}
const firstText = (c: Bake['first']): string => (c ? `contact_begin ${c.a} and ${c.b} at step ${c.step}` : 'no contact_begin');

interface Run { launch: string[]; replay: string[]; press: JsonObject | null }
function judge(planted?: Planted): Run {
  const s = new Script();
  s.present(D, labDoc());
  const seen = s.scope();
  s.orbit([200, 500], 160);
  const orbited = s.scope();
  const down = s.down(PX);
  const first = s.world(D, 'lab');
  s.until(3.2 * FLICKS - 200 * MS);
  const up = s.up(PX, 'primary', 200 * MS);
  s.orbit([200, 500], 360);
  const again = s.scope();
  const second = s.world(D, 'lab');
  const r = runShow(binOf(), scenario(temp(), [{ id: D, size: LAB_POSE.size }], s.calls, planted), 'AC6 the throw');
  presented(r[0]!, 'the lab');

  // The fixture: the press is made after the 40° orbit, from the pose the expected ray comes from; the second orbit turns 90° more.
  const c0 = cameraOf(r[seen]!, 'the scope');
  const c1 = cameraOf(r[orbited]!, 'the scope after the first orbit');
  expect(off(c0.position, LAB_POSE.eye), 'the fixture: the scope shows the lab camera at (0, 1.5, 10)').toBeLessThan(1e-9);
  expect(off(c1.position, EYE), `the fixture: after the 160 px middle-button drag the eye has orbited 40° about the target to ${fmt(EYE, 6)} (it is at ${fmt(c1.position, 6)})`).toBeLessThan(1e-9);
  expect(Math.abs(Math.abs(cameraOf(r[again]!, 'the scope after the second orbit').azimuth - c1.azimuth) - 90), 'the fixture: the second drag orbits 90° more').toBeLessThan(1e-9);

  const launch: string[] = [];
  const press = entriesOf(r, [down, up], 'aim').find((e) => valueOf(e).phase === 'press') ?? null;
  if (!press) return { launch: [`the press writes no press entry of aim: ${show(r[down]!['appended'] ?? null)}`], replay: [], press };
  const ray = valueOf(press).ray;
  if (!ray || off(ray.origin, EYE) > 1e-9 || off(ray.dir, DIR) > 1e-9) launch.push(`${entryName(press)} stores ray ${show(ray)}, not from the orbited eye ${fmt(EYE, 6)} along ${fmt(DIR, 6)}`);
  const a = bakeOf(r[first]!, 'the bake after the press');
  const moving = a.ball.findIndex((st) => len(st.linear) > 1e-6);
  if (moving < 0) launch.push('the ball never moves: no launch was derived from the press');
  else {
    const st = a.ball[moving]!;
    const line = len(cross(sub(st.pos, EYE), DIR));
    if (off(st.linear, mul(DIR, SPEED)) > 1e-3 || line > 1e-3) launch.push(`at step ${moving} the ball moves at ${fmt(st.linear, 4)} m/s from ${fmt(st.pos, 4)}, ${line.toFixed(4)} m off the press's ray, not at 20 m/s along it from its origin`);
    const until = a.first ? a.first.step : a.ball.length - 1;
    const relaunched = a.ball.slice(moving, until).findIndex((x) => off(x.linear, st.linear) > 1e-3);
    if (relaunched >= 0) launch.push(`the ball's velocity changes at step ${moving + relaunched} before any contact: more than one launch`);
  }
  if (!a.first || [a.first.a, a.first.b].sort().join(' ') !== 'ball top') launch.push(`the ball's first contact is ${firstText(a.first)}, not a contact_begin of the ball and the top box`);

  const replay: string[] = [];
  const b = bakeOf(r[second]!, 'the bake after the second orbit');
  const k = a.hashes.findIndex((h, i) => b.hashes[i] !== h);
  if (k >= 0 || a.hashes.length !== b.hashes.length) replay.push(`after the second orbit the replay's step ${k >= 0 ? k : Math.min(a.hashes.length, b.hashes.length)} hash differs (${a.hashes[k] ?? 'none'} then ${b.hashes[k] ?? 'none'}): it launched along another line than ${entryName(press)}'s stored ray`);
  if (firstText(a.first) !== firstText(b.first)) replay.push(`after the second orbit the first contact is ${firstText(b.first)}, not ${firstText(a.first)}`);
  return { launch, replay, press };
}

const honest = once(() => judge());

describe(`${AC[6]} a throw derived from a press's stored ray replays the same however the camera turns`, () => {
  it(`${AC[6]} after a 40° orbit the press derives one launch from its ray.origin at 20 m/s along its ray.dir, and the ball's first contact_begin names the top box`, () => {
    none(honest().launch, 'the press, its launch and the first contact');
  }, TIMEOUT);

  it(`${AC[6]} orbiting another 90° and replaying gives the same step hashes and the same contact`, () => {
    none(honest().replay, 'the replay after the second orbit');
  }, TIMEOUT);

  it(`${AC[6]} planted throw_reads_camera launches along another line after the second orbit and fails, naming the step`, () => {
    const twin = judge('throw_reads_camera');
    none(twin.launch, 'the planted derivation: the live press and its launch are unchanged');
    failsNaming(twin.replay, [/step \d+ hash differs/], 'the replay after the second orbit under throw_reads_camera');
  }, TIMEOUT);
});
