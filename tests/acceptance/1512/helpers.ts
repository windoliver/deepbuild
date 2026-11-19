// Shared by the #1512 acceptance tests (README): the criteria's IDs; the world (#1537's review world, reused through
// its helpers: #322's repo, spec, drafted check and hub, PR 21's recorded GitHub answers, a made-up Claude Code
// sign-in), with the issue's fixture rules in its repo, the guard that enforces one of them (#344's `deep guard add`),
// a rule another agent session proposes with deep_propose and nobody keeps, and this suite's fake reviewer first on
// the runner's login PATH; the story every criterion reads, told once through one real hub; the two short stories
// told through hubs planted with a wrong program; and the readers: each run's request as sent to the second model,
// what a round sent back, a run's output, and the rules page. Nothing here stands in for DeepBuild: the hub, deep-hook,
// the CLI, `deep mcp` and git are the real ones; only the second model (the fake reviewer) is ours.
import { ok } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COVERED, allEvents, claimsOf, control, decision, git, shown, sleep, verdictsOf } from '../322/helpers.ts';
import {
  ASK, CLEAN, FIX, HOUR, REVIEWER_MODEL, addToBase, cleanup as cleanup1537, commandsGreen, judged, lastPos, must, openPr, openTask, reportWindow, reviewWorld,
  startHub, trustRepo, type Ev, type Hub, type Ran, type ReviewWorld, type Session,
} from '../1537/helpers.ts';
import { reviewCalls, type Call } from '../1862/helpers.ts';
import { addGuard, cleanupAll as cleanup344, goodGuard, show, syncRules, type PageRule } from '../344/helpers.ts';
import { Agent, callTool, initialize, type Hub as AgentHub } from '../26/helpers.ts';

export { failureOf, must } from '../1537/helpers.ts';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

// ---- The criteria: `#1512.<first 8 hex of SHA-256 of the criterion's text, trimmed, white space collapsed>`.
export const AC1 = 'AC1 #1512.2a53228d';
export const AC2 = 'AC2 #1512.08d20c73';
export const AC3 = 'AC3 #1512.eb715105';
export const AC4 = 'AC4 #1512.efb173ff';
export const AC5 = 'AC5 #1512.53c08786';
export const AC6 = 'AC6 #1512.30209e04';
export const AC7 = 'AC7 #1512.0ff8d322';
export const AC8 = 'AC8 #1512.fd4a9a15';
/** What a setup failure is named by: the story is one, shared by every criterion. */
const WHO = '#1512';

/** A criterion's assertion: node:assert's, so a failure is the framework's own assertion failure. */
export function holds(value: boolean, message: string): asserts value {
  ok(value, message);
}

// ---- The planted wrong programs (README, Wrong programs), selected with DEEP_HUB_PLANT.
/** AC2's (and AC4's and AC5's): the rubric holds every rule the hub knows, whatever its scope, whoever wrote it and whatever enforces it, with no size bound. */
export const EVERY_RULE = 'rubric-holds-every-rule';
/** AC8's: the hub holds the review kind, but no caller starts a review run for a claim that opens a pull request. */
export const NO_CALLER = 'review-without-caller';

// ---- The fixture repo's rules (README, The fixture repo).
/** The issue's text-only rule, scoped to `src/**` by the `applyTo` of a `.github/instructions` file. */
export const RULE = 'no default exports';
export const RULE_FILE = '.github/instructions/exports.instructions.md';
export const RULE_SCOPE = 'src/**';
/** A rule with a working guard: the root AGENTS.md's, enforced by the guard below (#344's goodGuard). */
export const GUARDED = 'never force-push';
export const GUARD = 'no-force-push';
/** The rule an agent proposes with deep_propose and you never keep: no path in it, so it would cover every diff. */
export const PROPOSED = 'Keep every exported function under forty lines';
/** The 60 text-only rules of docs/AGENTS.md, scoped to `docs/**`, together larger than the drafted size. */
export const DOCS_RULES = Array.from({ length: 60 }, (_, i) => `Docs section ${i + 1} uses plain short sentences, captions every code sample, links each new term to the glossary, keeps each table under twelve rows, names the owner of every page and dates each change note`);
/** The drafted size of the rubric's added lines, in tokens (issue Scope), counted with the rules page's own sizes (README). */
export const DRAFTED_SIZE = 1500;
/** A line that breaks the rule, as the fake reviewer reads it. */
const BREAKS = 'export\\s+default\\b';

// ---- The code the session writes.
export const A_FILE = 'src/a.ts';
export const B_FILE = 'src/b.ts';
export const DOCS_FILE = 'docs/a.md';
/** src/a.ts with a default export at line 1; the clean twin has a named export there. */
export const A_DEFAULT = 'export default function total(items: { price: number }[]): number {\n  return items.reduce((sum, item) => sum + item.price, 0);\n}\n';
export const A_NAMED = A_DEFAULT.replace('export default function', 'export function');
export const B_DEFAULT = 'export default function count(items: unknown[]): number {\n  return items.length;\n}\n';
const DOCS = '# The cart\n\nThe cart totals the prices of its items.\n';
const DOCS_MORE = '\nTotals are kept in cents.\n';

// ---- The world.
/**
 * #1537's review world, its base commit also holding the issue's fixture rules: the root AGENTS.md with the guarded
 * rule, a .github/instructions file whose applyTo scopes "no default exports" to src/**, docs/AGENTS.md with the 60
 * rules for docs/**, and docs/a.md; and this suite's fake reviewer installed as `claude` in `<tmp>/bin`, knowing no
 * rule yet.
 */
export function rulesWorld(): ReviewWorld {
  const w = addToBase(reviewWorld(), {
    'AGENTS.md': `# Rules\n\n- ${GUARDED}\n`,
    [RULE_FILE]: `---\napplyTo: "${RULE_SCOPE}"\n---\n\n- ${RULE}\n`,
    'docs/AGENTS.md': `# Docs\n\n${DOCS_RULES.map((r) => `- ${r}\n`).join('')}`,
    [DOCS_FILE]: DOCS,
  });
  installReviewer(w, []);
  return w;
}
/** The fake reviewer, with the rules it reviews by: each one's text, its ID on the rules page, and a pattern for a line that breaks it. */
export function installReviewer(w: ReviewWorld, rules: { id: string; text: string; re: string }[]): void {
  const config = { version: COVERED, model: REVIEWER_MODEL, rules };
  writeFileSync(join(w.bin, 'claude'), fixture('fake-reviewer.pl').replace('__CONFIG__', Buffer.from(JSON.stringify(config), 'utf8').toString('base64')), { mode: 0o755 });
}
export async function cleanup(): Promise<void> {
  await cleanup1537();
  await cleanup344();
}

// ---- The rules page (#344's surface), read with #344's helpers.
export interface Rules { all: PageRule[]; rule: PageRule; guarded: PageRule; docs: PageRule[] }
const sameText = (a: string, b: string): boolean => a.replace(/\s+/g, ' ').trim().replace(/\.$/, '').toLowerCase() === b.replace(/\s+/g, ' ').trim().replace(/\.$/, '').toLowerCase();
export const onPage = (page: readonly PageRule[], text: string): PageRule | undefined => page.find((r) => sameText(r.text, text));
/** `deep rules sync`, then the page, held to what the fixture states (each a precondition: BLOCKED when it doesn't hold). */
export async function syncedRules(w: ReviewWorld, who: string): Promise<Rules> {
  const all = await syncRules(w);
  const rule = onPage(all, RULE);
  must(rule !== undefined && rule.scope === RULE_SCOPE && rule.enforcer.kind !== 'guard', `BLOCKED: ${who} the rules page must list "${RULE}" from ${RULE_FILE}, scoped ${RULE_SCOPE}, with no guard: it lists\n  ${show(all)}`);
  const guarded = onPage(all, GUARDED);
  must(guarded?.enforcer.kind === 'guard' && guarded.enforcer.name === GUARD, `BLOCKED: ${who} the rules page must name the guard ${GUARD} as the enforcer of "${GUARDED}" (its planted call denied, its twin allowed): it lists\n  ${show(all)}`);
  const docs = DOCS_RULES.map((t) => onPage(all, t)).filter((r): r is PageRule => r !== undefined && r.scope === 'docs/**' && r.enforcer.kind !== 'guard');
  must(docs.length === DOCS_RULES.length, `BLOCKED: ${who} the rules page must list docs/AGENTS.md's ${DOCS_RULES.length} text-only rules, scoped docs/**: it lists ${docs.length} of them`);
  const size = docs.reduce((n, r) => n + r.tokens, 0);
  must(docs.every((r) => Number.isInteger(r.tokens) && r.tokens > 0) && size > DRAFTED_SIZE, `BLOCKED: ${who} the 60 rules for docs/** must be larger together than the drafted size, ${DRAFTED_SIZE} tokens, by the rules page's own sizes: they are ${size}`);
  return { all, rule, guarded, docs };
}
export const sayRule = (r: PageRule): string => `"${r.text}" (${r.handle}, ${r.file}, scoped ${r.scope})`;

// ---- What a review run was given: the request as sent to the second model, the fake reviewer's `given`.
/** The request before its diff: the instructions and the rubric. */
export const headOf = (given: string): string => given.split(/\n(?=diff --git )/)[0]!;
/** The files the request's diff touches, by their new name. */
export const diffFiles = (given: string): string[] => [...new Set([...given.matchAll(/^diff --git a\/\S+ b\/(\S+)$/gm)].map((m) => m[1]!))];
const flat = (text: string): string => text.replace(/\s+/g, ' ').toLowerCase();
/** Whether a request gives the second model a rule: the rule's text, before the diff (README, The request). */
export const gives = (call: Call, rule: { text: string }): boolean => flat(headOf(call.given)).includes(flat(rule.text));
/** Whether a request names a rule at all, before the diff: its text, or its ID on the rules page. */
export const mentions = (call: Call, rule: PageRule): boolean => gives(call, rule) || headOf(call.given).includes(rule.id);
/** The lines of a request's head that hold a text, for failure messages. */
export const linesWith = (call: Call, text: string): string => headOf(call.given).split('\n').filter((l) => l.toLowerCase().includes(text.toLowerCase())).join(' | ').slice(0, 600) || '(no line)';
export const sayCalls = (calls: readonly Call[]): string =>
  calls.map((c) => `${c.job} ${c.state}, its diff touching ${JSON.stringify(diffFiles(c.given))}, answering ${JSON.stringify(c.findings.map((f) => `${String(f.rule)} at ${String(f.file)}:${String(f.line)}`))}`).join('; ') || 'none';

// ---- What the record holds of a round.
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export interface Item { rule: string; sites: { file: string; line: number; quote: string }[] }
/** What a claim's review rounds sent back (#1862's review.read@1: `sent`, #87's SendBackItem), in log order. */
export function sentBy(events: readonly Ev[], claim: string): Item[] {
  return events.filter((e) => e.kind === 'review.read' && e.data.claim === claim)
    .flatMap((e) => (Array.isArray(e.data.sent) ? e.data.sent : []) as unknown[])
    .filter((i): i is Item => isObj(i) && typeof i.rule === 'string' && Array.isArray(i.sites));
}
/** Whether a sent-back item names a rule: its rule names the rule's ID on the rules page. */
export const naming = (item: Item, rule: PageRule): boolean => item.rule.includes(rule.id);
export const sayItems = (items: readonly Item[]): string => JSON.stringify(items).slice(0, 900);
/** The review runs of a claim (run.started whose check is the review), each with its finish. */
export function reviewRuns(events: readonly Ev[], claim: string): { started: Ev; finished: Ev | undefined }[] {
  return events.filter((e) => e.kind === 'run.started' && e.data.claim === claim && /\breview\b/.test(String(e.data.check)))
    .map((started) => ({ started, finished: events.find((e) => e.kind === 'run.finished' && e.data.run === started.data.run) }));
}
export const sayRuns = (runs: readonly { started: Ev; finished: Ev | undefined }[]): string =>
  runs.map((r) => `${String(r.started.data.run)} (${String(r.started.data.check)}) on ${String(r.started.data.commit)} ${r.finished ? `${String(r.finished.data.outcome)} ${JSON.stringify(r.finished.data.findings ?? []).slice(0, 400)}` : 'unfinished'}`).join('; ') || 'none';
export const lastVerdict = (events: readonly Ev[], claim: string): Ev | undefined => verdictsOf(events, claim).at(-1);
export const sayVerdict = (v: Ev | undefined): string => (v ? `${String(v.data.outcome)} ${JSON.stringify(v.data.reasons ?? []).slice(0, 500)}` : 'no verdict');
/**
 * A run's output (README, The run's output): what the record holds of it (its run.finished, and any event whose
 * subject is the run) and the output it printed, as `deep run follow` reads it (`run.output`).
 */
export async function outputOf(hub: Hub, events: readonly Ev[], run: string): Promise<string> {
  const recorded = events.filter((e) => e.subject === run || (e.kind === 'run.finished' && e.data.run === run)).map((e) => JSON.stringify(e.data)).join('\n');
  let printed = '';
  try {
    const r = await control(hub, 'run.output', { run, from: 0 });
    printed = Buffer.from(String(r.text ?? ''), 'base64').toString('utf8');
  } catch (error) {
    printed = `(run.output refused: ${error instanceof Error ? error.message : String(error)})`;
  }
  return `${recorded}\n${printed}`;
}

// ---- One round: the session's change, its commit, its stop, and the claim's review as the hub ran it.
export interface Round {
  /** Which round of the story, and the log position it started after. */
  name: string; since: number;
  /** The claim the round's stop made, `claim:<id>`, and the commit it was made on. */
  claim: string; commit: string;
  /** The stop's reply, as deep-hook printed it. */
  stop: Ran;
  /** The calls of the fake reviewer in the round: each review run's request as sent to the second model. */
  calls: Call[];
}
// ---- Where a story got to, each step with its time: the evidence a BLOCKED story names.
const steps: string[] = [];
const began = Date.now();
const step = (what: string): void => { steps.push(`${((Date.now() - began) / 1000).toFixed(0)}s ${what}`); };
export const progress = (n = 14): string => `Steps so far: ${steps.slice(-n).join('; ')}`;
const ENDED = new Set(['finished', 'stopped', 'refused', 'lost']);
/** The runner's jobs that haven't ended, of one kind or any, each with what holds it. */
async function jobsGoing(hub: Hub, kind?: string): Promise<string[]> {
  const r = await control(hub, 'job.list', {});
  return ((r.jobs ?? []) as { job: string; kind: string; state: string; blocked?: unknown }[]).filter((j) => !ENDED.has(j.state) && (kind === undefined || j.kind === kind))
    .map((j) => `${j.job} ${j.kind} ${j.state}${j.blocked ? ` ${JSON.stringify(j.blocked)}` : ''}`);
}
/** A claim's runs not finished, and the jobs going, for a BLOCKED message. */
async function pending(hub: Hub, claim: string): Promise<string> {
  const events = await allEvents(hub);
  const open = events.filter((e) => e.kind === 'run.started' && e.data.claim === claim && !events.some((f) => f.kind === 'run.finished' && f.data.run === e.data.run));
  return `its runs not finished: ${open.map((e) => `${String(e.data.run)} (${String(e.data.check)}, ${String(e.data.lane)} lane)`).join(', ') || 'none'}; jobs going: ${(await jobsGoing(hub)).join(', ') || 'none'}. ${progress()}`;
}
/**
 * Reads the record until every run of the claim has finished and no review job is going, for `holdMs` together;
 * BLOCKED when that doesn't come within `capMs`.
 */
async function quiet(hub: Hub, claim: string, who: string, holdMs = 6000, capMs = 180_000): Promise<void> {
  const deadline = Date.now() + capMs;
  let seen = '';
  let since = Date.now();
  for (;;) {
    const events = await allEvents(hub);
    const runs = events.filter((e) => e.kind === 'run.started' && e.data.claim === claim);
    const open = runs.filter((r) => !events.some((e) => e.kind === 'run.finished' && e.data.run === r.data.run));
    const going = await jobsGoing(hub, 'review');
    const now = `${runs.length}/${open.length}/${going.length}`;
    if (now !== seen) { seen = now; since = Date.now(); }
    if (!open.length && !going.length && Date.now() - since >= holdMs) return;
    must(Date.now() < deadline, `BLOCKED: ${who} every run of ${claim} and every review job must end within ${capMs / 60_000} minutes of its verdict: ${await pending(hub, claim)}`);
    await sleep(500);
  }
}
/** The session's commit of what it changed: the agent's `git commit`, made in the fixture repo when deep-hook allows it. */
async function commit(s: Session, w: ReviewWorld, added: readonly string[], message: string, who: string): Promise<string> {
  const c = await s.bash(`${added.length ? `git add ${added.join(' ')} && ` : ''}git commit -qam "${message}"`, () => {
    if (added.length) git(w.tmp, w.repo, ['add', ...added]);
    git(w.tmp, w.repo, ['commit', '-qam', message]);
  });
  must(c.allowed, `BLOCKED: ${who} the agent's git commit must be allowed: ${shown(c.before)}`);
  must(git(w.tmp, w.repo, ['status', '--porcelain']) === '', `BLOCKED: ${who} the worktree must be clean after the commit, so the claim's snapshot is the commit: ${git(w.tmp, w.repo, ['status', '--porcelain'])}`);
  return git(w.tmp, w.repo, ['rev-parse', 'HEAD']);
}
/**
 * One round: the session's change, its commit (and PR 21 on the first), its stop; then the claim the stop made, once it
 * has its verdict and every run of it has ended. BLOCKED when the stop makes no claim on the commit. A stop the reply
 * lets through ended the turn, so the session's next turn starts with your next prompt, which opens no task.
 */
async function round(o: { hub: Hub; w: ReviewWorld; s: Session; ref: string; name: string; change: () => Promise<string[]>; message: string; words: string; pr: boolean; who: string; next: boolean }): Promise<Round> {
  const since = await lastPos(o.hub);
  step(`${o.who} ${o.name} round: the change`);
  const added = await o.change();
  const at = await commit(o.s, o.w, added, o.message, o.who);
  if (o.pr) await openPr(o.s, o.who);
  step(`${o.who} ${o.name} round: commit ${at.slice(0, 8)}, the stop`);
  const stop = await o.s.stop(o.words);
  step(`${o.who} ${o.name} round: the stop's reply ${decision(stop)}`);
  const events = await judged(o.hub, o.ref, since, { standMs: 10_000, timeoutMs: 420_000 });
  const made = claimsOf(events, o.ref, since).at(-1);
  must(made !== undefined, `BLOCKED: ${o.who} the stop of the ${o.name} round must make a claim for ${o.ref}: none was recorded. ${progress()}`);
  must(made.data.commit === at, `BLOCKED: ${o.who} claim:${made.id}, made at the stop of the ${o.name} round, must be on commit ${at}: it names ${String(made.data.commit)}`);
  const claim = `claim:${made.id}`;
  must(verdictsOf(events, claim).length > 0, `BLOCKED: ${o.who} ${claim}, made at the stop of the ${o.name} round, must have a verdict within 7 minutes: ${await pending(o.hub, claim)}`);
  step(`${o.who} ${o.name} round: ${claim} judged ${String(verdictsOf(events, claim).at(-1)!.data.outcome)}`);
  await quiet(o.hub, claim, o.who);
  // The round's calls of the fake reviewer: the review jobs started after its claim was made (a job is `run:<ULID>`
  // and a claim `claim:<ULID>`, both stamped by the hub's clock); the next round starts once these have ended.
  const calls = (await reviewCalls(o.hub)).filter((c) => c.job.slice('run:'.length) > made.id);
  step(`${o.who} ${o.name} round: ${calls.length} review job(s)`);
  if (o.next && decision(stop) !== 'deny') await o.s.typed('What is left on this change?');
  return { name: o.name, since, claim, commit: at, stop, calls };
}
const write = (s: Session, file: string, content: string, who: string) => async (): Promise<void> => {
  const r = await s.writeCall(file, content);
  must(r.allowed, `BLOCKED: ${who} the agent's Write of ${file} must be allowed: ${shown(r.before)}`);
};

// ---- The rule an agent proposes: another session in the repo calls deep_propose through its own deep mcp.
export interface Proposal { proposal: string; ask: string; session: string }
const QUESTION = 'What does src/auth.js export?';
async function propose(hub: Hub, w: ReviewWorld, who: string): Promise<Proposal> {
  const agent = Agent.start(w.home, w.repo);
  const session = agent.session(w.repo, QUESTION);
  const at = hub as unknown as AgentHub;
  await agent.hook(at, session, 'SessionStart');
  await agent.hook(at, session, 'UserPromptSubmit', { prompt: QUESTION });
  await agent.hook(at, session, 'PreToolUse');
  await initialize(agent);
  const r = await callTool(agent, 'deep_propose', { target: 'wiki:rules', change: `Add the rule "${PROPOSED}" for every file of the repo.`, evidence: null });
  must(!r.isError && typeof r.value?.proposal === 'string', `BLOCKED: ${who} an agent's deep_propose of the rule "${PROPOSED}" must be recorded: ${JSON.stringify(r.reply).slice(0, 900)}`);
  await agent.end(at, session);
  return { proposal: String(r.value.proposal), ask: String(r.value.ask), session: session.id };
}
/** Holds the proposal as never kept: a learn.proposed naming the rule, applied by no one, its ask unanswered and nothing applied since. */
function neverKept(events: readonly Ev[], p: Proposal, who: string): void {
  const proposed = events.filter((e) => e.kind === 'learn.proposed' && JSON.stringify(e.data).includes(PROPOSED));
  must(proposed.length > 0 && proposed.every((e) => e.data.applied_by === null), `BLOCKED: ${who} the record must hold the agent's proposal of "${PROPOSED}" as a learn.proposed applied by no one: ${JSON.stringify(proposed.map((e) => e.data)).slice(0, 600)}`);
  const kept = events.filter((e) => (e.kind === 'learn.applied' || e.kind === 'ask.answered' || e.kind === 'decision.created') && (JSON.stringify(e.data).includes(PROPOSED) || e.subject === p.ask));
  must(kept.length === 0, `BLOCKED: ${who} nobody keeps the proposal of "${PROPOSED}": the record holds ${JSON.stringify(kept.map((e) => ({ kind: e.kind, data: e.data }))).slice(0, 600)}`);
}

// ---- The story every criterion reads, told once through one real hub.
export interface Story {
  w: ReviewWorld; hub: Hub; ref: string; proposal: Proposal;
  /** The rules page as `deep rules sync` wrote it before the first review, and again after the last. */
  before: Rules; after: PageRule[];
  /** Commit A: src/a.ts with a default export, and PR 21. B: src/b.ts with a default export. C: src/a.ts's export made a named one, the clean twin. D: docs/a.md alone. */
  first: Round; second: Round; twin: Round; docs: Round;
  /** Every call of the fake reviewer in the story. */
  calls: Call[];
}
/**
 * The story (README, The story): the hub, the guard, another session's proposal, your session's task; the rules
 * page synced; then four rounds on PR 21, each a commit and a stop, and the rules page synced again. Everything but
 * what the hub does with the rules is a precondition: one that doesn't hold is BLOCKED, never a criterion's failure.
 */
async function tell(): Promise<Story> {
  const w = rulesWorld();
  await trustRepo(w, true);
  step(`${WHO} the hub`);
  const hub = await startHub(w);
  await reportWindow(hub, 5, Date.now() + 3 * HOUR);
  const guard = await addGuard(w, goodGuard(GUARD, GUARDED, 'git push --force'));
  must(guard.code === 0, `BLOCKED: ${WHO} the guard ${GUARD}, which enforces "${GUARDED}", must install: ${shown(guard)}`);
  step(`${WHO} the proposal`);
  const proposal = await propose(hub, w, WHO);
  step(`${WHO} the task`);
  const { s, ref } = await openTask(hub, w, ASK, WHO);
  const before = await syncedRules(w, WHO);
  installReviewer(w, [{ id: before.rule.id, text: RULE, re: BREAKS }]);
  const go = { hub, w, s, ref, who: WHO, next: true };

  await s.read('src/auth.js');
  const first = await round({ ...go, name: 'first', pr: true, message: 'Reject expired tokens and total the cart', words: 'Expired tokens are rejected now, the cart has its total, and the pull request is open for review.', change: async () => {
    await s.edit(FIX.file, FIX.from, FIX.to);
    await s.edit(CLEAN.file, CLEAN.from, CLEAN.to);
    await write(s, A_FILE, A_DEFAULT, WHO)();
    return [A_FILE];
  } });
  commandsGreen(await allEvents(hub), ref, 0, WHO, first.claim, w.base);
  const second = await round({ ...go, name: 'second', pr: false, message: 'Count the cart items', words: 'The cart counts its items too.', change: async () => {
    await write(s, B_FILE, B_DEFAULT, WHO)();
    return [B_FILE];
  } });
  const twin = await round({ ...go, name: 'clean twin', pr: false, message: 'Name the cart total export', words: 'The cart total is a named export now.', change: async () => {
    await s.edit(A_FILE, A_DEFAULT, A_NAMED);
    return [];
  } });
  const docs = await round({ ...go, name: 'docs', pr: false, next: false, message: 'Say how totals are kept', words: 'The docs say how totals are kept.', change: async () => {
    await s.read(DOCS_FILE);
    await s.edit(DOCS_FILE, DOCS, DOCS + DOCS_MORE);
    return [];
  } });
  const after = await syncRules(w);
  const events = await allEvents(hub);
  neverKept(events, proposal, WHO);
  return { w, hub, ref, proposal, before, after, first, second, twin, docs, calls: await reviewCalls(hub) };
}
let story: Promise<Story> | undefined;
/** The story, told once however many tests read it. */
export const theStory = (): Promise<Story> => (story ??= tell());

// ---- The planted stories: one round each, through a hub planted with a wrong program.
export interface Planted { w: ReviewWorld; hub: Hub; round: Round; rules: Rules | undefined; proposal: Proposal | undefined }
/**
 * A hub planted with `plant`: for EVERY_RULE, the story's setup and one round whose commit changes docs/a.md alone
 * (opening PR 21); for NO_CALLER, the story's first round. BLOCKED when the hub doesn't start with the plant.
 */
async function tellPlanted(plant: string): Promise<Planted> {
  const who = `${WHO} (DEEP_HUB_PLANT=${plant})`;
  const w = rulesWorld();
  await trustRepo(w, true);
  step(`${who} the hub`);
  const hub = await startHub(w, { plant });
  await reportWindow(hub, 5, Date.now() + 3 * HOUR);
  if (plant === NO_CALLER) {
    const { s, ref } = await openTask(hub, w, ASK, who);
    await s.read('src/auth.js');
    const first = await round({ hub, w, s, ref, who, next: false, name: 'first', pr: true, message: 'Reject expired tokens and total the cart', words: 'Expired tokens are rejected now, the cart has its total, and the pull request is open for review.', change: async () => {
      await s.edit(FIX.file, FIX.from, FIX.to);
      await s.edit(CLEAN.file, CLEAN.from, CLEAN.to);
      await write(s, A_FILE, A_DEFAULT, who)();
      return [A_FILE];
    } });
    return { w, hub, round: first, rules: undefined, proposal: undefined };
  }
  const guard = await addGuard(w, goodGuard(GUARD, GUARDED, 'git push --force'));
  must(guard.code === 0, `BLOCKED: ${who} the guard ${GUARD}, which enforces "${GUARDED}", must install: ${shown(guard)}`);
  step(`${who} the proposal`);
  const proposal = await propose(hub, w, who);
  step(`${who} the task`);
  const { s, ref } = await openTask(hub, w, ASK, who);
  const rules = await syncedRules(w, who);
  installReviewer(w, [{ id: rules.rule.id, text: RULE, re: BREAKS }]);
  const docs = await round({ hub, w, s, ref, who, next: false, name: 'docs', pr: true, message: 'Say how totals are kept', words: 'The docs say how totals are kept.', change: async () => {
    await s.read(DOCS_FILE);
    await s.edit(DOCS_FILE, DOCS, DOCS + DOCS_MORE);
    return [];
  } });
  neverKept(await allEvents(hub), proposal, who);
  return { w, hub, round: docs, rules, proposal };
}
const planted = new Map<string, Promise<Planted>>();
/** A planted story, told once however many tests read it. */
export const thePlanted = (plant: string): Promise<Planted> => {
  let p = planted.get(plant);
  if (!p) planted.set(plant, (p = tellPlanted(plant)));
  return p;
};

// ---- The criteria's readings, each one function, so a test reads the story with it and the planted story too.
/** AC2: a rule for src/** isn't in the rubric of a run whose diff touches only docs/a.md, where the rules for docs/** are. */
export function outOfScope(r: Round, rules: Rules, who = AC2): void {
  holds(r.calls.length > 0, `${who} ${r.claim}, whose diff touches only ${DOCS_FILE}, gets a review run whose request can be read: the fake reviewer was never called in that round`);
  for (const c of r.calls) must(diffFiles(c.given).join(',') === DOCS_FILE, `BLOCKED: ${who} the ${r.name} round's review must be given a diff touching only ${DOCS_FILE}: ${c.job}'s diff touches ${JSON.stringify(diffFiles(c.given))}`);
  const given = r.calls.filter((c) => mentions(c, rules.rule));
  const shownAt = given.length ? `${linesWith(given[0]!, rules.rule.id)} | ${linesWith(given[0]!, RULE)}` : '';
  holds(given.length === 0, `${who} ${sayRule(rules.rule)} is not in the rubric of a run whose diff touches only ${DOCS_FILE}: the request ${given.map((c) => c.job).join(', ')} sent to the second model holds it (${shownAt})`);
  const bare = r.calls.filter((c) => !rules.docs.some((d) => gives(c, d)));
  holds(bare.length === 0, `${who} the rubric of ${r.claim}'s review gains the text-only rules whose scope covers ${DOCS_FILE} (docs/AGENTS.md's, scoped docs/**): the request ${bare.map((c) => c.job).join(', ')} holds none of the ${rules.docs.length}`);
}
/** AC4: the rule an agent proposed and you never kept is in no request, while the rules you wrote that cover the diff are. */
export function proposedOut(calls: readonly Call[], control: { calls: readonly Call[]; rules: readonly PageRule[]; what: string }, p: Proposal, who = AC4): void {
  const given = calls.filter((c) => gives(c, { text: PROPOSED }));
  holds(given.length === 0, `${who} "${PROPOSED}", a rule an agent proposed with deep_propose (${p.proposal}, ask ${p.ask}) and you never kept, is not in the rubric: the request ${given.map((c) => c.job).join(', ')} sent to the second model holds it (${given.length ? linesWith(given[0]!, 'forty lines') : ''})`);
  const bare = control.calls.filter((c) => !control.rules.some((r) => gives(c, r)));
  holds(control.calls.length > 0 && bare.length === 0, `${who} the rubric holds the rules you wrote that cover the diff (${control.what}): ${control.calls.length ? `the request ${bare.map((c) => c.job).join(', ')} holds none of them` : 'no review run was given a request'}`);
}
/** AC5, its request half: the rule with a working guard is in no request, while the rules you wrote that cover the diff are. */
export function guardedOut(calls: readonly Call[], control: { calls: readonly Call[]; rules: readonly PageRule[]; what: string }, guarded: PageRule, who = AC5): void {
  const given = calls.filter((c) => mentions(c, guarded));
  holds(given.length === 0, `${who} ${sayRule(guarded)}, enforced by the guard ${GUARD} (its planted call denied, its twin allowed), stays out of the rubric: the request ${given.map((c) => c.job).join(', ')} sent to the second model holds it (${given.length ? linesWith(given[0]!, GUARDED) : ''})`);
  const bare = control.calls.filter((c) => !control.rules.some((r) => gives(c, r)));
  holds(control.calls.length > 0 && bare.length === 0, `${who} the rubric holds the text-only rules you wrote that cover the diff (${control.what}): ${control.calls.length ? `the request ${bare.map((c) => c.job).join(', ')} holds none of them` : 'no review run was given a request'}`);
}

/** AC8: a claim that opens a PR starts one review run on its commit, read from the record. */
export function oneReviewRun(events: readonly Ev[], r: Round, who = AC8): void {
  const runs = reviewRuns(events, r.claim).filter((x) => x.started.data.commit === r.commit);
  holds(runs.length === 1, `${who} ${r.claim}, which opens PR 21 through a real hub, starts one review run on its commit ${r.commit}, read from the record: it starts ${runs.length} (${sayRuns(reviewRuns(events, r.claim))})`);
}

export { allEvents };
