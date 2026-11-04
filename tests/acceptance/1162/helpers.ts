// Test-side tools for the #1162 checkpoint (README: The surface under test). Three merged binaries, each built once
// per file and copied out under its own name: `deep-show` (the hub: `deep show` from a test process standing in for an
// agent, the claim and its verdict, render-back, deep_query, deep_kinds, the replica's displays, windows, `see` and
// point and ask), `deep-gpu` (#421's renderer through `view3d`) and `deep-canvas-render` (#381's 2D glyph runs). Also
// the piece and its variants, the readers for their replies, and the reviewed references the criteria are held to.
// Nothing here stands in for the hub, the renderers, the checks or the replica. Pieces are copied from the merged
// suites #670, #403, #400, #384, #411, #412, #418, #421 and #381, since suites don't import each other.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1162 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

// ---------------------------------------------------------------------------------------------------
// JSON and judging

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${shown(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${shown(value)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${shown(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${shown(value)}`).toBe('string');
  return value as string;
}
export const shown = (v: JsonValue | undefined, n = 800): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** What a planted program must give: at least one failure, and one naming each of `names`. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
}
/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** The GPU layer draws the finished look's pixels on macOS's Metal device. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The proof (the issue's Proof line), written under $TMPDIR/deep-1162-proof/ and never read back by a test, except
// AC7's `ac7/` folder, which the check run writes from the app (README: AC7).

export const PROOF_DIR = join(tmpdir(), 'deep-1162-proof');
export function keepProof(name: string, value: JsonValue | Buffer): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, name), Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`);
}

// ---------------------------------------------------------------------------------------------------
// Time

export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000;
export const sec = (s: number): number => Math.round(s * FLICKS);

// ---------------------------------------------------------------------------------------------------
// The piece (fixtures/, README: Fixtures)

export const fixturePath = (name: string): string => join(HERE, 'fixtures', name);
const fixtureJson = (name: string): JsonObject => obj(JSON.parse(readFileSync(fixturePath(name), 'utf8')) as JsonValue, `fixtures/${name}`);
/** The piece as the agent sends it: no `id`, no `layers`, no item `layer`; items keyed by ID without their own `id`. */
export function piece(): JsonObject {
  const p = fixtureJson('piece.json');
  for (const [id, item] of Object.entries(obj(p['items'], 'items'))) obj(item, id)['id'] = id;
  return p;
}
export const LOOK = fixtureJson('look.json');
export const TABLE = fixturePath('table.csv');
export const TABLE_PATCHED = fixturePath('table-patched.csv');
export const SVG = fixturePath('formula.svg');
export const TITLE = 'Sales by region';
export const SIZE: [number, number] = [960, 540];
/** The table's rows as the agent wrote them: key → value, in key order. */
export const ROWS: [string, string][] = readFileSync(TABLE, 'utf8').trim().split('\n').slice(1).map((l) => { const c = l.split(','); return [c[0]!, c[2]!]; });

export const VERDICT = `verdict:${ulid('01JB1162V', 1)}`;
/** The piece with a verdict binding on the picture frame's stroke slot (AC4): on a 3D object it draws as its outline. */
export function bound(p: JsonObject = piece()): JsonObject {
  const out = clone(p);
  out['status_bindings'] = { 'frame-state': { target: 'items/frame/params/paint/stroke', source: VERDICT } };
  return out;
}
/** `bound` with the fail color written on the frame's material, not through the binding (AC4's refused revision). */
export function failMaterial(): JsonObject {
  const out = bound();
  obj(obj(obj(out['items'], 'items')['wood'], 'wood')['params'], 'wood.params')['base_color'] = { role: 'status.fail' };
  return out;
}
/** The piece reading another table (AC1's patch to one bar's value): only `assets.sales.sha256` changes. */
export function withTable(sha: string, p: JsonObject = piece()): JsonObject {
  const out = clone(p);
  obj(obj(out['assets'], 'assets')['sales'], 'assets.sales')['sha256'] = sha;
  return out;
}
/** The items by ID, as the fixture holds them. */
export const itemsOf = (p: JsonObject): Record<string, JsonObject> =>
  Object.fromEntries(Object.entries(obj(p['items'], 'items')).map(([id, v]) => [id, obj(v, `items.${id}`)]));

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file and copied out under its own name; a test using a failed build fails.

export type Build = 'deep-show' | 'deep-show-no-data' | 'deep-gpu' | 'deep-canvas-render';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
const CARGO: Record<Build, { bin: string; args: string[] }> = {
  'deep-show': { bin: 'deep-show', args: ['--no-default-features', '--features', 'full'] },
  // AC1's test build without the data module (README: The test build without the data module).
  'deep-show-no-data': { bin: 'deep-show', args: ['--no-default-features', '--features', 'full,test-leave-out-data'] },
  'deep-gpu': { bin: 'deep-gpu', args: [] },
  'deep-canvas-render': { bin: 'deep-canvas-render', args: [] },
};
export const cargoLine = (b: Build): string => `cargo build --locked --bin ${CARGO[b].bin} ${CARGO[b].args.join(' ')}`.trim();
function cargoBuild(b: Build): string {
  const args = ['build', '--locked', '--bin', CARGO[b].bin, ...CARGO[b].args];
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
export interface Bins { bin: (b: Build) => string }
export function useBuilds(builds: readonly Build[]): Bins {
  let dir = '';
  const made = new Map<Build, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1162-bins-'));
    for (const b of builds) {
      const error = cargoBuild(b);
      const bin = join(dir, exe(b));
      if (error === '') copyFileSync(join(targetDir(), 'debug', exe(CARGO[b].bin)), bin);
      made.set(b, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(b: Build): string {
      const entry = made.get(b);
      if (!entry) throw Error(`the file didn't list ${b} in useBuilds`);
      expect(entry.error, `the binary builds: ${cargoLine(b)}`).toBe('');
      return entry.bin;
    },
  };
}
/** A fresh temporary folder per test (the evidence store, documents, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1162-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Running a binary: JSON lines in, one line out per line in, exit 0.

function lines(bin: string, args: string[], inputs: JsonValue[], timeoutMs = 1_800_000): JsonObject[] {
  const label = `${bin.split(/[\\/]/).at(-1)} ${args.join(' ')}`;
  const run = spawnSync(bin, args, {
    cwd: REPO, input: `${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL',
  });
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within ${timeoutMs} ms`);
  if (run.error) throw Error(`${label}: ${run.error.message}`);
  expect(run.status, `${label} exits 0 (${run.signal ?? 'no signal'}); stdout: ${(run.stdout ?? '').slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
  const out = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${label}: one output line per input line`).toBe(inputs.length);
  return out.map((l, i) => obj(JSON.parse(l) as JsonValue, `${label}: line ${i + 1}`));
}

/** Scenario `planted` values this suite uses: #670's, #384's, and the one it adds (README: Planted programs). */
export type ShowPlanted = 'seeds_noise_from_clock' | 'relation_from_previous_box' | 'box_drops_doc_rev' | 'box_folds_quote';
/**
 * `deep-show run`: one scenario per line, in one process (each line a fresh run of the hub, #393); each answered ok
 * with one reply per call, in call order. Returns each scenario's replies.
 */
export function runShow(bin: string, scenarios: JsonObject[], what: string): JsonObject[][] {
  const answers = lines(bin, ['run'], scenarios);
  return answers.map((a, k) => {
    expect(a['ok'], `${what}: deep-show run answers scenario ${k + 1} ok${scenarios[k]!['planted'] ? ` (planted ${String(scenarios[k]!['planted'])})` : ''}; got ${shown(a)}`).toBe(true);
    const replies = arr(a['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
    expect(replies.length, `${what}: one reply per call`).toBe(arr(scenarios[k]!['calls'], 'calls').length);
    return replies;
  });
}

/** `deep-gpu run [--backend noop] [--planted <name>]` (#377): one scenario `{out, calls}`, one reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[], opts: { noop?: boolean; planted?: 'status_before_tone_map' } = {}): JsonObject[] {
  const args = ['run', ...(opts.noop ? ['--backend', 'noop'] : []), ...(opts.planted ? ['--planted', opts.planted] : [])];
  const [answer] = lines(bin, args, [{ out, calls }]);
  expect(answer!['ok'], `deep-gpu ${args.join(' ')} answers ok: ${shown(answer)}`).toBe(true);
  const replies = arr(answer!['replies'], 'deep-gpu: replies').map((r, i) => obj(r, `deep-gpu: replies[${i}]`));
  expect(replies.length, 'deep-gpu: one reply per call').toBe(calls.length);
  for (const r of replies) if (r['code'] === 'unsupported_platform') inconclusive('deep-gpu reports unsupported_platform');
  return replies;
}

/** `deep-canvas-render <sub>` (#373, #381): one JSON line in, one out. */
export function render(bin: string, sub: string, input: JsonObject): JsonObject {
  const [answer] = lines(bin, [sub], [input]);
  expect(answer!['ok'], `deep-canvas-render ${sub} answers ok: ${shown(answer, 2000)}`).toBe(true);
  return answer!;
}

// ---------------------------------------------------------------------------------------------------
// The world: one test agent, the process its `deep show` runs in, the document, the claim.

/** A ULID: a fixed prefix padded with zeros to 26 Crockford characters. */
export function ulid(prefix: string, n: number): string { return `${prefix}${String(n).padStart(26 - prefix.length, '0')}`; }
export const DOC = ulid('01JB1162D', 1);
export const AGENT = { id: 'sess-piece', thread: 'thread-piece', name: 'Test agent: checkpoint piece', process: { pid: 4100, start: 1_000 } };
const SESSIONS: JsonObject = { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: AGENT.process } };
/** The agent (4100), its tool shell (4101) and the test process that runs `deep show` (4102). */
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 },
  { pid: 4101, ppid: 4100, start: 1_100 }, { pid: 4102, ppid: 4101, start: 1_200 },
];
export const IN_AGENT: JsonObject = { pid: 4102, start: 1_200 };
export const PANEL = 'main';
export const CLAIM = `claim:${ulid('01JB1162C', 1)}`;
export const REQ = { validate: `req:${ulid('01JB1162Q', 1)}`, honest: `req:${ulid('01JB1162Q', 2)}`, determinism: `req:${ulid('01JB1162Q', 3)}` } as const;
/** The claim (#403's form): the piece is the work; its document checks are its requirements. */
export const CLAIMS: JsonObject = {
  [CLAIM]: {
    session: AGENT.id, deliverables: [DOC],
    requirements: [
      { id: REQ.validate, check: { kind: 'document.validate' } },
      { id: REQ.honest, check: { kind: 'honest_numbers' } },
      { id: REQ.determinism, check: { kind: 'document.determinism', at_times: ['0s', '1s', '2s', '4s'], compare: 'same_machine' } },
    ],
  },
};
/** The verdict the frame's binding reads, failed, in the agent's session's record (#670's `record`). */
const RECORD: JsonObject = { [VERDICT]: { session: AGENT.id, state: 'fail' } };

/** Puts the formula's SVG and the look into the scenario's evidence store, at their SHA-256, as the hub keeps bytes. */
export function seedStore(evidence: string): void {
  for (const path of [SVG, fixturePath('look.json')]) {
    const bytes = readFileSync(path);
    const sha = sha256(bytes);
    mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
    writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), bytes);
  }
}
/** The agent's table, imported as the agent wrote it (#397's `table_import`, source `agent`). */
export const importTable = (path = TABLE, extra: JsonObject = {}): JsonObject => ({ call: 'table_import', path, key: 'key', session: AGENT.id, ...extra });
/** `deep show` of a whole revision from the test process in the agent's tree (#393). */
export const show = (document: JsonObject, extra: JsonObject = {}): JsonObject => ({ call: 'deep show', peer: IN_AGENT, doc: DOC, document, ...extra });
/** Render-back of the piece at `t`, as a snapshot of its size (#393: `include: pixels`). */
export const showAt = (document: JsonObject, t: string, extra: JsonObject = {}): JsonObject =>
  show(document, { t, size: SIZE, include: ['issues', 'pixels'], ...extra });
/** `deep show --check` against the claim (#403). */
export const showChecked = (document: JsonObject, extra: JsonObject = {}): JsonObject =>
  show(document, { check: true, claim: CLAIM, t: '0s', size: SIZE, include: ['issues', 'pixels'], ...extra });
export const REVISIONS: JsonObject = { call: 'revisions', doc: DOC };
export const VERDICT_CALL: JsonObject = { call: 'verdict', claim: CLAIM };
export const VERDICTS_CALL: JsonObject = { call: 'verdicts', claim: CLAIM };
export const READ: JsonObject = { call: 'read', doc: DOC, session: AGENT.id };
export const query = (fields: JsonObject): JsonObject => ({ call: 'deep_query', session: AGENT.id, doc: DOC, ...fields });

/** A scenario without a display clock (#393, #403): the agent, the document on its panel, the claim and the record. */
export function scenario(evidence: string, calls: JsonObject[], planted?: ShowPlanted): JsonObject {
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: { [PANEL]: { rect: [0, 0, SIZE[0], SIZE[1]] } },
    docs: { [DOC]: { panel: PANEL } }, claims: CLAIMS, record: RECORD, calls, ...(planted ? { planted } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------
// The app: the replica on the hub's virtual display clock with two displays (#400), point and ask (#384).

export interface Display { uuid: string; bounds: [number, number, number, number]; scale: number; refresh_hz: number; next_vsync: number; color_space: string }
/** The built-in display, 120 Hz, listed first, so the main window opens on it (#400's A). */
export const A: Display = { uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230', bounds: [0, 0, 1512, 982], scale: 2, refresh_hz: 120, next_vsync: FLICKS / 120, color_space: 'p3' };
/** A second display to its right, 60 Hz, its vsyncs 3 ms out of phase with A's (#400's B). */
export const B: Display = { uuid: '9C1E5F4B-6A2D-4E8F-A1B3-0D2C7E6F5A49', bounds: [1512, 0, 1920, 1080], scale: 1, refresh_hz: 60, next_vsync: 3 * MS, color_space: 'srgb' };
export const periodOf = (d: Display): number => FLICKS / d.refresh_hz;
export const onGrid = (d: Display, t: number): boolean => t >= d.next_vsync && (t - d.next_vsync) % periodOf(d) === 0;
/** The ask whose question card the shell presents (the scenario's `card`, #400). */
export const card = (at: number): JsonObject => ({
  ask: `ask:${ulid('01JB1162A', 1)}`, question: 'Keep the badge springing in?', options: [{ id: 'yes', label: 'Keep it' }, { id: 'no', label: 'Drop it' }], size: [420, 220], at,
});

export interface AppWorld { evidence: string; card?: JsonObject; planted?: ShowPlanted }
/** The app scenario: two displays on the virtual clock, the main window with the piece's panel, calls in `at` order. */
export function appScenario(w: AppWorld, calls: JsonObject[]): JsonObject {
  const sorted = calls.map((c, i) => ({ c, i })).sort((p, q) => num(p.c['at'], 'at') - num(q.c['at'], 'at') || p.i - q.i).map((p) => p.c);
  return {
    evidence: w.evidence, sessions: SESSIONS, processes: PROCESSES, clock: { lead: 2 * MS, check: MS / 2 },
    displays: [A, B].map((d) => ({ ...d })), window: [1200, 700], panels: { [PANEL]: { rect: [0, 0, SIZE[0], SIZE[1]] } },
    docs: { [DOC]: { panel: PANEL } }, record: RECORD, ...(w.card ? { card: w.card } : {}), ...(w.planted ? { planted: w.planted } : {}), calls: sorted,
  };
}
/**
 * Drives one app world step by step on the virtual clock, as #400's suite does: each step's calls are made from what
 * the steps before answered, and the whole scenario is played again from the start with them added. The piece is
 * imported and shown at the clock's first flicks.
 */
export class Driver {
  private calls: JsonObject[];
  constructor(private readonly bin: string, private readonly world: AppWorld, document: JsonObject = piece()) {
    seedStore(world.evidence);
    this.calls = [{ ...importTable(), at: 1 }, { ...show(document), at: 2 }];
  }
  step(added: JsonObject[], what: string): JsonObject[] {
    const fresh = added.map((c) => ({ ...c }));
    const s = appScenario(this.world, [...this.calls, ...fresh]);
    const [replies] = runShow(this.bin, [s], what);
    const sorted = arr(s['calls'], 'calls');
    const shown0 = replies![sorted.findIndex((c) => isObject(c) && c['call'] === 'deep show')]!;
    expect(shown0['outcome'], `${what}: the piece is presented: ${shown(shown0)}`).toBe('presented');
    this.calls = [...this.calls, ...fresh];
    return fresh.map((c) => replies![sorted.indexOf(c)]!);
  }
  one(call: JsonObject, what: string): JsonObject { return this.step([call], what)[0]!; }
}
const down = (at: number, pos: [number, number]): JsonObject => ({ call: 'input', at, panel: PANEL, event: { type: 'down', pos } });
const up = (at: number, pos: [number, number]): JsonObject => ({ call: 'input', at, panel: PANEL, event: { type: 'up', pos } });
/** Clicks a clear point of the piece's panel at `at` (#400: scope, then a press and its release) and returns the press's serial. */
export function clickPanel(d: Driver, at: number, what: string): number {
  const s = obj(obj(d.one({ call: 'scope', at, panel: PANEL }, `${what}: scope`), `${what}: scope`)['state'], `${what}: scope.state`);
  const r = arr(s['rect'], `${what}: scope.state.rect`).map((v) => num(v, 'rect'));
  const buttons = arr(s['buttons'] ?? [], `${what}: scope.state.buttons`).map((b) => arr(obj(b, 'button')['rect'], 'button.rect').map((v) => num(v, 'rect')));
  const p = ([[0.5, 0.95], [0.1, 0.95], [0.9, 0.95]] as const).map(([u, v]): [number, number] => [r[0]! + u * r[2]!, r[1]! + v * r[3]!])
    .find((c) => !buttons.some((b) => c[0] >= b[0]! && c[1] >= b[1]! && c[0] <= b[0]! + b[2]! && c[1] <= b[1]! + b[3]!));
  expect(p, `${what}: a point of the canvas clear of its buttons`).toBeDefined();
  const [press] = d.step([down(at + 5 * MS, p!), up(at + 65 * MS, p!)], `${what}: a click`);
  return num(obj(press, `${what}: the press`)['serial'], `${what}: the press's serial`);
}
export const popOut = (at: number, display: string, serial: number): JsonObject => ({ call: 'pop_out', at, panel: PANEL, display, serial });

export interface Win { window: string; kind: string; view: string | null; display: string }
export function windowsOf(reply: JsonObject | undefined, what: string): Win[] {
  return arr(obj(reply, what)['windows'], `${what}: windows`).map((v, i) => {
    const w = obj(v, `${what}: windows[${i}]`);
    return { window: str(w['window'], 'window'), kind: str(w['kind'], 'kind'), view: typeof w['view'] === 'string' ? w['view'] : null, display: str(w['display'], 'display') };
  });
}
export interface Frame { vsync: number; rev: number; window: string; display: string }
export function framesOf(reply: JsonObject | undefined, what: string): Frame[] {
  return arr(obj(reply, what)['frames'], `${what}: frames`).map((v, i) => {
    const f = obj(v, `${what}: frames[${i}]`);
    return { vsync: num(f['vsync'], 'vsync'), rev: num(f['rev'], 'rev'), window: str(f['window'], 'window'), display: str(f['display'], 'display') };
  });
}

// ---------------------------------------------------------------------------------------------------
// Replies

export interface Issue { code: string; severity: string; ids: string[]; path: string | null; raw: JsonObject }
export function issues(value: JsonValue | undefined, what: string): Issue[] {
  return arr(value ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: str(o['code'], `${what}: issues[${i}].code`), severity: String(o['severity']), ids: Array.isArray(o['ids']) ? o['ids'].map(String) : [], path: typeof o['path'] === 'string' ? o['path'] : null, raw: o };
  });
}
export interface Snapshot { sha256: string; w: number; h: number; raw: JsonObject }
export function snapshots(reply: JsonObject, what: string): Snapshot[] {
  return arr(reply['snapshots'] ?? [], `${what}: snapshots`).map((v, i) => {
    const s = obj(v, `${what}: snapshots[${i}]`);
    return { sha256: str(s['sha256'], `${what}: snapshots[${i}].sha256`), w: num(s['w'], 'w'), h: num(s['h'], 'h'), raw: s };
  });
}
export interface Revision { rev: number; hash: string; state: string }
export function current(reply: JsonObject, what: string): Revision {
  const now = arr(reply['revisions'], `${what}: revisions`).map((v, i) => {
    const o = obj(v, `${what}: revisions[${i}]`);
    return { rev: num(o['rev'], 'rev'), hash: str(o['hash'], 'hash'), state: str(o['state'], 'state') };
  }).filter((r) => r.state === 'current');
  expect(now.length, `${what}: exactly one revision is current: ${shown(reply['revisions'])}`).toBe(1);
  return now[0]!;
}

/** A verdict on the claim (#403's `verdict` call). */
export interface Blocked { code: string; kind: string; module: string | null }
export interface Row { id: string; result: string; blocked: Blocked[]; issues: Issue[]; raw: JsonObject }
export interface Verdict { result: string; stale: boolean | undefined; key: { doc: string; rev: number | undefined; hash: string | undefined }[]; rows: Row[]; raw: JsonObject }
export function verdictOf(value: JsonValue | undefined, what: string): Verdict {
  const o = obj(value, what);
  const key = isObject(o['key']) ? o['key'] : {};
  return {
    result: String(o['result']), stale: typeof o['stale'] === 'boolean' ? o['stale'] : undefined, raw: o,
    key: (Array.isArray(key['revisions']) ? key['revisions'] : []).filter(isObject).map((r) => ({
      doc: String(r['doc']), rev: typeof r['rev'] === 'number' ? r['rev'] : undefined, hash: typeof r['hash'] === 'string' ? r['hash'] : undefined,
    })),
    rows: (Array.isArray(o['requirements']) ? o['requirements'] : []).filter(isObject).map((r, i) => ({
      id: String(r['id']), result: String(r['result']), raw: r,
      blocked: (Array.isArray(r['blocked']) ? r['blocked'] : []).filter(isObject).map((b) => ({ code: String(b['code']), kind: String(b['kind']), module: typeof b['module'] === 'string' ? b['module'] : null })),
      issues: Array.isArray(r['issues']) ? issues(r['issues'], `${what}: requirements[${i}]`) : [],
    })),
  };
}
export const sameDoc = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

// ---------------------------------------------------------------------------------------------------
// Pictures: the evidence store, PNG, the blank guard, hashes

export async function readEvidence(root: string, sha: string): Promise<Buffer> {
  const store = await openEvidenceStore({ root });
  return Buffer.from(await store.read(sha));
}
export interface Image { width: number; height: number; rgba: Uint8Array; channels: number }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace (#421's reader). */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const len = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      if (Number.isNaN(v)) throw Error(`PNG filter ${filter}`);
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!; rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba, channels };
}
export type Rgb = [number, number, number];
export const hex = (c: readonly number[]): string => `#${c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
export function pixel(image: Image, x: number, y: number): Rgb {
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}
/**
 * The blank guard (technical design, How we know version 0 works: "a frame that is blank or black … (luma at most
 * 0.06 over at least 98% of its pixels, film.blank's measure)"), run before any hash is compared: a blank snapshot
 * makes the comparison BLOCKED and voids its numbers, so the test fails saying BLOCKED, never passes.
 */
export function blankGuard(png: Buffer, what: string): void {
  const img = decodePng(png);
  let dark = 0;
  for (let i = 0; i < img.width * img.height; i++) {
    const a = img.rgba[i * 4 + 3]! / 255;
    const luma = (0.2126 * img.rgba[i * 4]! + 0.7152 * img.rgba[i * 4 + 1]! + 0.0722 * img.rgba[i * 4 + 2]!) * a / 255;
    if (luma <= 0.06) dark++;
  }
  if (dark >= 0.98 * img.width * img.height) expect.fail(`BLOCKED: ${what} is blank or black (${((100 * dark) / (img.width * img.height)).toFixed(1)}% of its pixels at luma ≤ 0.06), so its hash comparison is void; this is not a pass`);
}
/**
 * Render-back's hashes across runs (#670's `hashFailures`): each time's snapshot hash in the first run equal in the
 * second run and in a fresh process; a missing snapshot is a failure. Each failure names the snapshot.
 */
export function hashFailures(times: readonly string[], first: (string | undefined)[], second: (string | undefined)[], fresh: (string | undefined)[]): string[] {
  const f: string[] = [];
  times.forEach((t, i) => {
    const [a, b, c] = [first[i], second[i], fresh[i]];
    if (!a || !b || !c) f.push(`snapshot at ${t}: missing (first ${a ?? 'none'}, second ${b ?? 'none'}, fresh ${c ?? 'none'})`);
    else {
      if (a !== b) f.push(`snapshot at ${t}: hash ${a} in the first run, ${b} on the second run in the same process`);
      if (a !== c) f.push(`snapshot at ${t}: hash ${a} in the first run, ${c} in a fresh process`);
    }
  });
  return f;
}

// ---------------------------------------------------------------------------------------------------
// deep_query (#411): values at sampled times

/** An evaluated box from a `items/<id>/bounds` value: `[[x, y, z], [x, y, z]]` or `{min, max}`, in document units. */
export interface Box { minX: number; minY: number; maxX: number; maxY: number }
export function boxOf(v: JsonValue | undefined, what: string): Box {
  let lo: JsonValue | undefined; let hi: JsonValue | undefined;
  if (Array.isArray(v)) [lo, hi] = v; else if (isObject(v)) [lo, hi] = [v['min'], v['max']];
  const a = arr(lo, `${what}: min`).map((x) => num(x, `${what}: min`));
  const b = arr(hi, `${what}: max`).map((x) => num(x, `${what}: max`));
  return { minX: a[0]!, minY: a[1]!, maxX: b[0]!, maxY: b[1]! };
}
export function valuesAt(reply: JsonObject, path: string, n: number, what: string): JsonValue[] {
  const list = arr(obj(reply['values'], `${what}: values (${shown(reply)})`)[path], `${what}: values[${path}]`);
  expect(list.length, `${what}: one value of ${path} per sampled time`).toBe(n);
  return list;
}

// ---------------------------------------------------------------------------------------------------
// The app's 3D view of the hub's document (#671's form): the document `read` returns, written to a file and opened
// by `view3d` unchanged, with the assets it names from the hub's evidence store.

/** The document as the hub holds it (`read`, #96), written as JSON under `dir`; returns it and its path. */
export function storedDoc(readReply: JsonObject, dir: string, name = 'stored'): { doc: JsonObject; path: string } {
  const doc = obj(readReply['document'], `read: the document (${shown(readReply)})`);
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(doc));
  return { doc, path };
}
/** `view3d`'s `assets` (#420): each asset the piece names, by SHA-256, at its file in the evidence store. */
export function assetsIn(evidence: string): JsonObject {
  const out: JsonObject = {};
  for (const path of [SVG, fixturePath('look.json'), TABLE]) {
    const sha = sha256(readFileSync(path));
    out[sha] = join(evidence, sha.slice(0, 2), sha.slice(2));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Glyph runs, as `raster`'s `texts` and `view3d`'s `labels` report them (#381)

export interface Glyph { font: string; size: number; id: number; x: number; y: number; grapheme: number }
export function glyphsOf(value: JsonValue | undefined, what: string): Glyph[] {
  return arr(value, what).map((v, i) => {
    const g = obj(v, `${what}[${i}]`);
    return { font: str(g['font'], 'font'), size: num(g['size'], 'size'), id: num(g['id'], 'id'), x: num(g['x'], 'x'), y: num(g['y'], 'y'), grapheme: num(g['grapheme'], 'grapheme') };
  });
}
const sameF32 = (a: number, b: number): boolean => Object.is(Math.fround(a), Math.fround(b));
/** Where two glyph runs differ (#381's `runProblems`): face, size, glyph ID, grapheme or position, f32 for f32. */
export function runProblems(expected: Glyph[], actual: Glyph[], what: string): string[] {
  if (expected.length === 0) return [`${what}: the 2D title has no glyphs`];
  if (expected.length !== actual.length) return [`${what}: ${actual.length} glyphs, not the title's ${expected.length}`];
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]!; const a = actual[i]!;
    const at = `${what}: glyph ${i} (grapheme ${e.grapheme})`;
    if (a.font !== e.font) return [`${at} is from ${a.font}, not ${e.font}`];
    if (!sameF32(a.size, e.size)) return [`${at} is shaped at ${a.size} px, not ${e.size}`];
    if (a.id !== e.id) return [`${at} is glyph ${a.id}, not ${e.id}`];
    if (a.grapheme !== e.grapheme) return [`${at} belongs to grapheme ${a.grapheme}`];
    if (!sameF32(a.x, e.x) || !sameF32(a.y, e.y)) return [`${at} sits at (${a.x}, ${a.y}), not (${e.x}, ${e.y})`];
  }
  return [];
}
/** The piece's roles as a 2D raster's role map (#381's `LOOK_2D` form), read from the look's palette. */
export function roleMap(): JsonObject {
  const palette = obj(LOOK['palette'], 'look.palette');
  const roles = obj(LOOK['roles'], 'look.roles');
  const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return { light: Object.fromEntries(Object.entries(roles).map(([r, p]) => [r, rgb(str(palette[str(p, r)], `palette of ${r}`))])) };
}

// ---------------------------------------------------------------------------------------------------
// The status outline (#421 AC5's check): the exact fail color in a ring around the item's silhouette

export const FAIL = '#bf232b';
/** Grows a mask by `r` px, as a square (#421's `grow`). */
export function grow(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const rows = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    let last = -Infinity;
    for (let x = 0; x < width; x++) { if (mask[y * width + x]) last = x; if (x - last <= r) rows[y * width + x] = 1; }
    last = Infinity;
    for (let x = width - 1; x >= 0; x--) { if (mask[y * width + x]) last = x; if (last - x <= r) rows[y * width + x] = 1; }
  }
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    let last = -Infinity;
    for (let y = 0; y < height; y++) { if (rows[y * width + x]) last = y; if (y - last <= r) out[y * width + x] = 1; }
    last = Infinity;
    for (let y = height - 1; y >= 0; y--) { if (rows[y * width + x]) last = y; if (last - y <= r) out[y * width + x] = 1; }
  }
  return out;
}
/** A file `view3d` wrote, named by its SHA-256 (#378). */
export function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  expect(typeof hash === 'string' && SHA.test(hash), `${what} is written, named by a SHA-256: ${shown(hash)}`).toBe(true);
  const file = readFileSync(join(out, `${String(hash)}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** The object-ID target (#378): pick ID r + 2^8 g + 2^16 b + 2^24 a, named by the frame's `picks`; null where nothing draws. */
export function idsOf(out: string, frame: JsonObject, what: string): (x: number, y: number) => string | null {
  const png = decodePng(readNamed(out, frame['ids'], 'png', `${what}: ids`));
  const picks = obj(frame['picks'], `${what}: picks`);
  return (x, y) => {
    const o = (y * png.width + x) * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    const id = picks[String(pick)];
    return pick === 0 ? null : typeof id === 'string' ? id : `unknown:${pick}`;
  };
}
