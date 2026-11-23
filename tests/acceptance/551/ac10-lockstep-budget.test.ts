// AC10 #551.4b4f0458: A test piece whose busiest match step costs 3 ms of CPU fails net.budget with window 8, naming the
// canvas module that costs most, and passes with window 0 and delay 6, where net.budget reports that one step's time;
// and a net item with delay 31 or window 17 is refused at check, naming the field, while delay 30 with window 0 is
// accepted
//
// The test piece is fixtures.ts's burning piece whose logic spends about 3 ms of CPU on one match step in every 10
// (steps k ≡ 9 mod 10; calibrated on the reference Mac this job ran on) and next to nothing on the others, beside a
// world at rest, in the showpiece class (4 ms of frame CPU). net.budget is `match`'s check, its timings by the five-run
// rule (INCONCLUSIVE off a reference Mac or where the runs don't decide, never a pass): with window 8 it must fail,
// naming logic; with window 0 and delay 6 it measures the busiest single match step, reports it as `busiest {step, ms}`
// (#549's field) with no window time, and passes. The check's refusals are `deep show`'s (#549's suite: an error issue
// naming the field). The refusals already hold at the base and sit in this one test with the budget, which doesn't.
// Wrong programs it fails: the merge base (net.budget answers BLOCKED for window 8); a lockstep budget that still
// counts a window; one that reports a light step; a range that takes delay 31 or window 17, or refuses delay 30.
import { describe, expect, it } from 'vitest';
import { BUSIEST_MS, DOC, burnDoc, burnItems, paddleDoc, rulesProgram, spins, type JsonObject } from './fixtures.ts';
import { AC, FULL, TIMEOUT, budgetFailures, budgetOf, isObject, namesModule, none, num, obj, play, show, useBuilds, useChildren, useTemp, world } from './helpers.ts';
import { Script, putEvidence, runShow } from '../549/helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 600;
const burn = { every: 10, heavyMs: BUSIEST_MS, lightMs: 0.001 };

/** A `deep show` reply refused at check with an error issue naming the net item's `field` (#549's README: Refused at
 * check), or accepted with none. */
function refusalFailures(reply: JsonObject | undefined, field: string | null, what: string): string[] {
  const r = obj(reply, what);
  const errors = (Array.isArray(r['issues']) ? r['issues'] : []).filter(isObject).filter((i) => i['severity'] === 'error');
  if (field === null) return r['outcome'] === 'presented' && errors.length === 0 ? [] : [`${what} is refused: ${show(r, 1200)}`];
  if (r['outcome'] === 'presented' && errors.length === 0) return [`${what} is presented, not refused at check`];
  const names = (i: JsonObject): boolean => {
    const path = String(i['path'] ?? '');
    const actual = isObject(i['actual']) ? i['actual'] : {};
    return (path.split(/[/.[\]]/).includes(field) || actual['field'] === field) && JSON.stringify([i['path'] ?? null, i['ids'] ?? null]).includes('match');
  };
  return errors.some(names) ? [] : [`${what}: no error issue names the net item's field ${field}: ${show(errors, 1200)}`];
}

describe(`${AC[10]} a piece whose busiest match step costs 3 ms, with window 8 and in lockstep; delay and window limits`, () => {
  it(`${AC[10]} net.budget fails the 3 ms piece with window 8, naming logic, and passes it with window 0 and delay 6, reporting that one step's time; delay 31 and window 17 are refused at check, naming the field, and delay 30 with window 0 is accepted`, async () => {
    // The limits at check: three net items in one run.
    const evidence = temp();
    putEvidence(evidence, rulesProgram().bytes);
    const s = new Script();
    const docs = [
      { id: DOC.delay31, net: { delay: 31 }, field: 'delay' },
      { id: DOC.window17, net: { window: 17 }, field: 'window' },
      { id: DOC.delay30, net: { delay: 30, window: 0 }, field: null },
    ];
    const at = docs.map((d) => s.present(d.id, paddleDoc(d.net, d.id)));
    const r = await runShow(builds.show(), world(evidence, docs.map((d) => d.id), s.calls), 'AC10 the delay and window limits');
    none(docs.flatMap((d, i) => refusalFailures(r[at[i]!], d.field, `AC10 a net item with ${JSON.stringify(d.net)}`)), 'the net item\'s delay and window limits at check');

    // The 3 ms piece.
    const programs = [burnItems(burn).program];
    const eight = await play(builds.show(), temp(), 'AC10 net.budget with window 8', { document: burnDoc(DOC.busiest, burn, { window: 8 }), steps: STEPS, plays: spins(STEPS), check: 'net.budget', programs });
    const b8 = budgetOf(eight.check!, 'AC10 window 8');
    none([...budgetFailures(b8, 'FAIL', 'AC10 window 8'), ...namesModule(b8, 'logic', 'AC10 window 8')], 'net.budget fails the 3 ms piece with window 8, naming logic');
    const lock = await play(builds.show(), temp(), 'AC10 net.budget in lockstep', { document: burnDoc(DOC.busiest, burn, { window: 0, delay: 6 }), steps: STEPS, plays: spins(STEPS), check: 'net.budget', programs });
    const b0 = budgetOf(lock.check!, 'AC10 window 0, delay 6');
    const f = budgetFailures(b0, 'PASS', 'AC10 window 0, delay 6');
    b0.runs.forEach((x, i) => { if (x.windowMs !== 0) f.push(`run ${i + 1}: in lockstep net.budget still counts ${x.windowMs} ms of window`); });
    const busiest = obj(b0.raw['busiest'], `AC10: net.budget reports its busiest step (busiest {step, ms}): ${show(b0.raw, 600)}`);
    const [step, ms] = [num(busiest['step'], 'AC10 busiest.step'), num(busiest['ms'], 'AC10 busiest.ms')];
    if (step % burn.every !== burn.every - 1) f.push(`net.budget reports step ${step} as the busiest, not one of the 3 ms steps (k ≡ ${burn.every - 1} mod ${burn.every})`);
    if (!(ms >= BUSIEST_MS / 2 && ms <= b0.frameMs)) f.push(`net.budget reports the busiest step's time as ${ms} ms, not the 3 ms step's within the ${b0.frameMs} ms frame`);
    none(f, 'net.budget passes the 3 ms piece in lockstep with delay 6, reporting that one step');
    expect(b0.raw['window'], 'net.budget measures the lockstep match with window 0').toBe(0);
  }, TIMEOUT);
});
