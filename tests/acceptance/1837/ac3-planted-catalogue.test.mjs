// #1837.78b8f3bb, third part: a planted catalogue missing one of the Scope's event kinds fails the catalogue drift lane,
// naming the kind. The plant removes every version of that kind's schema from a scratch copy; the catalogue is
// generated from the kinds' schemas (canvas-primitives.md, The event catalogue), so the copy's catalogue lacks it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KINDS, catalogueKinds, dropKind, naming, runLane } from './helpers.mjs';

for (const kind of KINDS) {
  test(`#1837.78b8f3bb a planted catalogue missing ${kind} fails the catalogue drift lane, naming ${kind}`, (t) => {
    const run = runLane(t, { plant: (repo) => dropKind(repo, kind) });
    assert.ok(run.planted.length > 0, `the copy has no schema file for ${kind} to remove`);
    assert.ok(!catalogueKinds(run.repo).has(kind), `the planted catalogue still holds ${kind}`);
    assert.deepEqual(run.verdicts, ['FAIL'], `the lane's verdict with ${kind} missing from the catalogue is FAIL:\n${run.output}`);
    assert.notEqual(run.status, 0, `runLanes returned 0 with ${kind} missing from the catalogue:\n${run.output}`);
    assert.ok(naming(run, kind).length > 0, `no output line names ${kind}:\n${run.output}`);
  });
}
