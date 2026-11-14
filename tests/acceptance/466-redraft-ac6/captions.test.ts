// AC6 #466.84cc08bc: "A caption designed by the look keeps its profile's timing and line limits and passes
// render.contrast, and a caption pointing at an intertitle draws no second copy while the .srt still carries its line"
//
// Fixtures (helpers.ts), 640 × 360 films at 24 fps under flat drawn looks, each with a script whose lines are `caption`
// lines (no sound) under the profile netflix-en-adult (42 characters a line, 2 lines, 20 characters a second, 5/6 s
// shortest, 2 frames' gap):
//   - The harbour film: the line `harbour` at 0.5 s, 71 characters, on a `raised` plate, under the caption look (the
//     look's `captions {plate: card, entrance: unfold, text_after: 0.5, anchor: [0.5, 1], stage: after_finish}`) and
//     under the plain look (the same look with no `captions`). By the layout rule its one caption `harbour.1` is the
//     lines "A small lamp glows over the quiet harbour" (41) / "while the fishing boats sleep" (29), from frame 12
//     (⌊0.5 s ÷ Δ⌋) to frame 98 (⌈(0.5 + 71 ÷ 20) s ÷ Δ⌉ = ⌈97.2⌉): 500 to 4,083 ms in the .srt. Its contrast twin is
//     the same film with the plate in `muted` (#7c7c7c), under 4.5:1 against the ink (4.05:1) and against white (4.17:1).
//   - The intertitle film: an intertitle text@1 "The harbour sleeps" shown the whole 3 s, and the line `sleeps` of the
//     same words at 0.5 s: by the layout rule `sleeps.1`, frames 12 to 34 (500 to 1,416 ms). Pointing: the captions
//     block names `shown_by: intertitle`. The control: the same film without `shown_by`.
//
// asserts:
//   - Timing and line limits: the open export under the caption look gives one caption, `harbour.1`, with exactly the
//     layout rule's lines and in- and out-times, in its receipt and its .srt, and exactly what the plain look gives:
//     the look designs the caption and never changes its timing or its lines.
//   - render.contrast (at 2 s, while the caption shows) PASSes the harbour film under the caption look with nothing
//     raised; the same judge fails its muted-plate twin, naming the caption `harbour`.
//   - Pointing: the open export's 72 frames are byte-identical (receipt hashes) to the closed export's, which draws no
//     caption, so the caption draws no second copy; its receipt and .srt still carry `sleeps.1` at frames 12 to 34.
//     The control's open export differs from its closed one on exactly frames 12 to 33, so the comparison sees a
//     caption when one draws.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC6, DOC, FRAME, HARBOUR, HARBOUR_CUE, SLEEPS_CUE, contrastFailures, cueFailures, exportCall, exported, exportScenario, failsNaming, harbourFilm,
  intertitleFilm, judgeScenario, lookOf, none, rowOf, run, srtCues, TIMEOUT, useFolders, useShow,
} from './helpers.ts';

const bin = useShow();
const folder = useFolders();
const CONTRAST = { kind: 'render.contrast', at_times: ['2s'] };

describe(`${AC6} a caption the look designs keeps its profile, passes render.contrast, and a pointing caption draws nothing twice`, () => {
  it(`${AC6} a caption designed by the look keeps its profile's timing and line limits`, () => {
    const exportUnder = (designed: boolean): ReturnType<typeof exported> => {
      const look = lookOf(designed);
      const out = join(folder(), 'frames');
      const what = `the harbour film's open export under the ${designed ? 'caption' : 'plain'} look`;
      const [, reply] = run(bin(), exportScenario(folder(), harbourFilm(DOC, look, 'raised'), [look], [exportCall(out, 'open')]), what);
      return exported(reply!, out, what);
    };
    const designed = exportUnder(true);
    const plain = exportUnder(false);
    const failures = [
      ...cueFailures(designed.cues, [HARBOUR_CUE], 'flicks', 'the caption look\'s receipt'),
      ...(designed.srt === null ? ['the caption look\'s export wrote no .srt beside its frames'] : cueFailures(srtCues(designed.srt), [HARBOUR_CUE], 'ms', 'the caption look\'s .srt')),
      ...cueFailures(plain.cues, [HARBOUR_CUE], 'flicks', 'the plain look\'s receipt'),
    ];
    for (const c of designed.cues) {
      if (c.lines.length > 2) failures.push(`${c.name} holds ${c.lines.length} lines, over the profile's 2`);
      for (const l of c.lines) if ([...l].length > 42) failures.push(`${c.name} has a line of ${[...l].length} characters, over the profile's 42: ${l}`);
    }
    if (JSON.stringify(designed.cues) !== JSON.stringify(plain.cues)) failures.push(`the caption look's cues differ from the plain look's: ${JSON.stringify(designed.cues)} against ${JSON.stringify(plain.cues)}`);
    if (designed.srt !== plain.srt) failures.push('the caption look\'s .srt differs from the plain look\'s');
    none(failures, 'the designed caption against its profile');
  }, TIMEOUT);

  it(`${AC6} the designed caption passes render.contrast`, () => {
    const look = lookOf(true);
    const [reply] = run(bin(), judgeScenario(folder(), harbourFilm(DOC, look, 'raised'), [look], CONTRAST), 'render.contrast on the harbour film');
    none(contrastFailures(rowOf(reply!), HARBOUR.id, 'the harbour film'), 'render.contrast on the designed caption');
  }, TIMEOUT);

  it(`${AC6} its twin on a muted plate fails render.contrast, naming the caption`, () => {
    const look = lookOf(true);
    const [reply] = run(bin(), judgeScenario(folder(), harbourFilm(DOC, look, 'muted'), [look], CONTRAST), 'render.contrast on the muted-plate twin');
    failsNaming(contrastFailures(rowOf(reply!), HARBOUR.id, 'the muted-plate twin'), [`names the caption ${HARBOUR.id}`], 'render.contrast on a caption under 4.5:1');
  }, TIMEOUT);

  const openAndClosed = (pointing: boolean): { open: ReturnType<typeof exported>; closed: ReturnType<typeof exported> } => {
    const look = lookOf(true);
    const d = folder();
    const what = `the intertitle film ${pointing ? 'pointing at its intertitle' : 'without shown_by'}`;
    const [, open, closed] = run(bin(), exportScenario(folder(), intertitleFilm(DOC, look, pointing), [look], [exportCall(join(d, 'open'), 'open'), exportCall(join(d, 'closed'), 'closed')]), what);
    return { open: exported(open!, join(d, 'open'), `${what}, open`), closed: exported(closed!, join(d, 'closed'), `${what}, closed`) };
  };
  const differingFrames = (a: string[], b: string[]): number[] => a.map((h, k) => (h === b[k] ? -1 : k)).filter((k) => k >= 0);

  it(`${AC6} a caption pointing at an intertitle draws no second copy while the .srt still carries its line`, () => {
    const { open, closed } = openAndClosed(true);
    const failures: string[] = [];
    if (open.hashes.length !== 72 || closed.hashes.length !== 72) failures.push(`the exports hold ${open.hashes.length} and ${closed.hashes.length} frames, not 72`);
    const drawn = differingFrames(open.hashes, closed.hashes);
    if (drawn.length) failures.push(`the open export draws a second copy of the intertitle's words on frames ${drawn.join(', ')}`);
    failures.push(...cueFailures(open.cues, [SLEEPS_CUE], 'flicks', 'the open export\'s receipt'));
    failures.push(...(open.srt === null ? ['the open export wrote no .srt'] : cueFailures(srtCues(open.srt), [SLEEPS_CUE], 'ms', 'the open export\'s .srt')));
    none(failures, 'the caption pointing at the intertitle');
  }, TIMEOUT);

  it(`${AC6} without shown_by, the same caption draws on exactly its frames (the comparison sees a caption)`, () => {
    const { open, closed } = openAndClosed(false);
    const want = Array.from({ length: (SLEEPS_CUE.out - SLEEPS_CUE.in) / FRAME }, (_, i) => SLEEPS_CUE.in / FRAME + i);
    expect(differingFrames(open.hashes, closed.hashes), 'the frames the control\'s open export draws its caption on').toEqual(want);
  }, TIMEOUT);
});
