// #429.04be27ea: budgets, on the reference Mac in the local preflight, compared with the merge base: a composed
// operator checks and compiles in under 20 ms off the UI thread, its GPU time stays within its class (the data-view
// class up to 4 ms for a showpiece), and a composed operator in a core view is refused, and a still canvas
// dispatches no operator.
//
// Timings run only on a reference Mac (Mac15,7 or Mac15,12) and go through the design's judge: five runs after a
// warm-up, PASS when all five are within the limit, FAIL when all are over it by the margin on an unloaded machine,
// otherwise INCONCLUSIVE (a failure saying so, never a pass). Check and compile time is `check_operator`'s
// `timing` (README); a composed tint changes one literal per run, so each run compiles a new key. GPU time is the
// tint's pass in #379's `live` report of passes (each pass now names its `operator`), the p95 over 320 frames of a
// moving figure: the data-view class's 0.5 ms at half resolution in a 1,280 × 720 view, and the showpiece's 4 ms at
// full resolution, full screen on this Mac's display. The core view's refusal and the still canvas read no clock.
// The merge-base comparison is the perf lane's: benchmarks/budgets.json holds a task for this issue, which the
// budget window runs beside the merge base. At the base no item can be a GPU operator and check_operator has no
// timing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPO, WRITER, asItem, checkCall, compute, figure, judge, liveCall, liveReply, num, obj, p95, payload, requireGpu, requireReferenceMac, run1,
  sessionRow, shown, str, tint, useBins, useOut, writeJson, type JsonObject,
} from './helpers.ts';

const bins = useBins();
const out = useOut();
const DISPLAYS: Record<string, [number, number]> = { 'Mac15,7': [3456, 2234], 'Mac15,12': [2560, 1664] };
const red = (k: number): JsonObject => tint('tint', { steps: { ...(tint()['steps'] as JsonObject), red: { op: 'const@1', args: { value: [0.6 + k / 1000, 0, 0, 0], type: 'vec4' } } } });

describe('#429.04be27ea a composed operator\'s budgets', () => {
  it('#429.04be27ea a composed operator checks and compiles in under 20 ms, off the UI thread (five runs after warm-up)', () => {
    requireReferenceMac();
    const runs: number[] = [];
    for (let k = 0; k < 6; k++) {
      const r = run1(bins.bin(), out(), checkCall(red(k)));
      expect(r['outcome'], `run ${k}: the tint checks: ${shown(r)}`).toBe('accepted');
      const t = obj(r['timing'], `run ${k}: timing`);
      expect(str(t['thread'], 'timing.thread'), `run ${k}: compiled off the UI thread`).not.toBe(str(t['ui_thread'], 'timing.ui_thread'));
      if (k) runs.push(num(t['check_ms'], 'check_ms') + num(t['compile_ms'], 'compile_ms'));
    }
    judge('check and compile, ms', runs, 20);
  }, 1_800_000);

  for (const c of [{ cls: 'data_view', limit: 0.5, resolution: 'half' }, { cls: 'showpiece', limit: 4, resolution: 'full' }]) {
    it(`#429.04be27ea a composed pass's GPU time stays within the ${c.cls} class's ${c.limit} ms (p95 over 320 frames, five runs after warm-up)`, () => {
      const model = requireReferenceMac();
      const size = c.cls === 'showpiece' ? DISPLAYS[model]! : [1280, 720] as [number, number];
      const doc = writeJson(out(), 'doc.json', payload(figure('budget-429', { tint: asItem(tint('tint', { resolution: c.resolution })) }, { moving: true, cls: c.cls, size })));
      const runs: number[] = [];
      for (let k = 0; k < 6; k++) {
        const live = liveReply(run1(bins.bin(), out(), liveCall({ frames: 320, report: ['passes'], sessions: [{ session: 's', writer: WRITER, doc, size }] })));
        expect(sessionRow(live, 's')['state'], `run ${k}: the ${c.cls} with a composed pass is live`).toBe('live');
        const ms = live.frames.slice(20).map((f) => {
          const p = f.passes.filter((x) => x.operator === 'tint');
          expect(p.length, `run ${k}, frame ${f.frame}: the tint's pass is timed`).toBeGreaterThan(0);
          return p.reduce((s, x) => s + (x.end_ns - x.start_ns) / 1e6, 0);
        });
        if (k) runs.push(p95(ms));
      }
      judge(`${c.cls} composed pass GPU p95, ms`, runs, c.limit);
    }, 3_600_000);
  }

  it('#429.04be27ea a composed operator in a core view is refused, naming it', () => {
    requireGpu();
    const doc = writeJson(out(), 'core.json', payload(figure('core-429', { tint: asItem(tint()) }, { cls: 'core_view' })));
    const live = liveReply(run1(bins.bin(), out(), liveCall({ frames: 2, sessions: [{ session: 's', writer: WRITER, doc, size: [128, 64] }] })));
    const row = sessionRow(live, 's');
    expect(row['state'], `the core view with a composed operator is refused: ${shown(row)}`).toBe('refused');
    expect(JSON.stringify(row['issues']), 'its issue names the operator tint').toMatch(/tint/);
  }, 1_800_000);

  it('#429.04be27ea a still canvas dispatches no operator once it has drawn', () => {
    requireGpu();
    const field = compute('field', { e: { op: 'element@1', args: {} }, w: { op: 'write@1', args: { buf: 'out', i: 'e', v: 'e' } } });
    const doc = writeJson(out(), 'still.json', payload(figure('still-429', { field: asItem(field), tint: asItem(tint()) })));
    const live = liveReply(run1(bins.bin(), out(), liveCall({ frames: 60, report: ['passes'], sessions: [{ session: 's', writer: WRITER, doc, size: [128, 64] }] })));
    expect(sessionRow(live, 's')['state'], 'the still figure is live').toBe('live');
    expect(live.frames.slice(0, 3).some((f) => f.passes.some((p) => p.operator !== null)), 'its operators ran while it first drew').toBe(true);
    const later = live.frames.filter((f) => f.frame > 3).flatMap((f) => f.passes.filter((p) => p.operator !== null).map((p) => `frame ${f.frame}: ${p.operator}`));
    expect(later, 'from frame 4 on, the still canvas dispatches no operator').toEqual([]);
  }, 1_800_000);

  it('#429.04be27ea the perf lane compares this issue\'s operator budgets with the merge base', () => {
    const budgets = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: { id: string; initialReason?: string }[] };
    expect(budgets.tasks.filter((t) => /#429\b/.test(t.initialReason ?? '')).map((t) => t.id).length, 'benchmarks/budgets.json has a task for #429').toBeGreaterThan(0);
  });
});
