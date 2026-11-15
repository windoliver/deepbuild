// AC1 #177.b891d426: With a stub display reporting a headroom of 4, a lamp at 8 times paper white reaches 4 in the
// surface's linear values, mid-grey keeps its SDR value within one 8-bit code value, and a status color on the same
// view reads its exact SDR value.
//
// The lamps (helpers: lampsDoc) in a window, through `deep-gpu run`'s view3d with `hdr: "auto"` on the stub display
// (potential 4, current 4), and again with `hdr: "off"` on the same display for mid-grey's SDR value. Under the look's
// agx, whose white is the lamp's 8, a lamp at 8 reaches exactly the headroom. Read on the frame's `surface` (the HDR
// surface's linear values, f16) and, for the status color, on `window_linear` (the window as composited), wherever
// the status mark is drawn. The highlight at 2 times paper white is the check that the shoulder rolls off and doesn't
// clip: it must read the roll-off's value (helpers: agxTo), 1.57, not 2. The `linear` target is read first to prove the
// fixture puts 8, 2 and 0.18 in front of the tone map. Four wrong programs each fail, naming what failed.
import { describe, expect, it } from 'vitest';
import {
  AC, FAIL, GREY, HEADROOM, HIGHLIGHT, IN_WINDOW, LAMP, ORIGIN, SIZE, STUB, TIMEOUT, WINDOW, agxTo, failMark, fmt, frameAt, interior, lampsDoc,
  modeCode, readF32, readIds, readSurface, rect, runGpu, useBuild, useDir, view3d, writeJson, type GpuPlant, type JsonObject, type Pixels,
} from './helpers.ts';

const bin = useBuild('gpu');
const dir = useDir();

const ON = 'the view with hdr auto on the stub display (headroom 4)';
const OFF = 'the same view with hdr off';

function draw(planted?: GpuPlant): { on: JsonObject; off: JsonObject; out: string } {
  const out = dir();
  const doc = writeJson(out, 'lamps', lampsDoc());
  const [on, off] = runGpu(bin(), out, [
    view3d({ doc, hdr: 'auto', stub_display: STUB, window: IN_WINDOW, targets: ['linear', 'ids', 'surface', 'window_linear'] }),
    view3d({ doc, hdr: 'off', stub_display: STUB, window: IN_WINDOW, targets: ['surface', 'window_linear'] }),
  ], planted);
  return { on: on!, off: off!, out };
}

const worst = (img: Pixels, pixels: [number, number][], want: number): { off: number; at: string } => {
  let off = 0; let at = '';
  for (const [x, y] of pixels) for (const v of img.at(x, y)) if (Math.abs(v - want) > off) { off = Math.abs(v - want); at = `(${x}, ${y}) reads ${fmt(img.at(x, y))}`; }
  return { off, at };
};

/** The criterion's check; each sentence names what it is about (the lamp, the highlight, mid-grey, the status color). */
function problems(on: JsonObject, off: JsonObject, out: string): string[] {
  const p: string[] = [];
  const f = frameAt(on, 0, ON);
  const g = frameAt(off, 0, OFF);
  if (g.hdr.state !== 'off') p.push(`with hdr off the frame reports hdr.state ${g.hdr.state}`);
  if (f.hdr.state !== 'on') return [...p, `the view didn't present HDR on a display whose potential headroom is 4 (hdr.state ${f.hdr.state})`];
  if (!f.surface) return [...p, 'the HDR frame reports no surface read-back'];
  const s = f.surface;
  if (s.format !== 'rgba16float' || s.color_space !== 'extended_linear_srgb' || !s.edr) p.push(`the HDR surface is ${JSON.stringify(s)}, not {format: rgba16float, color_space: extended_linear_srgb, edr: true}`);
  const ids = readIds(out, f, ON);
  const lamp = interior(ids, SIZE, 'lamp'); const hi = interior(ids, SIZE, 'highlight'); const grey = interior(ids, SIZE, 'grey');
  expect([lamp.length, hi.length, grey.length].every((n) => n >= 1000), `the fixture: the lamp, the highlight and mid-grey each show at least 1,000 interior pixels (${lamp.length}, ${hi.length}, ${grey.length})`).toBe(true);
  // The fixture: 8, 2 and 0.18 in front of the tone map, at an exposure of scale 1.
  const lin = readF32(out, f.linear, SIZE, `${ON}: linear`);
  for (const [name, px, want] of [['lamp', lamp, LAMP], ['highlight', hi, HIGHLIGHT], ['mid-grey', grey, GREY]] as const) {
    const w = worst(lin, px, want);
    expect(w.off, `the fixture: the ${name} is ${want} in the linear target (worst ${w.at})`).toBeLessThanOrEqual(want * 1e-3);
  }
  const hdr = readSurface(out, s, SIZE, ON);
  const l = worst(hdr, lamp, HEADROOM);
  if (l.off > 0.01) p.push(`the lamp at 8 times paper white doesn't reach 4 in the surface's linear values: ${l.at}`);
  const want = agxTo(HIGHLIGHT, HEADROOM);
  const h = worst(hdr, hi, want);
  if (h.off > 0.01 * want) p.push(`the highlight at 2 times paper white doesn't roll off to ${want.toFixed(4)} (the shoulder ending at the headroom): ${h.at}`);
  let peak = 0;
  for (const [x, y] of rect(0, 0, SIZE[0], SIZE[1])) peak = Math.max(peak, ...hdr.at(x, y));
  if (peak > HEADROOM + 0.01) p.push(`the surface goes past the headroom: its largest value is ${peak.toFixed(4)}`);
  if (g.surface) {
    const sdr = readSurface(out, g.surface, SIZE, OFF);
    const bad = grey.filter(([x, y]) => hdr.code(x, y).some((c, i) => Math.abs(c - sdr.code(x, y)[i]!) > 1));
    if (bad.length) p.push(`mid-grey misses its SDR value by more than one 8-bit code at ${bad.length} pixels, e.g. (${bad[0]![0]}, ${bad[0]![1]}) encodes to ${fmt(hdr.code(...bad[0]!))} against ${fmt(sdr.code(...bad[0]!))} with hdr off`);
  } else p.push('with hdr off the frame reports no surface read-back');
  const mark = failMark(on, ON);
  if (!mark) p.push('no fail mark (status color) is drawn on the view');
  else {
    const win = readF32(out, f.window_linear, WINDOW, `${ON}: window_linear`);
    const [bx, by, bw, bh] = mark.bounds.map(Math.round) as [number, number, number, number];
    const got = modeCode(win, rect(ORIGIN[0] + bx + 1, ORIGIN[1] + by + 1, Math.max(1, bw - 2), Math.max(1, bh - 2)));
    if (!got || got.some((c, i) => c !== FAIL[i])) p.push(`the status color (the fail mark) reads ${got ? fmt(got) : 'nothing'} in the window, not its exact SDR value ${fmt(FAIL)}`);
  }
  return p;
}

describe(`${AC[1]} on a display with headroom 4: the lamp reaches 4, mid-grey and the status color keep their SDR values`, () => {
  it(`${AC[1]} a lamp at 8 times paper white reads 4 in the HDR surface's linear values, the highlight at 2 rolls off to the curve, mid-grey is within one code of hdr off, and the fail mark is exact`, () => {
    const { on, off, out } = draw();
    expect(problems(on, off, out)).toEqual([]);
  }, TIMEOUT);

  const PLANTS: [GpuPlant, string, string][] = [
    ['clips_at_one', 'the lamp', 'the HDR surface carries the SDR curve, clipped at 1'],
    ['clips_at_headroom', 'the highlight', 'the shoulder is replaced by the identity clipped at the headroom'],
    ['moves_toe', 'mid-grey', 'the roll-off scales the whole curve by the headroom, toe included'],
    ['status_over_paper_white', 'the status color', 'the status colors on the view are scaled by the headroom'],
  ];
  for (const [plant, names, how] of PLANTS) {
    it(`${AC[1]} planted ${plant} (${how}) fails, naming ${names}`, () => {
      const { on, off, out } = draw(plant);
      const p = problems(on, off, out);
      expect(p.some((s) => s.includes(names)), `the check fails on ${plant}, naming ${names}: ${JSON.stringify(p)}`).toBe(true);
    }, TIMEOUT);
  }
});
