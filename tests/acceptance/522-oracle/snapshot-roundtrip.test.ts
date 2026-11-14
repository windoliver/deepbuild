// Re-expressed from the upstream engine's own test `tests/snapshot_roundtrip.rs` of its 3D crate, at commit
// 3406750a38286a0d3c7d0f4be2f9d53153e81d90 (the Oracle page's pin for #522's criteria 1 and 8, its vendor copy under
// `doneright/oracles/vendor/`), licensed under the Apache License, Version 2.0. No code is copied: each case's scene
// and rule are written here on our world document and judged on deep-physics's output (#136); upstream's numbers are
// kept (its pile, 100 steps before the snapshot and 100 after).
//
// Upstream's rule: step a world 100 steps, snapshot the whole world, then run the original and the restored world in
// lockstep 100 steps, requiring byte-identical snapshots at every step and naming the step and the structure that
// differs; a poses-only checkpoint fails it, and a restore without the narrow phase's contact impulses differs at its
// next step. Ours: the pile (awake: `awake_pile`; settled into sleep with four rollers: `sleeping_pile`) baked 200 steps
// with a checkpoint every 20 into a store, the ring 1 GiB wide so it never thins. The lockstep run is #522's `seek` to
// step 100 played on 100 steps (its step hashes 100 … 200 against the bake's, every step), and #2010's `restore` of the
// bake's checkpoint at step 100 with `checkpoints: true` (every later checkpoint's state bytes against the bake's).
// Criterion 1: under `--planted checkpoint_poses_only` the seek differs, and the judge names the first step, body and
// field. Criterion 8: under `--planted restore_without_warm_start` the seek first differs at step 101, its next step,
// and the restored run's checkpoint at step 120 isn't the bake's.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, TIMEOUT, allStates, ask, bakeCall, caught, firstDiffering, firstStateDifference, hashesOf, none, obj, pile, prebuild, restore, scratch,
  seekCall, seekOf, show, upstreamScene, type JsonObject, type Planted, type Seek, type State,
} from './helpers.ts';

prebuild();

const BEFORE = 100;
const AFTER = 100;
const STEPS = BEFORE + AFTER;
const EVERY = 20;

interface Ran { straight: string[]; states: Record<string, State[]>; seek: Seek; kept: Map<number, string>; restoredKept: Map<number, string> }
function ran(w: JsonObject, planted?: Planted): Ran {
  const o = planted ? { planted, where: planted } : {};
  const store = scratch('oracle-522');
  const [baked] = ask([bakeCall(w, [], STEPS, { store, checkpoints: true })], o);
  const straight = hashesOf(baked, 'the pile\'s bake');
  const cps = (r: JsonObject | undefined, what: string): Map<number, string> => {
    expect(r?.['ok'], `${what} answers ok: ${show(r)}`).toBe(true);
    const list = Array.isArray(r!['checkpoints']) ? r!['checkpoints'] : [];
    return new Map(list.map((c, i) => { const x = obj(c, `${what}: checkpoints[${i}]`); return [x['step'] as number, String(x['state'])]; }));
  };
  const kept = cps(baked, 'the pile\'s bake');
  const at = (Array.isArray(baked!['checkpoints']) ? baked!['checkpoints'] : []).map((c) => obj(c, 'checkpoint')).find((c) => c['step'] === BEFORE);
  expect(at, `the bake keeps its checkpoint at step ${BEFORE}`).toBeDefined();
  const [sought, restored] = ask([seekCall(w, [], STEPS, store, BEFORE, AFTER), restore(w, at!, AFTER, { checkpoints: true, read: [] })], o);
  return {
    straight, states: allStates(baked!, STEPS + 1, 'the pile\'s bake'), seek: seekOf(sought, AFTER + 1, `the seek to step ${BEFORE}`),
    kept, restoredKept: cps(restored, `the restore of step ${BEFORE}`),
  };
}
/** Upstream's assert_same, every step after the snapshot: the step hashes, and at each later checkpoint the state's bytes. */
function lockstepFailures(r: Ran): string[] {
  const f: string[] = [];
  if (r.seek.from !== BEFORE) f.push(`the seek restored step ${r.seek.from}, not the checkpoint at step ${BEFORE}`);
  const k = firstDiffering(r.straight.slice(BEFORE, STEPS + 1), r.seek.hashes);
  if (k !== null) f.push(`the snapshot isn't continued as the run it resumed: ${firstStateDifference(r.states, r.seek.bodies, BEFORE, BEFORE) ?? `step ${BEFORE + k}: its step hash differs`}`);
  for (let c = BEFORE + EVERY; c <= STEPS; c += EVERY) {
    if (r.restoredKept.get(c) === undefined) f.push(`the restored run took no checkpoint at step ${c}`);
    else if (r.restoredKept.get(c) !== r.kept.get(c)) f.push(`step ${c}: the restored run's checkpoint isn't byte-identical to the run it resumed`);
  }
  return f;
}
const PILES = [['awake_pile', false], ['sleeping_pile', true]] as const;

describe(`${CRITERIA[1]} upstream's snapshot_roundtrip, on our seek: a whole-world checkpoint continues byte for byte; a poses-only one fails`, () => {
  it.each(PILES)(`${CRITERIA[1]} %s: the seek from the step-${BEFORE} checkpoint continues as the run it resumed at every one of the ${AFTER} later steps`, (_name, sleepy) => {
    none(lockstepFailures(ran(upstreamScene(pile(sleepy), EVERY))), 'the lockstep comparison');
  }, TIMEOUT);

  it(`${CRITERIA[1]} sleeping_pile under a planted checkpoint of poses and velocities alone (checkpoint_poses_only): the comparison fails, naming the step, body and field`, () => {
    const failures = lockstepFailures(ran(upstreamScene(pile(true), EVERY), 'checkpoint_poses_only'));
    caught(failures, 'checkpoint_poses_only');
    expect(failures.some((x) => /step \d+: \S+ (pos|rot|linear|angular)\.[xyzw] /.test(x)), `the failure names the step, body and field: ${failures.join('; ')}`).toBe(true);
  }, TIMEOUT);
});

describe(`${CRITERIA[8]} upstream's snapshot_roundtrip, on our restore: the narrow phase's contact impulses are part of the checkpoint`, () => {
  it(`${CRITERIA[8]} awake_pile under a planted restore without warm-start impulses (restore_without_warm_start): it differs at its next step, step ${BEFORE + 1}, naming the field, and its next checkpoint isn't byte-identical`, () => {
    const r = ran(upstreamScene(pile(false), EVERY), 'restore_without_warm_start');
    const failures = lockstepFailures(r);
    caught(failures, 'restore_without_warm_start');
    expect(firstDiffering(r.straight.slice(BEFORE, STEPS + 1), r.seek.hashes), 'the first step whose hash differs is the restore\'s next step').toBe(1);
    expect(failures.some((x) => x.includes(`step ${BEFORE + 1}: `) && /(pos|rot|linear|angular)\.[xyzw] /.test(x)), `a failure names step ${BEFORE + 1} and the field: ${failures.join('; ')}`).toBe(true);
    expect(failures.some((x) => x.startsWith(`step ${BEFORE + EVERY}: the restored run's checkpoint`)), `and the checkpoint at step ${BEFORE + EVERY}: ${failures.join('; ')}`).toBe(true);
  }, TIMEOUT);
});
