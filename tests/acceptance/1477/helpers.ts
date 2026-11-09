// Test-side tools for the #1477 acceptance tests: the bench (`lists_1477`, a deep-app test target) built once in
// release, plain and with each planted twin; its one-shot calls and its line sessions; the lane's reference-Mac rule
// (scripts/benchmark.mjs's own judgeLimit and fingerprint); the readers of the record and of each arm; and the checks
// the criteria's planted twins must fail, each returning its failures as sentences that name what failed. Nothing
// here stands in for the window, the table, the list, the sort or the accessibility tree under test.

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** This suite's folder. */
export const SUITE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1477 is three levels down). */
export const REPO = join(SUITE, '..', '..', '..');
/** The bench: a `[[test]]` target of deep-app with `harness = false` (README: The bench). */
export const BENCH = 'lists_1477';
/** The committed measurement record (the issue's Proof). */
export const RECORD = 'docs/spikes/1477/record.json';
/** #1433's record, in the style of #337's (its Scope: "`record.json` in `docs/spikes`"). */
export const RECORD_1433 = 'docs/spikes/1433/record.json';

// ---------------------------------------------------------------------------------------------------
// The issue's numbers.

/** "a real window at 1,200 × 700 px with 32 px rows, 8 columns and two rows of scroll per frame". */
export const WINDOW: [number, number] = [1200, 700];
export const ROW_PX = 32;
export const COLUMNS = 8;
/** "at 100,000 × 8 for 8 s": every arm's counted seconds; at least 60 frames a second. */
export const SECONDS = 8;
export const MIN_FRAMES = SECONDS * 60;
export const TABLE_ROWS = 100_000;
/** "a variable-height list at 10,000 and 100,000 rows". */
export const LIST_ROWS = { 'list-10k': 10_000, 'list-100k': 100_000 } as const;
/** "If a table arm misses 4 ms at p99"; "update p99 under 4 ms"; "at most 4 ms". */
export const UPDATE_MS = 4;
/** "working set above data under 64 MB", read as 64,000,000 bytes. */
export const LIST_BYTES = 64_000_000;
/** "allocations per frame net of the blank arm at most 200". */
export const NET_ALLOCATIONS = 200;
/** "every row's top sits within 0.5 px of its exact position" at "1,000,000 rows scrolled to the last row". */
export const OFFSET_ROWS = 1_000_000;
export const OFFSET_PX = 0.5;
/** The precise scroll back up after End, in px: an offset f32 can't hold at 1,000,000 rows (README). */
export const NUDGE_PX = 0.75;
/** "sorting 1,000,000 shuffled rows by a number takes at most 40 ms from cold". */
export const SORT_ROWS = 1_000_000;
export const SORT_MS = 40;
/** The equivalence table: one row over 2^18, so the "parallel above 2^18 rows" path runs. */
export const EQUAL_ROWS = 2 ** 18 + 1;
/** "a return over rows shown in the last 240 frames": 120 frames down, then 120 back. */
export const RETURN_FRAMES = 120;
/** "scrolling down 1,000 rows and back shapes 0 strings on the way back". */
export const BACK_ROWS = 1000;
/** "`usize::MAX ÷ 4` rows", on a 64-bit Mac. */
export const QUARTER_USIZE = ((2n ** 64n - 1n) / 4n).toString();

export const TABLE_ARMS = ['kit', 'panel'] as const;
export const LIST_ARMS = ['list-10k', 'list-100k'] as const;
/** Every arm the record holds; `ours` only when the decision is build. */
export const ARMS = ['blank', ...TABLE_ARMS, ...LIST_ARMS] as const;
export type ArmName = (typeof ARMS)[number] | 'ours';

export type Plant = 'plant-element-per-cell' | 'plant-f32-offset' | 'plant-unstable-text-sort';

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
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)?.slice(0, 200)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
/** A count the bench writes as a decimal string, exact past 2^53. */
export function count(value: JsonValue | undefined, what: string): bigint {
  expect(typeof value === 'string' && /^\d+$/.test(value), `${what} is a decimal string, got ${JSON.stringify(value)}`).toBe(true);
  return BigInt(value as string);
}

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** Every criterion reads a real window, or the reference Mac's clock: macOS only. */
export function requireMac(): void {
  if (process.platform !== 'darwin') inconclusive(`these criteria need a real window on the reference Mac; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: `cargo test --release --locked -p deep-app --test lists_1477 --no-run [--features <plant>]`, copied out.

const builds = new Map<string, { path: string; error: string }>();
let binDir = '';

function build(plant?: Plant): { path: string; error: string } {
  const key = plant ?? 'plain';
  const cached = builds.get(key);
  if (cached) return cached;
  const args = ['test', '--release', '--locked', '-p', 'deep-app', '--test', BENCH, '--no-run', '--message-format=json-render-diagnostics', ...(plant ? ['--features', plant] : [])];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  let result: { path: string; error: string };
  if (run.error) result = { path: '', error: `cargo could not run: ${run.error.message}` };
  else if (run.status !== 0) result = { path: '', error: `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Executable/.test(l)).join('\n').slice(0, 4000)}` };
  else {
    const exe = run.stdout.split('\n').flatMap((line) => {
      try {
        const m = JSON.parse(line) as { reason?: string; target?: { name?: string }; executable?: string | null };
        return m.reason === 'compiler-artifact' && m.target?.name === BENCH && m.executable ? [m.executable] : [];
      } catch { return []; }
    }).at(-1);
    if (!exe) result = { path: '', error: `cargo ${args.join(' ')} named no ${BENCH} executable` };
    else {
      if (!binDir) binDir = mkdtempSync(join(tmpdir(), 'deep-1477-bin-'));
      const path = join(binDir, `${BENCH}-${key}`);
      copyFileSync(exe, path);
      result = { path, error: '' };
    }
  }
  builds.set(key, result);
  return result;
}
function built(plant?: Plant): string {
  const b = build(plant);
  expect(b.error, `the bench builds: cargo test --release --locked -p deep-app --test ${BENCH} --no-run${plant ? ` --features ${plant}` : ''}`).toBe('');
  return b.path;
}

/** The plain bench, built once per file before its tests (on macOS; elsewhere every test is INCONCLUSIVE first). */
export function useBench(): () => string {
  beforeAll(() => { if (process.platform === 'darwin') build(); }, 3_600_000);
  afterAll(() => { if (binDir) rmSync(binDir, { recursive: true, force: true }); binDir = ''; builds.clear(); });
  return () => { requireMac(); return built(); };
}
/** A planted twin's bench, built when a test first needs it. */
export function twinBench(plant: Plant): string {
  requireMac();
  return built(plant);
}

/** A folder for the file's runs, deleted after the file. */
export function useDir(): () => string {
  let dir = '';
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1477-')); });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// One-shot calls: one JSON line out, exit 0.

const TIMEOUT = 900_000;

export function oneLine(bin: string, args: string[], what = `${BENCH} ${args.join(' ')}`): JsonObject {
  const run = spawnSync(bin, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`${what}: ${run.error.message}`);
  expect(run.status, `${what} exits 0 (${run.signal ?? 'no signal'}); stdout: ${(run.stdout ?? '').slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const line = (run.stdout ?? '').split('\n').find((l) => l.trim() !== '');
  expect(line, `${what} prints one JSON line`).toBeDefined();
  let value: JsonValue;
  try { value = JSON.parse(line!) as JsonValue; } catch { return expect.fail(`${what} prints JSON, got ${line!.slice(0, 600)}`); }
  return obj(value, what);
}

/** `lists_1477 arm <name>`: one arm in its own process, with the one-minute load read here before and after it. */
export function arm(bin: string, name: ArmName): { arm: JsonObject; load: { start: number; end: number } } {
  const start = loadavg()[0]!;
  const a = oneLine(bin, ['arm', name]);
  return { arm: a, load: { start, end: loadavg()[0]! } };
}

/** `lists_1477 measure --out <file> [--arms a,b]`: the record, read back from the file it wrote. */
export function measure(bin: string, out: string, arms?: string[]): JsonObject {
  const args = ['measure', '--out', out, ...(arms ? ['--arms', arms.join(',')] : [])];
  const run = spawnSync(bin, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`${BENCH} ${args.join(' ')}: ${run.error.message}`);
  expect(run.status, `${BENCH} ${args.join(' ')} exits 0 (${run.signal ?? 'no signal'}); stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  expect(existsSync(out), `${BENCH} ${args.join(' ')} wrote ${out}`).toBe(true);
  return obj(JSON.parse(readFileSync(out, 'utf8')) as JsonValue, `the record ${BENCH} measure wrote`);
}

/** The committed record. */
export function committed(): JsonObject {
  const path = join(REPO, RECORD);
  expect(existsSync(path), `the measurement record is committed at ${RECORD}`).toBe(true);
  return obj(JSON.parse(readFileSync(path, 'utf8')) as JsonValue, RECORD);
}

// ---------------------------------------------------------------------------------------------------
// Line sessions: `sort`, `access` and `soak` read one JSON command a line and answer one JSON line each.

export class Session {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: string[] = [];
  private readonly waiters: ((line: string | null) => void)[] = [];
  private ended = false;
  private exit: { code: number | null; signal: string | null } | null = null;
  stderr = '';
  constructor(bin: string, args: string[], readonly what = `${BENCH} ${args.join(' ')}`) {
    this.child = spawn(bin, args, { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (data: string) => {
      buffer += data;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (line.trim() !== '') this.push(line);
      }
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (data: string) => { this.stderr = (this.stderr + data).slice(-20_000); });
    this.child.stdin.on('error', () => undefined);
    this.child.on('close', (code, signal) => {
      this.exit = { code, signal };
      this.ended = true;
      for (const w of this.waiters.splice(0)) w(null);
    });
  }
  private push(line: string): void {
    const w = this.waiters.shift();
    if (w) w(line); else this.lines.push(line);
  }
  get pid(): number { return this.child.pid ?? -1; }
  send(command: unknown): void { this.child.stdin.write(`${JSON.stringify(command)}\n`); }
  /** The next answer line, parsed. */
  async next(about: string, timeoutMs = 120_000): Promise<JsonObject> {
    const line = this.lines.length ? this.lines.shift()! : this.ended ? null : await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => { const i = this.waiters.indexOf(done); if (i >= 0) this.waiters.splice(i, 1); resolve(null); }, timeoutMs);
      const done = (l: string | null): void => { clearTimeout(timer); resolve(l); };
      this.waiters.push(done);
    });
    expect(line, `${this.what} answers ${about} (exit ${JSON.stringify(this.exit)}); stderr: ${this.stderr.slice(-3000)}`).not.toBeNull();
    let value: JsonValue;
    try { value = JSON.parse(line!) as JsonValue; } catch { return expect.fail(`${this.what} answers ${about} in JSON, got ${line!.slice(0, 600)}`); }
    return obj(value, `${this.what}: ${about}`);
  }
  /** Closes stdin and waits for the exit. */
  async close(timeoutMs = 120_000): Promise<{ code: number | null; signal: string | null }> {
    this.child.stdin.end();
    if (!this.ended) await new Promise<void>((resolve) => { const t = setTimeout(resolve, timeoutMs); this.child.on('close', () => { clearTimeout(t); resolve(); }); });
    if (!this.ended) { this.kill(); expect.fail(`${this.what} exits within ${timeoutMs / 1000} s of its input closing`); }
    return this.exit!;
  }
  /** Stops this test's own child, by its PID. */
  kill(): void { if (!this.ended) this.child.kill('SIGKILL'); }
}

// ---------------------------------------------------------------------------------------------------
// The lane's rule: scripts/benchmark.mjs's judgeLimit and fingerprint, imported, never copied.

interface Judged { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string; runs: number[]; margin?: number }
interface Lane {
  judgeLimit(a: { limit: number; runs: number[]; fingerprint: unknown; loads: { start: number; end: number }[] }): Judged;
  fingerprint(): JsonObject;
}
let laneModule: Lane | undefined;
async function lane(): Promise<Lane> {
  laneModule ??= (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Lane;
  return laneModule;
}
/** Why a reading taken under `fp` with `load` isn't a reference-Mac reading by the lane's rule, or null when it is. */
export async function laneProblem(fp: JsonValue | undefined, load: { start: number; end: number }): Promise<string | null> {
  const { judgeLimit } = await lane();
  const r = judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint: fp ?? null, loads: Array.from({ length: 5 }, () => load) });
  return r.status === 'PASS' ? null : r.reason ?? r.status;
}
/** Five readings against a limit, judged by the lane on this machine's fingerprint: PASS, FAIL or INCONCLUSIVE. */
export async function judge(what: string, limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<void> {
  const { judgeLimit, fingerprint } = await lane();
  const r = judgeLimit({ limit, runs, fingerprint: fingerprint(), loads });
  console.log(`${what}: ${r.status}, ${runs.map((x) => x.toFixed(3)).join(', ')} against ${limit}${r.reason ? `: ${r.reason}` : ''}`);
  if (r.status === 'INCONCLUSIVE') inconclusive(`${what}: ${r.reason}`);
  expect(r.status, `${what}: ${r.reason ?? ''} (runs ${runs.join(', ')}, limit ${limit})`).toBe('PASS');
}

// ---------------------------------------------------------------------------------------------------
// Arms and the record.

export interface Reading { p50_ms: number; p95_ms: number; p99_ms: number; allocations_per_frame: number; cpu_ms_per_frame: number; working_set_bytes: number; data_bytes: number }
export interface Net { p50_ms: number; p95_ms: number; p99_ms: number; allocations_per_frame: number; cpu_ms_per_frame: number; working_set_above_data_bytes: number }

export function readingOf(a: JsonObject, what: string): Reading {
  const raw = obj(a['raw'], `${what}: raw`);
  const r: Reading = {
    p50_ms: num(raw['p50_ms'], `${what}: raw.p50_ms`), p95_ms: num(raw['p95_ms'], `${what}: raw.p95_ms`), p99_ms: num(raw['p99_ms'], `${what}: raw.p99_ms`),
    allocations_per_frame: num(raw['allocations_per_frame'], `${what}: raw.allocations_per_frame`), cpu_ms_per_frame: num(raw['cpu_ms_per_frame'], `${what}: raw.cpu_ms_per_frame`),
    working_set_bytes: num(raw['working_set_bytes'], `${what}: raw.working_set_bytes`), data_bytes: num(raw['data_bytes'], `${what}: raw.data_bytes`),
  };
  expect(r.p50_ms > 0 && r.p50_ms <= r.p95_ms && r.p95_ms <= r.p99_ms, `${what}: 0 < p50 ≤ p95 ≤ p99, got ${r.p50_ms}, ${r.p95_ms}, ${r.p99_ms}`).toBe(true);
  expect(r.cpu_ms_per_frame > 0 && r.allocations_per_frame >= 0 && r.working_set_bytes > 0 && r.data_bytes >= 0, `${what}: CPU per frame above 0, allocations and data at least 0, a working set above 0: ${JSON.stringify(raw)}`).toBe(true);
  return r;
}
/** An arm's readings net of its blank arm's, computed here. */
export function netOf(r: Reading, blank: Reading): Net {
  return {
    p50_ms: r.p50_ms - blank.p50_ms, p95_ms: r.p95_ms - blank.p95_ms, p99_ms: r.p99_ms - blank.p99_ms,
    allocations_per_frame: r.allocations_per_frame - blank.allocations_per_frame, cpu_ms_per_frame: r.cpu_ms_per_frame - blank.cpu_ms_per_frame,
    working_set_above_data_bytes: r.working_set_bytes - r.data_bytes - blank.working_set_bytes,
  };
}

/** What an arm measured must hold whatever the machine: the issue's window, rows, columns and seconds. */
export function armShapeProblems(name: ArmName, a: JsonObject): string[] {
  const out: string[] = [];
  const w = a['window'];
  if (!Array.isArray(w) || w[0] !== WINDOW[0] || w[1] !== WINDOW[1]) out.push(`${name} ran in a ${JSON.stringify(w)} window, not ${WINDOW.join(' × ')}`);
  if (a['seconds'] !== SECONDS) out.push(`${name} counted ${JSON.stringify(a['seconds'])} s, not ${SECONDS}`);
  if (typeof a['frames'] !== 'number' || a['frames'] < MIN_FRAMES) out.push(`${name} counted ${JSON.stringify(a['frames'])} frames, fewer than ${MIN_FRAMES} (${SECONDS} s at 60 Hz)`);
  if (name === 'kit' || name === 'panel' || name === 'ours') {
    if (a['rows'] !== TABLE_ROWS) out.push(`${name} has ${JSON.stringify(a['rows'])} rows, not ${TABLE_ROWS}`);
    if (a['columns'] !== COLUMNS) out.push(`${name} has ${JSON.stringify(a['columns'])} columns, not ${COLUMNS}`);
  }
  if (name === 'list-10k' || name === 'list-100k') {
    if (a['rows'] !== LIST_ROWS[name]) out.push(`${name} has ${JSON.stringify(a['rows'])} rows, not ${LIST_ROWS[name]}`);
    if (typeof a['list'] !== 'string' || a['list'] === '') out.push(`${name} doesn't name the list it measured`);
  }
  if (!isObject(a['fingerprint'])) out.push(`${name} has no fingerprint`);
  if (!isObject(a['load']) || !Number.isFinite(a['load']['start']) || !Number.isFinite(a['load']['end'])) out.push(`${name} has no load at its start and end`);
  return out;
}

/** The strings an arm shaped per frame: down the last 120 counted frames, and back over them (#1477.af9cb943). */
export function shapedProblems(name: string, a: JsonObject): string[] {
  const s = a['shaped'];
  if (!isObject(s)) return [`${name} reports no strings shaped per frame on a return`];
  const out: string[] = [];
  if (s['frames'] !== RETURN_FRAMES) out.push(`${name}'s return is ${JSON.stringify(s['frames'])} frames back over ${JSON.stringify(s['frames'])} down, not ${RETURN_FRAMES} and ${RETURN_FRAMES} (rows shown in the last 240 frames)`);
  if (typeof s['down'] !== 'number' || !(s['down'] > 0)) out.push(`${name} shaped ${JSON.stringify(s['down'])} strings per frame on the way down, over rows never shown: a count that reads nothing proves nothing`);
  if (typeof s['back'] !== 'number' || !Number.isFinite(s['back']) || s['back'] < 0) out.push(`${name} reports ${JSON.stringify(s['back'])} strings shaped per frame on the return, not a count`);
  return out;
}

export type Word = 'stop' | 'build' | 'INCONCLUSIVE';
/** The record's last line: its last key is `decision`, one line starting stop, build or INCONCLUSIVE. */
export function decisionOf(rec: JsonObject, what: string): { word: Word; line: string } {
  const keys = Object.keys(rec);
  expect(keys.at(-1), `${what} ends in its decision: its last key is decision, got ${keys.join(', ')}`).toBe('decision');
  const line = str(rec['decision'], `${what}: decision`);
  expect(line.includes('\n'), `${what}'s decision is one line: ${JSON.stringify(line)}`).toBe(false);
  const m = /^(stop|build|INCONCLUSIVE)\b/.exec(line);
  expect(m, `${what}'s decision line starts stop, build or INCONCLUSIVE: ${JSON.stringify(line)}`).not.toBeNull();
  return { word: m![1] as Word, line };
}
/** The scope's rule: build when a table arm misses 4 ms at p99, net of the blank arm; else stop. */
export function ruleOf(nets: Record<'kit' | 'panel', Net>): 'stop' | 'build' {
  return TABLE_ARMS.some((t) => nets[t].p99_ms > UPDATE_MS) ? 'build' : 'stop';
}

export interface Judgement { word: Word; line: string; unrun: string[]; off: string[]; problems: string[]; nets: Partial<Record<ArmName, Net>>; arms: Partial<Record<ArmName, JsonObject>> }

/**
 * Reads a record (#1477.e66d9bdb): every arm present, each measured with its fingerprint and load or INCONCLUSIVE with
 * a reason; its `net` equal to its raw readings less the blank arm's; the decision its last line; stop or build only
 * when blank, kit and panel all ran, and the one the scope's rule gives on its own numbers; `ours` measured under build.
 * `unrun` names the arms that read INCONCLUSIVE, `off` the arms the lane's rule doesn't count, `problems` the rest.
 */
export async function judgeRecord(rec: JsonObject, what: string): Promise<Judgement> {
  const { word, line } = decisionOf(rec, what);
  const all = obj(rec['arms'], `${what}: arms`);
  const names: ArmName[] = [...ARMS, ...(word === 'build' || 'ours' in all ? ['ours' as const] : [])];
  const j: Judgement = { word, line, unrun: [], off: [], problems: [], nets: {}, arms: {} };
  const extra = Object.keys(all).filter((k) => !(names as string[]).includes(k));
  if (extra.length) j.problems.push(`${what} has arms the issue doesn't name: ${extra.join(', ')}`);
  for (const name of names) {
    const a = all[name];
    if (!isObject(a)) { j.problems.push(`${what} has no ${name} arm (an unrun arm is still listed, reading INCONCLUSIVE)`); continue; }
    if (a['status'] === 'INCONCLUSIVE') {
      if (typeof a['reason'] !== 'string' || a['reason'] === '') j.problems.push(`${what}: ${name} reads INCONCLUSIVE without a reason`);
      j.unrun.push(`${name}: ${String(a['reason'])}`);
      continue;
    }
    if (a['status'] !== 'measured') { j.problems.push(`${what}: ${name} reads ${JSON.stringify(a['status'])}, neither measured nor INCONCLUSIVE`); continue; }
    j.arms[name] = a;
    j.problems.push(...armShapeProblems(name, a).map((p) => `${what}: ${p}`));
    const load = isObject(a['load']) ? { start: Number(a['load']['start']), end: Number(a['load']['end']) } : { start: NaN, end: NaN };
    const off = await laneProblem(a['fingerprint'], load);
    if (off) j.off.push(`${name}: ${off}`);
  }
  const blank = j.arms.blank ? readingOf(j.arms.blank, `${what}: blank`) : null;
  for (const name of names.filter((n) => n !== 'blank')) {
    const a = j.arms[name];
    if (!a || !blank) continue;
    const net = netOf(readingOf(a, `${what}: ${name}`), blank);
    j.nets[name] = net;
    const said = obj(a['net'], `${what}: ${name}.net`);
    for (const [k, v] of Object.entries(net)) {
      const s = said[k];
      if (typeof s !== 'number' || Math.abs(s - v) > 1e-6 * Math.max(1, Math.abs(v))) j.problems.push(`${what}: ${name}.net.${k} is ${JSON.stringify(s)}, but its raw reading less the blank arm's is ${v}`);
    }
  }
  if (j.arms.kit && readingOf(j.arms.kit, `${what}: kit`).allocations_per_frame <= 0) j.problems.push(`${what}: kit reads no allocations per frame, though the kit's table builds an element per cell`);
  const tablesRan = !!(j.arms.blank && j.arms.kit && j.arms.panel);
  if (word !== 'INCONCLUSIVE' && !tablesRan) j.problems.push(`${what} decides ${word} though blank, kit and panel didn't all run`);
  if (word === 'INCONCLUSIVE' && tablesRan && j.unrun.length === 0) j.problems.push(`${what} reads INCONCLUSIVE though every arm ran: it ends in stop or build`);
  if (word !== 'INCONCLUSIVE' && j.nets.kit && j.nets.panel) {
    const rule = ruleOf({ kit: j.nets.kit, panel: j.nets.panel });
    if (rule !== word) j.problems.push(`${what} decides ${word}, but its own table arms give ${rule}: kit p99 ${j.nets.kit.p99_ms.toFixed(3)} ms, panel p99 ${j.nets.panel.p99_ms.toFixed(3)} ms net of the blank arm, against ${UPDATE_MS} ms`);
  }
  return j;
}

/** Fails on problems, then reads INCONCLUSIVE on an unrun arm or a reading the lane doesn't count. */
export function expectJudged(j: Judgement, what: string): void {
  expect(j.problems, `${what}: problems`).toEqual([]);
  if (j.unrun.length) inconclusive(`${what} has unrun arms: ${j.unrun.join('; ')}`);
  if (j.word === 'INCONCLUSIVE') inconclusive(`${what} decides ${j.line}`);
  if (j.off.length) inconclusive(`${what} has readings the lane doesn't count: ${j.off.join('; ')}`);
}

/**
 * The #1433 citation (#1477.55753e50). With #1433's record in the checkout, `gpui_fast.at` is a JSON pointer into it
 * naming the gpui-fast arm's list reading, `gpui_fast.reading` equals the value there, and the decision line names
 * #1433. With no such record, both are null.
 */
export function citationProblems(rec: JsonObject, what: string): string[] {
  const g = rec['gpui_fast'];
  if (!isObject(g)) return [`${what} has no gpui_fast citation`];
  const out: string[] = [];
  if (g['issue'] !== 1433) out.push(`${what}: gpui_fast.issue is ${JSON.stringify(g['issue'])}, not 1433`);
  if (g['record'] !== RECORD_1433) out.push(`${what}: gpui_fast.record is ${JSON.stringify(g['record'])}, not ${RECORD_1433}`);
  const path = join(REPO, RECORD_1433);
  if (!existsSync(path)) {
    if (g['at'] !== null || g['reading'] !== null) out.push(`${what} cites a #1433 reading (${JSON.stringify(g)}), but ${RECORD_1433} doesn't exist`);
    return out;
  }
  const at = g['at'];
  if (typeof at !== 'string' || !at.startsWith('/')) return [...out, `${what} doesn't cite #1433's gpui-fast list reading, though ${RECORD_1433} exists: gpui_fast.at is ${JSON.stringify(at)}`];
  if (!/gpui[-_ ]?fast/i.test(at) || !/list/i.test(at)) out.push(`${what}: gpui_fast.at ${at} doesn't point at a gpui-fast list reading`);
  let there: JsonValue | undefined = JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
  for (const raw of at.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    there = Array.isArray(there) ? there[Number(key)] : isObject(there) ? there[key] : undefined;
  }
  if (there === undefined) out.push(`${what}: gpui_fast.at ${at} names nothing in ${RECORD_1433}`);
  else if (JSON.stringify(there) !== JSON.stringify(g['reading'])) out.push(`${what}: gpui_fast.reading ${JSON.stringify(g['reading'])} isn't ${RECORD_1433}'s ${at}, ${JSON.stringify(there)}`);
  const line = typeof rec['decision'] === 'string' ? rec['decision'] : '';
  if (!line.includes('#1433')) out.push(`${what}'s stop-or-build line doesn't cite #1433: ${JSON.stringify(line)}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The "If built" gate: the committed record's decision, and under stop a fresh measurement that proves it.

let stopProof: Promise<string> | undefined;

/**
 * Whether our element was built, read from the committed record's decision. Under `build` the criterion runs. Under
 * `stop` the criterion's condition is false, and that is proven here, not taken from the record: the record's own
 * table arms give stop by the scope's rule, and a fresh blank, kit and panel run on this machine, counted by the lane's
 * rule, gives stop too (once per file). Anything else fails, or reads INCONCLUSIVE; never a pass on the record's word.
 */
export async function builtOrProvenStop(bin: () => string): Promise<'build' | 'stop'> {
  requireMac();
  const rec = committed();
  const j = await judgeRecord(rec, RECORD);
  if (j.word === 'build') return 'build';
  expectJudged(j, RECORD);
  stopProof ??= (async () => {
    const b = bin();
    const runs = { blank: arm(b, 'blank'), kit: arm(b, 'kit'), panel: arm(b, 'panel') };
    const off: string[] = [];
    for (const [name, r] of Object.entries(runs)) {
      expect(r.arm['status'], `this run's ${name} arm is measured: ${JSON.stringify(r.arm).slice(0, 600)}`).toBe('measured');
      expect(armShapeProblems(name as ArmName, r.arm), `this run's ${name} arm`).toEqual([]);
      const p = await laneProblem(r.arm['fingerprint'], r.load);
      if (p) off.push(`${name}: ${p}`);
    }
    if (off.length) inconclusive(`the record decides stop, and this run can't confirm it: ${off.join('; ')}`);
    const blank = readingOf(runs.blank.arm, 'blank');
    const nets = { kit: netOf(readingOf(runs.kit.arm, 'kit'), blank), panel: netOf(readingOf(runs.panel.arm, 'panel'), blank) };
    expect(ruleOf(nets), `the record decides stop, and this run's table arms agree: kit p99 ${nets.kit.p99_ms.toFixed(3)} ms, panel p99 ${nets.panel.p99_ms.toFixed(3)} ms net of the blank arm, against ${UPDATE_MS} ms`).toBe('stop');
    return `kit p99 ${nets.kit.p99_ms.toFixed(3)} ms and panel p99 ${nets.panel.p99_ms.toFixed(3)} ms net of the blank arm, both within ${UPDATE_MS} ms`;
  })();
  console.log(`not built: ${RECORD} decides stop, and this run confirms it (${await stopProof}); this criterion's condition doesn't hold`);
  return 'stop';
}

// ---------------------------------------------------------------------------------------------------
// The checks the planted twins must fail, each naming what failed.

/** #1477.97f5d7c9: allocations per frame net of the blank arm at most 200. Names the count. */
export function allocationProblems(net: number): string[] {
  return net > NET_ALLOCATIONS ? [`ours makes ${Math.round(net)} allocations per frame net of the blank arm, over ${NET_ALLOCATIONS}`] : [];
}

/**
 * #1477.4e971aa0: at 1,000,000 rows, after End and a 0.75 px scroll back up, row i's exact top is the viewport's
 * bottom, less (rows − i) × 32 px, plus 0.75 px. Every reported row within 0.5 px of it; the rows reported are the
 * visible ones, consecutive, through the last row. Names the row.
 */
export function offsetProblems(r: JsonObject): string[] {
  const rows = num(r['rows'], 'offsets: rows');
  const vp = obj(r['viewport'], 'offsets: viewport');
  const top = num(vp['top'], 'offsets: viewport.top');
  const height = num(vp['height'], 'offsets: viewport.height');
  const tops = arr(r['tops'], 'offsets: tops').map((t, i) => {
    const o = obj(t, `offsets: tops[${i}]`);
    return { row: num(o['row'], `offsets: tops[${i}].row`), top: num(o['top'], `offsets: tops[${i}].top`) };
  });
  const out: string[] = [];
  if (rows !== OFFSET_ROWS) out.push(`offsets ran at ${rows} rows, not ${OFFSET_ROWS}`);
  if (tops.length === 0) return [...out, 'offsets reports no rows'];
  if (tops.at(-1)!.row !== rows - 1) out.push(`the last row reported is ${tops.at(-1)!.row}, not the last row ${rows - 1}`);
  tops.forEach((t, i) => { if (i > 0 && t.row !== tops[i - 1]!.row + 1) out.push(`row ${t.row} follows row ${tops[i - 1]!.row}`); });
  if (tops[0]!.top > top) out.push(`the first row reported, ${tops[0]!.row}, starts at ${tops[0]!.top} px, below the viewport's top ${top} px`);
  for (const t of tops) {
    const exact = top + height - (rows - t.row) * ROW_PX + NUDGE_PX;
    const d = Math.abs(t.top - exact);
    if (!(d <= OFFSET_PX)) out.push(`row ${t.row}'s top is at ${t.top} px, ${d.toFixed(3)} px from its exact ${exact} px`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Sorting: the data file, the plain comparator, the order check.

/** A column of the sort data file: numbers (non-finite ones as "NaN", "Infinity", "-Infinity") or text. */
export type NumberValue = number | 'NaN' | 'Infinity' | '-Infinity';
export type Column = { name: string; type: 'number'; values: NumberValue[] } | { name: string; type: 'text'; values: string[] };
export interface Filter { column: string; at_least: number }

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const asNumber = (v: number | string): number => (v === 'NaN' ? NaN : v === 'Infinity' ? Infinity : v === '-Infinity' ? -Infinity : (v as number));

/**
 * The plain comparator: ascending; numbers by value with −∞ first and NaN after every number; text by its UTF-8 bytes;
 * ties by row index (a stable sort). The filter keeps rows whose number is at least `at_least` (NaN never is).
 */
export function plainOrder(columns: Column[], by: string, filter: Filter | null): number[] {
  const col = columns.find((c) => c.name === by)!;
  const n = col.values.length;
  let rows = Array.from({ length: n }, (_, i) => i);
  if (filter) {
    const f = columns.find((c) => c.name === filter.column)!;
    rows = rows.filter((i) => asNumber(f.values[i]!) >= filter.at_least);
  }
  if (col.type === 'number') {
    const v = col.values.map(asNumber);
    return rows.sort((a, b) => {
      const x = v[a]!; const y = v[b]!;
      const nx = Number.isNaN(x); const ny = Number.isNaN(y);
      if (nx !== ny) return nx ? 1 : -1;
      if (!nx && x !== y) return x < y ? -1 : 1;
      return a - b;
    });
  }
  const bytes = col.values.map((s) => Buffer.from(s, 'utf8'));
  return rows.sort((a, b) => Buffer.compare(bytes[a]!, bytes[b]!) || a - b);
}

/** #1477.fd384f01: the typed path's order equals the plain comparator's. Names the first row out of place. */
export function orderProblems(what: string, got: JsonValue | undefined, want: number[]): string[] {
  if (!Array.isArray(got)) return [`${what}: no order`];
  if (got.length !== want.length) return [`${what}: ${got.length} rows in the view, not ${want.length}`];
  for (let k = 0; k < want.length; k++) {
    if (got[k] !== want[k]) return [`${what}: position ${k} holds row ${JSON.stringify(got[k])}, where the plain comparator puts row ${want[k]}`];
  }
  return [];
}

// ---------------------------------------------------------------------------------------------------
// The soak (#1477.1899ebe0): events in, one state per event out, and the invariants checked here.

export type SoakEvent =
  | { rows: string }
  | { scroll: number | 'NaN' | 'Infinity' | '-Infinity' }
  | { resize: [number, number] }
  | { key: 'down' | 'up' | 'pagedown' | 'pageup' | 'home' | 'end' }
  | { select: string };

export const SOAK_EVENTS = 2000;
export function soakEvents(seed: number, n = SOAK_EVENTS): SoakEvent[] {
  const rand = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const ROWS = ['0', '1', '2', '22', '23', '100000', '1000000', QUARTER_USIZE, (BigInt(QUARTER_USIZE) - 1n).toString()] as const;
  const SCROLLS = ['NaN', 'Infinity', '-Infinity', 1e300, -1e300, 0, 0.5, -0.5, ROW_PX * 2, -ROW_PX * 2, 1e9, -1e9, 7.25] as const;
  const SIZES: [number, number][] = [[0, 0], [0, 700], [1200, 0], [1, 1], [31, 31], [1200, 700], [4096, 4096]];
  const KEYS = ['down', 'up', 'pagedown', 'pageup', 'home', 'end'] as const;
  let rows = '100000';
  const out: SoakEvent[] = [];
  for (let i = 0; i < n; i++) {
    const kind = rand();
    if (kind < 0.12) { rows = pick(ROWS); out.push({ rows }); }
    else if (kind < 0.5) out.push({ scroll: pick(SCROLLS) });
    else if (kind < 0.6) out.push({ resize: pick(SIZES) });
    else if (kind < 0.85) out.push({ key: pick(KEYS) });
    else {
      const r = BigInt(rows);
      out.push({ select: pick([0n, r === 0n ? 0n : r - 1n, r, r + 1n, BigInt(QUARTER_USIZE), r / 2n]).toString() });
    }
  }
  return out;
}

/**
 * Invariants after every event: the rows and size are the ones set; the offset is a finite number in
 * [0, rows × 32 px]; the visible range is empty exactly when there are no rows or no height, and otherwise lies in
 * [0, rows) with at most ceil(height ÷ 32) + 1 rows; a selection lies in [0, rows). Names the event.
 */
export function soakProblems(events: SoakEvent[], states: JsonObject[], start: { rows: string; viewport: [number, number] }): string[] {
  const out: string[] = [];
  let rows = BigInt(start.rows);
  let [w, h] = start.viewport;
  if (states.length !== events.length) out.push(`${states.length} states for ${events.length} events`);
  states.forEach((s, i) => {
    const e = events[i]!;
    if ('rows' in e) rows = BigInt(e.rows);
    if ('resize' in e) [w, h] = e.resize;
    const at = `after event ${i} ${JSON.stringify(e)}`;
    const p = (m: string): void => { if (out.length < 20) out.push(`${at}: ${m}`); };
    if (s['rows'] !== rows.toString()) p(`rows reads ${JSON.stringify(s['rows'])}, not ${rows}`);
    const vp = s['viewport'];
    if (!Array.isArray(vp) || vp[0] !== w || vp[1] !== h) p(`the viewport reads ${JSON.stringify(vp)}, not [${w}, ${h}]`);
    const off = s['offset'];
    const max = Number(rows) * ROW_PX;
    if (typeof off !== 'number' || !Number.isFinite(off)) p(`the offset is ${JSON.stringify(off)}, not a finite number`);
    else if (off < 0 || off > max * (1 + 1e-12)) p(`the offset ${off} px is outside [0, ${max}] px`);
    const vis = s['visible'];
    if (rows === 0n || h === 0) { if (vis !== null) p(`it shows ${JSON.stringify(vis)} with no rows or no height`); }
    else if (!Array.isArray(vis) || vis.length !== 2 || typeof vis[0] !== 'string' || typeof vis[1] !== 'string' || !/^\d+$/.test(vis[0]) || !/^\d+$/.test(vis[1])) p(`the visible range is ${JSON.stringify(vis)}, not two decimal rows`);
    else {
      const [a, b] = [BigInt(vis[0]), BigInt(vis[1])];
      if (a > b || b >= rows) p(`the visible range ${a}–${b} isn't within 0–${rows - 1n}`);
      else if (b - a + 1n > BigInt(Math.ceil(h / ROW_PX) + 1)) p(`it shows ${b - a + 1n} rows in ${h} px`);
    }
    const sel = s['selected'];
    if (sel !== null && sel !== undefined) {
      if (!Array.isArray(sel) || sel.length !== 2 || !sel.every((x) => typeof x === 'string' && /^\d+$/.test(x))) p(`the selection is ${JSON.stringify(sel)}`);
      else if (BigInt(sel[0] as string) > BigInt(sel[1] as string) || BigInt(sel[1] as string) >= rows) p(`the selection ${sel.join('–')} isn't within 0–${rows - 1n}`);
    }
  });
  return out;
}
