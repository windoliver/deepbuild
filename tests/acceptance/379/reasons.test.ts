// #379.2299cd3b: each ladder change records its reason (initial, headroom, frame health, battery or you) and
// the meter shows it; a change compiles the new rung's pipelines off-screen first, so no frame during the
// switch exceeds its class's frame time; with a stub battery discharging at 25%, the live view steps down
// one rung and stops climbing.
//
// The reasons and the battery run on the stub meter and the stub battery (`test-meter` build) on wgpu's noop
// backend and the virtual clock, everywhere, with the schedule criterion #379.1fbf8952 fixes: 30 frames over
// steps down, a view change then 120 frames under climbs one rung. The off-screen compile runs on Metal (the
// shipped build): your change to internal_scale_down, whose upscale and sharpen are new pipelines; its frame
// times are judged on a reference Mac over five runs, and `--planted compiles_at_swap` must fail the
// compile check, naming the frame.
import { describe, expect, it } from 'vitest';
import {
  CLASS_LIMITS, REASONS, W, changesOf, judge, ladderProblems, liveCall, liveReply, one, requireMetal, rungIndex, rungProblems, sceneDoc, useBuilds, useOut,
  writeDoc, type BatteryReading, type Change, type Expected, type Live, type LiveEvent,
} from './helpers.ts';

const builds = useBuilds(['default', 'test-meter']);
const out = useOut();
const ID = '#379.2299cd3b';

/** Alpha 3 ms of GPU a frame for frames 1–45, then 1 ms; bravo 1 ms throughout (work product: 2 ms). */
const STUB = { writers: { [W.alpha]: [{ from: 1, to: 45, gpu_ms: 3 }, { from: 46, gpu_ms: 1 }], [W.bravo]: [{ from: 1, gpu_ms: 1 }] } };

function stubbed(frames: number, events: LiveEvent[], battery: BatteryReading[] | undefined, withBravo: boolean): Live {
  const a = writeDoc(out(), 'alpha', sceneDoc({ title: 'Alpha', class: 'work_product', size: [128, 128], moving: true }));
  const b = writeDoc(out(), 'bravo', sceneDoc({ title: 'Bravo', class: 'work_product', size: [128, 128], moving: true }));
  return liveReply(one(builds.bin('test-meter'), out(), liveCall({
    frames,
    sessions: [{ session: 's-alpha', writer: W.alpha, doc: a }, ...(withBravo ? [{ session: 's-bravo', writer: W.bravo, doc: b }] : [])],
    events, report: ['meter'], stub_meter: STUB, ...(battery ? { stub_battery: battery } : {}),
  }), { backend: 'noop' }));
}

const initial: Expected = { frame: 1, from: null, to: 'base', reason: 'initial' };

describe(`${ID} every ladder change records its reason, and the meter shows it`, () => {
  it(`${ID} initial, frame health, you, headroom and battery: each change records why, and the meter's rows show each writer's rung and reason`, () => {
    const live = stubbed(500, [
      { frame: 100, rung: { session: 's-bravo', to: 'lod_down' } },
      { frame: 300, camera: { session: 's-alpha', azimuth: 20 } },
    ], [{ frame: 1, percent: 80, state: 'discharging' }, { frame: 460, percent: 25, state: 'discharging' }], true);
    for (const c of live.changes) expect(REASONS, `frame ${c.frame}: ${c.session}'s change records a known reason`).toContain(c.reason);
    expect(ladderProblems(live, {
      's-alpha': [initial, { frame: 30, from: 'base', to: 'effects_off', reason: 'frame_health' }, { frame: 420, from: 'effects_off', to: 'base', reason: 'headroom' }, { frame: 460, from: 'base', to: 'effects_off', reason: 'battery' }],
      's-bravo': [initial, { frame: 100, from: 'base', to: 'lod_down', reason: 'you' }, { frame: 460, from: 'lod_down', to: 'internal_scale_down', reason: 'battery' }],
    }), 'each writer\'s changes, with their reasons').toEqual([]);
    expect(new Set(live.changes.map((c) => c.reason)), 'all five reasons were recorded').toEqual(new Set(REASONS));
    const meter = live.meter ?? [];
    const row = (s: string) => meter.find((m) => m.session === s);
    expect(row('s-alpha'), 'the meter shows alpha\'s rung and why it holds').toMatchObject({ scope: 'writer', writer: W.alpha, rung: 'effects_off', reason: 'battery' });
    expect(row('s-bravo'), 'the meter shows bravo\'s rung and why it holds').toMatchObject({ scope: 'writer', writer: W.bravo, rung: 'internal_scale_down', reason: 'battery' });
    expect(row('s-alpha')!.measured.length, 'the meter\'s measured ring holds the newest 120 frames').toBe(120);
    expect(row('s-alpha')!.measured.every((ms) => Math.abs(ms - 1) < 1e-9), 'and they are the stub\'s 1 ms frames').toBe(true);
  }, 600_000);
});

describe(`${ID} a stub battery discharging at 25% steps the live view down one rung and stops it climbing`, () => {
  const events: LiveEvent[] = [{ frame: 300, camera: { session: 's-alpha', azimuth: 20 } }];
  it(`${ID} the control: at 80% the view dropped for frame health climbs one rung 120 frames after the view changes`, () => {
    const live = stubbed(500, events, [{ frame: 1, percent: 80, state: 'discharging' }], false);
    expect(ladderProblems(live, {
      's-alpha': [initial, { frame: 30, from: 'base', to: 'effects_off', reason: 'frame_health' }, { frame: 420, from: 'effects_off', to: 'base', reason: 'headroom' }],
    }), 'at 80% the view climbs back at frame 420').toEqual([]);
  }, 600_000);

  it(`${ID} at 25% from frame 200 the view steps down one rung (battery) and never climbs, the view change at 300 included`, () => {
    const live = stubbed(700, events, [{ frame: 1, percent: 80, state: 'discharging' }, { frame: 200, percent: 25, state: 'discharging' }], false);
    expect(ladderProblems(live, {
      's-alpha': [initial, { frame: 30, from: 'base', to: 'effects_off', reason: 'frame_health' }, { frame: 200, from: 'effects_off', to: 'lod_down', reason: 'battery' }],
    }), 'one rung down at 200, for the battery, and nothing after').toEqual([]);
    const climbs = changesOf(live, 's-alpha').filter((c) => c.frame > 200 && c.from !== null && rungIndex(c.to) < rungIndex(c.from));
    expect(climbs.map((c) => `frame ${c.frame}: ${c.from} → ${c.to}`), 'no climb on battery below 30%').toEqual([]);
    const step = changesOf(live, 's-alpha').find((c) => c.reason === 'battery')!;
    expect(rungProblems(live, 's-alpha', step.effective, 700, 'lod_down'), 'every frame after the battery step takes effect draws one rung down').toEqual([]);
  }, 600_000);
});

describe(`${ID} a change compiles the new rung's pipelines off-screen first, so no frame during the switch exceeds its class's frame time`, () => {
  const SWITCH = 60;
  function switched(planted?: 'compiles_at_swap'): { live: Live; change: Change } {
    requireMetal();
    const doc = writeDoc(out(), 'alpha', sceneDoc({ title: 'Alpha', class: 'work_product', size: [512, 512], boxes: 8, moving: true }));
    const live = liveReply(one(builds.bin(), out(), liveCall({
      frames: 120, sessions: [{ session: 's-alpha', writer: W.alpha, doc, size: [512, 512] }],
      events: [{ frame: SWITCH, rung: { session: 's-alpha', to: 'internal_scale_down' } }],
    }), planted ? { planted } : {}));
    const change = changesOf(live, 's-alpha').find((c) => c.reason === 'you');
    expect(change, 'your change is recorded').toMatchObject({ frame: SWITCH, from: expect.any(String), to: 'internal_scale_down', reason: 'you' });
    return { live, change: change! };
  }
  /** Where the new rung's pipelines were compiled, against the frame it took effect: one sentence per problem, naming the frame. */
  function compileProblems(live: Live, c: Change): string[] {
    const out: string[] = [];
    if (c.pipelines.length) {
      if (c.thread === null || c.thread === c.ui_thread) out.push(`frame ${c.effective}: ${c.to}'s pipelines compiled on the UI thread (${c.thread})`);
      if (c.compiled_by === null || c.compiled_by >= c.effective) out.push(`frame ${c.effective}: ${c.to} took effect before its pipelines were compiled (compiled by frame ${c.compiled_by})`);
    }
    out.push(...rungProblems(live, 's-alpha', c.frame, c.effective - 1, c.from ?? 'base'));
    out.push(...rungProblems(live, 's-alpha', c.effective, 120, c.to));
    for (let n = c.frame; n <= Math.min(120, c.effective + 10); n++) {
      const f = live.frames.find((x) => x.frame === n);
      if (!f?.views.find((v) => v.session === 's-alpha')?.drawn) out.push(`frame ${n}: no frame drawn during the switch`);
    }
    return out;
  }

  it(`${ID} your change to internal_scale_down compiles its pipelines off the UI thread before it takes effect, and every frame of the switch draws (Metal)`, () => {
    const { live, change } = switched();
    expect(change.effective, 'the new rung takes effect after the change').toBeGreaterThan(change.frame);
    expect(compileProblems(live, change), 'the switch compiles off-screen first and drops no frame').toEqual([]);
    const after = live.frames.find((f) => f.frame === change.effective)!.views.find((v) => v.session === 's-alpha')!;
    expect(after.internal_scale, 'internal_scale_down draws below scale 1').toBeLessThan(1);
  }, 900_000);

  it(`${ID} a planted ladder that compiles the new rung's pipelines at the swap fails, naming the frame (Metal)`, () => {
    const { live, change } = switched('compiles_at_swap');
    const problems = compileProblems(live, change);
    expect(problems.length, 'the planted swap fails the compile check').toBeGreaterThan(0);
    expect(problems[0], 'naming the frame').toMatch(/^frame \d+: /);
  }, 900_000);

  it(`${ID} on the reference Mac, no frame of the switch exceeds the work product's frame time (2 ms GPU, 4 ms CPU), five runs`, () => {
    const worst = Array.from({ length: 6 }, () => {
      const { live, change } = switched();
      const window = live.frames.filter((f) => f.frame >= change.frame && f.frame <= change.effective + 10);
      return { gpu: Math.max(...window.map((f) => f.gpu_ms)), cpu: Math.max(...window.map((f) => f.cpu_ms)) };
    }).slice(1);
    judge('the worst frame\'s GPU time during the switch (ms)', worst.map((w) => w.gpu), CLASS_LIMITS.work_product.gpu_ms!);
    judge('the worst frame\'s CPU time during the switch (ms)', worst.map((w) => w.cpu), CLASS_LIMITS.work_product.cpu_ms!);
  }, 3_600_000);
});
