// Test-side tools for the #2513 acceptance tests (README: The surface under test): `deep-show` built with the `full`
// feature set and driven by JSON lines (#393's `deep-show run`, its `deep_show` render-back with pixels and its
// `revisions`, #403's claims and `verdict`, #387's `planted`), kept open for the timing as #412's budgets are; the
// frame-filling fixture the criteria name, generated here; the judge that holds the snapshot readings and
// render.exposure's numbers to each other and to the issue's expected values; and the perf lane's own timing rule
// (scripts/benchmark.mjs). Nothing here stands in for the readings or the check: every number a test compares comes from
// the binary, every expected value from the issue and the design. Parts are copied from #1939's helpers, since suites
// don't import each other.

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
/** The checkout root (tests/acceptance/2513 is three levels down). */
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
// The build: `deep-show` with `full`, copied out of target/ (debug, or release for the timing).

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
    dir = mkdtempSync(join(tmpdir(), 'deep-2513-bin-'));
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
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-2513-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// The world a scenario holds: the working agent alpha, the process table, one panel, its documents and claims.

const SESSION = 'sess-alpha';
const WORLD: JsonObject = {
  sessions: { [SESSION]: { thread: 'thread-alpha', name: 'Claude Code: the reduction', process: { pid: 4100, start: 1_000 } } },
  processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }],
  panels: { main: { rect: [0, 0, 1280, 720] } },
};
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB2513D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB2513C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB2513Q', n)}`;

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
  expect(replies.length, `${SHOW} run: one reply per call`).toBe(arr(scenario['calls'], 'the scenario\'s calls').length);
  return replies;
}

/**
 * A `deep-show run` process kept open, one scenario a line (#412's budgets): each answer and its wall time. A line it
 * prints before a scenario is sent (a refusal at start) is kept for the next send, and its end answers every wait.
 */
export class Streamed {
  private child: ChildProcessWithoutNullStreams;
  private early: string[] = [];
  private waiting: ((line: string | null) => void)[] = [];
  private ended = false;
  private stderr = '';
  constructor(bin: string) {
    this.child = spawn(bin, ['run'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', (line) => { const w = this.waiting.shift(); if (w) w(line); else this.early.push(line); });
    lines.on('close', () => { this.ended = true; for (const w of this.waiting.splice(0)) w(null); });
    this.child.stderr.on('data', (d: Buffer) => { this.stderr = (this.stderr + d.toString()).slice(-3000); });
    this.child.stdin.on('error', () => { /* the process ended; its end is reported by send */ });
  }
  /**
   * One scenario: its replies, and the wall time from writing its line to reading its answer, in ms. A binary whose
   * seal refuses it (`seal_refused`) answers no render-back, so nothing can be timed: INCONCLUSIVE, never a pass.
   */
  async send(scenario: JsonObject): Promise<{ replies: JsonObject[]; ms: number }> {
    const line = this.early.length > 0 ? Promise.resolve(this.early.shift()!)
      : this.ended ? Promise.resolve(null) : new Promise<string | null>((done) => this.waiting.push(done));
    const t0 = process.hrtime.bigint();
    if (!this.ended) this.child.stdin.write(`${JSON.stringify(scenario)}\n`);
    const text = await line;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (text === null) expect.fail(`${SHOW} run (kept open) ended before it answered (exit ${String(this.child.exitCode)}): ${this.stderr}`);
    const out = obj(JSON.parse(text) as JsonValue, `${SHOW} run (kept open): the answer`);
    if (out['ok'] === false && out['code'] === 'seal_refused') inconclusive(`${SHOW} refuses to start, so no render-back can be timed: ${text.slice(0, 1500)}`);
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
// The fixture (README: Fixtures). Metres, +Y up; agent-form documents (#393): no `id`, no `layers`, no item `layer`.

/** The frame both criteria name, the document's own size: render.exposure draws its frame at it, and the render-back asks for it. */
export const FRAME: [number, number] = [1936, 1584];
/**
 * The kept card's side, in m. Framed by `fit` with `fill` 1 and `pad` 0 (Camera `camera@1`: framing), its side spans
 * all of the frame's shorter side, its 1584 px height, so through the orthographic camera the view is 1936 px × side ÷
 * 1584 px = 1 m wide, 1936 px a metre either way.
 */
export const SIDE = FRAME[1] / FRAME[0];
/** The card face on: a square of the frame's height, 1584 × 1584 px, centred, black sky on its left and right. */
export const AREA = FRAME[1] * FRAME[1];
/** The px along that square's outline, the most an edge can add or take away: 2 × (1584 + 1584). */
export const EDGE = 2 * (FRAME[1] + FRAME[1]);
/** The kept card, and a coincident stand-in that never shows (criterion 2's "off"). */
export const SUBJECT = 'card';
export const STAND_IN = 'stand-in';
/** The card's linear grey: middle grey. */
export const GREY = 0.18;
/** An EV100 is an exposure scale of 1 ÷ (1.2 × 2^EV100) (render.exposure's own fix): 1 − log2 1.2 is a scale of ½. */
export const EV100 = 1 - Math.log2(1.2);
/** The card's grey at the camera's exposure, against middle grey: log2(0.18 × ½ ÷ 0.18) = −1 EV. */
export const KEY_EV = Math.log2((GREY * (1 / (1.2 * 2 ** EV100))) / 0.18);

/** An unlit, opaque, double-sided material of linear grey `v`. */
const unlit = (v: number): JsonObject =>
  ({ kind: 'material@1', params: { base_color: [v, v, v, 1], unlit: true, alpha_mode: 'opaque', alpha: 1, double_sided: true } });
const card = (extra: JsonObject = {}): JsonObject =>
  ({ kind: 'mark.box@1', params: { size: [SIDE, SIDE, 0.05] }, at: { pos: [0, 1, 0] }, material: 'grey-mat', ...extra });

/**
 * A thin square card of linear grey 0.18 (middle grey), unlit, at (0, 1, 0), face on to the camera `cam`: orthographic,
 * level, from +Z, aimed at the card, keeping `keep` by `fit` with `fill` 1 and `pad` 0, so the card spans the
 * 1936 × 1584 frame's height; exposed a stop under (EV100 1 − log2 1.2). A black sky with no ambient light fills the
 * rest. With the stand-in, the document also holds an invisible card of the same size where the card is.
 */
export function fillDoc(keep: string, standIn: boolean): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'orthographic', target: [0, 1, 0], orbit: { azimuth: 0, elevation: 0 }, near: 0.05, far: 50, fit: { keep: [keep], fill: 1, pad: 0 }, exposure: EV100 } },
    sky: { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } },
    'grey-mat': unlit(GREY),
    [SUBJECT]: card(),
    ...(standIn ? { [STAND_IN]: card({ visible: false }) } : {}),
  };
  let k = 0;
  const named: JsonObject = {};
  for (const [id, item] of Object.entries(items)) named[id] = { id, name: id, order: `a${String(k++).padStart(4, '0')}`, ...item };
  return {
    format: 1, profile: 'scene',
    title: 'A grey card filling the frame',
    description: keep === SUBJECT
      ? 'A middle grey card the camera keeps, framed to the height of the frame and exposed a stop under.'
      : 'A middle grey card beside a hidden stand-in the camera keeps, framed to the height of the frame.',
    size: [...FRAME], camera: 'cam', requires: { modules: { scene3d: '^1' } }, items: named,
  };
}

// ---------------------------------------------------------------------------------------------------
// The replies: deep_show's snapshots and their readings, the verdict's row (README: The surface under test)

/** The field each snapshot entry carries its readings in (#1939). */
export const LIGHT = 'light';
export type Light = { clipped: number; crushed: number; key_ev: number };
/** render.exposure's numbers at one checked time: the readings' three, and the px it measured them over. */
export type Exposure = Light & { px: number };
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
 * Why a deep_show reply of the frame-filling revision and render.exposure's numbers `check` on that revision don't meet
 * criterion 1: each snapshot is 1936 × 1584 px and carries readings whose clipped share, crushed share and key EV are
 * each within 1e-6 of render.exposure's; render.exposure's px is the card's area in the frame (1584 × 1584) within its
 * edge px; its key EV is the card's grey at the camera's exposure (−1 EV) within 0.002 EV. Every failure names its
 * snapshot by its SHA-256.
 */
export function judge(reply: JsonObject, check: Exposure, what: string): string[] {
  const snaps = snapshotsOf(reply, what);
  if (snaps.length === 0) return [`${what} returns no snapshot with pixels`];
  const failures: string[] = [];
  for (const s of snaps) {
    const name = `snapshot ${String(s['sha256'])}`;
    if (s['w'] !== FRAME[0] || s['h'] !== FRAME[1]) failures.push(`${name} is ${brief(s['w'])} × ${brief(s['h'])} px, not the ${FRAME[0]} × ${FRAME[1]} frame`);
    const l = lightOf(s);
    if (!l) failures.push(`${name} carries no readings (${LIGHT}: clipped, crushed, key_ev): ${brief(s, 600)}`);
    else {
      for (const k of KEYS) {
        if (!(Math.abs(l[k] - check[k]) <= 1e-6)) failures.push(`${name} reads ${k} ${l[k]}, where render.exposure reads ${check[k]} on the same revision, ${Math.abs(l[k] - check[k])} apart (over 1e-6)`);
      }
    }
    if (!(Math.abs(check.px - AREA) <= EDGE)) failures.push(`${name}: render.exposure on its revision counts ${check.px} px of the card, where the card's area in the frame is ${AREA} px within its ${EDGE} edge px (${check.px - AREA} off)`);
    if (!(Math.abs(check.key_ev - KEY_EV) <= 0.002)) failures.push(`${name}: render.exposure on its revision reads key ${check.key_ev} EV, where the card's grey at the camera's exposure is ${KEY_EV} EV (${Math.abs(check.key_ev - KEY_EV)} apart, over 0.002)`);
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
 * render.exposure's row for requirement `req` and its numbers on `doc` at the start (`results`: `{t, px, clipped,
 * crushed, key_ev, …}`). A machine that couldn't draw the frame on a GPU can't decide: the test fails INCONCLUSIVE.
 */
export function exposureOf(v: JsonObject, req: string, doc: string): { row: JsonObject; check: Exposure } {
  const row = arr(v['requirements'], 'the verdict\'s requirements').filter(isObject).find((r) => r['id'] === req);
  expect(row, `the verdict has a row for render.exposure: ${brief(v)}`).toBeDefined();
  const notes = [...(Array.isArray(row!['blocked']) ? row!['blocked'] : []), ...(Array.isArray(row!['inconclusive']) ? row!['inconclusive'] : [])].filter(isObject);
  const gpu = notes.find((b) => ['gpu_unavailable', 'unsupported_platform', 'software_adapter'].includes(String(b['code'])) || b['reason'] === 'unsupported_platform');
  if (gpu) inconclusive(`render.exposure couldn't draw on this machine's GPU: ${brief(gpu, 400)}`);
  const at = arr(row!['results'], `render.exposure's row: results (${brief(row, 1200)})`).filter(isObject).filter((r) => r['doc'] === doc && r['t'] === 0);
  expect(at.length, `render.exposure measures ${doc} once at the start: ${brief(row!['results'])}`).toBe(1);
  const r = at[0]!;
  return {
    row: row!,
    check: { px: num(r['px'], 'results: px'), clipped: num(r['clipped'], 'results: clipped'), crushed: num(r['crushed'], 'results: crushed'), key_ev: num(r['key_ev'], 'results: key_ev') },
  };
}

/** Prints what the issue's Proof line asks to see, so a passing run shows it. */
export function proof(label: string, value: JsonValue): void {
  console.log(`PROOF #2513 ${label}: ${JSON.stringify(value)}`);
}

// ---------------------------------------------------------------------------------------------------
// The machine: the perf lane's own rule (scripts/benchmark.mjs)

/** The one-minute load average, which `judgeLimit` reads at each run's start and end. */
export const load = (): number => loadavg()[0]!;
interface Bench { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject }
const bench = async (): Promise<Bench> => (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
const zeros = (): { start: number; end: number }[] => Array.from({ length: 5 }, () => ({ start: 0, end: 0 }));
/** Five runs after warm-up on a reference Mac on mains power, Low Power Mode off, thermal state nominal, the load at
 * each run's start and end within the cores: PASS, FAIL, or INCONCLUSIVE with the runs. */
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const b = await bench();
  return b.judgeLimit({ limit, runs, fingerprint: b.fingerprint(), loads });
}
/**
 * Why this machine isn't one of the reference Macs by its hardware, or '' when it is: the lane's own verdict on five
 * zero runs with the conditions a run reads (mains power, Low Power Mode, thermal state, the load) set as they must be,
 * so only the model, chip and memory decide. A loaded reference Mac still gives the issue's Proof its reading.
 */
export async function hardwareProblem(): Promise<string> {
  const b = await bench();
  const machine = b.fingerprint();
  const at = { ...machine, power: 'ac', lowPowerMode: false, thermalState: 'nominal', macosBuild: machine['macosBuild'] ?? 'unread' };
  const v = b.judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint: at, loads: zeros() });
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}
