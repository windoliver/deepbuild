// #1173.b5284ee0: A box silhouette drawn at 4× MSAA has pixels of partial coverage along its edge on every frame and
// every export, and a planted single-sample target fails, naming the target.
//
// The box is `boxDoc` (helpers.ts): a 3 m teal box seen face on by an orthographic camera, its 240 px square turned
// off the pixel grid by a channel (10° to 40° over 1 s), on paper. One process draws it by #378's `view3d` for frames
// 0 … 29 at 30 fps, every frame's final target read back, and by #379's `canonical` as an export (frames 1, 15 and 30),
// a render-back and a frame-budget check's frame (frame 15), each final target read back (this suite's `targets`).
// The view reports MSAA 4 (`surface.msaa`) and so does each canonical render (`msaa`), and in every picture the box's
// edge has partial coverage (helpers.ts, `coverageOf`): on at least 40% as many pixels as its boundary, 90% of them
// within 2 px of it. Wrong programs: the base (scene3d draws single-sample, and neither reply reports a count); `--planted
// single_sample_targets` (issue-named: scene3d's targets made single-sample), which must fail naming the target.
import { describe, expect, it } from 'vitest';
import {
  BOX_FPS, BOX_FRAMES, BOX_LOOK, BOX_VIEW, MSAA, boxDoc, canonicalCall, canonicalOf, coverageProblems, finalOf, payload, requireMetal, run, useBuild, useOut,
  view3dCall, viewOf, writeJson, type JsonObject, type Planted, type Purpose,
} from './helpers.ts';

const ID = '#1173.b5284ee0';
const EXPORTS: [Purpose, number][] = [['export', 1], ['export', 15], ['export', 30], ['render_back', 15], ['frame_budget', 15]];

const bin = useBuild();
const out = useOut();

/** Every frame and every export of the turning box, measured: failures as sentences naming the picture and the target. */
function edgeProblems(planted?: Planted): string[] {
  const view = writeJson(out(), 'box', boxDoc());
  const doc = writeJson(out(), 'box-payload', payload(boxDoc()));
  const calls: JsonObject[] = [
    view3dCall({ doc: view, look: BOX_LOOK, size: BOX_VIEW, from: 0, frames: BOX_FRAMES, fps: BOX_FPS, capture: 'every', targets: ['final'] }),
    ...EXPORTS.map(([purpose, frame]) => canonicalCall(doc, BOX_LOOK, BOX_VIEW, frame, purpose)),
  ];
  const [v, ...cs] = run(bin(), out(), calls, planted);
  const problems: string[] = [];
  const drawn = viewOf(v!, 'the view');
  expect(drawn.frames.map((f) => f.frame), 'the view drew frames 0 … 29').toEqual(Array.from({ length: BOX_FRAMES }, (_, i) => i));
  expect(drawn.frames[0]!.pixel_hash, 'the box turns between frames 0 and 29').not.toBe(drawn.frames[BOX_FRAMES - 1]!.pixel_hash);
  if (drawn.msaa !== MSAA) problems.push(`the view: the surface reports msaa ${drawn.msaa}, not ${MSAA}`);
  for (const f of drawn.frames) problems.push(...coverageProblems(`frame ${f.frame}`, finalOf(out(), f, `frame ${f.frame}`), drawn.targets));
  cs.forEach((reply, i) => {
    const [purpose, frame] = EXPORTS[i]!;
    const where = `${purpose} frame ${frame}`;
    const c = canonicalOf(out(), reply, where);
    expect([c.purpose, c.frame], `${where}: the canonical render answers for its purpose and frame`).toEqual([purpose, frame]);
    if (c.msaa !== MSAA) problems.push(`${where}: the canonical render reports msaa ${c.msaa}, not ${MSAA}`);
    problems.push(...coverageProblems(where, c.final, c.targets));
  });
  console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: ${problems.length} problems${problems.length ? `, the first: ${problems[0]}` : ''}`);
  return problems;
}

describe(`${ID} a box silhouette drawn at 4× MSAA has pixels of partial coverage along its edge on every frame and every export`, () => {
  it(`${ID} the turning box at 4× MSAA: partial coverage along its edge in each of frames 0 … 29 and in each export, render-back and frame-budget frame`, () => {
    requireMetal();
    expect(edgeProblems(), 'every frame and every export has partial coverage along the box\'s edge').toEqual([]);
  }, 3_600_000);

  it(`${ID} a planted single-sample target fails, naming the target`, () => {
    requireMetal();
    const problems = edgeProblems('single_sample_targets').join('\n');
    expect(problems, '--planted single_sample_targets fails on a frame, naming the single-sample color target').toMatch(/^frame \d+: the box's edge has \d+ pixels of partial coverage .*; scene3d's color target was made with 1 sample$/m);
    expect(problems, 'and on an export, naming it').toMatch(/^export frame \d+: the box's edge has \d+ pixels of partial coverage .*; scene3d's color target was made with 1 sample$/m);
  }, 3_600_000);
});
