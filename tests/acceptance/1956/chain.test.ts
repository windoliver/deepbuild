// #1956.e6c1b60f: "shelf.bookcase@3, whose pack keeps the @1-to-@2 step and adds @2-to-@3, opens a corpus document
// saved at @1 as @3 through both steps, with one `migrated` notice per step and the values recorded for it; a pack
// version that ships only the @2-to-@3 step is refused at pack check, naming the kind and the dropped step"
//
// asserts: in `r1`, with acme/shelf@1.0.0, @2.0.0 and @3.0.0 installed (fixtures/packs/shelf-1.0.0, shelf-2.0.0,
// shelf-3.0.0), the @1 corpus document of 3.0.0 (case1 {width 2, levels 4}) presented under 3.0.0 has no error,
// raises exactly two `migrated` notices naming case1, from 1 to 2 and from 2 to 3, and expands case1 as
// shelf.bookcase@3 to exactly the values its record holds. With 1.0.0 and 2.0.0 installed, the 3.0.0 that ships only
// the @2-to-@3 step (fixtures/packs/shelf-3.0.0-drop) is refused with an error that names shelf.bookcase@3 and the
// dropped step: at the path ending `migrate/1`, or with `from` 1 and `to` 2.
// Wrong program: the merge base, whose pack check refuses both 2.0.0 and 3.0.0 for their migrations alone (left out
// of the refusals read here).

import { expect, it } from 'vitest';
import {
  DOC, ITEM, KIND, PACKS, V1, V2, V3, V3_DROP, at, corpusRecord, errors, expansionOf, field, issues, mentions, migratedOf, none, obj, ownErrors,
  packRow, pinned, present, run, scenario, show, useBinary, useEvidence, valuesFailures,
} from './helpers.ts';

const bin = useBinary();
const evidence = useEvidence();

it('#1956.e6c1b60f shelf.bookcase@3 keeping the @1-to-@2 step opens the @1 corpus document as @3 with one migrated notice per step and its recorded values, and a version shipping only the @2-to-@3 step is refused naming the kind and the dropped step', () => {
  const b = bin();
  const c1 = corpusRecord(V3, 1);
  const saved = obj(obj(c1.document['items'], 'the @1 corpus document\'s items')[ITEM], `the @1 corpus document's ${ITEM}`);
  expect([saved['kind'], saved['params']], 'the fixture: a corpus document saved at @1').toEqual([KIND(1), { width: 2, levels: 4 }]);

  const [packs, opened] = run(b, scenario(evidence(), [PACKS, present(DOC.a, pinned(c1.document, V3))], { packs: [V1, V2, V3] }));
  for (const p of [V1, V2, V3]) expect(packRow(packs!, p).state, `${at(p)} installs: ${show(packRow(packs!, p).issues.map((i) => i.raw), 3000)}`).toBe('installed');
  expect(errors(issues(opened!)).map((i) => i.raw), 'the @1 corpus document opens under acme/shelf@3.0.0 with no error').toEqual([]);
  const steps = migratedOf(opened!, ITEM).map((n) => [n.from, n.to]).sort((x, y) => x[0]! - y[0]!);
  expect(steps, `one migrated notice per step names ${ITEM}, @1 to @2 and @2 to @3: ${show(opened!['notices'] ?? null)}`).toEqual([[1, 2], [2, 3]]);
  const e = expansionOf(opened!, ITEM);
  expect(e.kind, `${ITEM} opens as shelf.bookcase@3`).toBe(KIND(3));
  none(valuesFailures(e.derived, c1.values), `${ITEM}, migrated through both steps, expands to the values recorded for it`);

  const [dropped] = run(b, scenario(evidence(), [PACKS], { packs: [V1, V2, V3_DROP] }));
  for (const p of [V1, V2]) expect(packRow(dropped!, p).state, `${at(p)} installs before it`).toBe('installed');
  const row = packRow(dropped!, V3_DROP);
  expect(row.state, `${at(V3_DROP)} ships only the @2-to-@3 step and is refused at pack check`).toBe('refused');
  const named = ownErrors(row).some((i) => mentions(i.raw, KIND(3)) && (i.path.endsWith('migrate/1') || (field(i, 'from') === 1 && field(i, 'to') === 2)));
  expect(named, `the refusal names shelf.bookcase@3 and the dropped @1-to-@2 step: ${show(row.issues.map((i) => i.raw), 3000)}`).toBe(true);
}, 1_800_000);
