// AC2: in the real app, a document with a 3D writer layer is painted from a GPU-layer slot: a test reads the slot's
// frame on screen, and fails on the merge base, where the panel paints a picture decoded from the evidence store.
//
// The whole path a person's document takes, with nothing standing in for a part of it. The fixture's document (a red
// box sliding across a blue sky) goes through `deep show` to a real hub, whose canvas core checks it and presents it.
// What the hub then hands the app (`canvas.drawn`, taken as the app takes it) goes, as it came, to the app's canvas
// panel in the app's real window on this Mac's screen (`deep-app --canvas`, #1485's fixture mode in a
// `canvas-fixture` build), with the hub's evidence store as the panel's. The run captures two frames of the window.
//
// What is read (README: The surface under test). A frame's `slots` lists the GPU-layer slots the panel painted in
// it. Each captured frame must have painted one for the 3D layer; the slot's own bytes (`pixels`) must show the
// document, the red box over the middle and the blue sky at a corner; and the window as the compositor received that
// frame (`capture`) must show those same bytes where the layer's panel is. That is the slot's frame, read on screen.
//
// On the merge base the hub presents the layer with no picture (the decision's finding) and the panel has no
// GPU-layer view, so no frame paints a slot: the test fails at its first assertion on the report.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC2, canvas, expectNotBlank, onlyOnMacos, onScreen, presentation, proof, readPng, showsFixture, useApp, useShown, windowOf, type Box,
} from './helpers.ts';

const app = useApp();
const shown = useShown();

const RUN_MS = 14_000;
/** Two frames late in the run, long after the view's first frame, each captured with its slot. */
const CAPTURE_MS = [9_000, 13_000];
/** At least this many of the 1,200 samples must lie where the slot's frame is flat, or too little was compared. */
const MIN_JUDGED = 300;
/** The share of judged samples that may differ: a wrong picture differs over the box or the sky, a quarter of them at least. */
const OFF_SHARE = 0.01;

describe(`${AC2} in the real app, a document with a 3D writer layer is painted from a GPU-layer slot: a test reads the slot's frame on screen`, () => {
  it(`${AC2} the hub's presentation of a 3D document, handed to the app's panel in the app's window: the layer is painted from a GPU-layer slot, the slot's frame shows the document, and the window shows the slot's frame in the layer's place`, (ctx) => {
    onlyOnMacos(ctx);
    const bin = app();
    const hub = shown();
    const p = presentation(hub);
    const out = join(hub.home, 'captures');
    mkdirSync(out, { recursive: true });
    const report = canvas(ctx, bin, hub, p, { runMs: RUN_MS, capture: { atMs: CAPTURE_MS, out } });
    proof('ac2-presented.json', p.presented);
    proof('ac2-report.json', report.raw);

    // The layer is painted from a GPU-layer slot. The merge base paints none.
    const painted = report.frames.filter((f) => f.slots.some((s) => s.layer === p.layer));
    const pictures = [...new Set(report.frames.flatMap((f) => f.pictures))];
    expect(
      painted.length,
      `of the window's ${report.frames.length} frames, those that painted a GPU-layer slot for the 3D layer "${p.layer}" (frames[k].slots); the pictures decoded from the evidence store that the panel painted instead: ${JSON.stringify(pictures)}`,
    ).toBeGreaterThan(0);

    // Each captured frame: the slot it painted, and that slot's frame on screen.
    const captured = report.frames.filter((f) => f.capture !== null);
    expect(captured.length, `one captured frame for each of capture_ms ${JSON.stringify(CAPTURE_MS)}; captured: ${JSON.stringify(captured.map((f) => f.frame))}`).toBe(CAPTURE_MS.length);
    const size = windowOf(p).map((side) => side * report.scale);
    const rect = p.rect.map((side) => Math.round(side * report.scale)) as Box;
    for (const f of captured) {
      const what = `frame ${f.frame}, captured ${f.atMs.toFixed(0)} ms into the run`;
      const slot = f.slots.find((s) => s.layer === p.layer);
      expect(slot, `${what}, painted a GPU-layer slot for the 3D layer "${p.layer}"; its slots: ${JSON.stringify(f.slots)}`).toBeDefined();
      expect(slot!.pixels, `${what}: its slot comes with its own bytes (slots[].pixels)`).not.toBeNull();
      const frame = readPng(slot!.pixels!, `${what}: the slot's frame`);
      const screen = readPng(f.capture!, `${what}: the window's capture`);
      proof(`ac2-frame-${f.frame}-slot.png`, frame.bytes);
      proof(`ac2-frame-${f.frame}-window.png`, screen.bytes);
      console.log(`PROOF #2494 AC2 ${what}: slot frame_seq ${slot!.frameSeq}, ${frame.image.width} × ${frame.image.height} px, on the ${slot!.path} path; window ${screen.image.width} × ${screen.image.height} px at scale ${report.scale}`);

      expect(
        Math.abs(screen.image.width - size[0]!) <= 1 && Math.abs(screen.image.height - size[1]!) <= 1,
        `${what}: the capture is the whole window in device px, ${size[0]} × ${size[1]} at scale ${report.scale}; it is ${screen.image.width} × ${screen.image.height}`,
      ).toBe(true);
      expectNotBlank(frame.image, `${what}: the slot's frame`);
      expectNotBlank(screen.image, `${what}: the window's capture`);
      expect(showsFixture(frame.image), `${what}: the slot's frame shows the document`).toEqual([]);

      const seen = onScreen(frame.image, screen.image, rect);
      expect(seen.judged, `${what}: samples where the slot's frame is one flat opaque color, of 1,200`).toBeGreaterThanOrEqual(MIN_JUDGED);
      expect(
        seen.off.length <= Math.floor(seen.judged * OFF_SHARE),
        `${what}: the window shows the slot's frame over the layer's panel (${JSON.stringify(rect)} px); ${seen.off.length} of ${seen.judged} samples differ: ${seen.off.slice(0, 6).join('; ')}`,
      ).toBe(true);
    }
  }, 3_600_000);
});
