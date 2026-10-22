// Shared test-side tools for the #28 acceptance tests: builders for claims, checks, runs and failures,
// precedence, and small checks that return their problems so a planted twin can be run through the same one.
// None of them stands in for the engine.
import { createHash } from 'node:crypto';
import type {
  ClaimCheck, ClaimInput, Failure, Requirement, Result, Run, RunOutcome, Verdict,
} from '../../../packages/verdicts/src/index.ts';

export const DAY = 86_400_000;
/** 2026-10-01 12:00 UTC. */
export const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
/** A 40-hex commit named by a word. */
export const commitOf = (name: string): string => sha256(`commit ${name}`).slice(0, 40);
export const digestOf = (name: string): string => `d1:${sha256(`check ${name}`)}`;

export const RESULTS: readonly Result[] = ['FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE', 'pending', 'PASS'];
export const RUN_OUTCOMES: readonly RunOutcome[] = ['passed', 'failed', 'ran_nothing', 'missing', 'overran', 'stopped', 'uncounted'];
/** Precedence: FAIL > INVALID > BLOCKED > INCONCLUSIVE > pending > PASS. */
export const RANK: Readonly<Record<Result, number>> = { PASS: 0, pending: 1, INCONCLUSIVE: 2, BLOCKED: 3, INVALID: 4, FAIL: 5 };
export const highest = (results: readonly Result[]): Result => results.reduce<Result>((a, b) => (RANK[b] > RANK[a] ? b : a), 'PASS');

// ---- A seeded generator.
export type Rng = () => number;
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
export const int = (rng: Rng, n: number): number => Math.floor(rng() * n);

// ---- Handles. Record handles are alphanumeric after their scheme.
let counter = 0;
const ALNUM = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const tag = (n: number, width: number): string => {
  let s = '';
  for (let i = 0; i < width; i++) { s = ALNUM[n % 32] + s; n = Math.floor(n / 32); }
  return s;
};
/** A ULID minted at `ms`, unique within this process. */
export function ulidAt(ms: number): string {
  counter++;
  let time = ms, head = '';
  for (let i = 0; i < 10; i++) { head = ALNUM[time % 32] + head; time = Math.floor(time / 32); }
  return head + tag(counter, 16);
}
export const runHandle = (name: string): string => `run:${name.replace(/[^0-9A-Za-z]/g, '')}`;

// ---- Builders.
export const ENV = { os: 'darwin-arm64', locale: 'en-US', tz: 'UTC' } as const;
export const TOOLS = { node: '24.22.0', vitest: '5.0.5' } as const;
export const DEF = 'req:01K74G0A1B2C3D4E5F6G7H8J9K';
export const reqId = (n: number): string => `${DEF}#R${n}`;

export function requirement(n: number, over: Partial<Requirement> = {}): Requirement {
  return { req: reqId(n), depth: 'unit', oracle: 'code', on_base: 'passes', ...over };
}
export function check(id: string, over: Partial<ClaimCheck> = {}): ClaimCheck {
  return {
    check: id, digest: digestOf(id), source: 'definition', depth: 'unit', proof: 'test_run', covers: [reqId(1)],
    inputs: ['src/**'], environment: { ...ENV }, tools: { ...TOOLS }, ...over,
  };
}
export function failure(test: string, over: Partial<Failure> = {}): Failure {
  return {
    test, message: `expected 1800 to be 1801 in ${test}`, cause: 'change:c1',
    frames: [{ file: 'src/total.ts', line: 42 }], covers: ['src/total.ts'], case: `${test} with total 18.00`, ...over,
  };
}
let runCounter = 0;
/** A run of `c` on `commit` that ended as `outcome`; failed and overran runs get a failure unless given. */
export function run(c: ClaimCheck, commit: string, outcome: RunOutcome, over: Partial<Run> = {}): Run {
  runCounter++;
  const base: Run = {
    run: runHandle(`R${runCounter}${c.check}`), check: c.check, claim: 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H', commit, digest: c.digest,
    environment: { ...c.environment }, tools: { ...c.tools }, outcome, ended: T0 + runCounter, tests_run: outcome === 'passed' || outcome === 'failed' ? 12 : 0,
    reads: [], failures: outcome === 'failed' ? [failure(`${c.check}.test.ts › holds`)] : [],
    evidence: [{ slot: 'report', state: 'captured', sha256: sha256(`report ${runCounter}`) }], kept: true,
  };
  if (outcome === 'missing') base.missing = { cause: 'secret STRIPE_TEST_KEY not set', owner: 'you', since: T0 };
  return { ...base, ...over };
}
export const COMMIT = commitOf('D');
export function claim(over: Partial<ClaimInput> = {}): ClaimInput {
  return {
    claim: 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H', agent: 'session:01K74FQ8S1T2V3W4X5Y6Z7A8B9', repo: 'shop', task: 'task:01K74FX2B4D6F8H0K2M4P6R8T0',
    commit: COMMIT, requirements: [requirement(1)], checks: [], runs: [], changes: [], waivers: [], now: T0 + 10 * DAY, ...over,
  };
}

// ---- Reading a verdict.
export const checkOf = (v: Pick<Verdict, 'checks'>, id: string) => {
  const found = v.checks.find((c) => c.check === id);
  if (!found) throw new Error(`the verdict has no result for check ${id}; it has ${v.checks.map((c) => c.check).join(', ')}`);
  return found;
};
export const reqOf = (v: Verdict, id: string) => {
  const found = v.requirements.find((r) => r.req === id);
  if (!found) throw new Error(`the verdict has no outcome for ${id}`);
  return found;
};
export const text = (lines: readonly string[]): string => lines.join('\n');
/** Every number written in a text, as numbers. */
export const numbersIn = (s: string): number[] => [...s.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi)].map((m) => Number(m[0]));
export const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const x = [...new Set(a)].sort(), y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
/** Problems a selection has against what it must rerun and keep; empty when it is right. */
export function selectionProblems(sel: { rerun: string[]; kept: Record<string, string[]> }, rerun: string[], keep: string[]): string[] {
  const out: string[] = [];
  for (const c of rerun) if (!sel.rerun.includes(c)) out.push(`${c} must run again`);
  for (const c of keep) {
    if (sel.rerun.includes(c)) out.push(`${c} must keep its result, not run again`);
    else if (!(sel.kept[c]?.length)) out.push(`${c} must keep its earlier runs`);
  }
  return out;
}
