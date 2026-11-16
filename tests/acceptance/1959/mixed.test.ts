// #1959.7ccdd727: "`mixed-versions.scene` holds a1 to a6 in writer A's layer, saved at @1 with {width 1.6, levels 4},
// and b1 to b6 in writer B's layer, saved at @2 with {width 1.6, shelves 4, depth 0.4}. It opens with all 12 at @3 as
// {span 1.6, shelves 4, depth 0.4} and every ID unchanged, `migrated` naming a1 to a6 for @1 to @2 and all 12 for @2 to
// @3. A planted loader that takes one saved major for the whole document raises `migrated` for b1 to b6 from @1 and
// fails, naming them"
//
// asserts: in `r1`, with acme/shelf@1.0.0, @2.0.0 and @3.0.0 installed (fixtures/packs), fixtures/mixed-versions.scene
// (the fixture itself checked first: a1–a6 in writer-a, writer A's layer, at shelf.bookcase@1 {width 1.6, levels 4};
// b1–b6 in writer-b, writer B's, at @2 {width 1.6, shelves 4, depth 0.4}) seeded as a shared document goes through the
// Scope's lifecycle: loaded (`read`), patched by writer A (one rect added), undone by writer A, and opened again after a
// restart (a second process on the same hub state folder). At every stage: every ID is unchanged (the 12 instances and
// the two tags are stored under their IDs, and each instance has its own expansion), each of the 12 expands as
// shelf.bookcase@3 to exactly the values acme/shelf@3.0.0's @3 corpus record holds for {span 1.6, shelves 4, depth 0.4}
// (its derived IDs under the instance's ID), the tags' references hold (tag-a, writer A's, hangs from b1; tag-b, writer
// B's, from a1) with no error raised, and `read`'s `migrated` notices are exactly one per step of each instance from the
// major it is stored at: at the load, a1–a6 from @1 to @2 and all 12 from @2 to @3 (the criterion's set). After writer
// A's patch its a1–a6 are stored at @3 as {span 1.6, shelves 4, depth 0.4}; the restart stores every item as the
// revision before it did. Under the planted loader `migration_one_major_per_document` the load's check fails with a
// failure naming each of b1–b6.
// Wrong programs: the merge base, whose `read` carries no `notices` and which knows no such planted value (bad_input);
// the planted loader.

import { expect, it } from 'vitest';
import {
  ALPHA, DOC, KIND, PACKS, V3, addsBox, allInstalled, corpusRecords, errors, expansionOf, isObject, issues, migratedSteps, namesId,
  none, obj, readDoc, run, sameJson, scenario, scene, show, soleItem, str, undoes, useBinary, useFolders, valuesFailures, valuesFor,
  type JsonObject, type JsonValue, type Step,
} from './helpers.ts';

const bin = useBinary();
const folders = useFolders();

const A = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
const B = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
const ALL = [...A, ...B];
/** The tags and the bookcase each hangs from: each writer's tag on the other writer's first bookcase. */
const TAGS: Record<string, string> = { 'tag-a': 'b1', 'tag-b': 'a1' };
const AT3 = { span: 1.6, shelves: 4, depth: 0.4 };
/** The `migrated` steps the load raises: a1–a6 from @1 to @2, all 12 from @2 to @3. */
const EXPECTED: Step[] = [...A.map((id) => ({ id, from: 1, to: 2, kind: '' })), ...ALL.map((id) => ({ id, from: 2, to: 3, kind: '' }))];
const key = (s: Step): string => `${s.id} @${s.from}→@${s.to}`;
/** The major an item is stored at, from its `kind`; 0 when it reads none. */
const majorOf = (item: JsonValue | undefined): number => Number((isObject(item) ? String(item['kind']) : '').match(/@(\d+)$/)?.[1] ?? 0);
/** Each instance migrated from its own stored major: one step per major up to @3. */
function fromStored(items: JsonObject): Step[] {
  return ALL.flatMap((id) => {
    const steps: Step[] = [];
    for (let m = majorOf(items[id]); m >= 1 && m < 3; m++) steps.push({ id, from: m, to: m + 1, kind: '' });
    return steps;
  });
}
const storedItems = (reply: JsonObject): JsonObject => (isObject(reply['document']) && isObject(reply['document']['items']) ? reply['document']['items'] : {});

/**
 * The criterion's check at one stage of the lifecycle, on that stage's `read`: each failure names the item it is about.
 * `want` is the `migrated` steps the stage must raise, exactly; `aMigrated` asks that writer A's a1–a6 be stored at @3.
 */
function stageFailures(reply: JsonObject, stage: string, values: JsonObject, want: Step[], aMigrated = false): string[] {
  const failures: string[] = [];
  const items = storedItems(reply);
  // Every ID unchanged: the 12 instances and the two tags, and each instance's own expansion.
  for (const id of [...ALL, ...Object.keys(TAGS)]) if (!isObject(items[id])) failures.push(`${stage}: ${id} is not stored under its ID`);
  for (const id of ALL) {
    const e = expansionOf(reply, id);
    if (!e) { failures.push(`${stage}: ${id} has no expansion of its own`); continue; }
    if (e.kind !== KIND(3)) failures.push(`${stage}: ${id} opens as ${e.kind}, not ${KIND(3)}`);
    for (const f of valuesFailures(e.derived, valuesFor(values, 'case1', id))) failures.push(`${stage}: ${id} doesn't evaluate as {span 1.6, shelves 4, depth 0.4}: ${f}`);
  }
  // References: each tag still hangs from the other writer's bookcase, and nothing is unresolved or refused.
  for (const [tag, parent] of Object.entries(TAGS)) {
    const t = items[tag];
    if (isObject(t) && t['parent'] !== parent) failures.push(`${stage}: ${tag} hangs from ${show(t['parent'] ?? null)}, not ${parent}`);
  }
  for (const i of errors(issues(reply, `${stage}: read`))) failures.push(`${stage}: an error is raised: ${show(i.raw, 600)}`);
  if (aMigrated) {
    for (const id of A) {
      const got = items[id];
      if (isObject(got) && (got['kind'] !== KIND(3) || !sameJson(got['params'], AT3))) {
        failures.push(`${stage}: after writer A's patch its ${id} is stored as ${show(got['kind'] ?? null)} ${show(got['params'] ?? null)}, not ${KIND(3)} {span 1.6, shelves 4, depth 0.4}`);
      }
    }
  }
  // The `migrated` notices: exactly `want`, each item from its own major.
  const raised = migratedSteps(reply).filter((s) => ALL.includes(s.id));
  const wanted = new Set(want.map(key));
  const got = new Set(raised.map(key));
  for (const s of raised) {
    if (!wanted.has(key(s))) failures.push(`${stage}: ${s.id} raised migrated from @${s.from} to @${s.to}, and it is stored at @${majorOf(items[s.id])}`);
    else if (!s.kind.startsWith('shelf.bookcase')) failures.push(`${stage}: ${s.id}'s migrated notice names the kind ${show(s.kind)}`);
  }
  for (const s of want) if (!got.has(key(s))) failures.push(`${stage}: ${s.id} raised no migrated from @${s.from} to @${s.to}; the notices: ${show(reply['notices'] ?? null, 600)}`);
  return failures;
}

/** The fixture is what the criterion says: a1–a6 in writer A's layer at @1, b1–b6 in writer B's at @2. */
function checkScene(doc: JsonObject): void {
  const layers = obj(doc['layers'], 'the scene\'s layers');
  const items = obj(doc['items'], 'the scene\'s items');
  const writerOf = (layer: string): string => str(obj(layers[layer], `layer ${layer}`)['writer'], `layer ${layer}'s writer`);
  expect(writerOf('writer-a'), 'writer-a is writer A\'s layer').toBe(`agent:${ALPHA.thread}`);
  expect(writerOf('writer-b'), 'writer-b is another writer\'s layer').not.toBe(writerOf('writer-a'));
  const instances = Object.entries(items).filter(([, v]) => isObject(v) && String(v['kind']).startsWith('shelf.bookcase@'));
  expect(instances.map(([id]) => id).sort(), 'the scene holds exactly 12 instances, a1 to a6 and b1 to b6').toEqual([...ALL].sort());
  const fields = (id: string): JsonValue[] => { const i = obj(items[id], id); return [i['layer'] ?? null, i['kind'] ?? null, i['params'] ?? null]; };
  for (const id of A) expect(fields(id), `${id}, writer A's, saved at @1`).toEqual(['writer-a', KIND(1), { width: 1.6, levels: 4 }]);
  for (const id of B) expect(fields(id), `${id}, writer B's, saved at @2`).toEqual(['writer-b', KIND(2), { width: 1.6, shelves: 4, depth: 0.4 }]);
  expect(doc['packs'], 'the scene names acme/shelf@3.0.0').toEqual(['acme/shelf@3.0.0']);
}

/** acme/shelf@3.0.0's @3 corpus record: {span 1.6, shelves 4, depth 0.4}, the values a migrated instance must give. */
function at3Values(): JsonObject {
  const [record] = corpusRecords(V3, 3);
  const [id, item] = soleItem(record!.document, 'the @3 corpus document');
  expect([id, item['kind'], item['params']], 'the fixture: the @3 corpus record is case1 {span 1.6, shelves 4, depth 0.4}').toEqual(['case1', KIND(3), AT3]);
  return record!.values;
}

it('#1959.7ccdd727 mixed-versions.scene opens a1–a6 (writer A, @1) and b1–b6 (writer B, @2) all at @3 as {span 1.6, shelves 4, depth 0.4} with every ID unchanged and migrated naming a1–a6 for @1 to @2 and all 12 for @2 to @3, loaded, patched, undone and reopened after a restart', () => {
  const b = bin();
  const doc = scene();
  checkScene(doc);
  const values = at3Values();
  const state = folders.state();

  const [packs, loaded, patched, afterPatch, undone, afterUndo] = run(b, scenario(folders.evidence(), [
    PACKS, readDoc(DOC), addsBox(ALPHA, DOC, 1, 0), readDoc(DOC), undoes(ALPHA, DOC, 2, 1), readDoc(DOC),
  ], { seed: doc, state }));
  allInstalled(packs!);
  none(stageFailures(loaded!, 'loaded', values, EXPECTED), 'the load');
  expect(patched!['outcome'], `writer A's patch applies: ${show(patched!, 2000)}`).toBe('applied');
  none(stageFailures(afterPatch!, 'patched', values, fromStored(storedItems(afterPatch!)), true), 'after writer A\'s patch');
  expect(undone!['outcome'], `writer A's undo applies: ${show(undone!, 2000)}`).toBe('applied');
  none(stageFailures(afterUndo!, 'undone', values, fromStored(storedItems(afterUndo!))), 'after writer A\'s undo');

  const [packsAgain, restarted] = run(b, scenario(folders.evidence(), [PACKS, readDoc(DOC)], { seed: doc, state }));
  allInstalled(packsAgain!);
  expect(restarted!['rev'], 'the restart opens the revision the undo made').toBe(afterUndo!['rev']);
  expect(sameJson(storedItems(restarted!), storedItems(afterUndo!)), `the restart stores every item as before it: ${show(storedItems(restarted!), 1500)}`).toBe(true);
  none(stageFailures(restarted!, 'restarted', values, fromStored(storedItems(restarted!))), 'after a restart');
}, 1_800_000);

it('#1959.7ccdd727 a planted loader that takes one saved major for the whole document (migration_one_major_per_document) raises migrated for b1–b6 from @1 and fails, naming them', () => {
  const b = bin();
  const doc = scene();
  checkScene(doc);
  const values = at3Values();
  const [packs, loaded] = run(b, scenario(folders.evidence(), [PACKS, readDoc(DOC)], { seed: doc, planted: 'migration_one_major_per_document' }));
  allInstalled(packs!);
  const fromOne = migratedSteps(loaded!).filter((s) => B.includes(s.id) && s.from === 1).map((s) => s.id).sort();
  expect(fromOne, `the planted loader raises migrated for b1 to b6 from @1: ${show(loaded!['notices'] ?? null)}`).toEqual(B);
  const failures = stageFailures(loaded!, 'loaded', values, EXPECTED);
  for (const id of B) expect(failures.some((f) => namesId(f, id)), `the check fails naming ${id}:\n  ${failures.join('\n  ')}`).toBe(true);
}, 1_800_000);
