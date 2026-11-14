// #548.3c7384fe: deep_query of a 100-boid flock's logic at step 600 returns its arrays and per-step fuel equal to its
// bake's, and for a program that traps at step 412, the trap's step, kind, function and the input entries that step
// read, which deep_show replays to that step and no further
//
// The flock (programs.ts `flock`, 100 boids reading the sliders `wind` and `gust`) is a deep-show document; deep_query's
// logic read (README: deep_query) at steps 600 and 300, on the flock's track, against `deep-logic`'s bake of the same
// piece on the same track: every array and the step's fuel. The trapping program (`judge`) reads a `trigger` entry of 0
// at step 412 and divides by it in function 2; deep_query's trap names step 412, kind divide, function 2 and that one
// entry; deep-show's `logic` replay of the same track (README: `logic`'s `track` and `trap`) runs steps 0 to 412 and no
// further, and reports the same trap.

import { describe, expect, it } from 'vitest';
import { BOIDS, JUDGE_FUNCTION, TRAP_STEP, judge } from './programs.ts';
import { FLOCK_TRACK, JUDGE_TRACK, flockDoc, flockPiece, flockProgram, judgeDoc } from './fixtures.ts';
import {
  AC, DOC, MS, STEP, arr, bakeCall, bakeOf, firstDiff, int, logic, logicBin, logicReadOf, none, obj, prebuild, presented, putEvidence,
  queryLogic, runShow, scenario, show, showBin, showCall, str, useTemp, type JsonObject,
} from './helpers.ts';

prebuild(() => { logicBin(); showBin(); });
const temp = useTemp();

describe(`${AC[4]} deep_query reads a logic item's arrays, fuel and trap from its bake, and deep_show replays to the trap`, () => {
  it(`${AC[4]} deep_query of the 100-boid flock at step 600 (and 300) returns its arrays and per-step fuel equal to its bake's`, () => {
    const program = flockProgram();
    const [b] = logic([bakeCall(flockPiece(program), 720, FLOCK_TRACK)]);
    const bake = bakeOf(b!, 'the flock\'s bake, 720 steps');
    expect(bake.traps, 'the flock never traps').toEqual([]);
    const ev = temp();
    putEvidence(ev, program.bytes);
    const D = DOC(4);
    const r = runShow(scenario(ev, [D], [showCall(D, flockDoc('flock', program), 1), queryLogic(D, ['flock'], [600, 300], FLOCK_TRACK, 200 * MS)]), 'the flock presented and queried');
    presented(r[0]!, 'the flock');
    const read = logicReadOf(r[1]!, 'flock', 'deep_query of the flock');
    expect(read.steps.map((s) => s.step), 'one answer per step asked, in order').toEqual([600, 300]);
    const failures: string[] = [];
    for (const s of read.steps) {
      const want = bake.steps.find((x) => x.step === s.step)!;
      expect(want.arrays['flock.pos']?.length, `the bake's step ${s.step} holds the 100 boids`).toBe(BOIDS);
      for (const name of ['flock.pos', 'flock.vel', 'flock.score']) {
        const d = firstDiff(s.arrays[name] ?? [], want.arrays[name] ?? []);
        if (d) failures.push(`step ${s.step}: ${name} differs from the bake's at ${d}`);
      }
      if (s.fuel !== want.items['flock']?.fuel) failures.push(`step ${s.step}: fuel ${s.fuel}, the bake's ${show(want.items['flock']?.fuel ?? null)}`);
    }
    expect(JSON.stringify(read.steps[0]!.arrays['flock.pos']), 'steps 600 and 300 differ: the read is of the step asked').not.toBe(JSON.stringify(read.steps[1]!.arrays['flock.pos']));
    none(failures, 'deep_query against the bake');
    expect(read.trap, 'the flock never trapped').toBeNull();
  }, 3_600_000);

  it(`${AC[4]} for a program that traps at step 412, deep_query returns the trap's step, kind, function and the entries that step read, and deep_show replays to that step and no further`, () => {
    const program = judge();
    const ev = temp();
    putEvidence(ev, program.bytes);
    const D = DOC(5);
    const r = runShow(scenario(ev, [D], [
      showCall(D, judgeDoc('judge', program), 1),
      queryLogic(D, ['judge'], [TRAP_STEP], JUDGE_TRACK, 200 * MS),
      { call: 'logic', doc: D, steps: 600, track: JUDGE_TRACK as unknown as JsonObject[], at: 300 * MS },
    ]), 'the trapping program presented, queried and replayed');
    presented(r[0]!, 'the trapping program\'s document');
    const trap = logicReadOf(r[1]!, 'judge', 'deep_query of the trapping program').trap;
    expect(trap, `deep_query reports the item's trap: ${show(r[1], 1200)}`).not.toBeNull();
    const inputs = (t: JsonObject, what: string): string => show(arr(t['inputs'], `${what}.inputs`).map((e) => { const o = obj(e, `${what}.inputs[]`); return [o['t'], o['control'], o['value']]; }));
    const expected = { step: TRAP_STEP, kind: 'divide', function: JUDGE_FUNCTION, inputs: show([[TRAP_STEP * STEP, 'trigger', 0]]) };
    expect({ step: int(trap!['step'], 'trap.step'), kind: str(trap!['kind'], 'trap.kind'), function: trap!['function'], inputs: inputs(trap!, 'trap') }, 'the trap: step 412, kind divide, in function 2 (judge), and the one entry step 412 read').toEqual(expected);

    // deep_show's replay of the same track: to step 412 and no further.
    const replay = r[2]!;
    expect(replay['code'], `the logic replay answers: ${show(replay, 1200)}`).toBeUndefined();
    const steps = arr(replay['steps'], 'the replay\'s steps').map((s, i) => int(obj(s, `steps[${i}]`)['step'], `steps[${i}].step`));
    expect(steps.length ? [steps[0], steps[steps.length - 1], steps.length] : [], 'the replay runs steps 0 to 412 and none after').toEqual([0, TRAP_STEP, TRAP_STEP + 1]);
    const t2 = obj(replay['trap'], `the replay's trap (README: logic): ${show(replay['trap'] ?? null)}`);
    expect({ step: int(t2['step'], 'replay trap.step'), kind: str(t2['kind'], 'replay trap.kind'), function: t2['function'], inputs: inputs(t2, 'replay trap') }, 'the replay stops on the same trap').toEqual(expected);
  }, 3_600_000);
});
