// #1956.9deb4e8e: "shelf.bookcase@2 renames levels to shelves and sets depth = old.width × 0.25, depth ranging 0.1 to
// 1.0 m: a corpus document at @1 with {width 2.0, levels 4} opens as @2 with {width 2.0, shelves 4, depth 0.5}, raises
// migrated naming its ID, and expands to the values recorded for it; its stored bytes stay as they were until its
// writer patches it; and once the pack moves the kind to @3, an @1 document is refused with a fix, naming both majors"
//
// asserts: in `r1`, with acme/shelf@1.0.0 and @2.0.0 installed (fixtures/packs/shelf-1.0.0, shelf-2.0.0), the @1 corpus
// document of 2.0.0 (case1 {width 2, levels 4}) presented under 2.0.0 has no error, raises exactly one `migrated`
// notice naming case1, from 1 to 2, and expands case1 as shelf.bookcase@2 to exactly the values its record holds (the
// plan strip 200 u wide and 50 u deep: width 2.0 and depth 0.5; four boards: shelves 4). `read` gives that revision's
// stored case1 still at @1 with {width 2, levels 4}. The same document seeded as a shared document in the working
// agent's layer reads back byte for byte as seeded; after that writer's patch (one rect added) its stored case1 is
// shelf.bookcase@2 with {width 2, shelves 4, depth 0.5}. Then, with 1.0.0 and 2.0.0 installed, acme/shelf@3.0.0 that
// moves the kind to @3 with only the @2-to-@3 step (fixtures/packs/shelf-3.0.0-drop) is refused with an error that
// names its @1 corpus document (its sha256 or case1), both majors (`from` 1 and `to` 3, or shelf.bookcase@1 and
// shelf.bookcase@3) and carries a fix (README: Readings).
// Wrong program: the merge base, whose pack check refuses acme/shelf@2.0.0 (a migration and a major past 1, and
// `corpus` as unknown_field).

import { expect, it } from 'vitest';
import {
  ALPHA_WRITER, DOC, ITEM, KIND, PACKS, V1, V2, V3_DROP, alphaAddsBox, at, corpusRecord, errors, expansionOf, field, issues, mentions,
  migratedOf, none, obj, ownErrors, packRow, pinned, present, readDoc, run, sameJson, scenario, show, str, useBinary, useEvidence,
  valuesFailures, type JsonObject, type PackFixture, type PackRow,
} from './helpers.ts';

const bin = useBinary();
const evidence = useEvidence();

/** The stored `case1` of a `read` reply's document. */
const storedCase = (reply: JsonObject, what: string): JsonObject =>
  obj(obj(obj(reply['document'], `${what}: document`)['items'], `${what}: document.items`)[ITEM], `${what}: the stored ${ITEM}`);

/**
 * The criterion's last clause (README: Readings): the pack version `p` that moves the kind to @3 without the @1-to-@2
 * step is refused with an error that names the @1 corpus document `sha` (or its item), both majors, and a fix.
 */
function oneToThreeFailures(row: PackRow, p: PackFixture, sha: string): string[] {
  if (row.state !== 'refused') return [`${at(p)} moves the kind to @3 with no @1-to-@2 step and was ${row.state}, so its @1 document was not refused`];
  const named = ownErrors(row).some((i) => {
    const document = mentions(i.raw, sha) || mentions(i.raw, ITEM);
    const majors = (field(i, 'from') === 1 && field(i, 'to') === 3) || (mentions(i.raw, KIND(1)) && mentions(i.raw, KIND(3)));
    const fix = i.fix.trim() !== '' && i.fix !== 'See the issue.';
    return document && majors && fix;
  });
  return named ? [] : [`${at(p)}'s refusal has no error naming the @1 document ${ITEM}, majors 1 and 3, with a fix: ${show(row.issues.map((i) => i.raw), 3000)}`];
}

it('#1956.9deb4e8e shelf.bookcase@2 opens the @1 corpus document {width 2.0, levels 4} as @2 {width 2.0, shelves 4, depth 0.5} with migrated naming case1 and its recorded values, keeps the stored bytes until its writer patches, and an @1 document is refused with a fix naming both majors once the kind moves to @3', () => {
  const b = bin();
  const c1 = corpusRecord(V2, 1);
  const saved = obj(obj(c1.document['items'], 'the @1 corpus document\'s items')[ITEM], `the @1 corpus document's ${ITEM}`);
  expect([saved['kind'], saved['params']], 'the fixture: a corpus document at @1 with {width 2.0, levels 4}').toEqual([KIND(1), { width: 2, levels: 4 }]);

  const seeded: JsonObject = {
    ...pinned(c1.document, V2),
    layers: { 'alpha-main': { writer: ALPHA_WRITER, title: 'Alpha', order: 'a1' } },
    items: { [ITEM]: { ...saved, layer: 'alpha-main' } },
  };
  const [packs, opened, storedShown, before, patched, after] = run(b, scenario(evidence(), [
    PACKS,
    present(DOC.a, pinned(c1.document, V2)),
    readDoc(DOC.a),
    readDoc(DOC.b),
    alphaAddsBox(DOC.b, 0),
    readDoc(DOC.b),
  ], { packs: [V1, V2], seed: seeded }));
  expect(packRow(packs!, V1).state, `acme/shelf@1.0.0 installs: ${show(packRow(packs!, V1).issues.map((i) => i.raw))}`).toBe('installed');
  expect(packRow(packs!, V2).state, `acme/shelf@2.0.0 installs: ${show(packRow(packs!, V2).issues.map((i) => i.raw), 3000)}`).toBe('installed');

  // Opens as @2, raises migrated naming case1, and expands to the values recorded for it.
  expect(errors(issues(opened!)).map((i) => i.raw), 'the @1 corpus document opens under acme/shelf@2.0.0 with no error').toEqual([]);
  const notices = migratedOf(opened!, ITEM);
  expect(notices.map((n) => [n.from, n.to]), `one migrated notice names ${ITEM}, from @1 to @2: ${show(opened!['notices'] ?? null)}`).toEqual([[1, 2]]);
  expect(str(notices[0]!.raw['kind'], 'the notice\'s kind'), 'the notice names the kind').toMatch(/^shelf\.bookcase/);
  const e = expansionOf(opened!, ITEM);
  expect(e.kind, `${ITEM} opens as shelf.bookcase@2`).toBe(KIND(2));
  none(valuesFailures(e.derived, c1.values), `${ITEM} expands to the values recorded for it (width 2.0, shelves 4 and depth 0.5 through @2's recipe)`);

  // The stored bytes stay as they were until the writer patches.
  const shownCase = storedCase(storedShown!, 'read of the presented revision');
  expect([shownCase['kind'], shownCase['params']], 'opening stores nothing migrated: the stored case1 is still @1 {width 2, levels 4}').toEqual([KIND(1), { width: 2, levels: 4 }]);
  const seededCase = obj(obj(seeded['items'], 'the seed\'s items')[ITEM], 'the seeded case1');
  expect(sameJson(storedCase(before!, 'read before the patch'), seededCase), `before its writer patches, the stored case1 is as seeded: ${show(storedCase(before!, 'read'))}`).toBe(true);
  expect(patched!['outcome'], `the working agent's patch applies: ${show(patched!, 2000)}`).toBe('applied');
  const migrated = storedCase(after!, 'read after the patch');
  expect(migrated['kind'], 'after its writer\'s patch the stored case1 is shelf.bookcase@2').toBe(KIND(2));
  expect(sameJson(migrated['params'], { width: 2, shelves: 4, depth: 0.5 }), `after its writer's patch the stored params are {width 2, shelves 4, depth 0.5}: ${show(migrated['params'])}`).toBe(true);

  // Once the pack moves the kind to @3 without the @1-to-@2 step, the @1 document is refused with a fix, naming both majors.
  const [moved] = run(b, scenario(evidence(), [PACKS], { packs: [V1, V2, V3_DROP] }));
  expect(packRow(moved!, V2).state, 'acme/shelf@2.0.0 installs before it').toBe('installed');
  none(oneToThreeFailures(packRow(moved!, V3_DROP), V3_DROP, corpusRecord(V3_DROP, 1).sha), 'an @1 document once the pack moves the kind to @3');
}, 1_800_000);
