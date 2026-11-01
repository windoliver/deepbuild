// The verdict in the chat and status from the record (#83; design: The verdict in the chat). A claim's line is read
// from the record's claims, verdicts and runs tables, never from the agent's words; a status question typed into a
// session is answered from the same tables and the session's row, with no model call.
import { BASE_RUN } from './gate-runner.js';
import { verdictLine, type LineRequirement, type LineState, type Outcome, type Result } from '@deepbuild/verdicts';

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

/** What the record shows of a claim: its line's state and the checks that ran. */
export interface ClaimState { task: string; session: string | null; created: number; state: LineState; checks: { check: string; outcome: string }[]; verdictAt: number | null }
/**
 * A claim's state from the record: its newest verdict in force, with its requirements; with no verdict, what its
 * runs show (each check that passed counts once, each with any run counts once); the runs still going, each with
 * the time `expected` gives it.
 */
export async function claimState(query: Query, id: string, expected: ReadonlyMap<string, number>): Promise<ClaimState | undefined> {
  const [claim] = (await query(`SELECT id, session_id, subject_ref, created, round FROM claims WHERE id = '${sql(id)}'`)) as { id: string; session_id: string | null; subject_ref: string; created: number; round: number | null }[];
  if (!claim) return undefined;
  const [definition] = (await query(`SELECT requirements FROM definitions WHERE task_ref = '${sql(claim.subject_ref)}'`)) as { requirements: string | null }[];
  const fixes = (JSON.parse(definition?.requirements ?? '[]') as Obj[]).filter((r) => typeof r.check === 'string' && r.on_base !== 'passes').map((r) => String(r.check));
  const runs = (await query(`SELECT id, check_id, ended, outcome FROM runs WHERE claim_id = '${sql(id)}' ORDER BY started`)) as { id: string; check_id: string; ended: number | null; outcome: string | null }[];
  const [verdict] = (await query(`SELECT outcome, requirements, created FROM verdicts WHERE claim_id = '${sql(id)}' AND stale = 0 ORDER BY created DESC LIMIT 1`)) as { outcome: string; requirements: string; created: number }[];
  const running = runs.filter((r) => r.ended === null).map((r) => ({ check: r.check_id, about_s: expected.get(`run:${r.id}`) ?? null }));
  // A check's run on the merge base is its proof, not its result: a fix check with none that finished stays unproved.
  const onBase = runs.filter((r) => r.check_id.endsWith(BASE_RUN) && ['passed', 'failed', 'overran'].includes(r.outcome ?? '')).map((r) => r.check_id.slice(0, -BASE_RUN.length));
  const unproved = new Set(fixes.filter((check) => !onBase.includes(check)));
  const own = runs.filter((r) => !r.check_id.endsWith(BASE_RUN));
  const checks = own.filter((r) => r.ended !== null).map((r) => ({ check: r.check_id, outcome: r.outcome ?? 'unknown' }));
  let state: LineState;
  if (verdict) {
    const reqs = (JSON.parse(verdict.requirements) as Obj[]).map((r): LineRequirement => ({ req: String(r.req), outcome: r.outcome as Result, smallest: typeof r.smallest === 'string' ? r.smallest : null, points_to: typeof r.points_to === 'string' ? r.points_to : null }));
    state = { outcome: verdict.outcome as Outcome, requirements: reqs, round: claim.round ?? 1, running };
  } else {
    const seen = new Set(own.map((r) => r.check_id));
    const passed = new Set(checks.filter((c) => c.outcome === 'passed' && !unproved.has(c.check)).map((c) => c.check));
    state = { outcome: null, requirements: [...seen].map((check, i) => ({ req: `req:${claim.id}#R${i + 1}`, outcome: passed.has(check) ? 'PASS' : 'pending', smallest: null, points_to: null })), running };
  }
  return { task: claim.subject_ref, session: claim.session_id, created: claim.created, state, checks, verdictAt: verdict?.created ?? null };
}

/** The ID of a session's newest claim, or undefined. */
export async function newestClaim(query: Query, session: string): Promise<string | undefined> {
  const [row] = (await query(`SELECT id FROM claims WHERE session_id = '${sql(session)}' ORDER BY created DESC, id DESC LIMIT 1`)) as { id: string }[];
  return row?.id;
}

/** `3m`, `45s`, `2h`, `1d`: how long since `ms`. */
function since(ms: number, now: number): string {
  const d = Math.max(0, now - ms);
  for (const [unit, size] of [['d', 86_400_000], ['h', 3_600_000], ['m', 60_000]] as const) if (d >= size) return `${Math.floor(d / size)}${unit}`;
  return `${Math.floor(d / 1000)}s`;
}

/**
 * What a status answer reads beside the claim: the session's row and your inbox. `state` is the session's own when
 * no claim stands for its turn: working, waiting, stuck, finished, failed or unknown.
 */
export interface StatusFacts { session: string; agent: string; worktree: string; needsYou: number; now: number; lastStop: number | null; state?: string | undefined }
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
    `${first} (for ${since(at, f.now)}) · needs you: ${f.needsYou}`,
    `work: ${f.worktree} · session ${f.session.slice(0, 8)} (${f.agent}) · resume: ${resume} · deep://sessions/${f.session}`,
  ].join('\n');
}
