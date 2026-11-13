// AC2 #538.04486d9f: A text item {copy: loot[rules.item], args: [{path: rules.count, widest: '999'}]} over a copy table
// loot whose key 17 is {one: 'You found {0} gold coin', other: 'You found {0} gold coins'} in en and {one: 'Vous trouvez
// {0} pièce d'or', other: 'Vous trouvez {0} pièces d'or'} in fr shows, with rules.item 17 and rules.count 12, 'You found
// 12 gold coins' in en and 'Vous trouvez 12 pièces d'or' in fr; with 1, the one forms; and with 0, 'You found 0 gold
// coins' in en and 'Vous trouvez 0 pièce d'or' in fr, since French's one covers 0 and 1; a planted plural rule that
// applies English's to French shows 'pièces' for 0 and fails, naming the locale and the count
//
// The copy document (fixtures.ts `copyDoc`): `caption` over `loot`, fed by `rules` (programs.ts `lootProgram`: item 17,
// count 12 at step 5, 1 at step 15, 0 at step 25). "Shows S" is the pixel hash of the frame `eval` draws at that step in
// the view's locale (`view: {locale}`), against the hash of the same caption with S written as its text and no logic
// (`captionRef`): one shaper and one renderer draw both, so equal strings draw equal pixels and any other string doesn't.
import { describe, expect, it } from 'vitest';
import { LOOT, lootProgram } from './programs.ts';
import { KEY17, captionRef, copyDoc, formOf, pluralTables } from './fixtures.ts';
import {
  AC, DOC, TIMEOUT, at, binOf, evalCall, failsNaming, none, prebuild, presented, putEvidence, runShow, scenario, showCall, snapshotOf, useTemp,
  type JsonObject, type Planted,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();

interface Case { locale: 'en' | 'fr'; n: number; step: number; text: string }
/** The criterion's six strings, as it writes them. */
const CASES: Case[] = [
  { locale: 'en', n: 12, step: LOOT.twelve, text: 'You found 12 gold coins' },
  { locale: 'fr', n: 12, step: LOOT.twelve, text: 'Vous trouvez 12 pièces d\'or' },
  { locale: 'en', n: 1, step: LOOT.one, text: formOf(KEY17.en.one, 1) },
  { locale: 'fr', n: 1, step: LOOT.one, text: formOf(KEY17.fr.one, 1) },
  { locale: 'en', n: 0, step: LOOT.zero, text: 'You found 0 gold coins' },
  { locale: 'fr', n: 0, step: LOOT.zero, text: 'Vous trouvez 0 pièce d\'or' },
];
/** What English's rule would show in French for 0: the planted rule's string. */
const PIECES_0 = 'Vous trouvez 0 pièces d\'or';
/** Each string once, drawn in its own locale's view. */
const REFS: { text: string; locale: 'en' | 'fr' }[] = [...CASES.map((c) => ({ text: c.text, locale: c.locale })), { text: PIECES_0, locale: 'fr' }];
const COPY = DOC(1);
const refDoc = (k: number): string => DOC(10 + k);

interface Shot { c: Case; hash: string }
function copyRun(planted?: Planted): { shots: Shot[]; refs: Map<string, string> } {
  const ev = temp();
  const program = lootProgram();
  putEvidence(ev, program.bytes);
  const calls: JsonObject[] = [
    ...REFS.map(({ text }, k) => showCall(refDoc(k), captionRef(`ref-${k}`, text))),
    ...REFS.map(({ locale }, k) => evalCall(refDoc(k), 0, { locale })),
    showCall(COPY, copyDoc(program, pluralTables())),
    ...CASES.map((c) => evalCall(COPY, at(c.step), { locale: c.locale })),
  ];
  const r = runShow(binOf(), scenario(ev, [...REFS.map((_, k) => refDoc(k)), COPY], calls, planted), 'AC2 the plural copy');
  REFS.forEach(({ text }, k) => presented(r[k]!, `the caption reading "${text}", with no logic`));
  const refs = new Map(REFS.map(({ text }, k) => [snapshotOf(r[REFS.length + k]!, `the caption reading "${text}"`), text]));
  expect(refs.size, 'the seven references draw seven different pictures').toBe(REFS.length);
  presented(r[2 * REFS.length]!, 'the copy document');
  const shots = CASES.map((c, k) => ({ c, hash: snapshotOf(r[2 * REFS.length + 1 + k]!, `the caption in ${c.locale} at step ${c.step}`) }));
  return { shots, refs };
}
/** The judge: each case's frame is its string's reference; a failure names the locale and the count. */
function copyFailures(shots: Shot[], refs: Map<string, string>): string[] {
  return shots.filter(({ c, hash }) => refs.get(hash) !== c.text).map(({ c, hash }) => {
    const shown = refs.get(hash);
    return `locale ${c.locale}, count ${c.n} (rules.count ${c.n} at step ${c.step}): shows ${shown === undefined ? 'a frame no reference draws' : JSON.stringify(shown)}, not ${JSON.stringify(c.text)}`;
  });
}

describe(`${AC[2]} keyed copy with plural forms in en and fr`, () => {
  it(`${AC[2]} with rules.item 17 the caption shows key 17's form for 12, 1 and 0 in en and in fr: other, one, and in fr one for 0`, () => {
    const { shots, refs } = copyRun();
    none(copyFailures(shots, refs), 'the caption in en and fr at counts 12, 1 and 0');
  }, TIMEOUT);

  it(`${AC[2]} planted plural_en_rule_for_fr shows 'pièces' for 0 in fr and fails, naming the locale and the count`, () => {
    const { shots, refs } = copyRun('plural_en_rule_for_fr');
    const fr0 = shots.find(({ c }) => c.locale === 'fr' && c.n === 0)!;
    expect(refs.get(fr0.hash), 'under the planted rule, fr at count 0 shows "Vous trouvez 0 pièces d\'or"').toBe(PIECES_0);
    failsNaming(copyFailures(shots, refs), [/locale fr\b/, /count 0\b/], 'the caption under plural_en_rule_for_fr');
  }, TIMEOUT);
});
