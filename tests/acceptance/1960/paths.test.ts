// #1960.5e2a1e73: "In that document a channel is keyed on `items/a1/params/levels`, a driver reads
// `items/a2/params/width`, a bound value targets `items/b1/params/width` and a constraint path names
// `items/b2/params/width`. After the load they name `items/a1/params/shelves`, `items/a2/params/span`,
// `items/b1/params/span` and `items/b2/params/span`, and the channel and the driver give the values recorded for them
// at 101 times, every 0.1 s from 0 to 10 s. A planted migrator that rewrites channel targets only leaves the other
// three `ref_unresolved` and fails, naming each path"
//
// asserts: in `r1`, with acme/shelf@1.0.0, @2.0.0 and @3.0.0 offered in that order (fixtures/packs) and acme/shelf@3.0.0
// installed, fixtures/mixed-versions.scene, "that document" (the fixture checked first: the channel `rise` keyed on
// items/a1/params/levels, the driver `reach` reading items/a2/params/width, the bound value `stock` targeting
// items/b1/params/width and the constraint `slide` whose path names items/b2/params/width; and the values recorded for
// the channel and the driver at the 101 times), seeded as a shared document, loads with `read`'s `opened` document
// naming items/a1/params/shelves, items/a2/params/span, items/b1/params/span and items/b2/params/span at those four
// places, no error raised, and `deep_query` giving, at each of the 101 times, the value recorded for the channel (read
// at items/a1/params/shelves) and for the driver (read at the path it writes, items/gauge-a/at/pos/0). Under the
// planted migrator `migration_rewrites_channel_targets_only` the channel is still carried, the load leaves the driver's
// read, the bound value's target and the constraint's path `ref_unresolved`, and the same check fails with a failure
// naming each of those three paths.
// Wrong programs: the merge base, whose `read` carries no `opened`, whose load leaves the channel and the bound value
// `ref_unresolved` and whose `deep_query` gives neither recorded value, and which knows no such planted value
// (bad_input); the planted migrator.

import { expect, it } from 'vitest';
import {
  BOUND, CHANNEL, CONSTRAINT, DOC, DRIVER, EVALUATED, PACKS, SCENE_PATHS, TIMES_101, V3, checkedRecorded, checkedScene, evaluatedFailures,
  installFailures, none, pathFailures, pathIn, readDoc, run, scenario, show, sits, unresolved, useBinary, useFolders, valuesAt,
  type JsonObject,
} from './helpers.ts';

const bin = useBinary();
const folders = useFolders();

const PLANTED = 'migration_rewrites_channel_targets_only';

/** The criterion's check on the load: the four paths, and the channel's and the driver's values at the 101 times. */
function loadFailures(read: JsonObject, query: JsonObject, recorded: { channel: number[]; driver: number[] }): string[] {
  return [...pathFailures(read, SCENE_PATHS), ...evaluatedFailures(query, recorded, 'the value recorded for it')];
}

/** Loads the scene: the `packs`, `read` and `deep_query` replies. */
function load(planted?: string): JsonObject[] {
  const doc = checkedScene();
  return run(bin(), scenario(folders.evidence(), [PACKS, readDoc(DOC), valuesAt(DOC, EVALUATED, TIMES_101)], { seeds: { [DOC]: doc }, ...(planted ? { planted } : {}) }));
}

it('#1960.5e2a1e73 after the load the channel, the driver\'s read, the bound value and the constraint path name items/a1/params/shelves, items/a2/params/span, items/b1/params/span and items/b2/params/span, and the channel and the driver give the values recorded for them at 101 times, every 0.1 s from 0 to 10 s', () => {
  const recorded = checkedRecorded();
  const [packs, read, query] = load();
  none(installFailures(packs!, [V3]), 'the scene names acme/shelf@3.0.0');
  none(loadFailures(read!, query!, recorded), 'the load of mixed-versions.scene');
}, 1_800_000);

it('#1960.5e2a1e73 a planted migrator that rewrites channel targets only (migration_rewrites_channel_targets_only) leaves the driver\'s read, the bound value and the constraint path ref_unresolved and fails, naming each path', () => {
  const recorded = checkedRecorded();
  const [packs, read, query] = load(PLANTED);
  none(installFailures(packs!, [V3]), 'the plant is the load\'s migrator, never the pack check\'s: acme/shelf@3.0.0 installs');
  expect([pathIn(read!['opened'], CHANNEL), unresolved(read!, CHANNEL).map((i) => i.raw)], 'the planted migrator still rewrites channel targets: the channel is carried and resolves').toEqual([CHANNEL.opens, []]);
  const failures = loadFailures(read!, query!, recorded);
  for (const e of [DRIVER, BOUND, CONSTRAINT]) {
    expect(unresolved(read!, e).length, `the planted migrator leaves ${e.what} ${e.id} ref_unresolved at ${sits(e)}: ${show(read!['issues'] ?? null, 2500)}`).toBeGreaterThan(0);
    expect(failures.some((f) => f.includes(sits(e)) && f.includes(e.opens)), `the check fails naming ${e.what}'s path, ${e.opens} at ${sits(e)}:\n  ${failures.join('\n  ')}`).toBe(true);
  }
  expect(failures.filter((f) => f.includes(CHANNEL.opens) && f.includes(sits(CHANNEL))), 'the check names no failure of the channel\'s path').toEqual([]);
}, 1_800_000);
