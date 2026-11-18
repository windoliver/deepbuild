// AC3's and AC4's assertions as judges: each returns the problems it found, every one naming what its criterion says
// the failure names (the request ID, the job), and an empty list on a sound program. A test runs its scenario on the
// real program and expects none, then runs it on the planted program the criterion names and expects the problem
// (README, Wrong programs).
import { isDeepStrictEqual } from 'node:util';
import type { ActionResult } from '../../../packages/extension-host/src/index.ts';
import type { JobRecord } from '../../../packages/runner/src/index.ts';

/** A value as JSON gives it back, the form a caller over the hub's socket gets it in; one JSON can't hold, as it is. */
const asJson = (v: unknown): unknown => {
  const text = JSON.stringify(v);
  return text === undefined ? v : JSON.parse(text);
};
/** Two values equal as JSON: key order and keys holding undefined aside. */
const same = (a: unknown, b: unknown): boolean => isDeepStrictEqual(asJson(a), asJson(b));

/** What AC3's scenario saw: the first call, `later` calls after it with request IDs of their own, then two retries. */
export interface Retried {
  request: string;
  later: number;
  first: ActionResult;
  /** The same request ID with the same input. */
  retry: ActionResult;
  /** The same request ID with other input. */
  other: ActionResult;
  /** How many times the action's handler ran in this load, by its own count, after both retries. */
  runs: number;
  /** The record's action.entered events for the request ID. */
  entered: number;
}
/** AC3: the retry gets the first call's result and runs nothing again; the retry with other input is refused. */
export function judgeRetry(s: Retried): string[] {
  const p: string[] = [];
  const named = `request ${s.request}`;
  const output = (r: ActionResult) => (r.status === 'done' ? r.output : undefined);
  if (s.retry.status !== 'done' || !same(output(s.retry), output(s.first))) {
    p.push(`${named}: its retry ${s.later} calls later got ${JSON.stringify(s.retry)}, not the first call's result ${JSON.stringify(s.first)}`);
  }
  if (s.entered !== 1) p.push(`${named}: the record holds ${s.entered} action.entered for it, not one, so a retry ran again`);
  if (s.runs !== s.later + 1) p.push(`${named}: the handler ran ${s.runs} times for the first call and the ${s.later} after it, so a retry ran again`);
  if (s.other.status !== 'refused') p.push(`${named}: its retry with other input was answered ${JSON.stringify(s.other)}, not refused`);
  return p;
}

/** A job as the test saw it end: its row and its output read right then, and the result its prompt named. */
export interface Ended { job: string; row: JobRecord; output: string; result: string }
/** What the runner reads of a job later: its row in list(), status() and wait(), and output(); a read that threw, its error. */
export interface Later { listed: JobRecord | undefined; status: JobRecord | { error: string }; waited: JobRecord | { error: string }; output: string | { error: string } }

/** The stand-in's stream-json in an output: its init's session and its result's text (fixtures/claude.pl). */
function streamOf(output: string): { session?: string; result?: string } {
  const out: { session?: string; result?: string } = {};
  for (const line of output.split('\n')) {
    let e: { type?: unknown; subtype?: unknown; session_id?: unknown; result?: unknown };
    try { e = JSON.parse(line) as typeof e; } catch { continue; }
    if (e?.type === 'system' && e.subtype === 'init' && typeof e.session_id === 'string') out.session = e.session_id;
    if (e?.type === 'result' && typeof e.result === 'string') out.result = e.result;
  }
  return out;
}
const shownRow = (v: unknown): string => (JSON.stringify(v) ?? 'nothing').slice(0, 600);

/** Whether an output is the stand-in's stream-json for this job: its init names the job's session, its result the job's. */
const isStreamOf = (output: string, e: Ended): boolean => {
  const stream = streamOf(output);
  return stream.session !== undefined && stream.session === e.row.session && stream.result === e.result;
};

/**
 * AC4: the first job, read as it just ended (the newest, so inside the bound), answered its whole output; once past the
 * bound it reads the row and result it had when it ended in list(), status() and wait(), and output() answers '' for it
 * (the issue's first comment); each job still inside the bound answers its whole output, the stand-in's stream-json
 * ending in its own result.
 */
export function judgeJobs(first: { ended: Ended; later: Later }, inside: { ended: Ended; later: Later }[]): string[] {
  const p: string[] = [];
  const { ended, later } = first;
  const named = `job ${ended.job}`;
  if (!isStreamOf(ended.output, ended)) p.push(`${named} was inside the bound as it ended, and output() answered ${ended.output.length} characters, not its stream-json ending in its result ${JSON.stringify(ended.result)}`);
  for (const [read, row] of [['list()', later.listed], ['status()', later.status], ['wait()', later.waited]] as const) {
    if (!same(row, ended.row)) p.push(`${named}: its row in ${read} reads ${shownRow(row)}, not the row it had when it ended ${shownRow(ended.row)}`);
  }
  if (later.listed?.result !== ended.result) p.push(`${named}: its result reads ${JSON.stringify(later.listed?.result)}, not ${JSON.stringify(ended.result)}`);
  if (later.output !== '') p.push(`${named} ended past the bound, and output() answers ${typeof later.output === 'string' ? `${later.output.length} characters` : JSON.stringify(later.output)}, not '', the answer the issue drafts`);
  for (const { ended: e, later: l } of inside) {
    const of = `job ${e.job}`;
    if (typeof l.output !== 'string') { p.push(`${of} is inside the bound, and output() threw: ${l.output.error}`); continue; }
    if (!isStreamOf(l.output, e)) {
      p.push(`${of} is inside the bound, and output() answers ${l.output.length} characters, not its stream-json ending in its result ${JSON.stringify(e.result)}`);
    } else if (e.output !== '' && l.output !== e.output) {
      p.push(`${of} is inside the bound, and output() answers ${l.output.length} characters, not the ${e.output.length} it printed`);
    }
  }
  return p;
}
