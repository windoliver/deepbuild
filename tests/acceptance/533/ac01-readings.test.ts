// #533.1487ce3d: a logic item that reads a reading records one input entry per value its source delivers, a
// repeated value included, stamped at the first step not yet run, and a replay with the hub stopped reads the
// same values at the same steps.
//
// The source `feed` delivers through `append` into an open session (README: Sessions); the replay is a bake of
// the track the session recorded, in a fresh deep-logic process that nothing delivers to.
import { describe, expect, it } from 'vitest';
import {
  AC, STEP_60, TIMEOUT, appendCall, arr, bakeCall, firstDiff, int, layoutFor, num, obj, onLogic, openCall, piece, prebuild, show, stepCall, stepped, stepsOf, str,
  logicBin, type Delivery, type JsonObject, type StepRecord,
} from './helpers.ts';
import { FEED, LISTEN_WRITES, SHOWN, layoutProbe, listen } from './programs.ts';

const ID = AC[1];
prebuild(() => { logicBin(); });

const SOURCES = { feed: { shape: 'scalar' as const, delivery: 'each' as const, max_per_step: 16 } };
/** What the source delivers, and the last step run before each value arrives (−1: before step 0). */
const PLAN: { after: number; value: Delivery }[] = [
  { after: -1, value: { reading: FEED, value: 7, as_of: 1_000 } },
  { after: 2, value: { reading: FEED, value: 7, as_of: 2_000 } },
  { after: 2, value: { reading: FEED, value: 7, as_of: 2_000 } }, // the same value again, before the same step
  { after: 5, value: { reading: FEED, value: 9, as_of: 3_000 } },
  { after: 6, value: { reading: FEED, value: 7, as_of: 4_000 } },
];
/** Each value's step: the first step not yet run when it arrived. */
const STAMPS = PLAN.map((p) => p.after + 1);
const LAST = 9;

describe(`${ID} a reading's values are recorded as input entries at the first step not yet run, and replay without the hub`, () => {
  it(`${ID} five delivered values, a repeated one included, are five entries stamped at the first step not yet run; the item reads them there, and a bake of the recorded track with nothing delivering reads the same values at the same steps`, () => {
    const layout = layoutFor({ program: layoutProbe(), reads: [FEED], writes: LISTEN_WRITES }, { sources: SOURCES });
    const p = piece({ seed: 533_01, sources: SOURCES, items: { listen: { program: listen(layout), reads: [FEED], writes: LISTEN_WRITES } } });

    // One process: open, then the source's values between steps, as they arrive.
    const calls: JsonObject[] = [openCall(p)];
    const session = 's1';
    let ran = -1;
    for (const at of [...new Set(PLAN.map((x) => x.after)), LAST]) {
      if (at > ran) { calls.push(stepCall(session, at)); ran = at; }
      for (const d of PLAN.filter((x) => x.after === at)) calls.push(appendCall(session, d.value));
    }
    const rs = onLogic(calls);
    expect(rs[0]!['ok'], `open admits the piece reading ${FEED}: ${show(rs[0])}`).toBe(true);
    expect(rs[0]!['session'], 'the session is named in the open reply').toBe(session);

    // Each append answers with the entry as recorded: the reading, its value and as-of time, stamped by the module.
    const recorded = rs.filter((_, i) => calls[i]!['call'] === 'append').map((r, i) => {
      expect(r['ok'], `append ${i} recorded the value: ${show(r)}`).toBe(true);
      return obj(r['entry'], `append ${i}: entry`);
    });
    expect(recorded.map((e) => [e['reading'], e['value'], e['as_of'], e['t']]), 'each value is one entry with its source and as-of time, stamped at the first step not yet run')
      .toEqual(PLAN.map((x, i) => [FEED, x.value.value, x.value.as_of, STAMPS[i]! * STEP_60]));

    // The session's track: exactly those five entries, the repeat included, in step order.
    const steps: StepRecord[] = [];
    let track: JsonObject[] = [];
    rs.forEach((r, i) => { if (calls[i]!['call'] === 'step') { const s = stepped(r, `step to ${int(calls[i]!['to'] as number, 'to')}`); steps.push(...s.steps); track = s.track; } });
    expect(steps.map((s) => s.step), 'the step calls ran steps 0 to 9 once each').toEqual([...Array(LAST + 1).keys()]);
    expect(track.map((e) => [e['reading'] ?? null, e['value'], e['as_of'] ?? null, e['t']]), `the input track holds one entry per delivered value and nothing else: ${show(track)}`)
      .toEqual(PLAN.map((x, i) => [FEED, x.value.value, x.value.as_of, STAMPS[i]! * STEP_60]));

    // What the item read at each step: every value stamped for it, in delivery order, with its as-of time.
    const failures: string[] = [];
    for (const s of steps) {
      const want = PLAN.filter((_, i) => STAMPS[i] === s.step).map((x) => x.value);
      const pad = (xs: number[]): number[] => [...xs, ...Array(SHOWN).fill(0)].slice(0, SHOWN);
      const got = { count: s.arrays['listen.count'], values: s.arrays['listen.values'], as_of: s.arrays['listen.as_of'] };
      const expected = { count: [want.length], values: pad(want.map((w) => w.value)), as_of: pad(want.map((w) => w.as_of)) };
      if (JSON.stringify(got) !== JSON.stringify(expected)) failures.push(`step ${s.step}: read ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
    }
    expect(failures, `the item reads each value at its stamped step:\n  ${failures.join('\n  ')}`).toEqual([]);

    // The replay: a fresh process, the recorded track, and no source delivering anything.
    const [replay] = onLogic([bakeCall(p, track, LAST + 1)]);
    expect(replay!['ok'], `the bake of the recorded track runs: ${show(replay)}`).toBe(true);
    const replayed = stepsOf(replay!['steps'], 'replay.steps');
    expect(arr(replay!['track'], 'replay.track'), 'the replay read the track the run recorded').toEqual(track);
    expect(firstDiff(replayed, steps), 'the replay reads the same values at the same steps, with the same step hashes').toBe(null);
    expect(num(replayed[STAMPS[1]!]!.arrays['listen.count']![0], 'replay count at step 3'), 'the repeated value is read in the replay too').toBe(2);
    expect(str(replayed[0]!.hashes['listen'] ?? null, 'the replay\'s step 0 hash'), 'the replay\'s steps have hashes').toBe(steps[0]!.hashes['listen']);
  }, TIMEOUT);
});
