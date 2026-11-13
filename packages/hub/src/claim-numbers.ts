// The checks a claim's numbers get beyond those its words cite with a query (#1863): one per speed its final message
// states with the timing check behind it, and one for the terms its diff adds to a query, run on the read-only sample
// its definition names. Each is the claim's own statement, so neither runs on the merge base and neither failure is
// ever inherited from there; and neither fits a fast lane, so each runs once the turn ends. What they read beyond the
// claim's checkout comes from the hub's object store: the merge base's timing check and sample, and a checkout of the
// baseline's commit.
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import type { AddedTerm, NumbersSpec } from '@deepbuild/checks-numbers';
import type { CheckContext, CheckResult, CheckSpec } from '@deepbuild/conformance';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { gitEnv } from '@deepbuild/gate';
import type { TimingReport } from '@deepbuild/verdicts';
import { blobAt, recordable, runSpeed, SPEED_DEADLINE_MS, SPEED_EXPECTED_MS, statedSpeeds, type ClaimRepo, type SpeedSpec } from './speed.js';
import { addedTerms } from './terms.js';
import type { ClaimCheck } from './gate-runner.js';

/** The terms a claim's diff adds to its queries, with the sample they run on as the merge base `base` holds it. */
export interface TermsSpec extends CheckSpec { kind: 'numbers'; runner: 'terms'; base: string; sample: string; added: AddedTerm[] }
/** A check a claim's numbers get, as the gate runs it, and its spec. */
export interface NumbersCheck { check: ClaimCheck; spec: SpeedSpec | TermsSpec }
/** What a query file may hold at most: a file past it is no query this reads. */
const QUERY_BYTES = 256 * 1024;
/** The terms' queries on a sample of real data, whose time nothing knows before they've run on it, never fit a fast lane. */
const TERMS_EXPECTED_MS = 30_000;

/** Git in `cwd`, read-only, taking no optional lock: a claim's read never holds the session's index. */
const git = (cwd: string, args: string[]): Promise<string | undefined> => new Promise((done) =>
  execFile('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 << 20, env: { ...gitEnv(), GIT_OPTIONAL_LOCKS: '0' } }, (error, out) => done(error ? undefined : out)));
const inRepo = (path: string): boolean => { const p = normalize(path); return p !== '.' && !isAbsolute(p) && !p.startsWith('..'); };
const readText = (path: string): string | undefined => { try { return readFileSync(path, 'utf8'); } catch { return undefined; } };
/** The command a check's record names: what it is and its spec's digest, so a run of another spec counts for nothing. */
const commandOf = (what: string, spec: CheckSpec): string => `${what} ${sha256Hex(canonicalize(spec as unknown as JsonValue))}`;
/**
 * A check the claim's own statement gives: it covers no requirement and runs on no merge base, so a failure is the
 * claim's and never inherited from there; its expected time keeps it out of any fast lane, so it runs once the turn ends.
 */
const claimCheck = (check: string, spec: SpeedSpec | TermsSpec, what: string, expected_ms: number, deadline_ms?: number): NumbersCheck => ({
  check: { check: check.slice(0, 1000), approved: null, command: commandOf(what, spec), covers: [], depth: 'unit', on_base: 'passes', asserts: [], source: 'definition', expected_ms, ...(deadline_ms ? { deadline_ms } : {}) },
  spec,
});

/**
 * The checks a claim's words and diff give the numbers kind, read in the session's worktree `cwd` against the
 * definition's base commit `base`: each stated speed with its timing check, and the terms its diff adds to a query
 * file where its definition names a read-only sample. A query file is a `.sql` file the claim changed, as the merge
 * base wrote it and as the worktree holds it, which is what the claim's snapshot takes.
 */
export async function numbersChecks(words: string, cwd: string, base: string, sample: string | null): Promise<NumbersCheck[]> {
  const speeds = statedSpeeds(words);
  const top = speeds.length || sample ? (await git(cwd, ['rev-parse', '--show-toplevel']))?.trim() : undefined;
  if (!top) return [];
  // The merge base of the work and the base: the snapshot taken next has the worktree's head as its parent.
  const merged = (await git(top, ['merge-base', 'HEAD', base]))?.trim() || base;
  const out: NumbersCheck[] = [];
  for (const s of speeds) {
    const spec: SpeedSpec = { kind: 'numbers', runner: 'timing', inputs: [s.file], depth: 'unit', oracle: 'code', contract: null, stated: s.stated, file: s.file, base: merged };
    out.push(claimCheck(`speed: ${s.stated} (${s.file})`, spec, 'speed', SPEED_EXPECTED_MS, SPEED_DEADLINE_MS));
  }
  if (!sample || !inRepo(sample)) return out;
  const at = normalize(sample);
  const names = (await git(top, ['diff', '--name-only', '--no-renames', '--diff-filter=M', '-z', merged, '--', '*.sql']))?.split('\0').filter(Boolean) ?? [];
  const added: AddedTerm[] = [];
  for (const path of names) {
    const before = await git(top, ['show', `${merged}:${path}`]);
    const after = readText(join(top, path));
    if (before !== undefined && after !== undefined && before.length <= QUERY_BYTES && after.length <= QUERY_BYTES) added.push(...addedTerms(before, after, at));
  }
  if (added.length) {
    const spec: TermsSpec = { kind: 'numbers', runner: 'terms', inputs: [at], depth: 'unit', oracle: 'code', contract: null, base: merged, sample: at, added };
    out.push(claimCheck(`numbers: ${added.map((t) => `the ${t.kind} ${t.term}`).join(', ')} (${at})`, spec, 'numbers', TERMS_EXPECTED_MS));
  }
  return out;
}

/** Whether a kind's spec is one `numbersChecks` gave. */
export const claimNumbers = (spec: CheckSpec): spec is SpeedSpec | TermsSpec => spec.kind === 'numbers' && (spec.runner === 'timing' || spec.runner === 'terms');

/**
 * The terms on the sample as the merge base holds it: the definition names the sample, so what the change writes there
 * is never what its terms are judged on. Its bytes come from the hub's store into a folder of the run's own, read-only,
 * and the numbers check runs each term there with it and without it. A sample the merge base doesn't hold is missing,
 * yours to provide, never a pass.
 */
async function runTerms(spec: TermsSpec, ctx: CheckContext, store: string, numbers: (spec: NumbersSpec, ctx: CheckContext) => Promise<CheckResult>): Promise<CheckResult> {
  const bytes = await blobAt(store, spec.base, spec.sample);
  if (!bytes) return { outcome: 'missing', testsRun: 0, failures: [{ test: `numbers: sample ${spec.sample}`, file: spec.sample, line: 1, stack: null, assertion: false, message: `the sample ${spec.sample} the definition names isn't a file in the merge base ${spec.base}` }], evidence: [], read: [], mask: null };
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'deep-sample-'));
  try {
    const file = join(dir, spec.sample);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes, { mode: 0o444, flag: 'wx' });
    chmodSync(file, 0o444);
    const ran = await numbers({ kind: 'numbers', runner: 'sqlite', inputs: [spec.sample], depth: 'unit', oracle: 'code', contract: null, numbers: [], added: spec.added }, { ...ctx, checkout: dir });
    return { ...ran, failures: recordable(ran.failures) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One run of a check `numbersChecks` gave: a stated speed through its timing check, or the terms on the sample. */
export function runClaimNumbers(spec: SpeedSpec | TermsSpec, ctx: CheckContext, repo: ClaimRepo, numbers: (spec: NumbersSpec, ctx: CheckContext) => Promise<CheckResult>, stop?: AbortSignal): Promise<CheckResult & { speed?: TimingReport }> {
  return spec.runner === 'timing' ? runSpeed(spec, ctx, repo, stop) : runTerms(spec, ctx, repo.store, numbers);
}
