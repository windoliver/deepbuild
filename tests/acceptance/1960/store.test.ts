// #1960.40e69d87: "Writer A's patch sets `items/a3/params/shelves` to 5. After a restart a3 opens with shelves 5,
// `migrated` names only b1 to b6, for @2 to @3, and writer B's layer file has the hash it had before the patch. A's
// undo of that patch and a second restart give a3 shelves 4 and, at the 101 times, the evaluated values of the first
// load. A planted store that writes A's migrated params under the saved major raises `migrated` for a1 again and
// fails, naming it"
//
// asserts: in `r1`, with acme/shelf@1.0.0, @2.0.0 and @3.0.0 offered in that order (fixtures/packs) and acme/shelf@3.0.0
// installed, fixtures/mixed-versions.scene (the fixture checked first; a3 saved with levels 4) seeded as a shared
// document goes through the Scope's lifecycle in three processes on one hub state folder. Process 1, the first load:
// a3 opens with shelves 4, the channel and the driver give the values recorded for them at the 101 times, and `read`'s
// `files` gives writer B's layer file a hash; then writer A's patch, one `set` of items/a3/params/shelves to 5,
// applies. Process 2, a restart: a3 opens as shelf.bookcase@3 with shelves 5, `read`'s `migrated` notices name exactly
// b1 to b6, each for @2 to @3, writer B's layer file has the hash it had before the patch, and no error is raised;
// then writer A's undo of that patch applies. Process 3, a second restart: a3 opens with shelves 4, each of the 12
// instances expands to what it did at the first load, the channel and the driver give at each of the 101 times the
// value they gave at the first load, and no error is raised. Under the planted store
// `store_migrated_params_under_saved_major` the patch still applies, the restart raises `migrated` for a1 again, and the
// restart's check fails with a failure naming a1.
// Wrong programs: the merge base, where the scene's paths are left unresolved, the first load gives neither recorded
// value and writer A's patch on a3, saved at an earlier major, is refused, and which knows no such planted value
// (bad_input); the planted store.

import { expect, it } from 'vitest';
import {
  ALPHA, A_IDS, B_IDS, DOC, EVALUATED, KIND, PACKS, TIMES_101, V3, at, checkedRecorded, checkedScene, errors, evaluatedFailures, expansionOf,
  installFailures, issues, migratedSteps, namesId, none, readDoc, run, sameJson, scenario, sets, shelvesOf, show, str, undoes, useBinary,
  useFolders, valuesAt, valuesOf, type JsonObject, type Step,
} from './helpers.ts';

const bin = useBinary();
const folders = useFolders();

const ALL = [...A_IDS, ...B_IDS];
const PLANTED = 'store_migrated_params_under_saved_major';
/** Writer A's patch 1 on revision 0: a3's shelves set to 5. */
const PATCH = sets(ALPHA, DOC, 1, 0, 'a3', 'items/a3/params/shelves', 5, 'a3 gets a fifth shelf');
/** Writer A's undo of that patch, as patch 2. */
const UNDO = undoes(ALPHA, DOC, 2, 1);
const key = (s: Step): string => `${s.id} @${s.from}→@${s.to}`;
/** The `migrated` steps a load after writer A's patch raises: b1 to b6, each for @2 to @3, and no other. */
const AFTER_PATCH: string[] = B_IDS.map((id) => key({ id, from: 2, to: 3, kind: '' }));

/** An error for each error issue a `read` raises: the scene's references hold at every stage. */
const errorFailures = (stage: string, reply: JsonObject): string[] => errors(issues(reply, `${stage}: read`)).map((i) => `${stage}: an error is raised: ${show(i.raw, 600)}`);
/** A failure unless `id` opens as shelf.bookcase@3 with `shelves`. */
function shelvesFailures(stage: string, reply: JsonObject, id: string, shelves: number): string[] {
  const kind = expansionOf(reply, id)?.kind ?? null;
  const got = shelvesOf(reply, id) ?? null;
  return kind === KIND(3) && got === shelves ? [] : [`${stage}: ${id} opens as ${show(kind)} with shelves ${show(got)}, not ${KIND(3)} with shelves ${shelves}`];
}
/** Writer B's layer file's hash, as `read`'s `files` gives it. */
const fileOfB = (reply: JsonObject): string => str(at(reply['files'], 'writer-b'), 'read: files[writer-b], writer B\'s layer file\'s hash');

/**
 * The criterion's check on the restart after writer A's patch: a3 with shelves 5, `migrated` naming only b1 to b6 for
 * @2 to @3, writer B's layer file at the hash it had before the patch, and no error. Each failure names what it is
 * about: an item, or writer B's layer file.
 */
function restartFailures(restarted: JsonObject, bBefore: string): string[] {
  const stage = 'after the restart';
  const failures = shelvesFailures(stage, restarted, 'a3', 5);
  const raised = migratedSteps(restarted).filter((s) => ALL.includes(s.id));
  for (const s of raised) {
    if (!AFTER_PATCH.includes(key(s))) failures.push(`${stage}: ${s.id} raised migrated from @${s.from} to @${s.to} again, and writer A's patch stored it migrated`);
    else if (!s.kind.startsWith('shelf.bookcase')) failures.push(`${stage}: ${s.id}'s migrated notice names the kind ${show(s.kind)}`);
  }
  const got = raised.map(key);
  for (const want of AFTER_PATCH) if (got.filter((k) => k === want).length !== 1) failures.push(`${stage}: migrated names ${want} ${got.filter((k) => k === want).length} times, not once; the notices: ${show(restarted['notices'] ?? null, 600)}`);
  const bAfter = fileOfB(restarted);
  if (bAfter !== bBefore) failures.push(`${stage}: writer B's layer file has the hash ${bAfter}, and before the patch it had ${bBefore}`);
  return [...failures, ...errorFailures(stage, restarted)];
}

/**
 * The criterion's check on the second restart, after writer A's undo: a3 with shelves 4 and the evaluated values of
 * the first load, each instance's expansion and the channel's and the driver's values at the 101 times. The first
 * load is held to a3's shelves 4 and to the values recorded for the channel and the driver, so the values the second
 * restart gives again are evaluated ones.
 */
function undoneFailures(again: JsonObject, againValues: JsonObject, first: JsonObject, firstValues: JsonObject, recorded: { channel: number[]; driver: number[] }): string[] {
  const stage = 'after the undo and a second restart';
  const failures = [...shelvesFailures('the first load', first, 'a3', 4), ...evaluatedFailures(firstValues, recorded, 'the value recorded for it').map((f) => `the first load: ${f}`)];
  failures.push(...shelvesFailures(stage, again, 'a3', 4));
  for (const id of ALL) {
    const [now, then] = [expansionOf(again, id), expansionOf(first, id)];
    if (!now || !then || !sameJson(now.derived, then.derived)) failures.push(`${stage}: ${id} doesn't expand to what it did at the first load: ${show(now?.derived ?? null, 400)}`);
  }
  failures.push(...evaluatedFailures(againValues, { channel: valuesOf(firstValues, EVALUATED[0]!), driver: valuesOf(firstValues, EVALUATED[1]!) }, 'its value at the first load').map((f) => `${stage}: ${f}`));
  return [...failures, ...errorFailures(stage, again)];
}

/** One process on the hub state folder: the three versions offered, the scene seeded, `calls` after `packs`. */
function hub(state: string, doc: JsonObject, calls: JsonObject[], planted?: string): JsonObject[] {
  const [packs, ...replies] = run(bin(), scenario(folders.evidence(), [PACKS, ...calls], { seeds: { [DOC]: doc }, state, ...(planted ? { planted } : {}) }));
  none(installFailures(packs!, [V3]), 'the scene names acme/shelf@3.0.0');
  return replies;
}

it('#1960.40e69d87 writer A\'s patch sets items/a3/params/shelves to 5: after a restart a3 opens with shelves 5, migrated names only b1 to b6 for @2 to @3 and writer B\'s layer file has the hash it had before the patch; A\'s undo and a second restart give a3 shelves 4 and, at the 101 times, the evaluated values of the first load', () => {
  const doc = checkedScene();
  const recorded = checkedRecorded();
  const state = folders.state();
  const values = valuesAt(DOC, EVALUATED, TIMES_101);

  const [first, firstValues, patched] = hub(state, doc, [readDoc(DOC), values, PATCH]);
  const bBefore = fileOfB(first!);
  expect(bBefore, 'before the patch, writer B\'s layer file has a hash').toMatch(/^[0-9a-f]{64}$/);
  expect(patched!['outcome'], `writer A's patch, a3's shelves set to 5, applies: ${show(patched!, 2000)}`).toBe('applied');

  const [restarted, undone] = hub(state, doc, [readDoc(DOC), UNDO]);
  none(restartFailures(restarted!, bBefore), 'after a restart');
  expect(undone!['outcome'], `writer A's undo of that patch applies: ${show(undone!, 2000)}`).toBe('applied');

  const [again, againValues] = hub(state, doc, [readDoc(DOC), values]);
  none(undoneFailures(again!, againValues!, first!, firstValues!, recorded), 'after A\'s undo and a second restart, against the first load');
}, 1_800_000);

it('#1960.40e69d87 a planted store that writes A\'s migrated params under the saved major (store_migrated_params_under_saved_major) raises migrated for a1 again and fails, naming it', () => {
  const doc = checkedScene();
  const state = folders.state();
  const [first, patched] = hub(state, doc, [readDoc(DOC), PATCH], PLANTED);
  const bBefore = fileOfB(first!);
  expect(patched!['outcome'], `under the planted store writer A's patch still applies: ${show(patched!, 2000)}`).toBe('applied');
  const [restarted] = hub(state, doc, [readDoc(DOC)], PLANTED);
  const again = migratedSteps(restarted!).filter((s) => s.id === 'a1').map(key);
  expect(again.length, `the planted store raises migrated for a1 again: ${show(restarted!['notices'] ?? null)}`).toBeGreaterThan(0);
  const failures = restartFailures(restarted!, bBefore);
  expect(failures.some((f) => namesId(f, 'a1') && f.includes('migrated')), `the check fails naming a1:\n  ${failures.join('\n  ')}`).toBe(true);
}, 1_800_000);
