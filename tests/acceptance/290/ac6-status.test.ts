// AC6 #290.69fa44f2: A status color in front of the hidden item keeps its exact color; a planted pass drawn after the
// status guard tints it and fails, naming the pixel
//
// The fixture is helpers.ts's sphere behind a wall with a gauge before the wall: a 0.4 m `mark.box@1` 0.2 m nearer
// than the wall, over the sphere's hidden half, whose stroke and badge slots are bound to a verdict the call gives in
// state fail (`status_bindings`, `states`, as #382's and #424's suites bind one). On a 3D object a status binding's
// stroke draws as an outline around it and its badge beside it, in the look's exact fail color #bf232b, after tone
// mapping, the effects and the status guard. One process draws two frames with `view3d`: the fixture with no hidden
// view, and with `hidden_view: {opacity: 0.4}` on the sphere.
//
// Judged pixels: the status color in front of the hidden item is every pixel that reads exactly #bf232b in the frame
// with no hidden view and lies where the wall covers the sphere by its rays (helpers.ts, `sphereRegions`): the
// gauge's outline and badge, 663 pixels at the base (at least 100 asked). Each must read exactly #bf232b with the
// hidden view too. That it could do otherwise: the hidden view is drawn all around them, so of the pixels where the
// wall covers the sphere that show the wall and lie more than 2 px from any fail-colored pixel, at least 90% differ
// between the two frames by more than 2 codes.
//
// Wrong programs it fails: the merge base (no hidden view: nothing around the status color changes); `--planted
// hidden_view_after_status` (the hidden view's blended draw issued after the status guard and the status colors, over
// the final target), which blends the sphere over the outline and the badge and fails naming their pixels.
import { describe, expect, it } from 'vitest';
import { requireMetal, useDir, useGpu, writeJson } from '../424/helpers.ts';
import {
  AC, FAIL, OPACITY, SIZE, TIMEOUT, VERDICT, awayFrom, changed, count, exactly, finalOf, gpu, idsOf, refusals, sameFailures, shotsOf, sphereDoc, sphereRegions, view3d,
  type GpuPlanted, type Judged,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const LABELS = ['the gauge before the wall, no hidden view', 'the gauge before the wall, the sphere at opacity 0.4'];
const MIN_STATUS = 100;
const MIN_AROUND = 3_000;

interface Judgement { blocked: string[]; status: Judged | null; around: number; moved: number }
function judge(out: string, planted?: GpuPlanted): Judgement {
  const call = (name: string, hidden?: { opacity: number }) =>
    view3d({ doc: writeJson(out, name, sphereDoc(name, { gauge: true, ...(hidden ? { hidden } : {}) })), size: SIZE, targets: ['final', 'ids'], states: { [VERDICT]: 'fail' } });
  const run = gpu(bin(), out, [call('gauge-plain'), call('gauge-hidden', { opacity: OPACITY })], planted);
  const refused = refusals(run, LABELS);
  if (refused.length) return { blocked: refused, status: null, around: 0, moved: 0 };
  const [bare, hidden] = run.replies.map((r, i) => shotsOf(r, LABELS[i]!)[0]!);
  const without = finalOf(out, bare!, LABELS[0]!);
  const got = finalOf(out, hidden!, LABELS[1]!);
  const regions = sphereRegions();
  // The status color in front of the hidden item, and the wall around it.
  const marks = exactly(without, regions.hidden, FAIL);
  const everyMark = exactly(without, new Uint8Array(SIZE[0] * SIZE[1]).fill(1), FAIL);
  const ids = idsOf(out, bare!, LABELS[0]!);
  const around = awayFrom(regions.hidden, everyMark, SIZE, 2);
  for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) if (around[y * SIZE[0] + x] && ids.at(x, y) !== 'wall') around[y * SIZE[0] + x] = 0;
  const blocked: string[] = [];
  if (count(marks) < MIN_STATUS) blocked.push(`the fixture: only ${count(marks)} pixels of the exact fail color where the wall covers the sphere, fewer than ${MIN_STATUS}`);
  if (count(around) < MIN_AROUND) blocked.push(`the fixture: only ${count(around)} pixels of the wall over the sphere clear of the status color, fewer than ${MIN_AROUND}`);
  return { blocked, status: sameFailures(got, without, marks, 'the exact fail color it holds with no hidden view'), around: count(around), moved: changed(got, without, around) };
}

describe(`${AC[6]} a status color in front of the hidden item keeps its exact color`, () => {
  it(`${AC[6]} the outline and badge of a status-bound gauge before the wall keep the exact fail color where the hidden view draws all around them`, () => {
    requireMetal();
    const j = judge(dir());
    expect(j.blocked, 'view3d draws the two frames, and the fixture holds').toEqual([]);
    expect(j.moved, `the hidden view is drawn around the status color: ${j.moved} of ${j.around} wall pixels over the sphere differ from the frame with no hidden view by more than 2 codes, at least 90% must`).toBeGreaterThanOrEqual(0.9 * j.around);
    expect(j.status!.failures, `${j.status!.failing} of ${j.status!.judged} status-colored pixels in front of the hidden sphere lost their exact color`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[6]} a planted pass drawn after the status guard tints it and fails, naming the pixel`, () => {
    requireMetal();
    const j = judge(dir(), 'hidden_view_after_status');
    expect(j.blocked, '--planted hidden_view_after_status draws the two frames, and the fixture holds').toEqual([]);
    expect(j.status!.failing, `the planted pass fails the check of the status color (${j.status!.judged} pixels judged)`).toBeGreaterThan(0);
    expect(j.status!.failures.filter((f) => !/^pixel \(\d+, \d+\) /.test(f)), 'every failure names its pixel').toEqual([]);
    console.log(`${AC[6]} --planted hidden_view_after_status: ${j.status!.failing} of ${j.status!.judged} pixels fail; first: ${j.status!.failures[0]}`);
  }, TIMEOUT);
});
