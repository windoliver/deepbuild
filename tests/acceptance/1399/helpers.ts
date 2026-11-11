// Test-side tools for the #1399 acceptance tests: `deep-show` (built with `--no-default-features --features full`)
// and `deep-gpu` (built as it ships), each driven by one scenario line on stdin as #306's, #403's, #407's and #380's
// suites drive them; the packs, film and PNG frames these tests write at test time; and readers for the fields this
// suite reads (README: The surface under test). Nothing here stands in for the seam suite, the kind kit, the flicker
// check, the golden comparison or the relay client: every result a test judges is a binary's. Helper code is copied
// from tests/acceptance/202, 407 and 380, never imported across suites. Node built-ins and vitest only.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1399 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${show(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${show(value)}`).toBe(true);
  return value as JsonValue[];
}
export const show = (v: JsonValue | undefined, max = 1500): string => JSON.stringify(v)?.slice(0, max) ?? 'undefined';

/** Every value in `v`, deep, leaving out an issue's prose (`what`, `fix`): what the issue names as data. */
export function named(v: JsonValue | undefined): JsonValue[] {
  if (Array.isArray(v)) return [v, ...v.flatMap(named)];
  if (isObject(v)) return [v, ...Object.entries(v).filter(([k]) => k !== 'what' && k !== 'fix').flatMap(([, x]) => named(x))];
  return v === undefined ? [] : [v];
}
/** Whether `v` names `value` as data: a string equal to it, or an array or object deep-equal to it. */
export const names = (v: JsonValue | undefined, value: JsonValue): boolean =>
  named(v).some((x) => JSON.stringify(x) === JSON.stringify(value));

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file in the checkout, copied out of target/debug.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
/** Builds stay light on the shared Mac: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };

/** `deep-show` with every canvas module (`full`), and `deep-gpu` as it ships. */
export type Binary = 'deep-show' | 'deep-gpu';
const ARGS: Record<Binary, string[]> = {
  'deep-show': ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'],
  'deep-gpu': ['build', '--locked', '--bin', 'deep-gpu'],
};

function build(binary: Binary, to: string): string {
  const args = ARGS[binary];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  const target = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
  copyFileSync(join(target, 'debug', exe(binary)), to);
  return '';
}

/** Builds `binary` before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBinary(binary: Binary): () => string {
  let dir = '';
  let made = { bin: '', error: 'not built' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1399-bin-'));
    const bin = join(dir, exe(binary));
    made = { bin, error: build(binary, bin) };
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(made.error, `the binary builds: cargo ${ARGS[binary].join(' ')}`).toBe('');
    return made.bin;
  };
}

/** A fresh temporary folder per test (evidence store, packs, frames, golden store), deleted after it. */
export function useTemp(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1399-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** A new folder `name` in `root`. */
export function sub(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------------------------------
// Running a scenario: one JSON line in, one JSON line `{ok: true, replies}` out, exit 0.

function answer(bin: string, args: string[], line: JsonObject, calls: number): JsonObject[] {
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify(line)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const name = `${bin.split('/').pop()} ${args.join(' ')}`;
  if (r.error && (r.error as NodeJS.ErrnoException).code !== 'ETIMEDOUT') throw Error(`${name}: ${r.error.message}`);
  expect(r.error, `${name} finished within its timeout`).toBeUndefined();
  expect(r.status, `${name} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  expect(out['ok'], `${name} refused the scenario: ${show(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${name}: replies`).map((x, i) => obj(x, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls);
  return replies;
}

/** `deep-show run`: the scenario's replies, one per call. */
export function runShow(bin: string, scenario: JsonObject): JsonObject[] {
  return answer(bin, ['run'], scenario, arr(scenario['calls'], 'the scenario\'s calls').length);
}
/** `deep-gpu run --backend noop`: the replies to `calls`, with `out` as the run's output folder. */
export function runGpu(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  return answer(bin, ['run', '--backend', 'noop'], { out, calls }, calls.length);
}

// ---------------------------------------------------------------------------------------------------
// Packs (README: Fixtures): acme/shelf, the kind shelf.bookcase@1 backed by its recipe, written at test time.

export const KIND = 'shelf.bookcase@1';
const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
const text = (v: JsonValue): string => `${JSON.stringify(v, null, 2)}\n`;
const rect = (box: JsonValue[], pos: JsonValue[], count: JsonValue): JsonObject =>
  ({ op: 'mark', kind: 'rect@1', repeat: { count, as: 'i' }, params: { box, paint: { fill: { role: 'muted' } } }, at: { pos } });

/** The bookcase recipe: a front view at 100 u a metre, two sides, one board per level and the dividers, each a rect@1. */
function recipe(extraInputs: JsonObject): JsonObject {
  return {
    id: 'shelf.bookcase', version: '1.0', title: 'Bookcase', license: 'MIT', author: 'the #1399 acceptance suite',
    description: 'A bookcase drawn from the front at 100 u a metre: two sides, one board per level 40 u apart, and the dividers between its bays, each a 2D rect.',
    inputs: {
      width: { type: 'number', unit: 'm', default: 1.2, min: 0.4, max: 3, about: 'the outside width, in metres' },
      levels: { type: 'integer', default: 4, min: 1, max: 8, about: 'how many boards, one per level, 0.4 m apart' },
      dividers: { type: 'integer', default: 1, min: 0, max: 3, about: 'how many upright dividers split the width into bays' },
      ...extraInputs,
    },
    steps: {
      sides: rect([0, 0, 2, 'levels * 40'], ['i * (width * 100 - 2)', 0, 0], 2),
      boards: rect([0, 0, 'width * 100', 2], [0, '(i + 1) * 40 - 2', 0], 'levels'),
      dividers: rect([0, 0, 2, 'levels * 40'], ['(i + 1) * width * 100 / (dividers + 1) - 1', 0, 0], 'dividers'),
    },
    outputs: { parts: ['sides', 'boards', 'dividers'] },
  };
}

/** One version of acme/shelf. */
export interface ShelfPack { id: string; version: string; dir: string }
export const packAt = (p: ShelfPack): string => `${p.id}@${p.version}`;

/**
 * Writes acme/shelf@`version` into `root`: the kind shelf.bookcase@1 backed by the bookcase recipe, with the recipe's
 * `extraInputs` beside width, levels and dividers, the kind's `extraFields` beside its own, and one example, the kind at
 * its defaults. It declares no rule.
 */
export function writeShelf(root: string, version: string, o: { extraInputs?: JsonObject; extraFields?: JsonObject } = {}): ShelfPack {
  const id = 'acme/shelf';
  const dir = join(root, `shelf-${version}`);
  mkdirSync(join(dir, 'examples'), { recursive: true });
  const example = text({
    format: 1, profile: 'board', title: 'A bookcase at its defaults',
    description: `A bookcase at its defaults: one ${KIND} item, the example of acme/shelf@${version} in the #1399 acceptance suite.`,
    size: [320, 360], packs: [`${id}@${version}`],
    items: { x1: { id: 'x1', kind: KIND, name: 'X1', order: 'a0', params: {} } },
  });
  writeFileSync(join(dir, 'examples', 'defaults.json'), example);
  writeFileSync(join(dir, `${KIND}.json`), text(recipe(o.extraInputs ?? {})));
  const manifest: JsonObject = {
    name: 'shelf', version, license: 'MIT',
    description: `A test pack of the #1399 acceptance suite, by an outside owner: the kind ${KIND}, backed by a recipe.`,
    requires: { core: '>=0.0.0', modules: { marks2d: '>=0.0.0' } },
    recipes: { [KIND]: `${KIND}.json` },
    kinds: {
      [KIND]: {
        minor: 0, recipe: KIND, children: [], capabilities: { pickable: true, snap: false }, migrate: {},
        examples: [sha256(example)],
        cost: { class: 'figure', at_defaults: { cpu_ms: 0.5, gpu_ms: 0.2, items: 7 } },
        ...(o.extraFields ?? {}),
      },
    },
    assets: [{ path: 'examples/defaults.json', sha256: sha256(example), size: Buffer.byteLength(example), license: 'MIT' }],
  };
  writeFileSync(join(dir, 'pack.json'), text(manifest));
  return { id, version, dir };
}

/** `install_pack` (#306): the pack check, and the kind kit of each kind it declares (#202). */
export const installPack = (p: ShelfPack): JsonObject => ({ call: 'install_pack', id: p.id, dir: p.dir });

/** An `install_pack` reply: `outcome` installed or refused, and the refusal's issues. */
export interface Installed { outcome: string; issues: JsonObject[]; raw: JsonObject }
export function installed(reply: JsonObject, p: ShelfPack): Installed {
  const issues = arr(reply['issues'] ?? [], `${packAt(p)}: issues`).map((v, i) => obj(v, `${packAt(p)}: issues[${i}]`));
  return { outcome: String(reply['outcome']), issues, raw: reply };
}

/**
 * The errors of a refused pack that are the kind kit's part `part` failing: severity error, never the base's
 * `unknown_field` refusal of a field it doesn't know, naming the part as data (a value equal to `part`).
 */
export function kitPartErrors(r: Installed, part: string): JsonObject[] {
  return r.issues.filter((i) => i['severity'] === 'error' && i['code'] !== 'unknown_field' && names(i, part));
}

// ---------------------------------------------------------------------------------------------------
// The world a verdict needs (as #407's suite sets it): the claim's agent, the process table, one panel.

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: films', process: { pid: 4100, start: 1_000 } } as const;
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
const PANELS: JsonObject = { main: { rect: [0, 0, 1920, 1080] } };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const FILM_DOC = ulid('01JB1399D', 1);
export const CLAIM = `claim:${ulid('01JB1399C', 1)}`;
export const REQ = `req:${ulid('01JB1399Q', 1)}`;

/** Frames a second and seconds of the per-frame check's film: 25 frames in each rendition the check plays. */
export const FPS = 25;
export const FRAMES = 25;

/** A 640 × 360 u film at 25 frames a second, 1 s long, of one still grey rect on the ground: nothing in it flashes. */
export function stillFilm(): JsonObject {
  return {
    format: 1, id: FILM_DOC, profile: 'film', title: 'A still plate',
    description: 'A still plate: one grey rect for 25 frames, a film the #1399 acceptance tests judge.',
    size: [640, 360], safe: 24, transport: { frame_rate: `${FPS}/1`, span: `${FRAMES / FPS}s`, reduced_motion: 'hold' },
    layers: { 'you-main': { writer: 'you:you', title: 'You', order: 'a0' } },
    items: { plate: { id: 'plate', kind: 'rect@1', name: 'Plate', order: 'a0000', layer: 'you-main', params: { box: [0, 0, 320, 180], paint: { fill: { role: 'muted' } } } } },
  };
}

/** The scenario: the film stored on the panel, one claim of alpha's naming it with one requirement, `check`; one verdict. */
export function verdictScenario(evidence: string, check: JsonObject, planted?: string): JsonObject {
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS,
    docs: { [FILM_DOC]: { panel: 'main', document: stillFilm() } },
    claims: { [CLAIM]: { session: ALPHA.id, deliverables: [FILM_DOC], requirements: [{ id: REQ, check }] } },
    ...(planted ? { planted } : {}),
    calls: [{ call: 'verdict', claim: CLAIM }],
  };
}

/** The verdict's row for the claim's one requirement. */
export function rowOf(reply: JsonObject): JsonObject {
  const row = arr(reply['requirements'], 'the verdict: requirements').filter(isObject).find((r) => r['id'] === REQ);
  expect(row, `the verdict has a row for ${REQ}: ${show(reply, 3000)}`).toBeDefined();
  return row!;
}

// ---------------------------------------------------------------------------------------------------
// PNG frames (8-bit RGBA, no filter), written at test time.

/** Writes a `w` × `h` RGBA PNG whose pixel (x, y) is `pixel(x, y)`. */
export function writePng(path: string, w: number, h: number, pixel: (x: number, y: number) => [number, number, number]): string {
  const raw = Buffer.alloc(h * (1 + 4 * w));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + 4 * w)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      raw.set([r, g, b, 255], y * (1 + 4 * w) + 1 + 4 * x);
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  writeFileSync(path, png);
  return path;
}

/** `decide` (#380): your blessing records `png` as `fixture`'s golden in `store`. */
export const bless = (store: string, fixture: string, png: string): JsonObject =>
  ({ call: 'decide', store, via: 'you', decision: { bless: { fixture, png } } });
/** `golden` (#380): the snapshot `png` against `fixture`'s golden, through the perceptual oracle. */
export const golden = (store: string, fixture: string, png: string): JsonObject => ({ call: 'golden', store, fixture, png });
