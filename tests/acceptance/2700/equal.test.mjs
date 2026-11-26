// #2700 criterion 2 (#2700.ce79405c): "For 10,000 generated patches on generated documents, the recheck's issues
// equal the whole check's, patches to an item whose params name an asset or a data row among them. A planted recheck
// that leaves out an item whose asset the patch changed fails, naming the item"
//   node --test tests/acceptance/2700/equal.test.mjs
// The probe generates documents and patches from the four recorded seeds below (SplitMix64, 2,500 applied patches a
// seed, at most 100 on one document): items of the core's `test.slab@3` and of the test module's `acc2700.pic@1`,
// whose `asset` names one of the document's `assets` (by ID or SHA-256, or a name the document lacks) and whose `row`
// names a row of its `data`; ops `set`, `unset`, `move`, `delete` and `create`. After each applied patch it compares
// `recheck` and `recheck_with`, each given the previous revision's issues and the items the patch changed, with
// `check_in` on the same document, issue by issue, by code, IDs and path (the patch fuzzer's fifth law).
// The generator is deterministic: the same seeds give the same documents and patches on every machine.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AC, grouped, probe, shown } from './lib.mjs';

/** The recorded seeds, and the patches each applies: 10,000 in all. */
const SEEDS = [2700, 896, 854, 499];
const PER_SEED = 2_500;

const ids = (list) => list.map((id) => `\`${id}\``).join(', ');
/** One mismatch, as the failure names it: the item first, then what each side reports. */
function told(m) {
  const where = `seed ${m.seed}, document ${m.document}, patch ${m.patch} (${shown(m.ops, 400)})`;
  if (m.document_changed) return `${where}: the document handed to the recheck came back changed; the patch changed ${ids(m.changed)}`;
  const items = m.items?.length ? m.items : m.changed;
  const asset = m.asset_changed_on?.length ? `; the patch changed the asset of ${ids(m.asset_changed_on)}` : '';
  if (!m.answered) return `item ${ids(items)}: ${m.function} answered nothing for an item patch at ${where}`;
  return `item ${ids(items)}: ${m.function}'s issues are not the whole check's at ${where}${asset}; only the whole check reports ${shown(m.only_whole_check, 600)}, only ${m.function} reports ${shown(m.only_recheck, 600)}`;
}

test(`${AC.equal} for 10,000 generated patches on generated documents the recheck's issues equal the whole check's`, { timeout: 3_600_000 }, () => {
  const reports = SEEDS.map((seed) => probe('equal', seed, PER_SEED));
  const sum = (field) => reports.reduce((total, r) => total + r[field], 0);
  const mismatches = reports.flatMap((r) => r.mismatches);
  console.log(`${AC.equal} ${grouped(sum('applied'))} patches on ${sum('documents')} documents: ${grouped(sum('patches_to_an_item_naming_an_asset'))} to an item naming an asset, ` +
    `${grouped(sum('patches_to_an_item_naming_a_data_row'))} to one naming a data row, ${grouped(sum('patches_changing_an_items_asset'))} changing an item's asset, ` +
    `${grouped(sum('revisions_with_issues'))} revisions with issues; ${sum('mismatched')} mismatches`);
  // The criterion's own counts first: without them an empty run would pass.
  for (const r of reports) assert.equal(r.applied, PER_SEED, `BLOCKED: seed ${r.seed} applied ${r.applied} patches, not ${PER_SEED} (${r.drawn} drawn)`);
  assert.equal(sum('applied'), 10_000, 'BLOCKED: 10,000 generated patches were not applied');
  assert.ok(sum('documents') >= 100, `BLOCKED: the patches ran on ${sum('documents')} generated documents, fewer than 100`);
  assert.ok(sum('patches_to_an_item_naming_an_asset') >= 5_000, `BLOCKED: only ${sum('patches_to_an_item_naming_an_asset')} patches reached an item whose params name an asset`);
  assert.ok(sum('patches_to_an_item_naming_a_data_row') >= 5_000, `BLOCKED: only ${sum('patches_to_an_item_naming_a_data_row')} patches reached an item whose params name a data row`);
  assert.ok(sum('patches_changing_an_items_asset') >= 2_000, `BLOCKED: only ${sum('patches_changing_an_items_asset')} patches changed an item's asset`);
  assert.ok(sum('revisions_with_issues') >= 5_000, `BLOCKED: only ${sum('revisions_with_issues')} revisions had an issue to compare`);
  // The property: every patch, both rechecks.
  assert.equal(sum('mismatched'), 0,
    `${sum('mismatched')} of ${grouped(2 * sum('applied'))} rechecks did not give the whole check's issues. ${mismatches.slice(0, 3).map(told).join('\n')}`);
});
