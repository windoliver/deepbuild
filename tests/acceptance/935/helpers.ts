// Test-side tools for the #935 acceptance tests: `deep-show` built once per file and driven by one JSON scenario on
// stdin (`deep-show run`, as #499's, #500's, #1818's and #1819's suites drive it); an evidence folder per test with the
// fixtures put in it by hash; the media document audio.gen reads (its `sounds` map beside `strips` and `buses`); the
// `media_gen` call and its reply, read strictly; and how a test reads what an issue names. Nothing here stands in for
// audio.gen, a meter, a tracker or the document check: every reading and verdict is what `deep-show` answers, and the
// truth each judge holds it to comes from the fixtures (fixtures/synth.ts).

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { BED_TARGET, RATE, barSamples, sha256 } from './fixtures/synth.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** The checkout root (tests/acceptance/935 is three levels down). */
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
/** Every test passes this: a first build of deep-show on a shared Mac is long, and AC1 starts the model host. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID (scripts/proof-change.mjs: `#<issue>.<8 hex of the text's sha256>`), which starts its test's name. */
export const AC = {
  1: 'AC1 #935.dd5d077f',
  2: 'AC2 #935.1099168d',
  3: 'AC3 #935.4f2d6eac',
  4: 'AC4 #935.003bdbdb',
  5: 'AC5 #935.94f4cb46',
} as const;

/** The one planted program this suite names (README: Planted programs), selected by the scenario's `planted`. */
export type Planted = 'unpassed_on_fail_only';

/** The pinned beat tracker whose record a `music` entry's `beats` names (Analysis bake). */
export const TRACKER = 'beat-this@1.1.0';
/** 16 bars of 4/4 at 100 BPM: 1,843,200 samples, 38.400 s. */
export const REGION = 16 * barSamples(100);

// ---------------------------------------------------------------------------------------------------
// JSON

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 800)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 800)}`).toBe(true);
  return v as JsonValue[];
}
function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 800)}`).toBe('string');
  return v as string;
}

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show` once per file (honoring CARGO_TARGET_DIR), copied out of the
// target folder, with rustup's cargo on PATH; a test that needs a build that failed fails, naming it.

const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
export function useShow(): () => string {
  let dir = '';
  let error = 'not built';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-935-bin-'));
    const env = {
      ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
      ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
    };
    const run = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show'], { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo build --locked --bin deep-show failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(0, 4000)}`;
    else { error = ''; copyFileSync(join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), 'debug', 'deep-show'), join(dir, 'deep-show')); }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    expect(error, 'deep-show builds: cargo build --locked --bin deep-show').toBe('');
    return join(dir, 'deep-show');
  };
}

/** A fresh evidence folder per call, all deleted after the test. */
export function useEvidence(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => {
    const d = mkdtempSync(join(tmpdir(), 'deep-935-ev-'));
    made.push(d);
    return d;
  };
}

/** Puts `bytes` in the evidence store at their SHA-256 (`<2 hex>/<62 hex>`, as the hub keeps bytes) and returns it. */
export function putAsset(evidence: string, bytes: Uint8Array): string {
  const sha = sha256(bytes);
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}

/** `deep-show run` on one scenario line: exit 0, one line out, answered ok with one reply per call, in call order. */
export function runShow(bin: string, scenario: JsonObject, what: string): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const out = stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${what}: one output line for the one scenario line`).toBe(1);
  const answer = obj(JSON.parse(out[0]!) as JsonValue, `${what}: the answer`);
  const planted = typeof scenario['planted'] === 'string' ? `, planted ${scenario['planted']}` : '';
  expect(answer['ok'], `${what}: deep-show run answers the scenario ok (media_gen and the media document's \`sounds\`, README: The surface under test${planted}); got ${show(answer, 800)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(scenario['calls'], 'calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The media document audio.gen reads (README: The surface under test): `sounds` beside `strips` and `buses`, each
// entry's kind a sibling of its fields, every asset by its SHA-256.

export interface Music {
  kind: 'music'; asset: string; tempo: number; meter: string; loop: { start: number; end: number }; bus: string;
  beats?: string; stems?: Record<string, string>;
}
export interface Sound { kind: 'sound'; variants: { target: number; takes: string[] }[] }
export type Entry = Music | Sound;

/** A bed declared 100 BPM, 4/4, looping [0, end) on the `music` bus, with its beats record and stems when given. */
export function music(asset: string, end: number, more: { beats?: string; stems?: Record<string, string> } = {}): Music {
  return { kind: 'music', asset, tempo: 100, meter: '4/4', loop: { start: 0, end }, bus: 'music', ...more };
}
/** A sound's levels, each with its target and its takes (by hash), in order. */
export const sound = (targets: readonly number[], takes: string[][]): Sound => ({ kind: 'sound', variants: targets.map((target, i) => ({ target, takes: takes[i]! })) });

/** The buses every bed plays on: `music`, whose loudness target the beds are set to, into the master. */
export const BUSES: JsonObject = { music: { out: 'master', loudness_target: BED_TARGET }, master: {} };

/** The document `media_gen` reads: as `media_mix`'s, with the sounds beside its strips and buses. */
export const mediaDoc = (sounds: Record<string, Entry>): JsonObject => ({
  transport: { sample_rate: RATE }, strips: {}, buses: BUSES, sounds: sounds as unknown as JsonObject,
});

// ---------------------------------------------------------------------------------------------------
// `media_gen {doc, sound: ID}` → `{gen: {sound, state: PASS | FAIL | BLOCKED, readings, issues, blocked}}`, each issue
// `{code, path, actual, what}` with `path` under `sounds/<ID>` (the design's row).

export interface Issue { code: string; path: string; actual: JsonValue | undefined; what: string; raw: JsonObject }
export interface Gen { sound: string; state: string; readings: JsonValue | undefined; issues: Issue[]; blocked: JsonValue | undefined; raw: JsonObject }

/** One `media_gen` call per ID, in one scenario, on `doc`; each reply read strictly, by ID. */
export function gens(bin: string, evidence: string, doc: JsonObject, ids: string[], what: string, planted?: Planted): Record<string, Gen> {
  const calls: JsonObject[] = ids.map((sound) => ({ call: 'media_gen', doc, sound }));
  const replies = runShow(bin, { evidence, ...(planted ? { planted } : {}), calls }, what);
  return Object.fromEntries(ids.map((id, i) => {
    const w = `${what}: media_gen of sounds/${id}`;
    const g = obj(replies[i]!['gen'], `${w}: the reply's \`gen\` (${show(replies[i], 800)})`);
    expect(g['sound'], `${w}: gen.sound is the sound asked`).toBe(id);
    expect(['PASS', 'FAIL', 'BLOCKED'], `${w}: gen.state is PASS, FAIL or BLOCKED, got ${show(g['state'])}`).toContain(g['state']);
    const issues = arr(g['issues'], `${w}: gen.issues`).map((v, k) => {
      const o = obj(v, `${w}: gen.issues[${k}]`);
      const path = str(o['path'], `${w}: gen.issues[${k}].path`);
      expect(path === `sounds/${id}` || path.startsWith(`sounds/${id}/`), `${w}: gen.issues[${k}].path is under sounds/${id}, got ${path}`).toBe(true);
      return { code: str(o['code'], `${w}: gen.issues[${k}].code`), path, actual: o['actual'], what: typeof o['what'] === 'string' ? o['what'] : '', raw: o };
    });
    return [id, { sound: id, state: g['state'] as string, readings: g['readings'], issues, blocked: g['blocked'], raw: g }];
  }));
}

export const ofCode = (g: Gen, code: string): Issue[] => g.issues.filter((i) => i.code === code);

// ---------------------------------------------------------------------------------------------------
// What an issue names (README: Readings where the issue and the design leave a choice). A number is named when it
// appears in the issue's `actual` or `what` (a Unicode minus read as "-", thousands separators in `what` dropped);
// `path` and `code` are left out, so a sound's ID never names a number. A take is named by its place in the entry,
// `variants/<i>/takes/<j>`, anywhere in the issue, or, when its file is its own, by its hash.

export function numbers(issue: Issue): number[] {
  const text = `${JSON.stringify(issue.actual ?? null)} ${issue.what.replace(/(\d),(?=\d{3}(?!\d))/g, '$1')}`.replace(/−/g, '-');
  return [...text.matchAll(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g)].map((m) => Number(m[0]));
}
/** Whether the issue names a number within `tol` of `value`. */
export const namesNumber = (issue: Issue, value: number, tol: number): boolean => numbers(issue).some((n) => Math.abs(n - value) <= tol);
/** The takes an issue names by place, as `<i>/<j>`. */
export const takesNamed = (issue: Issue): Set<string> => new Set([...JSON.stringify(issue.raw).matchAll(/variants\/(\d+)\/takes\/(\d+)(?!\d)/g)].map((m) => `${m[1]}/${m[2]}`));

// ---------------------------------------------------------------------------------------------------
// The proof (the issue's Proof line), rewritten each run under $TMPDIR/deep-935-proof/.

const PROOF_DIR = join(tmpdir(), 'deep-935-proof');
export function proof(name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}
/** A reply for the proof: the state, the readings, the issues and what blocked it. */
export const forProof = (g: Gen): JsonObject => ({ state: g.state, readings: g.readings ?? null, issues: g.issues.map((i) => i.raw), blocked: g.blocked ?? null });
