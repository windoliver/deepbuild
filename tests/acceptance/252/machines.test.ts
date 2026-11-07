// #252.3f867a9b: "On a second machine the same check reads INCONCLUSIVE, never PASS or FAIL; a planted class that
// compares the flock across machines reads FAIL there and fails, naming the class"
//
// The check is the flock at step 1,800 by hash against its recording: #380's `golden`, with its snapshot the flock's
// carried state as a `view3d` frame reads it (`read: flock.state`, the view3d opened cold at step 1,800) and its
// golden blessed from a state file by your decision (`decide`, `bless.state`), compared by `oracle: hash` (README).
// Its class is the operator's computed class: a stepped operator's carried state is same_machine (Scope: "checks and
// goldens compare it only on the machine that recorded it"; Determinism class: "a golden recorded under another
// fingerprint reads INCONCLUSIVE, naming both").
//
// The second machine is simulated as #380's goldens test simulates one: golden's `environment` stands in for another
// machine's fingerprint, here another GPU. A second machine's flock differs from the recording machine's (its f32
// steps round differently, and a flock amplifies any difference), so the recording made "elsewhere" is this machine's
// state with one ulp of one field shifted, the design's own planted shift (Checkpoint ring: "one ulp of one field,
// never a whole unit"). Blessed under this machine's fingerprint, then: the unshifted state PASSes and the shifted
// one FAILs here, so the comparison runs on the recording machine; under the other GPU both read INCONCLUSIVE,
// `environment_changed`, naming both GPUs, with no comparison numbers, and the golden reports class same_machine.
// The planted `carried_class_exact` computes a stepped operator's class as exact, which compares across machines:
// under the other GPU it compares the shifted recording and reads FAIL, and the failure names the class it read. At
// the base no operator steps, golden takes no `read` and decide no `state`.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DEFAULT_RING, FLOCK_STATE, blessState, failsNaming, flockDoc, goldenReply, goldenState, requireGpu, run, shown, stateOf, useBin, useOut,
  view3dCall, view3dFrames, type Golden, type JsonObject, type Planted,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const STEP = 1800;
const FIXTURE = 'flock-252';
/** The second machine: another GPU's name in the fingerprint. */
const OTHER = { gpu: 'Apple M1 (a second machine, #252)' };

/** This machine's flock at STEP as two recordings: as it is, and with boid 0's x one ulp up. */
function recordings(planted: Planted | undefined, dir: string, spec: JsonObject): { same: string; shifted: string } {
  const [r] = run(bin(), dir, [view3dCall({ ...spec, capture: [STEP], read: [FLOCK_STATE] })], planted);
  const f = view3dFrames(r!, `the flock opened at step ${STEP}`).find((x) => x.frame === STEP);
  expect(f, `the view drew step ${STEP}`).toBeDefined();
  const s = stateOf(dir, f!, `the flock at step ${STEP}`);
  const same = join(dir, 'same.state');
  writeFileSync(same, Buffer.from(s.words.buffer));
  const shiftedWords = new Uint32Array(s.words.buffer.slice(0));
  expect(s.words[0]! > 0 && s.words[0]! < 1, `boid 0's x is in (0, 1): ${s.words[0]}`).toBe(true);
  shiftedWords[0] = shiftedWords[0]! + 1;
  const shifted = join(dir, 'shifted.state');
  writeFileSync(shifted, Buffer.from(shiftedWords.buffer));
  expect(readFileSync(shifted).equals(readFileSync(same)), 'the shifted recording differs').toBe(false);
  return { same, shifted };
}
/** Blesses each recording into its own store and runs the golden calls given, as `planted`. */
function goldens(planted: Planted | undefined, calls: (stores: { same: string; shifted: string }, spec: JsonObject) => JsonObject[]): Golden[] {
  const dir = out();
  const doc = flockDoc(bin(), dir, DEFAULT_RING);
  const spec: JsonObject = { doc, fps: 60, from: STEP, frames: 1 };
  const rec = recordings(planted, dir, spec);
  const stores = { same: join(dir, 'golden-same'), shifted: join(dir, 'golden-shifted') };
  const decided = run(bin(), dir, [blessState(stores.same, FIXTURE, rec.same), blessState(stores.shifted, FIXTURE, rec.shifted)], planted);
  decided.forEach((d, i) => expect(d['outcome'], `your blessing ${i} is decided: ${shown(d)}`).toBe('decided'));
  const view3d = view3dCall(spec);
  return run(bin(), dir, calls(stores, view3d), planted).map((r, i) => goldenReply(r, `golden call ${i}`));
}
/** On a second machine the check must not compare; each problem names the class the golden read. */
function secondMachineProblems(g: Golden, recording: string): string[] {
  const at = `on a second machine (gpu ${g.fingerprint.gpu}), the flock at step ${STEP} against the ${recording} recording, class ${g.cls ?? 'unreported'}`;
  const p: string[] = [];
  if (g.verdict === 'PASS' || g.verdict === 'FAIL') p.push(`${at}, was compared and read ${g.verdict}`);
  else if (g.verdict !== 'INCONCLUSIVE') p.push(`${at}, reads ${g.verdict}, not INCONCLUSIVE`);
  if (g.reason !== 'environment_changed') p.push(`${at}, reads reason ${g.reason}, not environment_changed`);
  if (g.numbers !== null) p.push(`${at}, carries comparison numbers ${shown(g.numbers)}`);
  const text = JSON.stringify(g.raw);
  if (!g.recorded || g.recorded.gpu === g.fingerprint.gpu || !text.includes(g.recorded.gpu) || !text.includes(OTHER.gpu)) p.push(`${at}, doesn't name both GPUs, the recording's and this run's`);
  if (g.cls !== 'same_machine') p.push(`${at}: the golden read class ${g.cls ?? 'unreported'}, not same_machine`);
  return p;
}

describe(`${AC[3]} a stepped flock's check compares only on the machine that recorded it`, () => {
  it(`${AC[3]} on the recording machine the flock at step 1,800 passes its recording and fails a one-ulp shift; on a second machine both read INCONCLUSIVE, naming both GPUs`, () => {
    requireGpu();
    const [same, shifted, sameThere, shiftedThere] = goldens(undefined, (s, v) => [
      goldenState(s.same, FIXTURE, v), goldenState(s.shifted, FIXTURE, v), goldenState(s.same, FIXTURE, v, OTHER), goldenState(s.shifted, FIXTURE, v, OTHER),
    ]);
    expect(same!.cls, 'the golden reads the flock\'s class, same_machine').toBe('same_machine');
    expect(same!.verdict, `on the recording machine the flock passes its recording: ${shown(same!.raw)}`).toBe('PASS');
    expect(shifted!.verdict, `on the recording machine a recording one ulp off fails (the comparison runs): ${shown(shifted!.raw)}`).toBe('FAIL');
    expect(shifted!.numbers, 'with its numbers').not.toBeNull();
    expect(secondMachineProblems(sameThere!, 'unshifted'), 'the unshifted recording on a second machine').toEqual([]);
    expect(secondMachineProblems(shiftedThere!, 'shifted'), 'the shifted recording on a second machine').toEqual([]);
  }, 3_600_000);

  it(`${AC[3]} a planted class that compares the flock across machines (--planted carried_class_exact) reads FAIL on a second machine and fails, naming the class`, () => {
    requireGpu();
    const [there] = goldens('carried_class_exact', (s, v) => [goldenState(s.shifted, FIXTURE, v, OTHER)]);
    failsNaming(secondMachineProblems(there!, 'shifted'), [/was compared and read FAIL/, /class (exact|same_machine|live_only)\b/], 'the planted carried_class_exact');
  }, 3_600_000);
});
