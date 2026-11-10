// Test-side tools for the #1901 acceptance tests: `deep-show` built with the full set (#305's and #855's
// build helper), each build copied out under its own name; one canvas module's source changed for one
// build and restored byte for byte; the binary driven by JSON lines (#393's scenario and deep_show call,
// with this issue's `fingerprint`, `draw` and `padded_key` calls and `--cache` and `--planted` startup
// arguments, README); and the two comparisons the criteria's planted programs must fail, each returning
// its failures as sentences that name what failed. Nothing here stands in for the fingerprint, the
// cache, the content key or the hash.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1901 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_NAME = 'deep-show';

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
export function num(value: JsonValue | undefined, what: string): number {
  expect(Number.isInteger(value), `${what} is an integer, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export function bool(value: JsonValue | undefined, what: string): boolean {
  expect(typeof value, `${what} is a boolean, got ${JSON.stringify(value)}`).toBe('boolean');
  return value as boolean;
}
/** A content key: 128 bits in lowercase hex (Content key). */
export const KEY = /^[0-9a-f]{32}$/;
/** A digest of at least 128 bits in lowercase hex. */
export const DIGEST = /^[0-9a-f]{32,}$/;

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin deep-show --no-default-features --features full`, copied out of
// target/debug under a name per build, so a later build doesn't replace it.

/** One build may wait on cargo's lock and compile under load; it is stopped (by its own PID) after this. */
const BUILD_TIMEOUT_MS = 3_600_000;
const BUILD_ARGS = ['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', 'full'];

/** Builds deep-show from the checkout as it is now and copies the binary to `dir` as `deep-show-<name>`. */
export function buildShow(dir: string, name: string): string {
  const made = spawnSync('cargo', BUILD_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: BUILD_TIMEOUT_MS, killSignal: 'SIGKILL' });
  expect(made.error?.message, `cargo ${BUILD_ARGS.join(' ')} runs (${name})`).toBeUndefined();
  const errors = (made.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Building/.test(l)).join('\n');
  expect(made.status, `cargo ${BUILD_ARGS.join(' ')} builds ${name}:\n${errors.slice(-4000)}`).toBe(0);
  const bin = join(dir, `${SHOW_NAME}-${name}`);
  copyFileSync(join(REPO, 'target', 'debug', SHOW_NAME), bin);
  return bin;
}

// ---------------------------------------------------------------------------------------------------
// One canvas module's source, changed for one build: deep-canvas-loop (the loop canvas module, #453), in
// the full set, which only deep-show depends on, so the rebuild compiles that crate and the binary.

export const MODULE_SOURCE = 'crates/deep-canvas-loop/src/lib.rs';
const MARK = '#1901 acceptance tests: one canvas module\'s source changed';
/**
 * The change: a comment and an unnamed constant appended to the file. It changes the module's source and
 * no code path, so only a digest of the sources tells the two builds apart, never what they draw.
 */
export const SOURCE_CHANGE = `\n// ${MARK} for one build, then restored byte for byte.\nconst _: () = ();\n`;

export interface SourceState { bytes: Buffer; status: string }
/** The module source's bytes and its `git status --porcelain` line, to compare after the test. */
export function moduleSourceState(): SourceState {
  const status = spawnSync('git', ['status', '--porcelain', '--', MODULE_SOURCE], { cwd: REPO, encoding: 'utf8' });
  expect(status.status, `git status runs in the checkout: ${status.stderr}`).toBe(0);
  return { bytes: readFileSync(join(REPO, MODULE_SOURCE)), status: status.stdout };
}

/**
 * Runs `during` (a build) with SOURCE_CHANGE appended to MODULE_SOURCE, and restores the file's bytes
 * after it in every case: in a finally, and on SIGINT, SIGTERM, SIGHUP or exit while it runs (cargo is a
 * child of this process, run synchronously, so a signal waits for it and then restores before exiting).
 */
export function withModuleSourceChanged<T>(during: () => T): T {
  const path = join(REPO, MODULE_SOURCE);
  const original = readFileSync(path);
  expect(original.includes(MARK), `${MODULE_SOURCE} doesn't already hold this suite's change (an earlier run that didn't restore it; restore the file from git first)`).toBe(false);
  const restore = (): void => writeFileSync(path, original);
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const onSignal = (signal: NodeJS.Signals): void => {
    restore();
    process.exit(128 + (signal === 'SIGINT' ? 2 : signal === 'SIGTERM' ? 15 : 1));
  };
  for (const s of signals) process.on(s, onSignal);
  process.on('exit', restore);
  try {
    writeFileSync(path, Buffer.concat([original, Buffer.from(SOURCE_CHANGE)]));
    return during();
  } finally {
    restore();
    for (const s of signals) process.off(s, onSignal);
    process.off('exit', restore);
  }
}

// ---------------------------------------------------------------------------------------------------
// Running the binary: one scenario line in, one JSON line out, exit 0 (#393).

/** A fresh folder per test, deleted after it. */
export function useTemp(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1901-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** `deep-show run [args…]` on one scenario: its replies, one per call. Stopped only by its own timeout. */
export function run(bin: string, sc: JsonObject, args: string[] = []): JsonObject[] {
  const argv = ['run', ...args];
  const done = spawnSync(bin, argv, { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600_000, killSignal: 'SIGKILL' });
  const shown = `${SHOW_NAME} ${argv.join(' ')}`;
  expect(done.error?.message, `${shown} runs and finishes within its timeout`).toBeUndefined();
  expect(done.status, `${shown} exits 0; stdout: ${done.stdout.slice(0, 1000)}; stderr: ${done.stderr.slice(-2000)}`).toBe(0);
  const lines = done.stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${shown}: one output line for the one scenario line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${shown}: the answer`);
  expect(out['ok'], `${shown} accepted the scenario: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const replies = arr(out['replies'], `${shown}: replies`).map((r, i) => obj(r, `${shown}: replies[${i}]`));
  expect(replies.length, `${shown}: one reply per call`).toBe(arr(sc['calls'], 'the scenario\'s calls').length);
  return replies;
}

const SESSION = { id: 'sess-1901', thread: 'thread-1901', name: 'Claude Code: build digest', process: { pid: 4100, start: 1_000 } };
/** The one document the tests draw, in its visible panel. */
export const DOC = '01JB1901D000000000000000001';

/** A scenario (#393): one agent session, its process tree, one panel holding DOC, and the calls. */
export function scenario(evidence: string, calls: JsonObject[]): JsonObject {
  return {
    evidence,
    sessions: { [SESSION.id]: { thread: SESSION.thread, name: SESSION.name, process: SESSION.process } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }],
    panels: { p1: { rect: [0, 0, 1280, 720] } },
    docs: { [DOC]: { panel: 'p1' } },
    calls,
  };
}

/** A small 2D board: a rect, a circle and a label, as an agent sends it through deep_show. */
export const BOARD: JsonObject = {
  format: 1, profile: 'board', seed: 1901, title: 'Kept frames',
  description: 'A board drawn by a test agent through deep_show for the #1901 acceptance tests.',
  size: [1280, 720],
  items: {
    r1: { id: 'r1', kind: 'rect@1', name: 'Rect r1', order: 'a000001', params: { box: [0, 0, 240, 150], paint: { fill: { role: 'muted' } } }, at: { pos: [100, 100, 0] } },
    c1: { id: 'c1', kind: 'circle@1', name: 'Circle c1', order: 'a000002', params: { center: [600, 300], r: 80, paint: { fill: { role: 'ink' } } } },
    t1: { id: 't1', kind: 'text@1', name: 'Text t1', order: 'a000003', params: { text: 'Kept frames', font: 'body', size: 24, box: { w: 320, h: 40 } }, at: { pos: [100, 400, 0] } },
  },
};
export const SHOW: JsonObject = { call: 'deep_show', session: SESSION.id, doc: DOC, document: BOARD, include: ['issues'] };
export function presented(reply: JsonObject | undefined, what: string): void {
  expect(reply?.['outcome'], `${what} is presented: ${JSON.stringify(reply).slice(0, 1500)}`).toBe('presented');
}

// ---------------------------------------------------------------------------------------------------
// Criterion 1: the fingerprint, and what a binary reads from the cache (README: `fingerprint`, `draw`,
// `--cache`, `--planted fingerprint_without_sources`).

export const OUTPUTS = ['frame', 'capture', 'final'] as const;
export type Output = (typeof OUTPUTS)[number];
export const PLANTED_FINGERPRINT = 'fingerprint_without_sources';
export const DRAW_AT = '0.5s';

export interface Drawn { entry: string; read: boolean }
/** One process of one binary over the cache: the build its fingerprint names, and each output's entry. */
export interface Seen { binary: string; build: string | null; drawn: Record<Output, Drawn> }

/** Runs `bin` once over the cache at `cache`: presents BOARD, reads the fingerprint and draws each output at DRAW_AT. */
export function seen(binary: string, bin: string, cache: string, evidence: string, planted: boolean): Seen {
  const args = ['--cache', cache, ...(planted ? ['--planted', PLANTED_FINGERPRINT] : [])];
  const calls: JsonObject[] = [SHOW, { call: 'fingerprint' }, ...OUTPUTS.map((output): JsonObject => ({ call: 'draw', doc: DOC, t: DRAW_AT, output }))];
  const [shown, print, ...draws] = run(bin, scenario(evidence, calls), args);
  presented(shown, `${binary}: the board`);
  const fingerprint = obj(obj(print, `${binary}: the fingerprint reply`)['fingerprint'], `${binary}: fingerprint`);
  const build = fingerprint['build'] === undefined || fingerprint['build'] === null ? null : str(fingerprint['build'], `${binary}: fingerprint.build`);
  if (!planted && build !== null) expect(build, `${binary}: fingerprint.build is a digest in lowercase hex`).toMatch(DIGEST);
  const drawn = {} as Record<Output, Drawn>;
  OUTPUTS.forEach((output, i) => {
    const r = obj(draws[i], `${binary}: the ${output} reply`);
    expect(r['output'], `${binary}: the ${output} reply names its output`).toBe(output);
    const entry = str(r['entry'], `${binary}: the ${output} reply's entry`);
    expect(entry.length, `${binary}: the ${output} entry has a name`).toBeGreaterThan(0);
    drawn[output] = { entry, read: bool(r['read'], `${binary}: the ${output} reply's read`) };
  });
  return { binary, build, drawn };
}

/**
 * The criterion's comparison over one cache: `previous` drew into it first; `same`, rebuilt from the same
 * sources, must read every entry `previous` cached; `changed`, rebuilt with MODULE_SOURCE changed, must
 * read none. Each failure names the build or the cache entry.
 */
export function acrossRebuilds(previous: Seen, same: Seen, changed: Seen): string[] {
  const failures: string[] = [];
  if (previous.build === null) failures.push(`${previous.binary}'s fingerprint names no build`);
  if (same.build !== previous.build) failures.push(`${same.binary} names the build ${same.build}, not ${previous.binary}'s ${previous.build}`);
  if (changed.build === previous.build) failures.push(`${changed.binary} names ${previous.binary}'s build ${previous.build}`);
  for (const output of OUTPUTS) {
    const was = previous.drawn[output];
    if (was.read) failures.push(`${previous.binary} read the ${output} entry ${was.entry} from a cache nothing had written`);
    const again = same.drawn[output];
    if (!again.read || again.entry !== was.entry) failures.push(`${same.binary} didn't reuse the ${output} entry ${was.entry}: it ${again.read ? 'read' : 'drew'} ${again.entry}`);
    const now = changed.drawn[output];
    if (now.read) failures.push(`${changed.binary} read the ${output} entry ${now.entry}, cached by ${previous.binary}`);
  }
  return failures;
}

/** The proof line's table: each output's entry and whether each binary read it. */
export function entriesTable(runs: Seen[]): string {
  return OUTPUTS.map((o) => `${o}: ${runs.map((r) => `${r.binary} ${r.drawn[o].read ? 'read' : 'drew'} ${r.drawn[o].entry}`).join('; ')}`).join('\n');
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2: the padded fixture (README: `padded_key`, `--planted key_hashes_raw_bytes`).

export const PLANTED_RAW_KEY = 'key_hashes_raw_bytes';

export interface Padded { struct: string; size: number; padding: number[]; raw: [string, string]; keys: [string, string]; fields: number; seeds: [number, number] }

export const paddedCall = (fields: number, seeds: [number, number]): JsonObject => ({ call: 'padded_key', fields, seeds });

/** A `padded_key` reply, checked for form: the struct, its size and padding offsets, its two builds' bytes and keys. */
export function paddedOf(reply: JsonObject | undefined, fields: number, seeds: [number, number], what: string): Padded {
  const r = obj(reply, what);
  const struct = str(r['struct'], `${what}: struct`);
  expect(struct.length, `${what}: the struct has a name`).toBeGreaterThan(0);
  const size = num(r['size'], `${what}: size`);
  const padding = arr(r['padding'], `${what}: padding`).map((v, i) => num(v, `${what}: padding[${i}]`));
  expect(padding.length, `${what}: ${struct} has padding bytes`).toBeGreaterThan(0);
  expect(new Set(padding).size, `${what}: each padding offset once`).toBe(padding.length);
  for (const p of padding) expect(p >= 0 && p < size, `${what}: padding offset ${p} lies in ${struct}'s ${size} bytes`).toBe(true);
  const raw = arr(r['raw'], `${what}: raw`).map((v, i) => str(v, `${what}: raw[${i}]`));
  const keys = arr(r['keys'], `${what}: keys`).map((v, i) => str(v, `${what}: keys[${i}]`));
  expect(raw.length, `${what}: raw holds the struct's bytes as each of the two builds left them`).toBe(2);
  expect(keys.length, `${what}: keys holds the content key of each of the two builds`).toBe(2);
  for (const b of raw) expect(b, `${what}: raw is ${size} bytes in lowercase hex`).toMatch(new RegExp(`^[0-9a-f]{${2 * size}}$`));
  for (const k of keys) expect(k, `${what}: a content key is 128 bits in lowercase hex`).toMatch(KEY);
  return { struct, size, padding, raw: [raw[0]!, raw[1]!], keys: [keys[0]!, keys[1]!], fields, seeds };
}

const byteAt = (hex: string, i: number): string => hex.slice(2 * i, 2 * i + 2);
/** Offsets where two hex byte strings of one length differ. */
export function differing(a: string, b: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length / 2; i++) if (byteAt(a, i) !== byteAt(b, i)) out.push(i);
  return out;
}

/** The two builds are one value: their bytes differ only in padding, and in at least one padding byte. */
export function onlyPaddingDiffers(p: Padded): string[] {
  const at = differing(p.raw[0], p.raw[1]);
  const pad = new Set(p.padding);
  const failures: string[] = [];
  const outside = at.filter((i) => !pad.has(i));
  if (outside.length) failures.push(`${p.struct}'s two builds differ outside its padding, at bytes ${outside.join(', ')}`);
  if (!at.some((i) => pad.has(i))) failures.push(`${p.struct}'s two builds have the same padding bytes (seeds ${p.seeds.join(' and ')})`);
  return failures;
}

/** The criterion's comparison: one value built twice keys once. A failure names the struct and both keys. */
export function keyFailures(p: Padded): string[] {
  return p.keys[0] === p.keys[1] ? [] : [`${p.struct}: one value (fields ${p.fields}) built twice, its padding filled from seeds ${p.seeds[0]} and ${p.seeds[1]}, gives the content keys ${p.keys[0]} and ${p.keys[1]}`];
}
