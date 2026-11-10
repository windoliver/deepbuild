// #1903.a03bdb26: In the envelope run, input on screen is measured per input from the entry's arrival at the app to
// the presentation time the display seam reports for the first frame that reads it: 1,000 test inputs at seeded
// times give a p95 within 2 frames at the display's rate; a planted path that holds each input one extra step and
// one extra swap slot reads past 2 frames and fails, naming the frames; and a meter that stops at the frame's encode
// instead of its presentation reads within 2 frames on that planted path and fails this test.
//
// The envelope run of 60 s (five timed runs after warm-up) on the stub meter (`test-meter` build, wgpu's noop
// backend) under a reference Mac's environment, its window on the stub display seam refreshing at 60 Hz on the run's
// virtual clock. In each timed run, 1,000 test inputs arrive at seeded times (mulberry32, seed 1903, uniform over the
// run's first 59 s): each an entry of writer `you` on the scene's input track for its toggle `nudge`. Each input's
// reading is checked against the frame log the display seam's presentation times fill. The wrong programs are
// `--planted holds_input` (the path) and `--planted held_input_meter_at_encode` (that path, timed to the encode).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NUDGE, REFERENCE, RUNS, SCENE, envelopeCall, envelopeOf, flat, p95, run, sceneDoc, seededTimes, stubMeter, useBuild, useOut, writeDoc,
  type Envelope, type FrameLog, type Planted,
} from './helpers.ts';

const bin = useBuild();
const out = useOut();
const ID = '#1903.a03bdb26';
/** The envelope's run: s = 60. */
const SECONDS = 60;
const RATE_HZ = 60;
const LIMIT_FRAMES = 2;
const LIMIT_MS = (LIMIT_FRAMES * 1000) / RATE_HZ;
const INPUTS = 1000;
const TIMES = seededTimes(1903, INPUTS, 59e9);

function play(planted?: Planted): Envelope {
  const dir = out();
  const [reply] = run(bin(), dir, [envelopeCall({
    store: join(dir, 'store'), scene: writeDoc(dir, 'scene', sceneDoc({ nudge: true })), seconds: SECONDS,
    inputs: { control: NUDGE, at_ns: TIMES }, report: ['frames', 'inputs'],
    stub_meter: stubMeter({ [SCENE]: flat(3) }), stub_display: { rate_hz: RATE_HZ }, stub_environment: REFERENCE,
  })], planted ? { planted } : {});
  return envelopeOf(reply!, planted ? `the envelope run, planted ${planted}` : 'the envelope run');
}

/**
 * The criterion's check: each timed run's p95 within 2 frames at the display's rate, and each of its 1,000 inputs
 * read from its arrival to the presentation the display seam reports (the frame log) for the frame that reads it.
 * Each sentence names the run, the input, the frame or the frames it is about; at most three per run and kind.
 */
function inputProblems(e: Envelope): string[] {
  const out: string[] = [];
  const lim = e.input;
  if (lim.limit_frames !== LIMIT_FRAMES) out.push(`input on screen is held to ${lim.limit_frames} frames, not 2`);
  if (lim.rate_hz !== RATE_HZ) out.push(`input on screen is counted at ${lim.rate_hz} Hz, not the display's ${RATE_HZ} Hz`);
  if (lim.runs.length !== RUNS) out.push(`input on screen attaches ${lim.runs.length} runs, not five`);
  lim.runs.forEach((r, i) => {
    if (r.p95_frames === null || r.p95_frames > LIMIT_FRAMES || r.p95_ms === null || r.p95_ms > LIMIT_MS) {
      out.push(`run ${i + 1}'s input-to-present p95 reads ${r.p95_frames} frames (${r.p95_ms} ms), past 2 frames at ${RATE_HZ} Hz (${LIMIT_MS.toFixed(3)} ms)`);
    }
  });
  if (e.inputs === null) return [...out, 'the reply has no input rows (report: ["inputs"])'];
  if (e.frames === null) return [...out, 'the reply has no frame log (report: ["frames"])'];
  const log = new Map<string, FrameLog>(e.frames.filter((f) => f.fixture === SCENE).map((f) => [`${f.run}:${f.frame}`, f]));
  for (let run = 1; run <= RUNS; run++) {
    const rows = e.inputs.filter((x) => x.run === run).sort((a, b) => a.input - b.input);
    if (rows.length !== INPUTS) out.push(`run ${run} reads ${rows.length} inputs, not ${INPUTS}`);
    const found: Record<string, number> = {};
    const note = (kind: string, sentence: string): void => { found[kind] = (found[kind] ?? 0) + 1; if (found[kind]! <= 3) out.push(sentence); };
    for (const x of rows) {
      const at = `run ${run} input ${x.input}`;
      if (x.arrived_ns !== TIMES[x.input]) note('arrival', `${at} arrived at ${x.arrived_ns} ns, not at its seeded ${TIMES[x.input]} ns`);
      const f = log.get(`${run}:${x.frame}`);
      if (!f) { note('frame', `${at} is read by frame ${x.frame}, which the frame log doesn't hold`); continue; }
      if (f.latched_ns < x.arrived_ns) note('latch', `${at} arrived at ${x.arrived_ns} ns, after frame ${x.frame} latched at ${f.latched_ns} ns, so that frame can't read it`);
      if (Math.abs(x.presented_ns - f.presented_ns) > 1) note('end', `${at}'s reading ends at ${x.presented_ns} ns, not at frame ${x.frame}'s presentation at ${f.presented_ns} ns as the display seam reports it (its encode ended at ${f.encoded_ns} ns)`);
      const ms = (f.presented_ns - x.arrived_ns) / 1e6;
      if (Math.abs(x.ms - ms) > 1e-3) note('reading', `${at} reads ${x.ms} ms, not the ${ms.toFixed(3)} ms from its arrival to frame ${x.frame}'s presentation`);
    }
    const reported = lim.runs[run - 1]?.p95_ms ?? null;
    if (rows.length > 0 && (reported === null || Math.abs(reported - p95(rows.map((x) => x.ms))) > 1e-3)) {
      out.push(`run ${run}'s p95 reads ${reported} ms, not the p95 of its inputs' readings, ${p95(rows.map((x) => x.ms)).toFixed(3)} ms`);
    }
  }
  return out;
}

describe(`${ID} input on screen within 2 frames, measured to the presentation`, () => {
  it(`${ID} 1,000 test inputs at seeded times over the 60 s envelope run, each measured to the reported presentation of the first frame that reads it, give a p95 within 2 frames at 60 Hz`, () => {
    const e = play();
    expect(inputProblems(e), 'every input measured to its frame\'s presentation, p95 within 2 frames').toEqual([]);
    expect(e.input.verdict, 'input on screen passes').toBe('PASS');
  }, 1_800_000);

  it(`${ID} planted holds_input, one extra step and one extra swap slot, reads past 2 frames and fails, naming the frames`, () => {
    const e = play('holds_input');
    expect(e.input.verdict, 'the held path fails input on screen').toBe('FAIL');
    for (const [i, r] of e.input.runs.entries()) expect(r.p95_frames, `run ${i + 1} names its p95 in frames, past 2`).toBeGreaterThan(LIMIT_FRAMES);
    expect(e.verdict, 'the envelope fails').toBe('FAIL');
    expect(inputProblems(e).join('\n'), 'this test fails it, naming the frames').toMatch(/past 2 frames/);
  }, 1_800_000);

  it(`${ID} planted held_input_meter_at_encode, timed to the encode on the held path, reads within 2 frames and fails this test`, () => {
    const e = play('held_input_meter_at_encode');
    expect(e.input.verdict, 'timed to the encode, the held path reads within 2 frames').toBe('PASS');
    const problems = inputProblems(e);
    expect(problems.length, 'this test fails it').toBeGreaterThan(0);
    expect(problems.join('\n'), 'naming the presentation its readings stop short of').toMatch(/presentation/);
  }, 1_800_000);
});
