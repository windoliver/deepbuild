// AC8 (README: accessibility, Ambiguities: the cached-view condition). It holds "if cached views meet the first
// criterion", which this file reads from the replica, not from anyone's word: in 100 sibling frames on the 1,000-row
// list (the pointer moving between two rows, with no assistive tech), the first frame reuses cached views, or it
// doesn't. If it does: those views render 0 times over the 100 frames; and with accessibility active, a frame that
// reuses a cached view leaves the platform's accessibility tree node for node as a frame after a refresh leaves it,
// action listeners and focus included, which GPUI's plain reuse, planted, fails, naming the node. If no frame reuses a
// view, no cached view meets the first criterion and each test says so: it passes only on that measured reading.
import { afterAll, describe, expect, it } from 'vitest';
import {
  DRIVE_PLANT, cleanup, debugDrive, drawnOf, frameSaid, nameOf, onList, requireMacos, treeProblems, type Frame, type Report, type Tree,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const LONG = 3_600_000;

/** "100 sibling frames": the pointer between rows A and B, a hundred moves. R is the row the list's focus is on. */
const SIBLING_FRAMES = 100;
const A = 2;
const B = 3;
const R = 5;

let siblings: Promise<{ report: Report; steps: number[]; first: Frame }> | undefined;
/** The 100 sibling frames with no assistive tech, run once for the file. */
function siblingRun(): Promise<{ report: Report; steps: number[]; first: Frame }> {
  return siblings ??= (async () => {
    requireMacos();
    const { r, rows } = await onList({ bin: debugDrive(), launch: { read_back: 'off' } });
    try {
      await r.hoverAt(rows[A]!.center, 'onto row A');
      const steps: number[] = [];
      for (let k = 0; k < SIBLING_FRAMES; k++) {
        await r.hoverAt(rows[k % 2 === 0 ? B : A]!.center);
        steps.push(r.steps);
      }
      const report = await r.close();
      const drawn = drawnOf(report, steps);
      expect(drawn.length, 'each move between the two rows drew a frame').toBeGreaterThanOrEqual(SIBLING_FRAMES);
      return { report, steps, first: drawn[0]! };
    } finally {
      await r.stop();
    }
  })();
}
/** Whether cached views meet the first criterion, read from the first sibling frame; logs the reading when they don't. */
async function cached(): Promise<boolean> {
  const { report, first } = await siblingRun();
  if (first.reused.length) return true;
  console.log(`AC8 not applicable, as measured: ${frameSaid(first)} rendered ${first.rendered.map((e) => nameOf(report, e)).join(', ')} and reused no cached view, so no cached view meets the first criterion`);
  expect(first.rendered.length, 'the reading is a real frame: it rendered views').toBeGreaterThan(0);
  return false;
}

/** With accessibility active: focus on row R, the pointer onto A, then onto B: the tree after that frame, and after a refresh. */
async function accessibilityRun(plant?: string): Promise<{ frame: Frame; drawn: Tree; refreshed: Tree; report: Report }> {
  const { r, rows } = await onList({ bin: debugDrive(), plant, launch: { read_back: 'off', accessibility: true } });
  try {
    await r.click(rows[R]!.id);
    await r.settle();
    await r.hoverAt(rows[A]!.center, 'onto row A');
    await r.hoverAt(rows[B]!.center, 'onto row B, a sibling frame');
    const step = r.steps;
    const drawn = await r.accessibility();
    await r.refresh();
    const refreshed = await r.accessibility();
    const report = await r.close();
    const frame = drawnOf(report, [step])[0];
    expect(frame, 'the move onto row B drew a frame').toBeTruthy();
    return { frame: frame!, drawn, refreshed, report };
  } finally {
    await r.stop();
  }
}

describe('#1482 AC8 cached views, if they meet the first criterion', () => {
  it('AC8 with no assistive tech, a cached view renders 0 times over 100 sibling frames', async () => {
    if (!(await cached())) return;
    const { report, steps, first } = await siblingRun();
    const renders = drawnOf(report, steps).flatMap((f) => f.rendered.filter((e) => first.reused.includes(e)).map((e) => `${frameSaid(f)} rendered ${nameOf(report, e)}`));
    console.log(`AC8 cached in the first sibling frame: ${first.reused.map((e) => nameOf(report, e)).join(', ')}`);
    expect(renders, 'the views the first sibling frame reused render 0 times over the 100 frames').toEqual([]);
  }, LONG);

  it('AC8 with accessibility active, a frame that doesn\'t redraw a cached view keeps its nodes, action listeners and focus, node for node with a frame after a refresh', async () => {
    if (!(await cached())) return;
    const { frame, drawn, refreshed, report } = await accessibilityRun();
    expect(frame.reused.length, `${frameSaid(frame)} reused cached views with accessibility active: it rendered ${frame.rendered.map((e) => nameOf(report, e)).join(', ')}`).toBeGreaterThan(0);
    expect(drawn.active && refreshed.active, 'accessibility is active').toBe(true);
    expect(refreshed.nodes.length, 'the tree after a refresh holds nodes').toBeGreaterThan(0);
    expect(refreshed.focus, 'the list\'s focus is in the tree').not.toBeNull();
    expect(treeProblems(drawn, refreshed), 'node for node, the same tree').toEqual([]);
  }, LONG);

  it('AC8 the plain case, GPUI\'s reuse copying no accessibility nodes, fails, naming the node', async () => {
    if (!(await cached())) return;
    const { frame, drawn, refreshed, report } = await accessibilityRun(DRIVE_PLANT.reuseDropsAccessibility);
    expect(frame.reused.length, `${frameSaid(frame)} reused cached views: it rendered ${frame.rendered.map((e) => nameOf(report, e)).join(', ')}`).toBeGreaterThan(0);
    const problems = treeProblems(drawn, refreshed);
    console.log(`AC8 planted: ${problems.slice(0, 2).join('; ')}`);
    expect(problems.length, 'the plain reuse loses what the cached view drew').toBeGreaterThan(0);
    expect(problems[0], 'naming the node').toMatch(/\(node [^)]+\)/);
  }, LONG);
});
