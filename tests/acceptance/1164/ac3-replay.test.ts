// AC3 #1164.636499d1: "Replaying the recorded input track in a fresh headless process gives the same input-track hash,
// full-state hashes at each checkpoint, step hashes, and render-back snapshots at 0.1 s after each press, by hash, as
// the first run"
//
// asserts: the first run plays the game with keys in the app (README: The play) and reads the input track with its
// hash (`track`, chosen), `logic` over the 12 s (each checkpoint's full-state hash and each step's hash) and a
// render-back snapshot (`eval` with pixels) at 0.1 s after each press. A fresh `deep-show run` with no clock and no
// display presents the same game, loads the recorded track (`track` with `load`, chosen) and reads the same: the
// track's hash, every checkpoint's full-state hash, every step hash and every snapshot equal the first run's, by hash.
// Wrong program: the merge base, which has no `track` call.
import { describe, expect, it } from 'vitest';
import {
  AC, PRESSES, Script, TIMEOUT, evalCall, game, keepProof, logicCall, logicOf, none, prebuild, program, putEvidence, runShow, scenario, sec,
  show, showBin, snapshotOf, trackCall, trackOf, playedOf, useDir, type JsonObject, type Logic,
} from './helpers.ts';

prebuild(() => { showBin(); program('rules'); });
const dir = useDir();

interface Reading { hash: string; logic: Logic; snapshots: string[] }
function reads(r: JsonObject[], idx: { track: number; logic: number; evals: number[] }, what: string): Reading {
  return {
    hash: trackOf(r[idx.track]!, `${what}: track`).hash,
    logic: logicOf(r[idx.logic]!, `${what}: logic`),
    snapshots: idx.evals.map((i, n) => snapshotOf(r[i]!, `${what}: the snapshot at ${PRESSES[n]!.s + 0.1} s`)),
  };
}
const after = PRESSES.map((p) => sec(p.s + 0.1));

describe(`${AC[3]} a recorded track replayed in a fresh headless process`, () => {
  it(`${AC[3]} replaying the recorded input track in a fresh headless process gives the same track hash, full-state hashes at each checkpoint, step hashes and snapshots at 0.1 s after each press, by hash`, () => {
    const p = program('rules');
    putEvidence(dir(), p.bytes);
    const a = new Script(game(p.sha));
    const ia = { track: a.add((at) => trackCall(at)), logic: a.add((at) => logicCall(at)), evals: after.map((t) => a.add((at) => evalCall(t, at))) };
    const ra = runShow(scenario(dir(), a.calls), 'AC3: the first run, played with keys');
    playedOf(ra, a, 'AC3: the first run');
    const recorded = trackOf(ra[ia.track]!, 'AC3: the first run: track');
    expect(recorded.entries.length, `AC3: the first run recorded the seven presses: ${show(recorded.raw)}`).toBe(PRESSES.length);

    const b = new Script(game(p.sha), { play: false });
    b.add((at) => trackCall(at, recorded.raw));
    const ib = { track: b.add((at) => trackCall(at)), logic: b.add((at) => logicCall(at)), evals: after.map((t) => b.add((at) => evalCall(t, at))) };
    const rb = runShow(scenario(dir(), b.calls, { headless: true }), 'AC3: the replay in a fresh headless process');
    expect(rb[0]!['outcome'], `AC3: the replay presents the game: ${show(rb[0])}`).toBe('presented');

    const first = reads(ra, ia, 'AC3: the first run');
    const replay = reads(rb, ib, 'AC3: the replay');
    keepProof('ac3-runs.json', { first, replay, track: recorded.raw });
    expect(first.logic.checkpoints.length, 'AC3: the first run has checkpoints to compare').toBeGreaterThan(1);
    expect(first.logic.steps.length, 'AC3: the first run has steps to compare').toBeGreaterThan(0);
    const failures: string[] = [];
    if (replay.hash !== first.hash) failures.push(`${AC[3]} the input track's hash: the replay's ${replay.hash}, the first run's ${first.hash}`);
    const deep = new Map(replay.logic.checkpoints.map((c) => [c.step, c.deep]));
    for (const c of first.logic.checkpoints) if (deep.get(c.step) !== c.deep) failures.push(`${AC[3]} checkpoint ${c.step}: the replay's full-state hash ${show(deep.get(c.step))}, the first run's ${c.deep}`);
    if (replay.logic.checkpoints.length !== first.logic.checkpoints.length) failures.push(`${AC[3]} the replay has ${replay.logic.checkpoints.length} checkpoints, the first run ${first.logic.checkpoints.length}`);
    const hashes = new Map(replay.logic.steps.map((s) => [s.step, s.hash]));
    const differ = first.logic.steps.find((s) => s.hash === null || hashes.get(s.step) !== s.hash);
    if (differ) failures.push(`${AC[3]} step ${differ.step}: the replay's step hash ${show(hashes.get(differ.step))}, the first run's ${show(differ.hash)}`);
    first.snapshots.forEach((h, n) => { if (replay.snapshots[n] !== h) failures.push(`${AC[3]} the snapshot at ${PRESSES[n]!.s + 0.1} s: the replay's ${replay.snapshots[n]}, the first run's ${h}`); });
    none(failures, 'AC3: the replay equals the first run by hash');
  }, TIMEOUT);
});
