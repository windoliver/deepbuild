// AC6: the caption `Area 面积 مساحة 🙂` in the clean look draws every grapheme from a face that has it, the Han
// ones with `lang: zh-Hans` forms; with the CJK face removed from the fallback list it fails
// `text.glyph_missing`, naming 面 and the item.
//
// `raster` draws fixtures/caption.json in the clean look and reports the caption's glyphs (#381's `texts`),
// each with its face's file and the grapheme it belongs to, and (new) the language its run was shaped with.
// Every grapheme (UAX #29 clusters; Intl.Segmenter gives the same clusters for this text) draws at least one
// glyph, none .notdef, each from a face whose own character map holds every code point of its grapheme, read
// from the file test-side; the Han graphemes are shaped as zh-Hans. Then the clean look's definition, with the
// face that drew the Han removed from its `fallback` list (and nothing else changed), is refused by `check` and
// `raster` with `text.glyph_missing`, naming the caption and 面. At the base every grapheme past Latin draws
// Inter's .notdef and the look has no fallback list.
import { describe, expect, it } from 'vitest';
import {
  RENDER_BIN, arr, batch, check, clone, cmapGlyph, errorsOf, fixture, glyphsOf, issuesOf, obj, rasterAll, rasterInput, readFace, scratch,
  shippedLook, shown, str, useBinaries, type Glyph, type JsonObject,
} from './helpers.ts';

useBinaries('deep-canvas-render');
const dir = scratch('fallback');
const CAPTION = 'Area 面积 مساحة 🙂';
const HAN = /\p{Script=Han}/u;

const graphemes = (text: string): string[] => [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);
/** The code points a face must map for a grapheme: all but the default-ignorable ones (joiners, variation selectors). */
const mapped = (g: string): number[] => [...g].map((c) => c.codePointAt(0)!).filter((cp) => !/\p{Default_Ignorable_Code_Point}/u.test(String.fromCodePoint(cp)));

function drawCaption(look: JsonObject | string): Glyph[] {
  const [drawn] = rasterAll([rasterInput(dir, fixture('caption.json'), look)], ['the caption']);
  return glyphsOf(drawn!.report, 'caption');
}

/** Each way the caption's glyphs fail the criterion. */
function glyphProblems(glyphs: Glyph[]): string[] {
  const clusters = graphemes(CAPTION);
  const out: string[] = [];
  clusters.forEach((g, i) => {
    const own = glyphs.filter((x) => x.grapheme === i);
    if (own.length === 0) out.push(`grapheme ${i} ${JSON.stringify(g)} draws no glyph`);
    for (const x of own) {
      if (x.id === 0) out.push(`grapheme ${i} ${JSON.stringify(g)} draws .notdef from ${x.font}`);
      const face = readFace(x.font);
      const missing = mapped(g).filter((cp) => cmapGlyph(face, cp) === 0);
      if (missing.length) out.push(`grapheme ${i} ${JSON.stringify(g)} is drawn from ${x.font}, which lacks ${missing.map((cp) => `U+${cp.toString(16).toUpperCase()}`).join(' ')}`);
      if (HAN.test(g) && x.lang !== 'zh-Hans') out.push(`Han grapheme ${i} ${JSON.stringify(g)} is shaped as ${JSON.stringify(x.lang)}, not zh-Hans`);
    }
  });
  for (const x of glyphs) if (x.grapheme < 0 || x.grapheme >= clusters.length) out.push(`a glyph names grapheme ${x.grapheme} of ${clusters.length}`);
  return out;
}

describe('#417 AC6 the caption in the clean look draws every grapheme from a face that has it, Han with zh-Hans forms; without the CJK face in the fallback list it fails text.glyph_missing, naming 面 and the item', () => {
  it('AC6 every grapheme of `Area 面积 مساحة 🙂` in the clean look is drawn from a face whose character map holds it, the Han ones shaped as zh-Hans', () => {
    expect(graphemes(CAPTION).length, 'the caption is 15 graphemes').toBe(15);
    const glyphs = drawCaption('clean');
    expect(glyphProblems(glyphs)).toEqual([]);
    // More than one face: the body face has no Han, Arabic or emoji.
    expect(new Set(glyphs.map((g) => g.font)).size, `the caption draws from the body face and its fallbacks: ${[...new Set(glyphs.map((g) => g.font))].join(', ')}`).toBeGreaterThanOrEqual(3);
  }, 600_000);

  it('AC6 the oracle catches a face that lacks a grapheme and a Han run not shaped as zh-Hans', () => {
    const inter = 'crates/deep-text/fonts/Inter-Regular.ttf';
    expect(cmapGlyph(readFace(inter), 'A'.codePointAt(0)!), 'Inter maps A').not.toBe(0);
    expect(cmapGlyph(readFace(inter), '面'.codePointAt(0)!), 'Inter has no 面').toBe(0);
    const planted = graphemes(CAPTION).flatMap((_, i) => [{ font: inter, id: 5, grapheme: i, lang: 'en', raw: {} }]);
    const found = glyphProblems(planted);
    expect(found.some((p) => /面.*lacks U\+9762/.test(p)), `a Han grapheme from Inter is named: ${found.join(' | ')}`).toBe(true);
    expect(found.some((p) => /not zh-Hans/.test(p)), 'a Han run shaped as en is named').toBe(true);
  });

  it('AC6 with the face that drew the Han removed from the clean look\'s fallback list, check and raster refuse the caption with text.glyph_missing, naming the item and 面', () => {
    const glyphs = drawCaption('clean');
    const hanFonts = [...new Set(glyphs.filter((g) => HAN.test(graphemes(CAPTION)[g.grapheme] ?? '')).map((g) => g.font.split('/').at(-1)!))];
    expect(hanFonts.length, `the Han graphemes come from one face: ${hanFonts.join(', ')}`).toBe(1);
    const look = shippedLook('clean');
    const fonts = obj(look.def['fonts'], 'clean: fonts');
    const fallback = arr(look.def['fallback'], 'clean: fallback').map((v, i) => str(v, `fallback[${i}]`));
    const cjk = fallback.filter((name) => str(obj(fonts[name], `fonts.${name}`)['file'], `fonts.${name}.file`) === hanFonts[0]);
    expect(cjk.length, `the clean look's fallback list holds the CJK face ${hanFonts[0]} once`).toBe(1);
    const def = clone(look.def);
    def['id'] = 'clean-without-cjk';
    def['fallback'] = fallback.filter((name) => name !== cjk[0]);

    const doc = fixture('caption.json');
    const checked = check(doc, def);
    expect(checked['ok'], `the caption is refused without the CJK face: ${shown(checked)}`).toBe(false);
    const missing = errorsOf(issuesOf(checked, 'check')).filter((e) => e.code === 'text.glyph_missing');
    expect(missing.length, `check raises text.glyph_missing: ${shown(checked)}`).toBeGreaterThan(0);
    const named = missing.filter((e) => e.ids.includes('caption') && obj(e.raw['actual'], 'text.glyph_missing actual')['item'] === 'caption');
    expect(named.map((e) => obj(e.raw['actual'], 'actual')['grapheme']), 'text.glyph_missing names the caption and 面').toContain('面');
    for (const e of missing) expect(HAN.test(String(obj(e.raw['actual'], 'actual')['grapheme'])), `only Han is missing, got ${shown(e.raw)}`).toBe(true);

    const [drawn] = batch(RENDER_BIN, ['raster'], [rasterInput(dir, doc, def)]);
    const refused = obj(drawn, 'raster without the CJK face');
    expect([refused['ok'], refused['code']], `raster refuses it with text.glyph_missing: ${shown(refused)}`).toEqual([false, 'text.glyph_missing']);
  }, 600_000);
});
