// #429.3d6a3f13: an operator measured at over twice its declared cost steps its own writer's layer down (half,
// quarter, off) and tells that writer; other writers keep running.
//
// #379's `live` call on the `test-meter` build, whose stub meter's `operators: {operator: factor}` measures that
// operator at `factor` times its declared cost (#379's README), keyed here by the operator's item ID. Two writers'
// moving figures: alpha's has the pass `tint`, measured at 2.5 times its declaration; bravo's the pass `glaze`,
// measured as it runs. Over 240 frames alpha's tint must step half, then quarter, then off, each told to alpha
// (a `told` entry with scope `operator`), its resolution never climbing; bravo's glaze stays at full resolution,
// drawn every frame, and bravo is told no operator step. At the base the live call draws no operator item.
import { describe, expect, it } from 'vitest';
import { BRAVO, WRITER, asItem, figure, liveCall, liveReply, payload, requireGpu, run1, shown, tint, useBins, useOut, writeJson } from './helpers.ts';

const bins = useBins(['test-meter']);
const out = useOut();
const SIZE: [number, number] = [128, 64];
const FRAMES = 240;

describe('#429.3d6a3f13 an operator over twice its declared cost steps its own writer down and tells it', () => {
  it('#429.3d6a3f13 alpha\'s tint at 2.5× steps half, quarter, off, each told to alpha; bravo\'s glaze keeps running at full resolution', () => {
    requireGpu();
    const alpha = writeJson(out(), 'alpha.json', payload(figure('alpha-429', { tint: asItem(tint('tint')) }, { moving: true })));
    const bravo = writeJson(out(), 'bravo.json', payload(figure('bravo-429', { glaze: asItem(tint('glaze')) }, { moving: true })));
    const live = liveReply(run1(bins.bin('test-meter'), out(), liveCall({
      frames: FRAMES,
      sessions: [{ session: 's-alpha', writer: WRITER, doc: alpha, size: SIZE }, { session: 's-bravo', writer: BRAVO, doc: bravo, size: SIZE }],
      stub_meter: { operators: { tint: 2.5 } },
    })));
    const toldOps = (writer: string) => live.told.filter((t) => t['writer'] === writer && t['scope'] === 'operator');
    expect(toldOps(WRITER).map((t) => [t['operator'], t['rung']]), `alpha is told each step of tint, in order: ${shown(live.told)}`).toEqual([['tint', 'half'], ['tint', 'quarter'], ['tint', 'off']]);
    expect(toldOps(BRAVO), 'bravo is told no operator step').toEqual([]);
    const res = (session: string, op: string) => live.frames.map((f) => {
      const row = f.views.find((v) => v.session === session)?.operators.find((o) => o.operator === op);
      expect(row, `frame ${f.frame}: ${session}'s view lists its operator ${op}`).toBeDefined();
      return row!;
    });
    const tintRows = res('s-alpha', 'tint');
    expect(tintRows[0]!.resolution, 'tint starts at full resolution').toBe(1);
    const steps = [...new Set(tintRows.map((r) => r.resolution))];
    expect(steps, 'tint draws at full, half, quarter, then not at all, never climbing back').toEqual([1, 0.5, 0.25, 0]);
    tintRows.forEach((r, i) => { if (i) expect(r.resolution, `frame ${i + 1}: tint's resolution never climbs`).toBeLessThanOrEqual(tintRows[i - 1]!.resolution); });
    expect(tintRows.at(-1)!.drew, 'switched off, tint no longer draws as an operator').not.toBe('operator');
    const glaze = res('s-bravo', 'glaze');
    expect(glaze.filter((r) => r.resolution !== 1 || r.drew !== 'operator').length, 'bravo\'s glaze draws at full resolution every frame').toBe(0);
    expect(live.frames.filter((f) => !f.views.find((v) => v.session === 's-bravo')?.drawn).map((f) => f.frame), 'bravo\'s moving view draws every frame').toEqual([]);
  }, 1_800_000);
});
