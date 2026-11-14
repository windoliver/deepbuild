// #2326 criterion 3, wider: every fixture of the canvas manifest through `deep-show run`'s `golden` call, on Vello CPU
// and on the GPU, on the merge base's build and on the change's. Each reply is compared whole but for the commit it
// names. A fixture that gives no digest (a document made to be refused) must be refused the same way on both sides.
//   node compare-fixtures.mjs <base checkout> <change checkout> <output folder>
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [baseRepo, changeRepo, out] = process.argv.slice(2);
assert.ok(baseRepo && changeRepo && out, 'usage: compare-fixtures.mjs <base checkout> <change checkout> <output folder>');
const repos = { base: baseRepo, change: changeRepo };
mkdirSync(out, { recursive: true });
/** One `deep-show run` with one call: its reply, or what stopped it, never thrown. */
function call(side, request) {
  const folder = join(out, side);
  mkdirSync(folder, { recursive: true });
  const result = spawnSync(join(repos[side], 'target/debug/deep-show'), ['run'], {
    cwd: repos[side], input: `${JSON.stringify({ evidence: folder, calls: [request] })}\n`, encoding: 'utf8', timeout: 600_000, maxBuffer: 512 << 20,
  });
  if (result.error || result.signal || result.status !== 0) return { stopped: result.error?.code ?? result.signal ?? `exit ${result.status}` };
  let reply;
  try { reply = JSON.parse(result.stdout.trim().split('\n')[0]); } catch { return { stopped: 'no JSON reply' }; }
  if (reply.ok !== true) return { refused: reply.error ?? reply };
  const { commit, ...rest } = reply.replies[0];
  return rest;
}
const manifests = Object.fromEntries(Object.keys(repos).map((side) => [side, call(side, { call: 'manifest' })]));
assert.ok(Array.isArray(manifests.base.fixtures) && manifests.base.fixtures.length > 0, 'the merge base lists no fixture');
assert.deepEqual(manifests.change.fixtures, manifests.base.fixtures, 'both builds list the same fixtures');
const rows = [];
for (const { name } of manifests.base.fixtures) {
  for (const backend of ['vello_cpu', 'gpu']) {
    const [base, change] = ['base', 'change'].map((side) => call(side, { call: 'golden', fixture: name, backend }));
    const digests = typeof base.digest === 'string' && typeof change.digest === 'string';
    let equal = true;
    try { assert.deepEqual(change, base); } catch { equal = false; }
    rows.push({ fixture: name, backend, state: equal ? (digests ? 'EQUAL' : 'SAME REFUSAL') : 'DIFFERENT', base, change });
    writeFileSync(join(out, 'fixtures.json'), `${JSON.stringify(rows, null, 1)}\n`);
  }
}
const count = (state) => rows.filter((row) => row.state === state).length;
const summary = { fixtures: manifests.base.fixtures.length, calls: rows.length, equalDigests: count('EQUAL'), sameRefusal: count('SAME REFUSAL'), different: count('DIFFERENT') };
writeFileSync(join(out, 'fixtures-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
for (const row of rows.filter((r) => r.state === 'DIFFERENT')) console.log(`DIFFERENT ${row.fixture} ${row.backend}: ${JSON.stringify(row.base).slice(0, 300)} | ${JSON.stringify(row.change).slice(0, 300)}`);
process.exitCode = summary.different ? 1 : 0;
