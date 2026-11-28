// #3370's blind redraft of tests/acceptance/854/redraft-3300/idle.test.ts (README in this folder): every test of that
// file, its name and IDs unchanged, and every assertion as written. One change: before it reads a run, a measured test
// asks the lane's judge whether the window was shown throughout every run (helpers.ts `requireShownWindow`), and when it
// wasn't (a locked screen, a sleeping display, a covered or hidden window: `deep-show live` answering `no_display`) the
// test skips as INCONCLUSIVE with the judge's reason, never failing on `opened_frames` and never passing on frames a
// window that wasn't shown couldn't draw. One test added: made-up readings whose windows weren't shown read INCONCLUSIVE
// that way, and their shown twin reads on.
//
// #854.022ea575: A still document draws 0 frames and makes at most 1 wakeup a minute over 60 s, under 0.1% of a
// core; a planted clock that arms a frame each vsync fails, naming the frames it drew.
//
// The perf-lane task `canvas-idle` (`node benchmarks/canvas.mjs idle`) opens a window showing a still fixture
// document, on a release build and the real clock, and for 60 s a run reads from the window's process the frames
// it drew, its wakeups and its CPU time (README: The surface under test). Five runs after warm-up. Frames drawn
// are a count, judged on any machine; wakeups and CPU are judged by the design's rule on a reference Mac only.
// The planted clock is `--planted arms_each_vsync`. The wrong programs: the base (no task); a clock that arms a
// frame each vsync; a run shorter than 60 s or on a virtual clock; a judge that never fails, or fails without
// naming the frames drawn; a test that fails, or passes, a reading whose window was never shown.
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IDLE_SECONDS, REPO, RUNS, TASKS, arr, commonRuns, int, judgeWithin, judged, laneVerdict, mentions, num, obj, record, referenceMacProblem,
  requireMac, requireShownWindow, str, synthetic, targetOf, LOAD_AT_REST, SHOWN, type JsonObject, type Recorded, type Skipper,
} from './helpers.ts';

const ID = '#854.022ea575';
const RELEASE = '#854.926cdce7';
const TASK = TASKS.idle;

interface Run { opened: number; seconds: number; frames: number; drawn: { frame: number; at_ms: number }[]; wakeups: number; cpu_ms: number; cpu_fraction: number }

function runsOf(ctx: Skipper, report: JsonObject, what: string): Run[] {
  const runs = commonRuns(report, what);
  expect(report['seconds'], `${what}: each run watches the still document for 60 s`).toBe(IDLE_SECONDS);
  const fixture = str(report['fixture'], `${what}: fixture`);
  expect(existsSync(isAbsolute(fixture) ? fixture : join(REPO, fixture)), `${what}: the still document is a fixture file in the checkout: ${fixture}`).toBe(true);
  requireShownWindow(ctx, report, what);
  return runs.map((run, r) => {
    const at = `${what}: run ${r + 1}`;
    const out: Run = {
      opened: int(run['opened_frames'], `${at}: opened_frames`), seconds: num(run['seconds'], `${at}: seconds`), frames: int(run['frames'], `${at}: frames`),
      drawn: arr(run['drawn'], `${at}: drawn`).map((d, k) => { const o = obj(d, `${at}: drawn[${k}]`); return { frame: int(o['frame'], `${at}: drawn[${k}].frame`), at_ms: num(o['at_ms'], `${at}: drawn[${k}].at_ms`) }; }),
      wakeups: int(run['wakeups'], `${at}: wakeups`), cpu_ms: num(run['cpu_ms'], `${at}: cpu_ms`), cpu_fraction: num(run['cpu_fraction'], `${at}: cpu_fraction`),
    };
    expect(out.opened, `${at}: the window drew the document when it opened, before the still minute`).toBeGreaterThanOrEqual(1);
    expect(out.seconds, `${at}: the window was watched for at least 60 s`).toBeGreaterThanOrEqual(IDLE_SECONDS);
    expect(out.drawn.length, `${at}: drawn lists every frame drawn`).toBe(out.frames);
    expect(out.drawn.every((d) => d.at_ms >= 0 && d.at_ms <= out.seconds * 1000), `${at}: each frame drawn is timed within the run`).toBe(true);
    expect(out.cpu_ms, `${at}: cpu_ms is CPU time read from the process`).toBeGreaterThanOrEqual(0);
    expect(out.cpu_fraction, `${at}: cpu_fraction is cpu_ms over the run's ${out.seconds} s`).toBeCloseTo(out.cpu_ms / (out.seconds * 1000), 6);
    return out;
  });
}

let shipped: Recorded | undefined;
let planted: Recorded | undefined;
const shippedRuns = (ctx: Skipper): Run[] => runsOf(ctx, (shipped ??= record('idle')).report, TASK.id);
const plantedRuns = (ctx: Skipper): Run[] => runsOf(ctx, (planted ??= record('idle', true)).report, `${TASK.id} --planted ${TASK.planted}`);

/** Whether `reason` names, for the first run, how many frames it drew and the first of them. */
function namesFrames(reason: string, run: Run): boolean {
  return mentions(reason, run.frames) && RegExp(`frame\\s*${run.drawn[0]!.frame}(?!\\d)`).test(reason);
}

describe(`${ID} a still document draws 0 frames and makes at most 1 wakeup a minute over 60 s, under 0.1% of a core; a planted clock that arms a frame each vsync fails, naming the frames it drew`, () => {
  it(`${ID} ${RELEASE} on a release build and the real clock, the task watches a window showing a still document for 60 s a run, five runs, reading frames drawn, wakeups and CPU from the process, and the window draws 0 frames in every run`, (ctx) => {
    requireMac(ctx);
    const runs = shippedRuns(ctx);
    expect(shipped!.ms, 'five runs of 60 s on the real clock take at least five minutes').toBeGreaterThanOrEqual(RUNS * IDLE_SECONDS * 1000);
    runs.forEach((run, r) => expect(run.frames, `run ${r + 1}: a still document draws 0 frames (it drew ${run.drawn.slice(0, 5).map((d) => `frame ${d.frame} at ${d.at_ms} ms`).join(', ')})`).toBe(0));
    console.log(`${ID} wakeups ${runs.map((r) => r.wakeups).join(', ')}; CPU ${runs.map((r) => `${(r.cpu_fraction * 100).toFixed(4)}%`).join(', ')}`);
  }, 3_600_000);

  it(`${ID} on the reference Mac every run makes at most 1 wakeup in its minute and uses under 0.1% of a core, and the lane's judge passes the task on those same runs`, (ctx) => {
    const problem = referenceMacProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const runs = shippedRuns(ctx);
    judgeWithin(ctx, `${TASK.id} wakeups`, runs.map((r) => r.wakeups), TASK.targets.wakeups);
    judgeWithin(ctx, `${TASK.id} CPU, a fraction of a core`, runs.map((r) => r.cpu_fraction), TASK.targets.cpu_fraction);
    const verdict = judged(shipped!.report);
    for (const [name, pick] of [['frames', (r: Run) => r.frames], ['wakeups', (r: Run) => r.wakeups], ['cpu_fraction', (r: Run) => r.cpu_fraction]] as const) {
      const target = targetOf(verdict, name);
      expect(target.limit, `the judge holds ${name} to the issue's number`).toBe(TASK.targets[name]);
      target.runs.forEach((v, i) => expect(v, `the judge judges run ${i + 1}'s ${name}`).toBeCloseTo(pick(runs[i]!), 6));
    }
    laneVerdict(ctx, verdict, 'PASS');
  }, 3_600_000);

  it(`${ID} a planted clock that arms a frame each vsync draws at least one frame a second of the still minute, and the lane fails it on any machine, naming the frames it drew`, (ctx) => {
    requireMac(ctx);
    const runs = plantedRuns(ctx);
    runs.forEach((run, r) => expect(run.frames, `run ${r + 1}: a frame each vsync draws at least 60 frames in the minute`).toBeGreaterThanOrEqual(IDLE_SECONDS));
    const verdict = judged(planted!.report);
    expect(verdict['status'], `the lane fails the planted clock: ${JSON.stringify(verdict).slice(0, 2000)}`).toBe('FAIL');
    expect(targetOf(verdict, 'frames').status, 'on the frames drawn').toBe('FAIL');
    const reason = str(verdict['reason'], 'verdict.reason');
    expect(namesFrames(reason, runs[0]!), `the failure names the frames drawn: run 1's ${runs[0]!.frames}, from frame ${runs[0]!.drawn[0]!.frame}: ${reason.slice(0, 1500)}`).toBe(true);
  }, 3_600_000);

  it(`${ID} the lane's judge fails a reading that drew frames while still, naming them, and passes its twin that drew none`, () => {
    const within = judged(synthetic('idle'));
    expect(within['status'], `a reading within every target on a reference Mac passes: ${JSON.stringify(within).slice(0, 1500)}`).toBe('PASS');
    const report = synthetic('idle');
    const drew = { opened_frames: 1, seconds: 60.01, frames: 3, drawn: [{ frame: 1207, at_ms: 20_000 }, { frame: 1208, at_ms: 40_000 }, { frame: 1209, at_ms: 59_000 }], wakeups: 3, cpu_ms: 9, cpu_fraction: 9 / 60_010, window: { ...SHOWN }, loadStart: LOAD_AT_REST, loadEnd: LOAD_AT_REST };
    report['runs'] = Array.from({ length: 5 }, () => drew);
    const verdict = judged(report);
    expect(verdict['status'], `three frames in a still minute fail: ${JSON.stringify(verdict).slice(0, 1500)}`).toBe('FAIL');
    expect(targetOf(verdict, 'frames').status, 'on the frames drawn').toBe('FAIL');
    const reason = str(verdict['reason'], 'verdict.reason');
    expect(namesFrames(reason, { opened: 1, seconds: 60.01, frames: 3, drawn: drew.drawn, wakeups: 3, cpu_ms: 9, cpu_fraction: 9 / 60_010 }), `the failure names the 3 frames, from frame 1207: ${reason.slice(0, 1500)}`).toBe(true);
  }, 600_000);

  it(`${ID} a reading whose window AppKit never showed reads INCONCLUSIVE with the judge's reason, not a failure on the frames drawn when it opened, and its twin with the window shown is read on`, () => {
    class Skipped extends Error {}
    const skipper: Skipper = { skip: (note: string): never => { throw new Skipped(note); } };
    /** The INCONCLUSIVE note the measured tests' reading of `report` skips with, or null when it reads the runs on. */
    const skipNote = (report: JsonObject): string | null => {
      try {
        runsOf(skipper, report, 'made-up');
        return null;
      } catch (e) {
        if (e instanceof Skipped) return e.message;
        throw e;
      }
    };
    // As canvas.mjs records a run deep-show answered `no_display` for: no frame, what the process did through deep-show's
    // 10 s wait for a first frame, and the window AppKit held instead; a run with no `window` the judge reads as headless.
    const headless = { ...synthetic('idle'), runs: Array.from({ length: RUNS }, () => ({ opened_frames: 0, frames: 0, drawn: [], seconds: 10.02, wakeups: 0, cpu_ms: 3, cpu_fraction: 3 / 10_020, request_frames: 0, loadStart: LOAD_AT_REST, loadEnd: LOAD_AT_REST })) };
    const hidden = { ...synthetic('idle'), runs: Array.from({ length: RUNS }, () => ({ opened_frames: 0, frames: 0, drawn: [], seconds: 10.02, wakeups: 0, cpu_ms: 3, cpu_fraction: 3 / 10_020, request_frames: 0, window: { state: 'hidden', shown_ms: 0 }, loadStart: LOAD_AT_REST, loadEnd: LOAD_AT_REST })) };
    const shownRuns = arr(synthetic('idle')['runs'], 'the shown twin\'s runs');
    const mixed = { ...synthetic('idle'), runs: shownRuns.map((run, i) => (i === 2 ? { opened_frames: 0, frames: 0, drawn: [], seconds: 10.02, wakeups: 0, cpu_ms: 3, cpu_fraction: 3 / 10_020, request_frames: 0, window: { state: 'covered', shown_ms: 0 }, loadStart: LOAD_AT_REST, loadEnd: LOAD_AT_REST } : run)) };

    for (const [name, report, states] of [['headless', headless, Array(RUNS).fill('headless')], ['hidden', hidden, Array(RUNS).fill('hidden')], ['one covered run', mixed, [null, null, 'covered', null, null]]] as const) {
      const note = skipNote(report);
      expect(note, `${name}: a reading whose window wasn't shown in every run skips, never read as a failure or a pass`).not.toBeNull();
      expect(note!, `${name}: the skip says INCONCLUSIVE`).toMatch(/^INCONCLUSIVE\b/);
      const judgesReason = str(obj(judged(report)['window'], `${name}: verdict.window`)['reason'], `${name}: verdict.window.reason`);
      expect(note!, `${name}: the skip gives the judge's own reason, ${judgesReason}`).toContain(`window: ${judgesReason}`);
      states.forEach((state, r) => {
        if (state) expect(note!, `${name}: it names run ${r + 1}'s window, ${state}`).toContain(`run ${r + 1}: ${state}`);
        else expect(note!, `${name}: it doesn't name run ${r + 1}, whose window was shown`).not.toMatch(RegExp(`run ${r + 1}:`));
      });
    }
    const twin = runsOf(skipper, synthetic('idle'), 'the shown twin');
    expect(twin.map((run) => run.opened), 'the shown twin is read on: every run drew the document when it opened').toEqual(Array(RUNS).fill(1));
  }, 600_000);
});
