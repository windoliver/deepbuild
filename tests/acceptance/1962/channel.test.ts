// #1962.f5eb6b43: "A channel keyed on a moved item's param keeps its evaluated values at 100 sampled times after the
// upgrade; a planted migrator that rewrites the kind but not the paths leaves the channel `ref_unresolved` and fails,
// naming the channel"
//
// asserts: in `r1`, with acme/shelf@1.2.0, acme/furniture@1.0.0, acme/furniture@2.0.0 and acme/shelf@2.0.0 of
// fixtures/packs/shelf-2.0.0-tiers offered in that order and all four installed (the fixtures checked first: that
// 2.0.0 declares moved {shelf.bookcase@2: furniture/case@1} with requires.packs [furniture@2.0.0], and furniture@2.0.0's
// furniture.case@2 renames shelves to tiers in its step from major 1), the lift, acme/shelf@1.2.0's corpus document of
// major 2 that holds a channel (b1 at shelf.bookcase@2, the channel `lift` keyed on items/b1/params/shelves, and the
// record's 100 sampled times with the values the release that saved it recorded, which the binary gives again for the
// document under acme/shelf@1.2.0), seeded as a shared document pinned to that 2.0.0 opens with b1 expanding as
// furniture.case@2, `read`'s `opened` document holding the channel on items/b1/params/tiers, no error raised, and
// `deep_query` giving at items/b1/params/tiers, at each of the 100 times, the value recorded. Under the planted
// migrator `move_rewrites_kind_only` the four versions still install, b1 still opens as furniture.case@2, the load
// leaves the channel `ref_unresolved`, and the same check fails with a failure naming the channel.
// Wrong programs: the merge base, whose pack check refuses that 2.0.0 (`moved` is unknown_field), so the lift names a
// version the store lacks and its b1 is skipped, and which knows no such planted value (bad_input); the planted
// migrator.

import { expect, it } from 'vitest';
import {
  CASE_2, DOC, FURNITURE_10, FURNITURE_20, LIFT, OLD_KIND, PACKS, SHELF_12, SHELF_20_TIERS, arr, at, corpusRecords, errors, expansionOf,
  installFailures, isObject, issues, liftFailures, manifestOf, namesId, none, obj, readDoc, run, scenario, show, stored, unresolvedLift,
  useBinary, useEvidence, valueFailures, valuesAt, valuesOf, type JsonObject, type JsonValue,
} from './helpers.ts';

const bin = useBinary();
const evidence = useEvidence();
const PLANTED = 'move_rewrites_kind_only';
const VERSIONS = [SHELF_12, FURNITURE_10, FURNITURE_20, SHELF_20_TIERS];

/** The lift: acme/shelf@1.2.0's corpus document with the channel, its sampled times and values, checked against the criterion. */
function liftRecord(): { document: JsonObject; times: string[]; values: JsonValue[] } {
  const found = corpusRecords(SHELF_12, 2).filter((r) => isObject(r.document['channels']));
  expect(found.length, 'the fixture: acme/shelf@1.2.0\'s corpus of major 2 holds one document with a channel, the lift').toBe(1);
  const { document, sampled } = found[0]!;
  expect([at(document, 'items', 'b1', 'kind'), typeof at(document, 'items', 'b1', 'params', 'shelves')], 'the fixture: b1 is saved at shelf.bookcase@2 with its shelves').toEqual([OLD_KIND, 'number']);
  expect(Object.keys(obj(document['channels'], 'the lift\'s channels')), 'the fixture: one channel, lift').toEqual([LIFT.id]);
  expect(at(document, 'channels', LIFT.id, 'target'), 'the fixture: the channel is keyed on items/b1/params/shelves').toBe(LIFT.saved);
  expect(Object.keys(obj(at(document, 'channels', LIFT.id, 'keys'), 'the channel\'s keys')).length, 'the fixture: the channel holds keys').toBeGreaterThan(1);
  const m = manifestOf(SHELF_20_TIERS);
  expect([m['moved'], at(m, 'requires', 'packs')], 'the fixture: this 2.0.0 moves shelf.bookcase@2 to furniture/case@1 and requires furniture@2.0.0').toEqual([{ [OLD_KIND]: 'furniture/case@1' }, ['furniture@2.0.0']]);
  expect(at(manifestOf(FURNITURE_20), 'kinds', CASE_2, 'migrate', '1', 'rename'), 'the fixture: furniture.case@2\'s step from major 1 renames shelves to tiers').toEqual({ shelves: 'tiers' });
  const times = arr(at(sampled, 'times'), 'the record\'s sampled times').map(String);
  const values = arr(at(sampled, 'values', LIFT.saved), 'the record\'s sampled values of items/b1/params/shelves');
  expect([new Set(times).size, values.length, values.every((v) => typeof v === 'number')], 'the fixture: 100 sampled times, each with a number').toEqual([100, 100, true]);
  expect(new Set(values).size, 'the fixture: the recorded values change over the sampled times').toBeGreaterThan(1);
  return { document, times, values };
}

it('#1962.f5eb6b43 a channel keyed on a moved item\'s param keeps its evaluated values at 100 sampled times after the upgrade', () => {
  const rec = liftRecord();
  const [packs, read, query, savedRead, savedQuery] = run(bin(), scenario(evidence(), [
    PACKS, readDoc(DOC.c), valuesAt(DOC.c, [LIFT.opens], rec.times), readDoc(DOC.d), valuesAt(DOC.d, [LIFT.saved], rec.times),
  ], { packs: VERSIONS, seeds: { [DOC.c]: stored(rec.document, SHELF_20_TIERS), [DOC.d]: stored(rec.document, SHELF_12) } }));
  // The fixture: under the release that saved it the lift opens clean and gives the values its record holds.
  expect(errors(issues(savedRead!)).map((i) => i.raw), 'the fixture: under acme/shelf@1.2.0 the lift raises no error').toEqual([]);
  none(valueFailures('under acme/shelf@1.2.0 the channel, read at items/b1/params/shelves against its record,', rec.times, valuesOf(savedQuery!, LIFT.saved), rec.values), 'the fixture: the record holds what acme/shelf@1.2.0 gives');
  none(liftFailures(packs!, read!, query!, rec), 'the lift upgraded from shelf@1.2.0 to the 2.0.0 that moves its bookcase to furniture.case@1 of furniture@2.0.0');
}, 1_800_000);

it('#1962.f5eb6b43 a planted migrator that rewrites the kind but not the paths (move_rewrites_kind_only) leaves the channel ref_unresolved and fails, naming the channel', () => {
  const rec = liftRecord();
  const [packs, read, query] = run(bin(), scenario(evidence(), [PACKS, readDoc(DOC.c), valuesAt(DOC.c, [LIFT.opens], rec.times)], { packs: VERSIONS, seeds: { [DOC.c]: stored(rec.document, SHELF_20_TIERS) }, planted: PLANTED }));
  none(installFailures(packs!, VERSIONS), 'the plant is the load\'s migrator, never the pack check\'s: all four versions install');
  expect(expansionOf(read!, 'b1')?.kind, 'the planted migrator still rewrites the kind: b1 opens as furniture.case@2').toBe(CASE_2);
  expect(unresolvedLift(read!).length, `the planted migrator leaves the channel ref_unresolved at ${LIFT.place}: ${show(read!['issues'] ?? null)}`).toBeGreaterThan(0);
  const failures = liftFailures(packs!, read!, query!, rec);
  expect(failures.some((f) => namesId(f, LIFT.id)), `the check fails naming the channel ${LIFT.id}:\n  ${failures.join('\n  ')}`).toBe(true);
}, 1_800_000);
