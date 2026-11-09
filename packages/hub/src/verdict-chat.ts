// The verdict in the chat and status from the record (#83; design: The verdict in the chat). A claim's line is read
// from the record's claims, verdicts and runs tables, never from the agent's words; a status question typed into a
// session is answered from the same tables and the session's row, with no model call.
import { verdictLine, type LineRequirement, type LineState, type Outcome, type Result } from '@deepbuild/verdicts';
import { elapsed } from './promises.js';

type Obj = Record<string, unknown>;
type Query = (sql: string) => Promise<unknown[]>;
const sql = (s: string) => s.replace(/'/g, "''");

/**
 * The four status questions the issue names, exactly, question mark included: a person's words that ask only for
 * status, with at most a one-word tag in parentheses after. Anything more (a statement, a clause, an instruction in
 * the parentheses) is for the model.
 */
const STATUS = ['still going', 'all done', "what'?s next", 'anything for me']
  .map((phrase) => new RegExp(`^\\s*${phrase.replaceAll(' ', '\\s+')}\\s*\\?\\s*(\\(\\w+\\))?\\s*$`, 'i'));
/** Whether a prompt asks only for status. */
export const isStatusQuestion = (prompt: string): boolean => STATUS.some((re) => re.test(prompt));

/** What the record shows of a claim: its line's state and the checks that ran, each paid one with what it spent. */
export interface ClaimState { task: string; session: string | null; created: number; state: LineState; checks: { check: string; outcome: string; stand_in?: true; spend_usd?: number }[]; verdictAt: number | null }
/** The verdict's own pointer, kept as JSON, as the line shows a requirement's: its frames, `file:line`. */
const framesOf = (points: string | null): string | null => {
  try { const p = JSON.parse(points ?? 'null') as { frames?: unknown } | null; return Array.isArray(p?.frames) && p.frames.length ? p.frames.join(', ') : null; } catch { return null; }
};
/**
 * A claim's state from the record: its newest verdict in force, with its requirements; with no verdict, what its
 * runs show (each check that passed counts once, each with any run counts once); the runs still going, each with
 * the time `expected` gives it.
 */
export async function claimState(query: Query, id: string, expected: ReadonlyMap<string, number>): Promise<ClaimState | undefined> {
  const [claim] = (await query(`SELECT id, session_id, subject_ref, commit_sha, created, round FROM claims WHERE id = '${sql(id)}'`)) as { id: string; session_id: string | null; subject_ref: string; commit_sha: string | null; created: number; round: number | null }[];
  if (!claim) return undefined;
  const [definition] = (await query(`SELECT requirements, base_commit FROM definitions WHERE task_ref = '${sql(claim.subject_ref)}'`)) as { requirements: string | null; base_commit: string | null }[];
  const requirements = JSON.parse(definition?.requirements ?? '[]') as Obj[];
  const fixes = requirements.filter((r) => typeof r.check === 'string' && r.on_base !== 'passes').map((r) => String(r.check));
  // A check proven on a stand-in (#874) says so on the receipt.
  const stoodIn = new Set(requirements.filter((r) => typeof r.check === 'string' && r.stand_in).map((r) => String(r.check)));
  const runs = (await query(`SELECT id, check_id, commit_sha, ended, outcome, tests_run FROM runs WHERE claim_id = '${sql(id)}' ORDER BY started`)) as { id: string; check_id: string; commit_sha: string | null; ended: number | null; outcome: string | null; tests_run: number | null }[];
  const [verdict] = (await query(`SELECT outcome, requirements, smallest, points_to, created FROM verdicts WHERE claim_id = '${sql(id)}' AND stale = 0 ORDER BY created DESC LIMIT 1`)) as { outcome: string; requirements: string; smallest: string | null; points_to: string | null; created: number }[];
  const running = runs.filter((r) => r.ended === null).map((r) => ({ check: r.check_id, about_s: expected.get(`run:${r.id}`) ?? null }));
  // Its checks held for a loop (#965): the newest record of each place, while it neither started nor gave way.
  const places = new Map<string, Obj>();
  for (const row of (await query(`SELECT data FROM events WHERE kind = 'check.held' AND subject = 'claim:${sql(id)}' ORDER BY log_pos`)) as { data: string | Obj }[]) {
    const d = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Obj;
    places.set(`${String(d.check)}\0${String(d.snapshot)}`, d);
  }
  const held = [...places.values()].filter((d) => d.started_at === null && d.replaced_by === null).map((d) => ({ check: String(d.check), reason: String(d.reason) }));
  // A fix check's run on the merge base (#31), its definition's base commit, beside its run on the claim's snapshot, is
  // its proof, not its result: a fix check with none that finished stays unproved. The snapshot of a worktree with
  // changes is another commit than the claim's, and its runs are the claim's own (#325).
  const base = definition?.base_commit ?? null;
  const isBase = (r: { check_id: string; commit_sha: string | null }): boolean => base !== null && r.commit_sha === base && fixes.includes(r.check_id)
    && runs.some((o) => o.check_id === r.check_id && o.commit_sha !== base);
  const onBase = runs.filter((r) => isBase(r) && ['passed', 'failed', 'overran'].includes(r.outcome ?? '')).map((r) => r.check_id);
  const unproved = new Set(fixes.filter((check) => !onBase.includes(check)));
  const own = runs.filter((r) => !isBase(r));
  // What each paid run spent, as the ledger charged it (#325).
  const charged = new Map(((await query(`SELECT json_extract(data, '$.run') AS run, json_extract(data, '$.usd') AS usd FROM events WHERE kind = 'spend.charged' AND json_extract(data, '$.run') IN (${own.map((r) => `'run:${sql(r.id)}'`).join(', ') || "''"})`)) as { run: string; usd: number }[]).map((c) => [c.run, Number(c.usd)]));
  const checks = own.filter((r) => r.ended !== null).map((r) => ({ check: r.check_id, outcome: r.outcome ?? 'unknown', ...(stoodIn.has(r.check_id) ? { stand_in: true as const } : {}), ...(charged.has(`run:${r.id}`) ? { spend_usd: charged.get(`run:${r.id}`)! } : {}) }));
  // The tests the claim's checks ran on its commit (#669): each check's newest ended run, as its report counted them.
  const newest = new Map(own.filter((r) => r.ended !== null).map((r) => [r.check_id, Number(r.tests_run ?? 0)]));
  const tests = [...newest.values()].reduce((a, b) => a + b, 0);
  let state: LineState;
  if (verdict) {
    const reqs = (JSON.parse(verdict.requirements) as Obj[]).map((r): LineRequirement => ({ req: String(r.req), outcome: r.outcome as Result, smallest: typeof r.smallest === 'string' ? r.smallest : null, points_to: typeof r.points_to === 'string' ? r.points_to : null }));
    // A check that covers no requirement, as a review's, fails the claim with the verdict's own cause (#1537).
    const cause = verdict.smallest || verdict.points_to ? { cause: { smallest: verdict.smallest, points_to: framesOf(verdict.points_to) } } : {};
    state = { outcome: verdict.outcome as Outcome, requirements: reqs, round: claim.round ?? 1, running, ...(held.length ? { held } : {}), ...(tests ? { tests } : {}), ...cause };
  } else {
    const seen = new Set(own.map((r) => r.check_id));
    const passed = new Set(checks.filter((c) => c.outcome === 'passed' && !unproved.has(c.check)).map((c) => c.check));
    state = { outcome: null, requirements: [...seen].map((check, i) => ({ req: `req:${claim.id}#R${i + 1}`, outcome: passed.has(check) ? 'PASS' : 'pending', smallest: null, points_to: null })), running, ...(held.length ? { held } : {}), ...(tests ? { tests } : {}) };
  }
  return { task: claim.subject_ref, session: claim.session_id, created: claim.created, state, checks, verdictAt: verdict?.created ?? null };
}

/** The ID of a session's newest claim, or undefined. */
export async function newestClaim(query: Query, session: string): Promise<string | undefined> {
  const [row] = (await query(`SELECT id FROM claims WHERE session_id = '${sql(session)}' ORDER BY created DESC, id DESC LIMIT 1`)) as { id: string }[];
  return row?.id;
}

/**
 * What a status answer reads beside the claim: the session's row and your inbox. `state` is the session's own when
 * no claim stands for its turn: working, waiting, stuck, finished, failed or unknown.
 */
interface StatusFacts { session: string; agent: string; worktree: string; needsYou: number; now: number; lastStop: number | null; state?: string | undefined }
/**
 * The answer to a status question, from the record alone: the state (the claim's line, or the session's own, with
 * the next step on you when it waits, is stuck or has finished with nothing claimed), how long it has been in it, the next step and the Needs-you
 * count; then where the work is, which session holds it, how to resume it and its link.
 */
export function statusAnswer(claim: ClaimState | undefined, f: StatusFacts): string {
  const at = claim ? (claim.verdictAt ?? Math.max(claim.created, f.lastStop ?? 0)) : (f.lastStop ?? f.now);
  const state = f.state ?? 'working';
  const first = claim ? verdictLine(claim.state) : `${state} · next: ${state === 'working' || state === 'unknown' || state === 'failed' ? 'agent' : 'you'}`;
  const resume = f.agent === 'codex' ? `codex resume ${f.session}` : `claude --resume ${f.session}`;
  return [
    `${first} (for ${elapsed(f.now - at)}) · needs you: ${f.needsYou}`,
    `work: ${f.worktree} · session ${f.session.slice(0, 8)} (${f.agent}) · resume: ${resume} · deep://sessions/${f.session}`,
  ].join('\n');
}
