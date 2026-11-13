// AC10 #162.178dca43: "Exporting a title HELLO whose animator rises each grapheme in turn writes five glyph groups whose
// positions equal the evaluated glyphs' at every export frame within 1e-3 u, a two-stop OKLab gradient on it exports
// with enough stops that the written sRGB ramp stays within 0.01 ΔEOK at 256 sampled points, and a glow on the title is
// listed once in warnings, naming the item"
//
// HELLO at 96 u, 30 fps for 2 s: one animator over graphemes, its range a fifth wide, its offset keyed from −0.2 to 1,
// lifting each grapheme 30 u in turn. Its fill is a linear gradient from the look's accent (#f2c230) to its ink
// (#1b1d22), interpolated in OKLab as every gradient is; its paint has a glow. The evaluated glyphs are `eval`'s
// `film.glyphs` (#493: each glyph's origin after its animators move it). A glyph group is a group in the title's layer
// that holds glyph outlines (path shapes) itself; its position is where its transform, composed with its layer's (and
// any group around it), puts its own origin (README: readings). The ramp a Lottie player draws between written stops is
// straight in sRGB-encoded values, so the written ramp is read that way at 256 points and held to the OKLab ramp
// between the two colours.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCENT, AC, FULL, INK, TIMEOUT, apply, channel, deltaEOK, exportedOf, film, fromOklab, glyphsCall, glyphsOf, hexRgb, item, layerNamed, lottieExport, none, oklab, readLottie, shapeToRoot, shapesIn, show, showRun, useShow, useTemp, valueAt, type JsonObject, type Pt, type Rgb,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const RATE: [number, number] = [30, 1];
const FRAMES = 60;

function helloDoc(evidence: string): JsonObject {
  return film(evidence, {
    id: 'hello', size: [640, 200], rate: RATE, frames: FRAMES,
    items: [item('title', 'text@1', 'HELLO', 'a02', {
      text: 'HELLO', size: 96,
      paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: 'accent' }, { at: 1, role: 'ink' }] } }, glow: { role: 'accent', size: 10 } },
      animators: [{ units: 'grapheme', range: { from: 0, to: 0.2, offset: -0.2, basis: 'fraction' }, shape: 'smooth', mode: 'add', props: { y: -30 } }],
    }, { at: { pos: [80, 150, 0] } })],
    channels: { rise: channel('items/title/params/animators/0/range/offset', [[0, -0.2], [2, 1]]) },
  });
}
/** The sRGB a written gradient gives at p: straight between its stops in encoded values, held past its ends. */
function writtenAt(stops: { at: number; rgb: Rgb }[], p: number): Rgb {
  if (p <= stops[0]!.at) return stops[0]!.rgb;
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i]!; const b = stops[i + 1]!;
    if (p <= b.at) { const u = b.at === a.at ? 1 : (p - a.at) / (b.at - a.at); return a.rgb.map((c, d) => c + (b.rgb[d]! - c) * u) as Rgb; }
  }
  return stops[stops.length - 1]!.rgb;
}

describe(`${AC[10]} HELLO's glyph groups follow its animator, its OKLab gradient keeps within 0.01 ΔEOK, its glow is listed once`, () => {
  it(`${AC[10]} five glyph groups at the evaluated glyphs' positions at every export frame within 1e-3 u; the ramp within 0.01 ΔEOK at 256 points; one warning for the glow, naming the title`, () => {
    const evidence = temp(); const dir = temp(); const out = join(dir, 'hello.json');
    const frames = Array.from({ length: FRAMES }, (_, k) => k);
    const replies = showRun(shows.bin(FULL), evidence, [helloDoc(evidence)], [lottieExport(0, out), ...frames.map((k) => glyphsCall(0, (k * 705_600_000) / RATE[0]))], 'HELLO');
    const { warnings } = exportedOf(replies[0]!, 'HELLO');
    const glyphs = frames.map((k) => glyphsOf(replies[1 + k]!, 'title', `HELLO at frame ${k}`));
    expect(glyphs[0]!.length, 'HELLO draws five glyphs').toBe(5);
    const anim = readLottie(out, 'HELLO');
    const layer = layerNamed(anim, 'HELLO', 'HELLO');
    const groups = shapesIn(layer.layer['shapes']).filter((s) => s.shape['ty'] === 'gr' && (Array.isArray(s.shape['it']) ? s.shape['it'] : []).some((x) => typeof x === 'object' && x !== null && !Array.isArray(x) && (x as JsonObject)['ty'] === 'sh'));
    expect(groups.length, `five glyph groups, each holding its glyph's outlines: ${show(layer.layer['shapes'] ?? null, 600)}`).toBe(5);
    const origin = (g: (typeof groups)[number], k: number): Pt => apply(shapeToRoot(anim, layer, [...g.groups, g.shape], k, 'a glyph group'), [0, 0]);
    const order = groups.map((g, i) => ({ g, i, x: origin(g, 0)[0] })).sort((a, b) => a.x - b.x).map((e) => e.g);
    const evalOrder = glyphs[0]!.map((p, i) => ({ p, i })).sort((a, b) => a.p[0] - b.p[0]).map((e) => e.i);
    none(frames.flatMap((k) => order.flatMap((g, j) => {
      const got = origin(g, k); const want = glyphs[k]![evalOrder[j]!]!;
      const d = Math.hypot(got[0] - want[0], got[1] - want[1]);
      return d <= 1e-3 ? [] : [`frame ${k}, glyph ${j + 1}: written at (${got[0].toFixed(4)}, ${got[1].toFixed(4)}), evaluated (${want[0].toFixed(4)}, ${want[1].toFixed(4)}), ${d.toFixed(4)} u apart`];
    })), 'each glyph group at its glyph\'s evaluated position at every export frame');

    const a = hexRgb(ACCENT); const b = hexRgb(INK);
    const fills = shapesIn(layer.layer['shapes']).filter((s) => s.shape['ty'] === 'gf');
    expect(fills.length, 'the title\'s gradient is written as gradient fills').toBeGreaterThan(0);
    none(fills.flatMap((s, n) => {
      const g = s.shape['g'] as JsonObject | undefined;
      const count = Number(g?.['p']);
      const flat = valueAt(g?.['k'], 0);
      const stops = Array.from({ length: count }, (_, i) => ({ at: flat[4 * i]!, rgb: [flat[4 * i + 1]!, flat[4 * i + 2]!, flat[4 * i + 3]!] as Rgb }));
      if (!(count >= 2) || stops.some((st) => !Number.isFinite(st.at))) return [`gradient fill ${n}: no colour stops: ${show(g ?? null, 300)}`];
      const out: string[] = [];
      for (let i = 0; i < 256; i++) {
        const p = i / 255;
        const la = oklab(a); const lb = oklab(b);
        const want = fromOklab(la.map((c, d) => c + (lb[d]! - c) * p) as Rgb);
        const d = deltaEOK(writtenAt(stops, p), want);
        if (d > 0.01) { out.push(`gradient fill ${n} (${count} stops): at ${p.toFixed(4)} the written ramp is ${d.toFixed(4)} ΔEOK from the OKLab ramp`); break; }
      }
      return out;
    }), 'every written ramp stays within 0.01 ΔEOK of the OKLab ramp from accent to ink at 256 points');

    const glows = warnings.filter((w) => /glow/i.test(w.text));
    expect(glows.length, `the glow is listed once: ${JSON.stringify(warnings.map((w) => w.raw))}`).toBe(1);
    expect(glows[0]!.item, 'the glow\'s warning names the title').toBe('title');
    expect(glows[0]!.kind, 'a glow is an item Lottie can\'t hold').toBe('cannot_hold');
  }, TIMEOUT);
});
