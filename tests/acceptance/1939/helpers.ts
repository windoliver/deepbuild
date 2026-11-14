// Test-side tools for the #1939 acceptance tests (README: The surface under test): `deep-show` built with the `full`
// feature set and driven by JSON lines (#393's `deep-show run`, its `deep_show` render-back with pixels and its
// `revisions`, #403's claims and `verdict`, #387's `planted`), kept open for the timings as #412's budgets are; the
// fixtures the criteria name, generated here; reading the snapshot's readings and the verdict row's render.exposure
// numbers; and the perf lane's own timing rule (scripts/benchmark.mjs). Nothing here stands in for the readings or the
// check: every number a test compares comes from the binary, every expected value from the issue and the design. Parts
// are copied from #1938's, #2017's and #412's helpers, since suites don't import each other.

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1939 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${brief(v, 200)}`).toBe(true);
  return v as number;
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A test that can't be judged here fails with this, never passes (AGENTS.md: nothing unrun passes). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A 3D revision is drawn, and its pixels read, on macOS's Metal device; deep-show has no software 3D rasteriser. */
export function requireMetal(what: string): void {
  if (process.platform !== 'darwin') inconclusive(`${what} draws a 3D revision on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show` with `full`, copied out of target/ (debug, or release for the timings).

const SHOW = 'deep-show';
const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
const targetDir = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));
const cargoArgs = (release: boolean): string[] => ['build', '--locked', ...(release ? ['--release'] : []), '--bin', SHOW, '--no-default-features', '--features', 'full'];

/** Builds `deep-show` (debug, or release) and copies it into `dir`: its path, or cargo's error; `ran` is false when cargo couldn't start. */
export function buildInto(release: boolean, dir: string): { path: string; error: string; ran: boolean } {
  const args = cargoArgs(release);
  const env = {
    ...process.env, PATH: `${TOOLCHAIN}${delimiter}/opt/homebrew/opt/rustup/bin${delimiter}${process.env['PATH'] ?? ''}`,
    CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  };
  const r = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { path: '', error: `cargo could not run: ${r.error.message}`, ran: false };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { path: '', error: `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}`, ran: true };
  }
  const path = join(dir, `${SHOW}${release ? '-release' : ''}`);
  copyFileSync(join(targetDir(), release ? 'release' : 'debug', SHOW), path);
  return { path, error: '', ran: true };
}

/** Builds the debug binary once, before the file's tests. A test whose build failed fails with cargo's error; without cargo it can't decide. */
export function useBuild(): () => string {
  let dir = '';
  let made: { path: string; error: string; ran: boolean } | undefined;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1939-bin-'));
    made = buildInto(false, dir);
  }, 2 * TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    if (!made) throw Error('the build never ran');
    if (!made.ran) inconclusive(made.error);
    expect(made.error, `the binary builds: cargo ${cargoArgs(false).join(' ')}`).toBe('');
    return made.path;
  };
}

/** Fresh folders for a test (evidence stores, a release build), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-1939-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// The world a scenario holds: the working agent alpha, the process table, one panel, its documents and claims.

const SESSION = 'sess-alpha';
const WORLD: JsonObject = {
  sessions: { [SESSION]: { thread: 'thread-alpha', name: 'Claude Code: the light', process: { pid: 4100, start: 1_000 } } },
  processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }],
  panels: { main: { rect: [0, 0, 1280, 720] } },
};
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB1939D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB1939C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB1939Q', n)}`;

/** The requirement the readings are compared with: render.exposure at every default (its subject the kept items). */
export const EXPOSURE: JsonObject = { kind: 'render.exposure' };
/** Alpha's claim on one deliverable, its one requirement `check`. */
export const claimOf = (doc: string, req: string, check: JsonObject): JsonObject =>
  ({ session: SESSION, deliverables: [doc], requirements: [{ id: req, check }] });

/** One scenario: `docs` minted on the panel with no revision yet, the claims, the calls, and a planted program by name (#387). */
export function scenarioOf(evidence: string, docs: readonly string[], claims: JsonObject, calls: JsonObject[], planted?: string): JsonObject {
  return {
    evidence, ...WORLD,
    docs: Object.fromEntries(docs.map((d) => [d, { panel: 'main' }])),
    claims,
    ...(planted ? { planted } : {}),
    calls,
  };
}

/** Alpha's deep_show of a whole revision at the start, rendered back with pixels at `size` px (#393). */
export const show = (doc: string, document: JsonObject, size: readonly [number, number]): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc, document, t: '0s', size: [...size], include: ['issues', 'pixels'] });
export const verdict = (claim: string): JsonObject => ({ call: 'verdict', claim });
export const revisions = (doc: string): JsonObject => ({ call: 'revisions', doc });

/** One `deep-show run` process: one scenario line in, one answer line out (exit 0); its replies, one per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  expect(timedOut, `${SHOW} run finished within its timeout`).toBe(false);
  expect(r.status, `${SHOW} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(out['ok'], `${SHOW} run accepted the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${SHOW} run: replies`).map((v, i) => obj(v, `${SHOW} run: replies[${i}]`));
  expect(replies.length, `${SHOW} run: one reply per call`).toBe(calls(scenario).length);
  return replies;
}
const calls = (scenario: JsonObject): JsonValue[] => arr(scenario['calls'], 'the scenario\'s calls');

/** A `deep-show run` process kept open, one scenario a line (#412's budgets): each answer and its wall time. */
export class Streamed {
  private child: ChildProcessWithoutNullStreams;
  private waiting: ((line: string) => void)[] = [];
  constructor(bin: string) {
    this.child = spawn(bin, ['run'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: this.child.stdout }).on('line', (line) => this.waiting.shift()?.(line));
    this.child.stderr.resume();
  }
  /** One scenario: its replies, and the wall time from writing its line to reading its answer, in ms. */
  async send(scenario: JsonObject): Promise<{ replies: JsonObject[]; ms: number }> {
    const line = new Promise<string>((done) => this.waiting.push(done));
    const t0 = process.hrtime.bigint();
    this.child.stdin.write(`${JSON.stringify(scenario)}\n`);
    const text = await line;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const out = obj(JSON.parse(text) as JsonValue, `${SHOW} run (kept open): the answer`);
    expect(out['ok'], `${SHOW} run (kept open) answers the scenario: ${text.slice(0, 1500)}`).toBe(true);
    return { replies: arr(out['replies'], 'replies').map((r, i) => obj(r, `replies[${i}]`)), ms };
  }
  /** Stops the process this test started, by its PID. */
  close(): void {
    this.child.stdin.end();
    if (this.child.pid !== undefined && this.child.exitCode === null) {
      try { process.kill(this.child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }
}
export const median = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

// ---------------------------------------------------------------------------------------------------
// The fixtures (README: Fixtures). Metres, +Y up; agent-form documents (#393): no `id`, no `layers`, no item `layer`.

/** The document's own size, the size render.exposure draws its frame at, and the size AC1's render-back asks for. */
export const DOC_SIZE: [number, number] = [320, 240];
/** The criterion 2 render-back's size. */
export const BIG: [number, number] = [1936, 1584];
/** The kept subject, a coincident stand-in that never shows, and a prop beside the subject that the camera doesn't keep. */
export const SUBJECT = 'subject';
export const STAND_IN = 'stand-in';
/** An EV100 is an exposure scale of 1 ÷ (1.2 × 2^EV100) (render.exposure's own fix): −log2 1.2 exposes at scale 1. */
export const UNIT_EV100 = -Math.log2(1.2);
/** The planted fixture is three stops under: EV100 3 − log2 1.2, a scale of 1/8, so middle grey's key reads −3 EV. */
export const UNDER_EV100 = UNIT_EV100 + 3;

/** An unlit, opaque, double-sided material of linear grey `v`. */
const unlit = (v: number): JsonObject =>
  ({ kind: 'material@1', params: { base_color: [v, v, v, 1], unlit: true, alpha_mode: 'opaque', alpha: 1, double_sided: true } });
const box = (size: number, pos: [number, number, number], material: string, extra: JsonObject = {}): JsonObject =>
  ({ kind: 'mark.box@1', params: { size: [size, size, size] }, at: { pos }, material, ...extra });

export interface Fixture {
  /** The camera's exposure, an EV100. */
  ev100: number;
  /** The item the camera keeps (`fit.keep`): the subject, or the stand-in, which shows no px. */
  keep: string;
  /** The document's size. */
  size: [number, number];
  /** Whether the document holds the invisible stand-in. */
  standIn: boolean;
}
/**
 * A 0.2 m cube of linear grey 0.18 (middle grey) at (0, 1, 0), the camera's kept subject, beside a 0.12 m prop of linear
 * grey 0.72 (two stops over middle grey) at (0.22, 1, 0), which the camera doesn't keep, under a black sky with no
 * ambient light. Both materials are unlit, so the px each draws are its grey at the camera's exposure. The camera
 * `cam` is perspective, 40° across the wider side, level, from +Z, on the subject, keeping it by `fit.keep`. With the
 * stand-in, the document also holds an invisible 0.2 m cube where the subject is.
 */
export function lightDoc(f: Fixture): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: [0, 1, 0], orbit: { azimuth: 0, elevation: 0 }, fov: 40, near: 0.05, far: 50, fit: { keep: [f.keep] }, exposure: f.ev100 } },
    sky: { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } },
    'grey-mat': unlit(0.18),
    'pale-mat': unlit(0.72),
    [SUBJECT]: box(0.2, [0, 1, 0], 'grey-mat'),
    prop: box(0.12, [0.22, 1, 0], 'pale-mat'),
    ...(f.standIn ? { [STAND_IN]: box(0.2, [0, 1, 0], 'grey-mat', { visible: false }) } : {}),
  };
  let k = 0;
  const named: JsonObject = {};
  for (const [id, item] of Object.entries(items)) named[id] = { id, name: id, order: `a${String(k++).padStart(4, '0')}`, ...item };
  const under = f.ev100 > UNIT_EV100 + 0.5;
  return {
    format: 1, profile: 'scene',
    title: under ? 'An underexposed grey cube' : 'A grey cube at middle grey',
    description: under ? 'A grey cube the camera keeps, exposed too dark beside a pale prop.' : 'A grey cube the camera keeps, exposed to middle grey beside a pale prop.',
    size: [...f.size], camera: 'cam', requires: { modules: { scene3d: '^1' } }, items: named,
  };
}

// ---------------------------------------------------------------------------------------------------
// The replies: deep_show's snapshots and their readings, the verdict's row (README: The surface under test)

/** The field each snapshot entry carries its readings in (README: Assumed surfaces 1). */
export const LIGHT = 'light';
export type Light = { clipped: number; crushed: number; key_ev: number };
const KEYS = ['clipped', 'crushed', 'key_ev'] as const;

/** The reply's snapshot entries (`{sha256, w, h, …}`), and that the revision was presented. */
export function snapshotsOf(reply: JsonObject, what: string): JsonObject[] {
  expect(reply['outcome'], `${what} is presented: ${brief(reply, 2000)}`).toBe('presented');
  return arr(reply['snapshots'], `${what}: snapshots`).map((s, i) => obj(s, `${what}: snapshots[${i}]`));
}
/** A snapshot's readings, or null when it carries none: `light` absent, or not all three finite numbers. */
export function lightOf(snapshot: JsonObject): Light | null {
  const l = snapshot[LIGHT];
  if (!isObject(l) || !KEYS.every((k) => typeof l[k] === 'number' && Number.isFinite(l[k]))) return null;
  return { clipped: l['clipped'] as number, crushed: l['crushed'] as number, key_ev: l['key_ev'] as number };
}

/**
 * Why a deep_show reply's snapshots don't carry `check`, render.exposure's numbers on the same revision (AC1): each
 * snapshot carries clipped, crushed and key_ev, each within 1e-6 of the check's. Every failure names its snapshot by
 * its SHA-256.
 */
export function readingFailures(reply: JsonObject, check: Light, what: string): string[] {
  const snaps = snapshotsOf(reply, what);
  if (snaps.length === 0) return [`${what} returns no snapshot with pixels`];
  const failures: string[] = [];
  for (const s of snaps) {
    const name = `snapshot ${String(s['sha256'])}`;
    const l = lightOf(s);
    if (!l) { failures.push(`${name} carries no readings (${LIGHT}: clipped, crushed, key_ev): ${brief(s, 600)}`); continue; }
    for (const k of KEYS) {
      if (!(Math.abs(l[k] - check[k]) <= 1e-6)) failures.push(`${name} reads ${k} ${l[k]}, where render.exposure reads ${check[k]} on the same revision, ${Math.abs(l[k] - check[k])} apart (over 1e-6)`);
    }
  }
  return failures;
}

/** The revision a verdict judged `doc` at: its key's `{rev, hash}`. */
export function judgedRevision(v: JsonObject, doc: string): { rev: number; hash: string } {
  const list = arr(obj(v['key'], 'the verdict\'s key')['revisions'], 'the verdict\'s key: revisions').filter(isObject);
  const r = list.find((x) => x['doc'] === doc);
  expect(r, `the verdict is keyed by a revision of ${doc}: ${brief(v['key'])}`).toBeDefined();
  return { rev: num(r!['rev'], 'the verdict\'s rev'), hash: String(r!['hash']) };
}
/** The hash a `revisions` reply gives revision `rev`. */
export function hashOf(reply: JsonObject, rev: number): string {
  const row = arr(reply['revisions'], 'revisions').filter(isObject).find((r) => r['rev'] === rev);
  expect(row, `the document has a revision ${rev}: ${brief(reply['revisions'])}`).toBeDefined();
  return String(row!['hash']);
}

/**
 * render.exposure's row for requirement `req` and its numbers on `doc` at the start (`results`: `{t, clipped, crushed,
 * key_ev, …}`). A machine that couldn't draw the frame on a GPU can't decide: the test fails INCONCLUSIVE.
 */
export function exposureOf(v: JsonObject, req: string, doc: string): { row: JsonObject; check: Light } {
  const row = arr(v['requirements'], 'the verdict\'s requirements').filter(isObject).find((r) => r['id'] === req);
  expect(row, `the verdict has a row for render.exposure: ${brief(v)}`).toBeDefined();
  const notes = [...(Array.isArray(row!['blocked']) ? row!['blocked'] : []), ...(Array.isArray(row!['inconclusive']) ? row!['inconclusive'] : [])].filter(isObject);
  const gpu = notes.find((b) => ['gpu_unavailable', 'unsupported_platform', 'software_adapter'].includes(String(b['code'])) || b['reason'] === 'unsupported_platform');
  if (gpu) inconclusive(`render.exposure couldn't draw on this machine's GPU: ${brief(gpu, 400)}`);
  const at = arr(row!['results'], `render.exposure's row: results (${brief(row, 1200)})`).filter(isObject).filter((r) => r['doc'] === doc && r['t'] === 0);
  expect(at.length, `render.exposure measures ${doc} once at the start: ${brief(row!['results'])}`).toBe(1);
  const r = at[0]!;
  return { row: row!, check: { clipped: num(r['clipped'], 'results: clipped'), crushed: num(r['crushed'], 'results: crushed'), key_ev: num(r['key_ev'], 'results: key_ev') } };
}

/** Prints what the issue's Proof line asks to see ("with the issues as data"), so a passing run shows it. */
export function proof(label: string, value: JsonValue): void {
  console.log(`PROOF #1939 ${label}: ${JSON.stringify(value)}`);
}

// ---------------------------------------------------------------------------------------------------
// The machine: the perf lane's own rule (scripts/benchmark.mjs)

/** The one-minute load average, which `judgeLimit` reads at each run's start and end. */
export const load = (): number => loadavg()[0]!;
interface Bench { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject }
const bench = async (): Promise<Bench> => (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
/** Five runs after warm-up on a reference Mac on mains power, Low Power Mode off, thermal state nominal, the load at
 * each run's start and end within the cores: PASS, FAIL, or INCONCLUSIVE with the runs. */
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const b = await bench();
  return b.judgeLimit({ limit, runs, fingerprint: b.fingerprint(), loads });
}
/** Why this machine can't judge a timing now, or '' when it can: the lane's verdict on five zero runs at this load. */
export async function timingProblem(): Promise<string> {
  const now = load();
  const v = await judgeLimit(1, [0, 0, 0, 0, 0], Array.from({ length: 5 }, () => ({ start: now, end: now })));
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}
