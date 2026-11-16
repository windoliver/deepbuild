// AC2 #177.d09c9a85: When the stub's headroom falls from 4 to 1.5, the next frame rolls off to 1.5, and at 1 the
// view presents SDR, byte for byte as with hdr off.
//
// The lamps (helpers: lampsDoc) for 8 frames with `hdr: "auto"` on the stub display (potential 4, current 4), which
// posts a fall to 1.5 before frame 3 and to 1 before frame 6 (`stub_display.posts`). Frame 2 still rolls off to 4;
// frame 3, the next frame, rolls off to 1.5: the lamp (at the look's white) reads 1.5 in the HDR surface and the
// highlight the roll-off's value at 1.5. Frames 6 and 7 present SDR: the surface each presented is byte for byte the
// one the same view presents with `hdr: "off"` (same format, same bytes, the same pixel hash). The wrong program
// reads the headroom once, when the view opens.
import { describe, expect, it } from 'vitest';
import {
  AC, HIGHLIGHT, SIZE, TIMEOUT, agxTo, fmt, frameAt, interior, lampsDoc, readIds, readSurface, runGpu, useBuild, useDir, view3d, writeJson,
  type GpuPlant, type JsonObject, type Pixels,
} from './helpers.ts';

const bin = useBuild('gpu');
const dir = useDir();

const STUB = { potential: 4, headroom: 4, posts: [{ frame: 3, headroom: 1.5 }, { frame: 6, headroom: 1 }] };
const ON = 'the view with hdr auto as the headroom falls';
const OFF = 'the same view with hdr off';

function draw(planted?: GpuPlant): { on: JsonObject; off: JsonObject; out: string } {
  const out = dir();
  const doc = writeJson(out, 'lamps', lampsDoc());
  const [on, off] = runGpu(bin(), out, [
    view3d({ doc, hdr: 'auto', stub_display: STUB, frames: 8, capture: [2, 3, 6, 7], targets: ['ids', 'surface'] }),
    view3d({ doc, hdr: 'off', stub_display: STUB, frames: 8, capture: [6, 7], targets: ['surface'] }),
  ], planted);
  return { on: on!, off: off!, out };
}

const spread = (img: Pixels, px: [number, number][], want: number): string | null => {
  for (const [x, y] of px) if (img.at(x, y).some((v) => Math.abs(v - want) > Math.max(0.005, 0.01 * want))) return `(${x}, ${y}) reads ${fmt(img.at(x, y))}`;
  return null;
};

function problems(on: JsonObject, off: JsonObject, out: string): string[] {
  const p: string[] = [];
  const ids = readIds(out, frameAt(on, 2, ON), ON);
  const lamp = interior(ids, SIZE, 'lamp'); const hi = interior(ids, SIZE, 'highlight');
  expect(lamp.length >= 1000 && hi.length >= 1000, 'the fixture: the lamp and the highlight each show at least 1,000 interior pixels').toBe(true);
  for (const [n, headroom] of [[2, 4], [3, 1.5]] as const) {
    const f = frameAt(on, n, ON);
    if (f.hdr.state !== 'on' || !f.surface || f.surface.format !== 'rgba16float') { p.push(`frame ${n} doesn't present through the HDR surface (hdr ${JSON.stringify(f.hdr)}, surface ${JSON.stringify(f.surface)})`); continue; }
    const img = readSurface(out, f.surface, SIZE, `${ON}: frame ${n}`);
    const l = spread(img, lamp, headroom);
    if (l) p.push(`frame ${n}${n === 3 ? ', the next frame after the fall to 1.5,' : ''} doesn't roll off to ${headroom}: the lamp ${l}`);
    const want = agxTo(HIGHLIGHT, headroom);
    const h = spread(img, hi, want);
    if (h) p.push(`frame ${n}: the highlight doesn't roll off to ${want.toFixed(4)} at headroom ${headroom}: ${h}`);
    if (Math.abs(f.hdr.headroom - headroom) > 1e-6) p.push(`frame ${n} reports headroom ${f.hdr.headroom}, not the display's ${headroom}`);
  }
  for (const n of [6, 7]) {
    const f = frameAt(on, n, ON); const g = frameAt(off, n, OFF);
    if (!f.surface || !g.surface) { p.push(`frame ${n}: a surface read-back is missing (hdr auto ${JSON.stringify(f.surface)}, hdr off ${JSON.stringify(g.surface)})`); continue; }
    if (f.surface.format !== g.surface.format || f.surface.file !== g.surface.file) {
      p.push(`at headroom 1, frame ${n} doesn't present SDR byte for byte as with hdr off: it presents ${f.surface.format} ${f.surface.file}, hdr off presents ${g.surface.format} ${g.surface.file}`);
    }
    if (f.pixel_hash !== g.pixel_hash) p.push(`at headroom 1, frame ${n}'s pixel hash ${f.pixel_hash} differs from hdr off's ${g.pixel_hash}`);
  }
  return p;
}

describe(`${AC[2]} a fall in the display's headroom takes the next frame; at 1 the view is SDR byte for byte`, () => {
  it(`${AC[2]} the headroom falls from 4 to 1.5 before frame 3, which rolls off to 1.5, and to 1 before frame 6, whose surface equals hdr off's byte for byte`, () => {
    const { on, off, out } = draw();
    expect(problems(on, off, out)).toEqual([]);
  }, TIMEOUT);

  it(`${AC[2]} planted reads_headroom_once (the headroom read when the view opens, never again) fails, naming frame 3`, () => {
    const { on, off, out } = draw('reads_headroom_once');
    const p = problems(on, off, out);
    expect(p.some((s) => s.startsWith('frame 3')), `the check fails, naming frame 3: ${JSON.stringify(p)}`).toBe(true);
  }, TIMEOUT);
});
