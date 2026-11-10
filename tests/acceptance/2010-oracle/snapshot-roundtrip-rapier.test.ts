// Ported from Rapier, crates/rapier3d/tests/snapshot_roundtrip.rs (awake_pile, sleeping_pile, ccd_bodies,
// joints_and_sensor), at commit 3406750a38286a0d3c7d0f4be2f9d53153e81d90 of https://github.com/dimforge/rapier,
// licensed Apache-2.0 (the file is the same in the rapier3d 0.36.1 crate). No upstream code is copied: each scene and
// the assertion are re-expressed here on deep-physics's output (#136).
//
// Upstream steps a scene 100 steps, saves the whole world, restores it into a fresh one and steps both 100 more in
// lockstep, requiring the saved bytes of the two to be identical after every step and naming the first step that
// differs. Here the straight run is a bake of 200 steps with a deep checkpoint (the backend's whole-world state) every
// 20; the restore of its step-100 checkpoint runs 100 more steps with its own checkpoints. Every step hash of the
// restored run must equal the straight run's, and each checkpoint it takes must hold the same state bytes as the
// straight run's at that step. Left out: multibody_articulation (our document has no multibody joint), the live
// pipeline and pipeline-replacement cases (no world field reaches Rapier's pipeline), structural_changes (a body is
// never created or removed mid-run), and the #[ignore]d 43k-body pyramid.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, TIMEOUT, arr, ask, bake, none, obj, pile, prebuild, restore, show, stepHashes, upstreamScene, withCcdBalls, withJointsAndSensor,
  type JsonObject,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[2];
const BEFORE = 100;
const AFTER = 100;
const EVERY = 20;
const N = BEFORE + AFTER;

/** The first step and checkpoint where the restored run differs from the straight one, or none. */
function roundtripFailures(name: string, w: JsonObject): string[] {
  const [straight] = ask([bake(w, N, { checkpoints: true })], { where: `${name}, straight` });
  const hashes = stepHashes(straight!, N + 1, `${name}: the straight run`);
  const cps = arr(straight!['checkpoints'], `${name}: checkpoints`).map((c, i) => obj(c, `${name}: checkpoints[${i}]`));
  const at = new Map(cps.map((c) => [c['step'], c]));
  const saved = at.get(BEFORE);
  expect(saved, `${name}: a checkpoint at step ${BEFORE} (every ${EVERY}): steps ${cps.map((c) => show(c['step'])).join(', ')}`).toBeDefined();
  const [restored] = ask([restore(w, saved!, AFTER, { checkpoints: true })], { where: `${name}, restored` });
  const got = stepHashes(restored!, AFTER + 1, `${name}: the restored run`);
  const f: string[] = [];
  const k = got.findIndex((h, j) => h !== hashes[BEFORE + j]);
  if (k >= 0) f.push(`${name}: step ${BEFORE + k} after the restore hashes ${got[k]}, the uninterrupted run ${hashes[BEFORE + k]}`);
  const later = arr(restored!['checkpoints'], `${name}: the restored run's checkpoints`).map((c, i) => obj(c, `${name}: restored checkpoints[${i}]`));
  const want = [...at.keys()].filter((s) => typeof s === 'number' && s > BEFORE);
  if (JSON.stringify(later.map((c) => c['step'])) !== JSON.stringify(want)) f.push(`${name}: the restored run checkpoints steps ${JSON.stringify(later.map((c) => c['step']))}, the straight run ${JSON.stringify(want)}`);
  for (const c of later) {
    const s = at.get(c['step']);
    if (s && s['state'] !== c['state']) { f.push(`${name}: the whole-world state isn't byte-identical at step ${show(c['step'])} after the restore`); break; }
  }
  return f;
}

describe(`${ID} Rapier's snapshot_roundtrip, on deep-physics's output: a restored checkpoint steps on exactly as the uninterrupted run`, () => {
  it(`${ID} awake_pile and sleeping_pile: 192 boxes, awake and settling to sleep, restored at step ${BEFORE}`, () => {
    none([
      ...roundtripFailures('awake pile', upstreamScene(pile(false), EVERY)),
      ...roundtripFailures('sleeping pile', upstreamScene(pile(true), EVERY)),
    ], 'restored at step 100, every step hash and checkpoint equals the uninterrupted run\'s');
  }, TIMEOUT);

  it(`${ID} ccd_bodies and joints_and_sensor: CCD balls at 100 m/s, and a ball-jointed chain swinging through a sensor, restored at step ${BEFORE}`, () => {
    none([
      ...roundtripFailures('ccd', upstreamScene(withCcdBalls(pile(true)), EVERY)),
      ...roundtripFailures('joints', upstreamScene(withJointsAndSensor(pile(true)), EVERY)),
    ], 'restored at step 100, every step hash and checkpoint equals the uninterrupted run\'s');
  }, TIMEOUT);
});
