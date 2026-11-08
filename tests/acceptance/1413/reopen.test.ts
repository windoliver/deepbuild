// #1413.dc5f17ae, #1413.b3581ccc and #1413.1e112492: a device that won't come back. One run started with
// `--fail-reopen always` (README: the planted reopen): two writers' views draw a moving scene; the device is lost at
// frame 30 and every reopen fails. The run goes on 12 s past the loss, capturing each view as presented every 6th
// frame; then, in the same app with the device still lost, the window draws #377's scene page with no GPU-layer view
// and the shell's question card. A second run plants a reopen in a tight loop. At the base there is no `test-faults`
// feature, so the binary doesn't build.
import { describe, expect, it } from 'vitest';
import {
  FPS, PLACEHOLDER_WITHIN_S, REOPENS, W, blankGuard, framesCall, framesReply, liveCall, liveReply, readNamed, reopenProblems, run, sceneDoc,
  useBuild, useDir, viewOf, writeDoc, type JsonObject, type Live,
} from './helpers.ts';

const bin = useBuild();
const dir = useDir();
const LOSS = 30;
const FRAMES = LOSS + 12 * FPS;
const CAPTURE = Array.from({ length: Math.floor((FRAMES - LOSS) / 6) + 1 }, (_, i) => LOSS + 6 * i);
const SESSIONS = ['alpha', 'bravo'] as const;
/** The card's slot in window px, over the page (as #377's card test places it). */
const CARD: JsonObject = { ask: 'ask:01JB7A0000000000000001413', question: 'Keep the placeholder?', options: [{ id: 'keep', label: 'Keep it' }, { id: 'retry', label: 'Retry' }], rect: [700, 300, 480, 240] };
const WINDOW_FRAMES = 3;
const windowCall = framesCall({ count: WINDOW_FRAMES, layer: false, card: CARD, capture: 'every', window_hash: true });

let memo: { live: Live; window: JsonObject } | null = null;
function lostRun(): { live: Live; window: JsonObject } {
  if (memo) return memo;
  const d = dir();
  const plain = writeDoc(d, 'plain', sceneDoc('Plain'));
  const { replies } = run(bin(), d, [
    liveCall({
      frames: FRAMES,
      sessions: [{ session: 'alpha', writer: W.alpha, doc: plain }, { session: 'bravo', writer: W.bravo, doc: plain }],
      events: [{ frame: LOSS, lose_device: {} }],
      capture: CAPTURE,
    }),
    windowCall,
  ], { failReopen: 'always' });
  memo = { live: liveReply(replies[0]!, 'the live call with a device that won\'t come back'), window: replies[1]! };
  return memo;
}

describe('#1413.dc5f17ae with a planted reopen that always fails, each affected view shows a non-blank placeholder within 2 s, passing #157\'s blank guard', () => {
  it('#1413.dc5f17ae after the third failed reopen both views take the placeholder rung, told as device_lost, and show a picture #157\'s guard passes within 2 s and from then on', () => {
    const { live } = lostRun();
    const d = dir();
    expect(live.device_losses, 'the device was lost once').toBe(1);
    expect(live.reopens.map((r) => r.ok), 'three reopen attempts, each failing, then no more').toEqual(Array(REOPENS).fill(false));
    const end = live.reopens[REOPENS - 1]!.frame;
    for (const s of SESSIONS) {
      const writer = s === 'alpha' ? W.alpha : W.bravo;
      expect(live.changes.filter((c) => c.session === s && c.to === 'placeholder').map((c) => c.reason), `${s}'s view takes the placeholder rung with the reason device_lost`).toEqual(['device_lost']);
      expect(live.told.filter((t) => t.writer === writer && t.rung === 'placeholder').map((t) => t.reason), `${writer} is told its placeholder and why`).toEqual(['device_lost']);
      const captured = live.frames.filter((f) => CAPTURE.includes(f.frame)).map((f) => ({ frame: f.frame, view: viewOf(f, s) }));
      const passes = (c: (typeof captured)[number]): string[] => {
        if (c.view.rung !== 'placeholder') return [`frame ${c.frame}: ${s} is at ${c.view.rung}, not the placeholder`];
        if (c.view.final === null) return [`frame ${c.frame}: ${s}'s placeholder isn't captured as presented`];
        return blankGuard(readNamed(d, c.view.final, `frame ${c.frame}: ${s}'s placeholder`)).map((p) => `frame ${c.frame}: ${s}'s placeholder is ${p}`);
      };
      const first = captured.find((c) => c.frame >= end && passes(c).length === 0);
      expect(first, `${s} shows a placeholder that passes #157's blank guard after the third failed reopen (frame ${end})`).toBeDefined();
      expect(first!.frame - end, `${s}'s placeholder shows within ${PLACEHOLDER_WITHIN_S} s (${PLACEHOLDER_WITHIN_S * FPS} frames) of the third failed reopen`).toBeLessThanOrEqual(PLACEHOLDER_WITHIN_S * FPS);
      expect(captured.filter((c) => c.frame >= first!.frame).flatMap(passes), `${s} keeps showing a placeholder that passes the guard to the end`).toEqual([]);
    }
  }, 3_600_000);
});

describe('#1413.b3581ccc at most 3 reopens happen in 10 s; a planted tight loop fails, naming the count', () => {
  it('#1413.b3581ccc with every reopen failing, at most 3 reopens happen in the 10 s after the loss, none on the UI thread', () => {
    const { live } = lostRun();
    expect(live.reopens.length, 'the device is reopened at least once').toBeGreaterThan(0);
    expect(reopenProblems(live.reopens), 'the reopens are bounded and off the UI thread').toEqual([]);
  }, 3_600_000);

  it('#1413.b3581ccc a planted reopen in a tight loop (--planted reopens_tight_loop) fails, naming the count', () => {
    const d = dir();
    const plain = writeDoc(d, 'tight', sceneDoc('Plain'));
    const { replies } = run(bin(), d, [liveCall({
      frames: LOSS + 11 * FPS,
      sessions: [{ session: 'alpha', writer: W.alpha, doc: plain }],
      events: [{ frame: LOSS, lose_device: {} }],
    })], { failReopen: 'always', planted: 'reopens_tight_loop' });
    const problems = reopenProblems(liveReply(replies[0]!, 'the live call (--planted reopens_tight_loop)').reopens);
    expect(problems.length, 'the check fails the tight loop').toBeGreaterThan(0);
    const count = Number(/^(\d+) reopens happened/.exec(problems[0]!)?.[1]);
    expect(count, `the failure names the count: ${problems[0]}`).toBeGreaterThan(REOPENS);
  }, 3_600_000);
});

describe('#1413.1e112492 windows with no GPU view keep drawing, and the question card stays usable', () => {
  it('#1413.1e112492 with the device lost and never reopened, a window with no GPU-layer view presents every frame with the question card, exactly as on a healthy device', () => {
    const { window } = lostRun();
    const d = dir();
    const lost = framesReply(window, 'the window with no GPU view, the device lost');
    expect(lost.frames.map((f) => f.frame), 'every frame is presented').toEqual(Array.from({ length: WINDOW_FRAMES }, (_, i) => i));
    const healthy = framesReply(run(bin(), d, [windowCall]).replies[0]!, 'the same window on a healthy device');
    expect(lost.frames.map((f) => f.window_hash), 'each frame of the window, the question card in it, is the healthy device\'s, pixel for pixel').toEqual(healthy.frames.map((f) => f.window_hash));
    for (const f of lost.frames) expect(blankGuard(readNamed(d, f.window, `frame ${f.frame}'s window`)), `frame ${f.frame}'s window passes #157's blank guard`).toEqual([]);
  }, 3_600_000);
});
