// AC4 #540.5ca93239: Surface hits: a point control with on surface and targets [panel], over a 2 × 2 m quad at y = 0.5
// whose corners (−1, −1), (1, −1), (1, 1) and (−1, 1) in x and z carry uv (0, 0), (1, 0), (1, 1) and (0, 1), wound to
// face +Y and split on the diagonal from (−1, −1) to (1, 1) into face 0 (x ≥ z) and face 1, seen from a camera at
// (0, 10.5, 3) aimed at the origin: a press at the pointer position whose ray, as the test computes it from the
// camera's pose, meets the quad at (0.25, 0.5, −0.5) writes hit {set 0, key [0, 0]}, point (0.25, 0.5, −0.5) within
// 1/1024 m, normal (0, 1, 0) and uv (0.625, 0.25) within 1e-9, face 0, and a ray from the camera's eye along the unit
// vector to that point within 1e-9, which a logic item reads at their offsets in its 248 B region; after the viewer
// orbits 90°, replaying the track gives the same entry; a planted hit that takes the nearest vertex's uv writes (1, 0)
// and fails, naming the entry, and one that meets the quad again from the camera at replay writes another point after
// the orbit and fails logic.determinism, naming the entry
//
// The scene (fixtures.ts `quadDoc`): the quad `panel` (a JSON glTF), the point control `aim` (`on: surface`, `targets:
// [panel]`) and `pins`, a logic item reading `aim` that keeps the last press's 256 B (programs.ts), under a camera at
// (0, 10.5, 3) aimed at the origin, fov 60° on 800 × 600. Through `deep-show run`: the scene presented, the scope read,
// a click at the pixel where geometry.ts projects (0.25, 0.5, −0.5), `logic` over 60 steps, the viewer's orbit of 90°
// (a 360 px drag with the middle button), the scope read, and `logic` again with logic.determinism. The planted
// `surface_uv_nearest_vertex` takes the uv of the hit triangle's vertex nearest the point; `surface_hit_on_replay`
// meets the quad again at every replay from the pointer through the camera as it is then.
import { describe, expect, it } from 'vitest';
import { QUAD_FACES, QUAD_POSE, QUAD_UV, QUAD_XZ, QUAD_Y, quadDoc, quadGltf, quadNormal } from './fixtures.ts';
import { fmt, off, project, sub, unit, STEP_1024, type V2, type V3 } from './geometry.ts';
import {
  AC, DOC, Script, TIMEOUT, binOf, cameraOf, entriesOf, entryName, failsNaming, hashDiff, lastArray, logicOf, namesEntry, none, once, prebuild,
  presented, putEvidence, runShow, sameEntry, scenario, show, useTemp, valueOf, verdictOf, type JsonObject, type Planted,
} from './helpers.ts';
import { FLAG, PHASE, pinsProgram, rowOf } from './programs.ts';

prebuild();
const temp = useTemp();
const D = DOC(4);
const P: V3 = [0.25, QUAD_Y, -0.5];
const PX: V2 = project(QUAD_POSE, P)!;
const DIR: V3 = unit(sub(P, QUAD_POSE.eye));
const NORMAL: V3 = quadNormal(0);
/** The uv at (x, z) on face `f` by its barycentric weights (the test's own interpolation). */
function uvOn(f: number, x: number, z: number): V2 {
  const [a, b, c] = QUAD_FACES[f]!.map((i) => QUAD_XZ[i]!);
  const det = (b![0] - a![0]) * (c![1] - a![1]) - (c![0] - a![0]) * (b![1] - a![1]);
  const wb = ((x - a![0]) * (c![1] - a![1]) - (c![0] - a![0]) * (z - a![1])) / det;
  const wc = ((b![0] - a![0]) * (z - a![1]) - (x - a![0]) * (b![1] - a![1])) / det;
  const [ua, ub, uc] = QUAD_FACES[f]!.map((i) => QUAD_UV[i]!);
  return [0, 1].map((k) => (1 - wb - wc) * ua![k]! + wb * ub![k]! + wc * uc![k]!) as V2;
}
const UV = uvOn(0, P[0], P[2]);

interface Run { live: string[]; replay: string[]; press: JsonObject | null; before: number[] | null; after: number[] | null; check: JsonObject | null }
function judge(planted?: Planted): Run {
  const ev = temp();
  const gltf = quadGltf();
  const pins = pinsProgram();
  putEvidence(ev, gltf.bytes);
  putEvidence(ev, pins.bytes);
  const s = new Script();
  s.present(D, quadDoc(gltf.sha, pins));
  const seen = s.scope();
  const [down, up] = s.click(PX);
  const first = s.logic(D, 60);
  s.orbit([200, 550], 360);
  const turned = s.scope();
  const second = s.logic(D, 60, 'logic.determinism');
  const r = runShow(binOf(), scenario(ev, [{ id: D, size: QUAD_POSE.size }], s.calls, planted), 'AC4 the surface press');
  presented(r[0]!, 'the quad');
  const cam = cameraOf(r[seen]!, 'the scope');
  expect(off([...cam.position, ...cam.target, cam.fov], [...QUAD_POSE.eye, ...QUAD_POSE.target, QUAD_POSE.fov!]), `the fixture: the scope shows the camera at (0, 10.5, 3) aimed at the origin (it shows ${fmt(cam.position)})`).toBeLessThan(1e-9);
  expect(Math.abs(Math.abs(cameraOf(r[turned]!, 'the scope after the orbit').azimuth - cam.azimuth) - 90), 'the fixture: the middle-button drag of 360 px orbits the view 90°').toBeLessThan(1e-9);

  const live: string[] = [];
  const press = entriesOf(r, [down, up], 'aim').find((e) => valueOf(e).phase === 'press') ?? null;
  if (!press) live.push(`the click writes no press entry of aim: ${show(r[down]!['appended'] ?? null)}`);
  else {
    const v = valueOf(press);
    const name = entryName(press);
    if (!v.hit || v.hit.set !== 0 || v.hit.key[0] !== 0 || v.hit.key[1] !== 0) live.push(`${name} writes hit ${show(v.hit)}, not {set 0, key [0, 0]}`);
    const sf = v.surface;
    if (!sf) live.push(`${name} writes surface none`);
    else {
      if (off(sf.point, P) > STEP_1024) live.push(`${name} writes point ${fmt(sf.point, 6)}, not within 1/1024 m of ${fmt(P, 6)}`);
      if (!sf.normal || off(sf.normal, NORMAL) > 1e-9) live.push(`${name} writes normal ${sf.normal ? fmt(sf.normal, 9) : 'none'}, not (0, 1, 0) within 1e-9`);
      if (!sf.uv || off(sf.uv, UV) > 1e-9) live.push(`${name} writes uv ${sf.uv ? fmt(sf.uv, 9) : 'none'}, not ${fmt(UV, 4)} within 1e-9`);
      if (sf.face !== 0) live.push(`${name} writes face ${String(sf.face)}, not 0`);
    }
    if (!v.ray || off(v.ray.origin, QUAD_POSE.eye) > 1e-9 || off(v.ray.dir, DIR) > 1e-9) live.push(`${name} writes ray ${show(v.ray)}, not from the eye (0, 10.5, 3) along ${fmt(DIR, 9)} within 1e-9`);
  }
  const run = logicOf(r[first]!, 'the first logic run');
  const before = lastArray(run.steps, 'pins.rec');
  if (press && before) {
    const row = rowOf(before);
    const v = valueOf(press);
    const name = `the logic item's read of ${entryName(press)}`;
    const want = FLAG.hit | FLAG.surface | FLAG.uv | FLAG.ray;
    if (row.player !== 1 || row.pad !== 0) live.push(`${name}: player ${row.player} and ${row.pad}, not player 1 and four zero bytes`);
    if (row.phase !== PHASE.press || row.button !== 0 || row.mods !== 0 || row.flags !== want || row.zero4 !== 0) live.push(`${name}: phase ${row.phase}, button ${row.button}, mods ${row.mods}, flags ${row.flags} and ${row.zero4}, not 0, 0, 0, ${want} (hit, surface, uv, ray) and four zero bytes`);
    if (v.surface && off(row.xyz, v.surface.point) !== 0) live.push(`${name}: x, y, z ${fmt(row.xyz, 6)}, not the entry's point`);
    if (row.set !== 0 || row.zeroSet !== 0 || row.key[0] !== 0n || row.key[1] !== 0n) live.push(`${name}: set ${row.set}, ${row.zeroSet}, key [${row.key.join(', ')}], not 0, four zero bytes, [0, 0]`);
    if (off(row.normal, NORMAL) > 1e-9 || off(row.uv, UV) > 1e-9 || row.face !== 0 || row.zeroFace !== 0) live.push(`${name}: normal ${fmt(row.normal, 9)}, uv ${fmt(row.uv, 9)}, face ${row.face}, ${row.zeroFace}, not (0, 1, 0), ${fmt(UV)}, 0 and four zero bytes`);
    if (off(row.origin, QUAD_POSE.eye) > 1e-9 || off(row.dir, DIR) > 1e-9) live.push(`${name}: ray ${fmt(row.origin, 9)} along ${fmt(row.dir, 9)}, not the eye along ${fmt(DIR, 9)}`);
  } else live.push(`the logic run reports no pins.rec of 64 words, or there is no press: ${String(before?.length)}`);

  const replay: string[] = [];
  const again = logicOf(r[second]!, 'the logic run after the orbit');
  const track = (x: JsonObject[]): JsonObject[] => x.filter((e) => e['control'] === 'aim');
  if (track(again.track).length !== track(run.track).length || !track(again.track).every((e, i) => sameEntry(e, track(run.track)[i]!))) replay.push('after the orbit the track holds other entries of aim');
  const after = lastArray(again.steps, 'pins.rec');
  if (press && after && before && JSON.stringify(after) !== JSON.stringify(before)) replay.push(`after the orbit the replay reads point ${fmt(rowOf(after).xyz, 6)} from ${entryName(press)}, not ${fmt(rowOf(before).xyz, 6)}`);
  const differ = hashDiff(run.steps, again.steps);
  if (differ) replay.push(`after the orbit ${differ}`);
  if (verdictOf(again.check) !== 'PASS') replay.push(`logic.determinism after the orbit answers ${verdictOf(again.check)}, not PASS`);
  return { live, replay, press, before, after, check: again.check };
}

const honest = once(() => judge());

describe(`${AC[4]} a surface hit and its ray are computed once, at the gesture, and a logic item reads them in its 248 B row`, () => {
  it(`${AC[4]} the press writes hit {set 0, key [0, 0]}, point (0.25, 0.5, −0.5), normal (0, 1, 0), uv (0.625, 0.25), face 0 and its ray, which the logic item reads at their offsets`, () => {
    // The test's own geometry: the press pixel's ray meets the quad there, on face 0, with these values.
    expect(P[0] >= P[2], 'the fixture: (0.25, −0.5) lies on face 0 (x ≥ z)').toBe(true);
    expect(off(UV, [0.625, 0.25])).toBeLessThan(1e-12);
    expect(off(NORMAL, [0, 1, 0])).toBeLessThan(1e-12);
    none(honest().live, 'the press, its entry and the logic item\'s read');
  }, TIMEOUT);

  it(`${AC[4]} after the viewer orbits 90°, replaying the track gives the same entry, the same read and logic.determinism PASS`, () => {
    none(honest().replay, 'the replay after the orbit');
  }, TIMEOUT);

  it(`${AC[4]} planted surface_uv_nearest_vertex writes uv (1, 0) and fails, naming the entry`, () => {
    const twin = judge('surface_uv_nearest_vertex');
    const uv = twin.press ? valueOf(twin.press).surface?.uv ?? null : null;
    expect(uv && off(uv, [1, 0]), 'under the planted hit the press writes the nearest vertex\'s uv, (1, 0)').toBeLessThan(1e-9);
    failsNaming(twin.live, [/the press entry of aim at t \d+/, /uv/], 'the planted surface_uv_nearest_vertex');
  }, TIMEOUT);

  it(`${AC[4]} planted surface_hit_on_replay writes another point after the orbit and fails logic.determinism, naming the entry`, () => {
    const twin = judge('surface_hit_on_replay');
    none(twin.live, 'the planted hit: the live press and its first read are unchanged');
    failsNaming(twin.replay, [/reads point/, /the press entry of aim at t \d+/], 'the replay after the orbit under surface_hit_on_replay');
    expect(verdictOf(twin.check), `logic.determinism fails the planted hit: ${show(twin.check, 800)}`).toBe('FAIL');
    expect(twin.press !== null && namesEntry(twin.check?.['failures'], twin.press), `a failure of logic.determinism names the entry (control aim, t ${String(twin.press?.['t'])}): ${show(twin.check?.['failures'] ?? null, 1200)}`).toBe(true);
  }, TIMEOUT);
});
