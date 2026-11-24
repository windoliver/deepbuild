// Test-side tools for the #3278 acceptance tests (README). They drive `deep-show run` (#393): one scenario in on
// stdin, one answer line out, as tests/acceptance/490-redraft-2/opening.test.ts drives it. Every key read here is the
// program's own; the expected value is the issue's: two runs of the same build that read the same thing give the same
// content key for every node.

import { spawnSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (this suite is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID: `#3278.` and the first eight hex digits of the SHA-256 of its trimmed, collapsed text. */
export const AC = {
  stable: '#3278.99c4953a',
  opening: '#3278.f8a0472b',
} as const;

/** The issue's fixture and the times its criterion names. */
export const FIXTURE = 'parity/logic/readers.board';
export const TIMES = ['0s', '0.5s', '1.5s'] as const;

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 800): string => (JSON.stringify(v) ?? String(v)).slice(0, n);
/** One text per JSON value, keys sorted at every depth. */
export function canon(v: JsonValue | undefined): string {
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------------------------------
// The binary: `deep-show` (the default features are `full`, the shipped build), from DEEP_BIN_DIR when the proof run
// supplies it, else this checkout's debug build, built once per file.

// deadline: a cold debug build of deep-show on a loaded machine; the lanes supply the binary and skip it
export const BUILD_MS = 15 * 60_000;
const supplied = process.env['DEEP_BIN_DIR'];
export const SHOW_BIN = join(supplied === undefined ? join(REPO, 'target', 'debug') : resolve(supplied), 'deep-show');

export function prebuild(): void {
  beforeAll(() => {
    if (supplied === undefined) {
      const r = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (r.error || r.status !== 0) throw Error(`BLOCKED: cargo build --locked --bin deep-show failed: ${r.error?.message ?? r.stderr.slice(-3000)}`);
    }
    try {
      accessSync(SHOW_BIN, constants.X_OK);
    } catch {
      throw Error(`BLOCKED: ${SHOW_BIN} is missing or not executable`);
    }
  }, BUILD_MS);
}

const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `deep-3278-${tag}-`));
  made.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one process per call of this function.

export const DOC = '01JB327800000000000000000A';
export const YOU = { pid: 3002, start: 3_000 };
// deadline: one deep-show run of a handful of calls; minutes only when the machine is very loaded
const RUN_MS = 5 * 60_000;

/** The scenario `deep-show run` reads: one evidence folder, one panel, one document. */
export function scenario(evidence: string, calls: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    evidence, sessions: {}, processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: YOU.pid, ppid: 1, start: YOU.start }],
    panels: { main: { rect: [0, 0, 800, 600] } }, docs: { [DOC]: { panel: 'main' } }, goldens: join(evidence, 'goldens'), ...extra, calls,
  };
}

/** Runs one scenario in a new `deep-show run` process: its replies, one per call. */
export function run(sc: JsonObject): JsonObject[] {
  const calls = sc['calls'] as JsonObject[];
  const r = spawnSync(SHOW_BIN, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: RUN_MS, killSignal: 'SIGKILL' });
  if (r.error || r.status !== 0) throw Error(`BLOCKED: deep-show run exited ${r.status} (${r.error?.message ?? ''}); stdout ${r.stdout?.slice(0, 800)}; stderr ${r.stderr?.slice(-800)}`);
  const out = JSON.parse(r.stdout.split('\n').filter((l) => l !== '')[0] ?? 'null') as JsonValue;
  if (!isObject(out) || out['ok'] !== true) throw Error(`BLOCKED: deep-show run refused the scenario: ${show(out)}`);
  const replies = out['replies'] as JsonObject[];
  if (!Array.isArray(replies) || replies.length !== calls.length) throw Error(`BLOCKED: ${calls.length} calls, replies ${show(replies)}`);
  return replies;
}

/** The shipped fixture as the build's manifest lists it, with its module's record from the `fixtures` call. */
export function shippedFixture(name: string): { document: JsonObject; record: JsonValue | undefined } {
  const [manifest, fixtures] = run(scenario(tempDir('manifest'), [{ call: 'manifest' }, { call: 'fixtures' }]));
  const listed = (Array.isArray(manifest!['fixtures']) ? manifest!['fixtures'] : []).filter(isObject);
  const f = listed.find((x) => x['name'] === name);
  expect(f, `the manifest lists ${name}; it lists ${listed.map((x) => String(x['name'])).join(', ')}`).toBeDefined();
  const document = isObject(f!['document']) ? f!['document'] : {};
  const records = (Array.isArray(fixtures!['fixtures']) ? fixtures!['fixtures'] : []).filter(isObject);
  const own = records.find((r) => r['module'] === f!['module'] && canon(r['document']) === canon(document));
  return { document, record: own?.['record'] };
}

/** Per time: `operator|item` (`-` for no item) → that node's content key, from `eval` after `deep show` at the time. */
export type Keys = Record<string, Record<string, string>>;
export function keysOf(replies: JsonObject[], from: number): Keys {
  const out: Keys = {};
  TIMES.forEach((t, i) => {
    const e = replies[from + 2 * i + 1]!;
    const nodes: Record<string, string> = {};
    for (const n of (Array.isArray(e['nodes']) ? e['nodes'] : []).filter(isObject)) {
      nodes[`${String(n['operator'])}|${n['item'] === null || n['item'] === undefined ? '-' : String(n['item'])}`] = String(n['key']);
    }
    out[t] = nodes;
  });
  return out;
}

/** The calls the issue's repro makes: `deep show` of the document at each time, each followed by `eval` at it. */
export function showAndEval(document: JsonObject): JsonObject[] {
  return TIMES.flatMap((t) => [
    { call: 'deep show', peer: YOU, doc: DOC, document, include: ['issues'], size: [320, 180], t },
    { call: 'eval', doc: DOC, t },
  ]);
}
