// #483.a5f56c33: "Budgets, on the reference Mac in the local preflight, compared with the merge base: sort_by_key of
// 1,048,576 keys takes under 2 ms of GPU time; scan and compact of 1,048,576 elements under 0.5 ms each; iterate adds
// under 0.02 ms per run beyond its body at 1080p; and a still canvas dispatches none of them"
//
// Timings run only on a reference Mac (Mac15,7 or Mac15,12; power and Low Power Mode not gated, by the owner's rule)
// through the design's judge: six check_operator frames, the first a warm-up, each dispatched 300 times
// (`repeat: 300`), each operator's GPU time per dispatch from `timing.gpu_ns` (README); PASS when all five runs are
// within the limit, FAIL when all five are over it by the margin on a machine whose one-minute load is at most 1 a
// core, otherwise INCONCLUSIVE. A sort, scan or compact run's value is the p95 of its 300 dispatches. Iterate's cost
// per run beyond its body: `iter`, a pass iterating a one-load body 16 times at 1,920 × 1,080, and `body`, the same
// body as a pass of its own, in one frame; a run's value is (median(iter) − 16 × median(body)) ÷ 16, medians since
// the difference of two timings at p95 would measure their noise. The still canvas reads no clock: a still figure
// with a generator, sort_by_key, scan, compact and an iterated pass, each declaring the check's estimate, is live for
// 60 frames, its operators run while it first draws, and from frame 4 on no pass names one. The merge-base comparison
// is the perf lane's: benchmarks/budgets.json holds a task for this issue, which the budget window runs beside the
// merge base. At the base none of these steps exist and check_operator has no repeat or gpu_ns.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FRAME_COLOR, REPO, WRITER, asItem, compute, coreStorage, figure, frameCall, judge, jumpFlood, liveCall, liveReply, median, p95, pass, payload, ran,
  requireGpu, requireReferenceMac, rng, run, run1, sessionRow, step, useBins, useOut, withEstimates, writeJson, writeU32, type JsonObject,
} from './helpers.ts';

const bins = useBins();
const out = useOut();
const N = 1_048_576;
const REPEAT = 300;

const words = (n: number, seed: number): Uint32Array => { const r = rng(seed); return Uint32Array.from({ length: n }, () => r()); };
const iota = (n: number): Uint32Array => Uint32Array.from({ length: n }, (_, i) => i);
const sortOp = (count: number, from = 'core') => compute('srt', { s: step('sort_by_key@1', { keys: 'keys', values: 'vals', count }) }, { sorted: { storage: { type: 'u32', count }, from: 's' } },
  { inputs: from === 'core' ? { keys: coreStorage('u32', count, 'keys'), vals: coreStorage('u32', count, 'vals') } : { keys: { type: 'u32', count, from: { storage: { op: from, output: 'keys' } } }, vals: { type: 'u32', count, from: { storage: { op: from, output: 'vals' } } } } }, count);
const scanOp = (count: number, xs: JsonObject = coreStorage('u32', count, 'xs')) => compute('scn', { sc: { op: 'scan@1', args: { in: 'xs', op: 'add' } } },
  { out: { storage: { type: 'u32', count }, from: 'sc' } }, { inputs: { xs } }, count);
const compactOp = (count: number, vals: JsonObject = coreStorage('u32', count, 'vals'), flags: JsonObject = coreStorage('bool', count, 'flags')) =>
  compute('cmp', { c: { op: 'compact@1', args: { in: 'vals', flag: 'flags', count } } },
    { kept: { storage: { type: 'u32', count }, from: 'c.out' }, n: { storage: { type: 'u32', count: 1 }, from: 'c.count' } }, { inputs: { vals, flags } }, count);

/** Six frames of `operators` dispatched REPEAT times each, the first a warm-up: each later frame's GPU times per operator, in ms. */
function timed(spec: { operators: JsonObject[]; data?: Record<string, string>; size?: [number, number] }): Map<string, number[]>[] {
  const dir = out();
  const replies = run(bins.bin(), dir, Array.from({ length: 6 }, () => frameCall({ ...spec, repeat: REPEAT })));
  return replies.slice(1).map((r, k) => {
    const g = ran(r, `timed run ${k + 1}`).gpuNs;
    for (const op of spec.operators) expect(g.get(String(op['id']))?.length, `run ${k + 1}: ${String(op['id'])}'s GPU time for each of ${REPEAT} dispatches`).toBe(REPEAT);
    return new Map([...g].map(([k2, v]) => [k2, v.map((ns) => ns / 1e6)]));
  });
}

describe(`${AC[9]} the structural steps' budgets`, () => {
  it(`${AC[9]} sort_by_key of 1,048,576 keys takes under 2 ms of GPU time (five runs after warm-up)`, () => {
    requireReferenceMac();
    const dir = out();
    const runs = timed({ operators: [sortOp(N)], data: { keys: writeU32(dir, 'keys', words(N, 4837)), vals: writeU32(dir, 'vals', iota(N)) } });
    judge('sort_by_key of 1,048,576 keys, GPU ms (p95 of 300)', runs.map((m) => p95(m.get('srt')!)), 2);
  }, 3_600_000);

  it(`${AC[9]} scan and compact of 1,048,576 elements take under 0.5 ms of GPU time each (five runs after warm-up)`, () => {
    requireReferenceMac();
    const dir = out();
    const r = rng(4838);
    const flags = Uint32Array.from({ length: N }, () => (r() % 10 < 3 ? 1 : 0));
    const runs = timed({ operators: [scanOp(N), compactOp(N)], data: { xs: writeU32(dir, 'xs', words(N, 4839)), vals: writeU32(dir, 'vals', iota(N)), flags: writeU32(dir, 'flags', flags) } });
    judge('scan of 1,048,576, GPU ms (p95 of 300)', runs.map((m) => p95(m.get('scn')!)), 0.5);
    judge('compact of 1,048,576, GPU ms (p95 of 300)', runs.map((m) => p95(m.get('cmp')!)), 0.5);
  }, 3_600_000);

  it(`${AC[9]} iterate adds under 0.02 ms per run beyond its body at 1080p (five runs after warm-up)`, () => {
    requireReferenceMac();
    const b = { g_px: step('pixel@1'), g_p: step('load@1', { tex: 'prev', ixy: 'g_px' }), g_res: step('mul@1', { a: 'g_p', b: 0.5 }) };
    const iter = pass('iter', {
      px: step('pixel@1'), it: { op: 'iterate@1', args: { count: 16, index: 'k', ping_pong: { format: 'rgba16float', resolution: 'full' }, body: { steps: b, outputs: { color: 'g_res' } } } },
      out: step('load@1', { tex: 'it', ixy: 'px' }),
    });
    const body = pass('body', { g_px: step('pixel@1'), g_p: step('load@1', { tex: 'prev', ixy: 'g_px' }), out: step('mul@1', { a: 'g_p', b: 0.5 }) }, { order: 'a1', inputs: { prev: FRAME_COLOR } });
    const runs = timed({ operators: [iter, body], size: [1920, 1080] });
    judge('iterate\'s cost per run beyond its body at 1,920 × 1,080, GPU ms', runs.map((m) => (median(m.get('iter')!) - 16 * median(m.get('body')!)) / 16), 0.02);
  }, 3_600_000);

  it(`${AC[9]} a still canvas dispatches none of them once it has drawn`, () => {
    requireGpu();
    const n = 65_536;
    const gen = compute('gen', {
      e: step('element@1'), h: step('hash@1', { a: 'e' }), k: step('and@1', { a: 'h', b: 4095 }), hs: step('shr@1', { a: 'h', b: 12 }), h7: step('and@1', { a: 'hs', b: 7 }),
      f: step('lt@1', { a: 'h7', b: 2 }), wk: step('write@1', { buf: 'keys', i: 'e', v: 'k' }), wv: step('write@1', { buf: 'vals', i: 'e', v: 'e' }), wf: step('write@1', { buf: 'flags', i: 'e', v: 'f' }),
    }, { keys: { storage: { type: 'u32', count: n } }, vals: { storage: { type: 'u32', count: n } }, flags: { storage: { type: 'bool', count: n } } }, {}, n);
    const fromGen = (type: string, output: string): JsonObject => ({ type, count: n, from: { storage: { op: 'gen', output } } });
    const ops = withEstimates(bins.bin(), out(), [
      gen, sortOp(n, 'gen'), scanOp(n, fromGen('u32', 'keys')), compactOp(n, fromGen('u32', 'vals'), fromGen('bool', 'flags')),
      jumpFlood('flood', { count: 4, start: 8, max: 63, extra: { resolution: 'half' } }),
    ]);
    const doc = writeJson(out(), 'still.json', payload(figure('still-483', Object.fromEntries(ops.map((o) => [String(o['id']), asItem(o)])))));
    const live = liveReply(run1(bins.bin(), out(), liveCall({ frames: 60, report: ['passes'], sessions: [{ session: 's', writer: WRITER, doc, size: [128, 64] }] })));
    expect(sessionRow(live, 's')['state'], 'the still figure is live').toBe('live');
    const first = new Set(live.frames.filter((f) => f.frame <= 3).flatMap((f) => f.passes.map((p) => p.operator).filter((o): o is string => o !== null)));
    expect([...first].sort(), 'its operators ran while it first drew').toEqual(['cmp', 'flood', 'gen', 'scn', 'srt']);
    const later = live.frames.filter((f) => f.frame > 3).flatMap((f) => f.passes.filter((p) => p.operator !== null).map((p) => `frame ${f.frame}: ${p.operator!}`));
    expect(later, 'from frame 4 on, the still canvas dispatches none of them').toEqual([]);
  }, 1_800_000);

  it(`${AC[9]} the perf lane compares this issue's budgets with the merge base`, () => {
    const budgets = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: { id: string; initialReason?: string }[] };
    expect(budgets.tasks.filter((t) => /#483\b/.test(t.initialReason ?? '')).length, 'benchmarks/budgets.json has a task for #483').toBeGreaterThan(0);
  });
});
