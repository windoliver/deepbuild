// AC2, AC3, AC4, AC5 and AC6 (README: The hover journey, The judges). A pointer moves onto 200 rows of the 1,000-row list
// at 1936 × 1584 in the replica that draws only the frames GPUI says the window needs (#1546), every frame read back in
// 64 × 32 tiles in the harness. One judge, `judgeHover`, reads the close report of the shipped app and of every wrong
// program: every frame names its notify or refresh and the views it rendered, no view outside the list is notified,
// and at most 1% of frames change no tile. Every count, name and tile is the replica's own, from `close`'s frames.
// Counts, not clocks: these run in the debug build on any Mac, and load can't change them.
import { afterAll, describe, expect, it } from 'vitest';
import {
  DRIVE_PLANT, HOVERS, HUB_PLANT, LIST_VIEW, TILES, cleanup, countsOnly, debugDrive, drawnOf, framesOf, hoverRun, judgeHover, nameOf,
  requireMacos, rootNamedProblems, type Report,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const LONG = 3_600_000;

type Run = { report: Report; steps: number[] };
const runs = new Map<string, Promise<Run>>();
/** A hover journey, run once for the file per program: the shipped app, or the one wrong program named. */
function run(o: { plant?: string; hub?: string; readBack?: 'off' } = {}): Promise<Run> {
  const key = JSON.stringify(o);
  if (!runs.has(key)) {
    runs.set(key, (async () => {
      requireMacos();
      return hoverRun({ bin: debugDrive(), plant: o.plant, hub: o.hub, launch: o.readBack ? { read_back: o.readBack } : {} });
    })());
  }
  return runs.get(key)!;
}
const rootName = (r: Report): string => nameOf(r, r.root);

describe('#1482 the hover journey over the 1,000-row list, judged from its own report', () => {
  it('AC2 AC3 AC5 AC6 the shipped app reads PASS: each move draws, every frame names its notify and its views, no view outside the list is notified, and at most 1% of frames change no tile', async () => {
    const { report, steps } = await run();
    expect(steps.length, 'the journey hovers 200 rows').toBe(HOVERS);
    for (const step of steps) {
      expect(drawnOf(report, [step]).length, `step ${step} moved the pointer onto another row, whose hover the window draws by itself`).toBeGreaterThanOrEqual(1);
    }
    const drawn = drawnOf(report, steps);
    for (const f of drawn) {
      expect(f.tiles?.total, `frame ${f.frame} is read back in 64 × 32 tiles of the 1936 × 1584 window: ${TILES}`).toBe(TILES);
      expect(f.refreshed || f.notified.some((e) => report.entities[e]?.view), `frame ${f.frame} names the view whose notify drew it: ${JSON.stringify(f.notified.map((e) => nameOf(report, e)))}`).toBe(true);
    }
    const zero = drawn.filter((f) => f.tiles!.changed === 0).length;
    const share = drawn.reduce((s, f) => s + f.tiles!.changed, 0) / drawn.reduce((s, f) => s + f.tiles!.total, 0);
    const every = report.list.filter((f) => f.drawn);
    expect(report.zero_tile_frames, 'the report gives the frames that changed no tile').toBe(every.filter((f) => f.tiles?.changed === 0).length);
    const area = every.reduce((s, f) => s + f.tiles!.changed, 0) / every.reduce((s, f) => s + f.tiles!.total, 0);
    expect(Math.abs((report.changed_area ?? NaN) - area), `and the changed area over the window area, ${area}: ${String(report.changed_area)}`).toBeLessThan(1e-9);
    console.log(`AC3 the shipped hover: ${drawn.length} frames drawn, ${zero} changed no tile, changed area ${(share * 100).toFixed(2)}% of the window`);
    const v = judgeHover(report, steps);
    expect({ findings: v.findings.slice(0, 5), unjudged: v.unjudged.slice(0, 5) }, 'nothing found and nothing left unjudged').toEqual({ findings: [], unjudged: [] });
    expect(v.claim).toBe('PASS');
  }, LONG);

  it('AC2 a planted notify at the window root, on each row the pointer enters or leaves, fails, naming the root view', async () => {
    const { report, steps } = await run({ hub: HUB_PLANT.hoverNotifiesRoot });
    const v = judgeHover(report, steps);
    console.log(`AC2 planted: ${v.claim}: ${v.findings.slice(0, 2).join('; ')}`);
    expect(framesOf(report, steps).some((f) => f.notified.includes(report.root)), 'the report names the root among the notified entities').toBe(true);
    expect(rootNamedProblems(v, rootName(report)), 'the judge fails the run, naming the window\'s root view').toEqual([]);
  }, LONG);

  it('AC3 a planted animation of an unchanged value fails, naming the view', async () => {
    const { report, steps } = await run({ hub: HUB_PLANT.animatesUnchanged });
    const v = judgeHover(report, steps);
    console.log(`AC3 planted: ${v.claim}: ${v.findings.slice(0, 2).join('; ')}`);
    expect(v.claim, 'frames that changed no tile, over 1%').toBe('FAIL');
    const finding = v.findings.find((f) => f.includes('changed no tile'));
    expect(finding, `a finding counts the frames that changed no tile: ${v.findings.slice(0, 3).join('; ')}`).toBeTruthy();
    expect(finding, 'and names the animating view, the list\'s').toContain(LIST_VIEW);
  }, LONG);

  it('AC4 a run with the read-back off reads INCONCLUSIVE, never PASS', async () => {
    const { report, steps } = await run({ readBack: 'off' });
    expect(report.read_back, 'the report says the read-back was off').toBe('off');
    expect(drawnOf(report, steps).filter((f) => f.tiles !== null).map((f) => f.frame), 'no frame has tiles it never read back').toEqual([]);
    expect({ zero: report.zero_tile_frames, area: report.changed_area }, 'nothing counted as unchanged or changed').toEqual({ zero: null, area: null });
    const v = judgeHover(report, steps);
    console.log(`AC4 read-back off: ${v.claim}: ${v.unjudged.slice(0, 2).join('; ')}`);
    expect(v.claim, `never PASS: ${v.findings.join('; ')}`).not.toBe('PASS');
    expect(v.unjudged.join(' '), 'INCONCLUSIVE on the read-back, saying so').toContain('read-back is off');
  }, LONG);

  it('AC4 a run whose read-back fails reads INCONCLUSIVE, never PASS', async () => {
    const { report, steps } = await run({ plant: DRIVE_PLANT.readBackFails });
    expect(report.read_back, 'the report says the read-back failed').toBe('failed');
    expect(drawnOf(report, steps).filter((f) => f.tiles !== null).map((f) => f.frame), 'no frame has tiles from a read-back that failed').toEqual([]);
    expect({ zero: report.zero_tile_frames, area: report.changed_area }, 'nothing counted as unchanged or changed').toEqual({ zero: null, area: null });
    const v = judgeHover(report, steps);
    console.log(`AC4 read-back failing: ${v.claim}: ${v.unjudged.slice(0, 2).join('; ')}`);
    expect(v.claim, `never PASS: ${v.findings.join('; ')}`).not.toBe('PASS');
    expect(v.unjudged.join(' '), 'INCONCLUSIVE on the read-back, saying so').toContain('read-back is failed');
  }, LONG);

  it('AC5 a planted extra notify on the window root per pointer move fails, naming the notified entity\'s view', async () => {
    const { report, steps } = await run({ plant: DRIVE_PLANT.notifiesRootPerMove });
    const v = judgeHover(report, steps);
    console.log(`AC5 planted: ${v.claim}: ${v.findings.slice(0, 2).join('; ')}`);
    expect(steps.filter((s) => !framesOf(report, [s]).some((f) => f.notified.includes(report.root))), 'every pointer move notified the root').toEqual([]);
    expect(rootNamedProblems(v, rootName(report)), 'the judge fails the run, naming the root view it notified').toEqual([]);
  }, LONG);

  it('AC5 a reader that only counts repainted views passes that plant, and fails AC5\'s test', async () => {
    const planted = await run({ plant: DRIVE_PLANT.notifiesRootPerMove });
    const clean = await run();
    const wrong = countsOnly(planted.report, planted.steps, clean.report, clean.steps);
    console.log(`AC5 the counting reader on the planted run: ${wrong.claim} ${wrong.findings.slice(0, 2).join('; ')}`);
    expect(wrong.claim, 'counting repainted views, the planted run looks like the clean one').toBe('PASS');
    expect(rootNamedProblems(wrong, rootName(planted.report)).length, 'so the counting reader fails what AC5 asks of a reader').toBeGreaterThan(0);
  }, LONG);

  it('AC6 a frame with neither a notify nor a refresh named reads INCONCLUSIVE, never PASS', async () => {
    const { report, steps } = await run({ plant: DRIVE_PLANT.dropsNotifyRecord });
    const drawn = drawnOf(report, steps);
    expect(drawn.length, 'the planted run still draws its hover frames').toBeGreaterThan(0);
    expect(drawn.filter((f) => f.notified.length).map((f) => f.frame), 'the planted report names no notify').toEqual([]);
    const v = judgeHover(report, steps);
    console.log(`AC6 planted: ${v.claim}: ${v.unjudged.slice(0, 2).join('; ')}`);
    expect(v.claim, `never PASS: ${v.findings.slice(0, 2).join('; ')}`).not.toBe('PASS');
    expect(v.unjudged.join(' '), 'INCONCLUSIVE on a frame that names neither, saying so').toContain('naming neither a notify nor a refresh');
  }, LONG);
});
