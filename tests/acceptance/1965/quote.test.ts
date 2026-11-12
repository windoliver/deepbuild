// AC2 #1965.1d486d42: A quote of lines 3 to 5 of a file with CRLF line ends, a tab indent and a decomposed é (e, then
// U+0301) passes, its raw bytes equal to the file's; it draws the é as one NFC grapheme, the tab as 4 columns and no
// line-end mark, and each token's byte range lands on its glyphs; twins with one byte changed, with the é precomposed
// as U+00E9 and with one CRLF made LF each fail quote_mismatch naming the line and the byte, the last two though they
// draw the same display text as the quote that passes
//
// The source file is six CRLF lines; lines 3 to 5 are quoted. #406's tests (tests/acceptance/406/quote.test.ts) already
// prove, for one CRLF line: the quote passes with its digits listed as quotation, and a twin that drops the CR fails
// quote_mismatch naming the item. They don't prove a quote of several lines, the line and the byte a failure names, the
// precomposed twin, the twin of one changed byte, nor anything about drawing: those are here.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, ITEM, LOOK_A, CODE_A, accepted, cell, checkOne, codeDoc, describe as errors, drawOne, imagesEqual, indicesOf, matching, model, naming, role, sha256, useBin, useDir, type Checked, type GlyphRow, type Rgb, type Token } from './helpers.ts';
import { shown } from '../467/helpers.ts';

const ID = AC[2];
const bin = useBin('deep-canvas-render');
const dir = useDir();

const L3 = 'def pick(items):';
const L4 = '\tname = "café"';
const L5 = '\treturn name';
const SOURCE = Buffer.from(['# settings', '', L3, L4, L5, '# end', ''].join('\r\n'), 'utf8');
const quoted = (l3: string, l4: string, l5: string, ends: [string, string, string] = ['\r\n', '\r\n', '\r\n']): string => `${l3}${ends[0]}${l4}${ends[1]}${l5}${ends[2]}`;
const RAW = quoted(L3, L4, L5);
const PATH = 'src/pick.py';

/** The source in a store (a folder of files named by the sha256 of their bytes), as #406's suite puts it. */
function stored(base: string): { store: string; sha: string } {
  const store = join(base, 'store');
  mkdirSync(store, { recursive: true });
  const sha = sha256(SOURCE);
  writeFileSync(join(store, sha), SOURCE);
  return { store, sha };
}
const bytes = (s: string): Buffer => Buffer.from(s, 'utf8');
/** The byte range of `needle`'s nth occurrence at or after `fromLine`'s start in `raw`. */
function range(raw: string, needle: string, after = 0): [number, number] {
  const from = bytes(raw).indexOf(bytes(needle), after);
  expect(from, `"${needle}" is in the raw`).toBeGreaterThanOrEqual(0);
  return [from, from + bytes(needle).length];
}
/** From the first `needle` at or after `after` to the end of that line's text (a twin may change the last letter). */
function restOfLine(raw: string, needle: string, after: number): [number, number] {
  const [from] = range(raw, needle, after);
  const b = bytes(raw);
  let end = from;
  while (end < b.length && b[end] !== 0x0d && b[end] !== 0x0a) end += 1;
  return [from, end];
}
/** Tokens for every part of the quote a class names: keyword, function, variable, operator, string. */
function tokensOf(raw: string): Token[] {
  const l4 = bytes(raw).indexOf(bytes('\tname')) ;
  const l5 = bytes(raw).indexOf(bytes('\treturn'));
  const t = (r: [number, number], c: string): Token => ({ from: r[0], to: r[1], class: c });
  const string = range(raw, '"', l4);
  const close = bytes(raw).indexOf(bytes('"'), string[0] + 1) + 1;
  return [
    t(range(raw, 'def'), 'keyword'), t(range(raw, 'pick'), 'function'),
    t(range(raw, 'name', l4), 'variable'), t(range(raw, '=', l4), 'operator'), { from: string[0], to: close, class: 'string' },
    t(range(raw, 'return', l5), 'keyword'), t(restOfLine(raw, 'nam', l5), 'variable'),
  ];
}
const quoteOf = (sha: string): { source: string; path: string; lines: [number, number] } => ({ source: sha, path: PATH, lines: [3, 5] });
const EXPECTED = 'def pick(items):\n    name = "café"\n    return name';

/** A mismatch error naming `line` and `byte`: `actual: {line, byte}`, or both numbers in the words (README: Readings). */
function namesAt(c: Checked, line: number, byte: number): string[] {
  const hits = c.errors.filter((e) => e.code === 'quote_mismatch' && e.ids.includes(ITEM));
  const exact = hits.filter((e) => {
    const a = e.raw['actual'] as { line?: number; byte?: number } | null;
    const text = JSON.stringify(Object.fromEntries(Object.entries(e.raw).filter(([k]) => k !== 'fix')));
    return (a && a.line === line && a.byte === byte) || (new RegExp(`\\bline\\D{0,3}${line}\\b`, 'i').test(text) && new RegExp(`\\bbyte\\D{0,3}${byte}\\b`, 'i').test(text));
  });
  return hits.length === 0 ? [`no quote_mismatch names ${ITEM}: ${errors(c)}`] : exact.length === 0 ? [`quote_mismatch names ${ITEM} but not line ${line}, byte ${byte}: ${errors(c)}`] : [];
}

describe(`${ID} a quote of lines 3 to 5`, () => {
  it(`${ID} the quote passes, raw equal to the file's lines, and draws the é as one grapheme, the tab as 4 columns, no line end, each token on its glyphs`, () => {
    expect(bytes(RAW).equals(SOURCE.subarray(bytes('# settings\r\n\r\n').length, bytes('# settings\r\n\r\n').length + bytes(RAW).length)), 'the quote holds the file\'s lines 3 to 5 byte for byte').toBe(true);
    expect(bytes(L4).includes(Buffer.from([0x65, 0xcc, 0x81])), 'the é is decomposed in the file: e, then CC 81 (U+0301)').toBe(true);
    const { store, sha } = stored(dir());
    const tokens = tokensOf(RAW);
    const doc = codeDoc('quote-1965', RAW, { tokens, quote: quoteOf(sha) });
    const checked = checkOne(bin(), doc, LOOK_A, store);
    expect(checked.errors.map((e) => `${e.code} ${e.ids.join(',')}`), `the quote of lines 3 to 5 matches the file and counts no number: ${errors(checked)}`).toEqual([]);
    expect(checked.ok, 'the check passes').toBe(true);

    const d = accepted(drawOne(bin(), dir(), doc, LOOK_A, store), 'the quote');
    expect(d.shown, 'the display text: three lines, the tab 4 spaces, the é U+00E9, no CR, no tab').toBe(EXPECTED);
    expect(d.shown.includes('́') || d.shown.includes('\r') || d.shown.includes('\t'), 'no U+0301, CR or tab is left in the display text').toBe(false);

    const m = model(RAW);
    expect(m.text, 'this suite\'s model of the display steps agrees with the issue\'s own words').toBe(EXPECTED);
    // The é: one display grapheme, one glyph, however two code points and three bytes it was.
    const eAcute = m.graphemes.findIndex((g) => g.text === 'é');
    expect(eAcute, 'the display text holds the é').toBeGreaterThan(0);
    expect(d.glyphs.filter((g) => g.grapheme === eAcute).length, `the é (display grapheme ${eAcute}) is drawn by one glyph, not an e and a mark: ${shown(d.glyphs.filter((g) => g.grapheme >= eAcute - 1 && g.grapheme <= eAcute + 1))}`).toBe(1);
    const lineEnds = m.graphemes.flatMap((g, i) => (g.text === '\n' ? [i] : []));
    expect(d.glyphs.filter((g) => lineEnds.includes(g.grapheme)).length, `no glyph draws a line end (display graphemes ${lineEnds.join(', ')})`).toBe(0);
    expect(Math.max(...d.glyphs.map((g) => g.grapheme)), 'no glyph is drawn past the display text\'s last grapheme').toBeLessThan(m.graphemes.length);

    // The tab: 4 columns. The glyph at column 4 of line 1 (the p of pick) and the first glyph after a tab (the n of name,
    // the r of return) are at the same x, four advances in.
    const at = (index: number): GlyphRow => { const f = d.glyphs.filter((g) => g.grapheme === index); expect(f.length, `display grapheme ${index} has one glyph`).toBe(1); return f[0]!; };
    const first = (text: string, from = 0): number => m.text.indexOf(text, from);
    const p = at(first('pick')); const n = at(first('name')); const r = at(first('return'));
    expect(p.x, 'pick starts 4 columns in: a column is one advance').toBeCloseTo(4 * p.advance, 0);
    expect(n.x, `the tab before name is drawn as 4 columns: x ${n.x}, the p of pick (column 4) at ${p.x}`).toBeCloseTo(p.x, 0);
    expect(r.x, `the tab before return is drawn as 4 columns: x ${r.x}, the p of pick at ${p.x}`).toBeCloseTo(p.x, 0);

    // Each token's byte range lands on its glyphs: ink in the look's role for its class on each letter, and plain ink,
    // in no token's role, on every letter outside every token.
    const roles: Record<string, Rgb> = Object.fromEntries(Object.entries(CODE_A).map(([c, r2]) => [c, role(r2)]));
    const failures: string[] = [];
    const covered = new Set<number>();
    for (const t of tokens) {
      const indices = indicesOf(m, t.from, t.to);
      indices.forEach((i) => covered.add(i));
      for (const i of indices) {
        if (!/[\p{L}\p{M}=]/u.test(m.graphemes[i]!.text)) continue;
        const g = at(i);
        const own = matching(d.image!, cell(g), roles[t.class]!);
        if (own < 3) failures.push(`token ${t.class} bytes [${t.from}, ${t.to}): glyph ${i} "${m.graphemes[i]!.text}" has ${own} px in the ${t.class} role ${CODE_A[t.class as keyof typeof CODE_A]}`);
      }
    }
    for (const [i, gr] of m.graphemes.entries()) {
      if (covered.has(i) || !/[\p{L}]/u.test(gr.text)) continue;
      const g = at(i);
      if (matching(d.image!, cell(g), roles['plain']!) < 3) failures.push(`glyph ${i} "${gr.text}" is in no token: it has no plain ink`);
      for (const c of ['keyword', 'function', 'variable', 'operator', 'string']) if (matching(d.image!, cell(g), roles[c]!) > 0) failures.push(`glyph ${i} "${gr.text}" is in no token but is drawn in the ${c} role`);
    }
    expect(failures, `${failures.length} tokens or glyphs are not where their byte ranges put them:\n  ${failures.join('\n  ')}`).toEqual([]);
  });

  const twins: { name: string; make: () => string; line: number; byte: number; same: boolean }[] = [
    { name: 'one byte changed (the last e of line 5\'s name made a)', make: () => quoted(L3, L4, L5.replace(/name$/, 'nama')), line: 5, byte: bytes('\treturn nam').length, same: false },
    { name: 'the é precomposed as U+00E9', make: () => quoted(L3, L4.replace('é', 'é'), L5), line: 4, byte: bytes('\tname = "caf').length, same: true },
    { name: 'one CRLF made LF (the end of line 4)', make: () => quoted(L3, L4, L5, ['\r\n', '\n', '\r\n']), line: 4, byte: bytes(L4).length, same: true },
  ];
  for (const twin of twins) {
    it(`${ID} the twin with ${twin.name} fails quote_mismatch naming line ${twin.line} and byte ${twin.byte}${twin.same ? ' and draws the same display text and the same picture' : ''}`, () => {
      const { store, sha } = stored(dir());
      const raw = twin.make();
      expect(raw, 'the twin differs from the passing quote').not.toBe(RAW);
      const c = checkOne(bin(), codeDoc('twin-1965', raw, { tokens: tokensOf(raw), quote: quoteOf(sha) }), LOOK_A, store);
      expect(c.ok, `the check fails: ${errors(c)}`).toBe(false);
      expect(namesAt(c, twin.line, twin.byte), `quote_mismatch names the line and the byte`).toEqual([]);
      expect(c.errors.filter((e) => e.code !== 'quote_mismatch').map((e) => e.code), `nothing else is refused: ${errors(c)}`).toEqual([]);
      expect(naming(c, ITEM).length, 'the error names the item').toBeGreaterThan(0);
      // Drawn on their own (a failed quote is never drawn), the twin and the passing quote's raw show the same display text,
      // and with each its own tokens the same picture, tokens colored: so only the bytes tell them apart.
      const base = accepted(drawOne(bin(), dir(), codeDoc('same-a', RAW, { tokens: tokensOf(RAW) }), LOOK_A), 'the passing quote\'s raw, unquoted');
      const twinDrawn = accepted(drawOne(bin(), dir(), codeDoc('same-b', raw, { tokens: tokensOf(raw) }), LOOK_A), 'the twin\'s raw, unquoted');
      const inked = base.glyphs.map((g) => matching(base.image!, cell(g), role(CODE_A.keyword))).reduce((a, b) => a + b, 0);
      expect(inked, 'the passing quote draws its keywords in the keyword role (the comparison below is of tokened pictures)').toBeGreaterThan(0);
      if (!twin.same) return;
      expect(twinDrawn.shown, 'the twin draws the same display text as the passing quote').toBe(base.shown);
      expect(imagesEqual(twinDrawn.image!, base.image!), 'the twin draws the same picture, token colors included').toBe(true);
    });
  }
});
