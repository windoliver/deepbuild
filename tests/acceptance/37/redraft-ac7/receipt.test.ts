// AC7, blind redraft (REDRAFT.md beside this file): "A receipt opens the journey's video within one frame of the
// checked step". The issue's Scope: "Each step's start and end time in the video is kept with the evidence, so a
// receipt opens the video at that step"; the design keeps them as the evidence's `step_times`, which "let the player
// open a video at a check's step". So the receipt for a step names the run's video and a time in it no more than one
// of that video's frames (at most 1000/15 ms, the issue's 15 fps) from where the step starts, as the times kept with
// the video's evidence place it; and those times are the video's own: every step inside the video's frames, each
// hold as long as it really was.
//
// The journey is the cart journey with two holds: a step that waits in the page until 2000 ms have passed since its
// first attempt (a toPass block), before and after the checked step. A hold can't be shorter on any machine, so the
// checked step starts at least 2000 ms into the video and at least 2000 ms after the step before it, and a hold ends
// at least 2000 ms after it starts, however fast or slow the machine is. That is what makes the wrong programs fail
// here: a receipt at 0, at another step's start, at a step's end, or in another clock or unit, and step times that
// aren't the video's (wall-clock, seconds, missing, out of order, past the video's end).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JourneyRun } from '../../../../packages/checks-journey/src/index.ts';
import { assertionFails, checkout, FRAME_MS, isWebm, journey, journeyVariant, openWorld, runOptions, type World } from '../helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

/** How long each hold waits, in the page, from its first attempt. */
const HOLD_MS = 2000;
/** A toPass block that passes once HOLD_MS have passed since its first attempt in this page. */
const hold = (name: string) => ({
  until: true,
  evaluate: `(() => { const k = '__receiptHold_${name}'; globalThis[k] ??= performance.now(); return performance.now() - globalThis[k] >= ${HOLD_MS} ? 'held' : 'holding'; })()`,
  equals: 'held',
});
const STEPS = ['open', 'hold-a', 'see-total', 'hold-b'] as const;
type StepId = (typeof STEPS)[number];
/** The checked step: the expect on the total, between the holds. */
const CHECKED: StepId = 'see-total';

interface Span { step: string; startMs: number; endMs: number }
interface Frame { ms: number; size: number }
interface Receipt { video: string; atMs: number }
interface Seen {
  run: JourneyRun;
  /** The step times kept with the video's evidence. */
  kept: Span[];
  /** The video's own frames, by timestamp, read from its WebM blocks. */
  frames: Frame[];
  /** One frame of this video: its median frame interval, never more than one frame at 15 fps. */
  frameMs: number;
  receipts: Map<string, Receipt>;
}

// ---- The video's frames, read from the WebM (Matroska) structure: each block's timestamp, cluster time plus its
// signed 16-bit offset, in the segment's timecode scale. Nothing is decoded; only where the frames are in time.
const SEGMENT = 0x18538067, CLUSTER = 0x1f43b675, BLOCK_GROUP = 0xa0, INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1, TIMECODE = 0xe7, SIMPLE_BLOCK = 0xa3, BLOCK = 0xa1;
const ENTERED = new Set([SEGMENT, CLUSTER, BLOCK_GROUP, INFO]);
function webmFrames(b: Uint8Array): Frame[] {
  const vint = (at: number, keepMarker: boolean): { value: number; len: number; unknown: boolean } => {
    const first = b[at]!;
    let len = 1;
    while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
    if (len > 8) throw Error(`the video's EBML has a bad length at byte ${at}`);
    const mask = 0xff >> len;
    let value = keepMarker ? first : first & mask;
    let allOnes = (first & mask) === mask;
    for (let i = 1; i < len; i++) { value = value * 256 + b[at + i]!; if (b[at + i] !== 0xff) allOnes = false; }
    return { value, len, unknown: !keepMarker && allOnes };
  };
  const uint = (at: number, size: number): number => { let v = 0; for (let i = 0; i < size; i++) v = v * 256 + b[at + i]!; return v; };
  let scale = 1_000_000, cluster = 0;
  const frames: Frame[] = [];
  for (let at = 0; at < b.length;) {
    const id = vint(at, true);
    const size = vint(at + id.len, false);
    const body = at + id.len + size.len;
    if (ENTERED.has(id.value)) { at = body; continue; }   // a master element whose children are read in place
    if (size.unknown) throw Error(`the video's element ${id.value.toString(16)} has an unknown size`);
    if (id.value === TIMECODE_SCALE) scale = uint(body, size.value);
    else if (id.value === TIMECODE) cluster = uint(body, size.value);
    else if (id.value === SIMPLE_BLOCK || id.value === BLOCK) {
      const track = vint(body, false);
      const raw = (b[body + track.len]! << 8) | b[body + track.len + 1]!;
      frames.push({ ms: ((cluster + (raw & 0x8000 ? raw - 0x10000 : raw)) * scale) / 1e6, size: size.value - track.len - 3 });
    }
    at = body + size.value;
  }
  return frames.sort((x, y) => x.ms - y.ms);
}

let seen: Promise<Seen> | undefined;
/** One run of the journey on the working build, its video and its receipts, shared by both tests. */
function observed(): Promise<Seen> {
  seen ??= (async () => {
    const { runJourney, receiptFor } = await journey();
    const dir = checkout();
    const file = journeyVariant(dir, 'cart-total', (doc) => {
      doc.journey = 'cart-receipt';
      doc.steps = [
        { id: 'open', deadline: 10_000, goto: '/cart' },
        { id: 'hold-a', deadline: 10_000, expect: hold('a'), timeout: 6000 },
        { id: 'see-total', deadline: 5000, expect: { role: 'status', name: 'Total', text: '$18.00' }, timeout: 2000 },
        { id: 'hold-b', deadline: 10_000, expect: hold('b'), timeout: 6000 },
      ];
    }, 'cart-receipt');
    const run = await runJourney(runOptions(world, dir, file));
    expect(run.outcome, `the journey passes on the working build: ${JSON.stringify(run.failures)}`).toBe('passed');
    expect(run.steps.map((s) => s.id), 'every step ran, in order').toEqual([...STEPS]);
    expect(run.steps.every((s) => s.outcome === 'passed'), `every step passed: ${JSON.stringify(run.steps.map((s) => [s.id, s.outcome]))}`).toBe(true);

    expect(run.video, 'the run kept its video').toMatch(/^[0-9a-f]{64}$/);
    const record = await world.evidence.get(run.video!);
    expect(record, 'the video is in the evidence store').toBeDefined();
    expect(record!.intake, 'whole').toBe('captured');
    const bytes = await world.evidence.read(run.video!);
    expect(isWebm(bytes), 'a WebM video, as Playwright records').toBe(true);
    const frames = webmFrames(bytes);
    expect(frames.length, 'the video has frames').toBeGreaterThan(1);
    const gaps = frames.slice(1).map((f, i) => f.ms - frames[i]!.ms).filter((g) => g > 0).sort((x, y) => x - y);
    const frameMs = Math.min(FRAME_MS, gaps[Math.floor(gaps.length / 2)] ?? FRAME_MS);

    const kept = (record!.steps ?? []).map(({ step, startMs, endMs }) => ({ step, startMs, endMs }));
    const receipts = new Map<string, Receipt>();
    for (const id of STEPS) {
      const { video, atMs } = receiptFor(run, id);
      receipts.set(id, { video, atMs });
    }
    return { run, kept, frames, frameMs, receipts };
  })();
  return seen;
}

// ---- The criterion's assertions, each run on the real run and, in the wrong-program test, on a wrong one.

/** The step times kept with the video are the video's: every step, in order, inside the video's frames, each hold at least as long as it waited. */
function timesAreTheVideos(kept: Span[], s: Seen): void {
  const one = s.frameMs;
  expect(kept.map((k) => k.step), `the video's evidence keeps every step's times: ${JSON.stringify(kept)}`).toEqual([...STEPS]);
  const firstFrame = s.frames[0]!.ms;
  const lastFrame = s.frames[s.frames.length - 1]!.ms;
  for (const k of kept) {
    expect(Number.isFinite(k.startMs) && Number.isFinite(k.endMs), `${k.step}'s times are numbers`).toBe(true);
    expect(k.endMs, `${k.step} ends after it starts`).toBeGreaterThanOrEqual(k.startMs);
    expect(k.startMs, `${k.step} starts inside the video (its first frame is at ${firstFrame} ms)`).toBeGreaterThanOrEqual(Math.min(0, firstFrame) - one);
    expect(k.endMs, `${k.step} ends inside the video (its last frame is at ${lastFrame} ms)`).toBeLessThanOrEqual(lastFrame + 2 * one);
  }
  for (let i = 1; i < kept.length; i++) {
    expect(kept[i]!.startMs, `${kept[i]!.step} starts once ${kept[i - 1]!.step} has ended`).toBeGreaterThanOrEqual(kept[i - 1]!.endMs - one);
  }
  for (const id of ['hold-a', 'hold-b']) {
    const k = kept.find((x) => x.step === id)!;
    expect(k.endMs - k.startMs, `${id} waited ${HOLD_MS} ms in the page, so it lasts that long in the video`).toBeGreaterThanOrEqual(HOLD_MS - one);
  }
}

/** The run's own step record says what the video's evidence keeps. */
function runAgrees(run: JourneyRun, kept: Span[]): void {
  for (const step of run.steps) {
    const k = kept.find((x) => x.step === step.id);
    expect(k, `${step.id} is kept with the video`).toBeDefined();
    expect(Math.abs(step.startMs - k!.startMs), `${step.id}'s start in the run (${step.startMs}) and in the video's evidence (${k!.startMs})`).toBeLessThanOrEqual(1);
    expect(Math.abs(step.endMs - k!.endMs), `${step.id}'s end in the run (${step.endMs}) and in the video's evidence (${k!.endMs})`).toBeLessThanOrEqual(1);
  }
}

/** Each step's receipt opens this run's video within one frame of where that step starts in it. */
function receiptsOpenAtTheirSteps(receipts: Map<string, Receipt>, kept: Span[], s: Seen): void {
  for (const id of STEPS) {
    const r = receipts.get(id)!;
    const k = kept.find((x) => x.step === id)!;
    expect(r.video, `${id}'s receipt opens the journey's video`).toBe(s.run.video);
    expect(Math.abs(r.atMs - k.startMs), `${id}'s receipt opens the video at ${r.atMs} ms; the step starts at ${k.startMs} ms; one frame is ${s.frameMs.toFixed(1)} ms`).toBeLessThanOrEqual(s.frameMs);
  }
}

describe('AC7 #37.8b056f27 a receipt opens the journey\'s video within one frame of the checked step', () => {
  it('AC7 on the working build, each step\'s receipt, the checked expect\'s among them, opens the run\'s video within one frame of where the step starts, as the times kept with the video place it; those times are inside the video\'s frames and each 2000 ms hold lasts 2000 ms in them', async () => {
    const s = await observed();
    timesAreTheVideos(s.kept, s);
    runAgrees(s.run, s.kept);
    receiptsOpenAtTheirSteps(s.receipts, s.kept, s);
    const checked = s.kept.find((k) => k.step === CHECKED)!;
    expect(checked.startMs, 'the checked step comes after a hold, so it starts at least 2000 ms into the video').toBeGreaterThanOrEqual(HOLD_MS - s.frameMs);
  }, 180_000);

  it('AC7 (wrong program) a receipt at 0, at the step before\'s start, at the step after\'s start, at the step\'s own end or in wall-clock time, and step times in wall-clock time, in seconds or missing, each fail this criterion\'s assertions on the same run', async () => {
    const s = await observed();
    const start = (id: string): number => s.kept.find((k) => k.step === id)!.startMs;
    const end = (id: string): number => s.kept.find((k) => k.step === id)!.endMs;
    const receiptsAt = (at: (id: StepId, i: number) => number): Map<string, Receipt> =>
      new Map(STEPS.map((id, i): [string, Receipt] => [id, { video: s.run.video!, atMs: at(id, i) }]));
    const neighbour = (i: number, by: number): string => STEPS[Math.min(STEPS.length - 1, Math.max(0, i + by))]!;

    // The right receipts pass, so each failure below is the wrong program's alone.
    receiptsOpenAtTheirSteps(receiptsAt((id) => start(id)), s.kept, s);
    const wrongReceipts: [string, Map<string, Receipt>][] = [
      ['every receipt at 0', receiptsAt(() => 0)],
      ['each receipt at the step before\'s start', receiptsAt((_, i) => start(neighbour(i, -1)))],
      ['each receipt at the step after\'s start', receiptsAt((_, i) => start(neighbour(i, +1)))],
      ['each receipt at its step\'s end', receiptsAt((id) => end(id))],
      ['each receipt in wall-clock time', receiptsAt((id) => Date.now() - end('hold-b') + start(id))],
      ['each receipt in seconds', receiptsAt((id) => start(id) / 1000)],
    ];
    for (const [what, receipts] of wrongReceipts) {
      const error = await assertionFails(() => receiptsOpenAtTheirSteps(receipts, s.kept, s));
      expect(error.message, what).toMatch(/receipt opens the video at/);
    }
    const otherVideo = await assertionFails(() => receiptsOpenAtTheirSteps(new Map(STEPS.map((id): [string, Receipt] => [id, { video: '0'.repeat(64), atMs: start(id) }])), s.kept, s));
    expect(otherVideo.message).toMatch(/opens the journey's video/);

    const wrongTimes: [string, Span[]][] = [
      ['step times in wall-clock time', s.kept.map((k) => ({ ...k, startMs: k.startMs + Date.now(), endMs: k.endMs + Date.now() }))],
      ['step times in seconds', s.kept.map((k) => ({ ...k, startMs: k.startMs / 1000, endMs: k.endMs / 1000 }))],
      ['no step times kept with the video', []],
      ['every step at 0', s.kept.map((k) => ({ ...k, startMs: 0, endMs: 0 }))],
    ];
    for (const [what, kept] of wrongTimes) {
      const error = await assertionFails(() => timesAreTheVideos(kept, s));
      expect(error.message, what).toMatch(/keeps every step's times|inside the video|lasts that long|starts once/);
    }
  }, 180_000);
});
