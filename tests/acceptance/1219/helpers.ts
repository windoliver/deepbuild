// Test-side tools for the #1219 acceptance tests: `deep-show` and `deep-gpu` built with cargo and driven by JSON lines
// (#393's `deep-show run` with #420's `geometry`, #387's `eval` and #403's claims and `verdict`; #377's `deep-gpu run`
// with #378's `view3d`), and reading what they answer into the shapes judges.ts judges. The fixtures' numbers and
// documents, the closed forms and the judges are judges.ts's, which this file hands on, so a test imports one module.
// The build, `run` and the scenario are copied from #2014's and #405's helpers and `runGpu` from #2017's, since suites
// don't import each other.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect, vi } from 'vitest';
import {
  LOOK, REFERENCE_WINDOW, brief, isObject, judgeProblems, type BracketReading, type Column, type JsonObject, type JsonValue, type Node, type Profile, type V3,
} from './judges.ts';

export * from './judges.ts';

// A first build of either binary takes many minutes on a loaded machine.
vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1219 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET_DIR = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------------------------------
// Failure rules

export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${brief(v)}`).toBe(true);
  return v as number;
}
function point(v: JsonValue | undefined, what: string): V3 {
  const a = arr(v, what);
  expect(a.length, `${what} holds three numbers`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A test that can't be judged here fails with this, never passes (AGENTS.md: nothing unrun passes). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** What the GPU draws is drawn on macOS's Metal device: off macOS a test that draws fails INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the renderer draws on macOS's Metal device; this is ${process.platform}`);
}
/** Every judge fails its planted sets and passes its clean ones (judges.ts), before a binary is asked for anything. */
export function judgesFailTheirPlants(): void {
  for (const [judge, problems] of Object.entries(judgeProblems())) none(problems, `the ${judge} judge on its planted sets (each line is what it should have found)`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file, debug info and incremental builds off, copied out of the target folder.

export type Bin = 'deep-show' | 'deep-gpu';
const FEATURES: Record<Bin, string[]> = { 'deep-show': ['--no-default-features', '--features', 'full'], 'deep-gpu': [] };
const cargoArgs = (bin: Bin): string[] => ['build', '--locked', '--bin', bin, ...FEATURES[bin]];

/** Builds `bins` once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useBins(bins: readonly Bin[]): (bin: Bin) => string {
  let dir = '';
  const made = new Map<Bin, { path: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1219-bin-'));
    const env = {
      ...process.env, PATH: `/opt/homebrew/opt/rustup/bin${delimiter}${process.env['PATH'] ?? ''}`,
      CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
    };
    for (const bin of bins) {
      const args = cargoArgs(bin);
      const r = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (r.error) { made.set(bin, { path: '', error: `cargo could not run: ${r.error.message}` }); continue; }
      if (r.status !== 0) {
        const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
        made.set(bin, { path: '', error: `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` });
        continue;
      }
      const path = join(dir, bin);
      copyFileSync(join(TARGET_DIR, 'debug', bin), path);
      made.set(bin, { path, error: '' });
    }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (bin: Bin): string => {
    const m = made.get(bin);
    expect(m, `${bin} was built before the tests`).toBeDefined();
    expect(m!.error, `the binary builds: cargo ${cargoArgs(bin).join(' ')}`).toBe('');
    return m!.path;
  };
}
/** Fresh folders for a test (evidence stores, outputs), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-1219-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

/** The working agent, alpha. */
export const SESSION = 'sess-alpha';
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB1219D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB1219C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB1219Q', n)}`;

/** Alpha's claim on one deliverable, its locked definition one requirement per check (#403). */
export const claimOf = (doc: string, checks: readonly (readonly [req: string, check: JsonObject])[]): JsonObject =>
  ({ session: SESSION, deliverables: [doc], requirements: checks.map(([id, check]) => ({ id, check })) });

/** The scenario: the documents on the panel (each shown by a call), the claims, the calls, and a planted program. */
export function scenarioOf(evidence: string, docs: readonly string[], claims: JsonObject, calls: JsonObject[], planted?: string): JsonObject {
  return {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-alpha', name: 'The working agent: halls', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 4100, ppid: 3000, start: 1_000 }],
    panels: { main: { rect: [0, 0, 1280, 720] } },
    docs: Object.fromEntries(docs.map((d) => [d, { panel: 'main' }])),
    ...(Object.keys(claims).length ? { claims } : {}), ...(planted ? { planted } : {}), calls,
  };
}

/** One `deep-show run` process on this machine: its replies, one per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`deep-show run: ${r.error.message}`);
  expect(timedOut, 'deep-show run finished within its timeout').toBe(false);
  expect(r.status, `deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-show run: one output line per input line').toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-show run: the answer');
  const calls = arr(scenario['calls'], 'the calls').map((c) => (isObject(c) ? String(c['call']) : '?'));
  const planted = typeof scenario['planted'] === 'string' ? `, its planted program ${scenario['planted']}` : '';
  expect(out['ok'], `deep-show run accepts the scenario (its calls ${calls.join(', ')}${planted}): ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], 'deep-show run: replies').map((v, i) => obj(v, `deep-show run: replies[${i}]`));
  expect(replies.length, 'deep-show run: one reply per call').toBe(calls.length);
  return replies;
}

/** The working agent's deep_show of a whole revision (#393's agent form: no `id`, no `layers`). */
export const show = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });
/** #420's `geometry` call on the named items: each one's built mesh, anchors and outputs. */
export const geometry = (doc: string, items: readonly string[]): JsonObject => ({ call: 'geometry', doc, items: [...items] });
/** #387's `eval`: one frame of the document's session at 0 s, every node with its key and how it was had. */
export const evalCall = (doc: string): JsonObject => ({ call: 'eval', doc, t: '0s' });
/** #403's `verdict` on a claim: one row per requirement. */
export const verdict = (claim: string): JsonObject => ({ call: 'verdict', claim });

/** Why a show isn't presented: an item skipped as a kind the build doesn't know, an error the check raised, or another outcome. */
export function presentedFailures(reply: JsonObject): string[] {
  const notices = Array.isArray(reply['notices']) ? reply['notices'].filter(isObject) : [];
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  return [
    ...[...notices, ...issues].filter((n) => n['code'] === 'unknown_kind').map((n) => `an item is skipped as a kind the build doesn't know: ${brief(n, 600)}`),
    ...issues.filter((i) => i['severity'] === 'error').map((i) => `the check raises an error: ${brief(i, 600)}`),
    ...(reply['outcome'] === 'presented' ? [] : [`the show's outcome is ${brief(reply['outcome'])}, not presented: ${brief(reply, 1500)}`]),
  ];
}
/** The show was presented: no error issue, and no item skipped as a kind the build doesn't know. */
export const presented = (reply: JsonObject, what: string): void => none(presentedFailures(reply), `${what} is presented`);
/** Under a planted builder the revision is still shown, so what it built can be read: a failed kind rule never refuses a show (README: The kind rules). */
export function stillShown(reply: JsonObject, what: string): void {
  const skipped = [...(Array.isArray(reply['notices']) ? reply['notices'] : []), ...(Array.isArray(reply['issues']) ? reply['issues'] : [])].filter(isObject).filter((n) => n['code'] === 'unknown_kind');
  expect(skipped.map((n) => brief(n, 600)), `${what}: no item skipped as a kind the build doesn't know`).toEqual([]);
  expect(reply['outcome'], `${what} is still shown, so its build can be read: ${brief(reply, 3000)}`).toBe('presented');
}

// ---------------------------------------------------------------------------------------------------
// What a build answers (#420's `geometry` rows), read in the item's own space. A hall's items build in one space, the
// frame's, and no fixture whose numbers are read places its frame, so that space is the world's.

/** One item's row: its mesh's points and triangle count, its anchors' origins and its outputs. */
export interface Built { id: string; positions: V3[]; triangles: number; anchors: Record<string, V3>; outputs: JsonObject }
export function builtOf(reply: JsonObject, id: string, what: string): Built {
  expect(reply['code'], `${what}: the geometry call answers: ${brief(reply)}`).toBeUndefined();
  const row = arr(reply['items'], `${what}: the geometry reply's items`).filter(isObject).find((r) => r['id'] === id);
  expect(row, `${what}: the geometry reply has a row for ${id}: ${brief(reply)}`).toBeDefined();
  const positions = arr(row!['positions'], `${what}: ${id}.positions`).map((v, k) => point(v, `${what}: ${id}.positions[${k}]`));
  const indices = arr(row!['indices'], `${what}: ${id}.indices`).map((v) => num(v, `${what}: ${id}: an index`));
  expect(indices.length % 3 === 0 && indices.every((k) => Number.isInteger(k) && k >= 0 && k < positions.length), `${what}: ${id}'s indices are whole triangles of its positions`).toBe(true);
  expect(indices.length / 3, `${what}: ${id} builds a mesh: it has triangles`).toBeGreaterThan(0);
  const anchors = Object.fromEntries(Object.entries(isObject(row!['anchors']) ? row!['anchors'] : {}).map(([name, a]) => [name, point(obj(a, `${what}: ${id}.anchors.${name}`)['pos'], `${what}: ${id}.anchors.${name}.pos`)]));
  return { id, positions, triangles: indices.length / 3, anchors, outputs: isObject(row!['outputs']) ? row!['outputs'] : {} };
}

const COLUMN_ANCHOR = /^column\.(\d+)\.(\d+)$/;
/** A frame's columns: its anchors `column.<i>.<j>`, each at the center of that column's head (README: The bay frame). */
export function columnsOf(frame: Built): Column[] {
  return Object.entries(frame.anchors).flatMap(([name, pos]): Column[] => {
    const m = COLUMN_ANCHOR.exec(name);
    return m ? [{ at: [Number(m[1]), Number(m[2])], center: [pos[0], pos[2]], head: pos[1] }] : [];
  });
}
/** Why a frame's mesh doesn't stand where its columns do: it has no column anchor, or its mesh doesn't span their centers in plan or reach their heads. */
export function standsFailures(frame: Built, columns: readonly Column[]): string[] {
  if (!columns.length) return [`${frame.id} answers no column anchor (column.<i>.<j>); its anchors: ${Object.keys(frame.anchors).join(', ') || 'none'}`];
  const ext = (v: number[]): [number, number] => [Math.min(...v), Math.max(...v)];
  const out: string[] = [];
  for (const [axis, mesh, cols] of [['x', ext(frame.positions.map((p) => p[0])), ext(columns.map((c) => c.center[0]))], ['z', ext(frame.positions.map((p) => p[2])), ext(columns.map((c) => c.center[1]))]] as const)
    if (mesh[0] > cols[0] + 1e-6 || mesh[1] < cols[1] - 1e-6) out.push(`${frame.id}'s mesh runs from ${axis} ${mesh[0]} to ${mesh[1]} m, short of its columns' centers at ${cols[0]} to ${cols[1]} m`);
  const [top, head] = [Math.max(...frame.positions.map((p) => p[1])), Math.max(...columns.map((c) => c.head))];
  if (top < head - 1e-6) out.push(`${frame.id}'s mesh reaches y ${top} m, under its column heads at ${head} m`);
  return out;
}

/** A roof's outputs (README: The roof): `ridge_height`, `purlins` and `eave_line`, heights and points in the frame's space. */
export interface RoofOutputs extends Profile { eave: V3[] }
export function roofOf(roof: Built, what: string): RoofOutputs {
  const ridge = num(roof.outputs['ridge_height'], `${what}: ${roof.id}'s output ridge_height`);
  const purlins = arr(roof.outputs['purlins'], `${what}: ${roof.id}'s output purlins`).map((v, k) => {
    const p = obj(v, `${what}: ${roof.id}.purlins[${k}]`);
    return { in: num(p['in'], `${what}: ${roof.id}.purlins[${k}].in`), height: num(p['height'], `${what}: ${roof.id}.purlins[${k}].height`) };
  });
  const eave = arr(roof.outputs['eave_line'], `${what}: ${roof.id}'s output eave_line`).map((v, k) => point(v, `${what}: ${roof.id}.eave_line[${k}]`));
  return { ridge, purlins, eave };
}
/** What criterion 4 reads of a bracket set, the frame it stands on and the roof it carries. */
export function bracketReadingOf(set: Built, columns: readonly Column[], roof: RoofOutputs, what: string): BracketReading {
  return {
    id: set.id,
    totalReach: num(set.outputs['total_reach'], `${what}: ${set.id}'s output total_reach`),
    totalHeight: num(set.outputs['total_height'], `${what}: ${set.id}'s output total_height`),
    top: Math.max(...set.positions.map((p) => p[1])),
    heads: columns.filter((c) => c.at[1] === 0).map((c) => c.head),
    eavePurlin: roof.purlins.find((p) => Math.abs(p.in) <= 1e-6)?.height ?? NaN,
  };
}

/** A frame's nodes (#387's `eval`). */
export function nodesOf(reply: JsonObject, what: string): Node[] {
  expect(reply['outcome'], `${what}: the frame was evaluated: ${brief(reply)}`).toBe('evaluated');
  return arr(reply['nodes'], `${what}: nodes`).map((v, i) => {
    const o = obj(v, `${what}: nodes[${i}]`);
    expect(typeof o['operator'] === 'string' && typeof o['key'] === 'string' && ['ran', 'hit', 'kept'].includes(String(o['run'])), `${what}: nodes[${i}] has an operator, a key and run: ran | hit | kept: ${brief(o, 400)}`).toBe(true);
    return { operator: o['operator'] as string, item: typeof o['item'] === 'string' ? o['item'] : null, key: o['key'] as string, run: o['run'] as string };
  });
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run`: one scenario `{out, calls}` in, one line out, one reply per call (#377); `view3d` (#378).

export function runGpu(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail('deep-gpu run did not finish within 3,000 s');
  if (r.error) throw Error(`deep-gpu run: ${r.error.message}`);
  expect(r.status, `deep-gpu run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-gpu run: one output line').toBe(1);
  const a = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-gpu run: the answer');
  expect(a['ok'], `deep-gpu run accepts the scenario: ${brief(a, 3000)}`).toBe(true);
  const replies = arr(a['replies'], 'deep-gpu run: replies').map((x, i) => obj(x, `deep-gpu run: replies[${i}]`));
  expect(replies.length, 'deep-gpu run: one reply per call').toBe(calls.length);
  return replies;
}

/** The renderer's own picture of `doc` at the reference window: frame 0's `final` target, the PNG bytes as `view3d` wrote them. */
export function drawn(bin: string, out: string, name: string, doc: JsonObject): Buffer {
  const path = join(out, `${name}.json`);
  writeFileSync(path, JSON.stringify(doc));
  const [reply] = runGpu(bin, out, [{ call: 'view3d', doc: path, look: LOOK, size: [...REFERENCE_WINDOW], fps: 30, from: 0, frames: 1, capture: 'every', targets: ['final'] }]);
  if (reply!['code'] === 'unsupported_platform') inconclusive(`${name}: view3d answered unsupported_platform`);
  expect(reply!['code'], `${name}: view3d is answered, not refused: ${brief(reply)}`).toBeUndefined();
  const frames = arr(reply!['frames'], `${name}: frames`).map((f, i) => obj(f, `${name}: frames[${i}]`));
  expect(frames.length, `${name}: one frame`).toBe(1);
  const hash = frames[0]!['final'];
  expect(hash, `${name}: the frame's final target is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${String(hash)}.png`));
  expect(sha256(file), `${name}: the picture's file hashes to its name`).toBe(hash);
  return file;
}
