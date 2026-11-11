// Shared by the #1862 acceptance tests (README): the criteria's IDs, the world they run in (#1537's review world,
// reused through its helpers: #322's repo, spec, drafted check and hub, PR 21's recorded GitHub answers, a made-up
// Claude Code sign-in), `src/cart.ts` at the base commit, this suite's fake reviewer first on the runner's login PATH
// and the wiki's rubric with its two rules, the story both criteria describe (first round, fix commit, second
// round), and reading it back: what each round's second model was given, what reached the session, and what the
// record holds. Nothing here stands in for DeepBuild: the hub, deep-hook, the CLI and git are the real ones; only the
// second model (the fake reviewer) is ours.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COVERED, allEvents, claimsOf, control, decision, git, shown, sleep } from '../322/helpers.ts';
import {
  ASK, CLEAN, FIX, HOUR, REVIEWER_MODEL, addToBase, commandsGreen, judged, lastPos, must, openPr, openTask, reportWindow, reviewWorld, settle, startHub,
  taskVerdicts, told, trustRepo, type Ev, type Hub, type Ran, type ReviewWorld, type Session,
} from '../1537/helpers.ts';

export { cleanup } from '../1537/helpers.ts';
export { must };

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

// ---- The criteria: `#1862.<first 8 hex of SHA-256 of the criterion's text, trimmed, white space collapsed>`.
export const AC1 = 'AC1 #1862.bb91163c';
export const AC2 = 'AC2 #1862.d19b4826';
/** What a setup failure is named by: the story is one, shared by both criteria. */
const WHO = '#1862';

// ---- src/cart.ts, #87's re-review fixture: 45 lines whose base, A and B differ only at lines 10 and 40.
export const CART = 'src/cart.ts';
/** Line 10 as the base and commit B have it, and as commit A breaks it: the loop runs one past the end. */
export const BOUND = '  for (let i = 0; i < items.length; i++) total += items[i].price;';
export const PAST_END = '  for (let i = 0; i <= items.length; i++) total += items[i].price;';
/** Line 40 as the base has it, and as commits A and B have it: the catch drops the error. */
export const CAUGHT = "  } catch (err) { report('cart save failed', err); }";
export const DROPPED = '  } catch {}';
function cart(line10: string, line40: string): string {
  const lines = Array.from({ length: 45 }, (_, i) => `  applyRule(cart, rules[${i}]);`);
  lines[0] = 'export async function checkout(cart: Cart, items: Item[], rules: Rule[], raw: string) {';
  lines[1] = '  let total = 0;';
  lines[9] = line10;
  lines[37] = '  try {';
  lines[38] = '    await save(cart, total);';
  lines[39] = line40;
  lines[43] = '  return total;';
  lines[44] = '}';
  return `${lines.join('\n')}\n`;
}
/** One finding of the first round, as the fake reviewer reports it on commit A and the send-back's item holds it. */
export interface Finding { rule: string; file: string; line: number; quote: string; re: string }
/** Line 10's: fixed by commit B. */
export const LINE_10: Finding = { rule: 'off-by-one', file: CART, line: 10, quote: PAST_END.trim(), re: '<=\\s*[\\w.]+\\.length' };
/** Line 40's: left as it is by commit B. */
export const LINE_40: Finding = { rule: 'swallowed-error', file: CART, line: 40, quote: DROPPED.trim(), re: 'catch\\s*(\\([^)]*\\))?\\s*\\{\\s*\\}' };
export const sayFinding = (f: Finding): string => `${f.rule} at ${f.file}:${f.line}`;

// ---- The world.
/**
 * #1537's review world with `src/cart.ts` in its base commit, this suite's fake reviewer installed as `claude` in
 * `<tmp>/bin` in place of #1537's, and the wiki's rubric holding the two rules the fake reports under.
 */
export function cartWorld(): ReviewWorld {
  const w = addToBase(reviewWorld(), { [CART]: cart(BOUND, CAUGHT) });
  const config = { version: COVERED, model: REVIEWER_MODEL, rules: [LINE_10, LINE_40].map(({ rule, re }) => ({ rule, re })) };
  writeFileSync(join(w.bin, 'claude'), fixture('fake-reviewer.pl').replace('__CONFIG__', Buffer.from(JSON.stringify(config), 'utf8').toString('base64')), { mode: 0o755 });
  writeFileSync(join(w.root, 'wiki', 'review-rubric.md'), fixture('rubric.md'));
  return w;
}

// ---- Reading a text or a record for a finding.
/** Whether a text names a finding's file and line: `src/cart.ts:40`, the file with "line 40", or the two as JSON fields. */
export function names(text: string, f: Finding): boolean {
  return text.includes(`${f.file}:${f.line}`) || (text.includes(f.file) && new RegExp(`\\bline ${f.line}\\b`).test(text))
    || new RegExp(`"file":\\s*"${f.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}",\\s*"line":\\s*${f.line}\\b`).test(text);
}
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const isObj = (v: unknown): v is { [key: string]: Json } => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Every object anywhere inside a value, the value itself included. */
export function objectsIn(value: unknown, out: { [key: string]: Json }[] = []): { [key: string]: Json }[] {
  if (Array.isArray(value)) for (const v of value) objectsIn(v, out);
  else if (isObj(value)) { out.push(value); for (const v of Object.values(value)) objectsIn(v, out); }
  return out;
}
/** Whether a value is #87's SendBackItem for a finding: `{rule, sites: [{file, line, quote}]}`, its rule and one site at the file and line. */
export function isItem(value: unknown, f: Finding): boolean {
  return isObj(value) && value.rule === f.rule && Array.isArray(value.sites) && value.sites.some((s) => isObj(s) && s.file === f.file && s.line === f.line);
}
/** How a sent-back item ended, as the record states it: #87's ItemOutcome. */
export interface Outcome { rule: string; sites: Json[]; ended: 'fixed' | 'left'; commit: string }
/** Every ItemOutcome of a finding's item anywhere in the record's events, in log order: `{rule, sites, ended, commit}`. */
export function outcomesOf(events: readonly Ev[], f: Finding): Outcome[] {
  return events.flatMap((e) => objectsIn(e.data))
    .filter((o) => isItem(o, f) && (o.ended === 'fixed' || o.ended === 'left') && typeof o.commit === 'string') as unknown as Outcome[];
}

// ---- What a round's second model was given, and what the record holds of a round.
/** One call of the fake reviewer, as the runner recorded its job: the prompt it was handed (`given`) and the findings it answered. */
export interface Call { job: string; state: string; given: string; findings: { file?: string; line?: number; rule?: string }[] }
/** Every review job the runner recorded, oldest first, each one call of the fake reviewer (`job.list`, kind `review`). */
export async function reviewCalls(hub: Hub): Promise<Call[]> {
  const r = await control(hub, 'job.list', {});
  const jobs = ((r.jobs ?? []) as { job: string; kind: string; state: string; result?: string }[]).filter((j) => j.kind === 'review');
  return jobs.sort((a, b) => a.job.localeCompare(b.job)).map((j) => {
    let answer: { given?: unknown; findings?: unknown } = {};
    try { answer = JSON.parse(j.result ?? '{}') as typeof answer; } catch { /* a job that didn't finish has no answer */ }
    return { job: j.job, state: j.state, given: typeof answer.given === 'string' ? answer.given : '', findings: Array.isArray(answer.findings) ? answer.findings as Call['findings'] : [] };
  });
}
export const sayCalls = (calls: readonly Call[]): string =>
  calls.map((c) => `${c.job} ${c.state}, answering ${JSON.stringify(c.findings.map((f) => `${String(f.rule)} at ${String(f.file)}:${String(f.line)}`))}`).join('; ') || 'none';
/** Every line the unified diff in a prompt adds, as `file:line` on the new side with its text: what a round was given to review. */
export function addedIn(given: string): { at: string; text: string }[] {
  const out: { at: string; text: string }[] = [];
  let file = '';
  let line = 0;
  let inHunk = false;
  for (const raw of given.split('\n')) {
    if (raw.startsWith('diff --git ')) { inHunk = false; continue; }
    if (!inHunk && raw.startsWith('+++ ')) { file = raw.slice(4).replace(/^b\//, ''); continue; }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) { inHunk = true; line = Number(hunk[1]); continue; }
    if (!inHunk || !(raw.startsWith('+') || raw.startsWith(' '))) continue;
    if (raw.startsWith('+')) out.push({ at: `${file}:${line}`, text: raw.slice(1) });
    line += 1;
  }
  return out;
}
/** The review runs of one claim, each with its finish: the runs whose check is the review (`review`). */
export function reviewRuns(events: readonly Ev[], claim: string): { started: Ev; finished: Ev | undefined }[] {
  return events.filter((e) => e.kind === 'run.started' && e.data.claim === claim && /\breview\b/.test(String(e.data.check)))
    .map((started) => ({ started, finished: events.find((e) => e.kind === 'run.finished' && e.data.run === started.data.run) }));
}
export const sayRuns = (runs: readonly { started: Ev; finished: Ev | undefined }[]): string =>
  runs.map((r) => `${String(r.started.data.run)} on ${String(r.started.data.commit)} ${r.finished ? `${String(r.finished.data.outcome)} ${JSON.stringify(r.finished.data.findings ?? [])}` : 'unfinished'}`).join('; ') || 'none';

// ---- The story both criteria describe, told once through one hub.
export interface Round {
  /** The claim the round's stop made, `claim:<id>`, and the commit it was made on. */
  claim: string; commit: string;
  /** What the round told the session: the stop's reply, and for the first round the next prompt's when its stop was let through. */
  replies: { where: string; ran: Ran }[];
  /** The calls of the fake reviewer the round made. */
  calls: Call[];
}
export interface Story { hub: Hub; first: Round; second: Round }

const said = (replies: Round['replies']): string => replies.map((d) => `${d.where}: ${told(d.ran).slice(0, 700).replace(/\s+/g, ' ')}`).join(' / ');
/** The session's commit of everything it changed: the agent's `git commit`, made in the fixture repo when deep-hook allows it. */
async function commit(s: Session, w: ReviewWorld, message: string): Promise<string> {
  const c = await s.bash(`git commit -qam "${message}"`, () => { git(w.tmp, w.repo, ['commit', '-qam', message]); });
  must(c.allowed, `BLOCKED: ${WHO} the agent's git commit must be allowed: ${shown(c.before)}`);
  must(git(w.tmp, w.repo, ['status', '--porcelain']) === '', `BLOCKED: ${WHO} the worktree must be clean after the commit, so the claim's snapshot is the commit: ${git(w.tmp, w.repo, ['status', '--porcelain'])}`);
  return git(w.tmp, w.repo, ['rev-parse', 'HEAD']);
}
/**
 * The claim a round's stop made for the task after `since`, on `commit`, once it has a verdict of the five (a PASS
 * that stood `standMs`): the record as read then, and the claim's `claim.made`. BLOCKED when no claim was made on it.
 */
async function roundJudged(hub: Hub, ref: string, since: number, commit: string, what: string, standMs: number): Promise<{ events: Ev[]; made: Ev }> {
  const events = await judged(hub, ref, since, { standMs });
  const made = claimsOf(events, ref, since).at(-1);
  must(made !== undefined, `BLOCKED: ${WHO} ${what} must make a claim for ${ref}: none was recorded`);
  must(made.data.commit === commit, `BLOCKED: ${WHO} claim:${made.id}, made at ${what}, must be on commit ${commit}: it names ${String(made.data.commit)}`);
  return { events, made };
}

/**
 * The story: the session fixes the auth middleware (the spec's unit check and R1's drafted check pass), breaks
 * src/cart.ts at lines 10 and 40, commits (A), opens PR 21 and stops; the first review sends both findings back. It
 * then changes line 10 back, commits (B) and stops; the second review runs, and the story ends once the second claim
 * has its verdict. Everything but what the second round does is a precondition: one that doesn't hold is BLOCKED,
 * never a criterion's failure.
 */
async function tell(): Promise<Story> {
  const w = cartWorld();
  await trustRepo(w, true);
  const hub = await startHub(w);
  await reportWindow(hub, 5, Date.now() + 3 * HOUR);
  const { s, ref } = await openTask(hub, w, ASK, WHO);
  await s.read('src/auth.js');
  await s.read(CART);

  // Round 1: commit A, PR 21, the stop.
  const since1 = await lastPos(hub);
  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.edit(CLEAN.file, CLEAN.from, CLEAN.to);
  await s.edit(CART, BOUND, PAST_END);
  await s.edit(CART, CAUGHT, DROPPED);
  const a = await commit(s, w, 'Reject expired tokens and total the cart');
  await openPr(s, WHO);
  const stop1 = await s.stop('Expired tokens are rejected now, the cart totals its items, and the pull request is open for review.');
  const round1 = await roundJudged(hub, ref, since1, a, 'the stop after opening PR 21', 30_000);
  const claim1 = `claim:${round1.made.id}`;
  commandsGreen(round1.events, ref, since1, WHO, claim1, w.base);
  // Where the first send-back reaches the session is the hub's. A stop the reply blocks keeps the turn going; one it
  // lets through ended the turn, and the session's next turn starts with your next prompt.
  const replies1: Round['replies'] = [{ where: 'the first stop\'s reply', ran: stop1 }];
  if (decision(stop1) !== 'deny') replies1.push({ where: 'the next prompt\'s reply', ran: await s.typed('What is left on this change?') });
  const events1 = await allEvents(hub);
  const calls1 = await reviewCalls(hub);
  // Sent back with both findings: the claim's verdict isn't PASS, and what the record holds of the round names each.
  const verdict1 = taskVerdicts(events1, ref, since1).at(-1);
  const unnamed = [LINE_10, LINE_40].filter((f) => !events1.some((e) => e.log_pos > round1.made.log_pos && names(JSON.stringify(e.data), f)));
  must(verdict1 !== undefined && verdict1.data.outcome !== 'PASS' && unnamed.length === 0, `BLOCKED: ${WHO} the first round must send ${claim1} back with both findings, ${sayFinding(LINE_10)} and ${sayFinding(LINE_40)}: `
    + `its verdict is ${String(verdict1?.data.outcome ?? 'not made')}, and the record of the round ${unnamed.length ? `doesn't name ${unnamed.map(sayFinding).join(' nor ')}` : 'names both'}. `
    + `Its review runs: ${sayRuns(reviewRuns(events1, claim1))}. The fake reviewer's calls: ${sayCalls(calls1)}. ${said(replies1)}`);

  // Round 2: commit B changes only line 10, then the stop.
  const since2 = await lastPos(hub);
  await s.edit(CART, PAST_END, BOUND);
  const b = await commit(s, w, 'Stop the cart loop at its last item');
  const changed = git(w.tmp, w.repo, ['diff', '--numstat', a, b]);
  must(changed === `1\t1\t${CART}`, `BLOCKED: ${WHO} commit B must change only line ${LINE_10.line} of ${CART}: git diff --numstat says ${JSON.stringify(changed)}`);
  const stop2 = await s.stop('The cart loop stops at its last item now.');
  const round2 = await roundJudged(hub, ref, since2, b, 'the stop after commit B', 10_000);
  // The second round's calls of the fake reviewer: the review jobs started after the second claim was made (a job is
  // `run:<ULID>` and a claim `claim:<ULID>`, both stamped by the hub's clock), once none is still going.
  const fresh = async (): Promise<Call[]> => (await reviewCalls(hub)).filter((c) => c.job.slice('run:'.length) > round2.made.id);
  let calls2 = await fresh();
  for (let i = 0; i < 80 && calls2.some((c) => c.state !== 'finished'); i++) { await sleep(250); calls2 = await fresh(); }
  return {
    hub,
    first: { claim: claim1, commit: a, replies: replies1, calls: calls1 },
    second: { claim: `claim:${round2.made.id}`, commit: b, replies: [{ where: 'the second stop\'s reply', ran: stop2 }], calls: calls2 },
  };
}
let story: Promise<Story> | undefined;
/** The story, told once however many tests read it. */
export const theStory = (): Promise<Story> => (story ??= tell());

export { allEvents, decision, said as sayReplies, settle, told };
export type { Ev };
