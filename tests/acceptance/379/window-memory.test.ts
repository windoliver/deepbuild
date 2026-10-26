// #379.d5e81f8a: GPU memory stays under 256 MB per window full screen on the reference Mac's display,
// measured on the device, with a live 3D view at the internal scale and frame-history window that fit; the
// check's memory estimate counts the slots, the HDR slots and frame history, and refuses a document that
// can't fit at scale 0.5 with a 2-frame window, naming the size.
//
// The window is one live 3D view of a showpiece the size of the reference Mac's built-in display in device
// px (Mac15,7: 3456 × 2234; Mac15,12: 2560 × 1664), with frame history on (an 8-frame antialias window), on
// the shipped build. "Measured on the device" is Metal's allocated size of the app's one device after each
// frame's queue drained, less its value before the view opened. Off a reference Mac: INCONCLUSIVE.
import { describe, expect, it } from 'vitest';
import {
  LOOK, W, WINDOW_CAP_BYTES, liveCall, liveReply, num, obj, one, requireMetal, requireReferenceMac, sceneDoc, useBuilds, useOut, writeDoc,
  type JsonObject,
} from './helpers.ts';

const builds = useBuilds(['default']);
const out = useOut();
const ID = '#379.d5e81f8a';
/** The look with frame history on: an 8-frame antialias window (Look `look@1`: frame history). */
const HISTORY_LOOK: JsonObject = { ...LOOK, history: { mode: 'antialias', window: 8 } };
const historyCall = (spec: Parameters<typeof liveCall>[0]): JsonObject => ({ ...liveCall(spec), look: HISTORY_LOOK });

/** A showpiece: a camera orbiting 20 boxes, so the view moves and frame history is live. */
function showpiece(size: [number, number]): JsonObject {
  const doc = sceneDoc({ title: 'Showpiece', class: 'showpiece', size, boxes: 20 });
  doc['channels'] = { orbit: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '60s', value: 1800, interp: 'linear' } } } };
  return doc;
}

describe(`${ID} GPU memory per window, full screen`, () => {
  it(`${ID} a full-screen live 3D view with frame history stays under 256 MB on the device, at the internal scale and history window that fit`, () => {
    const mac = requireReferenceMac();
    const size = mac.display;
    const doc = writeDoc(out(), 'show', showpiece(size));
    const live = liveReply(one(builds.bin(), out(), historyCall({
      frames: 60, sessions: [{ session: 's-show', writer: W.alpha, doc, size }], report: ['memory', 'meter'],
    })), `the full-screen view at ${size[0]} × ${size[1]}`);
    const row = live.sessions.find((s) => s.session === 's-show');
    expect(row?.state, `the showpiece is live at ${size[0]} × ${size[1]}, not refused: ${JSON.stringify(row?.issues ?? []).slice(0, 800)}`).toBe('live');
    expect(live.frames.length, '60 frames').toBe(60);
    const before = live.device_before;
    expect(typeof before, 'the device\'s allocated size before the view opened is reported').toBe('number');
    for (const f of live.frames) {
      const v = f.views.find((x) => x.session === 's-show');
      expect(v?.drawn, `frame ${f.frame} draws the view`).toBe(true);
      expect(v!.internal_scale, `frame ${f.frame}: the internal scale that fits, from 0.5 to 1`).toBeGreaterThanOrEqual(0.5);
      expect(v!.internal_scale, `frame ${f.frame}: the internal scale that fits, from 0.5 to 1`).toBeLessThanOrEqual(1);
      expect(v!.history_frames, `frame ${f.frame}: a frame-history window that fits, from 2 to 8 frames`).toBeGreaterThanOrEqual(2);
      expect(v!.history_frames, `frame ${f.frame}: a frame-history window that fits, from 2 to 8 frames`).toBeLessThanOrEqual(8);
      expect(typeof f.device_bytes, `frame ${f.frame}: the device's allocated size is measured`).toBe('number');
    }
    const peak = Math.max(...live.frames.map((f) => f.device_bytes as number)) - (before as number);
    console.log(`full screen ${size[0]} × ${size[1]}: peak ${(peak / 1e6).toFixed(1)} MB on the device at internal scale ${live.frames.at(-1)!.views[0]!.internal_scale} with ${live.frames.at(-1)!.views[0]!.history_frames} history frames`);
    expect(peak, `the window's GPU memory, measured on the device, stays under 256 MB (peak ${(peak / 1e6).toFixed(1)} MB)`).toBeLessThan(WINDOW_CAP_BYTES);
    expect(peak, 'the device measure sees the view (at least two BGRA slots at a scale of 0.5)').toBeGreaterThan(2 * 4 * size[0] * size[1] * 0.25);
    const meter = (live.meter ?? []).find((m) => m.session === 's-show');
    expect(meter, 'the meter shows the view\'s row').toBeDefined();
    const estimate = meter!.estimate;
    const parts = obj(estimate['parts'], 'the estimate\'s parts');
    for (const part of ['slots', 'hdr_slots', 'frame_history']) num(parts[part], `the estimate counts ${part}`);
    expect(num(parts['slots'], 'slots'), 'the slots count').toBeGreaterThan(0);
    expect(num(parts['frame_history'], 'frame_history'), 'frame history counts in the estimate').toBeGreaterThan(0);
    expect(num(estimate['gpu_bytes'], 'the estimate\'s gpu_bytes'), 'the estimate at the chosen scale and window fits the window\'s 256 MB').toBeLessThan(WINDOW_CAP_BYTES);
  }, 1_200_000);

  it(`${ID} a document that can't fit at scale 0.5 with a 2-frame window (8192 × 8192) is refused, naming the size, while the same document at 1920 × 1080 is live`, () => {
    requireMetal();
    const big = writeDoc(out(), 'big', showpiece([8192, 8192]));
    const fits = writeDoc(out(), 'fits', showpiece([1920, 1080]));
    const live = liveReply(one(builds.bin(), out(), historyCall({
      frames: 3,
      sessions: [{ session: 's-big', writer: W.alpha, doc: big, size: [8192, 8192] }, { session: 's-fits', writer: W.bravo, doc: fits, size: [1920, 1080] }],
    })));
    const bigRow = live.sessions.find((s) => s.session === 's-big');
    expect(bigRow?.state, 'the 8192 × 8192 view is refused before it shows').toBe('refused');
    const named = bigRow!.issues.filter((i) => i['severity'] === 'error' && /8192/.test(JSON.stringify(i)));
    expect(named.length, `an error issue names the size 8192 × 8192: ${JSON.stringify(bigRow!.issues).slice(0, 800)}`).toBeGreaterThan(0);
    expect(live.frames.every((f) => !f.views.some((v) => v.session === 's-big' && v.drawn)), 'the refused document never draws').toBe(true);
    const fitsRow = live.sessions.find((s) => s.session === 's-fits');
    expect(fitsRow?.state, `the same document at 1920 × 1080 is live: ${JSON.stringify(fitsRow?.issues ?? []).slice(0, 800)}`).toBe('live');
  }, 600_000);
});
