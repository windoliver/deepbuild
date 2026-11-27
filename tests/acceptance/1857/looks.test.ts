// AC5 #1857.812f8d12: "A look whose line profile has `breaks: {every: 0, gap: 0}` is refused at check, naming
// `lines/<name>/profile/breaks/every`; a planted parser that admits it hangs a child process past 5 s and fails"
// AC6 #1857.52aa8ad1: "A line profile with `overshoot: 1e18`, and one with `flick: 1e18`, is refused naming the field,
// and the process stays up"
//
// Each test is one `deep-gpu run` child under `bounded.mjs`: 120 s to answer and 4,096 MB of resident memory, stopped
// by PID past either (README: What bounds each child). The child is given #385's `layers` call on the GPU layer: a
// 320 x 96 figure of one stroked path that names the look's line `nib`, and the suite's drawing look inline with
// `lines.nib = {kind: exact, width: 4, profile: …}` (as #149's figures pass a profile). A look is checked before its
// figure is drawn, so a refused look answers `{code, path}` and no `layers`; an admitted one is drawn, and the draw
// is where the base runs without end.
//
// asserts:
// - AC5: the child ran to its own end inside its limits, and its reply refuses the look with `out_of_range` at
//   exactly `lines/nib/profile/breaks/every`, with nothing drawn. Under `--planted profile_admits_zero_breaks` the
//   same check fails by the child still running 120 s after it was asked (past the criterion's 5 s), when it is
//   stopped by PID.
// - AC6: one child is given both looks, one call each; it ran to its own end inside its limits (never stopped,
//   exit 0, both calls answered: the process stayed up), and the replies refuse `overshoot: 1e18` with `out_of_range`
//   at exactly `lines/nib/profile/overshoot` and `flick: 1e18` at exactly `lines/nib/profile/flick`.
//
// Off macOS, where `deep-gpu` has no Metal device, each test ends INCONCLUSIVE, as a skip that says so, never a pass.
//
// Wrong programs: the merge base, which admits all three profiles: with `every: 0, gap: 0` its draw never ends and
// the child is stopped at its deadline; with `1e18` one stroke is asked for 10^18 points and the child ends without
// an answer or is stopped at its memory limit. And the planted parser of AC5.

import { describe, it } from 'vitest';
import { GPU_LIMITS, figure, failsBy, layersCall, look, none, requireMetal, runGpu, stroked, useDir, useGpu, type GpuPlanted } from './helpers.ts';
import { HANG_MS, OUT_OF_TIME, boundFailures, gpuRepliesOf, lookRefusalFailures, type JsonObject } from './judge.ts';

// Each criterion's tag, a constant of this file, so a test's name reads whole from its source.
const AC5 = 'AC5 #1857.812f8d12';
const AC6 = 'AC6 #1857.52aa8ad1';

const bin = useGpu();
const dir = useDir();

/** The look's line the figure's one stroke names. */
const NIB = 'nib';
const withProfile = (profile: JsonObject): JsonObject => look({ lines: { line: { kind: 'exact', width: 2 }, [NIB]: { kind: 'exact', width: 4, profile: { seed: 1, ...profile } } } });
/** One straight stroke, 280 px long, on a 320 x 96 figure. */
const FIGURE = figure('profile-1857', [320, 96], { stroke: stroked('stroke', 'M 20 48.5 L 300 48.5', NIB) });

interface Case { what: string; profile: JsonObject; path: string }
const ZERO_BREAKS: Case = { what: 'the look whose line profile has breaks {every: 0, gap: 0}', profile: { breaks: { every: 0, gap: 0 } }, path: `lines/${NIB}/profile/breaks/every` };
const OVERSHOOT: Case = { what: 'the look whose line profile has overshoot 1e18', profile: { overshoot: 1e18 }, path: `lines/${NIB}/profile/overshoot` };
const FLICK: Case = { what: 'the look whose line profile has flick 1e18', profile: { flick: 1e18 }, path: `lines/${NIB}/profile/flick` };

/** The criteria's check of looks given to one child, a call each: its failures, [] when each is refused at its path and the child stayed up. */
function refusedAtCheck(cases: readonly Case[], planted?: GpuPlanted): string[] {
  const what = cases.map((c) => c.what).join(', then ');
  const run = runGpu(dir(), bin(), cases.map((c) => layersCall(FIGURE, withProfile(c.profile))), planted);
  const out = boundFailures(run, `the child given ${what}`, GPU_LIMITS);
  if (out.length) return out;
  const { replies, failures } = gpuRepliesOf(run.answers[0]?.text ?? null, cases.length, what);
  if (failures.length) return failures;
  return cases.flatMap((c, i) => lookRefusalFailures(replies[i]!, c.path, c.what));
}

describe(`${AC5} a line profile with breaks {every: 0, gap: 0} is refused at check, naming lines/<name>/profile/breaks/every`, () => {
  it(`${AC5} the look is refused with out_of_range at lines/nib/profile/breaks/every, and nothing is drawn`, (ctx) => {
    requireMetal(ctx);
    none(refusedAtCheck([ZERO_BREAKS]), ZERO_BREAKS.what);
  });

  it(`${AC5} a planted parser that admits it hangs the child past 5 s and fails`, (ctx) => {
    requireMetal(ctx);
    const failures = refusedAtCheck([ZERO_BREAKS], 'profile_admits_zero_breaks');
    // The child's deadline is 120 s; a failure that says it ran out of time says it was still running then.
    failsBy(failures, (f) => f.includes(OUT_OF_TIME), `hanging past ${HANG_MS / 1000} s`, 'the planted profile_admits_zero_breaks');
  });
});

describe(`${AC6} a line profile with overshoot 1e18, and one with flick 1e18, is refused naming the field, and the process stays up`, () => {
  it(`${AC6} one child refuses both with out_of_range, at lines/nib/profile/overshoot and lines/nib/profile/flick, and ends by itself with exit 0`, (ctx) => {
    requireMetal(ctx);
    none(refusedAtCheck([OVERSHOOT, FLICK]), 'the two looks, given to one child');
  });
});
