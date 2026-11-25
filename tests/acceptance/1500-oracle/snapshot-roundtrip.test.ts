// Re-expressed from the upstream physics engine’s own test `tests/snapshot_roundtrip.rs` of its 3D crate, at commit
// 3406750a38286a0d3c7d0f4be2f9d53153e81d90 (the Oracle page’s pin for #1500’s criterion 1, lines 137-169 and 383-389,
// its vendor copy under `doneright/oracles/vendor/`), licensed under the Apache License, Version 2.0. No code is copied:
// the rule and the scene are written here on our documents and judged on what `deep-show` answers (#136), with
// upstream’s numbers: its pile, 100 steps before the snapshot and 100 after (sleeping) or 60 (awake).
//
// Upstream’s rule (check_roundtrip, restoring_into_a_live_pipeline): step a world, save it, restore it with the live
// pipeline kept stepping, then step the original and the restored world in lockstep, requiring byte-identical state at
// every later step and naming the step and the structure that differs. Ours, the physics half of criterion 1: the
// jumper with upstream’s pile as its world is played twice in two processes on no input; in one, a revision that
// changes only the material arrives while frame 100 is drawn, so the run’s state after step 100 is held and opened
// again under it (README: The join) while the play goes on. At every step after it, each carried state’s full-state
// hash (the world’s is over the backend’s whole world, as upstream’s bytes are) must equal the never-held run’s; a
// failure names the step, the carried states that differ and the first body that moved differently. The planted
// wrong program is `--planted join_poses_only`: the world rebuilt with each body’s pose and velocity as held.
import { describe, it } from "vitest";
import { AC, BLUE, TIMEOUT, V1, WORLD, caughtNaming, gameDoc, isObject, none, pile, play, upstreamScene, useBuild, useEvidence, type Planted, type Played, type Row } from "./helpers.ts";

const bin = useBuild();
const evidence = useEvidence();
const BEFORE = 100;

function runs(sleepy: boolean, after: number, planted?: Planted): { straight: Played; carried: Played } {
  const g = { version: V1, world: upstreamScene(pile(sleepy), 60), span: "4s" };
  const before = gameDoc(bin(), evidence(), g);
  const patched = gameDoc(bin(), evidence(), { ...g, color: BLUE });
  const script = { frames: BEFORE + after + 1, rows: Array.from({ length: after + 1 }, (_, i) => BEFORE + i) };
  const straight = play(bin(), evidence(), before, script, "the run never held").played;
  const carried = play(bin(), evidence(), before, { ...script, revise: [{ frame: BEFORE, document: patched }] }, `the run held at step ${BEFORE} and opened again`, planted).played;
  return { straight, carried };
}

/** The first body of the world whose pose differs between two rows, or upstream’s "none" when only the stored state moved. */
function firstBody(a: Row, b: Row): string {
  const wa = isObject(a.worlds[WORLD]) ? a.worlds[WORLD] : {};
  const wb = isObject(b.worlds[WORLD]) ? b.worlds[WORLD] : {};
  for (const id of Object.keys(wb).sort()) {
    if (JSON.stringify(wa[id]) !== JSON.stringify(wb[id])) return `${id}: never held ${JSON.stringify(wb[id])}, opened again ${JSON.stringify(wa[id])}`;
  }
  return "none, the stored state moved without any body moving";
}
/** Upstream’s assert_same at every step after the restore: the first step whose state isn’t the never-held run’s. */
function judgeLockstep(carried: Played, straight: Played, after: number): string[] {
  const j = carried.joins.find((x) => x.step === BEFORE);
  if (!j || j.outcome !== "carried") return [`step ${BEFORE + 1}: the run wasn’t held and opened again at step ${BEFORE} (${j ? j.outcome : "no join"})`];
  for (let k = BEFORE + 1; k <= BEFORE + after; k++) {
    const a = carried.rows.get(k);
    const b = straight.rows.get(k);
    if (!a || !b) return [`step ${k}: a run lists no frame there`];
    if (a.from !== BEFORE + 1) return [`step ${k}: the frame comes from a run from step ${a.from}, not the one opened again after step ${BEFORE}`];
    const parts = Object.keys(b.deep).filter((id) => a.deep[id] !== b.deep[id]);
    if (parts.length) return [`step ${k}: the state isn’t byte-identical ${k - BEFORE} step(s) after the restore; differing structures: ${parts.join(", ")}; first differing body: ${firstBody(a, b)}`];
  }
  return [];
}

const CASES = [["sleeping pile", 100, true], ["awake pile", 60, false]] as const;

describe(`${AC[1]} upstream’s snapshot round trip on a live run: the state held at the join continues byte for byte`, () => {
  it.each(CASES)(`${AC[1]} %s: held at step ${BEFORE} and opened again, every carried state equals the never-held run’s at each of the next %s steps`, (_name, after, sleepy) => {
    const { straight, carried } = runs(sleepy, after);
    none(judgeLockstep(carried, straight, after), "the lockstep comparison");
  }, TIMEOUT);

  it(`${AC[1]} awake pile under a planted join that keeps only poses and velocities (join_poses_only): the comparison fails, naming step ${BEFORE + 1} and the world`, () => {
    const { straight, carried } = runs(false, 60, "join_poses_only");
    caughtNaming(judgeLockstep(carried, straight, 60), [`step ${BEFORE + 1}`, WORLD], "join_poses_only");
  }, TIMEOUT);
});
