// #379.459fdbc0: with a stub meter forcing frame-health step-downs and an operator measured at 3 times its
// declaration, a render-back, an export frame and a frame-budget run of the same revision each draw at the
// class's base rung with the operator at full resolution, equal by pixel hash to a fresh process's; a
// planted meter shared with the headless worker draws the render-back at half scale and fails, naming the
// rung.
//
// `test-meter` build on Metal: a work product with boxes and the test module's `test.burn@1` operator; the
// stub meter charges its writer 5 ms a frame (three steps down by frame 90) and measures `test.burn` at 3
// times its declaration. At frame 100 the live run asks for the three canonical renders of frame 10 of the
// session's current revision; a fresh process renders the same with `canonical`. Off macOS: INCONCLUSIVE.
import { describe, expect, it } from 'vitest';
import {
  LOOK, W, burn, canonicalOf, changesOf, liveCall, liveReply, one, requireMetal, rungIndex, sceneDoc, useBuilds, useOut, writeDoc,
  type Canonical, type Live, type Purpose,
} from './helpers.ts';

const builds = useBuilds(['test-meter']);
const out = useOut();
const ID = '#379.459fdbc0';
const PURPOSES: Purpose[] = ['render_back', 'export', 'frame_budget'];
const SIZE: [number, number] = [320, 240];
const OF_FRAME = 10;
/** The frame the canonical renders are asked at: after the steps at 30, 60 and 90 (internal_scale_down), before 120. */
const AT = 100;

function docPath(): string {
  return writeDoc(out(), 'alpha', sceneDoc({ title: 'Alpha, with an operator', class: 'work_product', size: SIZE, boxes: 6, moving: true, items: { glow: burn('glow', 50) } }));
}

function degraded(planted?: 'shares_meter_with_worker'): Live {
  requireMetal();
  const doc = docPath();
  return liveReply(one(builds.bin('test-meter'), out(), liveCall({
    frames: AT,
    sessions: [{ session: 's-alpha', writer: W.alpha, doc, size: SIZE }],
    events: PURPOSES.map((purpose) => ({ frame: AT, canonical: { session: 's-alpha', purpose, frame: OF_FRAME, size: SIZE } })),
    stub_meter: { writers: { [W.alpha]: [{ from: 1, gpu_ms: 5 }] }, operators: { 'test.burn': 3 } },
  }), planted ? { planted } : {}));
}

function fresh(purpose: Purpose): Canonical {
  const doc = docPath();
  return canonicalOf(one(builds.bin('test-meter'), out(), { call: 'canonical', look: LOOK, writer: W.alpha, doc, size: SIZE, frame: OF_FRAME, purpose }), `a fresh process's ${purpose}`);
}

/** The criterion's check on one canonical render: base rung, scale 1, every operator at full resolution, the fresh process's pixels. */
function canonicalProblems(c: Canonical, reference: Canonical): string[] {
  const out: string[] = [];
  if (c.rung !== 'base') out.push(`${c.purpose} drew at rung ${c.rung}, not the class's base`);
  if (c.internal_scale !== 1) out.push(`${c.purpose} drew at scale ${c.internal_scale} (rung ${c.rung})`);
  for (const o of c.operators) if (o.resolution !== 1) out.push(`${c.purpose} ran ${o.operator} at resolution ${o.resolution} (rung ${c.rung})`);
  if (!c.operators.some((o) => o.operator === 'test.burn')) out.push(`${c.purpose} lists no test.burn operator`);
  if (c.pixel_hash === null || c.pixel_hash !== reference.pixel_hash) out.push(`${c.purpose}'s pixels ${c.pixel_hash} aren't the fresh process's ${reference.pixel_hash} (rung ${c.rung})`);
  return out;
}

describe(`${ID} canonical renders never step down`, () => {
  it(`${ID} after frame-health step-downs and an operator measured at 3 times its declaration, the render-back, the export frame and the frame-budget run draw at the base rung, at full resolution, equal to a fresh process's`, () => {
    const live = degraded();
    const downs = changesOf(live, 's-alpha').filter((c) => c.reason === 'frame_health');
    expect(downs.length, 'the stub meter forced frame-health step-downs').toBeGreaterThanOrEqual(2);
    const last = live.frames.at(-1)!.views.find((v) => v.session === 's-alpha')!;
    expect(rungIndex(last.rung), `the live view is below its base rung at frame ${AT} (${last.rung})`).toBeGreaterThan(rungIndex('base'));
    expect(live.canonicals.map((c) => c.purpose), 'the three canonical renders, in order').toEqual(PURPOSES);
    for (const c of live.canonicals) {
      expect(c.frame, `${c.purpose}: asked at frame ${AT}`).toBe(AT);
      expect(canonicalProblems(c, fresh(c.purpose as Purpose)), `${c.purpose} draws at the class's fixed quality`).toEqual([]);
    }
  }, 1_800_000);

  it(`${ID} a planted meter shared with the headless worker draws the render-back at half scale and fails, naming the rung`, () => {
    const live = degraded('shares_meter_with_worker');
    const back = live.canonicals.find((c) => c.purpose === 'render_back');
    expect(back, 'the render-back was drawn').toBeDefined();
    const problems = canonicalProblems(back!, fresh('render_back'));
    expect(problems.length, 'the planted worker\'s render-back fails the check').toBeGreaterThan(0);
    expect(back!.internal_scale, 'it drew at half scale').toBe(0.5);
    expect(problems[0], 'the failure names the rung it drew at').toMatch(/^render_back drew at rung (?!base)\S+, not the class's base/);
  }, 1_800_000);
});
