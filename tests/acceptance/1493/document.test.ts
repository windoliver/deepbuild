// AC7, AC8 and AC9 (README: document.test.ts): the document check looks an unknown field up in each installed pack's
// census. Each test runs one `deep-show run` scenario: install acme/names@1.0.0, show a board of one hidden test.dot@1
// that names no pack, read DOC's revisions, show it again with one field set that test.dot@1 doesn't define, and read the
// revisions again. The right program's replies must pass the criterion's judge; each planted program's (`deep-show run
// --planted <name>`) must fail it, naming the field or the word.

import { describe, expect, it } from 'vitest';

import {
  documentCalls, kindBeforePackFailures, mapsFailures, namesWord, refusesFailures, runShow, scenario, setupFailures, sub, useShow, useTemp, writeNames,
  type NamesPack,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();

/** The replies of the document scenario for `field` set to `value`, on the right program or a planted one. */
function replies(p: NamesPack, field: string, value: number | boolean, planted?: string) {
  const out = runShow(bin(), scenario(sub(temp(), `evidence-${planted ?? 'right'}`), documentCalls(p, field, value)), planted);
  expect(setupFailures(out, p), `the setup holds${planted ? ` under --planted ${planted}` : ''}`).toEqual([]);
  return out;
}

/** At least one failure, and one naming `word`: what a planted program must give. */
function failsNaming(failures: string[], word: string, what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  expect(failures.some((f) => namesWord(f, word)), `${what}: a failure names ${word}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
}

const AC7 = '#1493.fcddaf21';
describe(`${AC7} a word some installed pack maps is refused unless the document names that pack`, () => {
  it(`${AC7} bevelDepth, which acme/names maps, set on a test.dot@1 in a document that names no pack is refused with unknown_field whose fix names the pack, the target field and the conversion, and the revision stays; census_accepts and census_skipped each fail, naming it`, () => {
    const p = writeNames(temp(), '1.0.0');
    const field = 'bevelDepth';
    const right = mapsFailures(replies(p, field, 0.05), p, field);
    expect(right, `the right program:\n  ${right.join('\n  ')}`).toEqual([]);
    failsNaming(mapsFailures(replies(p, field, 0.05, 'census_accepts'), p, field), field, 'the planted census_accepts, which accepts the word as its target');
    failsNaming(mapsFailures(replies(p, field, 0.05, 'census_skipped'), p, field), field, 'the planted census_skipped, which skips the census');
  }, 3_600_000);
});

const AC8 = '#1493.1d536b9e';
describe(`${AC8} a word the census refuses is refused with the row's reason`, () => {
  it(`${AC8} autoUpdate, refused in acme/names's census for imperative, set on a test.dot@1 is refused with that reason in the fix`, () => {
    const p = writeNames(temp(), '1.0.0');
    const failures = refusesFailures(replies(p, 'autoUpdate', true), p, 'autoUpdate', 'imperative');
    expect(failures, `the right program:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, 3_600_000);
});

const AC9 = '#1493.4db739b5';
describe(`${AC9} a kind in the build that defines the field comes before a pack that maps it`, () => {
  it(`${AC9} w, which test.rect@1 defines and acme/names maps, set on a test.dot@1 gives a fix naming test.rect@1 first and the pack after it; census_pack_first fails, naming the field`, () => {
    const p = writeNames(temp(), '1.0.0');
    const right = kindBeforePackFailures(replies(p, 'w', 10), p, 'w', 'test.rect@1');
    expect(right, `the right program:\n  ${right.join('\n  ')}`).toEqual([]);
    failsNaming(kindBeforePackFailures(replies(p, 'w', 10, 'census_pack_first'), p, 'w', 'test.rect@1'), 'w', 'the planted census_pack_first, which names the pack first');
  }, 3_600_000);
});
