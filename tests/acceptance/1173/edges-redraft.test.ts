// #1173.b5284ee0: A box silhouette drawn at 4× MSAA has pixels of partial coverage along its edge on every frame and every
// export, and a planted single-sample target fails, naming the target. (Blind redraft; C1-REDRAFT.md.)
//
// Proof (the issue): edge coverage read back from the resolved targets. The box is an unlit 2 m cube turned corner-on
// to an orthographic camera, so its silhouette is a hexagon of one color on the ground; over 24 frames it turns 7.3° and
// slides 1.825 × 1.325 px a frame, so every frame puts its edges at a new angle and sub-pixel offset. Each frame is drawn
// by #378's `view3d` with its resolved `linear` target and its `final` target read back, and each frame's export by
// #379's `canonical` call (purpose export), with the same two targets. The resolve averages a pixel's samples in linear
// light, so a pixel k of 4 samples cover reads k ÷ 4 of the way from the ground to the face; the measure
// (edges-redraft-helpers.ts: edgeCoverage) reads that in linear light (the final's sRGB codes decoded first) and needs at
// least 0.3 of the silhouette's edge pixels, and 60 pixels, partly covered. A single-sample target leaves none.
// Wrong programs: the base (every target single-sample; no `msaa` count, no export targets); `--planted
// single_sample_targets` (scene3d's geometry-pass targets made single-sample).
import { describe, expect, it } from 'vitest';
import {
  COLOR_TARGET, FRAMES, GEOMETRY_PASS, GRID_4X, MSAA, ONE_SAMPLE, OUTPUT_PASS, STANDARD_4X, VIEW,
  answered, coverageLine, coverageProblems, cubeDoc, edgeCoverage, exportCall, exportOf, finalPicture, fixtureProblems, framesOf, linearPicture,
  passesOf, payload, poseAt, rasterize, requireMetal, run, silhouette, slotHashOf, throughFinal, useBuild, useOut, view3dCall, viewMsaaOf, writeJson,
  type EdgeCoverage, type Picture, type Planted,
} from './edges-redraft-helpers.ts';

const ID = '#1173.b5284ee0';
const bin = useBuild();
const out = useOut();

interface Read { what: string; kind: 'frame' | 'export'; msaa: number; coverage: EdgeCoverage; problems: string[] }

/** The two targets of one drawing, measured: each failure names the frame or export and the target read. */
function measured(kind: 'frame' | 'export', label: string, msaa: number, linear: Picture, final: Picture): Read[] {
  const reads: Read[] = [];
  for (const [target, picture] of [[`scene3d's \`${COLOR_TARGET}\` target, read back resolved`, linear], [`its \`final\` target, drawn from scene3d's \`${COLOR_TARGET}\` target`, final]] as const) {
    const what = `${label} (msaa ${msaa} by the reply), ${target}`;
    const coverage = edgeCoverage(picture);
    reads.push({ what, kind, msaa, coverage, problems: coverageProblems(coverage, what) });
  }
  return reads;
}

/** Every frame of the fixture drawn by view3d and every frame's export by canonical, in one process, each target measured. */
function drawn(planted?: Planted): Read[] {
  const doc = writeJson(out(), 'box', cubeDoc());
  const sent = writeJson(out(), 'box-payload', payload(cubeDoc(), 'work_product'));
  const calls = [view3dCall(doc), ...Array.from({ length: FRAMES }, (_, n) => exportCall(sent, n + 1))];
  const [view, ...exports] = run(bin(), out(), calls, planted);
  answered(view!, 'the view3d call');

  // The color target named: the one scene3d's geometry pass writes and its output pass reads.
  const passes = passesOf(view!, 'the view3d call');
  const geometry = passes.find((p) => p.name === GEOMETRY_PASS);
  const output = passes.find((p) => p.name === OUTPUT_PASS);
  expect(geometry?.writes, `${GEOMETRY_PASS} writes the \`${COLOR_TARGET}\` target`).toContain(COLOR_TARGET);
  expect(output?.reads, `${OUTPUT_PASS} reads the \`${COLOR_TARGET}\` target`).toContain(COLOR_TARGET);

  const msaa = viewMsaaOf(view!, 'the view3d call');
  const frames = framesOf(view!, 'the view3d call');
  expect(frames.map((f) => f.frame), 'the view drew frames 0 … 23').toEqual(Array.from({ length: FRAMES }, (_, i) => i));
  const reads: Read[] = [];
  for (const f of frames) {
    const label = `frame ${f.frame}`;
    const { picture, image } = finalPicture(out(), f.final, VIEW, `${label}'s final target`);
    expect(slotHashOf(image), `${label}: the final PNG holds the slot's bytes`).toBe(f.pixel_hash);
    reads.push(...measured('frame', label, msaa, linearPicture(out(), f.linear, VIEW, `${label}'s linear target`), picture));
  }
  exports.forEach((reply, n) => {
    const label = `the export of frame ${n + 1} (view3d frame ${n})`;
    const e = exportOf(reply, label);
    expect([e.purpose, e.frame], `${label} is an export of frame ${n + 1}`).toEqual(['export', n + 1]);
    const { picture, image } = finalPicture(out(), e.final, VIEW, `${label}'s final target`);
    expect(slotHashOf(image), `${label}: the final PNG holds the export's bytes`).toBe(e.pixel_hash);
    reads.push(...measured('export', label, e.msaa, linearPicture(out(), e.linear, VIEW, `${label}'s linear target`), picture));
  });
  const shares = (k: Read['kind']): number[] => reads.filter((r) => r.kind === k).map((r) => r.coverage.share);
  const worst = reads.reduce((a, b) => (b.coverage.share < a.coverage.share ? b : a));
  console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: frames' edge share ${Math.min(...shares('frame')).toFixed(3)} to ${Math.max(...shares('frame')).toFixed(3)}, exports' ${Math.min(...shares('export')).toFixed(3)} to ${Math.max(...shares('export')).toFixed(3)}; lowest at ${worst.what}: ${coverageLine(worst.coverage)}`);
  return reads;
}

describe(`${ID} a box silhouette drawn at 4× MSAA has pixels of partial coverage along its edge on every frame and every export (redraft)`, () => {
  it(`${ID} the measure passes the fixture's silhouette resolved from 4 samples a pixel and fails it from 1, naming the target (holds at the base; proves the measure, not the renderer)`, () => {
    for (let n = 0; n < FRAMES; n += 5) {
      const { theta, pos } = poseAt(n);
      const poly = silhouette(theta, pos);
      for (const [pattern, samples] of [['standard 4x', STANDARD_4X], ['grid 4x', GRID_4X]] as const) {
        const resolved = rasterize(poly, samples);
        for (const [read, picture] of [['linear', resolved], ['final', throughFinal(resolved)]] as const) {
          expect(coverageProblems(edgeCoverage(picture), `pose ${n}, ${pattern}, ${read}`), `pose ${n}: a ${pattern} resolve read through the ${read} target passes`).toEqual([]);
        }
      }
      const single = edgeCoverage(throughFinal(rasterize(poly, ONE_SAMPLE)));
      expect(fixtureProblems(single, `pose ${n}, 1 sample`), `pose ${n}: the single-sample silhouette is the fixture's box`).toEqual([]);
      const problems = coverageProblems(single, `pose ${n}: the synthetic \`${COLOR_TARGET}\` target`);
      expect(problems.length, `pose ${n}: a single-sample silhouette fails the measure`).toBe(1);
      expect(problems[0], 'naming the target').toMatch(/the synthetic `linear` target: 0 pixels of partial coverage along the box's edge/);
    }
  });

  it(`${ID} every frame (read back from the resolved linear target and the final target) and every export of the turning box, drawn at 4× MSAA, has partial coverage along its edge`, () => {
    requireMetal();
    const reads = drawn();
    for (const r of reads) expect(r.msaa, `${r.what.split(' (')[0]} was drawn at ${MSAA}× MSAA`).toBe(MSAA);
    expect(reads.filter((r) => r.kind === 'frame').length, 'two targets read on each of the 24 frames').toBe(2 * FRAMES);
    expect(reads.filter((r) => r.kind === 'export').length, 'two targets read on each of the 24 exports').toBe(2 * FRAMES);
    expect(reads.flatMap((r) => r.problems), 'every frame and every export has partial coverage along the box\'s edge').toEqual([]);
  }, 1_800_000);

  it(`${ID} a planted single-sample target (--planted single_sample_targets) fails on every frame and every export, naming the target`, () => {
    requireMetal();
    const reads = drawn('single_sample_targets');
    for (const r of reads) {
      expect(fixtureProblems(r.coverage, r.what), `${r.what}: the box still draws, so the failure is its edge`).toEqual([]);
      expect(r.problems.length, `${r.what}: the single-sample target fails the measure`).toBe(1);
      expect(r.problems[0], `${r.what}: the failure names the target`).toMatch(new RegExp(`scene3d's \`${COLOR_TARGET}\` target.*: \\d+ pixels of partial coverage along the box's edge`));
    }
    expect(new Set(reads.map((r) => r.kind)), 'frames and exports both fail').toEqual(new Set(['frame', 'export']));
  }, 1_800_000);
});
