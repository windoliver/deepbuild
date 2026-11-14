// AC2 #538.04486d9f, Oracle lane: the upstream plural-rules file's English and French cardinal rules and their integer
// samples (README: Sources), re-expressed and run on our code. Upstream gives each category of a locale's cardinal rule
// the integers that fall in it: English one is 1, everything else other, 0 among them; French one is 0 and 1, many is
// 1000000, other the rest. Ours: a copy table `cat` whose key 1 is a plural entry showing its own category's name in
// each form (en one and other; fr one, many and other), fed by a logic program that steps rules.count through every
// sample (programs.ts `countsProgram`); at each sample's step `eval` draws the caption in the view's locale en and fr,
// and the frame must show the category upstream names for that count, by pixel hash against the caption with the
// category's name written out.
//
// First the judge runs on outputs that must fail (English's rule applied to French, French with no many, English's one
// covering 0) and on the model's own, which must pass. Then the pinned file is read where README says, checked by its
// SHA-256, and its English and French integer samples must be the ones re-expressed here; without it the test fails
// `BLOCKED:` with one unblock line. Then our code runs.
import { describe, expect, it } from 'vitest';
import {
  AC, CAPTION_SIZE, DOC, PLURALS, PLURALS_SHA256, RULES_WRITES, TIMEOUT, at, binOf, caption, captionRef, countsProgram, film, logicItem, none,
  prebuild, presented, putEvidence, runShow, scenario, showCall, evalCall, snapshotOf, useTemp, vendored, type JsonObject,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();

type Locale = 'en' | 'fr';
type Category = 'one' | 'many' | 'other';
const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);
/** The integer samples, re-expressed from the pinned file's lines 30 to 33 (en) and 118 to 122 (fr): each `@integer`
 * list with its ranges written out, its "…" and its compact forms (1c6, 2c3 and the like) left out. */
const SAMPLES: Record<Locale, Partial<Record<Category, number[]>>> = {
  en: { one: [1], other: [0, ...range(2, 16), 100, 1000, 10000, 100000, 1000000] },
  fr: { one: [0, 1], many: [1000000], other: [...range(2, 17), 100, 1000, 10000, 100000] },
};
const expected = (locale: Locale, n: number): Category | undefined =>
  (Object.entries(SAMPLES[locale]) as [Category, number[]][]).find(([, list]) => list.includes(n))?.[0];
/** Every sample count, once, in the order the program steps through them. */
const COUNTS = [...new Set([...Object.values(SAMPLES.en), ...Object.values(SAMPLES.fr)].flat())].sort((a, b) => a - b);
const LOCALES: Locale[] = ['en', 'fr'];

/** The judge: what each (locale, count) shows against upstream's category; a failure names the locale and the count. */
function sampleFailures(shown: (locale: Locale, n: number) => string | undefined): string[] {
  const out: string[] = [];
  for (const locale of LOCALES) {
    for (const n of COUNTS) {
      const want = expected(locale, n);
      if (want === undefined) continue;
      const got = shown(locale, n);
      if (got !== want) out.push(`locale ${locale}, count ${n}: shows ${got === undefined ? 'no category\'s form' : `the ${got} form`}, where the upstream sample says ${want}`);
    }
  }
  return out;
}
/** The integer samples the pinned file gives one locale's rules (the `pluralRules` element whose `locales` holds it). */
function fileSamples(text: string, locale: Locale): Partial<Record<Category, number[]>> {
  const block = [...text.matchAll(/<pluralRules locales="([^"]*)">([\s\S]*?)<\/pluralRules>/g)].find((m) => m[1]!.split(/\s+/).includes(locale));
  expect(block, `the pinned file has rules for ${locale}`).toBeDefined();
  const out: Partial<Record<Category, number[]>> = {};
  for (const rule of block![2]!.matchAll(/<pluralRule count="([a-z]+)">([^<]*)<\/pluralRule>/g)) {
    const integers = /@integer([^@]*)/.exec(rule[2]!)?.[1] ?? '';
    out[rule[1] as Category] = integers.split(',').map((s) => s.trim()).filter((s) => s !== '' && s !== '…' && !s.includes('c'))
      .flatMap((s) => (s.includes('~') ? range(Number(s.split('~')[0]), Number(s.split('~')[1])) : [Number(s)]));
  }
  return out;
}

const CAT: JsonObject = { en: { cat: { 1: { one: 'one', other: 'other' } } }, fr: { cat: { 1: { one: 'one', many: 'many', other: 'other' } } } };
const CATEGORIES: Category[] = ['one', 'many', 'other'];

describe(`${AC[2]} Oracle lane: the upstream plural-rules file's English and French cardinal samples, run on our copy`, () => {
  it(`${AC[2]} every English and French integer sample shows the category upstream gives it: en one 1, other 0 and the rest; fr one 0 and 1, many 1000000, other the rest`, () => {
    // The judge passes the model and fails the wrong rules.
    none(sampleFailures(expected), 'the judge on upstream\'s own categories');
    const englishForFrench = (l: Locale, n: number): Category | undefined => (l === 'fr' ? (n === 1 ? 'one' : 'other') : expected(l, n));
    expect(sampleFailures(englishForFrench).some((f) => /locale fr, count 0:/.test(f)), 'the judge fails English\'s rule applied to French, naming fr and 0').toBe(true);
    const noMany = (l: Locale, n: number): Category | undefined => (l === 'fr' && n === 1000000 ? 'other' : expected(l, n));
    expect(sampleFailures(noMany).some((f) => /locale fr, count 1000000:/.test(f)), 'the judge fails French with no many').toBe(true);
    const zeroIsOne = (l: Locale, n: number): Category | undefined => (l === 'en' && n === 0 ? 'one' : expected(l, n));
    expect(sampleFailures(zeroIsOne).some((f) => /locale en, count 0:/.test(f)), 'the judge fails English\'s one covering 0').toBe(true);

    // The pinned file, and the samples re-expressed here are its own.
    const text = vendored(PLURALS, PLURALS_SHA256);
    for (const locale of LOCALES) expect(fileSamples(text, locale), `the pinned file's ${locale} integer samples are the ones this lane re-expresses`).toEqual(SAMPLES[locale]);

    // Our code.
    const ev = temp();
    const program = countsProgram('plural-samples', COUNTS);
    putEvidence(ev, program.bytes);
    const COPY = DOC(1);
    const ref = (k: number): string => DOC(10 + k);
    const doc = film('cat', CAPTION_SIZE, [logicItem('rules', program, RULES_WRITES), caption({ copy: 'cat[rules.item]', args: [{ path: 'rules.count', widest: '9999999' }] })],
      { [`${program.name}_program`]: program.sha }, { locale: 'en', data: { copy: CAT } });
    const evals = LOCALES.flatMap((locale) => COUNTS.map((n, k) => ({ locale, n, call: evalCall(COPY, at(k), { locale }) })));
    const r = runShow(binOf(), scenario(ev, [...CATEGORIES.map((_, k) => ref(k)), COPY], [
      ...CATEGORIES.map((c, k) => showCall(ref(k), captionRef(`cat-${c}`, c))), ...CATEGORIES.map((_, k) => evalCall(ref(k), 0)),
      showCall(COPY, doc), ...evals.map((e) => e.call),
    ]), 'the Oracle lane\'s samples');
    CATEGORIES.forEach((c, k) => presented(r[k]!, `the caption reading "${c}"`));
    const refs = new Map(CATEGORIES.map((c, k) => [snapshotOf(r[CATEGORIES.length + k]!, `the caption reading "${c}"`), c]));
    expect(refs.size, 'the three category names draw three pictures').toBe(CATEGORIES.length);
    presented(r[2 * CATEGORIES.length]!, 'the copy document over cat');
    const shown = new Map(evals.map((e, i) => [`${e.locale} ${e.n}`, refs.get(snapshotOf(r[2 * CATEGORIES.length + 1 + i]!, `the caption in ${e.locale} at count ${e.n}`))]));
    none(sampleFailures((l, n) => shown.get(`${l} ${n}`)), 'every English and French integer sample on our copy');
  }, TIMEOUT);
});
