// Criterion 2 (#140.81e434c9): predicted presentation lands within one refresh of the measured one at 60 and
// 120 Hz, and a still scene schedules zero wakeups over 10 s. The display seam's macOS backend is the display
// link through GPUI, so both halves run in the app's real, shown window (`deep-show live`, README: The live
// options), on the reference Mac's built-in ProMotion display: the film paced at 60 Hz and at 120 Hz, then the
// still figure watched for 10 s after it settles. At the base `deep-show live` has no `live` options.
import { describe, expect, it } from 'vitest';
import {
  DEEP_SHOW, FIGURE, FILM, arr, inconclusive, liveRun, loadProblem, num, obj, referenceMacProblem, showScenario, useBuilds, useDir,
  type JsonObject,
} from './helpers.ts';

const builds = useBuilds([DEEP_SHOW]);
const dir = useDir();

interface Presented { seq: number; predicted: number; presented: number; refresh: number }
function framesOf(live: JsonObject, what: string): Presented[] {
  return arr(live['frames'], `${what}: live.frames`).map((v, i) => {
    const f = obj(v, `${what}: live.frames[${i}]`);
    return {
      seq: num(f['frame_seq'], `${what}: frames[${i}].frame_seq`),
      predicted: num(f['predicted_ns'], `${what}: frames[${i}].predicted_ns`),
      presented: num(f['presented_ns'], `${what}: frames[${i}].presented_ns`),
      refresh: num(f['refresh_ns'], `${what}: frames[${i}].refresh_ns`),
    };
  });
}

/** What breaks "predicted within one refresh of measured" at a pace, as sentences naming the frame. */
function pacingProblems(hz: number, frames: Presented[], wakeups: number, watchMs: number): string[] {
  const p: string[] = [];
  const period = 1e9 / hz;
  const least = Math.floor(0.5 * hz * (watchMs / 1000));
  if (frames.length < least) p.push(`${hz} Hz: ${frames.length} frames presented in ${watchMs} ms, fewer than ${least}: too few to judge the prediction`);
  for (const f of frames) {
    if (Math.abs(f.refresh - period) > 0.01 * period) p.push(`${hz} Hz: frame ${f.seq} reports refresh_ns ${f.refresh}, not ${period.toFixed(0)}`);
    const off = Math.abs(f.presented - f.predicted);
    if (off > f.refresh) p.push(`${hz} Hz: frame ${f.seq} was predicted at ${f.predicted} ns and presented at ${f.presented} ns, ${(off / 1e6).toFixed(3)} ms apart, more than one refresh (${(f.refresh / 1e6).toFixed(3)} ms)`);
  }
  for (let i = 1; i < frames.length; i++) {
    if (frames[i]!.presented <= frames[i - 1]!.presented || frames[i]!.predicted <= frames[i - 1]!.predicted) {
      p.push(`${hz} Hz: frames ${frames[i - 1]!.seq} and ${frames[i]!.seq} are out of order in time`);
      break;
    }
  }
  // The measured cadence proves the run was paced at this rate, not at the display's other one.
  const gaps = frames.slice(1).map((f, i) => f.presented - frames[i]!.presented).sort((a, b) => a - b);
  if (gaps.length) {
    const median = gaps[Math.floor(gaps.length / 2)]!;
    if (Math.abs(median - period) > 0.1 * period) p.push(`${hz} Hz: the measured frames are a median ${(median / 1e6).toFixed(3)} ms apart, not ${(period / 1e6).toFixed(3)} ms: the window was not paced at ${hz} Hz`);
  }
  // The wakeup count counts: a moving film wakes the frame clock at least once per presented frame.
  if (wakeups < frames.length) p.push(`${hz} Hz: wakeups ${wakeups} is fewer than the ${frames.length} frames presented: the count misses wakeups`);
  return p;
}

describe('#140.81e434c9 (C2) display timing: predicted presentation within one refresh at 60 and 120 Hz; a still scene schedules no wakeups', () => {
  it('#140.81e434c9 (C2) a moving film in the app\'s window, paced at 60 Hz and at 120 Hz: every presented frame\'s predicted presentation is within one refresh of its measured one', () => {
    const bin = builds.bin(DEEP_SHOW);
    const watchMs = 3000;
    const problems: string[] = [];
    for (const hz of [60, 120]) {
      const scenario = showScenario(dir(), FILM(), 'film', { live: { pace_hz: hz, watch_from: 'first_frame', watch_ms: watchMs } });
      const { live } = liveRun(bin, scenario);
      const display = obj(live['display'], `${hz} Hz: live.display`);
      const most = num(display['max_refresh_hz'], `${hz} Hz: live.display.max_refresh_hz`);
      if (most < 120) inconclusive(`this Mac's display runs at most ${most} Hz; the 120 Hz half needs a ProMotion display (the reference Mac's)`);
      problems.push(...pacingProblems(hz, framesOf(live, `${hz} Hz`), num(live['wakeups'], `${hz} Hz: live.wakeups`), watchMs));
    }
    if (problems.length) {
      const why = referenceMacProblem() ?? loadProblem();
      if (why) inconclusive(`the pacing missed on a machine whose timing doesn't count (${why})`, problems);
    }
    expect(problems, 'predicted against measured presentation').toEqual([]);
  }, 600_000);

  it('#140.81e434c9 (C2) the still figure, once settled in the app\'s window, schedules zero wakeups and presents no frame over 10 s', () => {
    const bin = builds.bin(DEEP_SHOW);
    const scenario = showScenario(dir(), FIGURE(), 'fig', { live: { watch_from: 'settled', watch_ms: 10_000 } });
    const { live } = liveRun(bin, scenario);
    const frames = arr(live['frames'], 'still: live.frames');
    const wakeups = num(live['wakeups'], 'still: live.wakeups');
    expect({ wakeups, frames: frames.length }, 'the still scene over 10 s after it settled (Frame clock: "Idle: 0 frames and 0 wakeups")').toEqual({ wakeups: 0, frames: 0 });
  }, 600_000);
});
