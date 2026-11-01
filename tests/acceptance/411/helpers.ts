// Test-side tools for the #411 acceptance tests: `deep-show` built per Cargo feature set and driven by JSON
// lines (`run`, and the long-lived `canvas` the hub keeps), the world its scenarios share (sessions, panels,
// documents, the record's asks, packs), the fixtures (the door, the city, the hull, the summary scene), the
// evidence store read through its public entry, an extension host with a first-party test check plug-in, and the
// judges the criteria's planted programs must fail, each returning its failures as sentences that name what
// failed. Nothing here stands in for deep_query, a why, a cut, a mode, the plug-in read or the validator.
//
// Safety: every folder is a fresh temp folder removed after its test or file; HOME is a temp folder; the agent's
// own CLAUDE_* and DEEP_* variables are removed; every process a test starts is stopped by its PID (each
// canvas core is closed, each host closed); no network.

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import type { CheckResult, CheckSpec } from '../../../packages/conformance/src/index.ts';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/411 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
export const SHOW_NAME = 'deep-show';
const BUILT = join(REPO, 'target', 'debug', SHOW_NAME);

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
/** Cargo keeps your HOME, so it finds its own registry, toolchain and build cache; nothing else does. */
const CARGO_ENV = { ...process.env };
const HOME =realpathSync(mkdtempSync(join(tmpdir(), 'deep-411-home-')));
process.env.HOME = HOME;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${brief(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${brief(value)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${brief(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${brief(value)}`).toBe('string');
  return value as string;
}
export const brief = (value: JsonValue | undefined, n = 1200): string => (JSON.stringify(value) ?? 'undefined').slice(0, n);
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** Two JSON values are equal, numbers within 1e-6. */
export function near(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => near(v, b[i]));
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return near(ka, kb) && ka.every((k) => near(a[k], b[k]));
  }
  return a === b;
}

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** At least one failure, one naming each of `names`: what a wrong program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
  }
}

/** A content key: 32 lowercase hex (128 bits), as #387 defines it. */
export const KEY = /^[0-9a-f]{32}$/;
/** A canvas module named with its version, `<module>@<semver>`. */
export const MODULE_AT = /^[a-z0-9.]+@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

// ---------------------------------------------------------------------------------------------------
// Builds: one `deep-show` per Cargo feature set, built once per file, each kept under its own name.

/** A build: a build set and this suite's test features (README: Cargo features). */
export interface Build { set: 'full' | 'r1'; with?: 'test-machines' }
export const FULL: Build = { set: 'full' };
export const R1: Build = { set: 'r1' };
export const MACHINES: Build = { set: 'full', with: 'test-machines' };
const featuresOf = (b: Build): string[] => [b.set, ...(b.with ? [b.with] : [])];
const nameOf = (b: Build): string => featuresOf(b).join('+');

function cargoBuild(features: string[]): string {
  const args = ['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', features.join(',')];
  const r = spawnSync('cargo', args, { cwd: REPO, env: CARGO_ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Locking|Updating/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

export interface Builds { bin: (b: Build) => string }
/** Builds every listed feature set once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): Builds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-411-bins-'));
    for (const b of builds) {
      const name = nameOf(b);
      if (made.has(name)) continue;
      const error = cargoBuild(featuresOf(b));
      const bin = join(dir, `${SHOW_NAME}-${name}`);
      if (error === '') copyFileSync(BUILT, bin);
      made.set(name, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(b: Build): string {
      const entry = made.get(nameOf(b));
      if (!entry) throw Error(`the file didn't list the build ${nameOf(b)} in useBuilds`);
      expect(entry.error, `the binary builds: ${SHOW_NAME} with features ${featuresOf(b).join(',')}`).toBe('');
      return entry.bin;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393's convention).

export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 600_000, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`${SHOW_NAME} run: ${r.error.message}`);
  expect(r.status, `${SHOW_NAME} run exits 0 (${r.signal ?? 'no signal'}); stderr: ${(r.stderr ?? '').slice(0, 2000)}`).toBe(0);
  const lines = r.stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${brief(out, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((x, i) => obj(x, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(scenario['calls'], 'the scenario\'s calls').length);
  return replies;
}

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-411-ev-'))); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** The bytes of one piece of evidence, read by its hash through the evidence store's public entry. */
export async function readEvidence(root: string, sha256: string): Promise<Buffer> {
  const store = await openEvidenceStore({ root });
  return Buffer.from(await store.read(sha256));
}
export const sha256Of = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
/** A PNG's width and height from its IHDR, or null when the bytes aren't a PNG. */
export function pngSize(bytes: Buffer): [number, number] | null {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

// ---------------------------------------------------------------------------------------------------
// The world: agents' sessions, the process table, panels, minted documents, the record's asks, packs.

export interface SessionFixture { id: string; thread: string; name: string; process: { pid: number; start: number } }
export const ALPHA: SessionFixture = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: door rig', process: { pid: 4100, start: 1_000 } };
export const BRAVO: SessionFixture = { id: 'sess-bravo', thread: 'thread-bravo', name: 'Codex: city blocks', process: { pid: 5200, start: 2_000 } };
export const SESSIONS: JsonObject = Object.fromEntries([ALPHA, BRAVO].map((s) => [s.id, { thread: s.thread, name: s.name, process: s.process }]));
/** The OS process table the peer check reads: your shell, and a process inside alpha's tree. */
export const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 4100, ppid: 3000, start: 1_000 },
  { pid: 4102, ppid: 4100, start: 1_200 },
  { pid: 5200, ppid: 3000, start: 2_000 },
];
/** `deep show` from inside alpha's process tree: it acts as alpha. */
export const IN_ALPHA: JsonObject = { pid: 4102, start: 1_200 };
export const PANELS: JsonObject = { main: { rect: [0, 0, 1200, 800] } };

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** Documents the hub has minted. */
export const DOC = { a: ulid('01JC41D', 1), b: ulid('01JC41D', 2), c: ulid('01JC41D', 3), d: ulid('01JC41D', 4) } as const;
export const askHandle = (n: number): string => `ask:${ulid('01JC41A', n)}`;
export const claimHandle = (n: number): string => `claim:${ulid('01JC41C', n)}`;
export const reqHandle = (n: number): string => `req:${ulid('01JC41Q', n)}`;

/** The test pack the door is an instance of (fixtures/packs/door-1.0.0): recipe door.leaf@1, inputs open and swing. */
export const DOOR_PACK: JsonObject = { id: 'test/door', dir: join(FIXTURES, 'packs', 'door-1.0.0') };
export const DOOR_PACK_ID = 'test/door@1.0.0';
export const DOOR_RECIPE = 'door.leaf@1';

/** A scenario with this suite's sessions, process table, panels and the door pack; each doc on `main` unless given. */
export function scenario(evidence: string, docs: Record<string, JsonObject | null>, calls: JsonObject[], extra: JsonObject = {}): JsonObject {
  const docsOut: JsonObject = {};
  for (const [id, d] of Object.entries(docs)) docsOut[id] = { panel: 'main', ...(d ?? {}) };
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS, packs: [DOOR_PACK], docs: docsOut, ...extra, calls };
}

/** Alpha's deep_show of a whole revision. */
export const show = (doc: string, document: JsonObject, extra: JsonObject = {}, session = ALPHA.id): JsonObject =>
  ({ call: 'deep_show', session, doc, document, include: ['issues'], ...extra });
/** An agent's deep_query (README: deep_query). */
export const query = (doc: string, fields: JsonObject, session: string | null = ALPHA.id): JsonObject =>
  ({ call: 'deep_query', session, doc, ...fields });

/** A deep_show reply's outcome is presented, or the test fails naming the reply. */
export function presented(reply: JsonObject, what: string): number {
  expect(reply['outcome'], `${what} is presented: ${brief(reply, 2000)}`).toBe('presented');
  return num(reply['rev'], `${what}: rev`);
}

// ---------------------------------------------------------------------------------------------------
// Documents

export function board(title: string, size: [number, number], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, profile: 'board', title,
    description: `${title}, drawn by a test agent through deep_show for the #411 suite.`,
    size, items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
export const rect = (id: string, name: string, box: number[], order: string, extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'rect@1', name, order, params: { box, paint: { fill: { role: 'muted' } } }, ...extra });
export const label = (id: string, name: string, words: string, pos: [number, number], order: string): JsonObject =>
  ({ id, kind: 'text@1', name, order, params: { text: words, font: 'body', size: 13, box: { w: 160, h: 20 } }, at: { pos: [pos[0], pos[1], 0] } });
export const circle = (id: string, name: string, center: [number, number], r: number, order: string): JsonObject =>
  ({ id, kind: 'circle@1', name, order, params: { center, r, paint: { fill: { role: 'accent' } } } });

/** The angle the door is drawn at: its rotation about z, in degrees. */
export const ANGLE = 'items/door/at/rot/2';
export const OPEN = 'items/door/params/open';
export const SWING = 'items/door/params/swing';

/**
 * The door (AC6, AC8): an instance of the pack's door.leaf@1 with `open` and `swing` as its params, and a driver that
 * writes its drawn angle as open × swing. `params` replaces the door's params (leave `swing` out to take the
 * recipe's default).
 */
export function door(params: JsonObject = { open: 0.5, swing: 90 }): JsonObject {
  return board('Door', [400, 300], [
    { id: 'door', kind: DOOR_RECIPE, name: 'Door', order: 'a0', params, at: { pos: [100, 100, 0], rot: [0, 0, 0] } },
  ], {
    packs: [DOOR_PACK_ID],
    transport: { span: '3s' },
    drivers: { swing: { target: ANGLE, expr: 'open * swing', vars: { open: OPEN, swing: SWING } } },
  });
}

/**
 * The stopped door (AC9): a channel key sets the door's angle to 80° at 1 s, and a limit constraint holds its
 * rotation about z within [0°, 45°].
 */
export function stoppedDoor(): JsonObject {
  return board('Stopped door', [400, 300], [
    rect('door', 'Door', [0, -4, 80, 8], 'a0', { at: { pos: [100, 100, 0], rot: [0, 0, 0] } }),
  ], {
    transport: { span: '2s' },
    channels: { angle: { target: ANGLE, type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '1s', value: 80, interp: 'hold' } } } },
    constraints: { stop: { owner: 'door', kind: 'limit', what: 'rotation', bounds: [null, null, [0, 45]] } },
  });
}

/** The hull (AC7): a box with a three-modifier stack, the array second; `upTo` cuts the stack after that index. */
export const MODIFIERS: JsonObject[] = [
  { kind: 'mod.subdivide@1', params: { levels: 1 } },
  { kind: 'mod.array@1', params: { count: 3, offset: [1.5, 0, 0] } },
  { kind: 'mod.mirror@1', params: { axes: ['x'] } },
];
export function hull(upTo = MODIFIERS.length - 1): JsonObject {
  return {
    format: 1, profile: 'scene', title: 'Hull', description: 'A box under a subdivide, an array and a mirror, for the #411 suite.',
    size: [128, 96], camera: 'cam', requires: { modules: { scene3d: '^1' } },
    items: {
      cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 30, elevation: 35, distance: 14 }, fov: 40 } },
      hull: { id: 'hull', kind: 'mark.box@1', name: 'Hull', order: 'b0', params: { size: [1, 1, 1], paint: { fill: { role: 'accent' } } }, modifiers: MODIFIERS.slice(0, upTo + 1) },
    },
  };
}
export const prefixPath = (k: number): string => `items/hull/modifiers/${k}#out`;

/** The city (AC1, AC10): 125 blocks of 39 lamp posts each, 5,000 items; the lamp posts are listed first. */
export const BLOCKS = 125;
export const LAMPS_PER_BLOCK = 39;
export const blockId = (b: number): string => `town.block.${String(b).padStart(3, '0')}`;
export const lampId = (b: number, l: number): string => `lamp.${String(b).padStart(3, '0')}.${String(l).padStart(2, '0')}`;
export function city(): JsonObject {
  const lamps: JsonObject[] = [];
  const blocks: JsonObject[] = [];
  for (let b = 0; b < BLOCKS; b++) {
    blocks.push({ id: blockId(b), kind: 'group@1', name: `Block ${b}`, order: `b${String(b).padStart(4, '0')}`, params: {}, at: { pos: [(b % 25) * 40, Math.floor(b / 25) * 40, 0] } });
    for (let l = 0; l < LAMPS_PER_BLOCK; l++) {
      lamps.push(rect(lampId(b, l), `Lamp post ${b}.${l}`, [0, 0, 2, 2], `l${String(l).padStart(3, '0')}`, { parent: blockId(b), at: { pos: [(l % 13) * 3, Math.floor(l / 13) * 12, 0] } }));
    }
  }
  return board('City', [1000, 200], [...lamps, ...blocks]);
}
/** Each item's parent and its children's count in the city, as the document holds them. */
export function cityTree(): { parent: Map<string, string | null>; children: Map<string | null, number> } {
  const parent = new Map<string, string | null>();
  const children = new Map<string | null, number>();
  for (let b = 0; b < BLOCKS; b++) {
    parent.set(blockId(b), null);
    for (let l = 0; l < LAMPS_PER_BLOCK; l++) parent.set(lampId(b, l), blockId(b));
  }
  for (const p of parent.values()) children.set(p, (children.get(p) ?? 0) + 1);
  return { parent, children };
}

/** The gate's paint, which a status binding writes from an ask's state (AC5). */
export const GATE_FILL = 'items/gate/params/paint/fill';
/**
 * A board you share, as a release stored it: your layer holds the gate, whose fill a status binding reads from
 * `ask`'s state, and a caption. You may read every ask; an agent reads only its own session's.
 */
export function gateBoard(ask: string): JsonObject {
  return {
    format: 1, profile: 'board', title: 'Gate', description: 'Your gate, whose fill shows an open ask\'s state, and a caption.',
    size: [320, 120],
    layers: { 'you-main': { writer: 'you:you', title: 'You', order: 'a0' } },
    items: {
      gate: { id: 'gate', kind: 'rect@1', layer: 'you-main', name: 'Ask state', order: 'a0', params: { box: [16, 16, 96, 24], paint: { fill: { role: 'muted' } } } },
      caption: { id: 'caption', kind: 'text@1', layer: 'you-main', name: 'Caption', order: 'a1', params: { text: 'Gate', font: 'body', size: 13, box: { w: 160, h: 20 } }, at: { pos: [128, 18, 0] } },
    },
    status_bindings: { 'gate-state': { target: GATE_FILL, source: ask } },
  };
}

/** A scene file of this suite's `fixtures/parity/` tree. */
export function scene(path: string): { title: string; description: string; document: JsonObject } {
  return JSON.parse(readFileSync(join(FIXTURES, 'parity', path), 'utf8')) as { title: string; description: string; document: JsonObject };
}

// ---------------------------------------------------------------------------------------------------
// Reading deep_query replies (README: deep_query)

export function values(reply: JsonObject, path: string): JsonValue[] {
  return arr(obj(reply['values'], `the reply's values (${brief(reply, 800)})`)[path], `values["${path}"]`);
}
export function keys(reply: JsonObject, path: string): JsonValue[] {
  return arr(obj(reply['keys'], `the reply's keys (${brief(reply, 800)})`)[path], `keys["${path}"]`);
}
export const rows = (reply: JsonObject): JsonObject[] => arr(reply['rows'], `the reply's rows (${brief(reply, 800)})`).map((r, i) => obj(r, `rows[${i}]`));
export const coverage = (reply: JsonObject): JsonObject => obj(reply['coverage'], `the reply's coverage block (${brief(reply, 800)})`);
export const why = (reply: JsonObject): JsonObject => obj(reply['why'], `the reply's why (${brief(reply, 1500)})`);

// ---------------------------------------------------------------------------------------------------
// Judges: each returns its failures, each sentence naming the value, row or prefix that failed.

/** The source a why names for a path, or undefined. */
const sourceOf = (w: JsonObject, path: string): JsonObject | undefined =>
  (Array.isArray(w['sources']) ? w['sources'] : []).find((s): s is JsonObject => isObject(s) && s['path'] === path);

/**
 * A why for `path` at `t` gives `value`, names each document path in `sources` with its value, and names none of
 * `notSources`. Every failure names the value it is about.
 */
export function whySourceFailures(w: JsonObject, expected: { path: string; t: string; value: number; sources: Record<string, number>; notSources?: string[] }): string[] {
  const it = `the why for ${expected.path} = ${expected.value} at ${expected.t}`;
  const out: string[] = [];
  if (w['path'] !== expected.path) out.push(`${it} is for ${brief(w['path'])}`);
  if (!near(w['value'], expected.value)) out.push(`${it} gives the value ${brief(w['value'])}`);
  if (typeof w['module'] !== 'string' || !MODULE_AT.test(w['module'])) out.push(`${it} names no canvas module@version (${brief(w['module'])})`);
  if (typeof w['operator'] !== 'string' || w['operator'] === '') out.push(`${it} names no operator`);
  for (const [path, value] of Object.entries(expected.sources)) {
    const s = sourceOf(w, path);
    if (!s) out.push(`${it} doesn't name the document path ${path} it traces to (sources ${brief(w['sources'])})`);
    else if (!near(s['value'], value)) out.push(`${it} names ${path} with ${brief(s['value'])}, not ${value}`);
  }
  for (const path of expected.notSources ?? []) {
    if (sourceOf(w, path)) out.push(`${it} names ${path} as a document field, which the document doesn't hold`);
  }
  return out;
}

/** A write in a why, found by the document entry that made it. */
const writeBy = (w: JsonObject, entry: string): { write: JsonObject; index: number } | undefined => {
  const writes = Array.isArray(w['writes']) ? w['writes'] : [];
  const index = writes.findIndex((x) => isObject(x) && typeof x['entry'] === 'string' && x['entry'].startsWith(entry));
  return index < 0 ? undefined : { write: writes[index] as JsonObject, index };
};
const byEntry = (x: JsonObject): JsonValue | undefined => (isObject(x['by']) ? x['by']['entry'] : undefined);

/**
 * A why for `path` at `t` lists the key's write (value `keyValue`) marked clamped_by the constraint, and the
 * constraint's write (value `value`) marked stands, in evaluation order, each with its canvas module@version and
 * operator. Every failure names the value.
 */
export function whyWriteFailures(w: JsonObject, expected: { path: string; t: string; value: number; key: string; keyValue: number; constraint: string }): string[] {
  const it = `the why for ${expected.path} = ${expected.value} at ${expected.t}`;
  const out: string[] = [];
  if (!near(w['value'], expected.value)) out.push(`${it} gives the value ${brief(w['value'])}`);
  const key = writeBy(w, expected.key);
  const held = writeBy(w, expected.constraint);
  if (!key) out.push(`${it} lists no write by the key ${expected.key} (writes ${brief(w['writes'])})`);
  if (!held) out.push(`${it} lists no write by the constraint ${expected.constraint} (writes ${brief(w['writes'])})`);
  for (const found of [key, held]) {
    if (!found) continue;
    const m = found.write['module'];
    if (typeof m !== 'string' || !MODULE_AT.test(m)) out.push(`${it}: the write by ${brief(found.write['entry'])} names no canvas module@version (${brief(m)})`);
    if (typeof found.write['operator'] !== 'string' || found.write['operator'] === '') out.push(`${it}: the write by ${brief(found.write['entry'])} names no operator`);
  }
  if (key) {
    if (!near(key.write['value'], expected.keyValue)) out.push(`${it}: the key's write is ${brief(key.write['value'])}, not ${expected.keyValue}`);
    if (key.write['status'] !== 'clamped_by') out.push(`${it}: the key's write is marked ${brief(key.write['status'])}, not clamped_by`);
    if (byEntry(key.write) !== expected.constraint) out.push(`${it}: the key's write is clamped by ${brief(key.write['by'])}, not ${expected.constraint}`);
  }
  if (held) {
    if (!near(held.write['value'], expected.value)) out.push(`${it}: the constraint's write is ${brief(held.write['value'])}, not ${expected.value}`);
    if (held.write['status'] !== 'stands') out.push(`${it}: the constraint's write is marked ${brief(held.write['status'])}, not stands`);
  }
  if (key && held && key.index > held.index) out.push(`${it}: the key's write is listed after the constraint's, not in evaluation order`);
  return out;
}

/** Every kept row's parent is kept too; the first row without its parent comes first. */
export function parentFailures(kept: JsonObject[]): string[] {
  const ids = new Set(kept.map((r) => r['id']));
  return kept.filter((r) => r['parent'] !== null && r['parent'] !== undefined && !ids.has(r['parent']))
    .map((r) => `row ${String(r['id'])} is kept without its parent ${String(r['parent'])}`);
}

/**
 * Each kept row says how many children it has in the whole result, and the coverage block names the cut: for every
 * kept row (and the top level, `parent: null`) with children left out, one entry with the children shown and the
 * total; no entry for one with none left out.
 */
export function cutFailures(reply: JsonObject, tree: { parent: Map<string, string | null>; children: Map<string | null, number> }, cap: number): string[] {
  const out: string[] = [];
  const kept = rows(reply);
  if (kept.length > cap) out.push(`the reply keeps ${kept.length} rows under a cap of ${cap}`);
  const ids = new Set(kept.map((r) => String(r['id'])));
  const shown = new Map<string | null, number>();
  for (const r of kept) {
    const id = String(r['id']);
    if (!tree.parent.has(id)) { out.push(`row ${id} is no item of the document`); continue; }
    const p = tree.parent.get(id)!;
    if ((r['parent'] ?? null) !== p) out.push(`row ${id} gives its parent as ${brief(r['parent'])}, not ${String(p)}`);
    if (r['children_total'] !== (tree.children.get(id) ?? 0)) out.push(`row ${id} carries children_total ${brief(r['children_total'])}, not ${tree.children.get(id) ?? 0}`);
    shown.set(p, (shown.get(p) ?? 0) + 1);
  }
  const c = isObject(reply['coverage']) ? reply['coverage'] : {};
  if (c['complete'] !== false) out.push(`the coverage block of a cut result says complete: ${brief(c['complete'])}`);
  if (c['rows_total'] !== tree.parent.size) out.push(`the coverage block gives rows_total ${brief(c['rows_total'])}, not ${tree.parent.size}`);
  if (c['rows_shown'] !== kept.length) out.push(`the coverage block gives rows_shown ${brief(c['rows_shown'])}, not the ${kept.length} rows kept`);
  const cut = Array.isArray(c['cut']) ? c['cut'].filter(isObject) : [];
  if (!Array.isArray(c['cut'])) out.push(`the coverage block names no cut (cut ${brief(c['cut'])})`);
  const named = new Map<string | null, JsonObject>();
  for (const e of cut) named.set((e['parent'] ?? null) as string | null, e);
  const parents: (string | null)[] = [null, ...[...ids].filter((id) => (tree.children.get(id) ?? 0) > 0)];
  for (const p of parents) {
    const total = tree.children.get(p) ?? 0;
    const s = shown.get(p) ?? 0;
    const e = named.get(p);
    const who = p === null ? 'the top level' : `row ${p}`;
    if (s < total && !e) out.push(`the coverage block doesn't name the cut under ${who}: ${s} of its ${total} children shown`);
    if (e && (e['shown'] !== s || e['total'] !== total)) out.push(`the coverage block names the cut under ${who} as ${brief(e)}, not shown ${s} of ${total}`);
    if (s === total && e) out.push(`the coverage block names a cut under ${who}, which keeps all ${total} of its children`);
  }
  for (const p of named.keys()) if (p !== null && !ids.has(p)) out.push(`the coverage block names a cut under ${p}, a row the reply doesn't keep`);
  return out;
}

/** Each prefix read on the full stack equals the clean evaluation of the stack cut after it. */
export function prefixFailures(full: Record<number, JsonValue>, clean: Record<number, JsonValue>): string[] {
  return Object.keys(clean).map(Number).filter((k) => !near(full[k], clean[k]))
    .map((k) => `${prefixPath(k)} reads ${brief(full[k], 300)}, but a clean evaluation of the stack cut after ${k} gives ${brief(clean[k], 300)}`);
}

// ---------------------------------------------------------------------------------------------------
// `deep-show canvas`: the long-lived canvas core the hub keeps (#806), one call at a time.

export interface CanvasCore {
  /** One call; resolves with its reply when the core answers `ok`, else with the whole answer line. */
  call(call: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
}
const cores: ChildProcessWithoutNullStreams[] = [];
export async function openCanvasCore(bin: string, world: JsonObject): Promise<CanvasCore> {
  const child = spawn(bin, ['canvas'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
  cores.push(child);
  child.stderr.resume();
  const waiting: ((line: Record<string, unknown>) => void)[] = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    let value: Record<string, unknown>;
    try { value = JSON.parse(line) as Record<string, unknown>; } catch { value = { ok: false, code: 'bad_output', line }; }
    waiting.shift()?.(value);
  });
  child.on('exit', () => { for (const wake of waiting.splice(0)) wake({ ok: false, code: 'canvas_core_exited' }); });
  const send = (line: Record<string, unknown>): Promise<Record<string, unknown>> => new Promise((resolve) => {
    waiting.push(resolve);
    child.stdin.write(`${JSON.stringify(line)}\n`);
  });
  const set = await send({ world });
  expect(set['ok'], `the canvas core takes the world: ${JSON.stringify(set).slice(0, 600)}`).toBe(true);
  return {
    async call(call) {
      const answer = await send({ call });
      return answer['ok'] === true && typeof answer['reply'] === 'object' && answer['reply'] !== null ? answer['reply'] as Record<string, unknown> : answer;
    },
    close() { if (child.exitCode === null && child.pid) process.kill(child.pid, 'SIGTERM'); },
  };
}

// ---------------------------------------------------------------------------------------------------
// The extension host and the test check plug-in (fixtures/door-reader), loaded first-party in the hub.

const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `deep-411-${tag}-`)));
  made.push(dir);
  return dir;
}

export const READER_ID = 'test/door-reader';
export const READER_KIND = 'ext.door-reader.open';
export const READER_SPEC: CheckSpec = { kind: READER_KIND, runner: 'deep.canvas.read', inputs: [OPEN], depth: 'unit', oracle: 'code', contract: null };

/** What the plug-in's runner reads on its next run, where it writes what each read returned, and what it reports. */
export interface ReaderConfig { seen: string; reads: { doc: string; rev: number; paths: string[]; at: string[] }[]; evidence: 'keys' | 'none' }
export interface Reader { host: ExtensionHost; config: string; seen: string }

const closers: (() => Promise<void>)[] = [];
/**
 * The door reader installed first-party in the hub of a fresh extension host whose canvas core is `core`, under
 * a grant that covers `docs` only.
 */
export async function loadReader(core: CanvasCore, docs: string[]): Promise<Reader> {
  const hostEntry = await import('../../../packages/extension-host/src/index.ts');
  const { openRecord } = await import('../../../packages/record/src/index.ts');
  const { openAsks } = await import('../../../packages/asks/src/index.ts');
  const { openSupervisor } = await import('../../../packages/supervisor/src/index.ts');
  const dir = tempDir('world');
  const home = join(dir, 'deepbuild');
  mkdirSync(home, { recursive: true });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  const trust = await hostEntry.openTrust({ record, now: Date.now });

  const pkg = tempDir('pkg-door-reader');
  cpSync(join(FIXTURES, 'door-reader'), pkg, { recursive: true });
  for (const e of readdirSync(pkg)) if (e.endsWith('.fixture')) renameSync(join(pkg, e), join(pkg, e.slice(0, -'.fixture'.length)));
  const config = join(tempDir('reader'), 'config.json');
  const seen = join(dirname(config), 'seen.jsonl');
  writeFileSync(join(pkg, 'reader.json'), JSON.stringify({ config }));
  const manifestPath = join(pkg, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest['digest'] = hostEntry.packageDigest(pkg);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const release = [{ id: READER_ID, version: String(manifest['version']), digest: hostEntry.packageDigest(pkg) }];

  const host = await hostEntry.openExtensionHost({
    record, asks, supervisor: sup, trust, home, release, now: Date.now,
    // README, Surfaces: the extension host's canvas core, as the hub hands it its own.
    canvas: (call: Record<string, unknown>) => core.call(call),
  } as Parameters<typeof hostEntry.openExtensionHost>[0]);
  closers.push(async () => { await host.close().catch(() => undefined); await sup.close().catch(() => undefined); await record.close().catch(() => undefined); });
  await host.ready();
  const installed = await host.install({ from: pkg, builtBy: null, grant: { docs } } as Parameters<ExtensionHost['install']>[0]);
  const conformance = await host.check(installed);
  expect(conformance.passed, `${READER_ID} passes conformance: ${JSON.stringify(conformance)}`).toBe(true);
  const load = await host.load(installed);
  expect(load.status === 'loaded' && load.place, `${READER_ID} loads in the hub: ${JSON.stringify(load)}`).toBe('hub');
  return { host, config, seen };
}

/** One run of the reader's check, after setting what it reads; returns the core's result and what each read returned. */
export async function runReader(reader: Reader, config: Omit<ReaderConfig, 'seen'>): Promise<{ result: CheckResult; seen: { doc: string; rev: number; reply: JsonObject }[] }> {
  writeFileSync(reader.seen, '');
  writeFileSync(reader.config, JSON.stringify({ ...config, seen: reader.seen }));
  const result = await reader.host.runCheck(READER_KIND, READER_SPEC, { checkout: tempDir('checkout'), deadline: 60_000 });
  const seen = existsSync(reader.seen) ? readFileSync(reader.seen, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { doc: string; rev: number; reply: JsonObject }) : [];
  return { result, seen };
}

afterAll(async () => {
  for (const close of closers.splice(0)) await close();
  for (const child of cores.splice(0)) if (child.exitCode === null && child.pid) process.kill(child.pid, 'SIGTERM');
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  rmSync(HOME, { recursive: true, force: true });
});
