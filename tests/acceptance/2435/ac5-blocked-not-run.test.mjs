// #2435 AC5: on an adapter without ray queries every part reads BLOCKED, naming the missing feature, and a
// runner that skips a part reports it as not run, never as passed (#1115; invariant 2).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOT_PASS, PARTS, RAY_QUERY, RECORD, exitedNotPass, loadRecord, obj, reading, recordPlant, runProbe } from './helpers.mjs';

function blockedEverywhere(out, shown) {
  assert.equal(out.plant, 'no_ray_queries', `${shown}: the report is the no_ray_queries plant's`);
  for (const name of PARTS) {
    const p = out.parts?.[name];
    assert.ok(obj(p), `${shown}: ${name} is missing from the report; every part must read BLOCKED`);
    assert.equal(p.status, 'BLOCKED', `${shown}: without ray queries ${name} reads ${p.status}`);
    assert.ok(String(p.reason).includes(RAY_QUERY), `${shown}: ${name}'s BLOCKED names the missing feature, ${RAY_QUERY}: ${JSON.stringify(p.reason)}`);
  }
  assert.equal(out.status, 'BLOCKED', `${shown}: the run reads ${out.status}`);
}

test('#2435 AC5 on an adapter without ray queries every part reads BLOCKED with the missing feature named, in the report and live', () => {
  blockedEverywhere(recordPlant(loadRecord(), 'no_ray_queries'), `${RECORD} plants.no_ray_queries`);
  const run = runProbe(['--part', 'all', '--plant', 'no_ray_queries']);
  blockedEverywhere(run.out, run.shown);
  exitedNotPass(run);
});

function skippedNotRun(out, shown) {
  assert.equal(out.plant, 'skip_rebuilds', `${shown}: the report is the skip_rebuilds plant's`);
  // The runner is judged on its skip only when nothing else stops it from reading PASS.
  for (const name of PARTS.filter((p) => p !== 'rebuilds')) {
    const p = reading(out, name, shown);
    assert.equal(p.status, 'PASS', `${shown}: ${name} reads ${p.status}, so the skipped part's effect on the run can't be seen: ${p.reason}`);
  }
  const r = out.parts?.rebuilds;
  assert.ok(obj(r), `${shown}: the skipped part is missing from the report, not reported as not run`);
  assert.equal(r.status, 'NOT_RUN', `${shown}: the skipped part reads ${r.status}, not NOT_RUN`);
  assert.ok(NOT_PASS.includes(out.status), `${shown}: with a part not run the run reads ${out.status}; it must read BLOCKED, INVALID or INCONCLUSIVE, never PASS`);
}

test('#2435 AC5 plant: a runner that skips a part reports it as not run, never as passed (#1115), in the report and live', () => {
  skippedNotRun(recordPlant(loadRecord(), 'skip_rebuilds'), `${RECORD} plants.skip_rebuilds`);
  const run = runProbe(['--part', 'all', '--plant', 'skip_rebuilds']);
  skippedNotRun(run.out, run.shown);
  exitedNotPass(run);
});
