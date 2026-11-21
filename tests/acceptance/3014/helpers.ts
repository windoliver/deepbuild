// Test-side tools for the #3014 acceptance tests: the `deep-show` binary (the full build, as suite 393 and the canvas
// kit build it) driven by one JSON scenario line per run, fresh evidence stores and the objects they hold in the
// store's `<2 hex>/<62 hex>` layout, the `fixtures` call's listing, and suite 393's writer.test.ts run as it stands.
// Nothing here stands in for the run, the hub, the fixtures call or the kit.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/3014 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_NAME = 'deep-show';
export const SHOW_BIN = join(REPO, 'target', 'debug', SHOW_NAME);
/** One run of the binary is stopped (SIGKILL, this child only) past this. */
const RUN_BOUND_MS = 300_000;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}

// ---------------------------------------------------------------------------------------------------
// The binary: the default (full) build, built once per file, as suite 393's helpers build it.

/** Builds deep-show once per file and fails every test of the file when it can't be built. */
export function useShowBinary(): void {
  let error = '';
  beforeAll(() => {
    const run = spawnSync('cargo', ['build', '--locked', '--bin', SHOW_NAME], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo build --bin ${SHOW_NAME} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished/.test(l)).join('\n')}`;
  }, 3_600_000);
  beforeEach(() => { expect(error, `the binary builds: ${SHOW_NAME}`).toBe(''); });
}

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function run(scenario: JsonObject): JsonObject[] {
  const r = spawnSync(SHOW_BIN, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: RUN_BOUND_MS, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`${SHOW_NAME} run: ${r.error.message}`);
  if (r.status !== 0) throw Error(`${SHOW_NAME} run exited ${r.status}${r.signal ? ` (${r.signal})` : ''}:\n${r.stderr.slice(-2000)}`);
  const lines = r.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((v, i) => obj(v, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(scenario['calls'], 'the scenario\'s calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// Evidence stores

/** Fresh evidence store roots, each an empty new folder; every one a test made is removed after it. */
export function useStores(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dh3014-')));
    made.push(dir);
    return dir;
  };
}

/** The objects the store holds, by hash: its `<2 hex>/<62 hex>` layout, sorted. */
export function objects(root: string): string[] {
  const out: string[] = [];
  for (const dir of readdirSync(root)) {
    if (!/^[0-9a-f]{2}$/.test(dir)) continue;
    for (const file of readdirSync(join(root, dir))) if (/^[0-9a-f]{62}$/.test(file)) out.push(dir + file);
  }
  return out.sort();
}

// ---------------------------------------------------------------------------------------------------
// The world a scenario runs in: suite 393's agent session, its process table, one panel and the documents
// the hub minted, one per call that shows one.

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: login fix', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 4100, ppid: 3001, start: 1_000 },
];
/** Document IDs the hub minted: `doc(n)`. */
export const doc = (n: number): string => `01JB3014${String(n).padStart(18, '0')}`;
export const DOCS = 64;

export interface WorldExtra { record?: JsonObject | undefined }
export function world(evidence: string, calls: JsonObject[], extra: WorldExtra = {}): JsonObject {
  const docs: JsonObject = {};
  for (let n = 1; n <= DOCS; n++) docs[doc(n)] = { panel: 'main' };
  const out: JsonObject = {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs,
    window: [800, 600],
    calls,
  };
  if (extra.record) out['record'] = extra.record;
  return out;
}

/** An agent's deep_show call: `session` null is a call bound to no session. */
export const show = (session: string | null, id: string, document: JsonObject, include: string[] = ['issues']): JsonObject =>
  ({ call: 'deep_show', session, doc: id, document, include });

/** A plain board that names no asset: three items, as suite 393's writer tests send. */
export const PLAIN: JsonObject = {
  format: 1,
  profile: 'board',
  title: 'Login fix status',
  description: 'Login fix status, drawn by a test agent through deep_show.',
  size: [320, 200],
  items: {
    'panel-back': { id: 'panel-back', kind: 'rect@1', name: 'Backdrop', order: 'a0', params: { box: [0, 0, 320, 200], paint: { fill: { role: 'ground' } } } },
    bar: { id: 'bar', kind: 'rect@1', name: 'Progress bar', order: 'a1', params: { box: [16, 120, 200, 16], paint: { fill: { role: 'muted' } } } },
    caption: { id: 'caption', kind: 'text@1', name: 'Caption', order: 'a2', params: { text: 'Ready for review', font: 'body', size: 13, box: { w: 160, h: 20 } }, at: { pos: [16, 24, 0] } },
  },
};

// ---------------------------------------------------------------------------------------------------
// The fixtures call

export interface Listed { module: string; name: string; document: JsonObject; record?: JsonObject }
export const nameOf = (f: Listed): string => `${f.module}/${f.name}`;

/** What the `fixtures` call lists, run in its own fresh store. */
export function listed(evidence: string): Listed[] {
  const [reply] = run(world(evidence, [{ call: 'fixtures' }]));
  return arr(reply!['fixtures'], 'the fixtures call: fixtures').map((v, i) => {
    const f = obj(v, `fixtures[${i}]`);
    const out: Listed = { module: str(f['module'], `fixtures[${i}].module`), name: str(f['name'], `fixtures[${i}].name`), document: obj(f['document'], `fixtures[${i}].document`) };
    if (isObject(f['record'])) out.record = f['record'];
    return out;
  });
}

/** Every SHA-256 (64 lowercase hex) a document names anywhere in its values: the assets it names by hash among them. */
export function hashesNamed(value: JsonValue): string[] {
  const out = new Set<string>();
  const walk = (v: JsonValue): void => {
    if (typeof v === 'string') { if (/^[0-9a-f]{64}$/.test(v)) out.add(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (isObject(v)) Object.values(v).forEach(walk);
  };
  walk(value);
  return [...out].sort();
}

// ---------------------------------------------------------------------------------------------------
// Suite 393's writer.test.ts, run as it stands by this checkout's Vitest

export interface FileRun { status: number | null; tests: { name: string; status: string; failure: string }[]; output: string }

/**
 * Runs `tests/acceptance/393/writer.test.ts` unchanged, from the checkout's root with its Vitest config, and reads its
 * JSON report. Vitest's own variables are taken out of the child's environment so it runs as a run of its own.
 */
export function runSuiteFile(path: string, report: string): FileRun {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(VITEST|TINYPOOL|NODE_OPTIONS$)/.test(k)) env[k] = v;
  env['NO_COLOR'] = '1';
  const r = spawnSync(process.execPath, [join(REPO, 'node_modules', 'vitest', 'vitest.mjs'), 'run', path, '--testTimeout=600000', '--reporter=json', `--outputFile=${report}`],
    { cwd: REPO, env, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 1_500_000, killSignal: 'SIGKILL' });
  const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.slice(-4000);
  if (r.error) throw Error(`vitest run ${path}: ${r.error.message}\n${output}`);
  let parsed: JsonObject;
  try {
    parsed = JSON.parse(readFileSync(report, 'utf8')) as JsonObject;
  } catch (error) {
    throw Error(`vitest run ${path} wrote no JSON report (exit ${r.status}): ${(error as Error).message}\n${output}`);
  }
  const files = arr(parsed['testResults'], 'the report\'s testResults').map((v, i) => obj(v, `testResults[${i}]`));
  const tests = files.flatMap((f) => arr(f['assertionResults'], 'assertionResults').map((v, i) => {
    const t = obj(v, `assertionResults[${i}]`);
    const failures = Array.isArray(t['failureMessages']) ? (t['failureMessages'] as JsonValue[]).map(String) : [];
    return { name: str(t['fullName'], 'fullName'), status: str(t['status'], 'status'), failure: failures.join('\n').slice(0, 1500) };
  }));
  return { status: r.status, tests, output };
}
