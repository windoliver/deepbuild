// Criterion 7: "A check on the new revision plays from step 0, and no carried-on frame enters a golden or an evidence
// bundle. A planted capture of one fails, naming the frame."
//
// Process A presents the jumper under rule 1 and plays 360 frames with presses in frames 100, 200, 290, 320 and 340;
// while frame 300 is drawn its program is patched to rule 2, keeping its layout, so the run carries on: from step 301
// its score is 3 plus 10 a press, where the new revision played from step 0 scores 10 a press. Then, in the same
// process: the `logic` call with `check: "logic.determinism"` (the check, and its run from step 0), `golden_record`
// (the golden) and `eval` at step 350 with its arrays and carried-state rows (the frame a snapshot or an evidence bundle
// takes: frame(t) = eval(doc, t, inputs ≤ t, view)). Process B presents the new revision itself and does the same, on
// the same presses. The judge reads each of A’s against B’s, every step, and names the first frame that differs. At the
// base this document’s golden hashes no node (each step’s hash is that of nothing), so the golden is held equal here
// but can’t alone catch a capture; the check and the evaluation can. The planted capture is
// `--planted checks_read_carried_run`; the carried-on run’s first frame is 301.
import { describe, expect, it } from "vitest";
import { A, AC, DOC, LOGIC, STEP, TIMEOUT, V1, V2, arr, caughtNaming, gameDoc, isObject, none, obj, play, rowAt, show, str, useBuild, useEvidence, valueOf, type JsonObject, type Planted } from "./helpers.ts";

const bin = useBuild();
const evidence = useEvidence();
const AT = 300;
const FRAMES = 360;
const EVAL_STEP = 350;
const PRESSES = [100, 200, 290, 320, 340];
const AFTER: JsonObject[] = [
  { call: "track", doc: DOC },
  { call: "logic", doc: DOC, steps: FRAMES, check: "logic.determinism" },
  { call: "golden_record", doc: DOC, steps: 2 * FRAMES },
  { call: "eval", doc: DOC, t: EVAL_STEP * STEP, arrays: [A.score, A.presses, A.since], carried: true },
];

/** What a check, a golden and an evaluation of the document give after a play. */
interface Taken { track: string; steps: string[]; checkpoints: Map<number, string>; verdict: string; golden: string[]; evaluated: string; score350: number }
const canonical = (v: unknown): string => JSON.stringify(v, (_, x) => (isObject(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
function taken(bin: string, document: JsonObject, script: JsonObject, what: string, planted?: Planted): Taken {
  const { played, after } = play(bin, evidence(), document, { frames: FRAMES, presses: PRESSES, ...script }, what, planted, AFTER);
  const [track, logic, golden, evaluated] = after.map((r, i) => obj(r, `${what}: ${AFTER[i]!["call"]}`));
  expect(logic!["code"], `${what}: the logic call runs: ${show(logic)}`).toBeUndefined();
  const check = obj(logic!["check"], `${what}: the check`);
  return {
    track: str(track!["hash"], `${what}: the track’s hash`),
    steps: arr(logic!["steps"], `${what}: the check’s steps`).map((s, k) => { const o = obj(s, `${what}: steps[${k}]`); return canonical({ hash: o["hash"], arrays: o["arrays"] }); }),
    checkpoints: new Map(arr(obj(logic!["checkpoints"], `${what}: checkpoints`)[LOGIC], `${what}: checkpoints.${LOGIC}`).map((c, i) => { const o = obj(c, `${what}: checkpoint ${i}`); return [o["step"] as number, String(o["deep_hash"])] as const; })),
    verdict: str(check["verdict"], `${what}: the check’s verdict`),
    golden: arr(obj(golden!["golden"], `${what}: the golden: ${show(golden)}`)["step_hashes"], `${what}: the golden’s step hashes`).map(String),
    evaluated: canonical({ arrays: evaluated!["arrays"], carried: evaluated!["carried"] }),
    score350: valueOf(rowAt(played, EVAL_STEP, what), A.score, what),
  };
}

/** A’s check, golden and evaluation against B’s, every step; each failure names the first frame that differs. */
function judgeTaken(a: Taken, b: Taken): string[] {
  const out: string[] = [];
  const k = b.steps.findIndex((s, i) => a.steps[i] !== s);
  if (k >= 0 || a.steps.length !== b.steps.length) out.push(`frame ${k >= 0 ? k : Math.min(a.steps.length, b.steps.length)}: the check’s run isn’t the new revision played from step 0: ${a.steps[k] ?? "missing"}, where a fresh run gives ${b.steps[k] ?? "missing"}`);
  for (const [step, h] of b.checkpoints) if (a.checkpoints.get(step) !== h) { out.push(`frame ${step}: the check’s checkpoint of ${LOGIC} is ${a.checkpoints.get(step) ?? "missing"}, where a fresh run’s is ${h}`); break; }
  const g = b.golden.findIndex((h, i) => a.golden[i] !== h);
  if (g >= 0 || a.golden.length !== b.golden.length) out.push(`frame ${Math.floor(Math.max(g, 0) / 2)}: the golden’s step ${g} differs from a fresh run’s golden`);
  if (a.evaluated !== b.evaluated) out.push(`frame ${EVAL_STEP}: the frame a snapshot or an evidence bundle takes at step ${EVAL_STEP} is ${a.evaluated}, where a fresh run’s is ${b.evaluated}`);
  if (a.verdict !== "PASS") out.push(`the check on the new revision reads ${a.verdict}, not PASS`);
  return out;
}

function runs(planted?: Planted): { carried: Taken; fresh: Taken } {
  const v1 = gameDoc(bin(), evidence(), { version: V1 });
  const v2 = gameDoc(bin(), evidence(), { version: V2 });
  const fresh = taken(bin(), v2, {}, "B: the new revision from step 0");
  const carried = taken(bin(), v1, { revise: [{ frame: AT, document: v2 }] }, `A: the run patched at step ${AT}, then checked`, planted);
  expect(carried.track, "A’s and B’s input tracks are the same").toBe(fresh.track);
  expect([carried.score350, fresh.score350], `the carried-on run’s step ${EVAL_STEP} isn’t the new revision’s from step 0`).toEqual([23, 50]);
  return { carried, fresh };
}

describe(`${AC[7]} a carried-on run is never evidence`, () => {
  it(`${AC[7]} after a run carried on from step ${AT}, the check, the golden and the evaluation are the new revision’s from step 0, every step`, () => {
    const { carried, fresh } = runs();
    none(judgeTaken(carried, fresh), "what the check, the golden and the evaluation took");
  }, TIMEOUT);

  it(`${AC[7]} a planted capture of the carried-on run (checks_read_carried_run) fails, naming frame ${AT + 1}`, () => {
    const { carried, fresh } = runs("checks_read_carried_run");
    caughtNaming(judgeTaken(carried, fresh), [`frame ${AT + 1}`], "checks_read_carried_run");
  }, TIMEOUT);
});
