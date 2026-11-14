// AC5 #538.c737d5fc: A mark set of 30 labels whose text column looks names up by a kind column read from a logic array
// shows each row's name in en, and switching the view's locale to fr changes every label with no logic step and no change
// to the document's hash; a row whose kind the table lacks raises copy.missing for that row alone, and the other 29 still
// show their names; a planted text module that keeps each row's en string after the switch fails, naming the first row
//
// The labels (fixtures.ts `labelsDoc`): `labels`, 30 text rows in three columns of ten, each in a 200 × 40 band of its
// own, the text column `{copy: kinds, key: kind}` over `kinds` (ten names in en, ten others in fr), the kind column
// `units.kind` (programs.ts `unitsProgram`: row i kind i mod 10; row 17 kind 42, which the table lacks, from step 30).
// One live session: `eval` at step 10 in the document's locale (en), then at step 10 with the view's locale fr, then at
// step 30 in en. "Shows its name" is the row's band hashing as the same band of the same rows with the names written out
// and no logic (`labelsRef`); "changes every label" is every band of the fr frame hashing as the fr reference's. "No
// logic step": the fr frame's `steps` hold no step of the logic module. "No change to the document's hash": `revisions`
// before and after the switch are the same. The missing row's band draws nothing; the issue is `eval`'s at step 30.
import { describe, expect, it } from 'vitest';
import { LABELS, LOST, kindAt, unitsProgram } from './programs.ts';
import { NAMES, labelsDoc, labelsRef, rowBand } from './fixtures.ts';
import {
  AC, DOC, TIMEOUT, arr, at, binOf, evalCall, failsNaming, field, inked, isObject, issuesOf, names, none, pngOf, prebuild, presented, putEvidence,
  regionHash, runShow, scenario, show, showCall, snapshotOf, useTemp, type Image, type JsonObject, type Planted,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();
const D = { labels: DOC(1), en: DOC(2), fr: DOC(3) };
const SHOWN = 10;
const rows = Array.from({ length: LABELS }, (_, i) => i);
const namesAt = (locale: 'en' | 'fr', k: number): string[] => rows.map((i) => NAMES[locale][kindAt(i, k) % 10]!);

interface Run { replies: JsonObject[]; en: Image; fr: Image; miss: Image; refEn: Image; refFr: Image }
function labelsRun(planted?: Planted): Run {
  const ev = temp();
  const program = unitsProgram();
  putEvidence(ev, program.bytes);
  const calls: JsonObject[] = [
    showCall(D.en, labelsRef('labels-en', namesAt('en', SHOWN))), showCall(D.fr, labelsRef('labels-fr', namesAt('fr', SHOWN))), evalCall(D.en, 0), evalCall(D.fr, 0, { locale: 'fr' }),
    showCall(D.labels, labelsDoc(program)), evalCall(D.labels, at(SHOWN)), { call: 'revisions', doc: D.labels },
    evalCall(D.labels, at(SHOWN), { locale: 'fr' }), { call: 'revisions', doc: D.labels },
    evalCall(D.labels, at(LOST.from), { locale: 'en' }),
  ];
  const r = runShow(binOf(), scenario(ev, Object.values(D), calls, planted), 'AC5 the labels');
  presented(r[0]!, 'the 30 en names written out, with no logic');
  presented(r[1]!, 'the 30 fr names written out, with no logic');
  presented(r[4]!, 'the labels');
  const png = (k: number, what: string): Image => pngOf(ev, snapshotOf(r[k]!, what), what);
  return {
    replies: r, refEn: png(2, 'the en names'), refFr: png(3, 'the fr names'),
    en: png(5, 'the labels at step 10 in en'), fr: png(7, 'the labels at step 10 in fr'), miss: png(9, 'the labels at step 30 in en'),
  };
}
/** The judge: each row's band against the reference's, in row order; a failure names the row. */
function rowFailures(shot: Image, ref: Image, locale: string, skip: number[] = []): string[] {
  return rows.filter((i) => !skip.includes(i) && regionHash(shot, rowBand(i)) !== regionHash(ref, rowBand(i)))
    .map((i) => `row ${i} (labels#${i}) in ${locale}: its label isn't ${JSON.stringify(namesAt(locale === 'fr' ? 'fr' : 'en', SHOWN)[i])}`);
}

describe(`${AC[5]} 30 labels looked up by a kind from logic, and the view's locale`, () => {
  it(`${AC[5]} every row shows its name in en, and in fr after the switch with no logic step and no change to the document's hash; a kind the table lacks raises copy.missing for that row alone while the other 29 show their names`, () => {
    const run = labelsRun();
    const r = run.replies;
    none(rowFailures(run.en, run.refEn, 'en'), 'the 30 labels at step 10 in en');
    none(rowFailures(run.fr, run.refFr, 'fr'), 'the 30 labels at step 10 after the switch to fr');
    const steps = arr(r[7]!['steps'], 'the fr frame\'s steps').filter((s) => isObject(s) && s['module'] === 'logic');
    expect(steps, 'switching the view\'s locale runs no logic step').toEqual([]);
    const before = arr(r[6]!['revisions'], 'the revisions before the switch');
    expect(before.length, `the labels have a revision: ${show(r[6])}`).toBeGreaterThan(0);
    expect(r[8]!['revisions'], 'switching the view\'s locale changes no revision, so the document\'s hash is the same').toEqual(before);

    none(rowFailures(run.miss, run.refEn, 'en', [LOST.row]), 'the other 29 labels at step 30, when row 17\'s kind is 42');
    expect(inked(run.miss, rowBand(LOST.row)), 'row 17, whose kind 42 the table lacks, shows the missing string, empty: its band draws nothing').toBe(0);
    const raised = issuesOf(r[9]!).filter((i) => i['code'] === 'copy.missing');
    expect(raised.length, `one copy.missing at step 30, for row 17 alone: ${show(issuesOf(r[9]!), 2500)}`).toBe(1);
    const missing = raised[0]!;
    expect([names(String(field(missing, 'table')), 'kinds'), field(missing, 'key'), field(missing, 'step')], `it names the table kinds, the key 42 and step 30: ${show(missing)}`).toEqual([true, LOST.kind, LOST.from]);
  }, TIMEOUT);

  it(`${AC[5]} planted labels_keep_first_locale keeps each row's en string after the switch and fails, naming the first row`, () => {
    const run = labelsRun('labels_keep_first_locale');
    const failures = rowFailures(run.fr, run.refFr, 'fr');
    expect(rows.every((i) => regionHash(run.fr, rowBand(i)) === regionHash(run.refEn, rowBand(i))), 'under the planted text module every label still shows its en name after the switch').toBe(true);
    failsNaming(failures, [/row 0 \(labels#0\)/], 'the labels under labels_keep_first_locale');
    expect(failures[0], 'the first failure names the first row').toMatch(/^row 0 \(labels#0\)/);
  }, TIMEOUT);
});
