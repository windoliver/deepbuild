// Criterion 3: "A fault of 0.5 Ω from live to neutral behind a B16 breaker is closed by an input. At the first step k
// that carries it, the fault carries 460 A, 28.75 times the rating. From step k + 1 `on` reads 0 and every part
// carries 0 A. A planted library with no magnetic element holds the fault for 0.123 s, until its thermal element
// opens, and fails `circuit.breaker`, naming the breaker, the step it opened and step k + 1."
//
// Through `deep-logic first_party`, `playback` and `judge` (README: The surface): a B16 feeding a 60 W lamp, and the
// fault from its load side to neutral closed by `short` at step 100 (circuits.ts: SHORT), 1,000 steps a second, 300
// steps. By hand: 230 ÷ 0.5 = 460 A, 460 ÷ 16 = 28.75, past B's 4, so the magnetic element opens it at the start of
// step k + 1. With no magnetic element the thermal one opens it: the breaker carries 460.26 A (the lamp's 0.26 A too),
// x² = 828.4, and θ reaches 1.69 after −60 ln(1 − 1.69 ÷ 828.4) = 0.1227 s, step k + 123 (model.ts). On the
// reference library: k = 100 is the first step the fault carries current, 460 A within 1e-9 relative; from k + 1 the
// breaker's `on` reads 0 and every part's `i` and `i_rms` are 0 within 1e-9 A to the end; circuit.breaker, circuit.kcl
// and circuit.power pass. Then the planted library `no_magnetic` (README: Planted libraries), linked by its own name:
// it opens at k + 123 within one step, and circuit.breaker fails, naming `main`, that step and k + 1. The wrong
// programs: a magnetic element on peak current or a step late, one that never acts, a breaker that opens without cause,
// current through an open breaker, and a breaker rule that reads only the heat.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, num, onHost, prebuild, show, str } from '../190/helpers.ts';
import { LAMP, SHORT, SHORTED, index } from './circuits.ts';
import { AC, BREAKER, KCL, POWER, circuitLib, judgeCall, judged, nums, plantedPiece, playbackCall, played, refPiece, rel, rule } from './helpers.ts';
import { thermalSteps } from './model.ts';

prebuild(() => { logicBin(); });

const STEPS = Array.from({ length: SHORT.steps }, (_, k) => k);
const [main, fault] = ['main', 'fault'].map((id) => index(SHORT.circuit, id)) as [number, number];
const THERMAL = thermalSteps(((SHORTED.amps + LAMP.amps) / 16) ** 2, 1e-3).steps;

describe(`${AC[3]} a short behind a B16`, () => {
  it(`${AC[3]} a 0.5 Ω fault closed by an input: at the first step k that carries it, 460 A, 28.75 times the rating; from step k + 1 on reads 0 and every part carries 0 A`, () => {
    expect([230 / 0.5, 230 / 0.5 / 16, THERMAL], '460 A, 28.75 times 16 A; without a magnetic element the thermal one opens after 123 steps').toEqual([SHORTED.amps, SHORTED.multiple, 123]);

    const L = circuitLib();
    const p = refPiece(L, [SHORT]);
    const [play, judge] = onHost([playbackCall(p, SHORT, STEPS), judgeCall(p, SHORT)]);
    const at = played(play!, SHORT.item);
    const k = STEPS.find((s) => nums(at.get(s), 'i_rms')[fault]! > 1e-9);
    expect(k, 'the first step that carries the fault is the step its input closes it, 100').toBe(SHORTED.k);
    expect(rel(nums(at.get(k!), 'i_rms')[fault]!, SHORTED.amps), `at step k the fault carries 460 A: ${nums(at.get(k!), 'i_rms')[fault]}`).toBeLessThanOrEqual(1e-9);
    expect(nums(at.get(k!), 'on')[main], 'and the breaker is still closed at k').toBe(1);
    const parts = SHORT.circuit.parts.map((q) => q.id);
    const after = STEPS.slice(k! + 1).flatMap((s) => {
      const a = at.get(s);
      const live = parts.filter((_, q) => !(Math.abs(nums(a, 'i')[q]!) <= 1e-9 && Math.abs(nums(a, 'i_rms')[q]!) <= 1e-9));
      return [...(nums(a, 'on')[main] !== 0 ? [`step ${s}: on ${nums(a, 'on')[main]}`] : []), ...(live.length ? [`step ${s}: ${live.join(', ')} carry current`] : [])];
    });
    expect(after.slice(0, 10), `from step k + 1 = ${k! + 1} on reads 0 and every part carries 0 A`).toEqual([]);
    const j = judged(judge!, SHORT.item);
    for (const code of [BREAKER, KCL, POWER]) expect([rule(j, code).verdict, rule(j, code).fails], `${code} passes on the reference library: ${show(rule(j, code).fails as never)}`).toEqual(['PASS', []]);
  }, TIMEOUT);

  it(`${AC[3]} a planted library with no magnetic element holds the fault for 0.123 s, until its thermal element opens, and fails circuit.breaker, naming the breaker, the step it opened and step k + 1`, () => {
    const L = circuitLib();
    const p = plantedPiece(L, 'no_magnetic', SHORT);
    const [play, judge] = onHost([playbackCall(p, SHORT, STEPS), judgeCall(p, SHORT)]);
    const at = played(play!, SHORT.item);
    const opened = STEPS.find((s) => nums(at.get(s), 'on')[main] === 0);
    expect(opened, 'the planted breaker opens').toBeDefined();
    expect(Math.abs(opened! - (SHORTED.k + 123)), `it holds the fault 0.123 s: it opens at step ${opened}, k + 123 within one step`).toBeLessThanOrEqual(1);
    expect(STEPS.slice(SHORTED.k, opened).filter((s) => !(rel(nums(at.get(s), 'i_rms')[fault]!, SHORTED.amps) <= 1e-9)).slice(0, 5), 'carrying the 460 A fault until then').toEqual([]);
    const failed = rule(judged(judge!, SHORT.item), BREAKER);
    expect(failed.verdict, `circuit.breaker fails: ${show(failed.fails as never)}`).toBe('FAIL');
    const f = failed.fails.find((x) => x['breaker'] === 'main' && x['expected'] !== null && x['expected'] !== undefined);
    expect(f, `a fail names the breaker main, the step it opened and the step its elements give: ${show(failed.fails as never)}`).toBeDefined();
    expect(str(f!['breaker'], 'breaker'), 'by its part ID').toBe('main');
    expect(num(f!['step'], 'the step it opened'), `the step it opened, ${opened}: ${show(f!)}`).toBe(opened);
    expect(num(f!['expected'], 'the step its elements give'), `and step k + 1 = ${SHORTED.k + 1}, the step its magnetic element gives: ${show(f!)}`).toBe(SHORTED.k + 1);
  }, TIMEOUT);
});
