// C3 #1551.5ed5fd2b: `canvas-idle` reads a shown window, and reads INCONCLUSIVE when it's hidden, covered or the
// display is asleep. A headless reading can't PASS the lane.
//
// The lane is the perf lane's task (`node benchmarks/canvas.mjs idle`, its report the last stdout line) and its judge
// (`node benchmarks/canvas.mjs judge`, `{"current": report, "base": null}` on stdin). Each run of the report says
// what the window was through the run (README: canvas-idle). The judge's `window` entry holds the lane to a shown
// window: a run hidden, covered or on a sleeping display is INCONCLUSIVE, naming the run and its state, and a run
// with no window reading (headless, as the merge base's) can't PASS. The wrong programs: the merge base (headless,
// no window reading, no `window` in the verdict); a judge that ignores the window; a lane that reports a shown
// window it didn't read.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { C3, REPO, STILL_MS, arr, clone, inconclusive, int, num, obj, str, type JsonObject, type JsonValue } from './helpers.ts';

const BENCH = join(REPO, 'benchmarks', 'canvas.mjs');
const TASK = 'canvas-idle';
const STATES = ['hidden', 'covered', 'display_asleep'] as const;

/** The last stdout line of a node run of canvas.mjs, as JSON. */
function lastLine(args: string[], input: string | undefined, what: string): JsonObject {
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const r = spawnSync(process.execPath, [BENCH, ...args], { cwd: REPO, encoding: 'utf8', timeout: 3_600_000, killSignal: 'SIGKILL', maxBuffer: 512 * 1024 * 1024, ...(input === undefined ? {} : { input }) });
  expect(r.error, `${what} ran: ${r.error?.message}`).toBeUndefined();
  expect(r.status, `${what} exits 0; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l.trim() !== '');
  let last: JsonValue = null;
  try { last = lines.length ? (JSON.parse(lines.at(-1)!) as JsonValue) : null; } catch { last = null; }
  return obj(last ?? undefined, `${what}: its last stdout line`);
}
const judged = (report: JsonObject): JsonObject => lastLine(['judge'], `${JSON.stringify({ current: report, base: null })}\n`, 'canvas.mjs judge');

/** The verdict's `window` entry (README): its status, each run's state, and its reason. */
function windowOf(verdict: JsonObject): { status: string; runs: string[]; reason: string } {
  const w = obj(verdict['window'], `the verdict's window entry: ${JSON.stringify(verdict).slice(0, 1500)}`);
  return { status: str(w['status'], 'window.status'), runs: arr(w['runs'], 'window.runs').map((s, i) => str(s, `window.runs[${i}]`)), reason: typeof w['reason'] === 'string' ? w['reason'] : '' };
}

/** A reading within every target, on a reference Mac's fingerprint and a release build, each run's window shown throughout. */
function shownReading(): JsonObject {
  const run = { opened_frames: 1, seconds: 60.01, frames: 0, drawn: [], wakeups: 0, cpu_ms: 6, cpu_fraction: 6 / 60_010, request_frames: 0, window: { state: 'shown', shown_ms: 60_010 } };
  return {
    task: TASK,
    fingerprint: { model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30, power: 'ac', lowPowerMode: false, thermalState: 'nominal', macosBuild: '25G241', build: { profile: 'release', toolchain: 'rustc 1.99.1 (58cf8f9c3 2026-10-13)' } },
    fixture: 'benchmarks/canvas/still.json', seconds: 60, runs: Array.from({ length: 5 }, () => clone(run)),
  };
}
const runAt = (report: JsonObject, i: number): JsonObject => obj(arr(report['runs'], 'runs')[i], `runs[${i}]`);

describe(`${C3} canvas-idle reads a shown window, and reads INCONCLUSIVE when it's hidden, covered or the display is asleep; a headless reading can't PASS the lane`, () => {
  it(`${C3} the lane's judge takes a reading whose every run was shown as a shown window, and reads INCONCLUSIVE when run 3 was hidden, covered or on a sleeping display, naming the run and its state`, () => {
    const twin = windowOf(judged(shownReading()));
    expect(twin, 'five runs shown throughout: the window entry passes').toMatchObject({ status: 'PASS', runs: ['shown', 'shown', 'shown', 'shown', 'shown'] });
    for (const state of STATES) {
      const report = shownReading();
      runAt(report, 2)['window'] = { state, shown_ms: 21_500 };
      const verdict = judged(report);
      const w = windowOf(verdict);
      expect(verdict['status'], `a reading with run 3 ${state} reads INCONCLUSIVE: ${JSON.stringify(verdict).slice(0, 1500)}`).toBe('INCONCLUSIVE');
      expect(w.status, `the window entry, run 3 ${state}`).toBe('INCONCLUSIVE');
      expect(w.runs, `each run's state, run 3 ${state}`).toEqual(['shown', 'shown', state, 'shown', 'shown']);
      expect(/\brun 3\b/.test(w.reason) && w.reason.includes(state), `the reason names run 3 and "${state}": ${w.reason}`).toBe(true);
    }
  }, 600_000);

  it(`${C3} a headless reading, the merge base's shape with no window reading, can't PASS the lane`, () => {
    const report = shownReading();
    for (let i = 0; i < 5; i++) { const run = runAt(report, i); delete run['window']; delete run['request_frames']; }
    const verdict = judged(report);
    const w = windowOf(verdict);
    expect(verdict['status'], `a headless reading doesn't pass: ${JSON.stringify(verdict).slice(0, 1500)}`).not.toBe('PASS');
    expect(w.status, 'the window entry of a headless reading').not.toBe('PASS');
    expect(w.runs, 'each run reads headless').toEqual(['headless', 'headless', 'headless', 'headless', 'headless']);
  }, 600_000);

  it(`${C3} on this Mac the lane holds the still board in a shown window: every run says the window was shown for its whole run, and the judge takes it as shown`, () => {
    if (process.platform !== 'darwin') inconclusive(`the lane shows its window on macOS; this is ${process.platform}`);
    const report = lastLine(['idle'], undefined, 'node benchmarks/canvas.mjs idle');
    expect(report['task'], 'the report names its task').toBe(TASK);
    const runs = arr(report['runs'], 'runs').map((r, i) => obj(r, `runs[${i}]`));
    expect(runs.length, 'five runs after warm-up').toBe(5);
    const states = runs.map((r, i) => {
      const w = obj(r['window'], `run ${i + 1}: window`);
      return { state: str(w['state'], `run ${i + 1}: window.state`), shown_ms: num(w['shown_ms'], `run ${i + 1}: window.shown_ms`), seconds: num(r['seconds'], `run ${i + 1}: seconds`), request_frames: int(r['request_frames'], `run ${i + 1}: request_frames`) };
    });
    console.log(`${C3} ${states.map((s, i) => `run ${i + 1}: ${s.state} ${s.shown_ms} ms of ${s.seconds} s, ${s.request_frames} request-frame callbacks`).join('; ')}`);
    const verdict = judged(report);
    const w = windowOf(verdict);
    expect(w.runs, 'the judge reads each run\'s state from the report').toEqual(states.map((s) => s.state));
    if (states.some((s) => s.state !== 'shown')) {
      expect(verdict['status'], `a run not shown reads INCONCLUSIVE: ${JSON.stringify(verdict).slice(0, 1500)}`).toBe('INCONCLUSIVE');
      inconclusive(`a run's window wasn't shown throughout (${w.reason}), so this run of the lane says nothing of a shown window`);
    }
    for (const [i, s] of states.entries()) expect(s.shown_ms, `run ${i + 1}: shown for its whole still minute`).toBeGreaterThanOrEqual(STILL_MS);
    expect(w.status, 'five runs shown: the window entry passes').toBe('PASS');
  }, 3_600_000);
});
