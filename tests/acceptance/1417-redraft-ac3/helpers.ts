// Test-side tools for the #1417 criterion 3 acceptance test (README): the two binaries built and driven by JSON
// lines, the generated graphs, the reference-Mac gate and the design's timing judge. Nothing here stands in for the
// layout or the cost model under test.

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1417-redraft-ac3 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const TIMEOUT = 3_600_000;
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] || join(REPO, 'target');

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object: ${JSON.stringify(v)?.slice(0, 800)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array: ${JSON.stringify(v)?.slice(0, 800)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number: ${JSON.stringify(v)?.slice(0, 200)}`).toBe(true);
  return v as number;
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary once per file, copied out under its own name; a failed build fails each test that uses it.

export interface Build { bin: string; profile: 'release' | 'debug' }
function cargo(args: string[]): string {
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status === 0) return '';
  const kept = r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating/.test(l));
  return `cargo ${args.join(' ')} failed:\n${kept.join('\n').slice(0, 4000)}`;
}
/** Builds each listed binary once before the file's tests (`--locked`, in its profile); `path(bin)` fails the test when its build failed. */
export function useBins(builds: Build[]): (bin: string) => string {
  const made = new Map<string, { path: string; error: string }>();
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1417-ac3-bins-'));
    for (const b of builds) {
      const error = cargo(['build', '--locked', ...(b.profile === 'release' ? ['--release'] : []), '--bin', b.bin]);
      const path = join(dir, exe(b.bin));
      if (error === '') copyFileSync(join(targetDir(), b.profile, exe(b.bin)), path);
      made.set(b.bin, { path, error });
    }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (bin) => {
    const m = made.get(bin);
    if (!m) throw Error(`the file didn't list the build ${bin}`);
    expect(m.error, `the binary builds: ${bin}`).toBe('');
    return m.path;
  };
}

// ---------------------------------------------------------------------------------------------------
// The graphs: layered DAGs generated from a fixed seed, so every run sends the same bytes.

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A graph@1 `graph` of `n` nodes in about √n ÷ 2 ranks, each node but the last rank's with one or two edges to
 * nodes of the next rank (about 1.5 edges a node), so no edge spans ranks; and its `layout`.
 */
export function layeredGraph(n: number): { graph: JsonObject; layout: JsonObject; edges: number } {
  const r = rng(1417 + n);
  const ranks = Math.max(2, Math.round(Math.sqrt(n) / 2));
  const per = Math.ceil(n / ranks);
  const id = (i: number): string => `n${i}`;
  const nodes: JsonObject[] = [];
  for (let i = 0; i < n; i++) nodes.push({ id: id(i), w: 48 + (i % 5) * 8, h: 24 });
  const edges: JsonObject[] = [];
  for (let i = 0; i < n; i++) {
    const rank = Math.floor(i / per);
    const next = (rank + 1) * per;
    if (next >= n) continue;
    const size = Math.min(per, n - next);
    const outs = r() < 0.5 ? 1 : 2;
    const seen = new Set<number>();
    for (let k = 0; k < outs; k++) {
      const b = next + Math.floor(r() * size);
      if (seen.has(b)) continue;
      seen.add(b);
      edges.push({ id: `e${edges.length}`, a: id(i), b: id(b) });
    }
  }
  return { graph: { nodes, edges }, layout: { algo: 'layered', seed: 1417, spacing: { node: 24, rank: 48, edge: 12 } }, edges: edges.length };
}

// ---------------------------------------------------------------------------------------------------
// The estimate: deep-show run's deep_show call (#393), whose check refuses a document over its class with
// `over_budget` carrying the cost model's estimate (#379).

const DOC = '01JB1417A3000000000000000001';
const SESSIONS: JsonObject = { 'sess-ac3': { thread: 'thread-ac3', name: 'Claude Code: graphs', process: { pid: 4170, start: 1000 } } };
const PANELS: JsonObject = { main: { rect: [0, 0, 1280, 720] } };
/** A core view whose frame caps the document tightens to 0.001 ms, so any estimate is over and the check names it. */
const OVER: JsonObject = { class: 'core_view', frame_cpu_ms: 0.001, frame_gpu_ms: 0.001 };

/** A board holding one graph@1 item, the graph of `n` nodes, as #393's deep_show payload carries it. */
export function graphBoard(n: number): JsonObject {
  const { graph, layout } = layeredGraph(n);
  return {
    format: 1, profile: 'board', seed: 1417, title: `Graph of ${n} nodes`,
    description: `A layered graph of ${n} nodes whose layout the cost model estimates.`,
    requires: { modules: { graph: '^1' } }, size: [1280, 720], budget: OVER,
    items: { g: { id: 'g', kind: 'graph@1', name: 'Graph', order: 'a0', params: { graph, layout } } },
  };
}

export interface Estimate { cpu_ms: number; issue: JsonObject; others: JsonObject[] }
/** Each board's estimated frame CPU, from the document check's `over_budget` at `budget`, in one deep-show run. */
export function estimates(bin: string, boards: JsonObject[]): Estimate[] {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-1417-ac3-ev-'));
  try {
    const calls = boards.map((document) => ({ call: 'deep_show', session: 'sess-ac3', doc: DOC, document, include: ['issues'] }));
    const scenario = { evidence, sessions: SESSIONS, panels: PANELS, docs: { [DOC]: { panel: 'main' } }, calls };
    const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
    if (r.error) throw Error(`deep-show run: ${r.error.message}`);
    expect(r.status, `deep-show run exits 0; stderr: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
    const out = (r.stdout ?? '').split('\n').filter((l) => l !== '');
    expect(out.length, 'deep-show run: one line out').toBe(1);
    const answer = obj(JSON.parse(out[0]!) as JsonValue, 'deep-show run: the answer');
    expect(answer['ok'], `deep-show run takes the scenario: ${JSON.stringify(answer).slice(0, 1500)}`).toBe(true);
    const replies = arr(answer['replies'], 'replies');
    expect(replies.length, 'one reply per call').toBe(boards.length);
    return replies.map((reply, k) => {
      const what = `the ${k + 1}th board's deep_show reply`;
      const rep = obj(reply, what);
      const issues = arr(rep['issues'], `${what}: issues`).map((i, j) => obj(i, `${what}: issues[${j}]`));
      const over = issues.filter((i) => i['code'] === 'over_budget');
      const doc = over.filter((i) => i['path'] === 'budget');
      expect(doc.length, `${what}: the check refuses it over its class with one over_budget at budget, carrying the estimate: ${JSON.stringify(issues).slice(0, 1500)}`).toBe(1);
      const actual = obj(doc[0]!['actual'], `${what}: over_budget.actual (the estimate)`);
      return { cpu_ms: num(actual['cpu_ms'], `${what}: the estimate's cpu_ms`), issue: doc[0]!, others: over.filter((i) => i !== doc[0]) };
    });
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// The measured time: `deep-graph layout` (#394's surface), one long-lived process answering a JSON line per line.

export class Lines {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly rl: Interface;
  private readonly queue: string[] = [];
  private waiting: ((line: string | null) => void) | null = null;
  private closed = false;
  constructor(bin: string, args: string[]) {
    this.child = spawn(bin, args, { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    this.rl = createInterface({ input: this.child.stdout });
    this.rl.on('line', (l) => { if (this.waiting) { const w = this.waiting; this.waiting = null; w(l); } else this.queue.push(l); });
    this.rl.on('close', () => { this.closed = true; if (this.waiting) { const w = this.waiting; this.waiting = null; w(null); } });
  }
  private next(): Promise<string | null> {
    const l = this.queue.shift();
    if (l !== undefined) return Promise.resolve(l);
    if (this.closed) return Promise.resolve(null);
    return new Promise((res) => { this.waiting = res; });
  }
  /** Sends `k` copies of one line at once and waits for all their answers: every answer, and the wall time from the first write to the last answer, in ms. */
  async ask(line: string, k = 1): Promise<{ answers: JsonObject[]; ms: number }> {
    const t0 = process.hrtime.bigint();
    this.child.stdin.write(`${line}\n`.repeat(k));
    const got: (string | null)[] = [];
    for (let i = 0; i < k; i++) got.push(await this.next());
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    expect(got.every((g) => g !== null), 'deep-graph layout answers each line').toBe(true);
    return { answers: got.map((g) => JSON.parse(g!) as JsonObject), ms };
  }
  close(): void { this.child.stdin.end(); this.child.kill('SIGKILL'); }
}

// ---------------------------------------------------------------------------------------------------
// The machine rule (technical design: The reference Macs) and the timing judge (Every task carries its own budgets).

/** The reference Macs, as the design lists them. */
export const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', cores: 12, gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', cores: 8, gib: 16 },
  { model: 'Mac17,10', chip: 'Apple M5 Max', cores: 18, gib: 64 },
];
const sh = (cmd: string, ...args: string[]): string => spawnSync(cmd, args, { encoding: 'utf8' }).stdout?.trim() ?? '';

/** This machine, as the OS names it, for the record printed with every reading. */
export function machine(): string {
  if (process.platform !== 'darwin') {
    const model = sh('cat', '/sys/devices/virtual/dmi/id/product_name') || 'unknown model';
    return `${process.platform} ${process.arch}, ${model}, ${cpus()[0]?.model ?? 'unknown cpu'}, ${cpus().length} cores, ${Math.round(Number(sh('sh', '-c', 'grep MemTotal /proc/meminfo | tr -dc 0-9')) / 2 ** 20)} GiB`;
  }
  return `${sh('sysctl', '-n', 'hw.model')}, ${sh('sysctl', '-n', 'machdep.cpu.brand_string')}, ${sh('sysctl', '-n', 'hw.ncpu')} cores, ${Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30)} GiB, macOS ${sh('sw_vers', '-buildVersion')}`;
}

/** Why a timing taken here now doesn't count, or null when it does. */
export function notCounted(): string | null {
  if (process.platform !== 'darwin') return `not a reference Mac: platform ${process.platform}`;
  const model = sh('sysctl', '-n', 'hw.model');
  const chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
  const cores = Number(sh('sysctl', '-n', 'hw.ncpu'));
  const gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.cores === cores && m.gib === gib)) {
    return `not a reference Mac: ${model} / ${chip} / ${cores} cores / ${gib} GiB`;
  }
  const batt = sh('pmset', '-g', 'batt');
  if (!/drawing from 'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0] ?? '(pmset -g batt said nothing)'}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(sh('pmset', '-g'));
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const therm = sh('pmset', '-g', 'therm');
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const load = loadavg()[0]!;
  if (load > cpus().length / 2) return `loaded: a 1-minute load average of ${load.toFixed(1)} on ${cpus().length} cores`;
  return null;
}

export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
/**
 * "Within 2 times" for five runs after warm-up against one estimate: PASS when every run's measured time lies in
 * [estimate ÷ 2, estimate × 2]; FAIL when every run lies outside it by more than the margin (the larger of 5% and the
 * spread of the five); otherwise INCONCLUSIVE.
 */
export function within2x(estimate: number, runs: number[]): { verdict: Verdict; margin: number } {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-12);
  const margin = Math.max(0.05, spread);
  const lo = estimate / 2;
  const hi = estimate * 2;
  if (estimate > 0 && runs.every((r) => r >= lo && r <= hi)) return { verdict: 'PASS', margin };
  const outside = (r: number): boolean => estimate <= 0 || r > hi * (1 + margin) || r < lo / (1 + margin);
  if (runs.every(outside)) return { verdict: 'FAIL', margin };
  return { verdict: 'INCONCLUSIVE', margin };
}
