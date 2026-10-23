// AC8: a requirement at journey depth covered only by a proof check is INVALID, naming the requirement and the depth
// it needs.
// AC9: on a machine without the check's toolchain at its version, the check is BLOCKED, naming the toolchain and
// version, never PASS; on a fixture repo with no `lean-toolchain` file and no Kani harness or metadata, the
// drafting job proposes no proof check.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Depth } from '../../../packages/verdicts/src/index.ts';
import type { ProofResult, ProofRunner } from '../../../packages/proof/src/index.ts';
import {
  checkout, cleanup, judge, KANI_TEST, kaniSpec, LEAN_TEST, leanSpec, once, plugin, REQ, requireKani, requireLean, runProof,
} from './helpers.ts';

afterAll(cleanup);

const APPEND = 'proofs::total_append';
const DEPTHS: Depth[] = ['unit', 'integration', 'journey', 'live'];
const pass = once(() => runProof(kaniSpec([APPEND]), checkout('kani')));

/** The criterion's INVALID: the requirement needs journey depth, and the proof check covers it at `depth`. */
function expectJourneyInvalid(r: ProofResult, depth: Depth, label: string): void {
  const v = judge(r, { depth, requirement: { depth: 'journey' } });
  expect(v.outcome, `${label}: the core's verdict with the proof check at ${depth}`).toBe('INVALID');
  expect(v.reasons.some((line) => line.includes(REQ) && line.includes('journey')), `${label}: a reason names ${REQ} and journey: ${v.reasons.join(' | ')}`).toBe(true);
}

describe('AC8 a proof check counts at unit depth, so it never covers a requirement that needs a journey', () => {
  it('AC8 a proof check counts at unit depth whatever depth its spec writes, for either runner', async () => {
    const { proofDepth } = await plugin();
    for (const depth of DEPTHS) {
      expect(proofDepth(kaniSpec([APPEND], { depth })), `a Kani check whose spec says ${depth}`).toBe('unit');
      expect(proofDepth(leanSpec(['total_append'], { depth })), `a Lean check whose spec says ${depth}`).toBe('unit');
    }
  });

  it('AC8 a requirement at journey depth covered only by a passing proof check is INVALID, naming the requirement and the depth it needs; at unit depth the same check passes it', async () => {
    const { proofDepth } = await plugin();
    const r = await pass();
    expect(r.outcome, r.reasons.join(' | ')).toBe('passed');
    const depth = proofDepth(kaniSpec([APPEND], { depth: 'journey' }));
    expectJourneyInvalid(r, depth, 'the proof check');
    expect(judge(r, { depth, requirement: { depth: 'unit' } }).outcome, 'the property its theorem states, at unit depth').toBe('PASS');
  }, KANI_TEST);

  it('AC8 (wrong program) a plug-in that counts a proof at the depth its spec writes covers the journey and fails the assertion above', async () => {
    const { proofDepth } = await plugin();
    const r = await pass();
    expectJourneyInvalid(r, proofDepth(kaniSpec([APPEND], { depth: 'journey' })), 'the plug-in');
    const wrong = kaniSpec([APPEND], { depth: 'journey' }).depth as Depth;
    expect(judge(r, { depth: wrong, requirement: { depth: 'journey' } }).outcome).toBe('PASS');
    expect(() => expectJourneyInvalid(r, wrong, 'the spec\'s depth')).toThrow(/the spec's depth: the core's verdict/);
  }, KANI_TEST);
});

/** The criterion's BLOCKED: a missing run, which the core makes BLOCKED, naming the toolchain and its version. */
function expectBlockedNaming(r: ProofResult, toolchain: string, version: string, label: string): void {
  expect(r.outcome, `${label}: ${r.reasons.join(' | ')}`).toBe('missing');
  const v = judge(r);
  expect(v.outcome, `${label}: the core's verdict`).toBe('BLOCKED');
  expect(v.reasons.some((line) => line.includes(toolchain) && line.includes(version)), `${label}: a reason names ${toolchain} and ${version}: ${v.reasons.join(' | ')}`).toBe(true);
}

describe('AC9 a check whose toolchain isn\'t here at its version is BLOCKED, naming both, and a repo with neither toolchain gets no proof check', () => {
  it('AC9 a Lean check pinned to leanprover/lean4:v4.34.0, which this machine lacks, is BLOCKED naming it, never PASS, and the run installs nothing', async () => {
    await plugin();
    requireLean();
    const toolchains = join(process.env.ELAN_HOME!, 'toolchains');
    const before = readdirSync(toolchains).sort();
    expect(before.some((t) => t.includes('v4.34.0')), 'this machine has no Lean 4.34.0, so the check\'s toolchain is missing').toBe(false);
    const r = await runProof(leanSpec(['total_append'], { toolchain: 'leanprover/lean4:v4.34.0' }), checkout('lean', ['old-toolchain']));
    expectBlockedNaming(r, 'leanprover/lean4', '4.34.0', 'Lean 4.34.0');
    expect(readdirSync(toolchains).sort(), 'no toolchain was installed').toEqual(before);
  }, LEAN_TEST);

  it('AC9 a Kani check pinned to kani 0.67.0, which this machine lacks, is BLOCKED naming it, never PASS, and the run installs nothing', async () => {
    await plugin();
    requireKani();
    const home = process.env.KANI_HOME!;
    const before = readdirSync(home).sort();
    expect(existsSync(join(home, 'kani-0.67.0')), 'this machine has no Kani 0.67.0').toBe(false);
    const r = await runProof(kaniSpec([APPEND], { toolchain: 'kani 0.67.0' }), checkout('kani'));
    expectBlockedNaming(r, 'kani', '0.67.0', 'Kani 0.67.0');
    expect(readdirSync(home).sort(), 'no toolchain was installed').toEqual(before);
  }, KANI_TEST);

  it('AC9 the drafting job proposes no proof check for a repo with no lean-toolchain file and no Kani harness or metadata, and the runner each toolchain names otherwise', async () => {
    const { draftable } = await plugin();
    expect(draftable(checkout('bare')), 'a plain crate with tests: no proof check').toEqual([]);
    expect(draftable(checkout('lean')), 'a lean-toolchain file').toEqual(['lean4']);
    expect(draftable(checkout('kani')), 'Kani harnesses').toEqual(['kani']);
    expect(draftable(checkout('kani-metadata')), '[package.metadata.kani] and no harness').toEqual(['kani']);
  });

  it('AC9 (wrong program) a drafting rule that proposes Kani for any Cargo crate proposes one for the bare repo and fails the assertion above', async () => {
    const { draftable } = await plugin();
    const bare = checkout('bare');
    expect(draftable(bare)).toEqual([]);
    const anyCrate = (dir: string): ProofRunner[] => (existsSync(join(dir, 'Cargo.toml')) ? ['kani'] : []);
    expect(() => expect(anyCrate(bare), 'a plain crate with tests: no proof check').toEqual([])).toThrow(/no proof check/);
  });
});
