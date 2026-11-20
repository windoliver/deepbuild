// AC2 #1215.cfb50749: For every code point in the pinned Unicode version's VerticalOrientation.txt that the fixture font
// covers, the shaped run's orientation (upright or turned) equals the file's `U`/`Tu` versus `R`/`Tr` value. A planted
// shaper that keeps every glyph upright fails, naming the first `R` code point.
//
// The conformance run. Every code point the fixture font's character map covers (Noto Sans SC, the clean look's `cjk`
// font), less those a text@1 can't hold alone (README: Readings: NFC, and default-ignorable code points, which draw no
// glyph), each stands alone in a text@1 in `vertical_rl` with `combine_upright: 0`, a thousand texts a document, drawn by
// `raster` in one process per few documents. Each text's glyph rows must each carry `orientation` "upright" for a code
// point the file gives `U` or `Tu`, "turned" for `R` or `Tr` (Unicode 17.0.0's file, kept beside these tests with its
// SHA-256 checked). Failures are listed by code point, ascending. The planted `never_turns` is drawn over the first
// document, which holds the first `R` code point, and must fail naming it.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, arr, obj, run, useRender } from '../496/helpers.ts';
import {
  AC, PLANT, coveredCodePoints, drawnOf, face, figure, hex, rasterLine, textItem, verticalOrientation, type JsonObject, type Vo,
} from './helpers.ts';

const b = useRender();
/** Texts a document, and documents a raster process. */
const PER_DOC = 1000;
const DOCS_PER_RUN = 4;

const id = (cp: number): string => `c${cp.toString(16)}`;
const want = (v: Vo): 'upright' | 'turned' => (v === 'U' || v === 'Tu' ? 'upright' : 'turned');

/**
 * A document of one text@1 per code point, each its code point alone in vertical_rl, all drawn from one corner. With
 * `combine_upright: 0` no digit is set across, so the class alone sets each glyph (README: Readings).
 */
function docOf(k: number, cps: number[]): JsonObject {
  const params = { size: 16, flow: 'vertical_rl', combine_upright: 0, name: true };
  return figure(`ac2-${k}`, cps.map((cp, i) => textItem(id(cp), String.fromCodePoint(cp), params, [8, 8], `a${String(i).padStart(5, '0')}`)), [64, 64]);
}

/** Each code point whose glyphs don't carry the orientation its class gives, ascending. */
function orientationFailures(answer: JsonObject, cps: number[], vo: (cp: number) => Vo, what: string): string[] {
  const texts = obj(drawnOf(answer, what)['texts'], `${what}: texts`);
  const out: string[] = [];
  for (const cp of cps) {
    const v = vo(cp);
    const label = `${hex(cp)} ${JSON.stringify(String.fromCodePoint(cp))} (${v} in VerticalOrientation.txt)`;
    const text = texts[id(cp)];
    if (text === undefined) { out.push(`${label}: raster answers no text for it`); continue; }
    const glyphs = arr(obj(text, `${what}: texts.${id(cp)}`)['glyphs'], `${what}: texts.${id(cp)}.glyphs`);
    if (glyphs.length === 0) { out.push(`${label}: its run holds no glyph`); continue; }
    const got = glyphs.map((g) => obj(g, `${what}: a glyph of ${hex(cp)}`)['orientation']);
    if (got.some((o) => o !== want(v))) out.push(`${label}: the shaped run sets it ${got.map((o) => (o === undefined ? 'with no orientation' : JSON.stringify(o))).join(', ')}, not "${want(v)}"`);
  }
  return out;
}

describe(`${AC[2]} every code point the fixture font covers takes VerticalOrientation.txt's upright or turned`, () => {
  it(`${AC[2]} the shaped run's orientation equals U/Tu → upright, R/Tr → turned for every covered code point; the planted never_turns fails, naming the first R code point`, () => {
    const vo = verticalOrientation();
    const held = (cp: number): boolean => {
      const s = String.fromCodePoint(cp);
      return s.normalize('NFC') === s && !/\p{Default_Ignorable_Code_Point}|[\p{Cc}\p{Zl}\p{Zp}]/u.test(s);
    };
    const covered = coveredCodePoints(face());
    const cps = covered.filter(held);
    expect(cps.length, `the fixture font covers ${covered.length} code points; ${cps.length} can stand alone in a text`).toBeGreaterThan(30_000);
    const classes = new Set(cps.map(vo));
    expect([...classes].sort(), 'the run meets all four classes').toEqual(['R', 'Tr', 'Tu', 'U']);

    const docs: number[][] = [];
    for (let i = 0; i < cps.length; i += PER_DOC) docs.push(cps.slice(i, i + PER_DOC));
    const failures: string[] = [];
    for (let k = 0; k < docs.length; k += DOCS_PER_RUN) {
      const group = docs.slice(k, k + DOCS_PER_RUN);
      const answers = run(b.bin(), 'raster', group.map((d, j) => rasterLine(b.out(), `ac2-${k + j}`, docOf(k + j, d))));
      answers.forEach((a, j) => failures.push(...orientationFailures(a, group[j]!, vo, `document ${k + j} (${hex(group[j]![0]!)} to ${hex(group[j]!.at(-1)!)})`)));
    }
    // The count, not the list, is compared, so a failing run prints its first 40 code points rather than every one.
    expect(failures.length, `${cps.length} code points in vertical_rl, ${failures.length} set against their class; the first:\n  ${failures.slice(0, 40).join('\n  ')}`).toBe(0);

    const firstR = cps.find((cp) => vo(cp) === 'R')!;
    expect(docs[0]!.includes(firstR), `the first document holds the first R code point, ${hex(firstR)}`).toBe(true);
    const [planted] = run(b.bin(), 'raster', [rasterLine(b.out(), 'ac2-planted', docOf(0, docs[0]!), { planted: PLANT.neverTurns })]);
    const wrong = orientationFailures(planted!, docs[0]!, vo, `planted ${PLANT.neverTurns}`);
    expect(wrong.length, `the planted ${PLANT.neverTurns} passes the check it must fail`).toBeGreaterThan(0);
    expect(wrong[0], `planted ${PLANT.neverTurns}: the first failure names the first R code point, ${hex(firstR)}; the failures: ${wrong.slice(0, 5).join(' | ')}`)
      .toMatch(new RegExp(`^${hex(firstR).replace('+', '\\+')} .*\\(R in VerticalOrientation\\.txt\\)`));
  }, TIMEOUT);
});
