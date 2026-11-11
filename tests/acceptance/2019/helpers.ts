// Test-side tools for #2019 (README). Every fixture is a record a real hub reads: sessions are played through a real
// hub's hook route (`Live`, which keeps each reply) or seeded with the hub stopped through the real record and asks
// core (#2018's `Seeder` and this file's `More`), each event in its kind's published shape; then a real hub (`deep hub
// run` in a temp HOME) builds the list's rows. The readers are the real ones: the built CLI's `deep status --json` and
// `deep status`; the record through `events.read`; the hook replies; the real `deep-drive` (#124) for the app's list and
// the Agents page, launched with `launch.from: "record_copy"`; and `deep setup` for the Agents page's homes. The judges
// each criterion's failure text comes from are here, and every name this suite pins is here once (README, Pinned here).
//
// Reused by import: #16's homes, hub, hook route, sessions, temp folders and PID cleanup; #26's seeding; #2018's seeder,
// world parts, rows, replica and builds; #1461's reading of the drawn list.
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was
// started with; no test touches the real ~/.deepbuild, ~/.claude, ~/.codex, ~/.pi or ~/Library/LaunchAgents; no network,
// no model, no real agent binary.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { deep as deep16, hookRequest, makeHome, newSession, own, sendHook, sha256, startHub, ulid, type HookResult, type Session } from '../16/helpers.ts';
import { seed, type Seeding } from '../26/helpers.ts';
import {
  allEvents, blockOf, byId, cleanup, control, DAY, deep, flat, HOUR, letters, MIN, needBuilds, quiet, Replica, REPO, rowOf, Script, Seeder, sleep, statusRows,
  stopHub, template, tempDir, wordsOf, type Ev, type FixtureSession, type Hub, type Row, type Seen, type Snapshot, type World,
} from '../2018/helpers.ts';
import { listRows } from '../1461/helpers.ts';

export { allEvents, blockOf, byId, cleanup, control, deep, flat, MIN, quiet, Replica, rowOf, sleep, statusRows, stopHub, wordsOf, type Ev, type Row, type Seen, type Snapshot, type World };
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const SECOND = 1000;
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
const said = (v: unknown, most = 300): string => (JSON.stringify(v) ?? String(v)).slice(0, most);
/** Asserts that a judge found nothing wrong; what it found is the assertion's own text, a failure a line. */
export const none = (failures: readonly string[], what: string): void => expect(failures.length, `${what}:\n${failures.join('\n')}\n`).toBe(0);

/** The criteria, by `#2019.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  interrupted: '#2019.3052d233',
  quiet: '#2019.92d09557',
  retrying: '#2019.52aac98e',
  watchOnly: '#2019.3a943830',
  agents: '#2019.524707a3',
  repeating: '#2019.ea7b05b6',
} as const;

// ---- Pinned here (README, Pinned here): every name the implementation must provide, in one place.

/**
 * Pinned 1, the flag: each row of `deep status --json` (and of `see`'s rows, the same row shape) carries `flag`, null
 * or one object; `code` is the flag's word, `text` the one line the row's right slot shows. A row shows at most one.
 */
export const FLAG = {
  interrupted: 'interrupted',
  retrying: 'retrying',
  repeating: 'repeating',
  watchOnly: 'watch-only',
  unpushed: 'unpushed',
} as const;
/** The flag as `deep status --json` and `see` carry it (README, Pinned 1). Every field but `code` and `text` belongs to some codes only. */
export interface Flag {
  code: string; text: string;
  /** interrupted: what it was doing; and `until`, ms, when it can pick up, where the agent's own record says. */
  doing?: string; until?: number | null;
  /** retrying: the cause in words, the count, and since (ms) the first retry's time. repeating: the command, the count, since the first of the repeated failures. */
  cause?: string; count?: number; since?: number; command?: string;
  /** watch-only: its fix, in words. */
  fix?: string;
}
/** Pinned 1: the app's row draws its flag in its right slot, a node of this id inside the row `session:<id>`. */
export const flagNode = (session: string): string => `session:${session}:flag`;
export const wordNode = (session: string): string => `session:${session}:word`;
/** Pinned 5: the Agents page's address, and each agent's row on it. */
export const AGENTS_PAGE = 'page/agents';
export const agentNode = (agent: string): string => `agent:${agent}`;
/** Pinned 6, the planted wrong programs, each selected by DEEP_HUB_PLANT (packages/hub/src/plant.ts, or the replica's env-plants build). */
export const PLANT = {
  /** AC3: a hub that never reads a model-call retry, so the row reads working through the retries. */
  retryReadsWorking: 'retry-reads-working',
  /** AC4: a row that reads "sent back" for a FAIL no hold delivered. */
  sentBackWithoutHold: 'sent-back-without-hold',
  /** AC5: an Agents page that shows only its title (the replica's env-plants build). */
  agentsTitleOnly: 'agents-title-only',
  /** AC6: a detector keyed on the command alone, one that notifies at every repeat, and one that raises an ask. */
  repeatByCommand: 'repeat-by-command',
  repeatNotifiesEach: 'repeat-notifies-each',
  repeatRaisesAsk: 'repeat-raises-ask',
} as const;

export const flagOf = (row: Row | undefined): Flag | null => (row && typeof row.flag === 'object' && row.flag !== null ? (row.flag as Flag) : null);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

// ---- The criteria's own values.

/** AC6's command, and the Claude Code failure texts its runs end with: one error, and a second one for the twin. */
export const COMMAND = 'pnpm test --filter api';
export const ERROR_A = 'Exit code 1\n> api@1.0.0 test\n> vitest run\n\nFAIL src/users.test.ts > GET /users/:id > returns 404 for a missing user\nAssertionError: expected 500 to be 404';
export const ERROR_B = 'Exit code 1\n> api@1.0.0 test\n> vitest run\n\nFAIL src/orders.test.ts > POST /orders > totals the lines\nAssertionError: expected 41 to be 42';
/** AC4: the version past Claude Code's facts (2.1.299, 2.1.304 and 2.1.308), one a real session was seen on. */
export const PAST_FACTS = '2.1.321';
/** AC3: a version Claude Code's facts cover, so the session's holds stay on and its row carries no watch-only flag. */
export const COVERED = '2.1.308';
/** AC4: what the FAIL verdict names as its smallest failing case: short enough that the verdict line never cuts it. */
export const FAIL_CAUSE = 'users 404';

// ---- Seeded events past #2018's seeder: a session of either agent, its hooks' events, a stop with a cause, a commit,
// an attention state. Each in its kind's published shape, as the hub's hooks and core would have appended it.

type Obj = Record<string, any>;
type Agent = 'claude-code' | 'codex';
/** The world's parts a seeder reads and adds sessions to. */
type Parts = Pick<World, 'home' | 'repos' | 'sessions' | 'asks'>;
export class More {
  private calls = 0;
  readonly agents = new Map<string, Agent>();
  constructor(private readonly sd: Seeding, private readonly w: Parts) {}
  private s(key: string): FixtureSession { return this.w.sessions[key] ?? blocked(`the fixture has no session ${key}`); }
  private who(key: string): { actor: string; scope: string; session: string; project: string } { const s = this.s(key); return { actor: 'you', scope: 'you', session: s.id, project: s.project ?? s.repo }; }
  subject(key: string): string { return `session:${letters(this.s(key).id)}`; }
  /** One event of `kind`, its data the newest schema's fixture's with `set` over it. */
  async put(key: string, writer: 'hook' | 'core', kind: string, at: number, set: Obj, o: { subject?: string; pick?: (d: Obj) => boolean } = {}): Promise<string> {
    const t = template(kind, o.pick);
    const id = ulid(at);
    this.sd.at(at);
    const agent = this.agents.get(key) ?? 'claude-code';
    await this.sd.record.append({ writer, ...this.who(key), ...(writer === 'hook' ? { agent } : {}) }, { v: t.v, id, kind, ts: at, ...(o.subject ? { subject: o.subject } : {}), data: { ...t.data, ...set } });
    return id;
  }
  /** A session of `agent` in `repo`'s git folder, started at `at`, its transcript or rollout where its agent keeps one. */
  async start(key: string, repo: string, agent: Agent, at: number): Promise<FixtureSession & { transcript: string }> {
    const cwd = this.w.repos[repo] ?? blocked(`the fixture has no repo ${repo}`);
    const made = newSession(this.w.home, agent, cwd);
    const s: FixtureSession = { key, id: made.id, repo, cwd };
    this.w.sessions[key] = s;
    this.agents.set(key, agent);
    await this.put(key, 'hook', 'session.start', at, { agent, worktree: cwd, branch: 'main', thread: made.id, loads: [] });
    return { ...s, transcript: made.transcript };
  }
  async prompt(key: string, words: string, at: number): Promise<void> { await this.put(key, 'hook', 'user.ask', at, { msg: 0, text: words, tasks: [], from: 'unknown' }); }
  /** A shell call begun; its call ID. */
  async call(key: string, command: string, at: number): Promise<string> {
    const call = `call_2019_${++this.calls}`;
    await this.put(key, 'hook', 'tool.before', at, { kind: 'shell', paths: [], command, call }, { pick: (d) => d.kind === 'shell' });
    return call;
  }
  async ended(key: string, call: string, command: string, at: number): Promise<void> {
    await this.put(key, 'hook', 'tool.after', at, { kind: 'shell', paths: [], command, call, outcome: 'ok' }, { pick: (d) => d.outcome === 'ok' });
  }
  /** A stop whose cause the adapter read from the agent's own records, then the core's word that the turn ended. */
  async stopped(key: string, at: number, cause: Obj): Promise<void> {
    const pick = (d: Obj) => d.cause === cause.cause;
    await this.put(key, 'hook', 'agent.stop', at, { turn: 1, did_work: true, claim: false, usage: null, outcome: 'finished', ...cause }, { subject: this.subject(key), pick });
    await this.attention(key, at + 1000, 'finished');
  }
  async attention(key: string, at: number, state: string): Promise<void> {
    await this.put(key, 'core', 'session.attention', at, { state }, { subject: this.subject(key), pick: (d) => d.state === 'working' });
  }
  /** A commit the session made, as the hub reads it from its worktree at the session's hooks. */
  async commit(key: string, at: number, sha: string, branch: string): Promise<void> {
    await this.put(key, 'core', 'commit.made', at, { sha, worktree: this.s(key).cwd, branch }, { subject: this.subject(key) });
  }
}

// ---- Git: each repo a folder with a first commit on main; cart also has an origin (a bare repo beside it) holding
// main, one commit pushed and one on a branch no remote has.

const GIT_ENV = (cwd: string): NodeJS.ProcessEnv => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', HOME: cwd });
function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, env: GIT_ENV(cwd), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function commitFile(cwd: string, file: string, body: string, message: string): string {
  writeFileSync(join(cwd, file), body);
  git(cwd, ['add', file]);
  git(cwd, ['commit', '-q', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
}
/** The cart repo's two commits: one on origin/main, one on the branch cart-totals that no remote holds. */
export interface Commits { pushed: string; unpushed: string; branch: string }
function makeRepos(base: string, names: readonly string[]): { repos: Record<string, string>; commits: Commits } {
  const repos: Record<string, string> = {};
  for (const name of names) {
    const dir = join(base, name);
    mkdirSync(dir);
    git(dir, ['init', '-q', '-b', 'main']);
    commitFile(dir, 'README.md', `# ${name}\n`, `start ${name}`);
    repos[name] = dir;
  }
  const cart = repos.cart ?? blocked('the fixture has no cart repo');
  const origin = join(base, 'cart-origin.git');
  git(base, ['init', '-q', '--bare', '-b', 'main', origin]);
  git(cart, ['remote', 'add', 'origin', origin]);
  const pushed = commitFile(cart, 'cart.js', 'export const cart = [];\n', 'add the cart');
  git(cart, ['push', '-q', 'origin', 'main']);
  git(cart, ['checkout', '-q', '-b', 'cart-totals']);
  const unpushed = commitFile(cart, 'totals.js', 'export const total = (c) => c.length;\n', 'sum the cart totals');
  git(cart, ['checkout', '-q', 'main']);
  if (!git(cart, ['branch', '-r', '--contains', pushed]).includes('origin/main')) blocked('the fixture\'s pushed commit is on no remote branch');
  if (git(cart, ['branch', '-r', '--contains', unpushed]) !== '') blocked('the fixture\'s unpushed commit is on a remote branch');
  return { repos, commits: { pushed, unpushed, branch: 'cart-totals' } };
}

// ---- Played sessions: hooks through the real hub's hook route from a stand-in process of the session's own, each
// reply kept; a Claude Code session's transcript written as Claude Code writes it.

/** One Claude Code transcript: each line as Claude Code appends it (README, The fixture), its version the session's. */
export class Transcript {
  private parent: string | null = null;
  constructor(readonly path: string, private readonly s: { id: string; cwd: string }, private readonly version: string) {}
  private line(fields: Obj, at = Date.now()): Obj {
    const uuid = randomUUID();
    const entry = { parentUuid: this.parent, isSidechain: false, userType: 'external', cwd: this.s.cwd, sessionId: this.s.id, version: this.version, gitBranch: 'main', entrypoint: 'cli', timestamp: new Date(at).toISOString(), uuid, ...fields };
    this.parent = uuid;
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
    return entry;
  }
  /** Starts the transcript afresh with your prompt, as its first line. */
  prompt(words: string, promptId: string): void { writeFileSync(this.path, ''); this.line({ type: 'user', message: { role: 'user', content: words }, promptId }); }
  /** A model reply: its words, then the tool call it makes. */
  reply(call: { id: string; command: string }, words?: string): void {
    const content = [...(words ? [{ type: 'text', text: words }] : []), { type: 'tool_use', id: call.id, name: 'Bash', input: { command: call.command } }];
    this.line({ type: 'assistant', requestId: `req_${randomUUID().replace(/-/g, '')}`, message: { id: `msg_${randomUUID().replace(/-/g, '')}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: 'tool_use', usage: { input_tokens: 12, output_tokens: 8, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
  }
  result(call: string, output: string): void {
    this.line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call, content: output, is_error: false }] }, toolUseResult: { stdout: output, stderr: '', interrupted: false } });
  }
  /**
   * One model-call retry, as Claude Code records it (README, The fixture): a line of its own, no message, its error,
   * retryInMs, retryAttempt, maxRetries and source "request_retry". The overload error's shape is an assumption
   * (README, Disputes 4): a 529 with the API's overloaded_error body, as Claude Code's API errors carry one.
   */
  retry(attempt: number, retryInMs: number, at = Date.now()): Obj {
    const body = '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';
    return this.line({ type: 'system', subtype: 'api_error', level: 'error', error: { message: `529 ${body}`, formatted: `API Error: 529 ${body}`, status: 529, type: 'overloaded_error', connection: null, isNetworkDown: false, rateLimits: null, noResponse: null }, retryInMs, retryAttempt: attempt, maxRetries: 10, source: 'request_retry' }, at);
  }
}
/** A tool call's ID, as Claude Code writes one. */
export const callId = (): string => `toolu_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

/** Played sessions: each hook goes through the hub's hook route from the session's own stand-in process; every reply is kept. */
export class Live {
  private readonly made = new Map<string, { s: Session; pid: number }>();
  constructor(public hub: Hub, private readonly w: Parts) {}
  session(key: string, repo: string, agent: Agent = 'claude-code'): FixtureSession & { transcript: string } {
    const cwd = this.w.repos[repo] ?? blocked(`the fixture has no repo ${repo}`);
    const s = newSession(this.w.home, agent, cwd);
    const standIn = spawn('/bin/sleep', ['7200'], { stdio: 'ignore' });
    own(standIn.pid);
    this.made.set(key, { s, pid: standIn.pid! });
    this.w.sessions[key] = { key, id: s.id, repo, cwd };
    return { ...this.w.sessions[key]!, transcript: s.transcript };
  }
  async hook(key: string, event: string, extra: Obj = {}): Promise<HookResult> {
    const m = this.made.get(key) ?? blocked(`no played session ${key}`);
    const r = await sendHook(this.hub.socket, { ...hookRequest(m.s, event, extra), pid: m.pid, ppid: m.pid }, 60_000);
    if (!r.ack) blocked(`the hub didn't acknowledge ${event} for ${key}: ${said(r, 600)}`);
    return r;
  }
}
/** What a hook's reply told the agent: the context it adds, a block's reason, a message; or its plain text. */
export function toldBy(r: HookResult): string {
  const reply = r.reply as { exit?: number; stdout?: string; stderr?: string } | undefined;
  if (!reply) return '';
  let out: Obj | undefined;
  try { out = JSON.parse(reply.stdout ?? '') as Obj; } catch { out = undefined; }
  const parts = out && typeof out === 'object' ? [out.hookSpecificOutput?.additionalContext, out.reason, out.systemMessage, out.hookSpecificOutput?.permissionDecisionReason] : [reply.stdout];
  if (reply.exit === 2) parts.push(reply.stderr);
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join('\n');
}

// ---- The Proof's fixture (README, The fixture): 30 sessions across 3 repos, the criteria's sessions among them.

/**
 * The repos. The criteria's sessions work in `cart`, first by name, so the list draws their rows at the reference
 * window: at the base it draws only the rows that fit and doesn't scroll (#1808). The other sessions are in the rest.
 */
export const REPOS = ['cart', 'docs', 'search'] as const;
export const FIXTURE_REPO = REPOS[0];
export const TITLES = { limited: 'Invoice schema', unpushed: 'Cart totals', pushed: 'Cart page', exited: 'Search index', unreadable: 'End-to-end run', watchonly: 'Users endpoint' } as const;
/** AC1: what the usage-limited session was doing: its turn's prompt and its last command. */
export const LIMITED = { prompt: 'move the invoices to the new schema', command: 'npm run db:migrate' } as const;
export interface Main extends World { commits: Commits; resets: number; fillers: string[] }
type Key = keyof typeof TITLES;

/** AC4's session, played through a hub: its transcript on a version past its facts, a prompt and one call. */
async function playWatchOnly(p: Live): Promise<void> {
  const s = p.session('watchonly', FIXTURE_REPO);
  const t = new Transcript(s.transcript, s, PAST_FACTS);
  const prompt = randomUUID();
  t.prompt('make the users endpoint return 404 for a missing user', prompt);
  await p.hook('watchonly', 'SessionStart');
  await p.hook('watchonly', 'UserPromptSubmit', { prompt: 'make the users endpoint return 404 for a missing user', prompt_id: prompt });
  const call = { id: callId(), command: 'npm run lint' };
  t.reply(call);
  await p.hook('watchonly', 'PreToolUse', { tool_name: 'Bash', tool_input: { command: call.command }, tool_use_id: call.id });
  t.result(call.id, 'no problems');
  await p.hook('watchonly', 'PostToolUse', { tool_name: 'Bash', tool_input: { command: call.command }, tool_response: { stdout: 'no problems', stderr: '', interrupted: false }, tool_use_id: call.id });
}

async function seedMain(s: Seeder, x: More, T: number, commits: Commits, resets: number, fillers: string[]): Promise<void> {
  const sc = new Script();
  const titled = (key: Key, at: number) => sc.on(at, () => s.task(key, TITLES[key], at));
  // limited: a Codex turn its plan window cut off: the stop's cause read from Codex's own rate-limit record, with the reset.
  sc.on(T - 50 * MIN, () => x.start('limited', FIXTURE_REPO, 'codex', T - 50 * MIN));
  titled('limited', T - 50 * MIN + 1000);
  sc.on(T - 50 * MIN + 2000, () => x.prompt('limited', LIMITED.prompt, T - 50 * MIN + 2000));
  let migrate = '';
  sc.on(T - 48 * MIN, async () => { migrate = await x.call('limited', LIMITED.command, T - 48 * MIN); });
  sc.on(T - 46 * MIN, () => x.ended('limited', migrate, LIMITED.command, T - 46 * MIN));
  sc.on(T - 44 * MIN, () => x.stopped('limited', T - 44 * MIN, { cause: 'plan_window_spent', plan_resets: resets, owner: 'service', signature: `sig:${sha256('stop:plan_window_spent').slice(0, 16)}` }));
  // unpushed and pushed: idle sessions in cart, each with one commit: one on no remote branch, one on origin/main.
  for (const [key, sha, branch, at] of [['unpushed', commits.unpushed, commits.branch, T - 80 * MIN], ['pushed', commits.pushed, 'main', T - 90 * MIN]] as const) {
    sc.on(at, () => s.start(key, FIXTURE_REPO, at));
    titled(key, at + 1000);
    sc.on(at + 2000, () => s.prompt(key, `commit the ${key === 'unpushed' ? 'cart totals' : 'cart page'}`, at + 2000));
    let c = '';
    sc.on(at + 60_000, async () => { c = await s.toolStart(key, at + 60_000, 'git commit -am "save"'); });
    sc.on(at + 70_000, () => s.toolEnd(key, c, at + 70_000, 'git commit -am "save"'));
    sc.on(at + 71_000, () => x.commit(key, at + 71_000, sha, branch));
    sc.on(at + 5 * MIN, () => s.stop(key, at + 5 * MIN, false));
  }
  // exited: a call begun, then the session map found its process gone with no end: exited mid-turn.
  sc.on(T - 40 * MIN, () => s.start('exited', FIXTURE_REPO, T - 40 * MIN));
  titled('exited', T - 40 * MIN + 1000);
  sc.on(T - 40 * MIN + 2000, () => s.prompt('exited', 'rebuild the search index', T - 40 * MIN + 2000));
  sc.on(T - 20 * MIN, () => s.toolStart('exited', T - 20 * MIN, 'npm run index'));
  sc.on(T - 15 * MIN, () => s.gone('exited', T - 15 * MIN));
  // unreadable: a call begun, then its hooks went quiet and the hub said it can't tell (unknown); its transcript is gone.
  sc.on(T - 6 * HOUR, async () => { const made = await x.start('unreadable', FIXTURE_REPO, 'claude-code', T - 6 * HOUR); rmSync(made.transcript, { force: true }); });
  titled('unreadable', T - 6 * HOUR + 1000);
  sc.on(T - 6 * HOUR + 2000, () => x.prompt('unreadable', 'run the end-to-end suite', T - 6 * HOUR + 2000));
  sc.on(T - 6 * HOUR + 60_000, () => x.call('unreadable', 'npm run e2e', T - 6 * HOUR + 60_000));
  sc.on(T - 5 * HOUR, () => x.attention('unreadable', T - 5 * HOUR, 'unknown'));
  // watchonly (played): its task, then a stop that claims done and a FAIL, with no send-back: no hold was delivered.
  titled('watchonly', T - 25 * MIN);
  let claim = '';
  sc.on(T - 20 * MIN, async () => { claim = (await s.stop('watchonly', T - 20 * MIN, true))!; });
  sc.on(T - 18 * MIN, () => s.verdict('watchonly', claim, 'FAIL', T - 18 * MIN, FAIL_CAUSE));
  // 24 more sessions, twelve in docs and twelve in search: finished, working, PASS, says done, waiting on an ask, quiet.
  const kinds = ['finished', 'finished', 'working', 'pass', 'saysdone', 'asks', 'quiet', 'finished', 'working', 'pass', 'saysdone', 'asks', 'quiet', 'finished', 'working', 'pass', 'saysdone', 'asks', 'quiet', 'finished', 'working', 'pass', 'finished', 'quiet'] as const;
  kinds.forEach((kind, i) => {
    const key = `f${i}`;
    fillers.push(key);
    const repo = REPOS[1 + (i % 2)]!;
    const at = kind === 'quiet' ? T - 3 * DAY - i * MIN : T - (60 + 3 * i) * MIN;
    sc.on(at, () => s.start(key, repo, at));
    if (kind === 'quiet') return;
    sc.on(at + 1000, () => s.task(key, `Task ${i} in ${repo}`, at + 1000));
    sc.on(at + 2000, () => s.prompt(key, `do task ${i}`, at + 2000));
    if (kind === 'working') { sc.on(T - (2 + i / 10) * MIN, () => s.toolStart(key, T - (2 + i / 10) * MIN, 'npm run lint')); return; }
    if (kind === 'asks') { sc.on(at + 60_000, () => s.ask(key, i % 2 ? 'taste' : 'choice', `Which wording for task ${i}?`, at + 60_000)); return; }
    let c = '';
    sc.on(at + 30_000, async () => { c = await s.toolStart(key, at + 30_000, 'npm run lint'); });
    sc.on(at + 40_000, () => s.toolEnd(key, c, at + 40_000, 'npm run lint'));
    let made = '';
    sc.on(at + 60_000, async () => { made = (await s.stop(key, at + 60_000, kind !== 'finished')) ?? ''; });
    if (kind === 'pass') sc.on(at + 90_000, () => s.verdict(key, made, 'PASS', at + 90_000));
  });
  await sc.play();
}

const HUB_START_MS = 120_000;
const hubFor = (w: Pick<World, 'home' | 'confirm'>, o: { clock?: number; plant?: string } = {}): Promise<Hub> =>
  startHub({ home: w.home, env: { DEEP_HUB_TEST_CONFIRM: w.confirm, ...(o.plant ? { DEEP_HUB_PLANT: o.plant } : {}) }, ...(o.clock === undefined ? {} : { clock: o.clock }) }, HUB_START_MS);

/**
 * The Proof's fixture: three git folders, AC4's session played through a hub whose clock stood half an hour back, the
 * rest seeded with that hub stopped, every time counted back from when the fixture was made; then a real hub on it,
 * its clock real time.
 */
export async function mainWorld(): Promise<Main> {
  needBuilds();
  const home = makeHome();
  const root = join(home, '.deepbuild');
  const base = tempDir();
  const confirm = join(base, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const { repos, commits } = makeRepos(base, REPOS);
  const w: Parts & { root: string; confirm: string } = { home, root, confirm, repos, sessions: {}, asks: [] };
  const first = await hubFor(w, { clock: Date.now() - 30 * MIN });
  await playWatchOnly(new Live(first, w));
  await quiet(first);
  const conn = await control(first);
  const played = await allEvents(conn).finally(() => conn.close());
  for (const s of Object.values(w.sessions)) {
    const project = (played.find((e) => e.kind === 'session.start' && e.session === s.id) as (Ev & { project?: string }) | undefined)?.project;
    if (project) s.project = project;
  }
  await stopHub(first);
  const at = Date.now();
  // When the plan window resets: on a whole minute, 2 h 13 min on.
  const resets = Math.ceil((at + 133 * MIN) / MIN) * MIN;
  const fillers: string[] = [];
  await seed(home, (sd) => seedMain(new Seeder(sd, w), new More(sd, w), at, commits, resets, fillers), at);
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(root, 'setup-finished.json'), JSON.stringify({ version }));
  const hub = await hubFor(w);
  await quiet(hub);
  const main: Main = { ...w, hub, at, commits, resets, fillers };
  const sessions = Object.keys(main.sessions).length;
  if (sessions !== 30 || new Set(Object.values(main.sessions).map((x) => x.repo)).size !== 3) blocked(`the Proof's fixture holds ${sessions} sessions in ${new Set(Object.values(main.sessions).map((x) => x.repo)).size} repos, not 30 in 3`);
  return main;
}
/** Stops the world's hub by its PID and starts one again on the same record, the plant chosen in its process. */
export async function restartWith(w: World, plant?: string): Promise<void> {
  await stopHub(w.hub);
  w.hub = await hubFor(w, plant ? { plant } : {});
  await quiet(w.hub);
}
export const idOf = (w: World, key: string): string => w.sessions[key]?.id ?? blocked(`the fixture has no session ${key}`);
/** What the replica draws over a copy of the world's record as it stands now. */
export async function drawn(w: { home: string }, plant?: string): Promise<Seen> {
  const r = await Replica.of(w, plant);
  try { await r.wait(500); return await r.see(); } finally { await r.stop(); }
}
/** The session's row in `deep status --json`, read until `done` holds or `ms` pass; each read in order. */
export async function rowUntil(w: World, session: string, done: (row: Row | undefined) => boolean, ms: number, plant?: string): Promise<{ row: Row | undefined; reads: number; at: number }> {
  const deadline = Date.now() + ms;
  let reads = 0;
  for (;;) {
    const row = rowOf((await statusRows(w, plant ? { plant } : {})).rows, session);
    reads++;
    if (done(row) || Date.now() > deadline) return { row, reads, at: Date.now() };
    await sleep(250);
  }
}

// ---- Judges. Each returns what's wrong, or nothing; each failure names the session (and, for AC6, the call).

const at = (session: string): string => `session ${session} (row session:${session})`;

/** AC1: interrupted by a usage limit, saying what it was doing and when it can pick up (README, Pinned 1). */
export function interruptedFailures(row: Row | undefined, session: string, o: { doing: readonly string[]; until: number }): string[] {
  if (!row) return [`${at(session)} has no row in deep status --json`];
  const f = flagOf(row);
  if (f?.code !== FLAG.interrupted) return [`${at(session)}, stopped by a usage limit, shows the flag ${said(f)} in deep status --json, not interrupted (README, Pinned 1)`];
  const out: string[] = [];
  const doing = [text(f.doing), text(f.text), text(row.why)].join('\n');
  if (!o.doing.some((d) => doing.includes(d))) out.push(`${at(session)} reads interrupted without what it was doing: its flag and why ${said(doing)} hold none of ${said(o.doing)}`);
  if (f.until !== o.until) out.push(`${at(session)} reads interrupted, and says it can pick up at ${said(f.until)}, not ${o.until} (${new Date(o.until).toISOString()}), when its plan window resets by the agent's own record`);
  return out;
}
/** AC1: an idle session with a commit on no remote branch carries the flag unpushed; one whose commit is on origin/main doesn't. */
export function unpushedFailures(row: Row | undefined, session: string, unpushed: boolean): string[] {
  if (!row) return [`${at(session)} has no row in deep status --json`];
  const code = flagOf(row)?.code;
  if (unpushed && code !== FLAG.unpushed) return [`${at(session)}, idle with a commit on no remote branch, shows the flag ${said(flagOf(row))} in deep status --json, not unpushed (README, Pinned 1)`];
  if (!unpushed && code === FLAG.unpushed) return [`${at(session)}, whose one commit is on origin/main, shows the flag unpushed in deep status --json`];
  return [];
}
/** AC2: a session whose state can't be read reads quiet, and nothing in its row says interrupted. */
export function quietFailures(row: Row | undefined, session: string): string[] {
  if (!row) return [`${at(session)} has no row in deep status --json`];
  const out: string[] = [];
  if (row.word !== 'quiet') out.push(`${at(session)}, whose adapter can't be read, reads ${said(row.word)} in deep status --json, not quiet`);
  if (flagOf(row)?.code === FLAG.interrupted || /\binterrupted\b/i.test(JSON.stringify(row))) out.push(`${at(session)}, whose adapter can't be read, reads interrupted in deep status --json: ${said(row, 500)}`);
  return out;
}
/** AC2: the session map shows the session exited mid-turn: its row carries the flag interrupted. */
export function exitedFailures(row: Row | undefined, session: string): string[] {
  if (!row) return [`${at(session)} has no row in deep status --json`];
  return flagOf(row)?.code === FLAG.interrupted ? [] : [`${at(session)}, which the session map shows exited mid-turn, shows the flag ${said(flagOf(row))} beside ${said(row.word)} in deep status --json, not interrupted (README, Pinned 1)`];
}
/** The app's row draws `want` in its right slot, the node session:<id>:flag inside the row (README, Pinned 1). */
export function drawnFlagFailures(s: Snapshot, session: string, want: RegExp): string[] {
  const row = byId(s, `session:${session}`);
  if (!row) return [`the app's list draws no row session:${session}`];
  const node = byId(s, flagNode(session));
  if (!node) return [`the app's row session:${session} has no flag in its right slot (no node ${flagNode(session)}, README, Pinned 1); it reads ${said(wordsOf(s, row))}`];
  const out: string[] = [];
  if (!flat(row).includes(node)) out.push(`${flagNode(session)} is drawn outside its row session:${session}`);
  if (!want.test(wordsOf(s, node))) out.push(`the app's row session:${session} shows the flag ${said(wordsOf(s, node))}, not ${want}`);
  return out;
}
/** The app's row doesn't read `not` anywhere. */
export function drawnNotFailures(s: Snapshot, session: string, not: RegExp, why: string): string[] {
  const row = byId(s, `session:${session}`);
  const words = row ? wordsOf(s, row) : '';
  return not.test(words) ? [`the app's row session:${session} reads ${said(words)}: ${why}`] : [];
}

/** AC3: while retrying, the row shows retrying with the cause, the count and the time of the first retry (README, Pinned 1). */
export function retryingFailures(row: Row | undefined, session: string, o: { count: number; first: number; waited: number }): string[] {
  if (!row) return [`${at(session)} has no row in deep status --json`];
  const f = flagOf(row);
  if (f?.code !== FLAG.retrying) return [`${at(session)}, whose transcript records ${o.count} model-call retries for overload, reads ${said(row.word)} with the flag ${said(f)} for ${Math.round(o.waited / 1000)} s after the second retry, with no event since: a row that reads working through the retries`];
  const out: string[] = [];
  if (!/overload/i.test(`${text(f.cause)} ${text(f.text)}`)) out.push(`${at(session)} reads retrying without the cause, overload: cause ${said(f.cause)}, text ${said(f.text)}`);
  if (f.count !== o.count) out.push(`${at(session)} reads retrying with the count ${said(f.count)}, not ${o.count}`);
  if (typeof f.since !== 'number' || Math.abs(f.since - o.first) > SECOND) out.push(`${at(session)} reads retrying since ${said(f.since)}, not the first retry's time ${o.first} (${new Date(o.first).toISOString()}) within 1 s`);
  return out;
}
/** AC3: at the next model reply in that turn the row reads working again, retrying gone. */
export function backToWorkFailures(row: Row | undefined, session: string, waited: number): string[] {
  if (!row) return [`${at(session)} has no row in deep status --json`];
  return row.word === 'working' && flagOf(row)?.code !== FLAG.retrying ? [] : [`${at(session)} reads ${said(row.word)} with the flag ${said(flagOf(row))} ${Math.round(waited / 1000)} s after the model's reply in that turn, not working`];
}

/**
 * AC4: a session on a version past its facts reads watch-only on its row (with why, naming the version, and its fix)
 * and on its verdict line, and never "sent back" with no hold delivered. `block` is its rows in `deep status`; the
 * verdict line is the line under its row that holds the FAIL's cause.
 */
export function watchOnlyFailures(o: { row: Row | undefined; block: string; drawn?: Snapshot }, session: string): string[] {
  const out: string[] = [];
  const row = o.row;
  if (!row) return [`${at(session)} has no row in deep status --json`];
  const f = flagOf(row);
  if (row.word === 'sent back') out.push(`${at(session)} reads "sent back" in deep status --json with no hold delivered`);
  if (f?.code !== FLAG.watchOnly) out.push(`${at(session)}, on Claude Code ${PAST_FACTS} past its facts, shows the flag ${said(f)} in deep status --json, not watch-only (README, Pinned 1)`);
  else {
    if (![text(f.text), text(row.why)].some((t) => t.includes(PAST_FACTS))) out.push(`${at(session)} reads watch-only without why: neither its flag's text ${said(f.text)} nor its why ${said(row.why)} names the version ${PAST_FACTS}`);
    if (!text(f.fix).trim()) out.push(`${at(session)} reads watch-only with no fix: its flag's fix is ${said(f.fix)}`);
  }
  const lines = o.block.split('\n');
  if (!o.block) out.push(`${at(session)} has no line in deep status`);
  for (const l of lines) if (/\bsent back\b/.test(l)) out.push(`${at(session)} reads "sent back" in deep status with no hold delivered: ${said(l)}`);
  const verdict = lines.slice(1).find((l) => l.includes(FAIL_CAUSE));
  if (o.block && !verdict) out.push(`${at(session)} has no verdict line in deep status: no line under its row names its FAIL's cause "${FAIL_CAUSE}": ${said(o.block, 600)}`);
  else if (verdict && !/watch-only/.test(verdict)) out.push(`${at(session)}'s verdict line doesn't read watch-only: ${said(verdict)}`);
  if (o.drawn) {
    out.push(...drawnFlagFailures(o.drawn, session, /watch-only/).map((x) => `${at(session)}: ${x}`));
    const word = byId(o.drawn, wordNode(session))?.name;
    if (word === 'sent back') out.push(`${at(session)} reads "sent back" in the app's list with no hold delivered`);
  }
  return out;
}

/**
 * AC5: on the Agents page each agent set up waits for a first session, in a row of its own (`agent:<id>`, README,
 * Pinned 5), or says why its sessions can't reach DeepBuild, with the fix; the list has no row for any of them.
 */
export function agentsFailures(seen: Seen, o: { waiting: readonly { id: string; name: string }[]; untrusted?: { id: string; name: string } }): string[] {
  const s = seen.snapshot;
  const out: string[] = [];
  const page = byId(s, AGENTS_PAGE);
  if (!page) out.push(`the Agents page (${AGENTS_PAGE}) isn't drawn: the window shows ${said(seen.address)}`);
  const row = (id: string) => (page ? flat(page).find((n) => n.id === agentNode(id)) : undefined);
  for (const a of o.waiting) {
    const n = row(a.id);
    if (!n) { out.push(`the Agents page has no row ${agentNode(a.id)} for ${a.name} (README, Pinned 5)`); continue; }
    const words = wordsOf(s, n);
    if (!words.includes(a.name) || !/\bwait(s|ing)? for (a|its) first session\b/i.test(words)) out.push(`the Agents page's row ${agentNode(a.id)} reads ${said(words)}: it doesn't say ${a.name} waits for a first session`);
  }
  if (o.untrusted) {
    const a = o.untrusted;
    const n = row(a.id);
    const words = n ? wordsOf(s, n) : '';
    if (!n) out.push(`the Agents page has no row ${agentNode(a.id)} for ${a.name} (README, Pinned 5)`);
    else if (!words.includes(a.name) || !/\b(untrusted|not trusted)\b/i.test(words)) out.push(`the Agents page's row ${agentNode(a.id)} reads ${said(words)}: it doesn't say ${a.name}'s hooks aren't trusted`);
    else if (!words.includes('/hooks')) out.push(`the Agents page's row ${agentNode(a.id)} says ${a.name}'s hooks aren't trusted with no fix: ${said(words)} doesn't name /hooks, where you approve them`);
  }
  for (const r of seen.rows.filter((x) => x.id.startsWith('session:'))) out.push(`the list has a row ${r.id} (${said(r.title)}) with no session`);
  for (const n of listRows(s)) out.push(`the app's list draws a row ${String(n.id)} (${said(n.name)}) with no session`);
  return out;
}

/** One call of a played turn: its ID, its command, how it ended, what the hooks told the agent, and the row after it. */
export interface Call { n: number; id: string; command: string; error?: string; told: string[]; row?: Row | undefined }
/**
 * AC6: the record and the rows after each call against the rule: a session whose last three calls ran the same
 * command and each failed with the same exit code and error signature reads repeating, with the command, the count and
 * since when; one notice reaches the agent at the third such failure and none after; no ask is raised and the row never
 * reads needs you. Each failure names its call: `call <n> (<call ID>)`.
 */
export function repeatFailures(session: string, calls: readonly Call[], events: readonly Ev[]): string[] {
  const out: string[] = [];
  const mine = events.filter((e) => e.session === session || e.subject === `session:${letters(session)}` || (e.data as Obj)?.target === `session:${letters(session)}`);
  const after = (c: Call) => mine.find((e) => e.kind === 'tool.after' && (e.data as Obj).call === c.id);
  const before = (c: Call) => mine.find((e) => e.kind === 'tool.before' && (e.data as Obj).call === c.id);
  const name = (c: Call) => `call ${c.n} (${c.id}, ${c.command}${c.error === undefined ? ', ok' : ', failed'})`;
  // Where each record event falls: after the last call whose tool.after precedes it.
  const callAt = (pos: number): Call | undefined => [...calls].reverse().find((c) => (after(c)?.log_pos ?? Infinity) < pos);
  let run = 0;
  const expected = new Map<number, number>();
  calls.forEach((c, i) => {
    const e = after(c)?.data as Obj | undefined;
    if (!e) { out.push(`${name(c)}: the record holds no tool.after for it`); run = 0; return; }
    const prev = i > 0 ? (after(calls[i - 1]!)?.data as Obj | undefined) : undefined;
    const same = e.outcome === 'failed' && prev?.outcome === 'failed' && calls[i - 1]!.command === c.command && prev.exit_code === e.exit_code && prev.signature === e.signature;
    run = e.outcome !== 'failed' ? 0 : same ? run + 1 : 1;
    expected.set(c.n, run);
  });
  for (const c of calls) {
    const n = expected.get(c.n) ?? 0;
    const row = c.row;
    const f = flagOf(row);
    if (row?.word === 'needs you') out.push(`${name(c)}: after it the row reads needs you`);
    if (n >= 3) {
      const first = calls[calls.indexOf(c) - n + 1]!;
      const from = (before(first)?.ts ?? 0) - SECOND;
      const to = (after(first)?.ts ?? Infinity) + SECOND;
      if (f?.code !== FLAG.repeating) out.push(`${name(c)}, the ${n === 3 ? 'third' : `${n}th`} identical failure in a row: after it the row reads ${said(row?.word)} with the flag ${said(f)}, not repeating (README, Pinned 1)`);
      else {
        if (f.command !== c.command) out.push(`${name(c)}: the row reads repeating with the command ${said(f.command)}, not ${said(c.command)}`);
        if (f.count !== n) out.push(`${name(c)}: the row reads repeating with the count ${said(f.count)}, not ${n}`);
        if (typeof f.since !== 'number' || f.since < from || f.since > to) out.push(`${name(c)}: the row reads repeating since ${said(f.since)}, not the time of the first of the ${n} failures (${first.id}, between ${from} and ${to})`);
      }
    } else if (f?.code === FLAG.repeating) out.push(`${name(c)}: after it the row reads repeating, though its session's last three calls didn't each fail with the same exit code and error signature (${calls.slice(Math.max(0, calls.indexOf(c) - 2), calls.indexOf(c) + 1).map((x) => `${x.id}: ${String((after(x)?.data as Obj | undefined)?.signature ?? (x.error === undefined ? 'ok' : 'none'))}`).join(', ')})`);
  }
  // The notices that name the command, and the asks, each placed at the call it came after.
  const notices = mine.filter((e) => e.kind === 'notice.delivered' && text((e.data as Obj).text).includes(calls[0]?.command ?? COMMAND));
  for (const c of calls) {
    const got = notices.filter((e) => callAt(e.log_pos) === c);
    const want = expected.get(c.n) === 3 ? 1 : 0;
    if (got.length < want) out.push(`${name(c)}, the third identical failure in a row, brought the agent no notice through the notice route: no notice.delivered names ${said(c.command)}`);
    if (got.length > want) out.push(`${name(c)} brought the agent ${got.length - want} notice${got.length - want === 1 ? '' : 's'} more than the one at the third failure: ${said(got.map((e) => (e.data as Obj).text))}`);
    for (const e of got.slice(0, want)) {
      const t = text((e.data as Obj).text);
      const sig = String((after(c)?.data as Obj | undefined)?.signature ?? '');
      if (!/\b3\b/.test(t) || !sig || !t.includes(sig)) out.push(`${name(c)}: its notice ${said(t)} doesn't name the count 3 and the error signature ${sig}`);
      if (!calls.some((x) => x.told.some((told) => told.includes(t)))) out.push(`${name(c)}: its notice ${said(t)} reached no hook reply the agent got`);
    }
  }
  for (const e of mine.filter((x) => x.kind === 'ask.created')) {
    const c = callAt(e.log_pos);
    out.push(`${c ? name(c) : `before ${name(calls[0]!)}`} raised an ask: ${said((e.data as Obj).question)}`);
  }
  return out;
}

/** Plays one Claude Code turn of shell calls through the hub, reading the row after each; each call fails with its `error` or succeeds without one. */
export async function playCalls(w: World, p: Live, key: string, steps: readonly { command: string; error?: string }[], o: { after?: (c: Call) => Promise<void>; plant?: string } = {}): Promise<Call[]> {
  const session = idOf(w, key);
  const calls: Call[] = [];
  for (const [i, step] of steps.entries()) {
    const id = callId();
    const c: Call = { n: i + 1, id, command: step.command, ...(step.error === undefined ? {} : { error: step.error }), told: [] };
    const input = { tool_name: 'Bash', tool_input: { command: step.command }, tool_use_id: id };
    c.told.push(toldBy(await p.hook(key, 'PreToolUse', input)));
    const ended = step.error === undefined
      ? await p.hook(key, 'PostToolUse', { ...input, tool_response: { stdout: 'ok', stderr: '', interrupted: false } })
      : await p.hook(key, 'PostToolUseFailure', { ...input, error: step.error, is_interrupt: false });
    c.told.push(toldBy(ended));
    await quiet(w.hub);
    c.row = rowOf((await statusRows(w, o.plant ? { plant: o.plant } : {})).rows, session);
    calls.push(c);
    await o.after?.(c);
  }
  return calls;
}
/** A Claude Code session in `repo` that has started and been prompted, through the hub. */
export async function prompted(p: Live, key: string, repo: string, words: string): Promise<FixtureSession & { transcript: string }> {
  const s = p.session(key, repo);
  await p.hook(key, 'SessionStart');
  await p.hook(key, 'UserPromptSubmit', { prompt: words });
  return s;
}

// ---- AC5's homes: `deep setup` in a temp HOME where Claude Code, Codex and pi are each installed as stand-ins.

export const AGENTS = { claude: { id: 'claude-code', name: 'Claude Code' }, codex: { id: 'codex', name: 'Codex' }, pi: { id: 'pi', name: 'pi' } } as const;
export interface SetUp { home: string; hub: Hub; env: Record<string, string | undefined> }
/**
 * A home right after Set up: `~/.claude`, `~/.codex` and `~/.pi/agent`, each agent's command on PATH as a stand-in
 * (`fixtures/agents/`), a login shell that keeps that PATH, a real hub, then `deep setup` (exit 0). Codex's hook list,
 * as its app-server answers `hooks/list`, reports DeepBuild's entries `trust` (README, The fixture).
 */
export async function setUpHome(trust: 'trusted' | 'untrusted'): Promise<SetUp> {
  needBuilds();
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  for (const dir of [join(home, '.claude'), join(home, '.codex'), join(home, '.pi', 'agent'), bin]) mkdirSync(dir, { recursive: true });
  for (const name of ['claude', 'codex', 'pi', 'login-shell', 'launchctl']) {
    copyFileSync(join(SUITE, 'fixtures', 'agents', `${name}.sh`), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  copyFileSync(join(SUITE, 'fixtures', 'agents', 'codex-app-server.cjs'), join(bin, 'codex-app-server.cjs'));
  writeFileSync(join(bin, 'codex.json'), JSON.stringify({ version: '0.160.0', trust }));
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  // No marker of this process's own agent session, no billing key, no real agent on PATH.
  const strip = Object.fromEntries(Object.keys(process.env).filter((k) => /^(CLAUDE|CODEX|ANTHROPIC|OPENAI|GIT_|AI_AGENT|CURSOR|GROK)/.test(k)).map((k) => [k, undefined]));
  const env = { ...strip, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, SHELL: join(bin, 'login-shell'), DEEP_HUB_TEST_CONFIRM: confirm, NODE: process.execPath };
  const hub = await startHub({ home, env }, HUB_START_MS);
  const set = await deep16(home, ['setup'], { env, timeoutMs: 600_000 });
  if (set.code !== 0) blocked(`deep setup must exit 0 in the test home: exit ${set.code}, stdout ${said(set.stdout, 800)}, stderr ${said(set.stderr, 1500)}`);
  await quiet(hub);
  return { home, hub, env };
}
/**
 * The Agents page as the replica draws it over a copy of that home's record (README, Pinned 5); `build: "plants"` is
 * the replica's env-plants build, with `plant` chosen or none.
 */
export async function agentsPage(h: { home: string }, o: { plant?: string; build?: 'plain' | 'plants' } = {}): Promise<Seen> {
  const r = await Replica.of(h, o.plant, o.build ?? (o.plant ? 'plants' : 'plain'));
  try {
    await r.wait(500);
    await r.open(AGENTS_PAGE);
    await r.wait(1500);
    return await r.see();
  } finally {
    await r.stop();
  }
}
