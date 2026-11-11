// #1903.d472967b: The envelope's first run on the reference Mac records its p99 frame time, seek rebuild, each
// process's peak memory and export throughput as a calibration baseline and asks you once for their limits, that
// baseline beside each; until you answer, the envelope is BLOCKED on those four, never PASS; and with a seek-rebuild
// limit you set below the baseline, a run that matches the baseline fails, naming the metric, the limit and the
// measured value, where a planted envelope that takes its first measurement as the limit passes it.
//
// The envelope on the stub meter (`test-meter` build, wgpu's noop backend) with a fresh store, one process, one
// scenario: the first run under the reference Mac's environment (the scene at 3 ms a frame, seek rebuild 40 ms, the
// app at 900 MB and its decode worker at 200 MB, export at 3× real time); a second run there; a run under an M1, a
// Mac measured later, with other readings; an agent's limits, refused; a run; your limits, the seek rebuild's 30 ms
// below its 40 ms baseline and the others above theirs; and a run that matches the baseline. The wrong program is
// `--planted takes_first_measurement_as_limit`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  M1, REFERENCE, READINGS, SCENE, SCENE_METRICS, decideCall, deviceOf, envelopeCall, envelopeOf, flat, metricRow, run, sameDevice,
  sceneDoc, stubMeter, useBuild, useOut, writeDoc,
  type Envelope, type Fingerprint, type JsonObject, type Metric, type Readings,
} from './helpers.ts';

const bin = useBuild();
const out = useOut();
const ID = '#1903.d472967b';
const SECONDS = 5;
const REFERENCE_GPU_MS = 3;
const M1_GPU_MS = 6;
const M1_READINGS: Readings = { seek_rebuild_ms: 70, peak_bytes: { app: 1_100_000_000, decode_worker: 250_000_000 }, export_x: 1.5 };
/** Your limits: the seek rebuild's below its baseline, each other one on the side of its baseline that holds it. */
const YOUR_LIMITS: Record<string, number> = {
  frame_time_p99: 5, seek_rebuild: 30, 'peak_memory/app': 1_000_000_000, 'peak_memory/decode_worker': 300_000_000, export_throughput: 2,
};
const SEEK = 'seek_rebuild';

/** Each of the four metrics' (five rows') value under the stub's readings and frame time. */
function values(gpu_ms: number, r: Readings): Record<string, number> {
  return {
    frame_time_p99: gpu_ms, seek_rebuild: r.seek_rebuild_ms, 'peak_memory/app': r.peak_bytes.app,
    'peak_memory/decode_worker': r.peak_bytes.decode_worker, export_throughput: r.export_x,
  };
}
const AT_REFERENCE = values(REFERENCE_GPU_MS, READINGS);
const AT_M1 = values(M1_GPU_MS, M1_READINGS);

function envelope(dir: string, store: string, environment: Fingerprint, gpu_ms: number, readings: Readings): JsonObject {
  return envelopeCall({
    store, scene: writeDoc(dir, 'scene', sceneDoc()), seconds: SECONDS, stub_environment: environment,
    stub_meter: stubMeter({ [SCENE]: flat(gpu_ms) }, readings),
  });
}
const rows = (e: Envelope, what: string): Metric[] => SCENE_METRICS.map((m) => metricRow(e, m, what));
const near = (a: number | null, b: number): boolean => a !== null && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

/** The criterion's check on the run that matches the baseline under your limits. */
function matchProblems(e: Envelope, what: string): string[] {
  const out: string[] = [];
  for (const m of rows(e, what)) {
    const want = m.metric === SEEK ? 'FAIL' : 'PASS';
    if (m.verdict !== want || !near(m.limit, YOUR_LIMITS[m.metric]!) || !near(m.measured, AT_REFERENCE[m.metric]!)) {
      out.push(`${m.metric} measured ${m.measured} ${m.unit} against the limit ${m.limit} reads ${m.verdict}; with your limit ${YOUR_LIMITS[m.metric]} and the baseline's ${AT_REFERENCE[m.metric]} it is ${want}`);
    }
  }
  if (e.verdict !== 'FAIL') out.push(`the envelope is ${e.verdict}, not FAIL on ${SEEK}`);
  return out;
}

describe(`${ID} the calibration baseline, the one ask and the limits you set`, () => {
  it(`${ID} the first run records the baseline and asks once, BLOCKED until you answer; a later Mac adds a reading with no new ask; an agent's limits are refused; and with your seek-rebuild limit below the baseline a run that matches it fails, naming the metric, the limit and the value`, () => {
    const dir = out();
    const store = join(dir, 'store');
    const [first, second, later, agent, afterAgent, yours, last] = run(bin(), dir, [
      envelope(dir, store, REFERENCE, REFERENCE_GPU_MS, READINGS),
      envelope(dir, store, REFERENCE, REFERENCE_GPU_MS, READINGS),
      envelope(dir, store, M1, M1_GPU_MS, M1_READINGS),
      decideCall(store, 'agent', YOUR_LIMITS),
      envelope(dir, store, REFERENCE, REFERENCE_GPU_MS, READINGS),
      decideCall(store, 'you', YOUR_LIMITS),
      envelope(dir, store, REFERENCE, REFERENCE_GPU_MS, READINGS),
    ]);
    const ref = deviceOf(REFERENCE);

    // The first run: the baseline recorded on the reference Mac, BLOCKED on each of the four, and the one ask.
    const e1 = envelopeOf(first!, 'the first run');
    for (const m of rows(e1, 'the first run')) {
      expect(m.measured, `the first run measures ${m.metric}`).toBeCloseTo(AT_REFERENCE[m.metric]!, 6);
      expect(m.baseline.length, `${m.metric}'s baseline: the reference Mac's value`).toBe(1);
      expect(sameDevice(m.baseline[0]!.device, ref) && near(m.baseline[0]!.value, AT_REFERENCE[m.metric]!), `${m.metric}'s baseline is the first run's on Mac15,7: ${JSON.stringify(m.baseline)}`).toBe(true);
      expect(m.limit, `${m.metric} has no limit until you set one`).toBeNull();
      expect(m.verdict, `the envelope is BLOCKED on ${m.metric} until you answer`).toBe('BLOCKED');
    }
    expect(e1.verdict, 'the first run is BLOCKED, never PASS').toBe('BLOCKED');
    expect(e1.asks.length, 'the first run asks you once').toBe(1);
    const ask = e1.asks[0]!;
    expect(ask.kind, 'the ask is for the envelope\'s limits').toBe('envelope_limits');
    for (const name of SCENE_METRICS) {
      const asked = ask.metrics.find((m) => m.metric === name);
      expect(asked, `the ask lists ${name}`).toBeDefined();
      expect(asked!.baseline.some((b) => sameDevice(b.device, ref) && near(b.value, AT_REFERENCE[name]!)), `the ask has ${name}'s baseline beside it: ${JSON.stringify(asked!.baseline)}`).toBe(true);
    }

    // A second run on the reference Mac: no new ask, still BLOCKED, the baseline unchanged.
    const e2 = envelopeOf(second!, 'the second run');
    expect(e2.asks, 'the same question is never asked twice').toEqual([]);
    for (const m of rows(e2, 'the second run')) expect(m.verdict, `${m.metric} stays BLOCKED until you answer`).toBe('BLOCKED');
    expect(e2.verdict, 'never PASS before you answer').not.toBe('PASS');

    // A Mac measured later adds a reading beside the reference Mac's, with no new ask.
    const e3 = envelopeOf(later!, 'the run on the M1');
    expect(e3.asks, 'a Mac measured later raises no new ask').toEqual([]);
    for (const m of rows(e3, 'the run on the M1')) {
      expect(m.baseline.some((b) => sameDevice(b.device, ref) && near(b.value, AT_REFERENCE[m.metric]!)), `${m.metric} keeps the reference Mac's baseline: ${JSON.stringify(m.baseline)}`).toBe(true);
      expect(m.baseline.some((b) => sameDevice(b.device, deviceOf(M1)) && near(b.value, AT_M1[m.metric]!)), `${m.metric} adds the M1's reading beside it: ${JSON.stringify(m.baseline)}`).toBe(true);
      expect(m.verdict, `${m.metric} on the M1 is never PASS`).not.toBe('PASS');
    }

    // Only you set limits.
    expect(agent!['outcome'], `an agent's limits are refused: ${JSON.stringify(agent)}`).toBe('refused');
    expect(agent!['code'], 'not your decision').toBe('not_your_decision');
    const e4 = envelopeOf(afterAgent!, 'the run after the agent\'s limits');
    for (const m of rows(e4, 'the run after the agent\'s limits')) {
      expect(m.limit, `${m.metric}: the agent's limit didn't land`).toBeNull();
      expect(m.verdict, `${m.metric} is still BLOCKED`).toBe('BLOCKED');
    }
    expect(e4.asks, 'no new ask').toEqual([]);
    expect(yours!['outcome'], `your limits are decided: ${JSON.stringify(yours)}`).toBe('decided');

    // The run that matches the baseline, under your limits: it fails on the seek rebuild alone.
    const e5 = envelopeOf(last!, 'the run that matches the baseline');
    expect(e5.asks, 'no new ask after you answered').toEqual([]);
    expect(matchProblems(e5, 'the run that matches the baseline'), 'FAIL, naming seek_rebuild, your 30 ms and the measured 40 ms').toEqual([]);
  }, 1_800_000);

  it(`${ID} planted takes_first_measurement_as_limit passes the run that matches the baseline and fails this criterion, naming seek_rebuild`, () => {
    const dir = out();
    const store = join(dir, 'store');
    const [, yours, last] = run(bin(), dir, [
      envelope(dir, store, REFERENCE, REFERENCE_GPU_MS, READINGS),
      decideCall(store, 'you', YOUR_LIMITS),
      envelope(dir, store, REFERENCE, REFERENCE_GPU_MS, READINGS),
    ], { planted: 'takes_first_measurement_as_limit' });
    expect(yours!['outcome'], 'your limits are decided').toBe('decided');
    const e = envelopeOf(last!, 'the run that matches the baseline, planted takes_first_measurement_as_limit');
    expect(metricRow(e, SEEK, 'the planted run').verdict, 'the planted envelope passes the seek rebuild that matches its first measurement').toBe('PASS');
    const problems = matchProblems(e, 'the planted run');
    expect(problems.length, 'it fails the criterion').toBeGreaterThan(0);
    expect(problems.join('\n'), 'naming seek_rebuild').toMatch(/\bseek_rebuild\b/);
  }, 1_800_000);
});
