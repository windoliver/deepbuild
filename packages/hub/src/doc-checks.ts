// Document checks on a claim (#1723; design: Document check, Check input): a check the repo's spec or a task's
// definition names as a kind of the canvas core's document check registry (check.kind.doc@1), with its check input and
// the deliverable document by doc ID. The gate runs it through the canvas core's verdict on the document's revision, as
// #403 reads it, and records a run whose outcome is the core's, its issues as the run's output in evidence and the
// revision it checked among its findings. A kind the build lacks is the core's BLOCKED `module_missing`, a missing run,
// never skipped; `deep show --check` reads its result from these runs, so a document with none never reads PASS.
import type { CheckResult, CheckSpec, RunOutcome } from '@deepbuild/conformance';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A document check as a spec or definition names it: the kind, its check input, and the deliverable document. */
export interface DocCheck { kind: string; doc: string; input: Obj }
/** A document check's spec as the gate runs it, with the revision the claim pinned, if the document had one. */
export interface DocSpec extends CheckSpec { runner: 'canvas'; doc: string; input: Obj; rev: number | null; hash: string | null }
/** A document's revision, as doc.patched records it. */
export interface Revision { rev: number; hash: string }

/** The doc IDs the hub mints (deep_show's `doc`). */
const DOC_ID = /^[0-9A-Za-z]{26}$/;
/**
 * A spec entry or a drafted check file's JSON as a document check: no `run` line, `kind` an entry of check.kind.doc@1,
 * `doc` the deliverable's doc ID and `input` the check input's other fields; undefined for anything else.
 */
export function docCheckOf(entry: unknown): DocCheck | undefined {
  if (!isObj(entry) || entry.run !== undefined) return undefined;
  const { kind, doc, input = {} } = entry;
  if (typeof kind !== 'string' || !kind || typeof doc !== 'string' || !DOC_ID.test(doc) || !isObj(input)) return undefined;
  return { kind, doc, input };
}
/** A drafted check file's bytes as a document check: its JSON, as a spec entry's shape. */
export function docCheckIn(bytes: Uint8Array): DocCheck | undefined {
  try { return docCheckOf(JSON.parse(Buffer.from(bytes).toString('utf8'))); } catch { return undefined; }
}
export const docSpec = (d: DocCheck, at: Revision | undefined): DocSpec =>
  ({ kind: d.kind, runner: 'canvas', inputs: [], depth: 'unit', oracle: 'code', contract: null, doc: d.doc, input: d.input, rev: at?.rev ?? null, hash: at?.hash ?? null });
/** The run's command as the record keeps it: the kind on the document's revision, so a run's key changes with the revision. */
export const docCommand = (d: DocCheck, at: Revision | undefined): string => `${d.kind} doc:${d.doc}${at ? `@${at.rev} ${at.hash}` : ' (no revision)'}`;
/** How a run names the revision it checked among its findings, and a verdict's key among its doc_revisions. */
export const revisionLine = (doc: string, at: Revision): string => `doc:${doc}@${at.rev} ${at.hash}`;

/** The canvas core's claim for one document check: its session, the deliverable, and the check as its one requirement. */
export const canvasClaim = (session: string, check: string, spec: DocSpec): Obj =>
  ({ session, deliverables: [spec.doc], requirements: [{ id: check, check: { ...spec.input, kind: spec.kind } }] });

const fail = (test: string, file: string, message: string, assertion = false): CheckResult['failures'][number] =>
  ({ test, file, line: 1, stack: null, assertion, message });
/** What a blocked or refused row names: its code, the kind, its module where the core names one, and the items. */
const why = (b: unknown): string => {
  if (!isObj(b)) return String(b);
  const ids = Array.isArray(b.ids) && b.ids.length ? ` (${b.ids.map(String).join(', ')})` : '';
  const module = typeof b.module === 'string' ? `: ${String(b.kind)} is the ${b.module} module's, which this build lacks` : typeof b.kind === 'string' ? `: ${b.kind}` : '';
  return `${String(b.code ?? 'blocked')}${module}${ids}${typeof b.ask === 'string' ? `; ${b.ask}` : ''}`;
};

/**
 * One run's result from the canvas core's verdict on the claim that holds this check alone: PASS passed, FAIL failed on
 * each error it raised, naming its items, BLOCKED a missing run naming why, INVALID a run that ran nothing, and
 * INCONCLUSIVE uncounted. Its stdout is the verdict's row, its issues the evidence; the revision it read is named.
 */
export function docResult(spec: DocSpec, reply: Obj): CheckResult & { stdout: string } {
  const row = Array.isArray(reply.requirements) && isObj(reply.requirements[0]) ? reply.requirements[0] : {};
  const keyed = isObj(reply.key) && Array.isArray(reply.key.revisions) ? reply.key.revisions.find((r) => isObj(r) && r.doc === spec.doc) : undefined;
  const at = isObj(keyed) && typeof keyed.rev === 'number' && typeof keyed.hash === 'string' ? { rev: keyed.rev, hash: keyed.hash } : undefined;
  const result = String(row.result ?? reply.result ?? 'INVALID');
  const issues = Array.isArray(row.issues) ? row.issues : [];
  const blocked = Array.isArray(row.blocked) ? row.blocked : [];
  const file = `doc:${spec.doc}`;
  const stdout = `${JSON.stringify({ doc: spec.doc, ...(at ?? {}), kind: spec.kind, result, issues, blocked })}\n`;
  const evidence = at ? [revisionLine(spec.doc, at)] : [];
  const base = { testsRun: 1, evidence, read: [], mask: null, stdout };
  switch (result) {
    case 'PASS': return { ...base, outcome: 'passed', failures: [] };
    case 'FAIL': {
      const errors = issues.filter((i) => isObj(i) && i.severity !== 'notice' && i.severity !== 'warning');
      const failures = (errors.length ? errors : issues).map((i) => {
        const o = isObj(i) ? i : {};
        const ids = Array.isArray(o.ids) ? o.ids.map(String).join(', ') : '';
        return fail(`${spec.kind} ${String(o.code ?? 'failed')}`, file, `${ids ? `${ids}: ` : ''}${String(o.what ?? o.message ?? o.code ?? 'failed')}`, true);
      });
      return { ...base, outcome: 'failed', failures: failures.length ? failures : [fail(spec.kind, file, `${spec.kind} failed on doc:${spec.doc}`, true)] };
    }
    case 'BLOCKED': return { ...base, testsRun: 0, outcome: 'missing', failures: (blocked.length ? blocked : [{ code: 'blocked', kind: spec.kind }]).map((b) => fail(spec.kind, file, `BLOCKED: ${why(b)}`)) };
    case 'INCONCLUSIVE': return { ...base, outcome: 'uncounted', failures: [], mask: `${spec.kind} on doc:${spec.doc} is INCONCLUSIVE${Array.isArray(row.pending) ? `: waiting on your approval of ${row.pending.map(String).join(', ')}` : ''}` };
    default: return { ...base, testsRun: 0, outcome: 'ran_nothing', failures: [fail(spec.kind, file, at ? `INVALID: ${blocked.map(why).join('; ') || `${spec.kind} decided nothing`}` : `INVALID: the hub holds no revision of doc:${spec.doc}`)] };
  }
}

/** Run outcomes as the result they give, worst first, as the verdict's precedence reads them. */
const RESULT: Record<RunOutcome, 'FAIL' | 'INVALID' | 'BLOCKED' | 'INCONCLUSIVE' | 'PASS'> = { failed: 'FAIL', overran: 'FAIL', ran_nothing: 'INVALID', missing: 'BLOCKED', stopped: 'INCONCLUSIVE', uncounted: 'INCONCLUSIVE', passed: 'PASS' };
const WORST_FIRST = ['FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE', 'PASS'] as const;
/** The worst of these results; INCONCLUSIVE for none, since nothing unrun passes. */
export function worst(results: readonly string[]): string {
  return WORST_FIRST.find((w) => results.includes(w)) ?? 'INCONCLUSIVE';
}
/** `deep show --check`'s result on a revision from its recorded runs' outcomes: their worst, and never PASS with no run. */
export const shownResult = (outcomes: readonly string[]): string => worst(outcomes.map((o) => RESULT[o as RunOutcome] ?? 'INCONCLUSIVE'));
