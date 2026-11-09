// Criteria 1, 2 and 4 of #1551 in the app's real, shown window (`deep-show live`, README: The `live` options).
//
// C1 #1551.529faaf6: a shown window holding a still document for 60 s runs 0 request-frame callbacks; the merge base
//   reads at least 3,000 at 60 Hz; a planted link that never stops (`link_never_stops`) fails, naming the count.
// C2 #1551.d7b41417: from that idle state, a hub event, a `notify` from another thread and a present-only request
//   each reach the screen within 2 frames; a planted waker that ignores `schedule_frame`
//   (`waker_ignores_schedule_frame`) fails, naming the request.
// C4 #1551.76b01721: input from idle shows within #404's 2 frames, compared with the merge base; a link that needs a
//   full extra refresh to restart (`link_restarts_a_refresh_late`) fails, naming the frames.
//
// One shipped run serves all three: the still minute watched from the moment the window settles, then the wakes, each
// from idle. The merge base is read through `DEEP_1551_BASE_BIN` (README: The merge base). Timings off a fit
// reference Mac, or on a loaded machine, read INCONCLUSIVE, never PASS; so does a window that wasn't shown.
import { describe, expect, it } from 'vitest';
import {
  BASE_LEAST, C1, C2, C4, FRAMES, STILL_MS, arr, hubEvent, inconclusive, int, liveRun, liveScenario, mentions, num, obj, percentile,
  requireShown, str, timingProblem, useDeepShow, type JsonObject,
} from './helpers.ts';

const deepShow = useDeepShow();

// ---------------------------------------------------------------------------------------------------
// The wakes (README: `live.wake`), each at least a second after the one before, so the window is idle again.

const KINDS = ['hub_event', 'thread_notify', 'present_only'] as const;
const ROUNDS = 3;
/** C2's nine wakes from `from` ms after the window settled: the three kinds in turn, 1.5 s apart. */
function requestWakes(from: number): JsonObject[] {
  return Array.from({ length: KINDS.length * ROUNDS }, (_, i) => {
    const by = KINDS[i % KINDS.length]!;
    return { after_ms: from + 1_500 * i, by, ...(by === 'hub_event' ? { call: hubEvent(i) } : {}) };
  });
}
/** #404's test inputs at seeded times: 20 inputs from `from`, one a second, each at a seeded offset within a 60 Hz frame. */
const INPUTS = 20;
function inputWakes(from: number): JsonObject[] {
  let seed = 1551;
  const next = (): number => { seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31; return seed; };
  return Array.from({ length: INPUTS }, (_, k) => ({ after_ms: from + 1_000 * k + (next() % 17), by: 'input' }));
}

interface Wake { after_ms: number; by: string; requested_ns: number; before: number; frame_seq: number | null; presented_ns: number | null; refresh_ns: number }

/** The run's `live.wakes`, one per asked wake, in order. */
function wakesOf(live: JsonObject, asked: JsonObject[], what: string): Wake[] {
  const wakes = arr(live['wakes'], `${what}: live.wakes`).map((v, i): Wake => {
    const w = obj(v, `${what}: wakes[${i}]`);
    const at = `${what}: wakes[${i}]`;
    const nullable = (x: JsonObject[string], name: string): number | null => (x === null ? null : num(x, `${at}.${name}`));
    return {
      after_ms: num(w['after_ms'], `${at}.after_ms`), by: str(w['by'], `${at}.by`), requested_ns: num(w['requested_ns'], `${at}.requested_ns`),
      before: int(w['request_frames_before'], `${at}.request_frames_before`), frame_seq: nullable(w['frame_seq'] ?? null, 'frame_seq'),
      presented_ns: nullable(w['presented_ns'] ?? null, 'presented_ns'), refresh_ns: num(w['refresh_ns'], `${at}.refresh_ns`),
    };
  });
  expect(wakes.map((w) => [w.after_ms, w.by]), `${what}: one wake answered for each asked, in order`).toEqual(asked.map((a) => [a['after_ms'], a['by']]));
  return wakes;
}

/** How many frames after the request its frame presented; Infinity for a request no frame answered. */
const framesAfter = (w: Wake): number => (w.presented_ns === null ? Infinity : (w.presented_ns - w.requested_ns) / w.refresh_ns);
const named = (w: Wake): string => `${w.by} at ${w.after_ms} ms`;

/** Wakes the window wasn't idle for: its link ran request-frame callbacks in the 500 ms before the request. */
const notIdle = (wakes: Wake[]): string[] =>
  wakes.filter((w) => w.before > 0).map((w) => `${named(w)}: the window wasn't idle, it ran ${w.before} request-frame callbacks in the 500 ms before`);

/** Requests that didn't reach the screen within 2 frames, each named with its frame. */
function late(wakes: Wake[]): string[] {
  return wakes.flatMap((w) => {
    if (w.presented_ns === null) return [`${named(w)}: no frame answering it was presented`];
    if (w.presented_ns <= w.requested_ns) return [`${named(w)}: frame ${w.frame_seq} presented at ${w.presented_ns} ns, before the request at ${w.requested_ns} ns`];
    const f = framesAfter(w);
    return f > FRAMES ? [`${named(w)}: frame ${w.frame_seq} presented ${f.toFixed(2)} frames (${((w.presented_ns - w.requested_ns) / 1e6).toFixed(2)} ms) after the request`] : [];
  });
}

/** Input from idle against #404's 2 frames: the p95 in frames, and a sentence naming the late frames when over. */
function inputReading(wakes: Wake[]): { p95: number; problem: string | null } {
  const inputs = wakes.filter((w) => w.by === 'input');
  const p95 = percentile(inputs.map(framesAfter), 0.95);
  if (p95 <= FRAMES) return { p95, problem: null };
  const over = inputs.filter((w) => framesAfter(w) > FRAMES).map((w) => `input at ${w.after_ms} ms: ${w.frame_seq === null ? 'no frame' : `frame ${w.frame_seq} after ${framesAfter(w).toFixed(2)} frames`}`);
  return { p95, problem: `input from idle shows at p95 ${p95.toFixed(2)} frames, past ${FRAMES}: ${over.join('; ')}` };
}

/** The still minute: a sentence naming the request-frame callbacks it ran, or null for none. */
function stillProblem(live: JsonObject, what: string): string | null {
  const n = int(live['request_frames'], `${what}: live.request_frames`);
  return n === 0 ? null : `the still window ran ${n} request-frame callbacks in ${STILL_MS / 1000} s`;
}

// ---------------------------------------------------------------------------------------------------
// The runs, each at most once per file.

const SHIPPED_WAKES = [...requestWakes(STILL_MS + 1_000), ...inputWakes(STILL_MS + 1_000 + 1_500 * KINDS.length * ROUNDS + 1_000)];
const SHIPPED_LIVE: JsonObject = { watch_from: 'settled', watch_ms: STILL_MS, wake: SHIPPED_WAKES };
let shipped: JsonObject | undefined;
const shippedRun = (): JsonObject => (shipped ??= liveRun(deepShow(), liveScenario(SHIPPED_LIVE)));

const refreshHz = (live: JsonObject, what: string): number => num(obj(live['display'], `${what}: live.display`)['refresh_hz'], `${what}: live.display.refresh_hz`);

describe(`${C1} a shown window holding a still document for 60 s runs 0 request-frame callbacks; a planted link that never stops fails, naming the count`, () => {
  it(`${C1} the still board, once settled in the app's shown window, runs 0 request-frame callbacks over 60 s`, () => {
    const live = shippedRun();
    requireShown(live, 'shipped');
    console.log(`${C1} request_frames ${String(live['request_frames'])} at ${refreshHz(live, 'shipped')} Hz`);
    expect(stillProblem(live, 'shipped'), 'request-frame callbacks over the still minute').toBeNull();
  }, 1_800_000);

  it(`${C1} planted link_never_stops: the still window runs at least 3,000 request-frame callbacks in the minute, and the check fails it, naming the count`, () => {
    const live = liveRun(deepShow(), liveScenario({ watch_from: 'settled', watch_ms: STILL_MS }, 'link_never_stops'));
    requireShown(live, 'link_never_stops');
    const n = int(live['request_frames'], 'link_never_stops: live.request_frames');
    expect(n, `a link that never stops runs a callback each refresh: at least ${BASE_LEAST} in a minute at ${refreshHz(live, 'link_never_stops')} Hz`).toBeGreaterThanOrEqual(BASE_LEAST);
    const problem = stillProblem(live, 'link_never_stops');
    expect(problem !== null && mentions(problem, n), `the check fails the planted link, naming its ${n} callbacks: ${problem}`).toBe(true);
  }, 1_800_000);
});

describe(`${C2} from idle, a hub event, a notify from another thread and a present-only request each reach the screen within 2 frames; a planted waker that ignores schedule_frame fails, naming the request`, () => {
  it(`${C2} after the still minute, each of the three requests, three times each and each from idle, presents its frame within 2 frames`, () => {
    const live = shippedRun();
    requireShown(live, 'shipped');
    const wakes = wakesOf(live, SHIPPED_WAKES, 'shipped').filter((w) => w.by !== 'input');
    expect(notIdle(wakes), 'each request comes to an idle window, its link stopped').toEqual([]);
    const problems = late(wakes);
    console.log(`${C2} ${wakes.map((w) => `${named(w)}: ${framesAfter(w).toFixed(2)} frames`).join('; ')}`);
    if (problems.length && timingProblem()) inconclusive(`a request missed 2 frames on a machine whose timing doesn't count (${timingProblem()})`, problems);
    expect(problems, 'requests from idle against 2 frames').toEqual([]);
  }, 1_800_000);

  it(`${C2} planted waker_ignores_schedule_frame: a request from idle misses 2 frames, and the check fails it, naming the request`, () => {
    const asked = requestWakes(1_000);
    const live = liveRun(deepShow(), liveScenario({ wake: asked }, 'waker_ignores_schedule_frame'));
    requireShown(live, 'waker_ignores_schedule_frame');
    const wakes = wakesOf(live, asked, 'waker_ignores_schedule_frame');
    expect(notIdle(wakes), 'each request comes to an idle window, its link stopped').toEqual([]);
    const problems = late(wakes);
    console.log(`${C2} planted: ${problems.join('; ') || 'every request within 2 frames'}`);
    if (!problems.length && timingProblem()) inconclusive(`the planted waker stayed within 2 frames on a machine whose timing doesn't count (${timingProblem()})`);
    expect(problems.length, 'the check fails the planted waker on at least one request').toBeGreaterThan(0);
    for (const p of problems) expect(KINDS.some((k) => p.startsWith(`${k} at `)), `the failure names the request: ${p}`).toBe(true);
  }, 1_800_000);
});

describe(`${C4} input from idle shows within #404's 2 frames, compared with the merge base; a link that needs a full extra refresh to restart fails, naming the frames`, () => {
  it(`${C4} 20 inputs at seeded times, each from idle, show at p95 within 2 frames of the display's rate`, () => {
    const live = shippedRun();
    requireShown(live, 'shipped');
    const wakes = wakesOf(live, SHIPPED_WAKES, 'shipped').filter((w) => w.by === 'input');
    expect(notIdle(wakes), 'each input comes to an idle window, its link stopped').toEqual([]);
    const { p95, problem } = inputReading(wakes);
    console.log(`${C4} input from idle: p95 ${p95.toFixed(2)} frames at ${refreshHz(live, 'shipped')} Hz`);
    if (problem && timingProblem()) inconclusive(`input missed 2 frames on a machine whose timing doesn't count (${timingProblem()})`, [problem]);
    expect(problem, 'input from idle against 2 frames').toBeNull();
  }, 1_800_000);

  it(`${C4} planted link_restarts_a_refresh_late: input from idle reads past 2 frames, and the check fails it, naming the frames`, () => {
    const asked = inputWakes(1_000);
    const live = liveRun(deepShow(), liveScenario({ wake: asked }, 'link_restarts_a_refresh_late'));
    requireShown(live, 'link_restarts_a_refresh_late');
    const wakes = wakesOf(live, asked, 'link_restarts_a_refresh_late');
    expect(notIdle(wakes), 'each input comes to an idle window, its link stopped').toEqual([]);
    const { p95, problem } = inputReading(wakes);
    console.log(`${C4} planted: p95 ${p95.toFixed(2)} frames; ${problem ?? 'within 2 frames'}`);
    if (!problem && timingProblem()) inconclusive(`the planted link stayed within 2 frames on a machine whose timing doesn't count (${timingProblem()})`);
    expect(problem, 'the check fails the planted link').not.toBeNull();
    const lateInputs = wakes.filter((w) => w.frame_seq !== null && framesAfter(w) > FRAMES);
    expect(lateInputs.length > 0 && lateInputs.every((w) => problem!.includes(`frame ${w.frame_seq} after`)), `the failure names each late frame: ${problem}`).toBe(true);
  }, 1_800_000);
});

describe(`${C1} ${C4} the merge base, read through DEEP_1551_BASE_BIN`, () => {
  it(`${C1} ${C4} the merge base's still window runs at least 3,000 request-frame callbacks in the minute, and its input from idle is read beside the change's`, () => {
    const base = process.env['DEEP_1551_BASE_BIN'];
    if (!base) inconclusive('DEEP_1551_BASE_BIN is unset: it names a deep-show built from the merge base with only the measuring surfaces (README: The merge base)');
    const live = liveRun(base, liveScenario(SHIPPED_LIVE));
    requireShown(live, 'merge base');
    const n = int(live['request_frames'], 'merge base: live.request_frames');
    const baseInput = inputReading(wakesOf(live, SHIPPED_WAKES, 'merge base').filter((w) => w.by === 'input'));
    const changeInput = inputReading(wakesOf(shippedRun(), SHIPPED_WAKES, 'shipped').filter((w) => w.by === 'input'));
    console.log(`${C1} merge base: request_frames ${n} at ${refreshHz(live, 'merge base')} Hz; change: ${String(shippedRun()['request_frames'])}`);
    console.log(`${C4} input from idle, p95: merge base ${baseInput.p95.toFixed(2)} frames, change ${changeInput.p95.toFixed(2)} frames`);
    expect(n, `the merge base's link runs a callback each refresh while the window is still: at least ${BASE_LEAST}`).toBeGreaterThanOrEqual(BASE_LEAST);
  }, 1_800_000);
});
