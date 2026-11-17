// Criterion 13: at 120 Hz under 9.81 m/s², a 1 m jump on flat ground followed on its 56th step, the first whose
// vertical speed turns downward, by `launch {vertical: 4.4294}` (√(2 × 9.81 × 1)) peaks with its lowest point 2.0370 m
// above the floor within 1 mm, the second arc rising 1.0185 m as the first did; a `jump` on that step in place of the
// launch leaves every step hash equal to a run without it, so the second-jump rule still holds; and a planted backend
// that ignores `launch` off the ground peaks at 1.0185 m and fails, naming the step.
//
// The jump is stamped 30 (its step ends in state 31); its 56th step ends in state 86, so the launch is stamped 85. The
// heights are read from where the lowest point stood on the floor before the jump (state 30), since 2.0370 is the two
// arcs' rises (README: Readings). The judge compares the run with the discrete solution step by step and names the first
// step that departs from it by more than 1 mm. The wrong program is `--backend ignores_launch_airborne`.
import { describe, expect, test } from 'vitest';
import {
  AC, G, HERO, TIMEOUT, bake, caught, discreteHeights, entry, flatWorld, hashesOf, jump, lowest, named, none, physics,
  prebuild, statesOf, type Runner,
} from './helpers.ts';

prebuild(['shipped', 'test']);
const AT = 30;
const NTH = 56;
const LAUNCH = 4.4294;
const STEPS = 300;

/** The jump and launch run, and everything wrong with its peak and its second arc. */
function launchFailures(r: Runner): string[] {
  const v0 = Math.sqrt(2 * G * 1);
  const want = discreteHeights(v0, STEPS - AT, { at: NTH - 1, v: LAUNCH });
  const first = want[NTH - 2]!;
  const peakWant = Math.max(...want);
  expect(Math.abs(peakWant - 2.037), `the discrete solution peaks at ${peakWant}, the issue's 2.0370`).toBeLessThan(5e-5);
  expect(Math.abs(peakWant - first - 1.0185), `its second arc rises ${peakWant - first}, the issue's 1.0185`).toBeLessThan(5e-5);
  const [reply] = physics([bake(flatWorld(), STEPS, { track: [jump(AT), entry(AT + NTH - 1, 'launch', { vertical: LAUNCH })], read: [HERO] })], r);
  const states = statesOf(reply!, HERO, 'the jump and launch');
  const rest = lowest(states[AT]!);
  const rise = states.slice(AT + 1).map((s) => lowest(s) - rest);
  const out: string[] = [];
  const peak = Math.max(...rise);
  if (Math.abs(peak - peakWant) > 0.001) {
    const k = rise.findIndex((y, i) => Math.abs(y - want[i]!) > 0.001);
    out.push(`it peaks ${peak.toFixed(5)} m above where it stood, not ${peakWant.toFixed(5)} (2.0370) within 1 mm; it first departs from the discrete solution at step ${AT + 1 + k}`);
  }
  const second = peak - rise[NTH - 2]!;
  if (Math.abs(second - 1.0185) > 0.001) out.push(`its second arc rises ${second.toFixed(5)} m, not 1.0185 within 1 mm`);
  return out;
}

describe(`${AC[13]} a launch in the air starts a second arc; a jump there still does nothing`, () => {
  test(`${AC[13]} a launch of 4.4294 m/s on the jump's 56th step peaks 2.0370 m up within 1 mm, its second arc rising 1.0185 m; a jump on that step instead changes no step hash`, () => {
    none(launchFailures({}), 'rapier3d');
    const w = flatWorld();
    const [without, instead] = physics([
      bake(w, STEPS, { track: [jump(AT)], read: [HERO] }),
      bake(w, STEPS, { track: [jump(AT), jump(AT + NTH - 1)], read: [HERO] }),
    ]);
    const [a, b] = [hashesOf(without!, 'the jump alone'), hashesOf(instead!, 'with a jump on its 56th step')];
    expect(b.length, 'both runs answer every step').toBe(a.length);
    expect(a.findIndex((h, i) => h !== b[i]), 'a jump on the 56th step, in the air, leaves every step hash equal').toBe(-1);
  }, TIMEOUT);

  test(`${AC[13]} a backend that ignores launch off the ground (--backend ignores_launch_airborne) peaks at 1.0185 m and fails, naming the step`, () => {
    const failures = launchFailures({ backend: 'ignores_launch_airborne' });
    caught(failures, 'the backend that ignores a launch in the air');
    named(failures, [`step ${AT + NTH}`], 'its failure names the launch\'s step');
    const [reply] = physics([bake(flatWorld(), STEPS, { track: [jump(AT), entry(AT + NTH - 1, 'launch', { vertical: LAUNCH })], read: [HERO] })], { backend: 'ignores_launch_airborne' });
    const states = statesOf(reply!, HERO, 'the launch ignored');
    const peak = Math.max(...states.slice(AT + 1).map(lowest)) - lowest(states[AT]!);
    expect(Math.abs(peak - 1.0185), `it peaks at the first arc's ${peak.toFixed(5)} m, 1.0185 within 1 mm`).toBeLessThanOrEqual(0.001);
  }, TIMEOUT);
});
