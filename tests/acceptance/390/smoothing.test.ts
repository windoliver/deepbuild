import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  RENDER_BIN, diffPixels, globalSmoothingPreference, inkBounds, labelBox, one, pixel, readPng, readRenderSmoothingPreference,
  requireMacos, restoreRenderSmoothingPreference, setRenderSmoothingOff, useBinaries, within, type JsonObject, type Rgb,
} from './helpers.ts';

useBinaries('deep-text-render');

const CARD: Rgb = [24, 24, 24];
const WHITE: Rgb = [255, 255, 255];
const scratch = mkdtempSync(join(tmpdir(), 'deep-390-smoothing-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function render(out: string, text: string): JsonObject {
  const report = one(RENDER_BIN, ['render'], {
    out, card: { w: 320, h: 120, color: CARD },
    labels: [{ text, x: 16, y: 44, size: 24, weight: 400, font: 'body', color: WHITE }],
  });
  if (report['ok'] !== true && report['code'] === 'unsupported_platform') {
    expect.fail('INCONCLUSIVE: the render reports unsupported_platform; this is not a pass');
  }
  expect(report['ok'], `render ${text}: ${JSON.stringify(report)}`).toBe(true);
  return report;
}

describe('AC1 a white label on a dark card draws the same pixels with macOS font smoothing on and with AppleFontSmoothing set to 0', () => {
  it('AC1 the two renders are identical pixel for pixel, and each shows the label inside its box', () => {
    requireMacos();
    // With smoothing off for every app, GPUI's text system would not thicken anything either, so the
    // comparison could not tell the atlas from GPUI's text system: not a pass.
    expect(globalSmoothingPreference(), 'INCONCLUSIVE: the user\'s global AppleFontSmoothing is 0, so a twin drawing through GPUI\'s text system would also draw the same pixels twice').not.toBe('0');

    const onPath = join(scratch, 'smoothing-on.png');
    const offPath = join(scratch, 'smoothing-off.png');
    const prior = readRenderSmoothingPreference();
    expect(prior.value, `the render process's own AppleFontSmoothing preference is unset before the test (defaults read deep-text-render AppleFontSmoothing)`).toBeNull();

    const onReport = render(onPath, 'Ready');
    let offReport: JsonObject;
    setRenderSmoothingOff();
    try {
      expect(readRenderSmoothingPreference().value, 'AppleFontSmoothing is 0 for the render process during the second run').toBe('0');
      offReport = render(offPath, 'Ready');
    } finally {
      restoreRenderSmoothingPreference(prior);
    }
    expect(readRenderSmoothingPreference().value, 'the preference is removed again after the run').toBeNull();

    const on = readPng(onPath);
    const off = readPng(offPath);
    expect([on.width, on.height], 'the PNG is the card\'s size').toEqual([320, 120]);

    // The label is there: ink inside the reported box, nothing outside it, and the card color elsewhere.
    const box = labelBox(onReport, 0);
    const ink = inkBounds(on, CARD);
    expect(ink, 'the render has ink on the card').not.toBeNull();
    expect(within(ink!, box, 4), `the ink ${JSON.stringify(ink)} lies within the reported label box ${JSON.stringify(box)} (4 px margin)`).toBe(true);
    expect(ink!.w >= box.w * 0.6, `the ink spans most of the box: ink ${ink!.w} px of box ${box.w} px`).toBe(true);
    let light = 0;
    for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) if (pixel(on, x, y)[1] > 128) light++;
    const share = light / (box.w * box.h);
    expect(share > 0.03 && share < 0.7, `white-ish pixels cover a label's share of the box, got ${(share * 100).toFixed(1)}%`).toBe(true);
    expect(pixel(on, 2, 2), 'the card color at a corner').toEqual(CARD);
    expect(labelBox(offReport, 0), 'the same box in both runs').toEqual(box);

    // A twin that draws the label through GPUI's text system fails here: with smoothing allowed its macOS
    // rasterizer dilates a white glyph's strokes by the luminance level 4, with AppleFontSmoothing 0 by none.
    const diff = diffPixels(on, off);
    expect(diff.count, `${diff.count} pixels differ between smoothing on and AppleFontSmoothing 0 (first at ${JSON.stringify(diff.first)}): the glyphs did not come from the canvas's own atlas`).toBe(0);
  }, 300_000);

  it('AC1 the render draws the text it is given: two labels with different text give different pixels', () => {
    requireMacos();
    const a = join(scratch, 'ready.png');
    const b = join(scratch, 'blocked.png');
    render(a, 'Ready');
    render(b, 'Blocked');
    // A program that writes a fixed or empty image passes the identity check above and fails here.
    expect(diffPixels(readPng(a), readPng(b)).count > 50, '"Ready" and "Blocked" draw different pixels').toBe(true);
  }, 300_000);
});
