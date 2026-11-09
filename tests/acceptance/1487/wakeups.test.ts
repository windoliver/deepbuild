// AC1, frames and wakeups on the real clock: a window shows the spinner board panned to the card, the spinner
// turning out of view, for 5 s of real time; it draws 0 frames and makes 0 wakeups. #854's `deep-canvas-render
// idle`, with the view's rect added. A warm-up run, then five runs, in one process. Frames drawn are a count,
// judged on any Mac (the window needs Metal; elsewhere INCONCLUSIVE). Wakeups are judged only on a reference
// Mac (Mac15,7 / Apple M3 Pro / 36 GiB or Mac15,12 / Apple M3 / 16 GiB); elsewhere they are recorded and the
// test skips as INCONCLUSIVE, never passing. The wrong programs: the base (it draws a frame per vsync) and the
// planted `valid_until_ignores_view`.
import { describe, expect, it, type TestContext } from 'vitest';
import {
  LOOK, RENDER_BIN, V_CARD, arr, batch, fixture, isObject, machineReading, num, obj, referenceMacProblem, useBinaries,
  type JsonObject, type JsonValue,
} from './helpers.ts';

useBinaries('deep-canvas-render');

const DOC = fixture('spinner.json');
const SECONDS = 5;
const RUNS = 5;

interface Run { opened: number; seconds: number; frames: number; drawn: { frame: number; at_ms: number }[]; wakeups: number }

const recorded = new Map<string, Run[] | string>();

/** A warm-up and five runs of `idle`, or why they couldn't run here (an INCONCLUSIVE reason). Cached per plant. */
function record(planted?: string): Run[] | string {
  const key = planted ?? '';
  const cached = recorded.get(key);
  if (cached !== undefined) return cached;
  let out: Run[] | string;
  if (process.platform !== 'darwin') {
    out = `INCONCLUSIVE: the window draws with GPUI's offscreen Metal renderer, macOS only; this is ${process.platform}`;
  } else {
    const line: JsonObject = { doc: DOC, look: LOOK, view: { zoom: 1, theme: 'light', rect: V_CARD }, seconds: SECONDS, ...(planted ? { planted } : {}) };
    const answers = batch(RENDER_BIN, ['idle'], Array.from({ length: RUNS + 1 }, (): JsonValue => line), 300_000);
    const first = answers[0];
    if (isObject(first) && first['ok'] === false && first['code'] === 'unsupported_platform') {
      out = 'INCONCLUSIVE: deep-canvas-render idle reports unsupported_platform';
    } else {
      out = answers.slice(1).map((a, r) => {
        const at = `idle${planted ? ` planted ${planted}` : ''} run ${r + 1}`;
        const o = obj(a, at);
        expect(o['ok'], `${at} refused: ${JSON.stringify(o).slice(0, 1500)}`).toBe(true);
        return {
          opened: num(o['opened_frames'], `${at}: opened_frames`), seconds: num(o['seconds'], `${at}: seconds`), frames: num(o['frames'], `${at}: frames`),
          drawn: arr(o['drawn'], `${at}: drawn`).map((d, k) => { const x = obj(d, `${at}: drawn[${k}]`); return { frame: num(x['frame'], 'frame'), at_ms: num(x['at_ms'], 'at_ms') }; }),
          wakeups: num(o['wakeups'], `${at}: wakeups`),
        };
      });
    }
  }
  recorded.set(key, out);
  return out;
}

function runsOrSkip(ctx: TestContext, planted?: string): Run[] {
  const runs = record(planted);
  if (typeof runs === 'string') ctx.skip(runs);
  return runs as Run[];
}

/** Null when no run drew a frame after opening, else a sentence naming each failing run's frames. */
function framesFailure(runs: readonly Run[]): string | null {
  const bad = runs.map((r, i) => ({ r, i })).filter(({ r }) => r.frames > 0);
  if (bad.length === 0) return null;
  return bad.map(({ r, i }) => `run ${i + 1} drew ${r.frames} frames (${r.drawn.slice(0, 3).map((d) => `frame ${d.frame} at ${d.at_ms.toFixed(1)} ms`).join(', ')})`).join('; ');
}

function checkShape(runs: readonly Run[]): void {
  expect(runs.length, 'five runs after the warm-up').toBe(RUNS);
  runs.forEach((r, i) => {
    expect(r.opened, `run ${i + 1}: the window drew the board when it opened`).toBeGreaterThanOrEqual(1);
    expect(r.seconds, `run ${i + 1}: the window was watched for at least 5 s of real time`).toBeGreaterThanOrEqual(SECONDS);
    expect(r.drawn.length, `run ${i + 1}: drawn lists every frame drawn`).toBe(r.frames);
  });
}

describe('AC1 a document with one looping rotation panned out of view: 0 frames and 0 wakeups over 5 s on the real clock', () => {
  it('AC1 the window showing the card, the spinner turning out of view, draws 0 frames in each of five 5 s runs', (ctx) => {
    const runs = runsOrSkip(ctx);
    checkShape(runs);
    console.log(`AC1 idle frames ${runs.map((r) => r.frames).join(', ')}; wakeups ${runs.map((r) => r.wakeups).join(', ')}; ${machineReading()}`);
    expect(framesFailure(runs), 'out of view the spinner draws nothing: 0 frames over 5 s (the merge base keeps drawing the turning spinner)').toBeNull();
  }, 600_000);

  it('AC1 on a reference Mac each of the five runs makes 0 wakeups while the spinner turns out of view', (ctx) => {
    const runs = runsOrSkip(ctx);
    checkShape(runs);
    // A wakeup count only means something for a window that drew nothing.
    expect(framesFailure(runs), 'the window drew 0 frames').toBeNull();
    const wakeups = runs.map((r) => r.wakeups);
    const shown = `wakeups ${wakeups.join(', ')} over five ${SECONDS} s runs; ${machineReading()}`;
    console.log(`AC1 ${shown}`);
    const problem = referenceMacProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}; ${shown}`);
    // The design's rule with a limit of 0: PASS when all five are 0, FAIL when all five aren't, else INCONCLUSIVE.
    if (wakeups.every((w) => w === 0)) return;
    expect(wakeups.every((w) => w > 0), `FAIL: ${shown}`).toBe(false);
    ctx.skip(`INCONCLUSIVE: ${shown}`);
  }, 600_000);

  it('AC1 (wrong program) the planted valid_until_ignores_view draws a frame per vsync out of view and fails the frames check, naming the frames each run drew', (ctx) => {
    const runs = runsOrSkip(ctx, 'valid_until_ignores_view');
    checkShape(runs);
    runs.forEach((r, i) => expect(r.frames, `run ${i + 1}: the planted clock keeps drawing the turning spinner`).toBeGreaterThanOrEqual(60));
    const failure = framesFailure(runs);
    expect(failure, 'the frames check fails on the planted clock').not.toBeNull();
    expect(failure!, 'naming run 1\'s count and its first frame').toMatch(new RegExp(`^run 1 drew ${runs[0]!.frames} frames \\(frame ${runs[0]!.drawn[0]?.frame ?? -1} at`));
  }, 600_000);
});
