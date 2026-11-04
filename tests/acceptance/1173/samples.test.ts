// #1173.8d6404d5: The surface reply's `msaa` equals the sample count scene3d's targets were made with; a reply that
// claims MSAA over single-sample targets fails, naming both.
//
// One process draws C1's box (`boxDoc`) by #378's `view3d` (one frame) and by #379's `canonical` as an export, a
// render-back and a frame-budget check's frame. Each reply's surface sample count (`surface.msaa` on view3d, `msaa`
// on a canonical render) is a number, 4 on this Metal device, and equals the `sample_count` of every target scene3d
// reports making for its geometry pass (`render_targets`, which holds its `color` and `depth`). Wrong programs: the
// base (the replies carry no count and no targets; scene3d makes every target single-sample); `--planted
// claims_msaa_over_single_sample` (issue-named: the replies say 4 while scene3d makes its targets single-sample),
// which must fail naming both the reply's count and the target's.
import { describe, expect, it } from 'vitest';
import {
  BOX_LOOK, BOX_VIEW, MSAA, boxDoc, canonicalCall, canonicalOf, payload, requireMetal, run, sampleProblems, useBuild, useOut, view3dCall, viewOf, writeJson,
  type Planted, type Purpose,
} from './helpers.ts';

const ID = '#1173.8d6404d5';
const CANONICALS: Purpose[] = ['export', 'render_back', 'frame_budget'];

const bin = useBuild();
const out = useOut();

/** Each reply's sample count against its targets': failures as sentences naming both. */
function replyProblems(planted?: Planted): { problems: string[]; counts: number[] } {
  const view = writeJson(out(), 'box', boxDoc());
  const doc = writeJson(out(), 'box-payload', payload(boxDoc()));
  const [v, ...cs] = run(bin(), out(), [
    view3dCall({ doc: view, look: BOX_LOOK, size: BOX_VIEW, from: 0, frames: 1, capture: [0], targets: ['final'] }),
    ...CANONICALS.map((p) => canonicalCall(doc, BOX_LOOK, BOX_VIEW, 1, p)),
  ], planted);
  const drawn = viewOf(v!, 'view3d');
  const problems = sampleProblems('view3d', drawn.msaa, drawn.targets);
  const counts = [drawn.msaa];
  cs.forEach((reply, i) => {
    const c = canonicalOf(out(), reply, CANONICALS[i]!);
    problems.push(...sampleProblems(CANONICALS[i]!, c.msaa, c.targets));
    counts.push(c.msaa);
  });
  console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: the replies report msaa ${counts.join(', ')}; ${problems.length} problems${problems.length ? `, the first: ${problems[0]}` : ''}`);
  return { problems, counts };
}

describe(`${ID} the surface reply's msaa equals the sample count scene3d's targets were made with`, () => {
  it(`${ID} view3d's surface and each canonical render (export, render-back, frame budget) report msaa 4, the sample count of every target scene3d made`, () => {
    requireMetal();
    const { problems, counts } = replyProblems();
    expect(counts, 'each reply reports 4× MSAA on this Metal device').toEqual([MSAA, MSAA, MSAA, MSAA]);
    expect(problems, 'each reply\'s msaa is its targets\' sample count').toEqual([]);
  }, 3_600_000);

  it(`${ID} a reply that claims MSAA over single-sample targets fails, naming both`, () => {
    requireMetal();
    const problems = replyProblems('claims_msaa_over_single_sample').problems.join('\n');
    expect(problems, '--planted claims_msaa_over_single_sample fails on view3d, naming the claim and the target').toMatch(/^view3d: the surface reply says msaa 4, but scene3d's (color|depth) target was made with 1 sample$/m);
    expect(problems, 'and on the export').toMatch(/^export: the surface reply says msaa 4, but scene3d's (color|depth) target was made with 1 sample$/m);
  }, 3_600_000);
});
