import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// node compare-runtime.mjs <base checkout> <change checkout> <output folder>: both built with the same five binaries.
const [baseRepo, changeRepo, evidence] = process.argv.slice(2);
assert.ok(baseRepo && changeRepo && evidence, 'usage: compare-runtime.mjs <base checkout> <change checkout> <output folder>');
const repos = { base: baseRepo, updated: changeRepo };
const read = (command, args, cwd) => spawnSync(command, args, { cwd, encoding: 'utf8' }).stdout.trim();
mkdirSync(evidence, { recursive: true });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fixture = name => JSON.parse(readFileSync(join(repos.base, 'tests/acceptance/2324/fixtures', name), 'utf8'));
const input = ({ piece, track, steps }) => ({ piece, track, steps });
const save = (name, value) => writeFileSync(join(evidence, name), `${JSON.stringify(value, null, 2)}\n`);
function run(side, binary, calls, args = []) {
  const result = spawnSync(join(repos[side], 'target/debug', binary), args, {
    cwd: repos[side], input: calls.map(c => JSON.stringify(c)).join('\n') + '\n', encoding: 'utf8',
    timeout: 600_000, maxBuffer: 512 << 20,
  });
  assert.equal(result.error, undefined, `${side} ${binary}: ${result.error?.message}`);
  assert.equal(result.signal, null, `${side} ${binary} was signalled`);
  assert.equal(result.status, 0, `${side} ${binary}: ${result.stderr.slice(-3000)}`);
  const replies = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(replies.length, calls.length, `${side} ${binary} reply count`);
  for (let i = 0; i < replies.length; i++) {
    const reply = replies[i];
    if (binary === 'deep-sandbox' && calls[i].call === 'kit') {
      assert.equal(reply.verdict, 'PASS', `${side} sandbox kit did not pass`);
      assert.ok(Array.isArray(reply.cases) && reply.cases.length > 0, `${side} sandbox kit ran no cases`);
    } else assert.equal(reply.ok, true, `${side} ${binary} refused: ${JSON.stringify(reply).slice(0, 1000)}`);
  }
  return replies;
}
function show(side, calls) {
  const folder = join(evidence, side);
  mkdirSync(folder, { recursive: true });
  const [reply] = run(side, 'deep-show', [{ evidence: folder, calls }], ['run']);
  assert.equal(reply.replies.length, calls.length, `${side} deep-show call count`);
  return reply.replies;
}
function hashes(bake) {
  assert.equal(Object.keys(bake.items).length, 14, '#531 has fourteen admitted program fixtures');
  assert.equal(bake.steps.length, 60, '#531 runs sixty recorded steps');
  const steps = bake.steps.map(row => [row.step, Object.fromEntries(Object.entries(row.items).map(([id, x]) => [id, [x.hash, x.fuel]]))]);
  const checkpoints = Object.fromEntries(Object.entries(bake.checkpoints).map(([id, rows]) => [id, rows.map(row => [row.step, row.deep_hash])]));
  assert.ok(Object.values(checkpoints).flat().length >= 40, '#531 includes at least the forty originally recorded full-state checkpoints');
  const result = { steps, checkpoints, traps: bake.traps, keys: bake.keys };
  assert.ok(steps.some(([, items]) => Object.values(items).some(([hash]) => typeof hash === 'string' && hash.length)), 'actual step hashes exist');
  return result;
}
const out = {};
for (const side of Object.keys(repos)) {
  const [bake] = run(side, 'deep-logic', [{ call: 'bake', ...input(fixture('base-bake.json')) }]);
  out[side] = { logic: hashes(bake) };
  save(`${side}-logic.json`, out[side].logic);
  // The already blessed golden stays untouched: only verify it through the public protocol.
  // #2324 changed its bake key, so compare the same committed golden's reported result as well as the raw hashes.
  const g = fixture('base-golden.json');
  const [verify] = run(side, 'deep-logic', [{ call: 'golden_verify', ...input(g), golden: g.golden }]);
  out[side].golden = verify;
  save(`${side}-golden-verify.json`, verify);
  const [savedBake] = run(side, 'deep-logic', [{ call: 'bake', ...input(g) }]);
  assert.equal(savedBake.steps.length, 120, 'the save replay produces 120 steps');
  assert.equal(savedBake.checkpoints.table_copy.length, 5, 'the save replay produces five checkpoints');
  out[side].savedHashes = {
    steps: savedBake.steps.map(row => row.items.table_copy.hash),
    checkpoints: savedBake.checkpoints.table_copy.map(row => [row.step, row.deep_hash]),
  };
  assert.deepEqual(out[side].savedHashes.steps, g.golden.step_hashes.table_copy, `${side} save step hashes match the unchanged golden`);
  assert.deepEqual(out[side].savedHashes.checkpoints, g.golden.checkpoint_hashes.table_copy.map(row => [row.step, row.deep_hash]), `${side} save full-state hashes match the unchanged golden`);
  save(`${side}-save-hashes.json`, out[side].savedHashes);
  const [sandbox] = run(side, 'deep-sandbox', [{ call: 'kit' }]);
  out[side].sandbox = sandbox;
  save(`${side}-sandbox.json`, sandbox);
  const [manifest, schedule] = show(side, [{ call: 'manifest' }, { call: 'schedule' }]);
  assert.ok(Array.isArray(manifest.fixtures) && manifest.fixtures.length > 0, 'canvas manifest has actual fixtures');
  assert.equal(typeof schedule.runtime_digest, 'string', 'runtime seal exists');
  out[side].seal = schedule.runtime_digest;
  out[side].fixtures = manifest.fixtures;
  save(`${side}-manifest.json`, manifest);
}
assert.deepEqual(out.updated.logic, out.base.logic, 'logic step/full-state hashes, traps and bake keys equal the merge base');
assert.deepEqual(out.updated.golden, out.base.golden, 'the committed golden reports the same result on both locks');
assert.deepEqual(out.updated.savedHashes, out.base.savedHashes, 'the unchanged saved golden replays with equal step and full-state hashes');
assert.deepEqual(out.updated.sandbox, out.base.sandbox, 'sandbox kit actual results equal the merge base');
assert.deepEqual(out.updated.fixtures, out.base.fixtures, 'both builds expose exactly the same canvas fixtures');
assert.equal(out.updated.seal, out.base.seal, 'runtime seal equals the merge base');
const mismatch = structuredClone(out.updated.logic);
mismatch.checkpoints.table_copy[0][1] = 'planted-wrong-full-state-hash';
assert.throws(() => assert.deepEqual(mismatch, out.base.logic), 'the equality check rejects a planted checkpoint mismatch');

// Existing parity fixtures that actually declare a pixel comparison, not deliberately invalid documents.
const fixtures = out.base.fixtures.filter(f => f.sidecar?.checks?.some(c => c.probe === 'pixels'));
const comparisons = [];
for (const f of fixtures) {
  for (const backend of ['vello_cpu', 'gpu']) {
    const pair = {};
    for (const side of Object.keys(repos)) {
      const [reply] = show(side, [{ call: 'golden', fixture: f.name, backend }]);
      pair[side] = reply;
    }
    const complete = typeof pair.base.digest === 'string' && typeof pair.updated.digest === 'string';
    comparisons.push({ fixture: f.name, backend, state: complete ? (pair.base.digest === pair.updated.digest ? 'PASS' : 'FAIL') : 'BLOCKED', base: pair.base, updated: pair.updated });
    save('canvas-golden-comparisons.json', comparisons);
  }
}
save('canvas-golden-comparisons.json', comparisons);
const summary = {
  base: read('git', ['rev-parse', 'HEAD'], repos.base), change: read('git', ['rev-parse', 'HEAD'], repos.updated), machine: read('sysctl', ['-n', 'hw.model']),
  logic: { fixtures: 14, recordedSteps: 60, fullStateHashes: Object.values(out.base.logic.checkpoints).flat().length, digest: digest(out.base.logic), state: 'PASS' },
  sandbox: { digest: digest(out.base.sandbox), state: 'PASS' }, runtimeSeal: out.base.seal,
  goldenResult: out.updated.golden,
  saveHashes: { steps: 120, fullStateHashes: 5, digest: digest(out.updated.savedHashes), state: 'PASS' },
  canvasGoldens: { fixtures: fixtures.length, compared: comparisons.filter(r => r.state === 'PASS').length, failed: comparisons.filter(r => r.state === 'FAIL').length, blocked: comparisons.filter(r => r.state === 'BLOCKED').length },
};
save('summary.json', summary);
console.log(JSON.stringify(summary, null, 2));
assert.ok(fixtures.length > 0, 'no canvas fixture pixels were compared; AC3 remains incomplete');
assert.equal(summary.canvasGoldens.failed, 0, 'a canvas golden differs');
assert.equal(summary.canvasGoldens.blocked, 0, 'an unrun canvas comparison does not pass');
