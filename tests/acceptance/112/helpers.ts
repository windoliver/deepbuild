// Shared test-side tools for the issue #112 acceptance tests: the surface README declares (types only), plans and
// runs for the comparison rule, a record world for the learned layer's widening, and an eval world: a fixture git
// repo, real past tasks in it, and a scripted fake Launcher that stands in for the agents under test and the judge
// (a boundary we don't own). None of them stands in for the comparison rule, the eval or the learned layer.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import type { Evidence, EvidenceStore } from '../../../packages/evidence/src/index.ts';
import * as recordModule from '../../../packages/record/src/index.ts';
import type { Connection, EventInput, RecordStore, Row } from '../../../packages/record/src/index.ts';

// ---- Criterion IDs: `#112.` and the first 8 hex of SHA-256 of the criterion's text, trimmed, whitespace collapsed.
export const AC1 = '#112.324bbab7';
export const AC2 = '#112.e99b571a';
export const AC3 = '#112.e0bfcf89';
export const AC4 = '#112.22f2dc6d';
export const AC5 = '#112.477ca7b2';
export const AC6 = '#112.756497e6';
export const AC7 = '#112.72c6ea54';
export const AC8 = '#112.dbf62f22';

// ---- The surface README declares. In the core (packages/record/src/index.ts): the one comparison rule.
export interface Measure { name: string; better: 'higher' | 'lower' }
export interface Variant { name: string; files: Record<string, string> }
export interface ReplayPlan {
  id: string;
  cutoff: number;
  tasks: string[];
  fitted: string[];
  variants: { base: Variant; change: Variant };
  models: { agent: string; judge: string };
  repeats: number;
  measures: Measure[];
  rule: 'paired-mean-one-sided-95';
  budget: { ms: number; plan_share: number };
}
export interface ReplayRun {
  plan: string;
  task: string;
  side: 'base' | 'change';
  repeat: number;
  ok: boolean;
  metrics: Record<string, number | null>;
}
export interface ReplayResult { plan: ReplayPlan; runs: ReplayRun[] }
export interface MeasureResult { name: string; better: 'higher' | 'lower'; mean: number | null; bound: number | null; missing: string[] }
export interface TaskPair { task: string; failed: boolean; diff: Record<string, number | null> }
export interface Comparison {
  outcome: 'adopt' | 'regresses' | 'INCONCLUSIVE' | 'refused';
  reason: string;
  n: number;
  measures: MeasureResult[];
  tasks: TaskPair[];
  broke: string[];
}
export interface RuleSurface {
  planHash(plan: ReplayPlan): string;
  compareReplay(result: ReplayResult, tasks?: string[]): Comparison;
}

// In the extension (packages/config-eval/src/index.ts, @deepbuild/config-eval): the eval.
export interface ReplayTask { id: string; at: number; repo: string; commit: string; prompt: string }
export interface AgentRun { model: string; prompt: string; cwd: string; env: Record<string, string> }
export interface AgentResult { ok: boolean; result?: string; usage?: { input: number; output: number } }
export interface JudgeRequest { model: string; prompt: string; outputs: { label: string; text: string }[] }
export interface Grade { label: string; score: number }
export interface Launcher {
  work(run: AgentRun): Promise<AgentResult>;
  judge(request: JudgeRequest): Promise<Grade[]>;
  planUsed?(): Promise<number | null>;
}
export interface EvalOptions {
  plan: ReplayPlan;
  tasks: ReplayTask[];
  root: string;
  env: Record<string, string | undefined>;
  launcher?: Launcher;
}
export interface EvalReport {
  plan: ReplayPlan;
  hash: string;
  runs: ReplayRun[];
  after: Comparison;
  before: Comparison;
  held: boolean;
  usage: { ms: number; plan_share: number | null };
}
export interface EvalModule { runEval(options: EvalOptions): Promise<EvalReport> }

/** The rule's two exports, from the record's public entry; a missing one fails here, by name. */
export function rule(): RuleSurface {
  const mod = recordModule as unknown as Partial<RuleSurface>;
  expect(typeof mod.compareReplay, 'packages/record/src/index.ts exports compareReplay(result, tasks?) (README: The surface under test)').toBe('function');
  expect(typeof mod.planHash, 'packages/record/src/index.ts exports planHash(plan) (README: The surface under test)').toBe('function');
  return mod as RuleSurface;
}
const EVAL_ENTRY = new URL('../../../packages/config-eval/src/index.ts', import.meta.url);
/** The eval extension's public entry, imported only when it exists, so a missing one fails at a named assertion. */
export async function evalModule(): Promise<EvalModule> {
  const path = fileURLToPath(EVAL_ENTRY);
  const mod = existsSync(path) ? ((await import(EVAL_ENTRY.href)) as Partial<EvalModule>) : undefined;
  expect(typeof mod?.runEval, `packages/config-eval/src/index.ts exists and exports runEval(options) (README: The surface under test)${mod ? '' : '; the file does not exist'}`).toBe('function');
  return mod as EvalModule;
}

// ---- Plans and runs for the rule.
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** Monday 2026-10-05 09:00 UTC. */
export const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);
export const CUTOFF = T0 + 10 * DAY;
export const GRADE: Measure = { name: 'grade', better: 'higher' };
export const TOKENS: Measure = { name: 'tokens', better: 'lower' };
/** Words in the two instruction files: the agents read them, the judge must never see them. */
export const BASE_WORD = 'kestrel';
export const CHANGE_WORD = 'osprey';
/** The variants' names and the plan's ID: neither agent nor judge may see them. */
export const BASE_NAME = 'heron';
export const CHANGE_NAME = 'plover';
export const PLAN_ID = 'trial-0417';
export const BASE_FILES = { 'CLAUDE.md': `# Shop\n\nAnswer in the ${BASE_WORD} style: short lines, no headings.\n` };
export const CHANGE_FILES = { 'CLAUDE.md': `# Shop\n\nAnswer in the ${CHANGE_WORD} style: short lines, no headings, and name the file you changed.\n` };

export function makePlan(over: Partial<ReplayPlan> = {}): ReplayPlan {
  return {
    id: PLAN_ID,
    cutoff: CUTOFF,
    tasks: [],
    fitted: [],
    variants: { base: { name: BASE_NAME, files: { ...BASE_FILES } }, change: { name: CHANGE_NAME, files: { ...CHANGE_FILES } } },
    models: { agent: 'claude-sonnet-5-5', judge: 'gpt-reserve' },
    repeats: 3,
    measures: [GRADE],
    rule: 'paired-mean-one-sided-95',
    budget: { ms: 2 * HOUR, plan_share: 0.5 },
    ...over,
  };
}
export const ids = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);

/** One side's repeats: a value per repeat, or 'fail' when every repeat of that side failed. */
export type Side = number[] | 'fail';
export interface TaskSpec { task: string; base: Side; change: Side; tokens?: { base: (number | null)[]; change: (number | null)[] } }
/** The runs of the given tasks under `hash`, `grade` from the sides and `tokens` when given (else 1000 a run). */
export function runsOf(hash: string, specs: TaskSpec[], measures: Measure[] = [GRADE]): ReplayRun[] {
  const runs: ReplayRun[] = [];
  for (const spec of specs) {
    for (const side of ['base', 'change'] as const) {
      const values = spec[side];
      const count = values === 'fail' ? 3 : values.length;
      for (let i = 0; i < count; i++) {
        const ok = values !== 'fail';
        const metrics: Record<string, number | null> = {};
        for (const m of measures) {
          if (!ok) metrics[m.name] = null;
          else if (m.name === 'grade') metrics.grade = (values as number[])[i]!;
          else if (m.name === 'tokens') metrics.tokens = spec.tokens ? spec.tokens[side][i]! : 1000;
        }
        runs.push({ plan: hash, task: spec.task, side, repeat: i + 1, ok, metrics });
      }
    }
  }
  return runs;
}
/** A task whose every repeat reads `base` on the base side and `base + diff` on the change side. */
export const steady = (task: string, base: number, diff: number, repeats = 3): TaskSpec =>
  ({ task, base: Array(repeats).fill(base), change: Array(repeats).fill(Math.round((base + diff) * 1e9) / 1e9) });

/** The one-sided 95% t quantiles the README's formula uses, by degrees of freedom. */
export const T95: Record<number, number> = { 2: 2.919985580353726, 19: 1.729132811521367 };
/** The README's bound: mean − t(0.95, n−1) · sd / √n of the per-task differences. */
export function expectedBound(diffs: number[]): { mean: number; bound: number } {
  const n = diffs.length;
  const mean = diffs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  return { mean, bound: mean - T95[n - 1]! * sd / Math.sqrt(n) };
}
export const measureOf = (c: Comparison, name: string): MeasureResult => {
  const m = c.measures?.find((x) => x.name === name);
  expect(m, `the comparison reports the declared measure ${name} (outcome ${c.outcome}: ${c.reason})`).toBeDefined();
  return m!;
};
export const pairOf = (c: Comparison, task: string): TaskPair => {
  const p = c.tasks?.find((x) => x.task === task);
  expect(p, `the comparison reports task ${task} (outcome ${c.outcome}: ${c.reason})`).toBeDefined();
  return p!;
};
export const sorted = (xs: readonly string[]): string[] => [...xs].sort();

// ---- Temp folders, removed after each file.
const roots: string[] = [];
export function tempDir(prefix = 'dh112-'): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}
export function removeRoots(): void {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- A record world for the learned layer (as tests/acceptance/62 and 723).
export type JsonObject = { [key: string]: JsonValue };
export const utf8 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'utf8'));
export interface Clock { now(): number; tick(ms: number): number }
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastMs = -1;
let lastRandom = 0n;
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
export function ulidAt(ms: number): string {
  let random: bigint;
  if (ms === lastMs) random = lastRandom + 1n;
  else random = BigInt(`0x${randomBytes(10).toString('hex')}`) & ((1n << 79n) - 1n);
  lastMs = ms; lastRandom = random;
  return base32(BigInt(ms), 10) + base32(random, 16);
}
const YOU = { actor: 'you', scope: 'you' } as const;
export const youApp: Connection = { writer: 'app', ...YOU };
export const core: Connection = { writer: 'core', ...YOU };
const hookIn = (session: string, repo: string): Connection => ({ writer: 'hook', ...YOU, session, project: repo, agent: 'claude-code' });
export const LOCAL_FIRST = 'rule:localfirst';

export interface World { clock: Clock; store: EvidenceStore; record: RecordStore }
export async function openWorld(): Promise<World> {
  const root = tempDir('dh112-record-');
  let t = T0;
  const clock: Clock = { now: () => t, tick: (ms) => (t += ms) };
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now: clock.now });
  const record = await recordModule.openRecord({ path: join(root, 'record', 'record.sqlite'), now: clock.now, evidence: store });
  return { clock, store, record };
}
export interface Msg { id: string; text: string }
async function putBytes(w: World, text: string, kind: string): Promise<string> {
  const put = await w.store.connect({ role: 'deepbuild', via: 'capture' })
    .put({ bytes: utf8(text), kind, source: kind === 'transcript' ? 'claude-code' : 'deepbuild', redaction: 'complete', license: { name: 'own', allows: [] } });
  expect(put.status, `the evidence store stores the ${kind}`).toBe('stored');
  return (put as { evidence: Evidence }).evidence.sha256;
}
/** Starts a session in a repo, archives its transcript (your messages) and links it. Returns its ID. */
export async function startSession(w: World, repo: string, messages: readonly Msg[]): Promise<string> {
  const at = w.clock.tick(HOUR);
  const id = ulidAt(at);
  await w.record.append(hookIn(id, repo), { v: 1, id: ulidAt(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: `~/src/${repo}`, branch: 'main', thread: id } });
  const text = messages.map((m) => JSON.stringify({ type: 'user', uuid: m.id, sessionId: id, message: { role: 'user', content: m.text } })).join('\n') + '\n';
  const hash = await putBytes(w, text, 'transcript');
  const t = w.clock.tick(1);
  await w.record.append(youApp, { v: 1, id: ulidAt(t), kind: 'transcript.archived', ts: t, data: { session: `session:${id}`, evidence: hash } });
  return id;
}
export const said = (session: string, message: string): string => `session:${session}#${message}`;
/** A replay's result, as the eval stores it: the plan and every run, as JSON. Returns its `ev:` handle. */
export async function putReplay(w: World, result: ReplayResult): Promise<string> {
  return `ev:${await putBytes(w, `${JSON.stringify(result, null, 2)}\n`, 'replay')}`;
}
export interface Quote { at: string; quote: string }
export interface LearnData {
  target: string; diff: string; evidence: Quote[]; scope: string;
  replay?: { tasks: number; regressions: number } | null; supersedes?: string | null;
}
type LearnKind = 'learn.applied' | 'learn.widened' | 'learn.rolled_back';
/** Appends a learned-layer event, from the app when you apply it, from the core when a rule does; returns its ID. */
export async function learn(w: World, kind: LearnKind, d: LearnData, by: 'you' | typeof LOCAL_FIRST): Promise<string> {
  const at = w.clock.tick(60_000);
  const event: EventInput = {
    v: 1, id: ulidAt(at), kind, ts: at,
    data: { layer: 'learned', target: d.target, diff: d.diff, evidence: d.evidence.map((q) => ({ ...q })), scope: d.scope, replay: d.replay ?? null, applied_by: by, supersedes: d.supersedes ?? null },
  };
  await w.record.append(by === 'you' ? youApp : core, event);
  return event.id;
}
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
export async function layerRow(w: World, id: string): Promise<Row> {
  const rows = (await w.record.table('learned_layer')).rows.filter((r) => str(r.id) === id);
  expect(rows, `learned_layer has one row for event ${id}`).toHaveLength(1);
  return rows[0]!;
}
export async function handleOf(w: World, id: string): Promise<string> {
  const h = str((await layerRow(w, id)).handle);
  expect(h, `learned_layer row ${id} has a handle`).toMatch(/^doc:[0-9A-Za-z]+$/);
  return h;
}
/** What the session reads at its start, as one string to search. */
export async function sliceText(w: World, session: string): Promise<string> {
  const slice = await w.record.startSlice(session);
  expect(Array.isArray(slice), `startSlice(${session}) returns a list`).toBe(true);
  return JSON.stringify(slice);
}

// ---- An eval world: a fixture repo, its past tasks, and the scripted fake Launcher.
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_DATE: '2026-09-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-09-01T10:00:00Z' };
export const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=Shop Dev', '-c', 'user.email=dev@shop.test', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const SNAPSHOTS: Record<string, string>[] = [
  { 'README.md': '# shop\n\nA small shop.\n', 'CLAUDE.md': '# Shop\n\nAnswer in the plain style.\n', 'package.json': '{ "name": "shop", "private": true }\n', 'src/cart.js': 'export const total = (items) => items.reduce((s, i) => s + i.price, 0);\n' },
  { 'src/discount.js': 'export const discount = (total, pct) => total * (1 - pct / 100);\n' },
  { 'docs/notes.md': 'Prices are in cents.\n' },
  { 'src/cart.js': 'export const total = (items) => items.reduce((s, i) => s + i.price * (i.qty ?? 1), 0);\n' },
  { 'tests/cart.test.js': "import { total } from '../src/cart.js';\nconsole.log(total([{ price: 2 }]));\n" },
];
const PROMPTS = [
  'The cart total ignores discounts. Make total() apply a percent discount when one is given.',
  'Add a qty field to cart items and count it in the total.',
  'Prices are stored in cents; format the total as dollars with two decimals.',
  'The discount can go below zero for pct over 100. Clamp it.',
  'Write a test for an empty cart.',
];
export interface Repo { path: string; commits: string[] }
export function makeRepo(parent: string): Repo {
  const path = join(parent, 'repos', 'shop');
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q');
  const commits: string[] = [];
  SNAPSHOTS.forEach((files, i) => {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(path, file)), { recursive: true });
      writeFileSync(join(path, file), text);
    }
    git(path, 'add', '-A');
    git(path, 'commit', '-q', '-m', `Shop change ${i + 1}`);
    commits.push(git(path, 'rev-parse', 'HEAD').trim());
  });
  return { path, commits };
}
/** Tasks `id` at times `at`, each at one of the repo's commits, each asked in words no other task uses. */
export function makeTasks(repo: Repo, list: { id: string; at: number }[]): ReplayTask[] {
  return list.map(({ id, at }, i) => ({
    id, at, repo: repo.path, commit: repo.commits[i % repo.commits.length]!,
    prompt: `Ticket ${id.toUpperCase()}: ${PROMPTS[i % PROMPTS.length]}`,
  }));
}
/** The files a checkout of `commit` holds with `overlay` written over it: path → text. */
export function filesAt(repo: Repo, commit: string, overlay: Record<string, string>): Map<string, string> {
  const files = new Map<string, string>();
  for (const file of git(repo.path, 'ls-tree', '-r', '--name-only', commit).split('\n').filter(Boolean)) files.set(file, git(repo.path, 'show', `${commit}:${file}`));
  for (const [file, text] of Object.entries(overlay)) files.set(file, text);
  return files;
}
function walk(dir: string, base = dir, out = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(dir)) {
    if (name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.set(relative(base, full), readFileSync(full, 'utf8'));
  }
  return out;
}
const tryGit = (cwd: string, ...args: string[]): string => {
  try { return git(cwd, ...args); } catch (e) { return `(git ${args[0]} failed: ${(e as Error).message.split('\n')[0]})`; }
};

/** One repeat's script: the quality the agent's work has (the judge's score of it), and its tokens; or a failure. */
export interface Step { quality?: number; tokens?: number | null; fail?: true }
export type Script = (task: string, side: 'base' | 'change', k: number) => Step | undefined;
/** What the agent under test could see when it started. */
export interface AgentView {
  run: AgentRun; task?: string; side?: 'base' | 'change'; k?: number; nonce?: string;
  files: Map<string, string>; git: string; dotGit: string; siblings: string[];
}
export interface Fake {
  launcher: Launcher;
  views: AgentView[];
  judged: JudgeRequest[];
  /** Each output the judge saw, by the nonce the agent wrote into it. */
  outputs: Map<string, { task: string; side: 'base' | 'change'; k: number }>;
  problems: string[];
  /** Runs per task and side. */
  counts: Map<string, number>;
}
/**
 * The fake Launcher: an agent that does scripted work in its folder, and a judge that scores what it is shown.
 * With `inspect`, each agent also reads its folder's git history, refs, worktrees and config, as AC4 checks them.
 */
export function fakeLauncher(tasks: ReplayTask[], script: Script, { inspect = false } = {}): Fake {
  const fake: Fake = { launcher: undefined as unknown as Launcher, views: [], judged: [], outputs: new Map(), problems: [], counts: new Map() };
  fake.launcher = {
    async work(run: AgentRun): Promise<AgentResult> {
      const files = existsSync(run.cwd) ? walk(run.cwd) : new Map<string, string>();
      const dotGitPath = join(run.cwd, '.git');
      const dotGit = existsSync(dotGitPath) && statSync(dotGitPath).isFile() ? readFileSync(dotGitPath, 'utf8') : '';
      const gitView = !inspect ? '' : [
        tryGit(run.cwd, 'log', '--all', '--format=%H %an <%ae> %cn <%ce>%n%s%n%b'),
        tryGit(run.cwd, 'for-each-ref', '--format=%(refname)'),
        tryGit(run.cwd, 'worktree', 'list', '--porcelain'),
        tryGit(run.cwd, 'stash', 'list'),
        tryGit(run.cwd, 'config', '--local', '--list'),
      ].join('\n');
      const view: AgentView = { run: structuredClone(run), files, git: gitView, dotGit, siblings: existsSync(dirname(run.cwd)) ? readdirSync(dirname(run.cwd)) : [] };
      fake.views.push(view);
      const task = tasks.find((t) => run.prompt.includes(t.prompt));
      const md = files.get('CLAUDE.md') ?? '';
      const side = md.includes(BASE_WORD) ? 'base' : md.includes(CHANGE_WORD) ? 'change' : undefined;
      if (!task || !side) {
        fake.problems.push(`an agent started with ${task ? '' : 'a prompt naming no task'}${!task && !side ? ' and ' : ''}${side ? '' : 'neither variant\'s CLAUDE.md'} in ${run.cwd}`);
        return { ok: false };
      }
      const key = `${task.id} ${side}`;
      const k = fake.counts.get(key) ?? 0;
      fake.counts.set(key, k + 1);
      Object.assign(view, { task: task.id, side, k });
      const step = script(task.id, side, k);
      if (!step) {
        fake.problems.push(`${task.id} ran on the ${side} side more often than the plan's repeats (run ${k + 1})`);
        return { ok: false };
      }
      if (step.fail) return { ok: false };
      const nonce = randomBytes(8).toString('hex');
      view.nonce = nonce;
      fake.outputs.set(nonce, { task: task.id, side, k });
      writeFileSync(join(run.cwd, 'answer.txt'), `quality=${step.quality} nonce=${nonce}\n`);
      const result: AgentResult = { ok: true, result: `Wrote answer.txt: quality=${step.quality} nonce=${nonce}` };
      const tokens = step.tokens === undefined ? 1200 : step.tokens;
      if (tokens !== null) result.usage = { input: tokens - 200, output: 200 };
      return result;
    },
    async judge(request: JudgeRequest): Promise<Grade[]> {
      fake.judged.push(structuredClone(request));
      return request.outputs.map((o) => {
        const q = /quality=([0-9.]+)/.exec(o.text);
        if (!q || !/nonce=[0-9a-f]{16}/.test(o.text)) fake.problems.push(`the judge was shown output ${o.label} without the agent's work in it`);
        return { label: o.label, score: q ? Number(q[1]) : 0 };
      });
    },
  };
  return fake;
}
/** The plain environment the eval is given: nothing in it marks an eval. */
export function plainEnv(home: string): Record<string, string> {
  return { HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', USER: 'dev', LANG: 'en_US.UTF-8' };
}
export interface EvalWorld { dir: string; repo: Repo; home: string; root: string }
export function evalWorld(): EvalWorld {
  const dir = tempDir();
  const repo = makeRepo(dir);
  const home = join(dir, 'home');
  const root = join(dir, 'work');
  mkdirSync(home, { recursive: true });
  mkdirSync(root, { recursive: true });
  return { dir, repo, home, root };
}
/** Runs the eval on the fake, and fails on anything the fake saw go wrong. */
export async function runOnFake(w: EvalWorld, plan: ReplayPlan, tasks: ReplayTask[], script: Script, inspect = false): Promise<{ report: EvalReport; fake: Fake }> {
  const ev = await evalModule();
  const fake = fakeLauncher(tasks, script, { inspect });
  const env = plainEnv(w.home);
  const report = await ev.runEval({ plan, tasks, root: w.root, env, launcher: fake.launcher });
  expect(report && typeof report === 'object' && report.after && report.before, 'runEval resolves with a report holding after and before').toBeTruthy();
  return { report, fake };
}
/** The scripted grade of each run of a task and side, as a sorted list, from the report's runs. */
export function gradesIn(report: EvalReport, task: string, side: 'base' | 'change'): (number | null)[] {
  return report.runs.filter((r) => r.task === task && r.side === side).map((r) => r.metrics.grade ?? null).sort((a, b) => (a ?? -1) - (b ?? -1));
}

// ---- What the agent under test and the judge may see (README: Readings, AC4).
/** Anything in these marks the run as an eval to the agent: the words, the variants' names, the plan's ID or hash. */
export const agentMarks = (hash: string): RegExp => new RegExp(`eval|replay|judge|variant|bench|experiment|${BASE_NAME}|${CHANGE_NAME}|${PLAN_ID}|${hash}`, 'i');
/** A path segment's word that names a side. */
const SIDE_WORDS = new Set(['base', 'baseline', 'change', 'changed', 'control', 'treatment', 'candidate', 'before', 'after', 'side', 'arm', 'old', 'new']);
const sideWordIn = (path: string): string | undefined => path.split(/[/\-_.\s]+/).map((t) => t.toLowerCase()).find((t) => SIDE_WORDS.has(t));
/** Why an agent's start shows it is in an eval, or shows the wrong work: one line per problem. */
export function agentViewProblems(view: AgentView, tasks: ReplayTask[], plan: ReplayPlan, hash: string, repo: Repo): string[] {
  const out: string[] = [];
  const marks = agentMarks(hash);
  const task = tasks.find((t) => t.id === view.task);
  const where = `${view.task ?? '?'} ${view.side ?? '?'} run ${(view.k ?? 0) + 1}`;
  if (!task || !view.side) return [`${where}: the fake could not tell its task or variant (prompt ${JSON.stringify(view.run.prompt.slice(0, 120))})`];
  if (view.run.prompt !== task.prompt) out.push(`${where}: its prompt is not the task's own words: ${JSON.stringify(view.run.prompt.slice(0, 300))}`);
  if (view.run.model !== plan.models.agent) out.push(`${where}: it ran on ${view.run.model}, not the plan's agent model ${plan.models.agent}`);
  for (const [k, v] of Object.entries(view.run.env ?? {})) if (marks.test(k) || marks.test(String(v))) out.push(`${where}: its environment marks it: ${k}=${String(v).slice(0, 120)}`);
  if (marks.test(view.run.cwd) || sideWordIn(view.run.cwd)) out.push(`${where}: its folder's path marks it: ${view.run.cwd}`);
  for (const s of view.siblings) if (marks.test(s) || sideWordIn(s)) out.push(`${where}: a folder beside its own marks it: ${s}`);
  const m = marks.exec(view.git) ?? marks.exec(view.dotGit);
  if (m) out.push(`${where}: its git history, refs, worktrees or config mark it (${JSON.stringify(m[0])})`);
  const want = filesAt(repo, task.commit, plan.variants[view.side].files);
  const extra = [...view.files.keys()].filter((f) => !want.has(f));
  const missing = [...want.keys()].filter((f) => !view.files.has(f));
  const differ = [...want.keys()].filter((f) => view.files.has(f) && view.files.get(f) !== want.get(f));
  if (extra.length) out.push(`${where}: its folder holds files the task's commit and its variant don't: ${extra.join(', ')}`);
  if (missing.length) out.push(`${where}: its folder lacks files of the task's commit: ${missing.join(', ')}`);
  if (differ.length) out.push(`${where}: files differ from the task's commit with its variant written over it: ${differ.join(', ')}`);
  return out;
}
/** Anything in these tells the judge which side an output came from. */
export const judgeMarks = (hash: string): RegExp => new RegExp(`${BASE_WORD}|${CHANGE_WORD}|${BASE_NAME}|${CHANGE_NAME}|${PLAN_ID}|${hash}`, 'i');
const LABEL_MARKS = /base|change|before|after|control|treatment|candidate|heron|plover|kestrel|osprey/i;
/** Why the judge's requests show sides, by name, label, content or order: one line per problem. */
export function judgeViewProblems(fake: Fake, plan: ReplayPlan, hash: string): string[] {
  const out: string[] = [];
  const marks = judgeMarks(hash);
  const labelSides = new Map<string, ('base' | 'change')[]>();
  let both = 0, baseFirst = 0;
  for (const [i, req] of fake.judged.entries()) {
    if (req.model !== plan.models.judge) out.push(`judge request ${i + 1} went to ${req.model}, not the plan's judge ${plan.models.judge}`);
    const m = marks.exec(JSON.stringify(req));
    if (m) out.push(`judge request ${i + 1} names a side or the instructions it ran under (${JSON.stringify(m[0])})`);
    const labels = req.outputs.map((o) => o.label);
    if (new Set(labels).size !== labels.length) out.push(`judge request ${i + 1} gives two outputs one label`);
    const sides = req.outputs.map((o) => fake.outputs.get(/nonce=([0-9a-f]{16})/.exec(o.text)?.[1] ?? '')?.side);
    for (const [j, o] of req.outputs.entries()) {
      if (LABEL_MARKS.test(o.label)) out.push(`judge request ${i + 1} labels an output ${JSON.stringify(o.label)}`);
      const side = sides[j];
      if (side) labelSides.set(o.label, [...(labelSides.get(o.label) ?? []), side]);
    }
    if (sides.includes('base') && sides.includes('change')) {
      both++;
      if (sides[0] === 'base') baseFirst++;
    }
  }
  for (const [label, sides] of labelSides) {
    if (sides.length >= 6 && new Set(sides).size === 1) out.push(`the label ${JSON.stringify(label)} names the ${sides[0]} side every time it appears (${sides.length} times)`);
  }
  if (both >= 10 && (baseFirst / both < 0.1 || baseFirst / both > 0.9)) out.push(`the base side's output comes first in ${baseFirst} of ${both} judge requests showing both sides: the order tells the sides apart`);
  return out;
}
