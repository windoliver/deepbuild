// Test-side tools for issue #874's acceptance tests (README): a world (a home, a repo that is empty or whose app already
// starts, the drafted definition the kernel is handed with its requirement's declared surface, and the drafted check),
// one claim driven through the real hub and deep-hook, and the readings the criteria name: where the check's base run
// went, the requirement's `stand_in` in the record, and the claim's verdicts. The hub, the session and the record's
// reader are #29's (tests/acceptance/29/h-d.ts), and #31's service gives the stand-in's hash, as #31's own AC15 test
// borrows them. Nothing here stands in for DeepBuild: every reading comes from the real hub, deep-hook, CLI and #31's
// service.
//
// Safety: folders under /tmp/dh874-*; HOME is the world's for every process the hub tests start; no network beyond
// 127.0.0.1, no model; processes are stopped by PID only (h-d's `cleanup` and `stopHub`), never by name or port.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';
import type { DeclaredSurface } from '../../../packages/gate/src/index.ts';
import { makeRepo as makeRepo31, openWorld as openWorld31 } from '../31/helpers.ts';
import {
  allEvents, cleanup, CLI, DEEP_HOOK, DEFAULT_RULES, failureOf, REPO, Session, SETTINGS, settle, sleep, startHub, stopHub,
  type Ev, type Hub, type World,
} from '../29/h-d.ts';

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
const sha256 = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');

// ---- The app. Its handler is `app.mjs`'s `handle(method, path)`, and `server.mjs`, its start command, serves it on $PORT.
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
/** The issue's requirement for the new route, and its declared surface (README, The surface under test). */
export const SURFACE = { kind: 'service', routes: ['/health'], format: 'json' } as const;
/** The surface as #31's service takes it: the check's ID is the requirement's check. */
export const DECLARED: DeclaredSurface = { check: CHECK, ...SURFACE, routes: [...SURFACE.routes] };
/**
 * The drafted check's bytes. `body`: GET /health answers 200 with {"status":"ok"} (AC1, AC2); `ok`: it answers 200, and
 * nothing more (AC3), which a program that does nothing also does. Where deep serves the declared surface for the run,
 * as a stand-in on a base with nothing to start, DEEP_SURFACE_URL names it and the check reaches it over HTTP. Anywhere
 * else the hub starts no stack for a check, and a check's sandbox can't listen, so the check calls the app's own handler,
 * `app.mjs`, in its folder. Before its assertions it appends what it saw to `log`: its folder, which way it went
 * (`surface` or `app`), the answer, the digest of the `app.mjs` it ran on (null where there is none) or the error.
 */
export function checkBytes(kind: 'body' | 'ok', log: string): { bytes: string; asserts: string[] } {
  const lines = [
    '#!/bin/sh',
    kind === 'body' ? '# Drafted check for R1: GET /health answers 200 with the JSON body {"status":"ok"}.' : '# Drafted check for R1: GET /health answers 200.',
    'exec node --input-type=module - <<\'JS\'',
    "import assert from 'node:assert/strict';",
    "import { createHash } from 'node:crypto';",
    "import { appendFileSync, existsSync, readFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "import { pathToFileURL } from 'node:url';",
    `const LOG = ${JSON.stringify(log)};`,
    "const app = join(process.cwd(), 'app.mjs');",
    "const seen = { cwd: process.cwd(), app: existsSync(app) ? createHash('sha256').update(readFileSync(app)).digest('hex') : null, via: null, status: null, body: null, error: null };",
    "const note = () => appendFileSync(LOG, `${JSON.stringify(seen)}\\n`);",
    'let res;',
    'try {',
    '  const url = process.env.DEEP_SURFACE_URL;',
    "  if (url) { seen.via = 'surface'; const r = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(10000) }); res = { status: r.status, body: await r.text() }; }",
    "  else { seen.via = 'app'; const { handle } = await import(pathToFileURL(app).href); const r = await handle('GET', '/health'); res = { status: r.status, body: JSON.stringify(r.body) }; }",
    '} catch (error) { seen.error = String(error?.message ?? error); note(); throw error; }',
    'seen.status = res.status; seen.body = res.body; note();',
    'assert.equal(res.status, 200);',
    ...(kind === 'body' ? ["assert.deepEqual(JSON.parse(res.body), { status: 'ok' });"] : []),
    'JS',
  ];
  const asserts = lines.flatMap((l, i) => (l.startsWith('assert.') ? [`${CHECK}:${i + 1}`] : []));
  return { bytes: `${lines.join('\n')}\n`, asserts };
}

// ---- A world.
export const ASK = 'Add a GET /health route that answers 200 with {"status":"ok"}.';
export type RepoKind = 'empty' | 'starts';
export interface World874 extends World { log: string; kind: RepoKind; asserts: string[] }
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
  const log = join(tmp, 'seen.jsonl');
  writeFileSync(log, '');
  const drafted = checkBytes(check, log);
  mkdirSync(join(repo, dirname(CHECK)), { recursive: true });
  writeFileSync(join(repo, CHECK), drafted.bytes, { mode: 0o755 });
  const drafts = join(tmp, 'drafts.json');
  writeFileSync(drafts, `${JSON.stringify({ drafts: [draft(drafted.asserts, check)] }, null, 2)}\n`);
  const work = join(tmp, 'work.json');
  writeFileSync(work, `${JSON.stringify({ readings: [] }, null, 2)}\n`);
  return { tmp, home, root, repo: realpathSync(repo), confirm, drafts, work, base, log, kind, asserts: drafted.asserts };
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
/** What a check run saw, as it appended it to the world's log (checkBytes). */
export interface Seen { cwd: string; app: string | null; via: 'surface' | 'app' | null; status: number | null; body: string | null; error: string | null }
export interface Claimed { w: World874; events: Ev[]; task: string; claim: string; seen: Seen[]; hubErr: string }

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

/**
 * Starts the hub (with DEEP_HUB_PLANT when `plant` is given), types ASK in a session, waits for its definition to lock,
 * does the agent's work, and stops: the stop is a claim, whose checks run on its snapshot and, its check being a fix
 * check, on the base. Waits until every run of the claim has finished, then reads the record and the check's log, and
 * stops the hub. A hub, lock or claim that never comes is BLOCKED, never a criterion's failure.
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
      return started.length > 0 && started.every((r) => finished.has(r)) && seenIn(w).some((n) => n.app === appDigest(w, 'base'));
    }, 120_000);
    if (!claim) throw Error(`BLOCKED: the stop made no claim for ${task} (hub stderr: ${hub.stderr().slice(-800)})`);
    // Whatever the gate appends once a run's finish is in, such as a verdict, lands within moments.
    await sleep(2000);
    const after = await allEvents(hub);
    const seen = seenIn(w);
    const head = seen.filter((n) => n.app === appDigest(w, 'head'));
    if (!head.some((n) => n.status === 200 && (check === 'ok' || n.body === '{"status":"ok"}'))) {
      throw Error(`BLOCKED: the drafted check never passed on the claim's snapshot, so no base run was due: its runs saw ${JSON.stringify(seen)} (hub stderr: ${hub.stderr().slice(-800)})`);
    }
    return { w, events: after.length >= events.length ? after : events, task: task!, claim, seen, hubErr: hub.stderr() };
  } finally {
    await stopHub(hub);
  }
}

/** The check's log: one line per run of the drafted check. */
export function seenIn(w: World874): Seen[] {
  return readFileSync(w.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Seen);
}
/** The digest of `app.mjs` on the base (null in the empty repo) or as the agent left it. */
export function appDigest(w: World874, at: 'base' | 'head'): string | null {
  if (at === 'head') return sha256(readFileSync(join(w.repo, 'app.mjs'), 'utf8'));
  return w.kind === 'empty' ? null : sha256(BASE_APP);
}
/** The runs of the drafted check on the base: the ones whose folder held the base's `app.mjs` (none, in the empty repo). */
export const baseRuns = (c: Claimed): Seen[] => c.seen.filter((n) => n.app === appDigest(c.w, 'base'));

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
