// The verdict engine (#28): a claim's checks, runs, coverage and definition in, one verdict out. Every rule
// that applies is a row; the highest by precedence wins. Pure: every input, the time included, is an argument.
import { createHash } from 'node:crypto';
import { moreRuns, runsNeeded } from './runs.js';
import type {
  CheckResult, ClaimCheck, ClaimInput, Contradiction, Depth, Failure, FixTask, OpenItem, OpenItemScope, PointsTo, Prediction,
  Requirement, RequirementOutcome, Result, Run, RunOutcome, SendBack, Verdict, VerdictAsk, VerdictKey,
} from './types.js';

/** A sha256 as evidence records it: only captured evidence with one supports a PASS. */
const HEX64 = /^[0-9a-f]{64}$/;
/** The evidence states, the closed set. */
const SLOT_STATES: ReadonlySet<string> = new Set(['captured', 'not_requested', 'missing', 'truncated']);

const RANK: Readonly<Record<Result, number>> = { PASS: 0, pending: 1, INCONCLUSIVE: 2, BLOCKED: 3, INVALID: 4, FAIL: 5 };
const DEPTH: Readonly<Record<Depth, number>> = { unit: 0, integration: 1, journey: 2, live: 3 };
const highest = (results: Iterable<Result>): Result => {
  let top: Result = 'PASS';
  for (const r of results) if (RANK[r] > RANK[top]) top = r;
  return top;
};
const unique = <T>(items: Iterable<T>): T[] => [...new Set(items)];
const sorted = (items: Iterable<string>): string[] => unique(items).sort();

/** Unicode NFC, case folded, white space collapsed and trailing punctuation dropped. */
const normalize = (text: string): string =>
  text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').replace(/[\s.,;:!?]+$/, '').trim();
const canonical = (value: unknown): string => JSON.stringify(value, (_, v: unknown) =>
  (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
const sha256 =(text: string): string => createHash('sha256').update(text).digest('hex');

/** An open item's ID: a hash of its normalized text and its scope. */
export function openItemId(text: string, scope: OpenItemScope): string {
  return sha256(canonical({ text: normalize(text), repo: scope.repo, task: scope.task, req: scope.req }));
}

// ---- Which runs count, and which carry from an earlier commit.

const globs = new Map<string, string[] | null>();
/** Glob syntax beyond `**` and `*`: braces, classes, `?`, `!`, escapes and a leading `./`. */
const UNKNOWN = /[{}[\]?!\\]|^\.\//;
/**
 * A glob is read by segments, as the acceptance reference reads it: `**` as a whole segment matches any number of
 * non-empty folders, none included, and as the last segment everything under the folder before it; `*` matches
 * anything within one segment, and a run of stars glued to text is one `*`. Matched by tables over the segments
 * and their characters, so the cost is their product and no glob can make it backtrack. A glob in syntax beyond
 * that matches every path, so a check whose inputs can't be read always runs again.
 */
function globMatch(glob: string, path: string): boolean {
  let segments = globs.get(glob);
  if (segments === undefined) {
    segments = UNKNOWN.test(glob) ? null : glob.split('/');
    if (globs.size >= 1024) globs.clear();
    globs.set(glob, segments);
  }
  if (segments === null) return true;
  if (glob === '**') return true;
  const parts = path.split('/');
  const G = segments.length, P = parts.length;
  // next[p]: the segments after the one in hand match the path's segments from p.
  let next = new Uint8Array(P + 1);
  let here = new Uint8Array(P + 1);
  next[P] = 1;
  for (let g = G - 1; g >= 0; g--) {
    const segment = segments[g]!;
    for (let p = P; p >= 0; p--) {
      if (segment === '**') here[p] = g === G - 1 ? (p < P ? 1 : 0) : next[p] || (p < P && parts[p] !== '' && here[p + 1]) ? 1 : 0;
      else here[p] = p < P && segmentMatch(segment, parts[p]!) && next[p + 1] ? 1 : 0;
    }
    [next, here] = [here, next];
  }
  return next[0] === 1;
}
/** One glob segment against one path segment: `*` (or any run of stars) matches any characters. */
function segmentMatch(segment: string, part: string): boolean {
  if (!segment.includes('*')) return segment === part;
  const n = part.length;
  let next = new Uint8Array(n + 1);
  let here = new Uint8Array(n + 1);
  next[n] = 1;
  let star = false;
  for (let i = segment.length - 1; i >= 0; i--) {
    const c = segment[i];
    if (c === '*') {
      if (star) continue;
      star = true;
      for (let j = n; j >= 0; j--) here[j] = next[j] || (j < n && here[j + 1]) ? 1 : 0;
    } else {
      star = false;
      for (let j = n; j >= 0; j--) here[j] = j < n && part[j] === c && next[j + 1] ? 1 : 0;
    }
    [next, here] = [here, next];
  }
  return next[0] === 1;
}
const declared = (c: ClaimCheck): readonly string[] => c.inputs ?? [];
const sameMap = (a: Record<string, string>, b: Record<string, string>): boolean => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && a[k] === b[k]);
};
const byEnd = (a: Run, b: Run): number => a.ended - b.ended || (a.run < b.run ? -1 : a.run > b.run ? 1 : 0);

class Selection {
  private readonly runs: Run[];
  private readonly changes: Map<string, string[]>;
  private readonly carries = new Map<string, boolean>();
  /** The paths a check's runs read on a commit, by `${check}\0${commit}`. */
  private readonly reads = new Map<string, Set<string>>();
  /** Whether some check on the claim declares a glob that matches a path. */
  private readonly covered = new Map<string, boolean>();
  /** Run IDs whose records differ, by check: none of those records counts, whichever arrived first. */
  readonly conflicts = new Map<string, Map<string, Set<RunOutcome>>>();
  constructor(private readonly claim: ClaimInput) {
    const byId = new Map<string, Run[]>();
    for (const r of claim.runs) {
      const records = byId.get(r.run);
      if (records) records.push(r);
      else byId.set(r.run, [r]);
    }
    this.runs = [];
    for (const [id, records] of byId) {
      // Only a run ID with more than one record is compared, by content: identical copies are one record.
      const copies = records.length === 1 ? records : [...new Map(records.map((r) => [canonical(r), r])).values()];
      if (copies.length === 1) { this.runs.push(copies[0]!); continue; }
      for (const r of copies) {
        const byCheck = this.conflicts.get(r.check) ?? new Map<string, Set<RunOutcome>>();
        byCheck.set(id, (byCheck.get(id) ?? new Set<RunOutcome>()).add(r.outcome));
        this.conflicts.set(r.check, byCheck);
      }
    }
    this.runs.sort(byEnd);
    // Reads count from every record of the check on a commit, a conflicting one included.
    for (const r of claim.runs) {
      const at = `${r.check}\0${r.commit}`;
      const reads = this.reads.get(at) ?? new Set<string>();
      for (const path of r.reads) reads.add(path);
      this.reads.set(at, reads);
    }
    this.changes = new Map();
    for (const c of claim.changes) this.changes.set(c.from, [...(this.changes.get(c.from) ?? []), ...c.paths]);
  }
  /**
   * Whether the claim's commit keeps a check's result from an earlier commit: the claim names the change, and no
   * changed path is an input of the check. A path is an input when the check declares none, matches one of its
   * globs, was read by its runs there, or matches no glob any check on the claim declares.
   */
  private carry(c: ClaimCheck, from: string): boolean {
    const key = `${c.check}\0${from}`;
    let carries = this.carries.get(key);
    if (carries === undefined) {
      carries = this.declaredCarry(c, from) && !this.readChanged(c, from).length;
      this.carries.set(key, carries);
    }
    return carries;
  }
  /** The change from `from` is named and touches no declared input of the check, nor a path no check declares. */
  private declaredCarry(c: ClaimCheck, from: string): boolean {
    const paths = this.changes.get(from);
    return paths !== undefined && !paths.some((p) =>
      declared(c).length === 0 || declared(c).some((g) => globMatch(g, p)) || !this.isCovered(p));
  }
  /** The changed paths, in order, that runs of the check on `from` read. */
  private readChanged(c: ClaimCheck, from: string): string[] {
    const reads = this.reads.get(`${c.check}\0${from}`);
    return reads ? sorted(this.changes.get(from) ?? []).filter((p) => reads.has(p)) : [];
  }
  private isCovered(path: string): boolean {
    let covered = this.covered.get(path);
    if (covered === undefined) {
      covered = this.claim.checks.some((o) => declared(o).some((g) => !UNKNOWN.test(g) && globMatch(g, path)));
      this.covered.set(path, covered);
    }
    return covered;
  }
  /** A run whose key matches its check and whose evidence is kept. */
  private keyed(c: ClaimCheck, r: Run): boolean {
    return r.check === c.check && r.outcome !== 'uncounted' && r.digest === c.digest
      && sameMap(r.environment, c.environment) && sameMap(r.tools, c.tools) && r.kept;
  }
  /** A check's counted runs: its key matches, its evidence is kept, and it ran on the claim's commit or carries. */
  counted(c: ClaimCheck): Run[] {
    return this.runs.filter((r) => this.keyed(c, r) && (r.commit === this.claim.commit || this.carry(c, r.commit)));
  }
  /**
   * Why the check's result is stale: results its declarations would carry from earlier commits are withdrawn,
   * because runs of it there read paths the changes touched, and no run of it on the claim's commit counts yet.
   * Null otherwise. Its inputs changed, so it runs again on the claim's commit.
   */
  stale(c: ClaimCheck): string | null {
    if (this.counted(c).some((r) => r.commit === this.claim.commit)) return null;
    const withdrawn = new Map<string, { runs: string[]; paths: string[] }>();
    for (const r of this.runs) {
      if (r.commit === this.claim.commit || !this.keyed(c, r) || !this.declaredCarry(c, r.commit)) continue;
      const paths = this.readChanged(c, r.commit);
      if (paths.length) withdrawn.set(r.commit, { runs: [...(withdrawn.get(r.commit)?.runs ?? []), r.run], paths });
    }
    if (!withdrawn.size) return null;
    const why = [...withdrawn].sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([commit, w]) => `its runs on ${commit} read ${w.paths.join(', ')}, which changed, so ${w.runs.join(', ')} no longer carry`);
    return `stale: ${why.join('; ')}; it runs again on ${this.claim.commit}`;
  }
  /** The newest passed run of a check with journey steps, on any commit. */
  lastPass(check: string): Run | undefined {
    return this.runs.filter((r) => r.check === check && r.outcome === 'passed' && r.steps).at(-1);
  }
}

/**
 * Which checks run again on the claim's commit: those with no counted run there or carried to it, and those whose
 * carried result was withdrawn (stale).
 */
export function selectReruns(claim: ClaimInput): { rerun: string[]; kept: Record<string, string[]> } {
  const sel = new Selection(claim);
  const rerun: string[] = [];
  const kept: Record<string, string[]> = {};
  for (const c of claim.checks) {
    const runs = sel.counted(c);
    if (runs.length) kept[c.check] = runs.map((r) => r.run);
    if (!runs.length || sel.stale(c) !== null) rerun.push(c.check);
  }
  return { rerun, kept };
}

// ---- One check.

/** One rule that applies: its result, the reason (which may name runs), and the open item's words (which don't). */
interface Row { result: Result; reason: string; item: string; closes: string; unblock?: string }
interface Judged {
  check: ClaimCheck;
  result: CheckResult;
  rows: Row[];
  runs: Run[];
  /** The failing runs no live waiver accepts. */
  fails: Run[];
  /** Clean runs still to come on this commit: none once a run is flaky or stopped. */
  short: number;
  /** Every failure is one the merge base shares, whatever rule decides the check. */
  inherits: boolean;
  /** The tests the merge base fails, when this check can inherit them. */
  base: Set<string> | null;
  /** What its deciding rows need you to provide: each missing thing you own, when that decides it. */
  unblocks: string[];
}

/** A failure a live waiver accepts by its exact error text: approved by someone other than the claimant, not ended. */
function waivedFailure(claim: ClaimInput, check: string, f: Failure): boolean {
  return claim.waivers.some((w) => w.check === check && w.approved_by !== claim.agent
    && ('date' in w.ends ? w.ends.date > claim.now : !w.ends.met) && normalize(w.error) === normalize(f.message));
}
const waived = (claim: ClaimInput, r: Run): boolean =>
  r.outcome === 'failed' && r.failures.length > 0 && r.failures.every((f) => waivedFailure(claim, r.check, f));
const isFix = (claim: ClaimInput, c: ClaimCheck): boolean =>
  c.covers.some((req) => claim.requirements.find((q) => q.req === req)?.on_base === 'fails');
/** The tests the merge base fails, for a check that isn't a fix check; null when none can be inherited. */
const baseFailed = (claim: ClaimInput, c: ClaimCheck): Set<string> | null =>
  !isFix(claim, c) && c.base?.outcome === 'failed' ? new Set(c.base.failed_tests) : null;
/** A failure the merge base also shows. */
const onBase = (base: Set<string> | null, f: Failure): boolean => base?.has(f.test) ?? false;

function judge(claim: ClaimInput, sel: Selection, c: ClaimCheck): Judged {
  const id = c.check;
  const runs = sel.counted(c);
  const need = runsNeeded(c);
  const needed = need.ok ? need.needed : 0;
  const base = baseFailed(claim, c);
  const passes = runs.filter((r) => r.outcome === 'passed' && r.tests_run > 0);
  // A mark, not a row: the withdrawn runs don't count, and the check runs again on the claim's commit.
  const stale = c.state === 'never_started' ? null : sel.stale(c);
  const rows: Row[] = [];
  const row = (result: Result, reason: string, item = reason, closes = item, unblock?: string): void => {
    rows.push({ result, reason: `${id}: ${reason}`, item, closes, ...(unblock === undefined ? {} : { unblock }) });
  };
  let fails: Run[] = [];
  let flaky = false;
  let short = 0;
  let inherited = false;

  if (c.state === 'never_started') {
    row('pending', `never started on this snapshot (${c.never_started ?? 'unknown'})`);
  } else {
    if (!need.ok) row('BLOCKED', need.reason);
    if (c.cant_fail) row('INVALID', `can't fail: ${c.cant_fail}`);
    if (isFix(claim, c)) {
      const proves = 'a run of it on the merge base that fails on an assertion it names';
      if (!c.base) row('INVALID', 'has no run on the merge base, so nothing proves the fix', undefined, proves);
      else if (c.base.outcome === 'passed') row('INVALID', 'passes on the merge base, so it can\'t prove the fix', undefined, proves);
      else if (!c.base.on_assertion) row('INVALID', 'failed on the merge base only off its named assertions, so it proves nothing', undefined, proves);
    }
    const causes = new Set<string>();
    for (const r of runs) {
      if (r.outcome !== 'missing') continue;
      const cause = r.missing?.cause ?? 'unknown cause';
      if (causes.has(cause)) continue;
      causes.add(cause);
      row('BLOCKED', `missing ${cause}, owner ${r.missing?.owner ?? 'unknown'}`, `missing ${cause}`, cause, r.missing?.owner === 'you' ? cause : undefined);
    }
    if (runs.some((r) => r.outcome === 'ran_nothing' || (r.outcome === 'passed' && r.tests_run === 0))) row('INVALID', 'ran nothing');
    for (const [run, outcomes] of [...(sel.conflicts.get(id) ?? [])].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      row('INVALID', `two records of ${run} differ (${sorted(outcomes).join(', ')}), so neither counts`, 'two records of one run ID differ', 'one record per run ID');
    }
    for (const reason of unique(runs.flatMap((r) => (r.contract?.outcome === 'INVALID' ? r.contract.reasons : [])))) row('INVALID', reason);
    // An INVALID report makes its check INVALID whether or not it gives reasons.
    const silent = runs.filter((r) => r.contract?.outcome === 'INVALID' && !r.contract.reasons.length).map((r) => r.run);
    if (silent.length) row('INVALID', `contract report INVALID with no reasons from ${silent.join(', ')}`, 'a contract report is INVALID with no reasons');
    // A contract's run reports its twin and its compared counts; without that report nothing shows the twin ran.
    const unreported = c.contract ? runs.filter((r) => (r.outcome === 'passed' || r.outcome === 'failed') && !r.contract) : [];
    if (unreported.length) row('INVALID', `no contract report from ${unreported.map((r) => r.run).join(', ')}`, 'a run has no contract report');
    // Ended as the hub counts it, from every counted run: a waived failure ends runs as a failure does.
    const state = c.state ?? (moreRuns(c, runs.map((r) => r.outcome)) > 0 ? 'running' : 'ended');
    if (state === 'running') {
      row('pending', 'runs still to come');
    } else {
      // A run that isn't wholly waived still fails, on its failures no waiver accepts.
      fails = runs.filter((r) => (r.outcome === 'failed' || r.outcome === 'overran') && !waived(claim, r))
        .map((r) => ({ ...r, failures: r.failures.filter((f) => !waivedFailure(claim, r.check, f)) }));
      const overran = fails.some((r) => r.outcome === 'overran') ? [`overran its deadline ${c.deadline ?? '(none stated)'}`] : [];
      if (fails.length && !passes.length) {
        // With no failed merge base (or for a fix), no failure is on the base, so none is inherited.
        inherited = fails.every((r) => r.failures.length > 0 && r.failures.every((f) => onBase(base, f)));
        const tests = sorted(fails.flatMap((r) => r.failures).filter((f) => inherited || !onBase(base, f)).map((f) => f.test));
        const what = [...tests, ...overran].join(', ') || 'failed';
        if (inherited) row('BLOCKED', `inherited: also fails on the merge base: ${what}`, undefined, 'a fix on the default branch for each cause');
        else row('FAIL', `failed on every real run: ${what}`, undefined, 'a commit whose runs pass');
      } else if (fails.length) {
        flaky = true;
        row('INCONCLUSIVE', `passed and failed on real runs of one commit; failing runs ${fails.map((r) => r.run).join(', ')}`,
          'passed and failed on real runs of one commit', 'a waiver, a quarantine, your answer or a commit that changes its inputs');
      }
      const stopped = runs.some((r) => r.outcome === 'stopped');
      if (stopped) row('INCONCLUSIVE', 'a run was stopped before it ended', undefined, 'a run that ends');
      // Every real run failed only on waived errors: the check is unwatched while the waivers last, and no
      // number of clean runs is owed, since each would fail the same way.
      const waivedRuns = runs.filter((r) => waived(claim, r));
      const unwatched = waivedRuns.length > 0 && !passes.length && !fails.length;
      if (unwatched) {
        const errors = unique(waivedRuns.flatMap((r) => r.failures.map((f) => f.message))).join(', ');
        row('INCONCLUSIVE', `every failure of its runs is waived: ${errors}`, 'every failure of its runs is waived', 'the waived error gone from its runs, or the waiver\'s end');
      }
      if (need.ok && !flaky && !stopped && !unwatched && passes.length < needed) {
        short = needed - passes.length;
        row('INCONCLUSIVE', `${passes.length} of ${needed} clean runs`, `fewer clean runs than the ${needed} it needs`, `${needed - passes.length} more clean runs`);
      }
      const slots = new Set<string>();
      for (const r of runs) for (const s of r.evidence) {
        const key = `${s.state} ${s.outside_code === true} ${s.slot}`;
        const uncaptured = (s.state === 'captured' && !(s.sha256 && HEX64.test(s.sha256))) || !SLOT_STATES.has(s.state);
        if (slots.has(key) || (s.state !== 'missing' && s.state !== 'truncated' && !uncaptured)) continue;
        slots.add(key);
        // The open item's words leave out what one run said, so the item is the same whichever run came first.
        if (s.state === 'missing' && s.outside_code) row('BLOCKED', `evidence ${s.slot} missing for a cause outside the code: ${s.reason ?? 'unknown'}`, `evidence ${s.slot} missing for a cause outside the code`, `evidence ${s.slot} captured`);
        else if (!SLOT_STATES.has(s.state)) row('INCONCLUSIVE', `evidence ${s.slot} in an unknown state ${s.state}`, `evidence ${s.slot} in an unknown state`, `evidence ${s.slot} captured`);
        else if (uncaptured) row('INCONCLUSIVE', `evidence ${s.slot} captured with no digest of what it holds`, `evidence ${s.slot} with no digest`, `evidence ${s.slot} captured`);
        else if (s.state === 'missing') row('INCONCLUSIVE', `evidence ${s.slot} missing: ${s.reason ?? 'unknown'}`, `evidence ${s.slot} missing`, `evidence ${s.slot} captured`);
        else row('INCONCLUSIVE', `evidence ${s.slot} truncated${s.counts ? `: ${s.counts.kept} of ${s.counts.expected}` : ''}`, `evidence ${s.slot} truncated`, `evidence ${s.slot} captured complete`);
      }
    }
  }
  const outcome = highest(rows.map((r) => r.result));
  const reasons = outcome === 'PASS'
    ? [`${id}: PASS on ${passes.length} clean run${passes.length === 1 ? '' : 's'}`]
    : rows.filter((r) => r.result === outcome).map((r) => r.reason);
  return {
    check: c, rows, runs, fails, short, inherits: inherited, base, unblocks: rows.flatMap((r) => (r.result === outcome && r.unblock !== undefined ? [r.unblock] : [])),
    result: {
      check: id, outcome, reasons, counted: runs.map((r) => r.run), clean: passes.length, needed,
      inherited: inherited && outcome === 'BLOCKED', never_started: c.state === 'never_started', stale,
    },
  };
}

// ---- Where a FAIL points.

interface Pointer { smallest: string; points_to: PointsTo }
/** A FAIL check's smallest failing case and where it points, from its first failure the merge base doesn't share. */
function pointer(sel: Selection, j: Judged): Pointer | null {
  if (j.result.outcome !== 'FAIL') return null;
  // A failure the base doesn't share, from any failing run, then an overrun, before one the base shares.
  const own = j.fails.find((r) => r.failures.some((x) => !onBase(j.base, x))) ?? j.fails.find((r) => !r.failures.length);
  for (const r of own ? [own] : j.fails) {
    const f = r.failures.find((x) => !onBase(j.base, x)) ?? r.failures[0];
    let step: string | null = null;
    const passed = r.steps ? sel.lastPass(j.check.check)?.steps : undefined;
    if (passed && r.steps) {
      const n = Math.max(r.steps.length, passed.length);
      for (let i = 0; i < n; i++) {
        const a = r.steps[i], b = passed[i];
        if (a?.id !== b?.id || a?.digest !== b?.digest) { step = (a ?? b)!.id; break; }
      }
    }
    if (!f) {
      const what = r.outcome === 'overran' ? `overran its deadline ${j.check.deadline ?? '(none stated)'}` : 'failed';
      return { smallest: `${j.check.check} ${what}`, points_to: { frames: [], covers: [], step } };
    }
    return {
      smallest: f.case ?? `${f.test}: ${f.message}`,
      points_to: { frames: f.frames.map((x) => `${x.file}:${x.line}`), covers: [...f.covers], step },
    };
  }
  return null;
}
const pointsText = (p: PointsTo): string =>
  [...p.frames, ...p.covers.map((c) => `covers ${c}`), ...(p.step ? [`step ${p.step}`] : [])].join(', ');

// ---- The claim.

export function verdict(claim: ClaimInput): Verdict {
  const sel = new Selection(claim);
  const judged = claim.checks.map((c) => judge(claim, sel, c));
  const blocked = new Map<string, string[]>();
  for (const j of judged) for (const cause of j.unblocks) blocked.set(cause, [...(blocked.get(cause) ?? []), j.check.check]);
  const asks: VerdictAsk[] = [...blocked].map(([cause, checks]) => ({
    kind: 'unblock', question: `${checks.join(', ')} ${checks.length === 1 ? 'is' : 'are'} missing ${cause}. Can you provide it?`,
    req: null, check: checks.length === 1 ? checks[0]! : null,
  }));
  const approvals = new Map<string, string[]>();
  const items: OpenItem[] = [];
  const reasons: string[] = [];
  const pointers = new Map(judged.map((j) => [j.check.check, pointer(sel, j)]));

  const requirements = claim.requirements.map((q) => requirementOutcome(claim, q, judged.filter((j) => j.check.covers.includes(q.req)), pointers, approvals, items, reasons));
  // One approve ask per own check, naming every requirement its approval closes.
  for (const [approve, reqs] of approvals) {
    asks.push({ kind: 'authority', question: `Approve ${approve} as the check for ${reqs.join(', ')}?`, req: reqs.length === 1 ? reqs[0]! : null, check: approve });
  }
  const outcomes: Result[] = [...judged.map((j) => j.result.outcome), ...requirements.map((r) => r.outcome)];
  /** The claim itself is INVALID: its reason goes first, with an open item naming what closes it. */
  const invalid = (why: string, evidence: string): void => {
    outcomes.push('INVALID');
    reasons.unshift(why);
    const scope = { repo: claim.repo, task: claim.task, req: null };
    const text = `INVALID: ${why}`;
    items.push({ id: openItemId(text, scope), text, scope, check: null, closes_with: { evidence, depth: null, environment: null, runs_needed: 0 }, needs_you: false });
  };
  const badState = (claim.state ?? []).filter((d) => !HEX64.test(d));
  if (badState.length) {
    invalid(`state digest${badState.length === 1 ? '' : 's'} ${sorted(badState).join(', ')} ${badState.length === 1 ? 'isn\'t' : 'aren\'t'} a sha256, so the verdict can't pin to the workspace's state`,
      'state digests as sha256 hex from the workspace\'s state sources');
  }
  if (!claim.checks.length) {
    const reqs = claim.requirements.map((q) => q.req);
    invalid(`no check was selected for the claim${reqs.length ? `, so nothing checks ${reqs.join(', ')}` : ''}`, 'a check selected for the claim');
  } else if (!claim.requirements.length && claim.checks.every((c) => c.source === 'own')) {
    // With no requirement to cover, the claim itself is what its checks cover, and the agent's own never pass it.
    const passed = judged.find((j) => j.result.outcome === 'PASS');
    const approve = (passed ?? judged[0]!).check.check;
    outcomes.push('INCONCLUSIVE');
    reasons.unshift(`${claim.claim} is covered only by the agent's own checks: approve ${approve}`);
    if (passed && highest(judged.map((j) => j.result.outcome)) === 'PASS') {
      asks.push({ kind: 'authority', question: `Approve ${approve} as a check for this claim?`, req: null, check: approve });
    }
  }
  const outcome = highest(outcomes);

  for (const j of judged) {
    const r = j.result;
    if (r.outcome !== 'PASS' || outcome === 'PASS') reasons.push(...r.reasons);
    if (r.outcome === 'PASS' || r.outcome === 'pending') continue;
    const winning = j.rows.filter((x) => x.result === r.outcome);
    const scope = { repo: claim.repo, task: claim.task, req: j.check.covers[0] ?? null };
    const text = `${j.check.check} ${r.outcome}: ${sorted(winning.map((x) => x.item)).join('; ')}`;
    items.push({
      id: openItemId(text, scope), text, scope, check: j.check.check,
      closes_with: {
        evidence: sorted(winning.map((x) => x.closes)).join('; '), depth: j.check.depth, environment: canonical(j.check.environment),
        runs_needed: r.outcome === 'INCONCLUSIVE' ? j.short : 0,
      },
      needs_you: j.unblocks.length > 0,
    });
  }

  // One send-back per cause of the FAIL checks' failures the base doesn't share; one fix task per inherited cause.
  const sendBacks = new Map<string, { cause: string; checks: Set<string>; smallest: string | null }>();
  const fixTasks = new Map<string, { cause: string; checks: Set<string>; tests: Set<string> }>();
  for (const j of judged) {
    const { outcome: o } = j.result;
    const inherited = j.inherits;
    if (o !== 'FAIL' && !inherited) continue;
    for (const r of j.fails) {
      const failures = r.failures.length ? r.failures : [null];
      for (const f of failures) {
        if (f && (inherited || onBase(j.base, f))) {
          const task = fixTasks.get(f.cause) ?? { cause: f.cause, checks: new Set<string>(), tests: new Set<string>() };
          task.checks.add(j.check.check);
          task.tests.add(f.test);
          fixTasks.set(f.cause, task);
        } else if (o === 'FAIL') {
          const cause = f?.cause ?? j.check.check;
          // Its smallest case comes from its own cause: the failure's case, or the overrun itself.
          const own = f ? f.case ?? `${f.test}: ${f.message}` : `${j.check.check} ${r.outcome === 'overran' ? `overran its deadline ${j.check.deadline ?? '(none stated)'}` : 'failed'}`;
          const back = sendBacks.get(cause) ?? { cause, checks: new Set<string>(), smallest: own };
          back.smallest ??= own;
          back.checks.add(j.check.check);
          sendBacks.set(cause, back);
        }
      }
    }
  }

  const first = judged.map((j) => pointers.get(j.check.check)).find((p) => p);
  const contra = contradictions(claim, judged);
  for (const x of contra) {
    reasons.push(x.late
      ? `${x.check}: the agent's prediction (${x.predicted}) was recorded after ${x.run} started, so it predicts nothing`
      : `${x.check}: the agent predicted ${x.predicted}, and ${x.run} ${x.outcome}`);
  }
  return {
    claim: claim.claim, commit: claim.commit, outcome,
    stale: claim.checks.some((c) => c.state === 'never_started' && c.never_started === 'newer_claim'),
    reasons: unique(reasons),
    checks: judged.map((j) => j.result),
    requirements,
    smallest: first?.smallest ?? null,
    points_to: first?.points_to ?? null,
    open_items: items,
    send_backs: [...sendBacks.values()].map((b): SendBack => ({ cause: b.cause, checks: [...b.checks], smallest: b.smallest })),
    fix_tasks: [...fixTasks.values()].map((t): FixTask => ({ cause: t.cause, checks: [...t.checks], tests: [...t.tests] })),
    asks: unique(asks.map((a) => canonical(a))).map((a) => JSON.parse(a) as VerdictAsk),
    key: key(claim),
    contradictions: contra,
  };
}

function requirementOutcome(
  claim: ClaimInput, q: Requirement, covering: Judged[], pointers: Map<string, Pointer | null>,
  approvals: Map<string, string[]>, items: OpenItem[], reasons: string[],
): RequirementOutcome {
  let asked = false;
  let own: Result;
  let why: string | null = null;
  // The open item's words, when they differ from the reason's: the item leaves out what runs decide.
  let item: string | null = null;
  let closes = '';
  const atDepth = covering.filter((j) => DEPTH[j.check.depth] >= DEPTH[q.depth] && (!q.numbers || j.check.contract !== undefined));
  if (q.oracle === 'person') {
    own = q.answer === undefined ? 'pending' : q.answer === 'unanswered' ? 'INCONCLUSIVE' : q.answer;
    if (own === 'pending') why = `${q.req} waits on your answer to ${q.ask ?? 'its ask'}`;
    else if (own === 'INCONCLUSIVE') why = `${q.req}: ${q.ask ?? 'its ask'} ended unanswered`;
    else if (own === 'FAIL') why = `${q.req}: your answer to ${q.ask ?? 'its ask'} is FAIL`;
    closes = `your answer to ${q.ask ?? 'its ask'}`;
  } else if (atDepth.length === 0) {
    own = 'INVALID';
    const kind = q.numbers ? `check with a numeric contract at depth ${q.depth}` : `check at depth ${q.depth}`;
    why = `${q.req} is covered by no ${kind}: it needs a ${kind}`;
    closes = `a ${kind}`;
  } else if (atDepth.every((j) => j.check.source === 'own')) {
    own = 'INCONCLUSIVE';
    // You're asked to approve only an own check that passed, and only while that approval is what's left.
    const passed = atDepth.find((j) => j.result.outcome === 'PASS');
    const approve = (passed ?? atDepth[0]!).check.check;
    why = `${q.req} is covered at depth ${q.depth} only by the agent's own checks: approve ${approve}`;
    item = `${q.req} is covered at depth ${q.depth} only by the agent's own checks`;
    closes = `your approval of ${approve}, or a check at depth ${q.depth} that isn't the agent's own`;
    if (passed && highest(covering.map((j) => j.result.outcome)) === 'PASS') {
      approvals.set(approve, [...(approvals.get(approve) ?? []), q.req]);
      asked = true;
    }
  } else own = 'PASS';

  const outcome = highest([own, ...covering.map((j) => j.result.outcome)]);
  if (why && own !== 'PASS') {
    reasons.push(why);
    if (own !== 'pending') {
      const scope = { repo: claim.repo, task: claim.task, req: q.req };
      const text = `${q.req} ${own}: ${(item ?? why).slice(q.req.length).replace(/^:?\s*/, '')}`;
      items.push({
        id: openItemId(text, scope), text, scope, check: null,
        closes_with: { evidence: closes, depth: q.depth, environment: null, runs_needed: 0 },
        needs_you: asked,
      });
    }
  }
  const decider = atDepth.find((j) => j.check.source !== 'own') ?? atDepth[0] ?? covering[0];
  const failing = covering.map((j) => pointers.get(j.check.check)).find((p) => p);
  const counted = covering.flatMap((j) => j.runs);
  const outcomeRow: RequirementOutcome = {
    req: q.req, outcome,
    check: covering.map((j) => j.check.check).join(', ') || 'none',
    depth: q.depth, oracle: q.oracle,
    runs: { clean: decider?.result.clean ?? 0, needed: decider?.result.needed ?? 0, counted: sorted(counted.map((r) => r.run)) },
    smallest: failing?.smallest ?? null,
    points_to: failing ? pointsText(failing.points_to) : null,
    evidence: sorted(counted.flatMap((r) => r.evidence).filter((s) => s.state === 'captured' && s.sha256 && HEX64.test(s.sha256)).map((s) => s.sha256!)),
    proof: q.oracle === 'person' ? 'decision' : decider?.check.proof ?? 'statement',
  };
  if (q.oracle === 'person' && q.ask) outcomeRow.ask = q.ask;
  return outcomeRow;
}

function key(claim: ClaimInput): VerdictKey {
  return {
    commit: claim.commit,
    doc_revisions: [],
    check_digests: sorted(claim.checks.map((c) => c.digest)),
    state_digests: sorted((claim.state ?? []).filter((d) => HEX64.test(d))),
    environment: sorted(claim.checks.map((c) => canonical(c.environment))).join(' | ') || 'none',
    tools: sorted(claim.checks.flatMap((c) => Object.entries(c.tools).map(([k, v]) => `${k}@${v}`))),
  };
}

/**
 * Why the verdict is stale on `commit`, or null while it still covers it. On a workspace, `state` is what its state
 * sources read now: a digest that differs from the ones the verdict pinned makes it stale too.
 */
export function staleReason(v: Verdict, commit: string, state?: readonly string[]): string | null {
  if (commit !== v.commit) return `the verdict covers commit ${v.commit}, and the claim is now at ${commit}`;
  if (state === undefined) return null;
  // An entry that isn't a digest was judged once, as INVALID; it is never drift.
  const now = new Set(state.filter((d) => HEX64.test(d))), was = new Set(v.key.state_digests);
  const drifted = sorted([...[...now].filter((d) => !was.has(d)), ...[...was].filter((d) => !now.has(d))]);
  return drifted.length ? `the state the verdict read changed: ${drifted.join(', ')}` : null;
}

/**
 * Each counted run a prediction disagrees with, and each a prediction was recorded only after it started. Only the
 * earliest and latest prediction of each outcome can change what a run shows, so one pass over the predictions and
 * one over the counted runs decide it, whatever the agent's count of predictions. A run with no start, or a start
 * past its end, can't be shown to follow any prediction.
 */
function contradictions(claim: ClaimInput, judged: readonly Judged[]): Contradiction[] {
  return predictionContradictions(claim.predictions ?? [], judged.map((j) => ({ check: j.check.check, runs: j.runs })));
}
/** The same rule over a claim's predictions and each check's counted runs, for a reader without a verdict, as deep_status. */
export function predictionContradictions(
  predictions: readonly Prediction[],
  checks: readonly { check: string; runs: readonly Pick<Run, 'run' | 'outcome' | 'started' | 'ended'>[] }[],
): Contradiction[] {
  const span = new Map<string, { first: number; last: number }>();
  for (const p of predictions) {
    // A prediction with no time can't be placed before or after anything; it hides nothing the others show.
    if (!Number.isFinite(p.at)) continue;
    const key = `${p.check}\0${p.expects}`;
    const at = span.get(key);
    if (!at) span.set(key, { first: p.at, last: p.at });
    else { at.first = Math.min(at.first, p.at); at.last = Math.max(at.last, p.at); }
  }
  const out: Contradiction[] = [];
  for (const j of checks) {
    const expected = (['passed', 'failed'] as const).flatMap((expects) => {
      const at = span.get(`${j.check}\0${expects}`);
      return at ? [{ expects, ...at }] : [];
    });
    if (!expected.length) continue;
    for (const r of j.runs) {
      if (r.outcome !== 'passed' && r.outcome !== 'failed' && r.outcome !== 'overran') continue;
      const began = r.started === undefined ? undefined : Math.min(r.started, r.ended);
      for (const { expects, first, last } of expected) {
        if (began === undefined || last >= began) out.push({ check: j.check, run: r.run, predicted: expects, outcome: r.outcome, late: true });
        if (began !== undefined && first < began && (r.outcome === 'passed') !== (expects === 'passed')) {
          out.push({ check: j.check, run: r.run, predicted: expects, outcome: r.outcome, late: false });
        }
      }
    }
  }
  const order = (x: Contradiction): string => `${x.run}\0${x.predicted}\0${x.late}`;
  return out.sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
}

/** The verdict record's hash, leaving out display fields: reasons, open item words, ask questions and contradictions. */
export function verdictHash(v: Verdict): string {
  return sha256(canonical({
    ...v,
    reasons: undefined,
    contradictions: undefined,
    checks: v.checks.map((c) => ({ ...c, reasons: undefined })),
    open_items: v.open_items.map((i) => ({ ...i, text: undefined })),
    asks: v.asks.map((a) => ({ ...a, question: undefined })),
  }));
}
