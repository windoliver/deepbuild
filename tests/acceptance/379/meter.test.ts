// #379.6d4d0202: the meter reports each pass's GPU time from pass timestamp writes, splitting a fused pass by
// declared shares; without timestamps it reports CPU encode time marked as a fallback; the proof records the
// reference Mac's timestamp features; a frame's GPU time is the time its passes cover, never the sum of their
// intervals; with two writers on the reference Mac where only one is over its share, only that one steps
// down; and the proof checks the timestamp tick against the wall time of a waited submission.
//
// Device readings need macOS's Metal device (INCONCLUSIVE elsewhere); the two-writer run counts only on a
// reference Mac (INCONCLUSIVE elsewhere). The arithmetic of covered time, charges and shares runs on a stub
// meter on wgpu's noop backend, everywhere, where `--planted sums_pass_intervals` must fail it.
import { describe, expect, it } from 'vitest';
import {
  W, answered, burn, liveCall, liveReply, num, obj, one, passProblems, requireMetal, requireReferenceMac, sceneDoc, useBuilds, useOut, writeDoc,
  changesOf, rungIndex, type Interval, type Live,
} from './helpers.ts';

const builds = useBuilds(['default', 'test-meter']);
const out = useOut();
const ID = '#379.6d4d0202';

/** The stub's three passes for one frame: a (alpha) 0–2 ms, b fused (alpha 0.75, bravo 0.25) 1–3 ms, c (bravo) 3.5–4 ms. */
const INTERVALS: Interval[] = [
  { name: 'a', session: 's-alpha', start_ms: 0, end_ms: 2 },
  { name: 'b', session: 's-alpha', start_ms: 1, end_ms: 3, shares: [{ writer: W.alpha, share: 0.75 }, { writer: W.bravo, share: 0.25 }] },
  { name: 'c', session: 's-bravo', start_ms: 3.5, end_ms: 4 },
];

function stubRun(planted?: 'sums_pass_intervals'): Live {
  const docA = writeDoc(out(), 'alpha', sceneDoc({ title: 'Alpha', class: 'work_product', size: [128, 128], moving: true }));
  const docB = writeDoc(out(), 'bravo', sceneDoc({ title: 'Bravo', class: 'work_product', size: [128, 128], moving: true }));
  const reply = one(builds.bin('test-meter'), out(), liveCall({
    frames: 10,
    sessions: [{ session: 's-alpha', writer: W.alpha, doc: docA }, { session: 's-bravo', writer: W.bravo, doc: docB }],
    report: ['passes'],
    stub_meter: { passes: [{ from: 1, to: 10, intervals: INTERVALS }] },
  }), { backend: 'noop', ...(planted ? { planted } : {}) });
  return liveReply(reply, 'the stub-interval run');
}

describe(`${ID} the meter's pass timings`, () => {
  it(`${ID} a frame's GPU time is the time its passes cover (3.5 ms), never their sum (4.5 ms); each pass is charged after earlier passes end, and a fused pass splits by its declared shares (stub meter, noop)`, () => {
    const live = stubRun();
    expect(live.frames.map((f) => f.frame), 'frames 1 to 10 are reported').toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const f of live.frames) {
      expect(f.gpu_ms, `frame ${f.frame}: the GPU time its passes cover, 3.5 ms (the sum of the intervals is 4.5 ms)`).toBeCloseTo(3.5, 6);
      const passes = f.passes ?? [];
      expect(passes.map((p) => p.name), `frame ${f.frame}: the stub's passes in order`).toEqual(['a', 'b', 'c']);
      expect(passes.map((p) => p.charged_ms), `frame ${f.frame}: a 2 ms, b 1 ms (after a ends), c 0.5 ms`).toEqual([2, 1, 0.5].map((x) => expect.closeTo(x, 6)));
      const b = passes[1]!;
      expect(b.shares, `frame ${f.frame}: the fused pass b names its shares`).not.toBeNull();
      const byWriter = Object.fromEntries((b.shares ?? []).map((s) => [s.writer, s.charged_ms]));
      expect(byWriter[W.alpha], `frame ${f.frame}: b charges alpha 0.75 of its 1 ms`).toBeCloseTo(0.75, 6);
      expect(byWriter[W.bravo], `frame ${f.frame}: b charges bravo 0.25 of its 1 ms`).toBeCloseTo(0.25, 6);
      const alpha = f.views.find((v) => v.writer === W.alpha)!;
      const bravo = f.views.find((v) => v.writer === W.bravo)!;
      expect(alpha?.charged_gpu_ms, `frame ${f.frame}: alpha is charged a's 2 ms and 0.75 of b, 2.75 ms`).toBeCloseTo(2.75, 6);
      expect(bravo?.charged_gpu_ms, `frame ${f.frame}: bravo is charged 0.25 of b and c's 0.5 ms, 0.75 ms`).toBeCloseTo(0.75, 6);
    }
    expect(passProblems(live.frames, 1e-6), 'the covered-time check holds on every frame').toEqual([]);
  }, 600_000);

  it(`${ID} a planted meter that sums pass intervals reports 4.5 ms and fails the covered-time check, naming the frame`, () => {
    const live = stubRun('sums_pass_intervals');
    const problems = passProblems(live.frames, 1e-6);
    expect(problems.length, 'the planted meter fails the covered-time check').toBeGreaterThan(0);
    expect(problems[0], 'the failure names frame 1 and the covered time').toMatch(/^frame 1: gpu_ms 4\.5 isn't the 3\.5000 ms its passes cover/);
  }, 600_000);

  it(`${ID} the proof records this Mac's timestamp features, and withholding them at device creation gives an adapter without them`, () => {
    requireMetal();
    const full = obj(answered(one(builds.bin(), out(), { call: 'adapter' }), 'adapter'), 'adapter');
    console.log(`adapter: ${JSON.stringify(full)}`);
    expect(full['backend'], 'the shipped build draws on Metal').toBe('metal');
    const ts = obj(full['timestamps'], 'adapter: timestamps');
    for (const k of ['query', 'inside_encoders', 'inside_passes']) expect(typeof ts[k], `adapter: timestamps.${k} is recorded as a boolean`).toBe('boolean');
    expect(ts['query'], 'the Mac\'s adapter writes pass timestamps').toBe(true);
    expect(num(ts['period_ns'], 'adapter: timestamps.period_ns'), 'the timestamp period is positive').toBeGreaterThan(0);
    const withheld = obj(answered(one(builds.bin(), out(), { call: 'adapter' }, { withhold: 'timestamps' }), 'adapter, timestamps withheld'), 'adapter');
    expect(obj(withheld['timestamps'], 'withheld: timestamps')['query'], 'with timestamps withheld the device has none').toBe(false);
    expect(withheld['withheld'], 'the adapter says what was withheld').toEqual(['timestamps']);
  }, 600_000);

  it(`${ID} with timestamps every pass's GPU time comes from them, and the frame's GPU time is the time its passes cover (Metal)`, () => {
    requireMetal();
    const doc = writeDoc(out(), 'alpha', sceneDoc({ title: 'Alpha', class: 'work_product', size: [256, 256], boxes: 8, moving: true }));
    const live = liveReply(one(builds.bin(), out(), liveCall({ frames: 60, sessions: [{ session: 's-alpha', writer: W.alpha, doc }], report: ['passes'] })));
    expect(live.frames.length, '60 frames').toBe(60);
    for (const f of live.frames) {
      expect(f.gpu_source, `frame ${f.frame}: the GPU time is from pass timestamps`).toBe('timestamps');
      for (const p of f.passes ?? []) {
        expect(p.source, `frame ${f.frame}: pass ${p.name} is timed by its timestamp writes`).toBe('timestamps');
        expect(p.end_ns, `frame ${f.frame}: pass ${p.name}'s interval ends after it starts`).toBeGreaterThanOrEqual(p.start_ns);
      }
    }
    // 1 µs: the binary's ms and its ns intervals, each rounded once.
    expect(passProblems(live.frames, 0.001), 'every frame\'s GPU time is the union of its passes\' intervals, and each pass is charged after earlier ones end').toEqual([]);
  }, 600_000);

  it(`${ID} on an adapter without timestamps the meter reports CPU encode time, marked as the fallback (Metal, timestamps withheld)`, () => {
    requireMetal();
    const doc = writeDoc(out(), 'alpha', sceneDoc({ title: 'Alpha', class: 'work_product', size: [256, 256], moving: true }));
    const live = liveReply(one(builds.bin(), out(), liveCall({ frames: 30, sessions: [{ session: 's-alpha', writer: W.alpha, doc }], report: ['passes'] }), { withhold: 'timestamps' }));
    expect(live.frames.length, '30 frames').toBe(30);
    for (const f of live.frames) {
      expect(f.gpu_source, `frame ${f.frame}: marked as the CPU encode fallback`).toBe('cpu_encode');
      expect(f.gpu_ms, `frame ${f.frame}: the fallback is a time`).toBeGreaterThanOrEqual(0);
      for (const p of f.passes ?? []) expect(p.source, `frame ${f.frame}: pass ${p.name} is marked as the fallback`).toBe('cpu_encode');
    }
  }, 600_000);

  it(`${ID} the timestamp tick agrees with the wall time of a waited submission (Metal)`, () => {
    requireMetal();
    const replies = Array.from({ length: 5 }, () => obj(answered(one(builds.bin(), out(), { call: 'tick', gpu_ms: 50 }), 'tick'), 'tick'));
    let close = 0;
    for (const [i, r] of replies.entries()) {
      const ticks = num(r['ticks'], `tick ${i + 1}: ticks`);
      const period = num(r['period_ns'], `tick ${i + 1}: period_ns`);
      const gpu = num(r['gpu_ns'], `tick ${i + 1}: gpu_ns`);
      const wall = num(r['wall_ns'], `tick ${i + 1}: wall_ns`);
      console.log(`tick ${i + 1}: ${ticks} ticks × ${period} ns = ${gpu} ns of GPU in ${wall} ns of wall time`);
      expect(Math.abs(gpu - ticks * period), `tick ${i + 1}: gpu_ns is the ticks times the period`).toBeLessThanOrEqual(period + 1);
      expect(wall, `tick ${i + 1}: the waited submission took at least 20 ms of wall time`).toBeGreaterThanOrEqual(20e6);
      expect(gpu, `tick ${i + 1}: the GPU time is positive`).toBeGreaterThan(0);
      expect(gpu, `tick ${i + 1}: the GPU's interval fits inside the wall time of the waited submission (plus 0.1 ms)`).toBeLessThanOrEqual(wall + 1e5);
      if (gpu >= 0.5 * wall) close++;
    }
    expect(close, 'in at least three of five submissions the timestamps cover at least half the wall time (a wrong period misses by its factor)').toBeGreaterThanOrEqual(3);
  }, 600_000);

  it(`${ID} with two writers on the reference Mac where only one is over its share, only that one steps down`, () => {
    requireReferenceMac();
    const heavy = writeDoc(out(), 'alpha', sceneDoc({ title: 'Alpha, over its share', class: 'work_product', size: [1024, 1024], moving: true, items: { load: burn('load', 20_000) } }));
    const light = writeDoc(out(), 'bravo', sceneDoc({ title: 'Bravo, under its share', class: 'work_product', size: [256, 256], boxes: 1, moving: true }));
    const live = liveReply(one(builds.bin('test-meter'), out(), liveCall({
      frames: 150,
      sessions: [{ session: 's-alpha', writer: W.alpha, doc: heavy, size: [1024, 1024] }, { session: 's-bravo', writer: W.bravo, doc: light, size: [256, 256] }],
      report: ['passes'],
    })));
    const over = live.frames.filter((f) => f.frame <= 30).map((f) => f.views.find((v) => v.writer === W.alpha)?.charged_gpu_ms ?? 0);
    expect(over.every((ms) => ms > 2), `the heavy writer's measured GPU is over its 2 ms share in frames 1–30: ${over.map((x) => x.toFixed(2)).join(', ')}`).toBe(true);
    const alphaDown = changesOf(live, 's-alpha').filter((c) => c.reason === 'frame_health');
    expect(alphaDown.length, 'the writer over its share steps down for frame health').toBeGreaterThan(0);
    expect(alphaDown[0]!.frame, 'not before 30 consecutive frames over').toBeGreaterThanOrEqual(30);
    expect(rungIndex(alphaDown[0]!.to), `its first step goes down the ladder: ${alphaDown[0]!.from} → ${alphaDown[0]!.to}`).toBeGreaterThan(rungIndex(alphaDown[0]!.from ?? 'base'));
    const bravoDown = changesOf(live, 's-bravo').filter((c) => c.from !== null && rungIndex(c.to) > rungIndex(c.from));
    expect(bravoDown.map((c) => `frame ${c.frame}: ${c.from} → ${c.to} (${c.reason})`), 'the writer under its share never steps down').toEqual([]);
    for (const f of live.frames) expect(f.gpu_source, `frame ${f.frame}: timed by pass timestamps`).toBe('timestamps');
    expect(passProblems(live.frames, 0.001), 'each frame\'s GPU time is the time its passes cover').toEqual([]);
  }, 1_200_000);
});
