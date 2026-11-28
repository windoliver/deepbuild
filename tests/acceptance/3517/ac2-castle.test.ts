import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC2, REPO, appShowing, capturedFrames, cleanUpAfterTheFile, docId, flicks, framesPainting, howTheyDiffer, hubShowing, onAReferenceMac, playheadAt, proof,
  reasonsPainted, said, screenScale, shownWithItsRenderBack, slotOnScreen, slotSize, stopHub, underTheGpuLease, useApp, type Box, type Size,
} from './helpers.ts';

const app = useApp();
cleanUpAfterTheFile();

const CASTLE = join(REPO, 'packs', 'examples', 'castle.json');
const CASTLE_SIZE: Size = [1280, 800];
const PANEL: Box = [0, 0, 640, 400];
const DOC = docId(2);
const AT_SECONDS = 6;
const RUN_MS = 16_000;
const PAUSE_HANDED_MS = 500;
const CAPTURE_MS = 14_000;

describe(`${AC2} in the real app the castle example is painted from a GPU-layer slot, and its frame at a set t equals render-back's frame of that revision at that t by pixel hash`, () => {
  it(`${AC2} the castle, shown through the hub and paused at ${AT_SECONDS} s, is painted in the app's window from a GPU-layer slot whose frame is render-back's frame of that revision at ${AT_SECONDS} s, by pixel hash`, async (ctx) => {
    await onAReferenceMac(ctx);
    const bin = app();
    await underTheGpuLease(ctx, async () => {
      const size = slotSize(CASTLE_SIZE, PANEL, await screenScale(ctx, bin));
      const hub = await hubShowing([{ doc: DOC, panel: 'main', rect: PANEL }]);
      const { back, p } = await shownWithItsRenderBack(hub, DOC, CASTLE, { t: `${AT_SECONDS}s`, size }, 'the castle');
      const paused = await playheadAt(hub, 'main', flicks(AT_SECONDS));
      await stopHub(hub);
      const report = await appShowing(ctx, bin, {
        hub, window: [PANEL[2], PANEL[3]], runMs: RUN_MS, revisions: [p], replies: [{ atMs: PAUSE_HANDED_MS, reply: paused }], captureMs: [CAPTURE_MS],
      });
      proof('ac2-report.json', report.raw);
      proof('ac2-render-back.png', back.bytes);
      expect(
        framesPainting(report, p.layer).length,
        `of the window's ${report.frames.length} frames, those that painted a GPU-layer slot for the castle's layer "${p.layer}"; in the layer's place the panel painted ${reasonsPainted(report, p.layer)}`,
      ).toBeGreaterThan(0);
      const on = slotOnScreen(capturedFrames(report)[0], p.layer, 'the castle');
      if (typeof on === 'string') return expect.fail(on);
      proof('ac2-slot.png', on.shown.bytes);
      said(`AC2 the castle at ${AT_SECONDS} s, ${size[0]} × ${size[1]} px: the slot's frame ${on.shown.pixelHash} (frame_seq ${on.slot.frameSeq}, t ${on.slot.t}); render-back's ${back.pixelHash}`);
      expect(on.slot.t, `the slot's frame was evaluated at the session's time, ${flicks(AT_SECONDS)} flicks (${AT_SECONDS} s): slots[].t`).toBe(flicks(AT_SECONDS));
      expect(on.shown.pixelHash, `the slot's frame equals render-back's frame of revision ${p.rev} at ${AT_SECONDS} s by pixel hash; ${howTheyDiffer(on.shown.image, back.image)}`).toBe(back.pixelHash);
    });
  }, 3_600_000);
});
