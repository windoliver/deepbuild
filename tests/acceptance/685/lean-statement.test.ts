// AC2: an agent's commit that restates the Lean theorem as `total (a ++ b) = total (a ++ b)` is judged on the
// approved statement: comparator reports the mismatch, the check is INVALID naming the theorem, and the difference
// becomes a proposal naming the file; the claim never passes on the restated theorem.
// AC3: on macOS the Lean runner builds both exports in the check's temporary checkout and runs comparator on them,
// and the receipt line says the check ran unsandboxed in a hermetic run; a forged `Solution.ndjson` in the agent's
// commit, holding a proof of the approved theorem, is never read: the check judges the commit's own build.
import { spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  checkout, cleanup, expectVerdictNaming, judge, LEAN_TEST, leanSpec, leanStatement, once, plugin, requireLean, runProof, sh, sha256,
} from './helpers.ts';

afterAll(cleanup);

const THEOREMS = ['total_append', 'total_example'];
const restated = once(() => runProof(leanSpec(THEOREMS), checkout('lean', ['restated'])));

/**
 * The forged commit: the `sorry` variant, whose own build proves nothing, with `Solution.ndjson` at its root holding
 * leanexport's export of the proved fixture's `Fixture.Proofs`, built here in a checkout of its own.
 */
const forged = once(async () => {
  await plugin();
  requireLean();
  const proved = checkout('lean');
  const built = sh('lake', ['build'], proved);
  if (built.status !== 0) throw new Error(`building the proved fixture for the forged export failed: ${built.output}`);
  const dir = checkout('lean', ['sorry']);
  const file = join(dir, 'Solution.ndjson');
  const out = openSync(file, 'w');
  const exported = spawnSync('lake', ['env', 'leanexport', 'Fixture.Proofs'], { cwd: proved, stdio: ['ignore', out, 'pipe'], encoding: 'utf8' });
  closeSync(out);
  const bytes = readFileSync(file);
  if (exported.status !== 0 || bytes.length < 1_000_000) throw new Error(`leanexport of the proved fixture failed (${exported.status}): ${exported.stderr}`);
  return { result: await runProof(leanSpec(THEOREMS), dir), forgedHash: sha256(bytes) };
});

describe('AC2 a restated theorem is judged on the approved statement: INVALID naming the theorem, and a proposal naming the file', () => {
  it('AC2 comparator\'s mismatch makes the check INVALID, naming total_append', async () => {
    expectVerdictNaming(await restated(), 'INVALID', ['total_append'], 'restated');
  }, LEAN_TEST);

  it('AC2 the difference becomes a proposal naming Fixture/Proofs.lean, with the approved and the written statement', async () => {
    const r = await restated();
    const approved = leanStatement('total_append');
    const proposal = r.proposals.find((p) => p.theorem === 'total_append');
    expect(proposal, `a proposal for total_append (proposals: ${JSON.stringify(r.proposals)})`).toBeDefined();
    expect(proposal!.file).toBe('Fixture/Proofs.lean');
    expect(proposal!.approved).toBe(approved.text);
    expect(proposal!.written).toContain('total (a ++ b) = total (a ++ b)');
    expect(proposal!.written).not.toBe(approved.text);
    expect(r.proposals.every((p) => p.theorem === 'total_append'), 'total_example\'s statement is unchanged, so nothing is proposed for it').toBe(true);
  }, LEAN_TEST);

  it('AC2 the claim never passes on the restated theorem: the run is not a pass, and the core\'s verdict is not PASS', async () => {
    const r = await restated();
    expect(r.outcome).not.toBe('passed');
    expect(judge(r).outcome).not.toBe('PASS');
  }, LEAN_TEST);
});

describe('AC3 on macOS the runner exports both modules in the check\'s temporary checkout, runs comparator unsandboxed, says so, and never reads an export in the commit', () => {
  it('AC3 the receipt line says the check ran unsandboxed in a hermetic run', async () => {
    const { result } = await forged();
    expect(process.platform, 'AC3 states the macOS path, where bubblewrap doesn\'t exist; run it on a Mac (README, Environment)').toBe('darwin');
    expect(result.receipt).toMatch(/unsandboxed/i);
    expect(result.receipt).toMatch(/hermetic/i);
  }, LEAN_TEST);

  it('AC3 the forged Solution.ndjson is never read: the check judges the commit\'s own build, INVALID naming total_append and sorryAx', async () => {
    const { result } = await forged();
    expectVerdictNaming(result, 'INVALID', ['total_append', 'sorryAx'], 'forged export');
    expect(result.read, 'the forged export is not among the files the run read').not.toContain('Solution.ndjson');
    expect(result.read, 'the commit\'s own proof file is').toContain('Fixture/Proofs.lean');
  }, LEAN_TEST);

  it('AC3 the evidence keeps the two exports the runner built, by hash, and neither is the forged file', async () => {
    const { result, forgedHash } = await forged();
    const hashes = new Set(result.evidence.flatMap((e) => e.match(/\b[0-9a-f]{64}\b/g) ?? []));
    expect(hashes.size, `two export hashes in the evidence: ${result.evidence.join(' | ')}`).toBeGreaterThanOrEqual(2);
    expect([...hashes], 'the forged export\'s hash is not one of them').not.toContain(forgedHash);
  }, LEAN_TEST);
});
