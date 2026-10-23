// AC10: changing the toolchain version in the environment reruns every proof check on the claim, and the verdict key
// shows both versions. Each run's key entries come from the plug-in (the toolchain version the checker reported and
// the runner's flags); which checks rerun, and what the key shows, are the core's selectReruns and verdict.
import { afterAll, describe, expect, it } from 'vitest';
import { selectReruns, verdict } from '../../../packages/verdicts/src/index.ts';
import type { ClaimInput } from '../../../packages/verdicts/src/index.ts';
import type { ProofResult } from '../../../packages/proof/src/index.ts';
import {
  checkout, claim, claimCheck, cleanup, KANI_VERSION, kaniSpec, LEAN_TEST, LEAN_VERSION, leanSpec, once, runProof, runRecord,
} from './helpers.ts';

afterAll(cleanup);

const lean = once(() => runProof(leanSpec(['total_append', 'total_example']), checkout('lean')));
const kani = once(() => runProof(kaniSpec(['proofs::total_append']), checkout('kani')));
/** Two Lean proof checks and one Kani proof check on one claim; each Lean check's run is the one Lean run. */
const CHECKS = { lean: ['proof-append', 'proof-example'], kani: ['proof-harness'] };

/** The tools with every value naming `from` naming `to` instead: the environment's toolchain at another version. */
const swap = (tools: Record<string, string>, from: string, to: string): Record<string, string> =>
  Object.fromEntries(Object.entries(tools).map(([k, v]) => [k, v.split(from).join(to)]));

/** The claim with each check keyed to the environment's tools, and each run to the tools its run reported. */
function claimOf(leanRun: ProofResult, kaniRun: ProofResult, env: { lean: Record<string, string>; kani: Record<string, string> }): ClaimInput {
  const checks = [...CHECKS.lean.map((c) => claimCheck(c, env.lean)), ...CHECKS.kani.map((c) => claimCheck(c, env.kani))];
  const runs = [...CHECKS.lean.map((c) => runRecord(leanRun, c)), ...CHECKS.kani.map((c) => runRecord(kaniRun, c))];
  return claim(checks, runs);
}

describe('AC10 a proof run\'s key holds its toolchain version and flags, so a toolchain change reruns every proof check that used it', () => {
  it('AC10 each run\'s tools name the toolchain version the checker reported, Lean 4.35.0 and Kani 0.68.0, and the runner\'s flags (comparator unsandboxed on macOS)', async () => {
    const [l, k] = [await lean(), await kani()];
    expect(l.outcome, l.reasons.join(' | ')).toBe('passed');
    expect(k.outcome, k.reasons.join(' | ')).toBe('passed');
    expect(Object.values(l.tools).some((v) => v.includes(LEAN_VERSION)), `Lean's tools: ${JSON.stringify(l.tools)}`).toBe(true);
    expect(Object.values(k.tools).some((v) => v.includes(KANI_VERSION)), `Kani's tools: ${JSON.stringify(k.tools)}`).toBe(true);
    expect(Object.values(l.tools).some((v) => v.includes('--inadvisably-no-sandbox')), `the runner's flags among Lean's tools: ${JSON.stringify(l.tools)}`).toBe(true);
  }, LEAN_TEST);

  it('AC10 with the environment unchanged, every proof check keeps its run; the verdict key shows both toolchains\' versions', async () => {
    const [l, k] = [await lean(), await kani()];
    const same = claimOf(l, k, { lean: l.tools, kani: k.tools });
    expect(selectReruns(same).rerun).toEqual([]);
    const v = verdict(same);
    expect(v.outcome).toBe('PASS');
    expect(v.key.tools.some((t) => t.includes(LEAN_VERSION)), `the key's tools: ${v.key.tools.join(', ')}`).toBe(true);
    expect(v.key.tools.some((t) => t.includes(KANI_VERSION)), `the key's tools: ${v.key.tools.join(', ')}`).toBe(true);
  }, LEAN_TEST);

  it('AC10 a Lean version change in the environment reruns every Lean proof check on the claim, and the key shows the new Lean version beside Kani\'s', async () => {
    const [l, k] = [await lean(), await kani()];
    const changed = claimOf(l, k, { lean: swap(l.tools, LEAN_VERSION, '4.36.0'), kani: k.tools });
    expect(selectReruns(changed).rerun.sort()).toEqual([...CHECKS.lean].sort());
    const v = verdict(changed);
    expect(v.outcome, 'no run counts for the Lean checks until they run again').not.toBe('PASS');
    expect(v.key.tools.some((t) => t.includes('4.36.0')), `the key's tools: ${v.key.tools.join(', ')}`).toBe(true);
    expect(v.key.tools.some((t) => t.includes(KANI_VERSION)), `the key's tools: ${v.key.tools.join(', ')}`).toBe(true);
    expect(v.key.tools.some((t) => t.includes(LEAN_VERSION)), 'the old Lean version is gone from the key').toBe(false);
  }, LEAN_TEST);

  it('AC10 a Kani version change reruns the Kani proof check, and a change to the runner\'s flags alone reruns its checks too', async () => {
    const [l, k] = [await lean(), await kani()];
    expect(selectReruns(claimOf(l, k, { lean: l.tools, kani: swap(k.tools, KANI_VERSION, '0.69.0') })).rerun).toEqual(CHECKS.kani);
    const flags = swap(l.tools, '--inadvisably-no-sandbox', '');
    expect(selectReruns(claimOf(l, k, { lean: flags, kani: k.tools })).rerun.sort()).toEqual([...CHECKS.lean].sort());
  }, LEAN_TEST);

  it('AC10 (wrong program) a run whose key leaves out the toolchain version keeps its result across the version change, and fails the assertion above', async () => {
    const [l, k] = [await lean(), await kani()];
    const versioned = Object.keys(l.tools).filter((key) => l.tools[key]!.includes(LEAN_VERSION));
    expect(versioned.length, 'the plug-in keys the version').toBeGreaterThan(0);
    const versionless = (tools: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(tools).filter(([key]) => !versioned.includes(key)));
    const wrong: ProofResult = { ...l, tools: versionless(l.tools) };
    // The environment's tools as such a plug-in would key them: no version in them, so the change doesn't show.
    const changed = claimOf(wrong, k, { lean: versionless(swap(l.tools, LEAN_VERSION, '4.36.0')), kani: k.tools });
    expect(selectReruns(changed).rerun, 'nothing reruns after the version change').toEqual([]);
    expect(() => expect(selectReruns(changed).rerun.sort()).toEqual([...CHECKS.lean].sort())).toThrow();
  }, LEAN_TEST);
});
