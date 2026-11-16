// Test-side tools for the blind redraft of #142's criterion 10: `deep-show` built once per file and driven by JSON
// lines (#393's `deep-show run`: `deep show`, `registry`, `install_pack`, `packs`, the scenario's `packs`); the test
// pack acme/acme with its film recipe acme.slides, written at test time; the refusal reading. Nothing here stands in for
// a recipe, a rule or the check: every value a test compares comes from the binary, and every expected value from the
// issue or the design. Parts are copied from the first draft's helpers (tests/acceptance/142), since suites don't
// import each other.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/142-redraft-ac10 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

/** The criterion's ID: `#142.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC10 = 'AC10 #142.d708e2b3';

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v === 'string', `${what} is a string, got ${brief(v)}`).toBe(true);
  return v as string;
}
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether a value's JSON text holds `word` as a whole name (a cue's ID, a rule's code). */
const names = (v: JsonValue | undefined, word: string): boolean =>
  new RegExp(`(?<![A-Za-z0-9_.])${escape(word)}(?![A-Za-z0-9_])`).test(JSON.stringify(v) ?? '');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-show` with the `full` set, debug, once per file.

const SHOW = 'deep-show';
const SHOW_ARGS = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full'];

function buildShow(dir: string): { bin: string; error: string } {
  const r = spawnSync('cargo', SHOW_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return { bin: '', error: `cargo could not run: ${r.error.message}` };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { bin: '', error: `cargo ${SHOW_ARGS.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
  }
  const out = join(dir, `${SHOW}-full`);
  copyFileSync(join(TARGET, 'debug', SHOW), out);
  return { bin: out, error: '' };
}

/** `cargo build --locked --bin deep-show --no-default-features --features full`, once per file, in beforeAll. */
export function useShow(): () => string {
  let dir = '';
  let built = { bin: '', error: 'not built' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-142-ac10-bin-'));
    built = buildShow(dir);
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(built.error, `the binary builds: cargo ${SHOW_ARGS.join(' ')}`).toBe(''); return built.bin; };
}
/** Fresh folders for a test (evidence stores, packs), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-142-ac10-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

/** One `deep-show run` process: its replies, one per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  expect(timedOut, `${SHOW} run finished within its timeout`).toBe(false);
  expect(r.error?.message ?? '', `${SHOW} run started`).toBe('');
  expect(r.status, `${SHOW} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(out['ok'], `${SHOW} run refused the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${SHOW} run: replies`).map((x, i) => obj(x, `${SHOW} run: replies[${i}]`));
  expect(replies.length, `${SHOW} run: one reply per call`).toBe(arr(scenario['calls'], 'the calls').length);
  return replies;
}

/** A pack folder offered to the scenario's store (#306), or installed with `install_pack`. */
export interface Pack { id: string; version: string; dir: string }
/** The first-party verbs (#222), whose `fade_in` the slides' cues play. */
const VERBS: Pack = { id: 'deepbuild/verbs', version: '1.0.0', dir: join(REPO, 'packs', 'verbs-1.0.0') };

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: film recipes', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB142D', n);

/** A scenario: your shell's process tree, alpha's session, one panel, every document a call names, and the verbs
 * offered before the first call. */
export function scenario(evidence: string, calls: JsonObject[]): JsonObject {
  const docs: JsonObject = {};
  for (const c of calls) if (typeof c['doc'] === 'string') docs[c['doc']] = { panel: 'main' };
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 1920, 1080] } },
    docs,
    packs: [{ id: VERBS.id, dir: VERBS.dir }],
    calls,
  };
}

/** `deep show` of a whole document from your shell. */
export const present = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues'] });
/** The reply's error issues. */
export const errors = (reply: JsonObject): JsonObject[] => (Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject).filter((i) => i['severity'] === 'error');
/** The document was presented, with no error issue. */
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${brief(reply)}`).toBe('presented');
  expect(errors(reply), `${what} raises no error`).toEqual([]);
}
/** A refusal (the first draft's README: Rule codes and refusals): the document isn't presented, and an error names
 * the cue (its `id`) and the rule (its code) somewhere in its JSON. */
export function refusalFailures(reply: JsonObject, cue: string, rule: string, what: string): string[] {
  const out: string[] = [];
  if (reply['outcome'] === 'presented') out.push(`${what}: presented; a cue list that breaks ${rule} is refused`);
  if (!errors(reply).some((i) => names(i, cue) && names(i, rule))) out.push(`${what}: no error names the cue ${cue} and the rule ${rule}: ${brief(errors(reply), 2500)}`);
  return out;
}

/** Rust sources under crates/ outside tests (a `tests` or `benches` folder, and everything from a file's first
 * `#[cfg(test)]` on) that hold any of `needles`: a test pack's name in a canvas module. */
export function rustNaming(needles: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (['target', 'node_modules', 'tests', 'benches'].includes(name)) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.rs')) {
        const text = readFileSync(p, 'utf8').split('#[cfg(test)]')[0]!;
        for (const n of needles) if (text.includes(n)) found.push(`${relative(REPO, p)} names ${n}`);
      }
    }
  };
  walk(join(REPO, 'crates'));
  return found;
}

// ---------------------------------------------------------------------------------------------------
// The test pack acme/acme@1.0.0 (README: The test pack), written at test time: the film recipe and pack kind
// acme.slides@1, its rule acme.one_entrance over its cue list, a clean example and the rule's planted twin, both by hash.

export const SLIDES = 'acme.slides';
export const ACME_RULE = 'acme.one_entrance';
const ACME: Omit<Pack, 'dir'> = { id: 'acme/acme', version: '1.0.0' };
/** A cue entering one slide's title over 0.5 s by the first-party `fade_in` (an entrance), with `more` fields. */
const enter = (id: string, text: string, more: JsonObject = {}): JsonObject => ({ id, kind: 'fade_in', text, span: '0.5s', ...more });
/** Two slides one after the other: the clean twin. Every title shows no number (the base's Honest numbers check). */
export const SLIDES_CLEAN: JsonObject[] = [enter('slide_one', 'NORTH'), enter('slide_two', 'SOUTH', { when: 'after' })];
/** Two slides entering together: the planted twin of acme.one_entrance, whose later entrance is slide_two. */
export const SLIDES_OVERLAP: JsonObject[] = [enter('slide_one', 'NORTH'), enter('slide_two', 'SOUTH', { when: 'with' })];
/** A film holding one acme.slides@1 instance `deck` with `cues`, naming the test pack and the verbs. */
export function slidesFilm(title: string, cues: JsonObject[]): JsonObject {
  return {
    format: 1, profile: 'film', title, description: `${title}: a film of the film recipes acceptance suite's test pack.`, size: [640, 360],
    transport: { span: '2s' }, packs: [`${ACME.id}@${ACME.version}`, `${VERBS.id}@${VERBS.version}`],
    items: { deck: { id: 'deck', kind: `${SLIDES}@1`, name: 'Deck', order: 'a0', params: { cues } } },
  };
}
/** Writes acme/acme@1.0.0 into a folder under `root`: its manifest, its recipe and its two examples. */
export function writeSlides(root: string): Pack {
  const dir = join(root, 'acme-1.0.0');
  mkdirSync(join(dir, 'examples'), { recursive: true });
  const asset = (name: string, doc: JsonObject): { path: string; sha256: string; size: number; license: string } => {
    const bytes = Buffer.from(`${JSON.stringify(doc, null, 2)}\n`);
    writeFileSync(join(dir, 'examples', name), bytes);
    return { path: `examples/${name}`, sha256: sha256(bytes), size: bytes.length, license: 'MIT' };
  };
  const clean = asset('clean.json', slidesFilm('Slides in turn', SLIDES_CLEAN));
  const twin = asset('overlap.json', slidesFilm('Slides at once', SLIDES_OVERLAP));
  const pack = {
    name: 'acme', version: ACME.version, license: 'MIT',
    description: 'A test pack of the film recipes acceptance suite, by an outside owner: the film recipe acme.slides, a pack kind whose grammar rule is one entrance at a time.',
    requires: { core: '>=0.0.0', modules: { motion: '>=0.0.0', marks2d: '>=0.0.0' }, packs: [`verbs@${VERBS.version}`] },
    recipes: { [`${SLIDES}@1`]: `${SLIDES}@1.json` },
    kinds: {
      [`${SLIDES}@1`]: {
        minor: 0, recipe: `${SLIDES}@1`, children: [], capabilities: { pickable: false, snap: false },
        rules: [{
          code: ACME_RULE, over: 'cues', at: 'rest',
          expr: '!(cue.class == enter && other.class == enter && other.start < cue.end && cue.start < other.end)',
          fix: 'Start each entrance after the one before it has landed.',
        }],
        twins: [{ example: twin.sha256, expect: ACME_RULE }],
        migrate: {}, examples: [clean.sha256],
        cost: { class: 'figure', at_defaults: { cpu_ms: 0.5, gpu_ms: 0.2, items: 8 } },
      },
    },
    assets: [clean, twin],
  };
  const recipe = {
    id: SLIDES, version: '1.0', title: 'Slides', license: 'MIT', author: 'the film recipes acceptance suite',
    description: 'A film recipe of a test pack: one title per cue of its cue list, each on its own line.',
    inputs: {
      cues: { type: 'records', default: [], about: 'the cue list, a cues@1 list whose cues carry text' },
    },
    steps: {
      title: {
        op: 'mark', kind: 'text@1', repeat: { count: 'len(cues)', as: 'i' },
        params: { text: 'cues[i].text', font: 'body', size: 48 }, at: { pos: [64, '48 + 64 * i', 0] },
      },
    },
  };
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`);
  writeFileSync(join(dir, `${SLIDES}@1.json`), `${JSON.stringify(recipe, null, 2)}\n`);
  return { ...ACME, dir };
}
