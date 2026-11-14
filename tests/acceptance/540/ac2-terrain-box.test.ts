// AC2 #540.88ffa39f: In a 3D scene with a 64 × 64 m terrain plate and 10 units on it, a box drag over 6 of them writes
// a release whose four corners lie within 1/1024 m of the corner rays' hits on the plate's height-field triangles,
// which the test computes from the camera's pose and the samples, and a fixture logic that selects the units inside
// the corners' polygon selects exactly those 6; turning the camera afterwards and replaying gives the same entry and
// the same 6; a planted control that computes the corners again from the camera at replay selects another set after
// the turn and fails logic.determinism, naming the entry; and a replica given the same synthetic pointer path writes
// byte-identical entries on macOS arm64 and Linux aarch64 (the Spark); the x86_64 comparison waits for the first x86_64
// target, as every cross-architecture fixture does
//
// The scene (fixtures.ts `terrainDoc`): the plate `ground` (64 × 64 m, 1 m spacing, height 0.01 x z), ten standing units
// (`army` feeding the instancer `units`), the point control `box` (`on: ground`, `drag: box`) and `select`, a logic item
// reading `box` that selects the units inside the release's corners (programs.ts), under a perspective camera at
// (0, 40, 30) looking at the origin, fov 60° on 1000 × 800. Through `deep-show run`: the scene presented, the scope
// read, a box drag with the primary button from (250, 340) to (750, 470) px, `logic` over 40 steps (20 Hz), the
// viewer's orbit of 90° (a 360 px drag with the middle button, README: The orbit), the scope read, and `logic` again
// with logic.determinism. The expected corners: geometry.ts's rays through the screen rectangle's corners, from the
// press corner clockwise, each met with every height-field triangle of the plate's samples (the base's split, #2014).
// The planted `box_corners_on_replay` computes the corners again at every replay from the pointer's corners through
// the camera as it is then.
import { describe, expect, it } from 'vitest';
import { BOX_PRESS, BOX_RELEASE, STANDING, STANDING_ARMY, TERRAIN, TERRAIN_POSE, terrainDoc } from './fixtures.ts';
import { edgeDistanceXZ, fmt, insideXZ, meetPlate, off, rayAt, rectCorners, STEP_1024, type V2, type V3 } from './geometry.ts';
import {
  AC, DOC, Script, TIMEOUT, binOf, cameraOf, entriesOf, entriesText, entryName, failsNaming, hashDiff, lastArray, logicOf, namesEntry, none,
  once, otherRecord, PLATFORM, prebuild, presented, putEvidence, runShow, sameEntry, scenario, show, useTemp, valueOf, verdictOf, writeRecord,
  type JsonObject, type Planted,
} from './helpers.ts';
import { armyProgram, rowOf, selectProgram, UNITS } from './programs.ts';

prebuild();
const temp = useTemp();
const D = DOC(2);
const STEPS = 40;
/** The units the box holds: the first six of STANDING. */
const SIX = [1, 1, 1, 1, 1, 1, 0, 0, 0, 0];
const POINTER: V2[] = [BOX_PRESS, [450, 392], [650, 444], BOX_RELEASE];
const EXPECTED: V3[] = rectCorners(BOX_PRESS, BOX_RELEASE).map((p) => meetPlate(TERRAIN, rayAt(TERRAIN_POSE, p))!);

interface Run { failures: string[]; replay: string[]; release: JsonObject | null; entries: JsonObject[]; after: number[] | null; check: JsonObject | null; relWords: number[] | null }
function judge(planted?: Planted): Run {
  const ev = temp();
  const army = armyProgram(STANDING_ARMY);
  const select = selectProgram(STANDING);
  for (const p of [army, select]) putEvidence(ev, p.bytes);
  const s = new Script();
  s.present(D, terrainDoc(army, select));
  const seen = s.scope();
  const drag = s.drag(POINTER);
  const first = s.logic(D, STEPS);
  s.orbit([300, 700], 360);
  const turned = s.scope();
  const second = s.logic(D, STEPS, 'logic.determinism');
  const r = runShow(binOf(), scenario(ev, [{ id: D, size: TERRAIN_POSE.size }], s.calls, planted), 'AC2 the box drag');
  presented(r[0]!, 'the terrain scene');

  // The fixture: the camera the scope shows is the pose the expected corners come from, and the orbit turned it 90°.
  const before = cameraOf(r[seen]!, 'the scope');
  expect(off([...before.position, ...before.target, before.fov], [...TERRAIN_POSE.eye, ...TERRAIN_POSE.target, TERRAIN_POSE.fov!]), `the fixture: the scope shows the camera at ${fmt(TERRAIN_POSE.eye)} looking at the origin, fov 60° (it shows ${fmt(before.position)})`).toBeLessThan(1e-9);
  expect(Math.abs(Math.abs(cameraOf(r[turned]!, 'the scope after the orbit').azimuth - before.azimuth) - 90), 'the fixture: the middle-button drag of 360 px turns the view 90°').toBeLessThan(1e-9);

  const failures: string[] = [];
  const entries = entriesOf(r, drag, 'box');
  const releases = entries.filter((e) => valueOf(e).phase === 'release');
  const release = releases.length === 1 ? releases[0]! : null;
  if (!entries.some((e) => valueOf(e).phase === 'press') || !release) failures.push(`the box drag writes ${entriesText(entries)}, not a press and one release`);
  if (release) {
    const corners = valueOf(release).corners;
    if (!corners || corners.length !== 4) failures.push(`${entryName(release)} holds corners ${show(corners)}, not four`);
    else EXPECTED.forEach((want, i) => {
      const got = corners[i];
      if (!got || off(got, want) > STEP_1024) failures.push(`${entryName(release)}: corner ${i + 1} is ${got ? fmt(got, 6) : 'none'}, not within 1/1024 m of ${fmt(want, 6)}, where the ray through the screen rectangle's corner ${i + 1} meets the plate's height-field triangles`);
    });
  }
  const run = logicOf(r[first]!, 'the first logic run');
  const selected = lastArray(run.steps, 'select.selected');
  if (JSON.stringify(selected) !== JSON.stringify(SIX)) failures.push(`the fixture logic selects ${show(selected)}, not exactly the six units inside the box ${show(SIX)}`);
  const relWords = lastArray(run.steps, 'select.rel');
  if (release && relWords) {
    const row = rowOf(relWords);
    EXPECTED.forEach((want, i) => { if (off(row.corners[i]!, want) > STEP_1024) failures.push(`the logic item reads corner ${i + 1} of ${entryName(release)} as ${fmt(row.corners[i]!, 6)} at its offset in the 248 B row, not ${fmt(want, 6)}`); });
  }

  const replay: string[] = [];
  const again = logicOf(r[second]!, 'the logic run after the turn');
  const track = (x: JsonObject[]): JsonObject[] => x.filter((e) => e['control'] === 'box');
  if (track(again.track).length !== track(run.track).length || !track(again.track).every((e, i) => sameEntry(e, track(run.track)[i]!))) replay.push(`after the turn the track holds ${entriesText(track(again.track))}, not the same entries ${entriesText(track(run.track))}`);
  const after = lastArray(again.steps, 'select.selected');
  if (JSON.stringify(after) !== JSON.stringify(SIX)) replay.push(`after the turn the replay selects ${show(after)}, not the same six ${show(SIX)}${release ? `, reading ${entryName(release)}` : ''}`);
  const differ = hashDiff(run.steps, again.steps);
  if (differ) replay.push(`after the turn ${differ}`);
  if (verdictOf(again.check) !== 'PASS') replay.push(`logic.determinism after the turn answers ${verdictOf(again.check)}, not PASS`);
  return { failures, replay, release, entries, after, check: again.check, relWords };
}

const honest = once(() => judge());

/** The test's own fixture: six units 2.1 m or more inside the expected quad, four 5.1 m or more outside it. */
function fixtureHolds(): void {
  STANDING.forEach(([x, z], i) => {
    expect(insideXZ(EXPECTED, x, z), `the fixture: unit ${i} at (${x}, ${z}) lies ${i < 6 ? 'inside' : 'outside'} the expected corners' quad`).toBe(i < 6);
    expect(edgeDistanceXZ(EXPECTED, x, z), `the fixture: unit ${i} is clear of the quad's edges`).toBeGreaterThan(2);
  });
  expect(STANDING.length).toBe(UNITS);
}

describe(`${AC[2]} a box drag over a terrain plate writes its corners once, at the gesture, the same on every replay and machine`, () => {
  it(`${AC[2]} the release's four corners lie within 1/1024 m of the corner rays' hits on the height-field triangles, the fixture logic selects exactly the 6, and a replay after a 90° turn gives the same entry, the same 6 and logic.determinism PASS`, () => {
    fixtureHolds();
    none(honest().failures, 'the box drag, its corners and the selection');
    none(honest().replay, 'the replay after the turn');
  }, TIMEOUT);

  it(`${AC[2]} planted box_corners_on_replay selects another set after the turn and fails logic.determinism, naming the entry`, () => {
    const twin = judge('box_corners_on_replay');
    none(twin.failures, 'the planted control: the live drag, its corners and the first selection are unchanged');
    expect(JSON.stringify(twin.after), 'under the planted control the replay after the turn selects another set').not.toBe(JSON.stringify(SIX));
    failsNaming(twin.replay, [/selects/, /release entry of box at t \d+/], 'the replay after the turn under box_corners_on_replay');
    expect(verdictOf(twin.check), `logic.determinism fails the planted control: ${show(twin.check, 800)}`).toBe('FAIL');
    expect(twin.release !== null && namesEntry(twin.check?.['failures'], twin.release), `a failure of logic.determinism names the release entry (control box, t ${String(twin.release?.['t'])}): ${show(twin.check?.['failures'] ?? null, 1200)}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[2]} the same synthetic pointer path writes byte-identical entries on macOS arm64 and Linux aarch64`, () => {
    const run = honest();
    none(run.failures, 'this machine\'s box drag');
    const record = {
      entries: run.entries.map((e) => ({ control: e['control'] ?? null, t: e['t'] ?? null, value: e['value'] ?? null })),
      release_row: run.relWords ? rowOf(run.relWords).bytes.subarray(8).toString('hex') : null,
    };
    const file = writeRecord('box-entries', record);
    const other = otherRecord();
    expect(JSON.stringify(other['entries']), `the box entries ${PLATFORM} wrote (${file}) are byte for byte the other machine's`).toBe(JSON.stringify(record.entries));
    expect(other['release_row'], `the release's 248 B row as the logic item read it on ${PLATFORM} is the other machine's, byte for byte`).toBe(record.release_row);
  }, TIMEOUT);
});
