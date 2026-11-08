// Shared by the #1537 acceptance tests (README): the criteria's IDs, the world they run in (#322's world and hub,
// reused through its helpers, plus the fake reviewer first on the runner's login PATH, the wiki's review rubric, a
// made-up Claude Code sign-in and the recorded GitHub answers for PR 21), the claim each test makes, reading the
// verdicts and the review jobs back through the hub's socket, and the reach test (AC6). Nothing here stands in for
// DeepBuild: the hub, deep-hook and the CLI are the real ones; only the second model (the fake reviewer) and the
// sources (fixtures) are ours.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COVERED, FIX, FLAG, SETTINGS, claimsOf, control, expectTask, git, lastPos, lockedFor, makeWorld, must, req, runOf, runsOf, Session, settle, shown,
  taskVerdicts, type Draft, type Ev, type Hub, type Ran, type World, type WorldOptions,
} from '../322/helpers.ts';
import { PR_URL, prAnswers } from '../323/github.ts';
import { EXPIRED } from '../323/helpers.ts';

export { cleanup, failureOf, must, reportWindow, Session, startHub, stopHub, trustRepo } from '../322/helpers.ts';
export type { Ev, Hub, Ran, World } from '../322/helpers.ts';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

// ---- The criteria: `#1537.<first 8 hex of SHA-256 of the criterion's text, trimmed, white space collapsed>`.
export const AC1 = 'AC1 #1537.efe493fd';
export const AC2 = 'AC2 #1537.cc546fc7';
export const AC3 = 'AC3 #1537.59bd30dc';
export const AC4 = 'AC4 #1537.930e77d5';
export const AC5 = 'AC5 #1537.70369576';
export const AC6 = 'AC6 #1537.552d1d30';

export const HOUR = 3_600_000;
const FIVE = new Set(['PASS', 'FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE']);

// ---- The code change every review test makes (#322's world): FIX makes the spec's unit check pass, and the edit
// below makes R1's drafted check pass. BUGGY also adds a planted bug on src/auth.js's line 4: an assignment where a
// comparison is meant, which no command check sees.
export const ASK = 'make the auth middleware reject expired tokens, then open a pull request';
/** The definition handed for ASK: R1, judged by #323's drafted check `.deepbuild/checks/expired-token.sh`, a node:test
 *  file the hermetic runner counts, failing until the middleware says it rejects expired tokens. */
export const DRAFT: Draft = { ask: ASK, requirements: [req('R1', 'An expired token is rejected with 401', { check: EXPIRED.check, asserts: EXPIRED.asserts })], deliverables: ['src/auth.js'], budget: null };
export const CLEAN = FLAG;
export const BUGGY = { file: 'src/auth.js', from: 'rejectsExpired: false', to: "rejectsExpired: true,\n  isAdmin: (user) => user.role = 'admin'" } as const;
/** The planted bug as the fake reviewer reports it: its file and line in the claim's commit, its rubric rule and quote. */
export const BUG = { file: 'src/auth.js', line: 4, rule: 'wrong-comparison', ruleText: 'an assignment where a comparison is meant', quote: "user.role = 'admin'" } as const;
export const PR_CREATE = 'gh pr create --title "Reject expired tokens" --body "Rejects expired tokens in the auth middleware."';
export { FIX, PR_URL };
/** The model the fake reviewer answers as: another model than the session's (claude-haiku-5-5), one the facts name. */
export const REVIEWER_MODEL = 'claude-sonnet-5-5';

// ---- The world.
export interface ReviewWorld extends World { bin: string }
/**
 * #322's world (its repo, spec, drafted check and settings), and for the review: the fake reviewer installed as
 * `claude` in `<tmp>/bin`, first on the runner's login PATH (`runner.login_path` in config.json, beside your plan
 * reserve, 10%); a made-up Claude Code sign-in (`~/.claude/.credentials.json`, so no job reads a real keychain); the
 * wiki's review rubric (`~/.deepbuild/wiki/review-rubric.md`); and GitHub's recorded answers for PR 21 with no
 * review thread.
 */
export function reviewWorld(o: WorldOptions = {}): ReviewWorld {
  const w = makeWorld({ drafts: [DRAFT], files: EXPIRED.files, answers: prAnswers([{ n: 21, body: 'Rejects expired tokens in the auth middleware.', threads: [] }]) as unknown as NonNullable<WorldOptions['answers']>, ...o });
  const bin = join(w.tmp, 'bin');
  mkdirSync(bin, { recursive: true });
  const config = { version: COVERED, model: REVIEWER_MODEL, findings: [BUG] };
  const path = join(bin, 'claude');
  writeFileSync(path, fixture('fake-reviewer.pl').replace('__CONFIG__', Buffer.from(JSON.stringify(config), 'utf8').toString('base64')), { mode: 0o755 });
  chmodSync(path, 0o755);
  writeFileSync(join(w.root, 'config.json'), `${JSON.stringify({ asks: SETTINGS, runner: { login_path: `${bin}:/usr/bin:/bin` }, plan: { reserve_pct: 10 } }, null, 2)}\n`);
  writeFileSync(join(w.home, '.claude', '.credentials.json'), `${JSON.stringify({ claudeAiOauth: { accessToken: `sk-ant-oat01-dh1537FAKE${'x'.repeat(40)}`, refreshToken: `sk-ant-ort01-dh1537FAKE${'y'.repeat(40)}`, expiresAt: 4102444800000, scopes: ['user:inference'], subscriptionType: 'max' } })}\n`, { mode: 0o600 });
  writeFileSync(join(w.home, '.claude', 'settings.json'), '{}\n');
  mkdirSync(join(w.root, 'wiki'), { recursive: true });
  writeFileSync(join(w.root, 'wiki', 'review-rubric.md'), fixture('rubric.md'));
  return { ...w, bin };
}
/** Adds files to the world's repo and folds them into its one base commit. */
export function addToBase<W extends World>(w: W, files: Record<string, string | Uint8Array>): W {
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(w.repo, path)), { recursive: true });
    writeFileSync(join(w.repo, path), bytes);
  }
  git(w.tmp, w.repo, ['add', '.']);
  git(w.tmp, w.repo, ['commit', '-q', '--amend', '-m', 'base']);
  return { ...w, base: git(w.tmp, w.repo, ['rev-parse', 'HEAD']) };
}
/** A SQLite file whose `tests` table holds `n` rows: the source behind the suite's test count. */
export async function suiteDatabase(w: World, path: string, n: number): Promise<void> {
  const { DatabaseSync } = await import('node:sqlite');
  mkdirSync(dirname(join(w.repo, path)), { recursive: true });
  const db = new DatabaseSync(join(w.repo, path));
  db.exec('CREATE TABLE tests (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO tests (name) VALUES (?)');
  for (let i = 1; i <= n; i++) insert.run(`test ${i}`);
  db.close();
}
export const FIXTURE = fixture;

// ---- One session through the task: started, the prompt typed, the definition locked.
export async function openTask(hub: Hub, w: World, ask: string, who: string): Promise<{ s: Session; ref: string }> {
  const s = new Session(w);
  await s.start();
  await s.typed(ask);
  const events = await settle(hub, (all) => { try { return lockedFor(all, expectTask(all, s, ask, who)).length > 0; } catch { return false; } }, 60_000);
  const ref = expectTask(events, s, ask, who);
  must(lockedFor(events, ref).length > 0, `BLOCKED: ${who} the handed definition of ${ref} must lock: none was recorded`);
  return { s, ref };
}
/** The PR the session opens: `gh pr create`, its result PR 21's link, as Claude Code records it. */
export async function openPr(s: Session, who: string): Promise<void> {
  const opened = await s.call('Bash', { command: PR_CREATE, description: 'Open the pull request' }, { response: { stdout: `${PR_URL(21)}\n`, stderr: '', interrupted: false, isImage: false } });
  must(opened.allowed, `BLOCKED: ${who} gh pr create must be allowed: ${shown(opened.before)}`);
}

// ---- Reading what the hub judged.
export const outcomeOf = (v: Ev | undefined): string => String(v?.data.outcome ?? 'none');
export const sayVerdicts = (vs: readonly Ev[]): string => vs.map((v) => `${outcomeOf(v)} ${JSON.stringify(v.data).slice(0, 900)}`).join(' | ') || 'none';
/** The claim the task's stop made after `since`, as a handle `claim:<id>`, or undefined. */
export const claimAfter = (events: readonly Ev[], ref: string, since: number): string | undefined => {
  const c = claimsOf(events, ref, since).at(-1);
  return c ? `claim:${c.id}` : undefined;
};
/**
 * Reads the record until the task's claims after `since` have a verdict of the five other than PASS, or a PASS that
 * stood `standMs` with nothing after it (a correct hub never passes while a check is pending, so a PASS that stands is
 * the verdict), or `timeoutMs` passed. Resolves with the events read last.
 */
export async function judged(hub: Hub, ref: string, since: number, o: { standMs?: number; timeoutMs?: number } = {}): Promise<Ev[]> {
  let passSeen: number | undefined;
  return settle(hub, (all) => {
    const vs = taskVerdicts(all, ref, since).filter((v) => FIVE.has(outcomeOf(v)));
    if (vs.some((v) => outcomeOf(v) !== 'PASS')) return true;
    if (!vs.length) return false;
    passSeen ??= Date.now();
    return Date.now() - passSeen > (o.standMs ?? 30_000);
  }, o.timeoutMs ?? 300_000);
}
/**
 * The runs of the task's claims after `since` of a command check of the spec (`unit`) or R1's drafted check,
 * each with how it ended. A run on the merge base `base`, which proves R1's fix by failing there, is left out.
 */
export function commandRuns(events: readonly Ev[], ref: string, since: number, base: string): { check: string; outcome: string }[] {
  return runsOf(events, ref, since).filter((r) => String(r.started.data.commit) !== base && (runOf('unit')(r) || runOf('.deepbuild/checks/expired-token.sh')(r)))
    .map((r) => ({ check: String(r.started.data.check), outcome: String(r.finished?.data.outcome ?? 'unfinished') }));
}
/** Holds the claim's command checks green: the spec's unit check and R1's drafted check each have a run, and every one passed. */
export function commandsGreen(events: readonly Ev[], ref: string, since: number, who: string, claim: string | undefined, base: string): void {
  const runs = commandRuns(events, ref, since, base);
  const ran = (name: string) => runs.some((r) => r.check === name || r.check.includes(name));
  must(ran('unit') && ran('expired-token.sh') && runs.every((r) => r.outcome === 'passed'), `BLOCKED: ${who} ${claim ?? 'the claim'}'s commands must be green (the spec's unit check and R1's drafted check, each passed): ${JSON.stringify(runs)}`);
}
/** The review jobs the runner recorded: each one call of the fake reviewer. */
export async function reviewJobs(hub: Hub): Promise<{ job: string; kind: string; state: string; claim?: string }[]> {
  const r = await control(hub, 'job.list', {});
  return ((r.jobs ?? []) as { job: string; kind: string; state: string }[]).filter((j) => j.kind === 'review');
}
/** What a hook's run told Claude Code, every byte of it: a block's reason, a system message, added context or stderr. */
export const told = (r: Ran): string => `${r.stdout}\n${r.stderr}`;

export { lastPos, settle, taskVerdicts };

// ---- The reach test (AC6): every check kind the workspace ships is held by the hub with a route into a gate run,
// and every kind the hub holds has one.
export interface HeldKind { kind: string; routes: string[] }
/** The kinds the hub holds as check.kind@1 fills, and the routes by which a gate run names each: `checks.kinds`. */
export async function heldKinds(hub: Hub): Promise<HeldKind[]> {
  const r = await control(hub, 'checks.kinds', {});
  return (Array.isArray(r.kinds) ? r.kinds : []) as HeldKind[];
}
/** The check kinds the workspace ships, each read from its package's own check.kind@1 fills (the kits stay as they are). */
export async function shippedKinds(): Promise<{ kind: string; pkg: string }[]> {
  const out: { kind: string; pkg: string }[] = [];
  const command = await import('../../../packages/checks-command/src/index.ts');
  out.push({ kind: command.commandCheckKind({} as Parameters<typeof command.commandCheckKind>[0]).kind, pkg: '@deepbuild/checks-command' });
  const review = await import('../../../packages/checks-review/src/index.ts');
  out.push({ kind: review.reviewFill(() => ({ findings: [] })).kind, pkg: '@deepbuild/checks-review' });
  const numbers = await import('../../../packages/checks-numbers/src/index.ts');
  out.push({ kind: numbers.numbersFill().kind, pkg: '@deepbuild/checks-numbers' });
  const work = await import('../../../packages/checks-work/src/index.ts');
  work.default({ registerCheck: (kind: string) => { out.push({ kind, pkg: '@deepbuild/checks-work' }); } });
  return out;
}
/** The reach test's failures: a shipped kind the hub doesn't hold, and a held kind no gate run can reach, each named. */
export function unreached(shipped: readonly { kind: string; pkg: string }[], held: readonly HeldKind[]): string[] {
  const out: string[] = [];
  for (const s of shipped) if (!held.some((h) => h.kind === s.kind)) out.push(`kind ${s.kind} (${s.pkg}): the hub doesn't hold it, so no gate run can reach it`);
  for (const h of held) if (!Array.isArray(h.routes) || h.routes.length === 0) out.push(`kind ${h.kind}: the hub holds it with no route into a gate run`);
  return out;
}
/** The reach test against a running hub: throws naming every kind no gate run can reach. */
export async function reachTest(hub: Hub): Promise<void> {
  const failures = unreached(await shippedKinds(), await heldKinds(hub));
  if (failures.length) throw Error(`the reach test fails: ${failures.join('; ')}`);
}
