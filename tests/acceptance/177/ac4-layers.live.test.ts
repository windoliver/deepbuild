// AC4 #177.7ae0f098, live: the Scope's last line, under the criterion it serves. The card and the chrome can cover the
// HDR surface only while the window's layers stand as the issue says and stay in step: "With HDR off or closed, the
// window's layers equal the merge base. Over a 60-frame live resize with HDR on, no captured frame has more than 1
// device pixel between the SDR chrome and the HDR surface's edge."
//
// Through the app's real window on this Mac's XDR display (`deep-app --hdr`, hdr-fixture build, DEEP_177_LIVE=1):
// - Layers: the window's Metal layers, bottom to top, as they report themselves after the run. The merge base's
//   window has one, GPUI's: BGRA8Unorm, tagged sRGB (#140's patch), no EDR, opaque (vendor/gpui-pre-apple's
//   `configure_layer` at 0e5572731). With `hdr: "off"`, and with `hdr: "auto"` once the view has closed, the report is
//   exactly that one layer. While the view shows with HDR on, an HDR layer (RGBA16Float, extended linear sRGB, EDR)
//   lies beneath GPUI's: the precondition that the report sees the stack at all.
// - The resize: a view with a flat sky inset 40 pt from every edge of a page of grey 128, HDR on, the window growing
//   from 900 × 600 to 1300 × 860 pt over 60 frames, each frame captured as the compositor composited it. On five lines
//   across each of the view's four edges, the run of pixels that are neither the page nor the view's own color is at
//   most 1 device px wide.
// Wrong programs: `keeps_hdr_layer` (the HDR layer stays in the window once the view closes) and
// `surface_resizes_late` (the HDR surface takes each new size a frame after GPUI's layer).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  AC, DARK_SKY, LOOK, TIMEOUT, decodePng, inconclusive, lampsDoc, liveHdr, ortho, requireLive, requireXdr, sessionDoc, useBuild, useDir, writeJson,
  type AppPlant, type Image, type JsonObject, type Layer,
} from './helpers.ts';

const app = useBuild('app');
const dir = useDir();

/** The merge base's window: GPUI's layer alone. */
const BASE: Layer[] = [{ owner: 'gpui', format: 'BGRA8Unorm', colorspace: 'kCGColorSpaceSRGB', edr: false, opaque: true }];
const PAGE = 128;
const INSET = 40;

function layersProblems(plant?: AppPlant): string[] {
  const p: string[] = [];
  const doc = writeJson(dir(), 'lamps', lampsDoc());
  const base = { doc, look: LOOK, window: [900, 600], page: [PAGE, PAGE, PAGE], view: [INSET, INSET, 820, 520] } as JsonObject;
  const shown = liveHdr(app(), dir(), { ...base, hdr: 'auto', frames: 30 }, plant);
  requireXdr(shown);
  const hdrLayer = shown.layers.findIndex((l) => l.format === 'RGBA16Float' && l.edr && l.colorspace === 'kCGColorSpaceExtendedLinearSRGB');
  const gpui = shown.layers.findIndex((l) => l.owner === 'gpui');
  expect(shown.frames.every((f) => f.state === 'on') && hdrLayer >= 0 && gpui > hdrLayer,
    `the precondition: with HDR on the view presents HDR and the report lists an HDR layer beneath GPUI's: ${JSON.stringify(shown.layers)}`).toBe(true);
  const off = liveHdr(app(), dir(), { ...base, hdr: 'off', frames: 30 }, plant);
  if (JSON.stringify(off.layers) !== JSON.stringify(BASE)) p.push(`with HDR off the window's layers are ${JSON.stringify(off.layers)}, not the merge base's ${JSON.stringify(BASE)}`);
  const closed = liveHdr(app(), dir(), { ...base, hdr: 'auto', frames: 60, close_view_at: 30 }, plant);
  if (JSON.stringify(closed.layers) !== JSON.stringify(BASE)) p.push(`with the HDR view closed the window's layers are ${JSON.stringify(closed.layers)}, not the merge base's ${JSON.stringify(BASE)}`);
  return p;
}

const near = (c: number[], w: number[]): boolean => c.every((v, i) => Math.abs(v - w[i]!) <= 3);
function px(img: Image, x: number, y: number): number[] { const o = (y * img.width + x) * 4; return [img.rgba[o]!, img.rgba[o + 1]!, img.rgba[o + 2]!]; }

/** The widest run of pixels that are neither page nor view between the two along a scan from the chrome inward. */
function gapAlong(img: Image, points: [number, number][], view: number[]): number | string {
  const kinds = points.map(([x, y]) => (x < 0 || y < 0 || x >= img.width || y >= img.height ? 'x' : near(px(img, x, y), [PAGE, PAGE, PAGE]) ? 'p' : near(px(img, x, y), view) ? 'v' : 'o'));
  const lastPage = kinds.lastIndexOf('p'); const firstView = kinds.indexOf('v', Math.max(0, lastPage));
  if (lastPage < 0 || firstView < 0) return `no ${lastPage < 0 ? 'chrome' : 'view'} within 12 px of the edge (${kinds.join('')})`;
  return firstView - lastPage - 1;
}

function resizeProblems(plant?: AppPlant): string[] {
  const out = dir();
  const sky = { ...DARK_SKY, params: { top: [0.05, 0.3, 0.05, 1], low: [0.05, 0.3, 0.05, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
  const doc = writeJson(out, 'sky', sessionDoc('sky-177', [820, 520], { cam: ortho([0, 0, 0], 10), sky }));
  const r = liveHdr(app(), out, { doc, look: LOOK, window: [900, 600], page: [PAGE, PAGE, PAGE], view: [INSET, INSET, 820, 520], hdr: 'auto', frames: 60, resize: { to: [1300, 860] }, captures: true }, plant);
  requireXdr(r);
  const p: string[] = [];
  if (r.frames.length !== 60) p.push(`the resize reports ${r.frames.length} frames, not 60`);
  const off = r.frames.filter((f) => f.state !== 'on');
  if (off.length) p.push(`HDR is off in ${off.length} frames of the resize, e.g. frame ${off[0]!.frame}`);
  const sizes = new Set(r.frames.map((f) => JSON.stringify(f.size)));
  if (sizes.size < 30) p.push(`the window took only ${sizes.size} sizes over the 60 frames: not a live resize`);
  for (const f of r.frames) {
    if (!f.capture || !f.size) { p.push(`frame ${f.frame} has no capture or size`); continue; }
    const img = decodePng(readFileSync(f.capture));
    const s = r.scale;
    if (img.width !== Math.round(f.size[0] * s) || img.height !== Math.round(f.size[1] * s)) { p.push(`frame ${f.frame}'s capture is ${img.width} × ${img.height}, not its window ${f.size.join(' × ')} pt at scale ${s}`); continue; }
    const [x0, y0, x1, y1] = [INSET * s, INSET * s, (f.size[0] - INSET) * s, (f.size[1] - INSET) * s].map(Math.round) as [number, number, number, number];
    const view = px(img, Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2));
    const lines: [string, [number, number][]][] = [];
    for (let k = 1; k <= 5; k++) {
      const y = Math.round(y0 + ((y1 - y0) * k) / 6); const x = Math.round(x0 + ((x1 - x0) * k) / 6);
      const span = (a: number, dir: 1 | -1): number[] => Array.from({ length: 25 }, (_, i) => a + dir * (i - 12));
      lines.push([`left edge, row ${y}`, span(x0, 1).map((xx): [number, number] => [xx, y])]);
      lines.push([`right edge, row ${y}`, span(x1 - 1, -1).map((xx): [number, number] => [xx, y])]);
      lines.push([`top edge, column ${x}`, span(y0, 1).map((yy): [number, number] => [x, yy])]);
      lines.push([`bottom edge, column ${x}`, span(y1 - 1, -1).map((yy): [number, number] => [x, yy])]);
    }
    for (const [where, points] of lines) {
      const g = gapAlong(img, points, view);
      if (typeof g === 'string' || g > 1) { p.push(`frame ${f.frame} (${f.size.join(' × ')} pt): ${typeof g === 'string' ? g : `${g} device px`} between the SDR chrome and the HDR surface's edge at the ${where}`); break; }
    }
  }
  return p;
}

describe(`${AC[4]} live: the window's layers with HDR off or closed, and the chrome and the HDR surface in step through a resize`, () => {
  it(`${AC[4]} with HDR off, and with the HDR view closed, the window's layers equal the merge base's one GPUI layer`, () => {
    requireLive('the layer report');
    expect(layersProblems()).toEqual([]);
  }, TIMEOUT);

  it(`${AC[4]} over a 60-frame live resize with HDR on, no captured frame has more than 1 device px between the SDR chrome and the HDR surface's edge`, () => {
    requireLive('the live resize');
    expect(resizeProblems()).toEqual([]);
  }, TIMEOUT);

  it(`${AC[4]} planted keeps_hdr_layer (the HDR layer stays once the view closes) fails, naming the closed view`, () => {
    requireLive('the layer report');
    const p = layersProblems('keeps_hdr_layer');
    expect(p.some((s) => s.startsWith('with the HDR view closed')), `the check fails, naming the closed view: ${JSON.stringify(p)}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[4]} planted surface_resizes_late (the HDR surface sized a frame after GPUI's layer) fails, naming a frame`, () => {
    requireLive('the live resize');
    const p = resizeProblems('surface_resizes_late');
    if (p.some((s) => s.startsWith('HDR is off'))) inconclusive('the planted run never turned HDR on, so the resize check saw no HDR surface');
    expect(p.some((s) => /^frame \d+ .*between the SDR chrome and the HDR surface's edge/.test(s)), `the check fails, naming a frame: ${JSON.stringify(p)}`).toBe(true);
  }, TIMEOUT);
});
