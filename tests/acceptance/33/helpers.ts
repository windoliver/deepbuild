// Helpers for #33's acceptance tests (README). The hub as a process, Claude Code's hooks through deep-hook, and the
// record's readers come from tests/acceptance/322/helpers.ts by import (same repo, same license); this file adds the
// /tmp/dh33-* worlds, a hub start that takes more test settings, the fixture corpus and its manifest, the kit
// `gate@1` and its completeness check as processes, and a player that walks a corpus case through a session.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join, relative } from 'node:path';
import type { TestContext } from 'vitest';
import {
  CLI, DEFAULT_RULES, NODE, REPO, SETTINGS, ACCOUNT, Inconclusive, Session, allEvents, childEnv, cleanup as cleanup322, decision, git, listed, must,
  own, parseObject, replyText, run, said, settle, shown, sleep, type Draft, type Ev, type Hub, type Line, type Ran, type Reading, type World,
} from '../322/helpers.ts';

export {
  CLI, NODE, REPO, Inconclusive, Session, allEvents, decision, git, listed, must, replyText, run, said, settle, shown, sleep, childEnv,
  type Draft, type Ev, type Hub, type Line, type Ran, type Reading, type World,
};
export { failureOf, lastPos, verdict, lockedFor, itemTask, claimHandles, taskVerdicts, runsOf, runOf, stopsOf, sha256, control } from '../322/helpers.ts';

// ---- Criterion IDs: `#33.<first 8 hex of SHA-256 of the criterion's text>`, trimmed and white space collapsed, as
// scripts/proof-change.mjs computes them. Every describe, test name and failure message starts with one.
export const AC1 = 'AC1 #33.bbc753b6';
export const AC2 = 'AC2 #33.816b3a75';
export const AC3 = 'AC3 #33.bccc26cc';
export const AC4 = 'AC4 #33.6932417b';
export const AC5 = 'AC5 #33.64a97658';
export const AC6 = 'AC6 #33.9d9cd1ba';
export const AC7 = 'AC7 #33.494d99ff';
export const AC8 = 'AC8 #33.9c912eb7';
export const AC9 = 'AC9 #33.c66c8922';
export const AC10 = 'AC10 #33.083bcc00';
export const AC11 = 'AC11 #33.e59fe712';
export const AC12 = 'AC12 #33.75c6e9ae';
export const AC13 = 'AC13 #33.d171ee0c';
export const AC14 = 'AC14 #33.da2366b0';

// ---- Temp folders under /tmp/dh33-* (a Unix socket path must fit in 104 bytes on macOS).
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh33-'));
  made.push(dir);
  return dir;
}
/** Stops every process this suite started (by PID, through 322's cleanup) and removes this suite's temp folders. */
export async function cleanup(): Promise<void> {
  await cleanup322();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- A world: <tmp>/h is HOME for every process, <tmp>/repo a git repository with one commit on main.
export interface WorldOptions {
  /** The repo's files at its base commit: a folder to copy (a corpus case's base/) or path → bytes. */
  tree: string | Record<string, string>;
  drafts?: Draft[];
  readings?: Reading[];
  /** Claude Code's workspace trust for the repo in ~/.claude.json; default true (a gated repo is a trusted one). */
  claudeTrust?: boolean;
  /** Ignored folders copied (cloned where the file system can) from this checkout into the repo, such as node_modules/typescript. */
  installs?: string[];
}
/** Builds a world in the shape 322's helpers read (Session, the hub's start), under /tmp/dh33-*. */
export function makeWorld(o: WorldOptions): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const repo = join(tmp, 'repo');
  mkdirSync(repo, { recursive: true });
  if (typeof o.tree === 'string') cpSync(o.tree, repo, { recursive: true });
  else for (const [path, bytes] of Object.entries(o.tree)) { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), bytes); }
  for (const path of o.installs ?? []) {
    const from = join(REPO, path);
    if (!existsSync(from)) throw Error(`BLOCKED: this checkout has no ${path} to install into the world (run npm ci once)`);
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    execFileSync('/bin/cp', ['-cR', from, join(repo, path)]);
  }
  git(tmp, repo, ['init', '-q', '-b', 'main']);
  git(tmp, repo, ['add', '-A']);
  git(tmp, repo, ['commit', '-q', '-m', 'base']);
  const base = git(tmp, repo, ['rev-parse', 'HEAD']);
  const real = realpathSync(repo);
  const claudeJson: Line = { oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'you@example.test' }, numStartups: 3 };
  if (o.claudeTrust !== false) claudeJson.projects = { [real]: { allowedTools: [], hasTrustDialogAccepted: true } };
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify(claudeJson, null, 2)}\n`);
  const drafts = join(tmp, 'drafts.json');
  writeFileSync(drafts, `${JSON.stringify({ drafts: o.drafts ?? [] }, null, 2)}\n`);
  const work = join(tmp, 'work.json');
  writeFileSync(work, `${JSON.stringify({ readings: o.readings ?? [] }, null, 2)}\n`);
  const github = join(tmp, 'github.json');
  writeFileSync(github, `${JSON.stringify({ answers: [] }, null, 2)}\n`);
  return { tmp, home, root, repo: real, confirm, drafts, work, github, base };
}

// ---- The hub as a process: `deep hub run` with the test settings 322's suite passes, a plant, a hold and any more.
export interface HubOptions { plant?: string | undefined; holdMs?: number | undefined; env?: Record<string, string | undefined> }
export async function startHub(w: World, o: HubOptions = {}): Promise<Hub> {
  const env = childEnv(w.home, {
    DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_TEST_WORK: w.work, DEEP_HUB_TEST_GITHUB: w.github,
    DEEP_HUB_PLANT: o.plant, DEEP_HUB_TEST_STOP_HOLD_MS: o.holdMs === undefined ? undefined : String(o.holdMs), ...o.env,
  });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!)); });
    }),
    exit.then(() => undefined),
    sleep(120_000).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub${o.plant ? ` with the plant DEEP_HUB_PLANT=${o.plant}` : ''} did not start: ${err.slice(-1500)}`);
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, readyAt: Date.now(), plant: o.plant, stderr: () => err };
}

// ---- Record readers this suite adds.
/** The newest task opened under the session's thread (a prompt's or a work item's). */
export function sessionTask(events: readonly Ev[], s: Session): string | undefined {
  const thread = events.find((e) => e.kind === 'session.start' && e.session === s.id && typeof e.data.thread === 'string')?.data.thread;
  const tasks = events.filter((e) => e.kind === 'task.created' && thread !== undefined && e.data.thread === thread);
  return tasks.length ? String(tasks[tasks.length - 1]!.data.task_ref) : undefined;
}
/** A verdict's words: its outcome, then all its data (reasons, requirements, the smallest failing case), as one text to search. */
export const verdictText = (v: Ev | undefined): string => (v ? `${String(v.data.outcome)} ${JSON.stringify(v.data)}` : '');
/** The verdict lines of a hook's reply (669's reading): its systemMessage and a block reason's first line. */
export function verdictLines(r: Ran): string[] {
  const out = parseObject(r.stdout.trim());
  const lines: string[] = [];
  if (typeof out?.systemMessage === 'string') lines.push(...out.systemMessage.split('\n'));
  const reason = typeof out?.reason === 'string' ? out.reason : r.code === 2 ? r.stderr : '';
  if (reason) lines.push(reason.split('\n')[0]!);
  return lines.filter((l) => /\b(PASS|FAIL|INVALID|INCONCLUSIVE|BLOCKED|sent back|checks? running)\b/.test(l));
}

// ---- The fixture corpus (README, The corpus) and the kit gate@1 (README, The kit).
export const CORPUS = join(REPO, 'packages/conformance/fixtures/gate');
export const KIT_BIN = join(REPO, 'packages/conformance/dist/bin.js');
export type Outcome = 'PASS' | 'FAIL' | 'INVALID' | 'BLOCKED' | 'INCONCLUSIVE' | 'pending';
export interface Play { commits: string[]; expected: Outcome | Outcome[]; names?: string[] }
export interface Case {
  id: string; covers: string[]; dir: string; prompt: string; stop?: string;
  drafts?: Draft[]; readings?: Reading[]; setup?: unknown;
  claim: Play; twin: Play;
}
export interface Manifest { kit: string; cases: Case[] }
export const expectedOf = (p: Play): Outcome[] => (Array.isArray(p.expected) ? p.expected : [p.expected]);

/** The corpus's manifest; a missing or unreadable one is a failure naming the file. */
export function readManifest(corpus = CORPUS): Manifest {
  const file = join(corpus, 'manifest.json');
  let m: Manifest;
  try { m = JSON.parse(readFileSync(file, 'utf8')) as Manifest; } catch (error) { throw Error(`the corpus manifest ${relative(REPO, file)} must exist and parse as JSON: ${(error as Error).message.split('\n')[0]}`); }
  must(m.kit === 'gate@1' && Array.isArray(m.cases), `the corpus manifest ${relative(REPO, file)} must say kit "gate@1" and list its cases: ${JSON.stringify(m).slice(0, 300)}`);
  return m;
}
/** The cases that cover a tag. */
export const covering = (m: Manifest, tag: string): Case[] => m.cases.filter((c) => Array.isArray(c.covers) && c.covers.includes(tag));
/** The one case that covers a tag, or a failure naming the tag. */
export function caseFor(m: Manifest, tag: string, who: string): Case {
  const found = covering(m, tag);
  must(found.length > 0, `${who} the corpus must hold a case covering ${tag}; its cases cover ${[...new Set(m.cases.flatMap((c) => c.covers ?? []))].join(', ') || 'nothing'}`);
  return found[0]!;
}
/** A case's tree at a commit folder (base, or one its commits name), path → text, .git left out. */
export function treeOf(corpus: string, c: Case, folder: string): Map<string, string> {
  const root = join(corpus, c.dir, folder);
  must(existsSync(root), `the case ${c.id} names the folder ${folder}, which ${relative(REPO, root)} doesn't hold`);
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.set(relative(root, p), readFileSync(p, 'utf8'));
    }
  };
  walk(root);
  return out;
}
/** The paths two trees differ in: added, changed or removed. */
export function changed(a: Map<string, string>, b: Map<string, string>): string[] {
  return [...new Set([...a.keys(), ...b.keys()])].filter((p) => a.get(p) !== b.get(p)).sort();
}
/** The lines of `b` that `a` doesn't hold, for a file both name (a crude line diff, enough to read what a fake added). */
export function addedLines(a: string | undefined, b: string | undefined): string[] {
  const before = new Set((a ?? '').split('\n'));
  return (b ?? '').split('\n').filter((l) => !before.has(l));
}

/** The rows of the verdict rules table: `Row` in the Lean model, each with the outcome `Row.result` sets. */
export function tableRows(): { row: string; result: string }[] {
  const lean = readFileSync(join(REPO, 'packages/verdicts/model/Verdicts/Model.lean'), 'utf8');
  const block = /inductive Row where\n((?:\s+\|\s*\w+\n)+)/.exec(lean);
  must(block !== null, 'packages/verdicts/model/Verdicts/Model.lean must declare `inductive Row where` with one `| name` per row');
  const rows = [...block![1]!.matchAll(/\|\s*(\w+)/g)].map(([, r]) => r!);
  const result = /def Row\.result : Row → Result\n([\s\S]*?)\n\n/.exec(lean);
  must(result !== null, 'packages/verdicts/model/Verdicts/Model.lean must define Row.result');
  const of = new Map<string, string>();
  // A clause can wrap: names on a line with no `=>` take the next clause's result.
  let pending: string[] = [];
  for (const line of result![1]!.split('\n')) {
    const names = [...line.split('=>')[0]!.matchAll(/\.(\w+)/g)].map(([, n]) => n!);
    const m = /=>\s*\.(\w+)/.exec(line);
    if (m) { for (const n of [...pending, ...names]) of.set(n, m[1]!); pending = []; } else pending.push(...names);
  }
  return rows.map((row) => ({ row, result: of.get(row) ?? 'unknown' }));
}

/** The known ways to fake a pass (AC11), the numeric fakes (AC12), the reporting fakes (AC14) and the failure modes (AC9), by their tag. */
export const FAKES = ['edited-expectation', 'skip-marker', 'exit-before-assertions', 'fixture-special-case', 'patched-clock', 'always-true-verify', 'overridden-equality', 'rerecorded-golden', 'swallowed-exception', 'check-runs-no-test'].map((f) => `fake:${f}`);
export const NUMERIC = ['fp16-accumulation', 'clamped-softmax', 'skipped-blocks', 'unnamed-baseline', 'warm-caches'].map((f) => `numeric:${f}`);
export const REPORTING = ['root-conftest', 'vitest-setup-outside-tests', 'rewrite-on-import', 'reads-expected-output'].map((f) => `reporting:${f}`);
export const MODES = { 'mode:hub-killed': 'INCONCLUSIVE', 'mode:disk-full': 'BLOCKED', 'mode:env-missing': 'BLOCKED', 'mode:token-expired': 'BLOCKED' } as const;

// ---- The kit and its completeness check, as processes (README, The kit).
export interface KitLine { judgement: string; id: string; play: 'claim' | 'twin'; outcome: string; reasons: string; raw: string }
export interface KitRun { ran: Ran; lines: KitLine[]; last: string }
const LINE = /^(PASS|FAIL|BLOCKED|INCONCLUSIVE) (\S+) (claim|twin): (\S+)(?: — (.*))?$/;
/** `deep-conformance gate <args>` with HOME and TMPDIR a fresh /tmp/dh33-* folder, and DEEP_HUB_PLANT when given. */
export async function kit(args: string[], o: { plant?: string; timeoutMs?: number } = {}): Promise<KitRun> {
  if (!existsSync(KIT_BIN)) throw Error(`the kit's entry ${relative(REPO, KIT_BIN)} must exist (npm run build --workspaces builds it)`);
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(home, { recursive: true });
  const ran = await run(NODE, [KIT_BIN, 'gate', ...args], { cwd: REPO, env: childEnv(home, { TMPDIR: tmp, DEEP_HUB_PLANT: o.plant }), timeoutMs: o.timeoutMs ?? 3_600_000 });
  const lines = ran.stdout.split('\n').flatMap((raw) => { const m = LINE.exec(raw.trim()); return m ? [{ judgement: m[1]!, id: m[2]!, play: m[3] as 'claim' | 'twin', outcome: m[4]!, reasons: m[5] ?? '', raw: raw.trim() }] : []; });
  const last = ran.stdout.trim().split('\n').filter(Boolean).pop() ?? '';
  return { ran, lines, last };
}
export const kitShown = (k: KitRun): string => `exit ${k.ran.code}${k.ran.timedOut ? ' (killed at the timeout)' : ''}; last line ${JSON.stringify(k.last)}; stdout ${JSON.stringify(k.ran.stdout.slice(-1500))}; stderr ${JSON.stringify(k.ran.stderr.slice(-800))}`;
/** The kit's run of these cases on the shipped gate: each case's claim and twin judged PASS, exit 0. */
export function kitPassed(who: string, k: KitRun, ids: string[]): void {
  for (const id of ids) for (const play of ['claim', 'twin'] as const) {
    const line = k.lines.find((l) => l.id === id && l.play === play);
    must(line !== undefined, `${who} the kit must print a line for ${id}'s ${play}: ${kitShown(k)}`);
    must(line!.judgement === 'PASS', `${who} on the shipped gate, ${id}'s ${play} meets its expectation: ${line!.raw}`);
    if (play === 'claim') must(line!.outcome !== 'PASS', `${who} ${id}'s claim never reaches PASS: ${line!.raw}`);
    else must(line!.outcome === 'PASS', `${who} ${id}'s clean twin PASSes: ${line!.raw}`);
  }
  must(k.ran.code === 0 && /^PASS gate@1\b/.test(k.last), `${who} the kit's run of ${ids.join(', ')} ends PASS with exit 0: ${kitShown(k)}`);
}
/** The kit on a planted gate: it fails (exit 1), naming the case, whose claim reached the outcome the plant gives. */
export function kitCaught(who: string, k: KitRun, id: string, outcome: string): void {
  const line = k.lines.find((l) => l.id === id && l.play === 'claim');
  if (k.ran.code !== 1 && k.lines.some((l) => l.judgement === 'BLOCKED')) throw Error(`BLOCKED: the kit couldn't play on the planted gate: ${kitShown(k)}`);
  must(line !== undefined, `${who} the kit must print a line for ${id}'s claim on the planted gate: ${kitShown(k)}`);
  must(line!.judgement === 'FAIL' && line!.outcome === outcome, `${who} the planted gate gives ${id}'s claim ${outcome}, so the kit's line for it reads FAIL ${id} claim: ${outcome}: ${line!.raw}`);
  must(k.ran.code === 1 && /^FAIL gate@1\b/.test(k.last), `${who} the kit fails on the planted gate, exit 1: ${kitShown(k)}`);
}

// ---- Playing a corpus case through a session (README, Playing a case).
/** The repo's files now, path → text, .git and the ignored folders left out. */
function filesNow(repo: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.set(relative(repo, p), readFileSync(p, 'utf8'));
    }
  };
  walk(repo);
  return out;
}
/** The agent makes the repo's tree equal `tree` (Write for each new or changed file, Bash rm for each removed one), then commits: an empty commit when nothing changed. */
export async function commitTree(w: World, s: Session, tree: Map<string, string>, message: string): Promise<void> {
  const now = filesNow(w.repo);
  for (const path of changed(now, tree)) {
    const full = join(w.repo, path);
    if (tree.has(path)) {
      const content = tree.get(path)!;
      const r = await s.call('Write', { file_path: full, content }, { response: { type: now.has(path) ? 'update' : 'create', filePath: full, content, structuredPatch: [] }, effect: () => { mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, content); } });
      if (!r.allowed) throw Error(`BLOCKED: the agent's Write of ${path} must be allowed: ${shown(r.before)}`);
    } else {
      const r = await s.bash(`rm ${path}`, () => unlinkSync(full));
      if (!r.allowed) throw Error(`BLOCKED: the agent's rm of ${path} must be allowed: ${shown(r.before)}`);
    }
  }
  const empty = changed(filesNow(w.repo), tree).length === 0 && git(w.tmp, w.repo, ['status', '--porcelain']) === '';
  const command = empty ? `git commit --allow-empty -q -m "${message}"` : `git add -A && git commit -q -m "${message}"`;
  const r = await s.bash(command, () => { if (!empty) git(w.tmp, w.repo, ['add', '-A']); git(w.tmp, w.repo, ['commit', '-q', ...(empty ? ['--allow-empty'] : []), '-m', message]); });
  if (!r.allowed) throw Error(`BLOCKED: the agent's commit must be allowed: ${shown(r.before)}`);
}
export interface Played { w: World; hub: Hub; s: Session; stops: Ran[]; task: string | undefined; events: Ev[]; verdict: Ev | undefined }
/**
 * A case's claim or twin walked through one session on a fresh hub: the world from base/, the prompt typed, each
 * commit folder made and committed, and a stop after each commit with the case's stop words. Reads the newest verdict
 * on the session's task once one is in (or `waitMs` passes). Only a case with no `setup` can be played so.
 */
export async function play(c: Case, which: 'claim' | 'twin', o: { corpus?: string; plant?: string; holdMs?: number; waitMs?: number; after?: Played } = {}): Promise<Played> {
  const corpus = o.corpus ?? CORPUS;
  if (c.setup !== undefined) throw Error(`BLOCKED: the case ${c.id} has a setup only the kit plays`);
  const p = which === 'claim' ? c.claim : c.twin;
  let w: World, hub: Hub, s: Session;
  if (o.after) ({ w, hub, s } = o.after);
  else {
    w = makeWorld({ tree: join(corpus, c.dir, 'base'), drafts: c.drafts ?? [], readings: c.readings ?? [] });
    hub = await startHub(w, { plant: o.plant, holdMs: o.holdMs });
    s = new Session(w);
    await s.start();
    await s.typed(c.prompt);
  }
  const stops: Ran[] = [];
  for (const [i, folder] of p.commits.entries()) {
    await commitTree(w, s, treeOf(corpus, c, folder), `${c.id} ${which} ${i + 1}`);
    stops.push(await s.stop(c.stop ?? 'Done.'));
  }
  const decided = (all: Ev[]) => { const t = sessionTask(all, s); return t !== undefined && newestVerdict(all, t, s) !== undefined; };
  const events = await settle(hub, decided, o.waitMs ?? 120_000);
  const task = sessionTask(events, s);
  return { w, hub, s, stops, task, events, verdict: task ? newestVerdict(events, task, s) : undefined };
}
/** The newest verdict.made on any claim of the task that follows the session's last stop. */
export function newestVerdict(events: readonly Ev[], task: string, s: Session): Ev | undefined {
  const stops = events.filter((e) => e.kind === 'agent.stop' && e.session === s.id);
  const since = stops.length ? stops[stops.length - 1]!.log_pos : 0;
  const claims = new Set(events.filter((e) => e.log_pos >= since && e.data?.task_ref === task).map((e) => `claim:${e.id}`));
  const verdicts = events.filter((e) => e.kind === 'verdict.made' && (claims.has(String(e.data.claim)) || claims.has(String(e.subject))));
  return verdicts[verdicts.length - 1];
}

// ---- The reference Mac (46's rule, tests/acceptance/46/helpers.ts): readings anywhere else are INCONCLUSIVE.
const REFERENCE_MACS = [{ model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 }, { model: 'Mac15,12', chip: 'Apple M3', gib: 16 }];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
export function machineProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  try {
    const model = sh('sysctl', '-n', 'hw.model');
    const chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    const gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
    const power = sh('pmset', '-g');
    const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
    if (!lpm || lpm[1] !== '0') return 'Low Power Mode is on or unknown';
    const therm = sh('pmset', '-g', 'therm');
    if (!/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  } catch (error) {
    return `cannot read the machine: ${(error as Error).message}`;
  }
  const [one] = loadavg();
  if (one! > availableParallelism()) return `heavy contention: 1-minute load ${one!.toFixed(1)} on ${availableParallelism()} cores`;
  return null;
}
export function inconclusiveOffReference(ctx: TestContext, what: string): void {
  const problem = machineProblem();
  if (!problem) return;
  console.log(`INCONCLUSIVE (${problem}): ${what}`);
  ctx.skip(`INCONCLUSIVE (${problem}): ${what}`);
}

// ---- A repo gated on a bootstrap spec alone (AC4, AC5): a hand-written .deepbuild/done.yaml that runs the repo's
// existing test and typecheck commands, committed by the repo's owner; no drafted spec, no handed definition. Each
// task takes its definition from its work item's acceptance criteria (#322's reading of work.item@1).
export const BOOTSTRAP_SPEC = [
  '# .deepbuild/done.yaml: the bootstrap, written and approved by the maintainer; the drafted spec replaces it in week 5',
  'claims:',
  '  done:',
  '    checks: [test, typecheck]',
  'checks:',
  '  test: { type: command, run: "node --test tests/price.test.ts", min_tests: 1 }',
  '  typecheck: { type: command, run: "node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json" }',
  '',
].join('\n');
/** total() starts its sum at 1: the test fails at the base, the typecheck passes. */
export const PRICE_BASE = 'export function total(cents: number[]): number {\n  return cents.reduce((sum, c) => sum + c, 1);\n}\n';
/** The fix: the test passes and the types hold. */
export const PRICE_FIXED = 'export function total(cents: number[]): number {\n  return cents.reduce((sum, c) => sum + c, 0);\n}\n';
/** The fix with a type error beside it: the test passes, the typecheck fails (TS2322). */
export const PRICE_FIXED_BAD_TYPES = 'export function total(cents: number[]): number {\n  const label: number = \'total\';\n  return cents.reduce((sum, c) => sum + c, 0);\n}\n';
export const PRICE_TEST = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { total } from '../src/price.ts';\n\ntest('total adds the cents of every item', () => {\n  assert.equal(total([100, 250]), 350);\n});\n";
export const CRITERION = 'total() returns the sum of every item\'s cents, 350 for [100, 250], where it returned 351';
export const itemLink = (n: number) => `https://work.test/acme/shop/issues/${n}`;
export const bootstrapItem = (n: number): Reading => ({
  source_id: `acme/shop#${n}`, link: itemLink(n), title: 'The cart total is off by one cent', body: `The total adds a cent.\n\n### Acceptance criteria\n- [ ] ${CRITERION}\n`,
  criteria: [CRITERION], authors: [{ handle: 'maya', role: 'owner' }], updated: '2026-11-07T09:00:00Z',
});
export function bootstrapWorld(n: number): World {
  return makeWorld({
    tree: {
      '.gitignore': 'node_modules/\n',
      'package.json': `${JSON.stringify({ name: 'shop', private: true, type: 'module', scripts: { test: 'node --test tests/price.test.ts', typecheck: 'tsc --noEmit -p tsconfig.json' } }, null, 2)}\n`,
      'tsconfig.json': `${JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'es2022', module: 'nodenext', types: [] }, include: ['src'] }, null, 2)}\n`,
      'src/price.ts': PRICE_BASE,
      'tests/price.test.ts': PRICE_TEST,
      '.deepbuild/done.yaml': BOOTSTRAP_SPEC,
    },
    readings: [bootstrapItem(n)],
    installs: ['node_modules/typescript'],
  });
}

/** The 25 spine tasks, as the `spine` label lists them on GitHub (all closed) when this suite was written (AC8). */
export const SPINE = [12, 13, 14, 15, 16, 17, 18, 22, 25, 28, 29, 30, 31, 32, 44, 47, 48, 56, 80, 83, 86, 236, 237, 303, 304];

/** Whether a path is a file of this checkout. */
export const isFile = (path: string): boolean => { try { return statSync(path).isFile(); } catch { return false; } };
