// AC2 #2844.11438f50: "Every frame that `tests/acceptance/2031/` and `tests/acceptance/2032/` draw is byte-identical to the
// merge base, and both suites pass unchanged"
//
// The merge base is `git merge-base HEAD origin/main` (else `main`): its tree exported and its own `deep-canvas-render`
// and `deep-gpu` built from it by #2031's `useMergeBase`, the build both suites' AC7 keep under
// `<target>/acceptance-2031-base`. The checkout's two binaries are built as every file of the suites builds them.
// One run serves both tests (helpers `runSuites`): each test file the merge base holds under the two folders is run by
// the checkout's own vitest, as it is. Where a file builds and copies its binaries it gets recorder.mjs, which runs
// the real binary, hands its answer on untouched and writes the call down. So the frames the suites draw are listed
// by the suites themselves: a file has no other way to a binary, and a file none of whose calls was recorded fails
// the run.
//   - Frames. A frame is every picture a call's answer names (`window2d`'s window, each side and glyph run of
//     `layers`, a film's captured frame), each `raster` picture, each `pixel_hash` of a `film2d` frame, and each
//     refusal. For every call the checkout's binary drew without `--planted`, the merge base's binary draws the same
//     request, once: the suites' own AC7 ask it themselves, and that answer is the one compared. Pictures compare by
//     the SHA-256 of their bytes, frame hashes by their text, refusals by code and path. A difference names the
//     file, the request and the frame.
//   - The comparison is shown failing first. The suites draw windows under nine planted programs (`deep-gpu run
//     --planted <name>`), wrong programs the base already holds (helpers `PLANTS`). Each such call is compared the
//     same way, with the merge base drawing without the plant, and each must differ; two are held to the frame they
//     are caught at, #2032's `shadow-edge` and #2031's `lit-falloff`. A frame drawn under a plant is no frame of
//     the right program, so it is judged only here.
//   - Both suites pass unchanged. Unchanged: every file of the two folders, and every helper they import from other
//     suites, holds the merge base's bytes, none added and none gone. Pass: every test the run reports passed, each
//     file reporting its tests. The two budget files (`ac8-budget.test.ts`) run for their frames, the scene at the
//     cap among them; their timing verdict is criterion 1's and #2031's own, and is printed, not judged (README).
// Off macOS's Metal device, where `deep-gpu` answers `unsupported_platform`, where the merge base can't be exported or
// built, or where a test of the suites is itself INCONCLUSIVE, these fail `INCONCLUSIVE:`, never passing.
// Wrong programs: a light pass that moves one pixel of a lit or shadowed group (the nine plants; the twin
// `default-ambient-zero`), bins that drop a segment at the cap, an edge antialiased another way, a suite edited,
// skipped or cut short so that it passes.
import { describe, expect, it } from 'vitest';
import {
  differences, failsNaming, inconclusive, isPicture, none, outcomes, PLANTS, requireMetal, runSuites, useBin, useMergeBase, type Call, type Run,
} from './helpers.ts';

const AC2 = 'AC2 #2844.11438f50';
const head = { canvas: useBin('deep-canvas-render'), gpu: useBin('deep-gpu') };
const base = useMergeBase();
/** Where two of the planted programs must be caught: the window of each suite's own document. */
const EDGE = '[0] window2d of shadow-edge: window, drawn under --planted shadow_edge_aliased';
const FALLOFF = '[0] window2d of lit-falloff: window, drawn under --planted light_linear_falloff';

// One run of the two suites serves both tests; a run that could not be made fails both the same way.
let held: { run: Run } | { error: unknown } | undefined;
function suites(): Run {
  if (held === undefined) {
    try {
      let built: ReturnType<typeof base>;
      try { built = base(); } catch (e) { inconclusive(`the merge base can't be exported or built, so there is nothing to compare with: ${(e as Error).message.slice(0, 1500)}`); }
      held = { run: runSuites({ rev: built.rev, src: built.src, base: { canvas: built.canvas, gpu: built.gpu }, head: { canvas: head.canvas(), gpu: head.gpu() } }) };
    } catch (error) {
      held = { error };
    }
  }
  if ('error' in held) throw held.error;
  return held.run;
}
const framesOf = (calls: Call[]): string[] => calls.flatMap((c) => Object.values(c.frames ?? {}));

describe(`${AC2} #2031's and #2032's frames stay as the merge base draws them`, () => {
  it(`${AC2} every frame the two suites draw is byte-identical to the merge base's`, () => {
    requireMetal();
    const run = suites();
    none(run.problems, 'the run of the two suites, every call of theirs recorded');
    const drew = run.calls.filter((c) => c.role === 'head' && c.draws);
    if (drew.some((c) => [...framesOf([c]), ...Object.values(c.base ?? {})].some((f) => f.startsWith('code unsupported_platform')))) inconclusive('deep-gpu reports unsupported_platform');

    // The comparison, shown failing on the wrong programs the base holds.
    const planted = drew.filter((c) => c.planted !== null && (c.verbs ?? []).includes('window2d'));
    none([
      ...PLANTS.filter((p) => !planted.some((c) => c.planted === p)).map((p) => `no suite drew a window under --planted ${p}, so the comparison was not shown failing on it`),
      ...planted.filter((c) => differences(c).length === 0).map((c) => `${c.file}: the windows drawn under --planted ${String(c.planted)} compare as the merge base's`),
    ], 'the comparison fails on each planted program');
    const caught = planted.flatMap(differences);
    failsNaming(caught, EDGE, 'the planted shadow edge with no antialiasing');
    failsNaming(caught, FALLOFF, 'the planted linear falloff');

    // The right program's frames against the merge base's.
    const right = drew.filter((c) => c.planted === null);
    const differing = right.flatMap(differences);
    const pictures = framesOf(right).filter(isPicture).length;
    const redrawn = right.filter((c) => (c.baseMs ?? 0) > 0);
    console.log(`${AC2}: ${run.files.length} files in ${run.seconds} s; ${right.length} calls drew ${framesOf(right).length} frames, ${pictures} of them pictures or frame hashes, compared with the merge base ${run.rev.slice(0, 12)}; ${differing.length} differ. The merge base drew ${redrawn.length} of those requests for this comparison (${Math.round(redrawn.reduce((ms, c) => ms + (c.baseMs ?? 0), 0) / 1000)} s) and the suites asked it the rest themselves. ${planted.length} calls drew windows under a planted program, ${caught.length} of their frames caught`);
    none(differing.slice(0, 40), `${differing.length} frames the checkout draws other than the merge base ${run.rev.slice(0, 12)} does, the first of them`);

    // Nothing missing: a file that asked for frames got pictures, and every test that draws ran to its end.
    none(run.files.filter((f) => right.some((c) => c.file === f) && !framesOf(right.filter((c) => c.file === f)).some(isPicture)).map((f) => `${f} asked for frames and no picture was drawn`), 'each file that draws has pictures to compare');
    expect(pictures, 'pictures and frame hashes compared').toBeGreaterThan(0);
    const { failed, unjudged } = outcomes(run.tests);
    if (failed.length || unjudged.length) inconclusive(`no frame that was drawn differs, but these tests of the suites did not pass, so the frames they draw are not all here:\n  ${[...failed, ...unjudged].slice(0, 20).join('\n  ')}`);
  }, 4 * 3_600_000);

  it(`${AC2} both suites pass unchanged`, () => {
    requireMetal();
    const run = suites();
    none(run.changed, `the two suites and the helpers they import hold the merge base ${run.rev.slice(0, 12)}'s bytes`);
    none(run.problems, 'the run of the two suites, every call of theirs recorded');
    const { passed, failed, unjudged, aside } = outcomes(run.tests);
    console.log(`${AC2}: ${passed} of ${run.tests.length - aside.length} tests passed in ${run.seconds} s; ${failed.length} failed, ${unjudged.length} INCONCLUSIVE. Not judged, the budget files:\n  ${aside.join('\n  ')}`);
    none([...run.files.filter((f) => !run.tests.some((t) => t.file === f)).map((f) => `${f} reports no test`), ...failed], 'the two suites, run unchanged');
    if (unjudged.length) inconclusive(`these tests of the suites could not be judged here:\n  ${unjudged.join('\n  ')}`);
    expect(passed, 'the judged tests of the two suites passed').toBe(run.tests.length - aside.length);
  }, 4 * 3_600_000);
});
