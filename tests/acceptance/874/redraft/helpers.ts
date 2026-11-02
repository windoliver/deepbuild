// Test-side tools for issue #874's redrafted acceptance tests (README): a world (a home, a repo that is empty or whose
// app already starts, the drafted definition the kernel is handed with its requirement's declared surface, and the
// drafted check), one claim driven through the real hub and deep-hook, and the readings the criteria name: what each
// run of the drafted check saw, from the record's run.started and run.finished; the requirement's `stand_in` in the
// record; and the claim's verdicts. The hub, the session and the record's reader are #29's (tests/acceptance/29/h-d.ts),
// and #31's service gives the stand-in's hash, as the first draft and #31's own AC15 test borrow them. Nothing here
// stands in for DeepBuild: every reading comes from the real hub, deep-hook, the CLI and #31's service.
//
// Safety: folders under /tmp/dh874-*; HOME is the world's for every process the hub tests start; no network beyond
// 127.0.0.1, no model; processes are stopped by PID only (h-d's `cleanup` and `stopHub`), never by name or port.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';
import type { DeclaredSurface } from '../../../../packages/gate/src/index.ts';
import { makeRepo as makeRepo31, openWorld as openWorld31 } from '../../31/helpers.ts';
import {
  allEvents, cleanup, CLI, DEEP_HOOK, DEFAULT_RULES, failureOf, REPO, Session, SETTINGS, settle, sleep, startHub, stopHub,
  type Ev, type Hub, type World,
} from '../../29/h-d.ts';

export { failureOf, type Ev };

// ---- The criteria's IDs: `#874.` and the first 8 hex of SHA-256 of the criterion's text, trimmed, whitespace collapsed.
export const AC1 = '#874.b1e77128';
export const AC2 = '#874.f1e74512';
export const AC3 = '#874.555fd457';

// ---- Temp folders, removed after each test with the processes h-d's cleanup stops.
const made: string[] = [];
function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh874-'));
  made.push(dir);
  return dir;
}
afterEach(async () => {
  await cleanup();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 120_000);

function git(home: string, cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  }).trim();
}

// ---- The app (the first draft's). Its handler is `app.mjs`'s `handle(method, path)`; `server.mjs`, its start command, serves it on $PORT.
export const SERVER = `import { createServer } from 'node:http';
import { handle } from './app.mjs';
createServer(async (req, res) => {
  const r = await handle(req.method, req.url);
  res.writeHead(r.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(r.body));
}).listen(Number(process.env.PORT), '127.0.0.1');
`;
export const PACKAGE = `${JSON.stringify({ name: 'shop', private: true, type: 'module', scripts: { start: 'node server.mjs' } }, null, 2)}\n`;
/** The app on the base of the repo whose app already starts: one route, `/`; anything else is 404. */
export const BASE_APP = `export function handle(method, path) {
  if (method === 'GET' && path === '/') return { status: 200, body: { shop: 'open' } };
  return { status: 404, body: { error: 'not found' } };
}
`;
/** The line the agent adds for the new route. */
export const HEALTH_LINE = "  if (method === 'GET' && path === '/health') return { status: 200, body: { status: 'ok' } };\n";
/** The app the agent writes in the empty repo: the new route alone. */
export const NEW_APP = `export function handle(method, path) {
${HEALTH_LINE}  return { status: 404, body: { error: 'not found' } };
}
`;

// ---- The drafted check. It enters through the service surface its requirement declares, `GET /health`.
export const CHECK = '.deepbuild/checks/health.sh';
/** The node:test file the check writes in its checkout and runs: where its named assertions are. */
export const TEST_FILE = '.deepbuild/checks/health.test.mjs';
/** The issue's requirement for the new route, and its declared surface (README, The surface under test). */
export const SURFACE = { kind: 'service', routes: ['/health'], format: 'json' } as const;
/** The surface as #31's service takes it: the check's ID is the requirement's check. */
export const DECLARED: DeclaredSurface = { check: CHECK, ...SURFACE, routes: [...SURFACE.routes] };
/** What a run of the check saw, as its failure message says it: `seen <json>`. */
export interface Seen { cwd?: string; via?: 'surface' | 'app'; app?: boolean; status?: number | null; body?: string | null; error?: string }
/**
 * The drafted check's bytes (README, The drafted check). `body`: GET /health answers 200 with {"status":"ok"} (AC1,
 * AC2); `ok`: it answers 200, and nothing more (AC3), which a program that does nothing also does. One shell command
 * line the command check kind can trace: `echo` writes the check's node:test file into its own checkout, and `node
 * --test` runs it, so each failure is node:test's, placed in that file. Where deep serves the declared surface for the
 * run, DEEP_SURFACE_URL names it and the test calls GET /health over HTTP; anywhere else it calls `app.mjs`'s own
 * handler in its folder. Each assertion's message, and the error when it never got an answer, is `seen` and what the
 * run saw, which the run's failures carry into run.finished's findings.
 */
export function checkBytes(kind: 'body' | 'ok'): { bytes: string; asserts: string[] } {
  // No `'`, backquote, `$(` or backslash: the lines sit in one single-quoted echo argument.
  const js = [
    'import assert from "node:assert/strict";',
    'import { existsSync } from "node:fs";',
    'import { join } from "node:path";',
    'import { test } from "node:test";',
    'import { pathToFileURL } from "node:url";',
    kind === 'body' ? 'test("R1 GET /health answers 200 with the JSON body status ok", async () => {' : 'test("R1 GET /health answers 200", async () => {',
    '  const url = process.env.DEEP_SURFACE_URL;',
    '  const app = join(process.cwd(), "app.mjs");',
    '  const seen = { cwd: process.cwd(), via: url ? "surface" : "app", app: existsSync(app), status: null, body: null };',
    '  try {',
    '    if (url) {',
    '      const r = await fetch(new URL("/health", url), { signal: AbortSignal.timeout(10000) });',
    '      seen.status = r.status;',
    '      seen.body = await r.text();',
    '    } else {',
    '      const { handle } = await import(pathToFileURL(app).href);',
    '      const r = await handle("GET", "/health");',
    '      seen.status = r.status;',
    '      seen.body = JSON.stringify(r.body);',
    '    }',
    '  } catch (error) {',
    '    throw new Error("seen " + JSON.stringify({ ...seen, error: String((error && error.message) || error) }));',
    '  }',
    '  const said = "seen " + JSON.stringify(seen);',
    '  assert.equal(seen.status, 200, said);',
    ...(kind === 'body' ? ['  assert.deepEqual(JSON.parse(seen.body), { status: "ok" }, said);'] : []),
    '});',
  ];
  const lines = [
    '#!/bin/sh',
    kind === 'body' ? '# Drafted check for R1: GET /health answers 200 with the JSON body {"status":"ok"}.' : '# Drafted check for R1: GET /health answers 200.',
    `echo '${js.join('\n')}' > ${TEST_FILE} && node --test ${TEST_FILE}`,
  ];
  const asserts = js.flatMap((l, i) => (l.trimStart().startsWith('assert.') ? [`${TEST_FILE}:${i + 1}`] : []));
  return { bytes: `${lines.join('\n')}\n`, asserts };
}

// ---- A world.
export const ASK = 'Add a GET /health route that answers 200 with {"status":"ok"}.';
export type RepoKind = 'empty' | 'starts';
export interface World874 extends World { kind: RepoKind; asserts: string[] }
/**
 * `<tmp>/h` is HOME, with the shipped default guards and your ask settings, as #29's world; `<tmp>/repo` is either an
 * empty repo (one empty root commit on main) or one whose app already starts (`package.json`'s start command,
 * `server.mjs`, `app.mjs` with `/` alone). The drafted check sits in the session's folder, uncommitted, as a drafting job
 * leaves it. `drafts.json` hands the kernel one definition for ASK: R1 with the check and its declared surface.
 */
export function makeWorld(kind: RepoKind, check: 'body' | 'ok'): World874 {
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
  git(tmp, repo, ['init', '-q', '-b', 'main']);
  if (kind === 'starts') {
    writeFileSync(join(repo, 'package.json'), PACKAGE);
    writeFileSync(join(repo, 'server.mjs'), SERVER);
    writeFileSync(join(repo, 'app.mjs'), BASE_APP);
    git(tmp, repo, ['add', '-A']);
  }
  git(tmp, repo, ['commit', '-q', '--allow-empty', '-m', 'base']);
  const base = git(tmp, repo, ['rev-parse', 'HEAD']);
  const drafted = checkBytes(check);
  mkdirSync(join(repo, dirname(CHECK)), { recursive: true });
  writeFileSync(join(repo, CHECK), drafted.bytes, { mode: 0o755 });
  const drafts = join(tmp, 'drafts.json');
  writeFileSync(drafts, `${JSON.stringify({ drafts: [draft(drafted.asserts, check)] }, null, 2)}\n`);
  const work = join(tmp, 'work.json');
  writeFileSync(work, `${JSON.stringify({ readings: [] }, null, 2)}\n`);
  return { tmp, home, root, repo: realpathSync(repo), confirm, drafts, work, base, kind, asserts: drafted.asserts };
}
/** The definition handed for ASK: R1, its check and the surface it declares (README, The surface under test). */
export function draft(asserts: string[], check: 'body' | 'ok'): Record<string, unknown> {
  return {
    ask: ASK,
    requirements: [{
      id: 'R1', text: check === 'body' ? 'GET /health answers 200 with {"status":"ok"}' : 'GET /health answers 200', source_line: 'ask#L1',
      refuted_by: 'a GET /health that answers anything else', check: CHECK, on_base: 'fails', asserts, depth: 'api', oracle: 'code', near_misses: [],
      surface: SURFACE,
    }],
    deliverables: ['app.mjs'], budget: null,
  };
}

// ---- One claim through the real hub.
/** One run of the drafted check, from the record: its run.started and run.finished, and what its failures say it saw. */
export interface CheckRun { run: string; commit: string; started: Ev; finished: Ev | undefined; outcome: string | null; findings: string[]; seen: Seen[] }
export interface Claimed { w: World874; events: Ev[]; task: string; claim: string; runs: CheckRun[]; hubErr: string }

/** The agent's work: in the empty repo it writes the app with the new route; where the app starts it adds the route. */
async function work(s: Session, w: World874): Promise<void> {
  const write = async (file: string, content: string): Promise<void> => {
    const path = join(w.repo, file);
    const r = await s.call('Write', { file_path: path, content }, {
      response: { type: 'create', filePath: path, content, structuredPatch: [], originalFile: null },
      effect: () => writeFileSync(path, content),
    });
    if (!r.allowed) throw Error(`BLOCKED: the Write of ${file} must be allowed`);
  };
  if (w.kind === 'empty') {
    await write('package.json', PACKAGE);
    await write('server.mjs', SERVER);
    await write('app.mjs', NEW_APP);
  } else {
    await s.read('app.mjs');
    await s.edit('app.mjs', "  return { status: 404", `${HEALTH_LINE}  return { status: 404`);
  }
}

/** What a finding's message says the run saw: each `seen <json>` in it, one line (node's assert may add its diff below). */
export function seenIn(findings: string[]): Seen[] {
  return findings.flatMap((f) => {
    const at = f.indexOf('seen {');
    if (at < 0) return [];
    try { return [JSON.parse(f.slice(at + 5).split('\n')[0]!) as Seen]; } catch { return []; }
  });
}
/** Every run of the drafted check in the record, oldest first: each run.started for CHECK with its run.finished. */
export function checkRuns(events: Ev[]): CheckRun[] {
  const finished = new Map(events.filter((e) => e.kind === 'run.finished').map((e) => [String(e.data.run), e]));
  return events.filter((e) => e.kind === 'run.started' && e.data.check === CHECK).map((started) => {
    const run = String(started.data.run);
    const end = finished.get(run);
    const findings = Array.isArray(end?.data.findings) ? (end!.data.findings as unknown[]).map(String) : [];
    return { run, commit: String(started.data.commit), started, finished: end, outcome: end ? String(end.data.outcome) : null, findings, seen: seenIn(findings) };
  });
}
/** The runs of the drafted check on the base: those whose run.started names the base commit. */
export const baseRuns = (c: Claimed): CheckRun[] => c.runs.filter((r) => r.commit === c.w.base);
/** A run in one line, for failure messages. */
export const shownRun = (r: CheckRun): string => `${r.run} on ${r.commit === '' ? '?' : r.commit.slice(0, 12)}: ${r.outcome ?? 'unfinished'}, points_to ${String(r.finished?.data.points_to ?? null)}, findings ${JSON.stringify(r.findings).slice(0, 1200)}`;

/**
 * Starts the hub (with DEEP_HUB_PLANT when `plant` is given), types ASK in a session, waits for its definition to lock,
 * does the agent's work, and stops: the stop is a claim, whose check runs on its snapshot and, a fix check, on the base.
 * Waits until the claim has a verdict and every run of it has finished, then reads the record and stops the hub. A
 * hub, lock or claim that never comes, or a drafted check that never passes on the claim's snapshot, is BLOCKED, never
 * a criterion's failure.
 */
export async function claimThroughHub(kind: RepoKind, check: 'body' | 'ok', plant?: string): Promise<Claimed> {
  for (const [what, path] of [['the deep CLI (npm run build --workspaces)', CLI], ['deep-hook (cargo build -p deep-hook)', DEEP_HOOK]] as const) {
    if (!existsSync(path)) throw Error(`BLOCKED: ${what} is not built at ${path}`);
  }
  const w = makeWorld(kind, check);
  const hub: Hub = await startHub(w, plant ? { plant } : {});
  try {
    const s = new Session(w);
    await s.start();
    await s.typed(ASK);
    let task: string | undefined;
    const opened = await settle(hub, (e) => {
      const ask = e.find((x) => x.kind === 'user.ask' && x.session === s.id && x.data.text === ASK);
      task = Array.isArray(ask?.data.tasks) && ask!.data.tasks.length === 1 ? String(ask!.data.tasks[0]) : undefined;
      return task !== undefined && e.some((x) => x.kind === 'definition.locked' && x.data.task_ref === task);
    }, 60_000);
    const locked = opened.some((x) => x.kind === 'definition.locked' && x.data.task_ref === task);
    if (!task || !locked) {
      const asked = opened.filter((x) => x.kind === 'user.ask' || x.kind === 'task.created').map((x) => `${x.kind} ${JSON.stringify(x.data).slice(0, 300)}`);
      const hooks = s.hooks.map((h) => `${h.event} exit ${String(h.ran.code)} ${h.ran.stdout.slice(0, 200)} ${h.ran.stderr.slice(0, 200)}`);
      throw Error(`BLOCKED: the prompt's task ${task ?? '(none)'} never had its definition locked: ${asked.join('; ') || `no user.ask or task.created among ${opened.length} events (${[...new Set(opened.map((x) => x.kind))].join(', ')})`}; hooks: ${hooks.join(' | ')} (hub stderr: ${hub.stderr().slice(-800)})`);
    }
    await s.read(CHECK);
    await work(s, w);
    await s.stop('Done.');
    let claim: string | undefined;
    const events = await settle(hub, (e) => {
      const made = e.find((x) => x.kind === 'claim.made' && x.data.task_ref === task);
      claim = made ? `claim:${made.id}` : undefined;
      if (!claim) return false;
      const started = e.filter((x) => x.kind === 'run.started' && x.data.claim === claim).map((x) => String(x.data.run));
      const finished = new Set(e.filter((x) => x.kind === 'run.finished').map((x) => String(x.data.run)));
      const verdict = e.some((x) => x.kind === 'verdict.made' && (x.subject === claim || x.data.claim === claim));
      return verdict && started.length > 0 && started.every((r) => finished.has(r));
    }, 180_000);
    if (!claim) {
      const stop = s.hooks.filter((h) => h.event === 'Stop').map((h) => `exit ${String(h.ran.code)} ${h.ran.stdout.slice(0, 300)} ${h.ran.stderr.slice(0, 300)}`);
      throw Error(`BLOCKED: the stop made no claim for ${task}; its Stop hook: ${stop.join(' | ')} (hub stderr: ${hub.stderr().slice(-800)})`);
    }
    // Whatever the gate appends once a run's finish is in, such as a later verdict, lands within moments.
    await sleep(2000);
    const after = await allEvents(hub);
    const all = after.length >= events.length ? after : events;
    const runs = checkRuns(all);
    const head = runs.filter((r) => r.started.data.claim === claim && r.commit !== w.base);
    if (!head.some((r) => r.outcome === 'passed')) {
      throw Error(`BLOCKED: the drafted check never passed on the claim's snapshot, so no base run was due: its runs were ${runs.map(shownRun).join(' | ') || 'none'} (hub stderr: ${hub.stderr().slice(-800)})`);
    }
    return { w, events: all, task: task!, claim, runs, hubErr: hub.stderr() };
  } finally {
    await stopHub(hub);
  }
}

/**
 * The requirement's `stand_in` as the record holds it: R1 in the newest `definition.*` event of the task whose R1
 * carries one; undefined when none does.
 */
export function standInOf(c: Claimed): { surface?: Record<string, unknown>; hash?: string } | undefined {
  const defs = c.events.filter((e) => e.kind.startsWith('definition.') && e.data.task_ref === c.task);
  for (const e of [...defs].reverse()) {
    const r = (Array.isArray(e.data.requirements) ? e.data.requirements : []).find((x: { id?: string }) => x.id === 'R1');
    if (r?.stand_in !== undefined && r.stand_in !== null) return r.stand_in as { surface?: Record<string, unknown>; hash?: string };
  }
  return undefined;
}
/** The task's definition events in one line each, for failure messages. */
export const definitionsOf = (c: Claimed): string => c.events.filter((e) => e.kind.startsWith('definition.') && e.data.task_ref === c.task).map((e) => `${e.kind} ${JSON.stringify(e.data.requirements)}`).join('; ').slice(0, 1500);
/** The claim's verdicts, in log order. */
export const verdictsOf = (c: Claimed): Ev[] => c.events.filter((e) => e.kind === 'verdict.made' && (e.subject === c.claim || e.data.claim === c.claim));

// ---- #31's service: the hash it returns for the stand-in of this surface on a base with nothing to start.
let hash31: string | undefined;
export async function standInHash31(): Promise<string> {
  if (hash31) return hash31;
  const world = await openWorld31();
  try {
    const service = await world.service();
    const c = await service.baseCheckout({ worktree: makeRepo31(), onto: 'main', claim: 'HEAD', own: [], surfaces: [DECLARED], runs: ['run:874'] });
    const s = c.standIns.find((x) => x.check === CHECK);
    await service.ended(c, 'run:874');
    if (!s) throw Error(`BLOCKED: #31's service built no stand-in for ${JSON.stringify(DECLARED)} in an empty repo`);
    hash31 = s.hash;
    return s.hash;
  } finally {
    await world.close();
  }
}

/** A planted wrong program's run of a criterion's judgement must fail, naming each of `names`. */
export async function mustFail(plant: string, judge: () => unknown, names: string[]): Promise<string> {
  const message = await failureOf(judge);
  if (message === null) throw Error(`${plant}: the planted wrong program passed the judgement, so it proves nothing`);
  for (const n of names) if (!message.includes(n)) throw Error(`${plant}: the judgement failed, but its failure must name ${n}: ${message}`);
  return message;
}

export { REPO };
