// #1903.561ba507: On the reference Mac, `separate-items` holds the showpiece class's 10 ms at p95 under the five-run
// rule, and its ratio to the instanced twin is in the baseline. Until you set the ratio's limit the envelope is
// BLOCKED on it, never PASS. With a limit set below the baseline, a run that matches the baseline fails, naming the
// ratio and the limit. A planted envelope that times only the every-pass scene reports no `separate-items` row and
// fails, naming the fixture.
//
// The rule, on the stub meter (`test-meter` build, wgpu's noop backend) under a reference Mac's environment, one
// process with a fresh store: the envelope with `separate-items` (every frame 6 ms) and its instanced twin (4 ms), so
// a ratio of 1.5; your ratio limit of 1.2; the envelope again, matching the baseline. The wrong program is
// `--planted times_only_scene`. Then the device: the same envelope on this Mac's own GPU, no stub, five 60 s runs,
// which counts only on a reference Mac on mains power, Low Power Mode off and thermal state nominal; anywhere else
// the test is skipped as INCONCLUSIVE, never passed.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INSTANCED, RATIO, REFERENCE, RUNS, SCENE, SEPARATE_ITEMS, SHOWPIECE_GPU_MS, decideCall, deviceOf, envelopeCall, envelopeOf, fixtureRow,
  flat, instancedTwinDoc, metricRow, offReference, run, sameDevice, sceneDoc, separateItemsDoc, stubMeter, useBuild, useOut, writeDoc,
  type Envelope, type JsonObject, type Planted,
} from './helpers.ts';

const bin = useBuild();
const out = useOut();
const ID = '#1903.561ba507';
/** 300 frames a run on the stub, the design's floor for a frame-time p95; the fixture's own 60 s on the device. */
const STUB_SECONDS = 5;
const DEVICE_SECONDS = 60;
const SEPARATE_MS = 6;
const INSTANCED_MS = 4;
const BASELINE_RATIO = SEPARATE_MS / INSTANCED_MS;
const YOUR_RATIO_LIMIT = 1.2;

function envelope(dir: string, store: string, stubbed: boolean): JsonObject {
  return envelopeCall({
    store, scene: writeDoc(dir, 'scene', sceneDoc()), seconds: stubbed ? STUB_SECONDS : DEVICE_SECONDS,
    separate_items: { doc: writeDoc(dir, 'separate-items', separateItemsDoc()), instanced: writeDoc(dir, 'separate-items-instanced', instancedTwinDoc()) },
    ...(stubbed ? {
      stub_environment: REFERENCE,
      stub_meter: stubMeter({ [SCENE]: flat(3), [SEPARATE_ITEMS]: flat(SEPARATE_MS), [INSTANCED]: flat(INSTANCED_MS) }),
    } : {}),
  });
}

/** The criterion's check that the envelope timed `separate-items` and holds it within 10 ms at p95 over five runs. */
function heldProblems(e: Envelope): string[] {
  const row = fixtureRow(e, SEPARATE_ITEMS);
  if (!row) return [`the envelope reports no ${SEPARATE_ITEMS} row: the fixture ${SEPARATE_ITEMS} wasn't timed`];
  const ft = row.frame_time;
  if (!ft) return [`the ${SEPARATE_ITEMS} row has no frame time (${row.verdict}, ${row.why})`];
  const out: string[] = [];
  if (ft.limit_ms !== SHOWPIECE_GPU_MS) out.push(`${SEPARATE_ITEMS} is held to ${ft.limit_ms} ms, not the showpiece class's ${SHOWPIECE_GPU_MS} ms`);
  if (ft.runs.length !== RUNS) out.push(`${SEPARATE_ITEMS} attaches ${ft.runs.length} runs, not five`);
  if (ft.verdict !== 'PASS') out.push(`${SEPARATE_ITEMS} reads ${ft.verdict} at p95 ${JSON.stringify(ft.runs.map((r) => r.p95_ms))} ms against ${SHOWPIECE_GPU_MS} ms`);
  return out;
}

const near = (a: number | null, b: number): boolean => a !== null && Math.abs(a - b) <= 1e-6;

describe(`${ID} separate-items, held to the class, and its ratio to the instanced twin`, () => {
  it(`${ID} on the stubbed reference Mac separate-items holds 10 ms at p95 over five runs, its ratio to the instanced twin joins the baseline, BLOCKED until you set its limit, and with a limit below the baseline a run that matches it fails, naming the ratio and the limit`, () => {
    const dir = out();
    const store = join(dir, 'store');
    const [first, yours, again] = run(bin(), dir, [
      envelope(dir, store, true), decideCall(store, 'you', { [RATIO]: YOUR_RATIO_LIMIT }), envelope(dir, store, true),
    ]);
    const e1 = envelopeOf(first!, 'the first run with separate-items');
    expect(heldProblems(e1), 'separate-items timed and held within 10 ms at p95').toEqual([]);
    for (const [i, r] of fixtureRow(e1, SEPARATE_ITEMS)!.frame_time!.runs.entries()) expect(r.p95_ms, `separate-items run ${i + 1}'s p95`).toBeCloseTo(SEPARATE_MS, 6);
    const ratio = metricRow(e1, RATIO, 'the first run');
    expect(ratio.measured, 'the ratio of separate-items\' p95 to the instanced twin\'s').toBeCloseTo(BASELINE_RATIO, 6);
    expect(ratio.baseline.some((b) => sameDevice(b.device, deviceOf(REFERENCE)) && near(b.value, BASELINE_RATIO)), `the ratio is in the baseline: ${JSON.stringify(ratio.baseline)}`).toBe(true);
    expect(ratio.limit, 'no ratio limit until you set one').toBeNull();
    expect(ratio.verdict, 'the envelope is BLOCKED on the ratio').toBe('BLOCKED');
    expect(e1.verdict, 'BLOCKED, never PASS').toBe('BLOCKED');
    const asked = e1.asks.flatMap((a) => a.metrics).find((m) => m.metric === RATIO);
    expect(asked, 'the ratio\'s limit is asked').toBeDefined();
    expect(asked!.baseline.some((b) => near(b.value, BASELINE_RATIO)), 'with its baseline beside it').toBe(true);

    expect(yours!['outcome'], `your ratio limit is decided: ${JSON.stringify(yours)}`).toBe('decided');
    const e2 = envelopeOf(again!, 'the run that matches the baseline');
    const r2 = metricRow(e2, RATIO, 'the run that matches the baseline');
    expect(r2.verdict, `the ratio ${r2.measured} against your limit ${r2.limit} fails`).toBe('FAIL');
    expect(r2.limit, 'naming your limit').toBeCloseTo(YOUR_RATIO_LIMIT, 9);
    expect(r2.measured, 'and the ratio').toBeCloseTo(BASELINE_RATIO, 6);
    expect(e2.verdict, 'the envelope fails').toBe('FAIL');
  }, 1_800_000);

  it(`${ID} planted times_only_scene reports no separate-items row and fails, naming the fixture`, () => {
    const dir = out();
    const planted: Planted = 'times_only_scene';
    const [reply] = run(bin(), dir, [envelope(dir, join(dir, 'store'), true)], { planted });
    const e = envelopeOf(reply!, `the envelope, planted ${planted}`);
    expect(fixtureRow(e, SEPARATE_ITEMS), 'the planted envelope reports no separate-items row').toBeUndefined();
    expect(heldProblems(e).join('\n'), 'it fails, naming the fixture').toMatch(/\bseparate-items\b/);
  }, 1_800_000);

  it(`${ID} on this Mac's own GPU, a reference Mac in its conditions, separate-items holds 10 ms at p95 over five 60 s runs`, async (ctx) => {
    const off = await offReference();
    if (off !== null) ctx.skip(`INCONCLUSIVE (not measured: ${off}): separate-items holds the class only on a reference Mac's own GPU`);
    const dir = out();
    const [reply] = run(bin(), dir, [envelope(dir, join(dir, 'store'), false)], { backend: 'gpu' });
    const e = envelopeOf(reply!, 'the envelope on this Mac\'s GPU');
    const ft = fixtureRow(e, SEPARATE_ITEMS)?.frame_time;
    if (ft?.verdict === 'INCONCLUSIVE') ctx.skip(`INCONCLUSIVE (reading only): separate-items' five p95s ${JSON.stringify(ft.runs.map((r) => r.p95_ms))} ms against ${SHOWPIECE_GPU_MS} ms`);
    expect(heldProblems(e), 'separate-items holds the showpiece class on the reference Mac').toEqual([]);
  }, 1_800_000);
});
