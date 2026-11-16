// AC4 #1164.bfcc143f: "Seeking to each press's flick and to 50 random times gives the frame hash and full-state hash
// playing gives, and logic.determinism reads PASS keyed to the revision. A planted restore that zeroes the memory-only
// move count on a seek to 7.5 s leaves every later step hash and array equal and still fails on the full-state hash of
// the first checkpoint after the seek, naming it; a check that compares step hashes alone passes that restore and
// fails this test"
//
// asserts: a first run plays the game and reads each press's flick (its entry's `t`). A second run plays it the same
// and, at those seven flicks and 50 seeded random times in [0, 10 s): #488's `determinism` gives each time's played
// and seeked frame, equal by hash; `logic` with a seek to each time's step (the last at or before it) restores and
// runs to the first checkpoint after it, whose full-state hash, and every step hash and array on the way, equal the
// straight run's; the claim's logic.determinism row reads PASS, keyed to the current revision's hash.
// Wrong programs: the scenario's `restore_zeroes_move_count` (chosen) zeroes the program's move count (at its
// `moves_at`) when a seek to 7.5 s restores; the seek to step 225 keeps every step hash and array equal, and the
// judgement fails naming checkpoint 240's full-state hash; logic.determinism (sampling 7.5 s) reads FAIL.
// With #532's `check_compares_step_hashes` too, logic.determinism reads PASS on that restore, and this test's
// requirement that it catch the restore fails, naming the criterion.
import { describe, expect, it } from 'vitest';
import {
  AC, REQ, STEP, Script, TIMEOUT, currentHash, determinismCall, failsNaming, game, isObject, keepProof, logicCall, logicOf, none, prebuild,
  program, putEvidence, revisionsCall, runShow, same, sameDoc, scenario, sec, seeded, show, showBin, playedOf, useDir, verdictCall, verdictOf, DOC,
  type Logic, type Planted,
} from './helpers.ts';

prebuild(() => { showBin(); program('rules'); });
const dir = useDir();
/** The step a seek to `t` shows: the last at or before it. */
const seekStep = (t: number): number => Math.floor(t / STEP);

/** AC4's judgement of seeks against the straight run: the first checkpoint after each seek, and each step on the way. */
function judgeSeeks(logic: Logic, times: number[]): string[] {
  const out: string[] = [];
  const straight = new Map(logic.steps.map((s) => [s.step, s]));
  const deep = new Map(logic.checkpoints.map((c) => [c.step, c.deep]));
  times.forEach((t, i) => {
    const s = logic.seeks[i];
    const where = `the seek to flick ${t} (step ${seekStep(t)})`;
    if (!s) { out.push(`${AC[4]} ${where}: the logic call answers no seek`); return; }
    for (const row of s.steps) {
      const play = straight.get(row.step);
      if (!play || row.hash !== play.hash) out.push(`${AC[4]} ${where}: step ${row.step}'s step hash ${show(row.hash)}, playing's ${show(play?.hash)}`);
      for (const [name, v] of Object.entries(row.arrays)) if (!same(v, play?.arrays[name])) out.push(`${AC[4]} ${where}: step ${row.step}'s ${name} ${show(v)}, playing's ${show(play?.arrays[name])}`);
    }
    if (!s.checkpoint) out.push(`${AC[4]} ${where}: no checkpoint after it`);
    else if (deep.get(s.checkpoint.step) !== s.checkpoint.deep) out.push(`${AC[4]} ${where}: the full-state hash of checkpoint ${s.checkpoint.step}, the first after it, is ${s.checkpoint.deep}; playing's is ${show(deep.get(s.checkpoint.step))}`);
  });
  return out;
}

/** The check's verdict in a `logic` reply (#539's `check`). */
const checkVerdict = (logic: Logic): string => String(logic.check?.['verdict']);

describe(`${AC[4]} seeking equals playing, by frame and full-state hash`, () => {
  it(`${AC[4]} seeking to each press's flick and to 50 random times gives the frame hash and full-state hash playing gives, and logic.determinism reads PASS keyed to the revision`, () => {
    const p = program('rules');
    putEvidence(dir(), p.bytes);
    const first = new Script(game(p.sha));
    const flicks = playedOf(runShow(scenario(dir(), first.calls), 'AC4: the first run'), first, 'AC4: the first run').map((e) => e.t);
    const r = seeded(1164);
    const times = [...flicks, ...Array.from({ length: 50 }, () => Math.floor(r() * sec(10)))];

    const s = new Script(game(p.sha));
    const det = s.add((at) => determinismCall(times, at));
    const lg = s.add((at) => logicCall(at, { seeks: times.map(seekStep) }));
    const rev = s.add(revisionsCall);
    const ver = s.add(verdictCall);
    const replies = runShow(scenario(dir(), s.calls), 'AC4: the game played, then seeked');
    playedOf(replies, s, 'AC4: the second run');
    keepProof('ac4-seeks.json', { times, determinism: replies[det], logic: replies[lg], verdict: replies[ver] });

    const failures: string[] = [];
    const frames = (Array.isArray(replies[det]!['frames']) ? replies[det]!['frames'] : []).filter(isObject);
    expect(frames.length, `AC4: determinism compares every time asked: ${show(replies[det])}`).toBe(new Set(times).size);
    for (const f of frames) {
      const play = isObject(f['play']) ? f['play']['pixels'] : undefined;
      const seek = isObject(f['seek']) ? f['seek']['pixels'] : undefined;
      if (play === undefined || play === null || !same(play, seek)) failures.push(`${AC[4]} the frame at flick ${show(f['t'])}: played ${show(play)}, seeked ${show(seek)}`);
    }
    failures.push(...judgeSeeks(logicOf(replies[lg]!, 'AC4: logic'), times));
    const v = verdictOf(replies[ver]!, 'AC4: the verdict');
    const row = v.rows.get(REQ.determinism);
    if (row?.['result'] !== 'PASS') failures.push(`${AC[4]} logic.determinism reads ${show(row?.['result'])}, not PASS: ${show(row ?? v.raw, 1200)}`);
    const hash = currentHash(replies[rev]!, 'AC4: revisions');
    if (!v.key.some((k) => sameDoc(k.doc, DOC) && k.hash === hash)) failures.push(`${AC[4]} the verdict isn't keyed to the current revision ${hash}: ${show(v.raw['key'])}`);
    none(failures, 'AC4: seeking equals playing, and logic.determinism reads PASS keyed to the revision');
  }, TIMEOUT);

  it(`${AC[4]} wrong programs: a restore that zeroes the move count on a seek to 7.5 s (restore_zeroes_move_count) fails on checkpoint 240's full-state hash, and a check comparing step hashes alone (check_compares_step_hashes) passes it and fails this test`, () => {
    const p = program('rules');
    putEvidence(dir(), p.bytes);
    const seek = sec(7.5);
    expect(seekStep(seek), 'a seek to 7.5 s shows step 225').toBe(225);
    const run = (planted: Planted[]): Logic => {
      const s = new Script(game(p.sha));
      const lg = s.add((at) => logicCall(at, { seeks: [seekStep(seek)], check: true, atTimes: [7.5] }));
      const replies = runShow(scenario(dir(), s.calls, { planted }), `AC4: planted ${planted.join(' + ')}`);
      playedOf(replies, s, `AC4: planted ${planted.join(' + ')}`);
      keepProof(`ac4-planted-${planted.join('+')}.json`, replies[lg]);
      return logicOf(replies[lg]!, `AC4: planted ${planted.join(' + ')}: logic`);
    };

    const zeroed = run(['restore_zeroes_move_count']);
    const judged = judgeSeeks(zeroed, [seek]);
    none(judged.filter((f) => !/full-state hash/.test(f)), 'AC4: the zeroing restore leaves every later step hash and array equal');
    expect(zeroed.seeks[0]?.steps.length ?? 0, 'AC4: the seek ran steps to compare').toBeGreaterThan(0);
    failsNaming(judged, AC[4], [/checkpoint 240\b/, /full-state hash/], 'AC4: restore_zeroes_move_count');
    expect(checkVerdict(zeroed), `AC4: logic.determinism fails the zeroing restore: ${show(zeroed.check, 1200)}`).toBe('FAIL');

    const hashesOnly = run(['restore_zeroes_move_count', 'check_compares_step_hashes']);
    expect(checkVerdict(hashesOnly), `AC4: the check that compares step hashes alone passes the zeroing restore: ${show(hashesOnly.check, 1200)}`).toBe('PASS');
    const catches = checkVerdict(hashesOnly) === 'FAIL' ? [] : [`${AC[4]} logic.determinism reads ${checkVerdict(hashesOnly)} on a restore that zeroes the move count on a seek to 7.5 s: a check that compares step hashes alone`];
    failsNaming(catches, AC[4], [/step hashes alone/], 'AC4: check_compares_step_hashes');
  }, TIMEOUT);
});
