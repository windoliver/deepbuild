// #1960.fc74f8ec: "A corpus document with a channel keyed on `items/b1/params/levels` opens at shelf.bookcase@2 with
// the channel on `items/b1/params/shelves` and the same evaluated values at 100 sampled times; a migration that drops
// a param a driver reads is refused at pack check, naming the driver's path; a planted migrator that renames params
// only leaves the channel `ref_unresolved` and fails, naming the channel"
//
// asserts: in `r1`, with acme/shelf@1.0.0, @2.0.0 and @3.0.0 offered in that order (fixtures/packs) and 1.0.0 and
// 2.0.0 installed, acme/shelf@2.0.0's @1 corpus document of the channel (the fixture checked first: b1 at
// shelf.bookcase@1 with levels, the channel `lift` keyed on items/b1/params/levels, and the record's 100 sampled times
// with the values the release that saved it recorded, which the binary gives again for the document under
// acme/shelf@1.0.0) seeded as a shared document under acme/shelf@2.0.0 opens with b1 expanding as shelf.bookcase@2,
// `read`'s `opened` document holding the channel on items/b1/params/shelves, no error raised, and `deep_query` giving
// at items/b1/params/shelves, at each of the 100 times, the value recorded. And a planted acme/shelf@2.0.0 whose
// @1-to-@2 step drops dividers, which a driver of its @1 corpus document reads at items/b1/params/dividers
// (fixtures/packs/shelf-2.0.0-drops-read), offered after 1.0.0 in a process of its own, is refused at its pack check
// with an error that names that path, while its control (shelf-2.0.0-drops-unread: the same step and kind, the driver
// reading width, which the step keeps) installs. Under the planted migrator `migration_renames_params_only` both
// versions still install, b1 still opens as shelf.bookcase@2, the load leaves the channel `ref_unresolved`, and the
// same check fails with a failure naming the channel.
// Wrong programs: the merge base, whose migration carries no path (acme/shelf@2.0.0 is refused at its pack check for
// the channel left unresolved, the planted drop installs) and which knows no such planted value (bad_input); the
// planted migrator.

import { expect, it } from 'vitest';
import {
  DOC, DOC_SAVED, KIND, PACKS, V1, V2, V2_DROPS_READ, V2_DROPS_UNREAD, arr, at, corpusRecords, errors, expansionOf, installFailures, isObject,
  issues, namesId, none, obj, packRow, pathFailures, pathIn, readDoc, run, sameJson, scenario, show, sits, stepOf, stored, unresolved,
  useBinary, useFolders, valueFailures, valuesAt, valuesOf, where, type JsonObject, type JsonValue, type PackFixture, type PathEntry,
} from './helpers.ts';

const bin = useBinary();
const folders = useFolders();

/** The channel keyed on b1's levels: at shelf.bookcase@2 it is on b1's shelves. */
const LIFT: PathEntry = { what: 'the channel', map: 'channels', id: 'lift', field: ['target'], saved: 'items/b1/params/levels', opens: 'items/b1/params/shelves' };
/** The path the planted drop's driver reads: b1's dividers, which the step drops. */
const DROPPED = 'items/b1/params/dividers';
/** The path the control's driver reads: b1's width, which the step keeps. */
const KEPT = 'items/b1/params/width';
const PLANTED = 'migration_renames_params_only';

/** acme/shelf@2.0.0's @1 corpus document of the channel, with its sampled times and values, checked against the criterion. */
function liftRecord(): { document: JsonObject; times: string[]; values: JsonValue[] } {
  const found = corpusRecords(V2, 1).filter((r) => isObject(r.document['channels']));
  expect(found.length, 'acme/shelf@2.0.0\'s @1 corpus holds one document with a channel').toBe(1);
  const { document, sampled } = found[0]!;
  expect([at(document, 'items', 'b1', 'kind'), typeof at(document, 'items', 'b1', 'params', 'levels')], 'the fixture: b1 is saved at shelf.bookcase@1 with its levels').toEqual([KIND(1), 'number']);
  expect(Object.keys(obj(document['channels'], 'the document\'s channels')), 'the fixture: one channel, lift').toEqual([LIFT.id]);
  expect(pathIn(document, LIFT), 'the fixture: the channel is keyed on items/b1/params/levels').toBe(LIFT.saved);
  expect(Object.keys(obj(at(document, 'channels', LIFT.id, 'keys'), 'the channel\'s keys')).length, 'the fixture: the channel holds keys').toBeGreaterThan(1);
  expect(at(stepOf(V2, 2, 1), 'rename'), 'the fixture: shelf.bookcase@2\'s step renames levels to shelves').toEqual({ levels: 'shelves' });
  const times = arr(at(sampled, 'times'), 'the record\'s sampled times').map(String);
  const values = arr(at(sampled, 'values', LIFT.saved), 'the record\'s sampled values of items/b1/params/levels');
  expect([new Set(times).size, values.length, values.every((v) => typeof v === 'number')], 'the fixture: 100 sampled times, each with a number').toEqual([100, 100, true]);
  expect(new Set(values).size, 'the fixture: the recorded values change over the sampled times').toBeGreaterThan(1);
  return { document, times, values };
}

/** The first clause's check, on the document opened under acme/shelf@2.0.0: each failure names what failed. */
function liftFailures(packs: JsonObject, read: JsonObject, query: JsonObject, rec: { times: string[]; values: JsonValue[] }): string[] {
  const failures = installFailures(packs, [V1, V2]);
  const opensAs = expansionOf(read, 'b1')?.kind;
  if (opensAs !== KIND(2)) failures.push(`b1 opens as ${show(opensAs ?? null)}, not ${KIND(2)}`);
  failures.push(...pathFailures(read, [LIFT]));
  failures.push(...valueFailures(`the channel ${LIFT.id}, read at ${LIFT.opens} against the values recorded for it,`, rec.times, valuesOf(query, LIFT.opens), rec.values));
  return failures;
}

/** The driver's read in a pack's @1 corpus document, and the pack's step, checked: the step drops dividers. */
function checkDrop(p: PackFixture, reads: string): void {
  expect(at(stepOf(p, 2, 1), 'drop'), `the fixture: ${where(p)}'s @1-to-@2 step drops dividers`).toEqual(['dividers']);
  const [record] = corpusRecords(p, 1);
  expect(at(record!.document, 'items', 'b1', 'kind'), `the fixture: ${where(p)}'s @1 corpus document holds b1 at shelf.bookcase@1`).toBe(KIND(1));
  const vars = Object.values(obj(at(record!.document, 'drivers', 'count', 'vars'), `${where(p)}: the driver's vars`));
  expect(vars, `the fixture: ${where(p)}'s corpus document's driver reads ${reads}`).toEqual([reads]);
}

/**
 * The second clause's check: the planted drop is refused at its pack check with an error naming the path its driver
 * reads, and the control, which differs only in what its driver reads, installs.
 */
function dropFailures(planted: JsonObject, control: JsonObject): string[] {
  const failures = [...installFailures(planted, [V1]), ...installFailures(control, [V1, V2_DROPS_UNREAD]).map((f) => `the control: ${f}`)];
  const row = packRow(planted, V2_DROPS_READ);
  if (row.state !== 'refused') failures.push(`${where(V2_DROPS_READ)} is ${row.state}: its step drops dividers, which its corpus document's driver reads at ${DROPPED}, so its pack check must refuse it`);
  else if (!row.errors.some((i) => JSON.stringify(i.raw).includes(DROPPED))) failures.push(`${where(V2_DROPS_READ)} is refused, and no error names the driver's path ${DROPPED}: ${show(row.errors.map((i) => i.raw), 2500)}`);
  return failures;
}

it('#1960.fc74f8ec a corpus document with a channel keyed on items/b1/params/levels opens at shelf.bookcase@2 with the channel on items/b1/params/shelves and the same evaluated values at 100 sampled times, and a migration that drops a param a driver reads is refused at pack check, naming the driver\'s path', () => {
  const b = bin();
  const rec = liftRecord();
  checkDrop(V2_DROPS_READ, DROPPED);
  checkDrop(V2_DROPS_UNREAD, KEPT);
  expect(sameJson(stepOf(V2_DROPS_READ, 2, 1), stepOf(V2_DROPS_UNREAD, 2, 1)), 'the fixture: the planted drop and its control ship the same step').toBe(true);

  const [packs, read, query, savedRead, savedQuery] = run(b, scenario(folders.evidence(), [
    PACKS, readDoc(DOC), valuesAt(DOC, [LIFT.opens], rec.times), readDoc(DOC_SAVED), valuesAt(DOC_SAVED, [LIFT.saved], rec.times),
  ], { seeds: { [DOC]: stored(rec.document, V2), [DOC_SAVED]: stored(rec.document, V1) } }));
  // The fixture: under the release that saved it the document opens clean and gives the values its record holds.
  expect(errors(issues(savedRead!)).map((i) => i.raw), 'the fixture: under acme/shelf@1.0.0 the document raises no error').toEqual([]);
  none(valueFailures('under acme/shelf@1.0.0 the channel, read at items/b1/params/levels against its record,', rec.times, valuesOf(savedQuery!, LIFT.saved), rec.values), 'the fixture: the record holds what acme/shelf@1.0.0 gives');

  const [planted] = run(b, scenario(folders.evidence(), [PACKS], { packs: [V1, V2_DROPS_READ] }));
  const [control] = run(b, scenario(folders.evidence(), [PACKS], { packs: [V1, V2_DROPS_UNREAD] }));
  none([...liftFailures(packs!, read!, query!, rec), ...dropFailures(planted!, control!)], 'the corpus document under acme/shelf@2.0.0, and the migration that drops a param a driver reads');
}, 1_800_000);

it('#1960.fc74f8ec a planted migrator that renames params only (migration_renames_params_only) leaves the channel ref_unresolved and fails, naming the channel', () => {
  const rec = liftRecord();
  const [packs, read, query] = run(bin(), scenario(folders.evidence(), [PACKS, readDoc(DOC), valuesAt(DOC, [LIFT.opens], rec.times)], { seeds: { [DOC]: stored(rec.document, V2) }, planted: PLANTED }));
  none(installFailures(packs!, [V1, V2]), 'the plant is the load\'s migrator, never the pack check\'s: both versions install');
  expect(expansionOf(read!, 'b1')?.kind, 'the planted migrator still renames params: b1 opens as shelf.bookcase@2').toBe(KIND(2));
  expect(unresolved(read!, LIFT).length, `the planted migrator leaves the channel ref_unresolved at ${sits(LIFT)}: ${show(read!['issues'] ?? null)}`).toBeGreaterThan(0);
  const failures = liftFailures(packs!, read!, query!, rec);
  expect(failures.some((f) => namesId(f, LIFT.id)), `the check fails naming the channel ${LIFT.id}:\n  ${failures.join('\n  ')}`).toBe(true);
}, 1_800_000);
