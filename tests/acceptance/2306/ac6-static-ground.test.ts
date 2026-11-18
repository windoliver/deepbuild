// #2306.0821d427: "A world whose vehicle bodies touch only static shapes gives step hashes byte-identical to the merge
// base's, and #251's sag, brake, drive and turn fixtures read what they read there"
//
// Both builds are release builds of deep-physics: this checkout's (#191's `release`) and the merge base's (`git
// merge-base HEAD origin/main`, exported by `git archive` and built apart by #191's `mergeBasePhysics`). The world is
// #251's lap course (its static ground and four static posts, the kart driven, steered and braked through #251's 1,200
// steps of entries) with a dynamic crate resting on the ground far from the course, so the world holds a dynamic body the
// vehicle never touches; that it never touches it is checked on the run. Its step hashes, 1,201 of them, must be the
// same strings on both builds. #251's four fixtures are the behavior kit's `vehicle_sag`, `vehicle_brake`,
// `vehicle_drive` and `vehicle_turn` (#251's README: Fixture names); each must read the same result and the same
// measured value, exactly, on both builds.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CRITERIA, LAP_STEPS, LAP_TRACK, PER_STEP, REPO, TIMEOUT, box, hashesIn, kitReport, lapWorld, mergeBase, mergeBasePhysics, namesBody,
  none, obj, onTest, prebuildBuilds, rowText, rowsOf, show, type JsonObject, type JsonValue,
} from './helpers.ts';

prebuildBuilds(['release']);

const ID = CRITERIA[6];
const FIXTURES = ['vehicle_sag', 'vehicle_brake', 'vehicle_drive', 'vehicle_turn'];

/** #251's lap course with a dynamic crate resting on its ground 110 m from the start, outside the course. */
function course(): JsonObject {
  const w = lapWorld();
  return {
    ...w,
    shapes: { ...obj(w['shapes'], 'the lap\'s shapes'), crate: box([0.5, 0.5, 0.5]) },
    bodies: { ...obj(w['bodies'], 'the lap\'s bodies'), crate: { kind: 'dynamic', shapes: [{ shape: 'crate', contact_material: 'ground' }], pose: { pos: [-80, 0.5, -80] }, mass: 50 } },
  };
}
const lapBake = (): JsonObject => ({ call: 'bake', world: course(), track: LAP_TRACK, steps: LAP_STEPS, frame_rate: PER_STEP, read: [] });

let dir = '';
let base: { bin: string; error: string } | undefined;
/** The merge base's release deep-physics, built once for the file. */
function baseBin(): string {
  if (!base) {
    dir = mkdtempSync(join(tmpdir(), 'deep-2306-base-'));
    const bin = join(dir, 'deep-physics-base');
    base = { bin, error: mergeBasePhysics(mergeBase(), bin) };
  }
  expect(base.error, 'the merge base builds deep-physics (release)').toBe('');
  return base.bin;
}
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
/** Runs `calls` through the merge base's deep-physics: exit 0, one reply per call. */
function onBase(calls: JsonObject[]): JsonObject[] {
  const r = spawnSync(baseBin(), [], { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  expect(r.status, `the merge base's deep-physics answers: ${r.stderr}`).toBe(0);
  const lines = r.stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, 'the merge base\'s deep-physics: one reply per call').toBe(calls.length);
  return lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `the merge base's reply ${i}`));
}

describe(`${ID} vehicles on static ground run as they did on the merge base`, () => {
  it(`${ID} a world whose vehicle bodies touch only static shapes gives step hashes byte-identical to the merge base's`, () => {
    const [here] = onTest([lapBake()], { build: 'release' });
    const [there] = onBase([lapBake()]);
    const touched = rowsOf(here!, 'the lap here').filter((r) => namesBody(r, 'kart') && [r.a, r.b].includes('crate'));
    expect(touched.map(rowText), 'the kart never touches the crate (the world\'s premise)').toEqual([]);
    const a = hashesIn(here, 'the lap here');
    const b = hashesIn(there, 'the lap on the merge base');
    expect(a.length, 'the lap here has a hash for the built state and each of its 1,200 steps').toBe(LAP_STEPS + 1);
    const first = a.findIndex((h, k) => h !== b[k]);
    none(first < 0 && a.length === b.length ? [] : [`the lap's step hash at step ${first} is ${a[first]} here and ${String(b[first])} on the merge base (${a.length} and ${b.length} hashes)`], 'the lap\'s step hashes against the merge base\'s');
  }, 4 * TIMEOUT);

  it(`${ID} #251's sag, brake, drive and turn fixtures read what they read on the merge base`, () => {
    const [here] = onTest([{ call: 'behavior_kit' }], { build: 'release' });
    const [there] = onBase([{ call: 'behavior_kit' }]);
    const h = kitReport(here!, 'behavior_kit here');
    const t = kitReport(there!, 'behavior_kit on the merge base');
    none(FIXTURES.flatMap((name) => {
      const x = h.results.filter((r) => r.fixture === name);
      const y = t.results.filter((r) => r.fixture === name);
      if (x.length !== 1 || y.length !== 1) return [`${name}: the kit's report holds it ${x.length} times here and ${y.length} times on the merge base`];
      const [r, s] = [x[0]!, y[0]!];
      return r.result === s.result && Object.is(r.measured, s.measured) ? [] : [`${name}: reads ${r.result} measuring ${show(r.measured)} here and ${s.result} measuring ${show(s.measured)} on the merge base`];
    }), '#251\'s four fixtures against the merge base');
  }, 4 * TIMEOUT);
});
