// Criterion 15 (#140.1c7b76f7): a fixture rendered headless under LANG=de_DE.UTF-8 and under LANG=en_US.UTF-8
// gives identical glyph runs, and only the document's `locale` changes 1,234.5 to 1.234,5; a planted formatter
// that reads the process locale fails, naming the item.
//
// The fixture (fixtures/locale.json) shows a reading of 1234.5 through a bound value formatted with one decimal
// and the locale's grouping (Bound value: `format.group: locale`), beside a caption. It is rendered headless
// with `deep-canvas-render raster` (Vello CPU, #373, #381's `texts`), each run in its own process with LANG,
// LC_ALL and LC_NUMERIC all set to the one locale. The planted formatter is the raster line's
// `planted: "reads_process_locale"` (README: Planted programs).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALE_DOC, LOOK_2D, RENDER, answers, arr, obj, ok, str, useBuilds, useDir, type JsonObject, type JsonValue } from './helpers.ts';

const builds = useBuilds([RENDER]);
const dir = useDir();

const READING = 'reading:01JB1400000000000000000001';
const LANGS = ['de_DE.UTF-8', 'en_US.UTF-8'] as const;
const SHOWN: Record<string, string> = { 'en-US': '1,234.5', 'de-DE': '1.234,5' };

interface Run { shown: string; glyphs: JsonValue[] }
/** The fixture rendered headless under a process locale: each text item's shown string and glyph run. */
function render(bin: string, lang: string, docLocale: string, planted?: string): Map<string, Run> {
  const doc = LOCALE_DOC();
  doc['locale'] = docLocale;
  const line: JsonObject = { out: join(dir(), `${lang}-${docLocale}.png`), doc, look: LOOK_2D(), t: 0, readings: { [READING]: 1234.5 }, ...(planted ? { planted } : {}) };
  const env = { ...process.env, LANG: lang, LC_ALL: lang, LC_NUMERIC: lang };
  const [answer] = answers(bin, ['raster'], [line], { env });
  const texts = obj(ok(answer!, `raster under LANG=${lang}, document locale ${docLocale}`)['texts'], 'texts');
  return new Map(Object.entries(texts).map(([id, v]) => {
    const e = obj(v, `texts.${id}`);
    return [id, { shown: str(e['shown'], `texts.${id}.shown`), glyphs: arr(e['glyphs'], `texts.${id}.glyphs`) }];
  }));
}

/** What breaks the rule for one document locale across the process locales, as sentences naming the item. */
function localeProblems(runs: Map<string, Map<string, Run>>, docLocale: string): string[] {
  const p: string[] = [];
  const want = SHOWN[docLocale]!;
  for (const [lang, texts] of runs) {
    const amount = texts.get('amount');
    if (!amount) { p.push(`under LANG=${lang} the item amount has no glyph run`); continue; }
    if (amount.shown !== want) p.push(`the item amount shows ${JSON.stringify(amount.shown)} under LANG=${lang}, where the document's locale ${docLocale} writes ${JSON.stringify(want)}`);
    if (amount.glyphs.length !== want.length) p.push(`the item amount has ${amount.glyphs.length} glyphs under LANG=${lang}, not one per character of ${want}`);
  }
  const [a, b] = [...runs.entries()];
  if (a && b) {
    for (const id of new Set([...a[1].keys(), ...b[1].keys()])) {
      if (JSON.stringify(a[1].get(id)) !== JSON.stringify(b[1].get(id))) p.push(`the item ${id}'s glyph run differs between LANG=${a[0]} and LANG=${b[0]} (document locale ${docLocale})`);
    }
  }
  return p;
}

describe('#140.1c7b76f7 (C15) text and numbers read the document\'s locale, never the process\'s', () => {
  it('#140.1c7b76f7 (C15) under LANG=de_DE.UTF-8 and LANG=en_US.UTF-8 the fixture gives identical glyph runs, and only the document\'s locale changes 1,234.5 to 1.234,5', () => {
    const bin = builds.bin(RENDER);
    const byDoc = new Map<string, Map<string, Map<string, Run>>>();
    for (const docLocale of Object.keys(SHOWN)) byDoc.set(docLocale, new Map(LANGS.map((lang) => [lang, render(bin, lang, docLocale)] as const)));
    const problems = [...byDoc].flatMap(([docLocale, runs]) => localeProblems(runs, docLocale));
    // Only the number changes with the document's locale: the caption is the same run in both.
    const caption = [...byDoc.values()].map((runs) => JSON.stringify(runs.get(LANGS[0])?.get('caption')));
    if (caption[0] !== caption[1]) problems.push('the caption\'s glyph run changes with the document\'s locale, which only the number should');
    if (!byDoc.get('en-US')?.get(LANGS[0])?.get('caption')?.glyphs.length) problems.push('the caption has no glyph run');
    expect(problems, 'the fixture across process and document locales').toEqual([]);
  }, 900_000);

  it('#140.1c7b76f7 (C15) the planted formatter that reads the process locale fails the same check, naming the item', () => {
    const bin = builds.bin(RENDER);
    const runs = new Map(LANGS.map((lang) => [lang, render(bin, lang, 'en-US', 'reads_process_locale')] as const));
    const problems = localeProblems(runs, 'en-US');
    expect(problems.length, 'the planted formatter fails').toBeGreaterThan(0);
    expect(problems.join('\n'), 'naming the item').toMatch(/the item amount/);
    // It is the process locale it read: under LANG=de_DE it wrote the German number for an en-US document.
    expect(runs.get('de_DE.UTF-8')?.get('amount')?.shown, 'the planted formatter under LANG=de_DE.UTF-8').toBe('1.234,5');
  }, 900_000);
});
