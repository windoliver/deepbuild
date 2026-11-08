// Test-side tools for #344's acceptance tests. A world is #303's (a temp HOME with the shipped default guards, the OS
// confirmation stub, a git repository the sessions work in, the hub as a process, Claude Code sessions fired through the
// real deep-hook binary, the log read back through the hub's socket), imported and never copied, plus the fixture
// repo of the issue (a root AGENTS.md, a nested packages/app/AGENTS.md, a .github/copilot-instructions.md and a
// .github/instructions/render.instructions.md whose applyTo is `packages/dev/**/*.ts`), the rules page read back
// line by line, the record seeded while no hub runs (the month's sessions and their tool calls), and the guard
// entries a rule is enforced by. Nothing here stands in for the rules page, the hub, the hook or the record: the tests
// reach them only through the surfaces README.md names, and say which of those it invented.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect } from 'vitest';
import { openRecord, type Connection } from '../../../packages/record/src/index.ts';
import { ulid } from '../26/helpers.ts';
import { learnEvent, youApp } from '../62/helpers.ts';
import { cleanup as cleanup355, makeClock, seedSession, withRecord, type World as World355 } from '../355/helpers.ts';
import {
  CLI, NODE, REPO, allEvents, childEnv, cleanup, makeWorld, own, parseObject, run, said, settle, shown, sleep, startHub as startHub303, stopHub, Session,
  type Ev, type Hub, type Line, type Ran, type World,
} from '../303/helpers.ts';

const worlds: string[] = [];
/** Stops what the suite started, by PID, then removes its folders, retrying one a just-stopped hub is still emptying. */
export const cleanupAll = async (): Promise<void> => {
  try { await cleanup(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error; }
  await cleanup355();
  for (const dir of worlds.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
};
export { CLI, NODE, REPO, Session, allEvents, said, settle, shown, sleep, stopHub, type Ev, type Hub, type Line, type Ran, type World };
export const DAY = 86_400_000;
export const AGENT_HOME_SESSIONS = 'sessions';

// ---- The rules the fixture states, word for word where the issue does.
export const NEVER_PUSH = 'never push without asking';
export const LINTER = 'Run the linter before every commit';
export const APP_RULE = 'Keep React components under 200 lines';
export const COPILOT_RULE = 'Prefer named exports over default exports';
export const RENDER_RULE = 'Never allocate inside the render loop';
export const LEGACY_RULE = 'Never edit the generated stubs by hand';
export const FORCE_PUSH = 'never force-push';
export const NPM_TEST = 'Always run npm test before opening a PR';

const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const git = (w: World, ...args: string[]): string => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
  cwd: w.repo, encoding: 'utf8',
  env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: w.tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
}).trim();

export interface FixtureOptions {
  /** The root AGENTS.md's rules (default: NEVER_PUSH and LINTER). */
  root?: string[];
  /** Codex's user-level rule file, `~/.codex/AGENTS.md` (default none). */
  codex?: string[];
  /** Any other repo file, by its path, written before the commit. */
  files?: Record<string, string>;
  /** Leave out the nested, Copilot and `applyTo` files (a world about the root file's rules alone). */
  rootOnly?: boolean;
}
const bullets = (rules: readonly string[]): string => rules.map((r) => `- ${r}\n`).join('');
/** The issue's fixture repo on top of #303's world, committed on main. */
export function fixtureWorld(o: FixtureOptions = {}): World {
  const w = makeWorld({ drafts: [] });
  worlds.push(w.tmp);
  put(join(w.repo, 'AGENTS.md'), `# Rules\n\n${bullets(o.root ?? [NEVER_PUSH, LINTER])}`);
  if (!o.rootOnly) {
    put(join(w.repo, 'packages/app/AGENTS.md'), `# App\n\n${bullets([APP_RULE])}`);
    put(join(w.repo, '.github/copilot-instructions.md'), `# Copilot\n\n${bullets([COPILOT_RULE])}`);
    put(join(w.repo, '.github/instructions/render.instructions.md'), `---\napplyTo: "packages/dev/**/*.ts"\n---\n\n${bullets([RENDER_RULE])}`);
  }
  for (const f of ['packages/dev/src/a.ts', 'packages/dev/src/b.ts', 'packages/dev/render/r.ts', 'packages/app/src/x.ts', 'web/app.ts', 'legacy/old.ts']) {
    put(join(w.repo, f), `export const name = '${f}';\n`);
  }
  for (const [file, text] of Object.entries(o.files ?? {})) put(join(w.repo, file), text);
  if (o.codex) put(join(w.home, '.codex', 'AGENTS.md'), `# Codex\n\n${bullets(o.codex)}`);
  git(w, 'add', '-A');
  git(w, 'commit', '-q', '-m', 'fixture rules');
  return w;
}

// ---- The hub: #303's start, plus the one environment seam this suite invents (README, DEEP_HUB_TEST_EVAL).
export interface HubOpts { plant?: string; eval?: string }
export async function startHub(w: World, o: HubOpts = {}): Promise<Hub> {
  if (!o.eval) return startHub303(w, o.plant ? { plant: o.plant } : {});
  const env = childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_TEST_WORK: w.work, DEEP_HUB_PLANT: o.plant, DEEP_HUB_TEST_EVAL: o.eval });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => {
      let out = '';
      child.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!)); });
    }),
    exit.then(() => undefined),
    sleep(120_000).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub did not start: ${err.slice(-1500)}`);
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, readyAt: Date.now(), clock: undefined, plant: o.plant, stderr: () => err };
}

/** `deep <args>` as you, in a shell of your own (never inside an agent's process tree). */
export const deep = (w: World, args: readonly string[]): Promise<Ran> => run(NODE, [CLI, ...args], { env: childEnv(w.home), cwd: w.tmp, timeoutMs: 120_000 });
export function json(r: Ran, what: string): Line {
  const v = parseObject(r.stdout.trim());
  if (!v) expect.fail(`${what} prints one JSON object: ${shown(r)}`);
  return v;
}

// ---- Guards a rule is enforced by (#304's `deep guard add`); the link to the rule is `proofs.<name>.rule` (README).
export interface GuardGiven { name: string; match: string; planted: string; twin: string; rule: string }
export async function addGuard(w: World, g: GuardGiven): Promise<Ran> {
  const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });
  const file = join(w.tmp, `guard-${g.name}.json`);
  writeFileSync(file, `${JSON.stringify({
    v: 1,
    entries: { [g.name]: { match: g.match, scope: 'all_repos', mode: 'block', reason: `You wrote this rule: ${g.rule}.`, next_step: 'Ask the person.', fail_closed: false } },
    proofs: { [g.name]: { planted: bash(g.planted), twin: bash(g.twin), rule: g.rule } },
  }, null, 2)}\n`);
  return deep(w, ['guard', 'add', file]);
}
/** A guard whose planted call is denied and whose twin runs: the install check passes. */
export const goodGuard = (name: string, rule: string, command: string): GuardGiven => ({ name, rule, match: `run:${command}*`, planted: `${command} origin main`, twin: 'git status' });
/** A guard whose planted call goes through its match, so it guards nothing: its install check fails (the hub's `installs-unchecked` plant lets it in). */
export const badGuard = (name: string, rule: string, command: string): GuardGiven => ({ name, rule, match: `run:${command}*`, planted: 'git status', twin: 'git log' });

// ---- The rules page: `<home>/.deepbuild/wiki/rules.md`, claim lines in #355's format with the fields this suite invents.
export interface PageRule { text: string; id: string; file: string; scope: string; enforcer: { kind: string; name?: string }; tokens: number; known: string; handle: string; line: number; json: Line }
export interface PageFile { file: string; tokens: number; line: number }
const CLAIM = /^- (.*?) <!-- deep:claim (\{.*\}) -->$/;
const FILE_LINE = /^- (.*?) <!-- deep:rule-file (\{.*\}) -->$/;
export const pagePath = (w: World): string => join(w.root, 'wiki', 'rules.md');
function pageLines(w: World): string[] {
  return existsSync(pagePath(w)) ? readFileSync(pagePath(w), 'utf8').split('\n') : [];
}
export function rulesPage(w: World): PageRule[] {
  const out: PageRule[] = [];
  pageLines(w).forEach((l, i) => {
    const m = CLAIM.exec(l);
    if (!m) return;
    const j = parseObject(m[2]!) ?? {};
    out.push({
      text: m[1]!, id: String(j.id), file: String(j.file), scope: String(j.scope), enforcer: (j.enforcer ?? { kind: 'MISSING' }) as PageRule['enforcer'],
      tokens: Number(j.tokens), known: String(j.known), handle: `wiki:rules#${String(j.id)}`, line: i + 1, json: j,
    });
  });
  return out;
}
export function ruleFiles(w: World): PageFile[] {
  const out: PageFile[] = [];
  pageLines(w).forEach((l, i) => {
    const m = FILE_LINE.exec(l);
    const j = m ? parseObject(m[2]!) : undefined;
    if (m && j) out.push({ file: String(j.file), tokens: Number(j.tokens), line: i + 1 });
  });
  return out;
}
export const ruleNamed = (rules: readonly PageRule[], text: string): PageRule | undefined => rules.find((r) => r.text === text || r.text.replace(/[.]$/, '') === text);
/** What the last `deep rules sync` said, for the failure messages of a page that came back empty. */
let lastSync = '';
/** `deep rules sync`, then the page (README: Invented surfaces). Its exit isn't judged here: what the page holds is. */
export async function syncRules(w: World): Promise<PageRule[]> {
  lastSync = shown(await deep(w, ['rules', 'sync']));
  return rulesPage(w);
}
export const show = (rules: readonly PageRule[]): string =>
  rules.map((r) => `${r.text} [${r.file}; ${r.scope}; ${r.enforcer.kind}${r.enforcer.name ? ` ${r.enforcer.name}` : ''}]`).join('\n  ') || `(no rule lines on the rules page; deep rules sync: ${lastSync})`;

// ---- What a session was told: every hook's reply, as deep-hook printed it.
export const told = (s: Session, text: string): { event: string; ran: Ran }[] => s.hooks.filter((h) => `${h.ran.stdout}\n${h.ran.stderr}`.includes(text));
export const heard = (r: Ran, text: string): boolean => `${r.stdout}\n${r.stderr}`.includes(text);
export const deliveries = (events: readonly Ev[], s: Session, via?: string): Ev[] =>
  events.filter((e) => e.kind === 'session.rules_delivered' && (e.session === s.id || e.subject === `session:${s.id}`) && (via === undefined || e.data.via === via));
export const handleOf = (s: Session): string => `session:${s.id}`;

// ---- The record, seeded while no hub runs: the month's sessions and their tool calls (README, Reading the record).
const who = { actor: 'you', scope: 'you' };
export interface SeedSession { daysAgo: number; /** repo-relative paths its tool calls read */ reads: string[]; id?: string }
/** Seeds sessions in the world's repo; each is a session.start and one tool.before per path, `daysAgo` before now. Returns each one's ID, in order. */
export async function seedSessions(w: World, sessions: readonly SeedSession[]): Promise<string[]> {
  mkdirSync(w.root, { recursive: true, mode: 0o700 });
  let now = Date.now() - 100 * DAY;
  const record = await openRecord({ path: join(w.root, 'ledger.db'), now: () => now });
  const ids = sessions.map((s) => s.id ?? ulid(Date.now() - s.daysAgo * DAY));
  try {
    // Oldest first, so the log's order is the sessions' order.
    const order = sessions.map((_s, i) => i).sort((a, b) => sessions[b]!.daysAgo - sessions[a]!.daysAgo);
    for (const i of order) {
      const s = sessions[i]!;
      const id = ids[i]!;
      now = Date.now() - s.daysAgo * DAY;
      const hook: Connection = { writer: 'hook', ...who, session: id, project: 'shop', agent: 'claude-code' };
      await record.append(hook, { v: 1, id: ulid(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: w.repo, branch: 'main', thread: id } });
      for (const [n, path] of s.reads.entries()) {
        now += 1000;
        await record.append(hook, { v: 3, id: ulid(now), kind: 'tool.before', ts: now, data: { kind: 'read', paths: [join(w.repo, path)], command: null, call: `toolu_${id.slice(-8)}${n}` } });
      }
    }
  } finally {
    await record.close();
  }
  return ids;
}
export const inboxAsks = (events: readonly Ev[], words: string): Ev[] => events.filter((e) => e.kind === 'ask.created' && JSON.stringify(e.data).includes(words));
export const proposals = (events: readonly Ev[], words: string): Ev[] => events.filter((e) => e.kind === 'learn.proposed' && JSON.stringify(e.data).includes(words));

// ---- Learned start-slice entries and their rollback, through the record while no hub runs (#62's surface, #355's helpers).
const world355 = (w: World): World355 => ({ tmp: w.tmp, home: w.home, root: w.root, wiki: join(w.root, 'wiki'), elsewhere: w.tmp, clock: makeClock(), said: new Map() });
/** Applies one slice entry per text (you apply them, from the app, at scope `all`); returns each one's change ID. */
export async function seedSlice(w: World, texts: readonly string[]): Promise<string[]> {
  const w355 = world355(w);
  return withRecord(w355, async (o) => {
    const session = await seedSession(w355, o, 'shop', w.repo, [{ id: 'm1', from: 'you', text: `${texts.join('. ')}.` }]);
    const ids: string[] = [];
    for (const [i, text] of texts.entries()) {
      const event = learnEvent('learn.applied', w355.clock.tick(1000), { target: `slice:fixture${i}`, diff: `+ ${text}`, evidence: [{ at: `session:${session}#m1`, quote: text }], scope: 'all' }, 'you');
      await o.record.append(youApp, event);
      ids.push(event.id);
    }
    return ids;
  });
}
/** Rolls one change back, as you, while no hub runs. */
export async function rollBack(w: World, change: string): Promise<void> {
  await withRecord(world355(w), async (o) => { await o.record.rollBack(youApp, { change }); });
}

/** The agent reads a repo file (a Read call); resolves with deep-hook's PreToolUse run, where a notice for the call rides. */
export async function readCall(w: World, s: Session, file: string): Promise<Ran> {
  const path = join(w.repo, file);
  const content = readFileSync(path, 'utf8');
  const r = await s.call('Read', { file_path: path }, { response: { type: 'text', file: { filePath: path, content, numLines: 1, startLine: 1, totalLines: 1 } } });
  if (!r.allowed) throw Error(`BLOCKED: the Read of ${file} must be allowed: ${shown(r.before)}`);
  return r.before;
}

// ---- Removal lessons (#111's list, `deep memory --json`), with the `why` this issue adds (README).
export interface Lesson { id: string; kind: string; text: string; why: string; [key: string]: unknown }
export async function lessons(w: World): Promise<Lesson[]> {
  const r = await deep(w, ['memory', '--json']);
  expect(r.code, `deep memory --json lists the lessons: ${shown(r)}`).toBe(0);
  const parsed = json(r, 'deep memory --json');
  expect(Array.isArray(parsed.lessons), `deep memory --json holds a lessons list: ${r.stdout.slice(0, 400)}`).toBe(true);
  return parsed.lessons as Lesson[];
}
export const lessonsFor = (all: readonly Lesson[], rule: string): Lesson[] => all.filter((l) => l.text.replace(/[.]$/, '') === rule || l.text.includes(rule));
export const listed = (all: readonly Lesson[]): string => all.map((l) => `${l.id} ${l.kind} "${l.text}": ${String(l.why)}`).join('\n  ') || '(no lessons)';
