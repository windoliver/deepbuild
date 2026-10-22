// The reference verdict function (#28 AC27, the design's One table, one reference): a pure function from a
// claim's checks, runs, coverage and definition to its verdict, written from README's rule table and never
// imported by the engine. `planted` turns it into one of the wrong programs the criteria name, so a test can
// show its check fails them.
import type { ClaimCheck, ClaimInput, Depth, Result, Run, RunOutcome } from '../../../packages/verdicts/src/index.ts';

export type Planted =
  | 'first-match'                    // returns the first rule that matches, in the order the design lists them
  | 'pending-below-pass'             // ranks pending below PASS
  | 'commit-only'                    // keys a result by commit alone
  | 'commit-and-digest'              // a cache keyed by commit and check digest alone
  | 'no-carry'                       // counts only runs made on the claim's commit
  | 'carry-removed-evidence'         // carries a result whose evidence retention removed
  | 'declared-only'                  // matches changed paths only against declared inputs
  | 'never-started-as-ran-nothing'   // reads a check with no run as one that ran nothing
  | 'leave-out-never-started';       // leaves a never-started check out of the results

export interface RefCheck { check: string; outcome: Result; counted: string[]; inherited: boolean; never_started: boolean; clean: number; needed: number }
export interface RefVerdict { outcome: Result; stale: boolean; checks: RefCheck[]; requirements: { req: string; outcome: Result }[] }

const RANK: Record<Result, number> = { PASS: 0, pending: 1, INCONCLUSIVE: 2, BLOCKED: 3, INVALID: 4, FAIL: 5 };
const LOW_PENDING: Record<Result, number> = { pending: 0, PASS: 1, INCONCLUSIVE: 2, BLOCKED: 3, INVALID: 4, FAIL: 5 };
const LISTED: readonly Result[] = ['BLOCKED', 'INVALID', 'FAIL', 'INCONCLUSIVE', 'pending', 'PASS'];
const DEPTH: Record<Depth, number> = { unit: 0, integration: 1, journey: 2, live: 3 };

function top(results: readonly Result[], planted?: Planted): Result {
  if (planted === 'first-match') return LISTED.find((r) => results.includes(r)) ?? 'PASS';
  const rank = planted === 'pending-below-pass' ? LOW_PENDING : RANK;
  return results.reduce<Result>((a, b) => (rank[b] > rank[a] ? b : a), 'PASS');
}

// ---- Runs needed: the least n with (1 − p)^n ≤ 0.05, by exact decimal comparison.
export function refRunsNeeded(declared: { runs?: number; accept?: string }): { ok: true; needed: number } | { ok: false; reason: string } {
  if (declared.runs !== undefined) return Number.isInteger(declared.runs) && declared.runs >= 1 ? { ok: true, needed: declared.runs } : { ok: false, reason: `runs ${declared.runs}` };
  if (declared.accept === undefined) return { ok: true, needed: 1 };
  const m = /^(\d+)(?:\.(\d+))?%$/.exec(declared.accept);
  if (!m) return { ok: false, reason: `accept ${declared.accept}` };
  const frac = m[2] ?? '';
  const num = BigInt(m[1]! + frac);
  const den = 100n * 10n ** BigInt(frac.length);
  if (num <= 0n || num >= den) return { ok: false, reason: `accept ${declared.accept}` };
  // (den − num)^n / den^n ≤ 1/20  ⇔  20·(den − num)^n ≤ den^n
  let a = 1n, b = 1n;
  for (let n = 1; n <= 1_000_000; n++) {
    a *= den - num; b *= den;
    if (20n * a <= b) return { ok: true, needed: n };
  }
  return { ok: false, reason: `accept ${declared.accept}` };
}
export function refMoreRuns(declared: { runs?: number; accept?: string }, outcomes: readonly RunOutcome[]): number {
  const need = refRunsNeeded(declared);
  if (!need.ok) return 0;
  if (outcomes.some((o) => o === 'missing' || o === 'ran_nothing' || o === 'stopped')) return 0;
  const passes = outcomes.filter((o) => o === 'passed').length;
  const fails = outcomes.filter((o) => o === 'failed' || o === 'overran').length;
  if (passes && fails) return 0;
  if (fails) return Math.max(0, Math.min(3, need.needed) - fails);
  return Math.max(0, need.needed - passes);
}

// ---- Globs and carry.
const globRe = (glob: string): RegExp =>
  new RegExp(`^${glob.split('**').map((part) => part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*')}$`);
export const globMatch = (glob: string, path: string): boolean => globRe(glob).test(path);
const declares = (c: ClaimCheck): boolean => (c.inputs?.length ?? 0) > 0;

function sameMap(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}
function inputChanged(claim: ClaimInput, c: ClaimCheck, from: string, planted?: Planted): boolean {
  const change = claim.changes.find((ch) => ch.from === from);
  if (!change) return true;
  const reads = new Set(claim.runs.filter((r) => r.check === c.check && r.commit === from).flatMap((r) => r.reads));
  for (const p of change.paths) {
    if (!declares(c)) return true;
    if (c.inputs!.some((g) => globMatch(g, p))) return true;
    if (planted === 'declared-only') continue;
    if (reads.has(p)) return true;
    if (!claim.checks.some((o) => declares(o) && o.inputs!.some((g) => globMatch(g, p)))) return true;
  }
  return false;
}
function counts(claim: ClaimInput, c: ClaimCheck, r: Run, planted?: Planted): boolean {
  if (r.check !== c.check || r.outcome === 'uncounted') return false;
  if (planted === 'commit-only') return r.commit === claim.commit;
  if (r.digest !== c.digest) return false;
  if (planted !== 'commit-and-digest' && !(sameMap(r.environment, c.environment) && sameMap(r.tools, c.tools))) return false;
  const carried = r.commit !== claim.commit;
  if (!r.kept && !(carried && planted === 'carry-removed-evidence')) return false;
  if (!carried) return true;
  if (planted === 'no-carry') return false;
  return !inputChanged(claim, c, r.commit, planted);
}
export function countedRuns(claim: ClaimInput, c: ClaimCheck, planted?: Planted): Run[] {
  const seen = new Set<string>();
  const out: Run[] = [];
  for (const r of claim.runs) {
    if (seen.has(r.run) || !counts(claim, c, r, planted)) continue;
    seen.add(r.run);
    out.push(r);
  }
  return out.sort((a, b) => a.ended - b.ended || (a.run < b.run ? -1 : a.run > b.run ? 1 : 0));
}

// ---- Waivers, normalized as open items are.
const norm = (s: string): string => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.,;:!?]+$/, '');
function waived(claim: ClaimInput, r: Run): boolean {
  if (r.outcome !== 'failed' || r.failures.length === 0) return false;
  const live = claim.waivers.filter((w) => w.check === r.check && w.approved_by !== claim.agent
    && ('date' in w.ends ? w.ends.date > claim.now : !w.ends.met));
  return r.failures.every((f) => live.some((w) => norm(w.error) === norm(f.message)));
}

// ---- One check.
function isFix(claim: ClaimInput, c: ClaimCheck): boolean {
  return c.covers.some((req) => claim.requirements.find((q) => q.req === req)?.on_base === 'fails');
}
export function judgeCheck(claim: ClaimInput, c: ClaimCheck, planted?: Planted): RefCheck {
  const runs = countedRuns(claim, c, planted);
  const need = refRunsNeeded(c);
  const needed = need.ok ? need.needed : 0;
  const counted = runs.map((r) => r.run);
  const passes = runs.filter((r) => r.outcome === 'passed' && r.tests_run > 0);
  const result = (outcome: Result, inherited = false, never = false): RefCheck =>
    ({ check: c.check, outcome, counted, inherited, never_started: never, clean: passes.length, needed });
  if (c.state === 'never_started') return result(planted === 'never-started-as-ran-nothing' ? 'INVALID' : 'pending', false, true);
  const found: Result[] = [];
  if (!need.ok) found.push('BLOCKED');
  if (c.cant_fail) found.push('INVALID');
  if (isFix(claim, c) && c.base && (c.base.outcome === 'passed' || !c.base.on_assertion)) found.push('INVALID');
  if (runs.some((r) => r.outcome === 'missing')) found.push('BLOCKED');
  if (runs.some((r) => r.outcome === 'ran_nothing' || (r.outcome === 'passed' && r.tests_run === 0))) found.push('INVALID');
  if (runs.some((r) => r.contract?.outcome === 'INVALID')) found.push('INVALID');
  const state = c.state ?? (refMoreRuns(c, runs.map((r) => r.outcome)) > 0 ? 'running' : 'ended');
  let inherited = false;
  if (state === 'running') found.push('pending');
  else {
    const fails = runs.filter((r) => (r.outcome === 'failed' || r.outcome === 'overran') && !waived(claim, r));
    if (fails.length && !passes.length) {
      const base = c.base;
      inherited = !isFix(claim, c) && base?.outcome === 'failed'
        && fails.every((r) => r.failures.length > 0 && r.failures.every((f) => base.failed_tests.includes(f.test)));
      found.push(inherited ? 'BLOCKED' : 'FAIL');
    } else if (fails.length && passes.length) found.push('INCONCLUSIVE');
    if (runs.some((r) => r.outcome === 'stopped')) found.push('INCONCLUSIVE');
    if (need.ok && passes.length < need.needed) found.push('INCONCLUSIVE');
    for (const r of runs) for (const slot of r.evidence) {
      if (slot.state === 'missing' && slot.outside_code) found.push('BLOCKED');
      else if (slot.state === 'missing' || slot.state === 'truncated') found.push('INCONCLUSIVE');
    }
  }
  const outcome = top(found, planted);
  return result(outcome, inherited && outcome === 'BLOCKED');
}

/** The reference verdict. */
export function referenceVerdict(claim: ClaimInput, planted?: Planted): RefVerdict {
  const checks = claim.checks.map((c) => {
    const judged = judgeCheck(claim, c, planted);
    return planted === 'leave-out-never-started' && judged.never_started ? { ...judged, outcome: 'PASS' as Result } : judged;
  });
  const byId = new Map(checks.map((r) => [r.check, r]));
  const requirements = claim.requirements.map((q) => {
    const covering = claim.checks.filter((c) => c.covers.includes(q.req));
    const results = covering.map((c) => byId.get(c.check)!.outcome);
    if (q.oracle === 'person') {
      const answer: Result = q.answer === undefined ? 'pending' : q.answer === 'unanswered' ? 'INCONCLUSIVE' : q.answer;
      return { req: q.req, outcome: top([answer, ...results], planted) };
    }
    const atDepth = covering.filter((c) => DEPTH[c.depth] >= DEPTH[q.depth] && (!q.numbers || c.contract !== undefined));
    const coverage: Result = atDepth.length === 0 ? 'INVALID' : atDepth.every((c) => c.source === 'own') ? 'INCONCLUSIVE' : 'PASS';
    return { req: q.req, outcome: top([coverage, ...results], planted) };
  });
  const all: Result[] = [...checks.map((c) => c.outcome), ...requirements.map((r) => r.outcome)];
  if (claim.checks.length === 0) all.push('INVALID');
  return {
    outcome: top(all, planted),
    stale: claim.checks.some((c) => c.state === 'never_started' && c.never_started === 'newer_claim'),
    checks, requirements,
  };
}

/** The reference selection: every check with no counted run on the claim's commit runs again. */
export function referenceSelect(claim: ClaimInput, planted?: Planted): { rerun: string[]; kept: Record<string, string[]> } {
  const rerun: string[] = [];
  const kept: Record<string, string[]> = {};
  for (const c of claim.checks) {
    const runs = countedRuns(claim, c, planted);
    if (runs.length) kept[c.check] = runs.map((r) => r.run);
    else rerun.push(c.check);
  }
  return { rerun, kept };
}
