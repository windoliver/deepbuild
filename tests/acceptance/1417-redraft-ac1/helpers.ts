// Test-side tools for the #1417 redraft of its first criterion (README): `deep-show` built here and at the merge
// base with `origin/main`, driven by one `run` scenario; the 100,000-node board, generated so every run sends the
// same bytes; and reading the `over_budget` issue. Nothing here stands in for the check, the cost model or the layout.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1417-redraft-ac1 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const TIMEOUT = 1_800_000;
const SHOW = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const CARGO_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
};

export const show = (value: unknown, n = 1500): string => JSON.stringify(value)?.slice(0, n) ?? String(value);
export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object: ${show(value, 400)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array: ${show(value, 400)}`).toBe(true);
  return value as JsonValue[];
}

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin deep-show` (debug, the default `full` set), copied out under its own name.

function cargo(args: string[], root: string, env: NodeJS.ProcessEnv = {}): string {
  const r = spawnSync('cargo', args, { cwd: root, env: { ...CARGO_ENV, ...env }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status === 0) return '';
  const lines = r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating/.test(l));
  return `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(0, 4000)}`;
}
const git = (...args: string[]): string => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();

export function mergeBase(): string {
  return git('merge-base', 'HEAD', 'origin/main');
}

/** This checkout's `deep-show` (honoring CARGO_TARGET_DIR), copied to `to`; '' or cargo's error. */
function buildHere(to: string): string {
  const error = cargo(['build', '--locked', '--bin', SHOW], REPO);
  if (error === '') copyFileSync(join(process.env['CARGO_TARGET_DIR'] || join(REPO, 'target'), 'debug', exe(SHOW)), to);
  return error;
}

/**
 * The merge base's `deep-show`, copied to `to`. When HEAD is the merge base and no tracked file differs from it,
 * this checkout is the merge base and its own build is used; otherwise the merge base is exported whole by
 * `git archive` into the (git-ignored) `target/acceptance-1417-base/<sha12>` and built there into its own target.
 */
function buildBase(sha: string, to: string): string {
  if (git('rev-parse', 'HEAD') === sha && git('status', '--porcelain', '--untracked-files=no') === '') return buildHere(to);
  const dir = join(REPO, 'target', 'acceptance-1417-base', sha.slice(0, 12));
  const done = join(dir, '.exported');
  if (!existsSync(done)) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const tar = join(dir, '..', `${sha.slice(0, 12)}.tar`);
    execFileSync('git', ['archive', '--format=tar', '-o', tar, sha], { cwd: REPO });
    execFileSync('tar', ['-xf', tar, '-C', dir]);
    rmSync(tar, { force: true });
    writeFileSync(done, sha);
  }
  const error = cargo(['build', '--locked', '--bin', SHOW], dir, { CARGO_TARGET_DIR: join(dir, 'target') });
  if (error === '') copyFileSync(join(dir, 'target', 'debug', exe(SHOW)), to);
  return error;
}

/** `deep-show` built once before the file's tests, here (`'head'`) or at the merge base (`'base'`); a failed build fails the test that uses it. */
export function useShow(which: ('head' | 'base')[]): (w: 'head' | 'base') => string {
  let dir = '';
  const made = new Map<string, { bin: string; error: string; sha: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1417-show-'));
    for (const w of which) {
      const bin = join(dir, `${SHOW}-${w}`);
      const sha = w === 'base' ? mergeBase() : git('rev-parse', 'HEAD');
      made.set(w, { bin, sha, error: w === 'base' ? buildBase(sha, bin) : buildHere(bin) });
    }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (w) => {
    const m = made.get(w);
    if (!m) throw Error(`the file didn't build ${w}`);
    expect(m.error, `the binary builds: ${SHOW} at ${w} (${m.sha.slice(0, 12)})`).toBe('');
    return m.bin;
  };
}

/** A fresh evidence folder per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1417-ev-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// deep-show run: one scenario `{evidence, sessions, panels, docs, calls}`, one answer line, exit 0.

export const DOC = '01JB1417D00000000000000001';
const SESSIONS: JsonObject = { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: graph', process: { pid: 4100, start: 1000 } } };
const PANELS: JsonObject = { main: { rect: [0, 0, 1280, 720] } };

/** One `deep_show` of `document` by the agent's session, on screen in a panel, asking for its issues; its reply. */
export function deepShow(bin: string, evidence: string, document: JsonObject): JsonObject {
  const calls: JsonObject[] = [{ call: 'deep_show', session: 'sess-alpha', doc: DOC, document, include: ['issues'] }];
  const scenario = { evidence, sessions: SESSIONS, panels: PANELS, docs: { [DOC]: { panel: 'main' } }, calls };
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`${SHOW} run: ${r.error.message}`);
  expect(r.status, `${SHOW} run exits 0; stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const out = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${SHOW} run: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(out[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(answer['ok'], `${SHOW} run refused the scenario: ${show(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'run: replies');
  expect(replies.length, 'run: one reply per call').toBe(1);
  return obj(replies[0], 'the deep_show reply');
}

export function issuesOf(reply: JsonObject): JsonObject[] {
  return arr(reply['issues'], 'the reply\'s issues').map((i, k) => obj(i, `issues[${k}]`));
}

// ---------------------------------------------------------------------------------------------------
// The document (README: The document).

export const NODES = 100_000;
/** Nodes in a rank: node i's edge comes from node i - RANK, so the layered layout makes 100 ranks of 1,000. */
export const RANK = 1_000;
const pad = (i: number): string => String(i).padStart(6, '0');

/** A data-view board holding one graph@1 item of 100,000 nodes and 99,000 edges, valid at the base. */
export function bigBoard(): JsonObject {
  const nodes: JsonObject[] = [];
  const edges: JsonObject[] = [];
  for (let i = 0; i < NODES; i++) nodes.push({ id: `n${pad(i)}`, w: 8, h: 8 });
  for (let i = RANK; i < NODES; i++) edges.push({ id: `e${pad(i)}`, a: `n${pad(i - RANK)}`, b: `n${pad(i)}` });
  return {
    format: 1, profile: 'board', seed: 1417, title: 'Big graph',
    description: 'One graph of 100,000 nodes in 100 layers of 1,000, each node fed by the one above it.',
    size: [1280, 720], budget: { class: 'data_view' }, requires: { modules: { graph: '^1' } },
    items: {
      g: {
        id: 'g', kind: 'graph@1', name: 'Graph', order: 'a0',
        params: { graph: { nodes, edges }, layout: { algo: 'layered', seed: 1417 } },
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Reading the refusal (README: Assumed surfaces).

/** The operator the refusal names: graph's `layout`, by its registry key (`module.operator`, as costs.json keys it). */
export const OPERATOR = 'graph.layout';

/** Every string value at any depth of `v`. */
function stringsIn(v: JsonValue | undefined, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringsIn(x, out));
  else if (isObject(v)) Object.values(v).forEach((x) => stringsIn(x, out));
  return out;
}

/** Whether the issue names the operator: `graph.layout` inside its `what`, or as a string value in its `ids`, `path` or `actual`. */
export function namesOperator(issue: JsonObject): boolean {
  if (typeof issue['what'] === 'string' && issue['what'].includes(OPERATOR)) return true;
  return stringsIn([issue['ids'] ?? null, issue['path'] ?? null, issue['actual'] ?? null]).includes(OPERATOR);
}

/** The estimates the issue's `actual` carries: `actual` itself when a number, else its top-level finite numbers. */
export function estimatesIn(issue: JsonObject): number[] {
  const a = issue['actual'];
  if (typeof a === 'number') return Number.isFinite(a) ? [a] : [];
  if (!isObject(a)) return [];
  return Object.values(a).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}
