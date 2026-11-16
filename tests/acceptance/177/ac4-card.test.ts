// AC4 #177.7ae0f098: With HDR on, the question card over the view covers it in a capture of the window, at its exact
// colors, and a 3D layer over a 2D page with a shadow catcher stays SDR.
//
// The card: the big lamp (emission 8, 160 px) in a window, the question card in its slot over the lamp's middle,
// through view3d with `hdr: "auto"` on the stub display (potential 4, current 4) and again with `hdr: "off"`. The
// capture of the window is `window_linear`, the window's layers composited as the compositor composites them, in
// extended linear sRGB. With HDR on, the lamp around the card reads 4 in it (so the capture carries HDR), and every
// pixel of the card (its slot less a 2 px border and its 16 px corners) encodes to the same 8-bit color as with HDR
// off, none above paper white: the card covers the lamp at its exact colors.
// The catcher: #424's shadow catcher over the window's page, with a lamp of emission 8 beside the caster, no sky, so
// the 3D layer doesn't draw first and opaque. With `hdr: "auto"` on the same display it presents SDR: hdr.state off,
// its surface 8-bit sRGB, and the whole window byte for byte as with `hdr: "off"`.
import { describe, expect, it } from 'vitest';
import {
  AC, BIG_LAMP, CARD, CARD_RECT, HEADROOM, IN_WINDOW, ORIGIN, STUB, TIMEOUT, WINDOW, bigLampDoc, catcherDoc, fmt, frameAt, readF32, rect,
  runGpu, useBuild, useDir, view3d, writeJson, type GpuPlant,
} from './helpers.ts';

const bin = useBuild('gpu');
const dir = useDir();

/** The card's pixels judged: its slot less a 2 px border, without the 16 px squares at its corners. */
function cardPixels(): [number, number][] {
  const [x, y, w, h] = CARD_RECT;
  return [...rect(x + 2, y + 2, w - 4, h - 4)].filter(([px, py]) => {
    const cx = px < x + 16 || px >= x + w - 16; const cy = py < y + 16 || py >= y + h - 16;
    return !(cx && cy);
  });
}
/** The lamp's pixels in the window that the card leaves: 8 to 20 px outside the card's slot, inside the lamp. */
function aroundCard(): [number, number][] {
  const [x, y, w, h] = CARD_RECT;
  const [lx, ly, lw, lh] = [BIG_LAMP[0] + ORIGIN[0] + 4, BIG_LAMP[1] + ORIGIN[1] + 4, BIG_LAMP[2] - 8, BIG_LAMP[3] - 8];
  return [...rect(x - 20, y - 20, w + 40, h + 40)].filter(([px, py]) =>
    (px < x - 8 || px >= x + w + 8 || py < y - 8 || py >= y + h + 8) && px >= lx && px < lx + lw && py >= ly && py < ly + lh);
}

function cardProblems(planted?: GpuPlant): string[] {
  const out = dir();
  const doc = writeJson(out, 'big-lamp', bigLampDoc());
  const window = { ...IN_WINDOW, card: CARD };
  const [on, off] = runGpu(bin(), out, [
    view3d({ doc, hdr: 'auto', stub_display: STUB, window, targets: ['window_linear'] }),
    view3d({ doc, hdr: 'off', stub_display: STUB, window, targets: ['window_linear'] }),
  ], planted);
  const f = frameAt(on!, 0, 'the card over the view, hdr auto');
  const g = frameAt(off!, 0, 'the card over the view, hdr off');
  if (f.hdr.state !== 'on') return [`the view under the card didn't present HDR on a display with headroom 4 (hdr.state ${f.hdr.state})`];
  const a = readF32(out, f.window_linear, WINDOW, 'the window with HDR on');
  const b = readF32(out, g.window_linear, WINDOW, 'the window with HDR off');
  const p: string[] = [];
  const dim = aroundCard().filter(([x, y]) => a.at(x, y).some((v) => v < HEADROOM - 0.02));
  if (dim.length) p.push(`the capture doesn't carry the HDR lamp around the card: ${dim.length} lamp pixels below 4, e.g. (${dim[0]![0]}, ${dim[0]![1]}) reads ${fmt(a.at(...dim[0]!))}`);
  const off8 = cardPixels().filter(([x, y]) => a.code(x, y).some((c, i) => c !== b.code(x, y)[i]) || a.at(x, y).some((v) => v > 1 + 1e-6));
  if (off8.length) p.push(`the card doesn't cover the view at its exact colors: ${off8.length} of its pixels differ from HDR off or go above paper white, e.g. (${off8[0]![0]}, ${off8[0]![1]}) reads ${fmt(a.at(...off8[0]!))} (codes ${fmt(a.code(...off8[0]!))}) against ${fmt(b.code(...off8[0]!))}`);
  return p;
}

function catcherProblems(planted?: GpuPlant): string[] {
  const out = dir();
  const doc = writeJson(out, 'catcher', catcherDoc());
  const [on, off] = runGpu(bin(), out, [
    view3d({ doc, hdr: 'auto', stub_display: STUB, window: IN_WINDOW, targets: ['surface', 'window_linear'] }),
    view3d({ doc, hdr: 'off', stub_display: STUB, window: IN_WINDOW, targets: ['window_linear'] }),
  ], planted);
  const f = frameAt(on!, 0, 'the shadow catcher, hdr auto');
  const g = frameAt(off!, 0, 'the shadow catcher, hdr off');
  const p: string[] = [];
  if (f.hdr.state !== 'off') p.push(`the 3D layer over the 2D page with a shadow catcher presents HDR (hdr.state ${f.hdr.state}, headroom ${f.hdr.headroom})`);
  if (f.surface && (f.surface.format !== 'bgra8unorm' || f.surface.edr)) p.push(`the shadow catcher's view presents through ${JSON.stringify(f.surface)}, not the SDR surface`);
  const a = readF32(out, f.window_linear, WINDOW, 'the catcher window, hdr auto');
  const b = readF32(out, g.window_linear, WINDOW, 'the catcher window, hdr off');
  const diff = [...rect(0, 0, WINDOW[0], WINDOW[1])].filter(([x, y]) => a.code(x, y).some((c, i) => c !== b.code(x, y)[i]) || a.at(x, y).some((v) => v > 1 + 1e-6));
  if (diff.length) p.push(`the shadow catcher's window isn't SDR byte for byte as with hdr off: ${diff.length} pixels differ, e.g. (${diff[0]![0]}, ${diff[0]![1]}) reads ${fmt(a.at(...diff[0]!))} against codes ${fmt(b.code(...diff[0]!))}`);
  return p;
}

describe(`${AC[4]} with HDR on, the card covers the view at its exact colors, and 3D over a 2D page stays SDR`, () => {
  it(`${AC[4]} the question card over an HDR lamp covers it in the window's capture at the colors it has with HDR off, and the catcher over the page presents SDR byte for byte`, () => {
    expect([...cardProblems(), ...catcherProblems()]).toEqual([]);
  }, TIMEOUT);

  it(`${AC[4]} planted hdr_layer_above_chrome (the HDR surface's layer stacked over the window's) fails, naming the card`, () => {
    const p = cardProblems('hdr_layer_above_chrome');
    expect(p.some((s) => s.startsWith('the card doesn\'t cover the view')), `the check fails, naming the card: ${JSON.stringify(p)}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[4]} planted catcher_view_goes_hdr (a view drawing 3D over 2D presents HDR) fails, naming the shadow catcher`, () => {
    const p = catcherProblems('catcher_view_goes_hdr');
    expect(p.some((s) => s.includes('shadow catcher')), `the check fails, naming the shadow catcher: ${JSON.stringify(p)}`).toBe(true);
  }, TIMEOUT);
});
