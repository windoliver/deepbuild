// #1899.38e30b39: a frame-budget run of 600 showpiece frames at 3 ms of GPU each uses a test meter that leaves
// frames 560 to 599 unresolved and gives frame 100 an end timestamp before its start: frame 100 counts as invalid
// and is named, and where frames 560 to 599 actually took 14 ms the check is BLOCKED, naming those 40 frames and
// unresolved, since counting them as over budget fails the 10 ms p95 and counting them as within passes it; it is
// never PASS. With frame 100 valid and frames 560 to 599 at 3 ms, 20 of them unresolved and a forced device loss
// at frame 300 that leaves the 2 frames then in flight invalid, the check passes, because the p95 holds with all
// 22 counted as over budget. A planted meter that repeats the last resolved reading, or a check that drops
// unresolved frames from the percentile, passes the first run and fails this criterion, naming frame 560. On a
// test adapter without pass timestamps the GPU limit is BLOCKED, naming the feature, and the CPU encode time
// reported as the fallback is never compared with it.
//
// The stub meter (`test-meter` build, wgpu's noop backend, the virtual clock) under a reference Mac's environment.
// Each run is 600 frames, numbered 0 to 599 (10 s at 60 fps), and the stub's faults land at those numbers in each
// of the five runs. The planted programs are `--planted repeats_last_reading` and `drops_unresolved_frames`.
import { describe, expect, it } from 'vitest';
import {
  REFERENCE, RUNS, budgetCall, budgetOf, p95s, range, run, showpiece, useBuild, useOut,
  type Budget, type Invalid, type Planted, type StubMeter,
} from './helpers.ts';

const bin = useBuild();
const out = useOut();
const ID = '#1899.38e30b39';
/** 600 frames a run at 60 fps. */
const SECONDS = 10;
const UNRESOLVED = range(560, 599);

/** The first run: 3 ms a frame, frames 560–599 unresolved though they took 14 ms, frame 100 reversed. */
const FIRST: StubMeter = {
  frames: [{ from: 0, gpu_ms: 3 }, { from: 560, to: 599, gpu_ms: 14 }],
  unresolved: UNRESOLVED,
  reversed: [100],
};

function first(planted?: Planted): Budget {
  const doc = showpiece(out());
  const [reply] = run(bin(), out(), [budgetCall({ doc, seconds: SECONDS, report: ['frames'], stub_meter: FIRST, stub_environment: REFERENCE })], planted);
  return budgetOf(reply!, planted ? `the first run, planted ${planted}` : 'the first run');
}

const key = (i: Invalid): string => `${i.frame}:${i.why}`;

/** The criterion's check on the first run: each sentence names the frame it is about. */
function firstProblems(b: Budget): string[] {
  const out: string[] = [];
  const rows = new Map((b.frames ?? []).map((f) => [`${f.run}:${f.frame}`, f]));
  if (b.frames === null) out.push('the reply has no frame rows (report: ["frames"])');
  for (let r = 1; r <= RUNS && b.frames !== null; r++) {
    for (const k of UNRESOLVED) {
      const f = rows.get(`${r}:${k}`);
      if (!f || f.gpu_ms !== null || f.invalid !== 'unresolved') {
        out.push(`run ${r} frame ${k} is unresolved (it took 14 ms), yet the meter reads ${f?.gpu_ms} ms for it, marked ${f?.invalid}`);
        break;
      }
    }
    const f = rows.get(`${r}:100`);
    if (!f || f.gpu_ms !== null || f.invalid !== 'reversed') out.push(`run ${r} frame 100 ends before it starts, yet the meter reads ${f?.gpu_ms} ms for it, marked ${f?.invalid}`);
  }
  if (b.verdict !== 'BLOCKED' || b.gpu.verdict !== 'BLOCKED') {
    out.push(`the check is ${b.verdict} (GPU limit ${b.gpu.verdict}), not BLOCKED: frames 560 to 599, from frame 560, are unresolved and took 14 ms; counted as over budget they fail the 10 ms p95, counted as within they pass it`);
  }
  if (b.gpu.runs.length !== RUNS) out.push(`the GPU limit attaches ${b.gpu.runs.length} runs, not five`);
  const want = [{ frame: 100, why: 'reversed' }, ...UNRESOLVED.map((frame) => ({ frame, why: 'unresolved' }))];
  b.gpu.runs.forEach((run, i) => {
    const got = new Set(run.invalid.map(key));
    const missing = want.find((w) => !got.has(key(w)));
    if (missing) out.push(`run ${i + 1} doesn't name frame ${missing.frame} invalid (${missing.why})`);
    const extra = run.invalid.find((g) => !want.some((w) => key(w) === key(g)));
    if (extra) out.push(`run ${i + 1} names frame ${extra.frame} invalid (${extra.why}), which isn't`);
    if (run.p95_ms !== null) out.push(`run ${i + 1}'s p95 reads ${run.p95_ms} ms, where with frame 560 and the other invalid frames counted as over budget it falls on an invalid frame`);
  });
  return out;
}

describe(`${ID} frames the meter can't resolve, or that read wrong, never count as within`, () => {
  it(`${ID} frames 560–599 unresolved (they took 14 ms) and frame 100 reversed: BLOCKED, naming frame 100 reversed and the 40 frames unresolved, never PASS`, () => {
    const b = first();
    expect(b.verdict, 'never PASS').not.toBe('PASS');
    expect(firstProblems(b), 'BLOCKED, naming each invalid frame and why').toEqual([]);
  }, 1_800_000);

  it(`${ID} frames 560–579 unresolved and a forced device loss at frame 300 with 2 frames in flight, all at 3 ms: the 22 invalid frames are named, and the check passes, the p95 holding with them counted as over budget`, () => {
    const doc = showpiece(out());
    const [reply] = run(bin(), out(), [budgetCall({
      doc, seconds: SECONDS, stub_environment: REFERENCE,
      stub_meter: { frames: [{ from: 0, gpu_ms: 3 }], unresolved: range(560, 579), lose_device: { frame: 300, in_flight: 2 } },
    })]);
    const b = budgetOf(reply!, 'the second run');
    const want = [
      { frame: 299, why: 'device_lost' }, { frame: 300, why: 'device_lost' },
      ...range(560, 579).map((frame) => ({ frame, why: 'unresolved' })),
    ].map(key).sort();
    expect(b.gpu.runs.length, 'five runs').toBe(RUNS);
    for (const [i, r] of b.gpu.runs.entries()) {
      expect(r.invalid.map(key).sort(), `run ${i + 1} names exactly the 2 frames in flight at the loss and the 20 unresolved, frame 100 valid`).toEqual(want);
    }
    for (const [i, p] of p95s(b.gpu, 'the second run').entries()) expect(p, `run ${i + 1}'s p95, with the 22 counted as over budget`).toBeCloseTo(3, 3);
    expect(b.gpu.verdict, 'the GPU limit passes').toBe('PASS');
    expect(b.verdict, 'the check passes').toBe('PASS');
  }, 1_800_000);

  it.each(['repeats_last_reading', 'drops_unresolved_frames'] as const)(`${ID} planted %s passes the first run and fails this criterion, naming frame 560`, (planted) => {
    const b = first(planted);
    expect(b.verdict, `planted ${planted} passes the first run`).toBe('PASS');
    const problems = firstProblems(b);
    expect(problems.length, 'it fails the criterion').toBeGreaterThan(0);
    expect(problems.join('\n'), 'naming frame 560').toMatch(/\bframe 560\b/);
  }, 1_800_000);

  it(`${ID} on a test adapter without pass timestamps the GPU limit is BLOCKED, naming timestamps, and the CPU encode time reported as the fallback is never compared with it, whether 3 ms or 14 ms`, () => {
    const doc = showpiece(out());
    const encodes = [3, 14];
    const replies = run(bin(), out(), encodes.map((cpu_encode_ms) => budgetCall({
      doc, seconds: 5, stub_environment: REFERENCE,
      stub_meter: { timestamps: false, frames: [{ from: 0, gpu_ms: 3, cpu_encode_ms }] },
    })));
    replies.forEach((reply, i) => {
      const encode = encodes[i]!;
      const what = `no timestamps, CPU encode ${encode} ms`;
      const b = budgetOf(reply, what);
      expect(b.gpu.verdict, `${what}: the GPU limit is BLOCKED`).toBe('BLOCKED');
      expect(b.gpu.missing, `${what}: naming the feature`).toBe('timestamps');
      expect(b.gpu.runs.filter((r) => r.p95_ms !== null), `${what}: the GPU limit holds no reading`).toEqual([]);
      expect(b.fallback, `${what}: the CPU encode time is reported as the fallback`).not.toBeNull();
      expect(b.fallback!.source, `${what}: marked as the fallback`).toBe('cpu_encode');
      expect(b.fallback!.runs.length, `${what}: five runs`).toBe(RUNS);
      for (const p of b.fallback!.runs) expect(p, `${what}: the fallback's p95`).toBeCloseTo(encode, 3);
      expect(b.verdict, `${what}: the check is BLOCKED, never PASS or FAIL on the fallback`).toBe('BLOCKED');
    });
  }, 1_800_000);
});
