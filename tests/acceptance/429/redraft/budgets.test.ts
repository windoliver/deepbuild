// #429.04be27ea, blind redraft of the two GPU-time tests in ../budgets.test.ts (README in this folder): a composed
// operator's GPU time stays within its class (the data-view class's 0.5 ms; the showpiece's 4 ms at full screen).
//
// As the original: on a reference Mac (Mac15,7 or Mac15,12), through the design's judge (five runs after a warm-up),
// GPU time is the tint's pass in #379's `live` report of passes, the p95 over 320 frames at 60 fps from frame 21 on,
// the tint named in every timed frame: the data-view class at half resolution in a 1,280 × 720 view, the showpiece at
// full resolution, full screen on this Mac's display.
//
// What changed: the figure moves through every one of the 320 frames. The suite's `figure(..., { moving: true })`
// slides box 0 from 0 at 0 s to 1 at 4 s over a 4 s span, so from frame 242 (t = 241/60 s) nothing changes and the
// canvas is still, where the same criterion requires that no operator dispatches. Here the same slide carries on at
// its own rate to 1.5 at 6 s over a 6 s span, past the last frame's t = 319/60 s ≈ 5.32 s.
import { describe, it, expect } from 'vitest';
import {
  WRITER, asItem, figure, judge, liveCall, liveReply, obj, p95, payload, requireReferenceMac, run1, sessionRow, tint,
  useBins, useOut, writeJson, type JsonObject,
} from '../helpers.ts';

const bins = useBins();
const out = useOut();
const DISPLAYS: Record<string, [number, number]> = { 'Mac15,7': [3456, 2234], 'Mac15,12': [2560, 1664] };
const FRAMES = 320;
const FPS = 60;
const SPAN_S = 6;

/** The suite's moving figure with its slide carried on, same rate, to `SPAN_S`, so all `FRAMES` frames move. */
function movingThroughout(doc: JsonObject): JsonObject {
  expect((FRAMES - 1) / FPS, 'the last frame falls inside the slide').toBeLessThan(SPAN_S);
  doc['transport'] = { ...obj(doc['transport'], 'the figure\'s transport'), span: `${SPAN_S}s` };
  const slide = obj(obj(doc['channels'], 'the moving figure\'s channels')['slide'], 'the moving figure\'s slide');
  slide['keys'] = { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: `${SPAN_S}s`, value: SPAN_S / 4, interp: 'linear' } };
  return doc;
}

describe('#429.04be27ea a composed operator\'s GPU time (redraft)', () => {
  for (const c of [{ cls: 'data_view', limit: 0.5, resolution: 'half' }, { cls: 'showpiece', limit: 4, resolution: 'full' }]) {
    it(`#429.04be27ea a composed pass's GPU time stays within the ${c.cls} class's ${c.limit} ms while the figure moves (p95 over ${FRAMES} frames, five runs after warm-up)`, () => {
      const model = requireReferenceMac();
      const size = c.cls === 'showpiece' ? DISPLAYS[model]! : [1280, 720] as [number, number];
      const fig = movingThroughout(figure('budget-429', { tint: asItem(tint('tint', { resolution: c.resolution })) }, { moving: true, cls: c.cls, size }));
      const doc = writeJson(out(), 'doc.json', payload(fig));
      const runs: number[] = [];
      for (let k = 0; k < 6; k++) {
        const live = liveReply(run1(bins.bin(), out(), liveCall({ frames: FRAMES, fps: FPS, report: ['passes'], sessions: [{ session: 's', writer: WRITER, doc, size }] })));
        expect(sessionRow(live, 's')['state'], `run ${k}: the ${c.cls} with a composed pass is live`).toBe('live');
        const ms = live.frames.slice(20).map((f) => {
          const p = f.passes.filter((x) => x.operator === 'tint');
          expect(p.length, `run ${k}, frame ${f.frame}: the tint's pass is timed while the figure moves`).toBeGreaterThan(0);
          return p.reduce((s, x) => s + (x.end_ns - x.start_ns) / 1e6, 0);
        });
        if (k) runs.push(p95(ms));
      }
      judge(`${c.cls} composed pass GPU p95, ms`, runs, c.limit);
    }, 3_600_000);
  }
});
