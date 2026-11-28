import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC4, FIXTURES, appShowing, capturedFrames, cleanUpAfterTheFile, docId, framesPainting, hubShowing, luma, onAReferenceMac, picture, proof, reasonsPainted, said,
  screenScale, shownWithItsRenderBack, slotSize, stopHub, underTheGpuLease, useApp, type Box, type Image, type Size,
} from './helpers.ts';

const app = useApp();
cleanUpAfterTheFile();

const FIXTURE = join(FIXTURES, 'text-over-box.json');
const DOCUMENT_SIZE: Size = [480, 360];
const PANEL: Box = [0, 0, 480, 360];
const DOC = docId(4);
const RUN_MS = 8_000;
const CAPTURE_MS = 6_000;
const INK_BELOW_LUMA = 110;
const LEAST_INK = 20_000;
const WITHIN_PX = 0.5;

interface Ink { mass: number; x: number; y: number }

function textInk(image: Image): Ink {
  let mass = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const ink = Math.max(0, INK_BELOW_LUMA - luma(image, y * image.width + x));
      mass += ink;
      sx += ink * (x + 0.5);
      sy += ink * (y + 0.5);
    }
  }
  return { mass, x: mass === 0 ? NaN : sx / mass, y: mass === 0 ? NaN : sy / mass };
}

describe(`${AC4} a 3D document with one text item over a box is painted with the text within 0.5 px of where render-back draws it`, () => {
  it(`${AC4} the document's layer is painted from a GPU-layer slot, and the window shows its text within ${WITHIN_PX} px of where render-back's frame holds it`, async (ctx) => {
    await onAReferenceMac(ctx);
    const bin = app();
    await underTheGpuLease(ctx, async () => {
      const size = slotSize(DOCUMENT_SIZE, PANEL, await screenScale(ctx, bin));
      const hub = await hubShowing([{ doc: DOC, panel: 'main', rect: PANEL }]);
      const { back, p } = await shownWithItsRenderBack(hub, DOC, FIXTURE, { size }, 'the text over a box');
      await stopHub(hub);
      const drawn = textInk(back.image);
      proof('ac4-render-back.png', back.bytes);
      expect(drawn.mass, 'render-back\'s frame holds the text: the ink it reads, the darkness of every pixel below the fixture\'s box and sky').toBeGreaterThan(LEAST_INK);

      const report = await appShowing(ctx, bin, { hub, window: [PANEL[2], PANEL[3]], runMs: RUN_MS, revisions: [p], captureMs: [CAPTURE_MS] });
      proof('ac4-report.json', report.raw);
      expect(
        framesPainting(report, p.layer).length,
        `of the window's ${report.frames.length} frames, those that painted a GPU-layer slot for the layer "${p.layer}"; in the layer's place the panel painted ${reasonsPainted(report, p.layer)}`,
      ).toBeGreaterThan(0);
      const captured = capturedFrames(report)[0];
      expect(captured?.slots.some((s) => s.layer === p.layer), `the captured window frame painted the layer's slot; its slots: ${JSON.stringify(captured?.slots)}`).toBe(true);
      const window = picture(captured!.capture!, 'the window\'s capture');
      proof('ac4-window.png', window.bytes);
      const seen = textInk(window.image);
      expect(seen.mass, 'the window shows the text over the layer').toBeGreaterThan(LEAST_INK);
      const off = [seen.x * (back.image.width / window.image.width) - drawn.x, seen.y * (back.image.height / window.image.height) - drawn.y];
      said(`AC4 the text's ink is centred at (${drawn.x.toFixed(3)}, ${drawn.y.toFixed(3)}) px of render-back's ${back.image.width} × ${back.image.height} frame and (${off[0]!.toFixed(3)}, ${off[1]!.toFixed(3)}) px from there in the window`);
      expect(
        Math.max(Math.abs(off[0]!), Math.abs(off[1]!)),
        `the text in the window is within ${WITHIN_PX} px of where render-back draws it, (${drawn.x.toFixed(3)}, ${drawn.y.toFixed(3)}); it is (${off[0]!.toFixed(3)}, ${off[1]!.toFixed(3)}) px off`,
      ).toBeLessThanOrEqual(WITHIN_PX);
    });
  }, 3_600_000);
});
