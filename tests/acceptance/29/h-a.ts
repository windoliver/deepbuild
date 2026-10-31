// Fork A's test-side builders: #28-style claim builders for `verdict()` (copied, trimmed, from tests/acceptance/28/helpers.ts;
// that suite keeps its own copy) and a definition fixture for the floor. Nothing here stands in for the gate runner.
import { createHash } from 'node:crypto';
import type { ClaimCheck, ClaimInput, Requirement, Run } from '../../../packages/verdicts/src/index.ts';

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
export const commitOf = (name: string): string => sha256(`commit ${name}`).slice(0, 40);
export const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const DEF = 'req:01K74G0A1B2C3D4E5F6G7H8J9K';
export const reqId = (n: number): string => `${DEF}#R${n}`;
export const requirement = (n: number, over: Partial<Requirement> = {}): Requirement => ({ req: reqId(n), depth: 'unit', oracle: 'code', on_base: 'passes', ...over });
export function check(id: string, over: Partial<ClaimCheck> = {}): ClaimCheck {
  return {
    check: id, digest: `d1:${sha256(`check ${id}`)}`, source: 'approved', depth: 'unit', proof: 'test_run', covers: [reqId(1)],
    inputs: ['src/**'], environment: { os: 'darwin-arm64' }, tools: { node: '24.22.0' }, ...over,
  };
}
let n = 0;
export function passed(c: ClaimCheck, commit: string, over: Partial<Run> = {}): Run {
  n++;
  return {
    run: `run:R${n}${c.check.replace(/[^0-9A-Za-z]/g, '')}`, check: c.check, claim: 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H', commit, digest: c.digest,
    environment: { ...c.environment }, tools: { ...c.tools }, outcome: 'passed', ended: T0 + n, tests_run: 12, reads: [], failures: [],
    evidence: [{ slot: 'report', state: 'captured', sha256: sha256(`report ${n}`) }], kept: true, ...over,
  };
}
export function claim(over: Partial<ClaimInput> = {}): ClaimInput {
  return {
    claim: 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H', agent: 'session:01K74FQ8S1T2V3W4X5Y6Z7A8B9', repo: 'shop', task: 'task:01K74FX2B4D6F8H0K2M4P6R8T0',
    commit: commitOf('D'), requirements: [requirement(1)], checks: [], runs: [], changes: [], waivers: [], now: T0 + 86_400_000, ...over,
  };
}
