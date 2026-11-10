// Criterion 7 (no upstream test): "A lane record that FAILs a golden and a Mac record that passes the same tree merge to
// FAIL, naming the lane"
//
// Two records for one tree, planted where lanes write them (~/.deepbuild/lanes/<tree>-<lane>.json, in this test's HOME):
// the x86_64 lane's, FAIL with a golden report at step 37, and the Mac's `unit` lane's, PASS, in #1115's shape.
// scripts/lanes.mjs's mergeRecords(tree) merges them as remote lanes merge (README: Merge): any FAIL wins, and the merge
// names the lane that failed.
import { hostname } from 'node:os';
import { describe, expect, it } from 'vitest';
import { AC, HOST_ARCH, ITEM, LANE, LANE_ARCH, NETWORK, RECORDING, STEP, TIMEOUT, mergeOf, obj, onReferenceMac, plantRecord, sandbox, show, treeOf } from './helpers.ts';

describe(`${AC[7]} a lane's FAIL wins the merge with the Mac's records`, () => {
  it(`${AC[7]} a lane record that FAILs a golden and a Mac record that passes the same tree merge to FAIL, naming the lane`, () => {
    onReferenceMac();
    const box = sandbox();
    const tree = treeOf(box);
    const host = hostname();
    const platform = `${process.platform}-${process.arch}`;
    plantRecord(box, tree, {
      lane: LANE, state: 'FAIL', host, platform, tree, tests: [],
      recording_machine: RECORDING, lane_arch: LANE_ARCH, host_arch: HOST_ARCH, emulated: true, image_digest: `sha256:${'0'.repeat(64)}`, network: NETWORK,
      bake_key: { [ITEM]: 'f'.repeat(64) }, report: { first_step: STEP, field: { id: ITEM, field: 'x', values: [1, 2], ulp_distance: 1 } }, ask: null,
    });
    plantRecord(box, tree, { lane: 'unit', state: 'PASS', host, platform, tree, tests: [{ id: 'tests/fixture-1983.test.ts › passes', state: 'PASS' }] }, 'unit');
    const merged = obj(mergeOf(box, tree), 'mergeRecords(tree)');
    expect({ state: merged['state'], lanes: merged['lanes'] }, `the merge of the lane's FAIL and the Mac's pass: ${show(merged)}`).toEqual({ state: 'FAIL', lanes: [LANE] });
  }, TIMEOUT);
});
