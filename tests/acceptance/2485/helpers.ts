import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
const CARGO_ARGS = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full'];
export const TIMEOUT = 1_200_000;

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
export function requireMetal(what: string): void {
  if (process.platform !== 'darwin') inconclusive(`${what} draws a 3D revision on macOS's Metal device; this is ${process.platform}`);
}

export function same(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  }
  if (isObject(a) || isObject(b)) {
    if (!isObject(a) || !isObject(b)) return false;
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && same(a[k], b[k]));
  }
  return a === b;
}
export function holds(value: JsonValue | undefined, wanted: JsonValue): boolean {
  if (same(value, wanted)) return true;
  if (Array.isArray(value)) return value.some((v) => holds(v, wanted));
  if (isObject(value)) return Object.values(value).some((v) => holds(v, wanted));
  return false;
}

export function useBuild(): () => string {
  let dir = '';
  let made: { bin: string; error: string; ran: boolean } | undefined;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-2485-bin-'));
    const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
    if (r.error) { made = { bin: '', error: `cargo could not run: ${r.error.message}`, ran: false }; return; }
    if (r.status !== 0) {
      const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
      made = { bin: '', error: `cargo ${CARGO_ARGS.join(' ')} failed:\n${lines.join('\n').slice(-4000)}`, ran: true };
      return;
    }
    const bin = join(dir, SHOW);
    copyFileSync(join(TARGET, 'debug', SHOW), bin);
    made = { bin, error: '', ran: true };
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    if (!made) throw Error('the build never ran');
    if (!made.ran) inconclusive(made.error);
    expect(made.error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return made.bin;
  };
}

export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-2485-')); made.push(d); return d; };
}

export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 900_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  expect(timedOut, `${SHOW} run finished within its timeout`).toBe(false);
  expect(r.status, `${SHOW} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(out['ok'], `${SHOW} run refused the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${SHOW} run: replies`).map((v, i) => obj(v, `${SHOW} run: replies[${i}]`));
  expect(replies.length, `${SHOW} run: one reply per call`).toBe(arr(scenario['calls'], 'the calls').length);
  return replies;
}

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: the effects', process: { pid: 4100, start: 1_000 } } as const;
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
const PANELS: JsonObject = { main: { rect: [0, 0, 1280, 720] } };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB2485D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB2485C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB2485Q', n)}`;

export const claimOf = (doc: string, req: string, check: JsonObject): JsonObject =>
  ({ session: ALPHA.id, deliverables: [doc], requirements: [{ id: req, check }] });

export interface Machine { os: string; driver: string }
export const MACHINE_A: Machine = { os: 'deep-test-os-a', driver: 'deep-test-driver-a' };
export const MACHINE_B: Machine = { os: 'deep-test-os-b', driver: 'deep-test-driver-b' };

export function scenarioOf(evidence: string, docs: Record<string, JsonObject>, claims: JsonObject, calls: JsonObject[], machine?: Machine): JsonObject {
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS,
    docs: Object.fromEntries(Object.entries(docs).map(([d, document]) => [d, { panel: 'main', document }])),
    claims,
    ...(machine ? { environment: { ...machine } } : {}),
    calls,
  };
}

export const verdict = (claim: string, against?: JsonObject): JsonObject => ({ call: 'verdict', claim, ...(against ? { against } : {}) });

export interface Issue { code: string; check: string; severity: string; ids: string[]; raw: JsonObject }
export interface Row { result: string; issues: Issue[]; blocked: JsonObject[]; raw: JsonObject }

function idsOf(issue: JsonObject): string[] {
  const v = issue['ids'];
  const list = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return [...new Set(list.map((s) => s.split('#')[0]!))].sort();
}
export function rowOf(v: JsonObject, req: string, what: string): Row {
  const rows = Array.isArray(v['requirements']) ? v['requirements'].filter(isObject) : [];
  const raw = rows.find((r) => r['id'] === req);
  expect(raw, `${what}: the verdict has a row for its requirement: ${brief(v)}`).toBeDefined();
  const issues = (Array.isArray(raw!['issues']) ? raw!['issues'] : []).map((x, i) => {
    const o = obj(x, `${what}: issues[${i}]`);
    return { code: typeof o['code'] === 'string' ? o['code'] : '', check: typeof o['check'] === 'string' ? o['check'] : '', severity: String(o['severity']), ids: idsOf(o), raw: o };
  });
  const blocked = (Array.isArray(raw!['blocked']) ? raw!['blocked'] : []).filter(isObject);
  return { result: String(raw!['result']), issues, blocked, raw: raw! };
}
export const raised = (row: Row): Issue[] => row.issues.filter((i) => i.severity === 'error' || i.severity === 'warning');
export const errorsOf = (row: Row): JsonValue[] =>
  row.issues.filter((i) => i.severity === 'error').map((i) => i.raw as JsonValue).sort((a, b) => brief(a, 1e6).localeCompare(brief(b, 1e6)));
export const faultsOf = (row: Row): string[] => raised(row).map((i) => `${i.code} [${i.ids.join(', ')}]`).sort();
const shown = (i: Issue): string => `${i.code || '(no code)'} by ${i.check || '(no check)'} [${i.ids.join(', ')}]`;
const reported = (issues: readonly Issue[]): string => issues.map(shown).join('; ') || 'nothing';

export function gpuGate(row: Row, what: string): void {
  const codes = row.blocked.map((b) => String(b['code'] ?? b['reason']));
  const gpu = codes.find((c) => c === 'gpu_unavailable' || c === 'unsupported_platform' || c === 'not_presented');
  if (row.result === 'BLOCKED' && gpu) inconclusive(`${what} is BLOCKED with ${gpu}: this machine has no GPU to draw the effect on`);
}

export function fixOps(issue: Issue): JsonObject[] | null {
  const pick = (v: JsonValue | undefined): JsonValue[] | null => (Array.isArray(v) ? v : isObject(v) && Array.isArray(v['ops']) ? v['ops'] : null);
  const list = pick(issue.raw['fix_ops']) ?? pick(issue.raw['fix']);
  return list !== null && list.length > 0 && list.every(isObject) ? list : null;
}

const OPS = ['create', 'set', 'unset', 'delete', 'move', 'reorder', 'rows', 'break_out'];
const BY_ID = ['set', 'unset', 'delete', 'move', 'reorder', 'rows'];
export function opFailures(ops: readonly JsonObject[], doc: JsonObject, item: string, what: string): string[] {
  const items = isObject(doc['items']) ? doc['items'] : {};
  const failures: string[] = [];
  for (const op of ops) {
    const name = op['op'];
    if (typeof name !== 'string' || !OPS.includes(name)) { failures.push(`${what}: ${brief(op, 400)} isn't one of Patch's ops (${OPS.join(', ')})`); continue; }
    if (name === 'create' && !isObject(op['item'])) failures.push(`${what}: ${brief(op, 400)} creates no item`);
    if (!BY_ID.includes(name)) continue;
    const id = op['id'];
    if (typeof id !== 'string' || !(id in items)) { failures.push(`${what}: ${brief(op, 400)} names no item the document holds`); continue; }
    if (name === 'set' || name === 'unset') {
      const path = op['path'];
      if (typeof path !== 'string' || !(path === `items/${id}` || path.startsWith(`items/${id}/`))) failures.push(`${what}: ${brief(op, 400)} writes outside items/${id}/`);
      if (name === 'set' && !('value' in op)) failures.push(`${what}: ${brief(op, 400)} sets no value`);
    }
  }
  const names = (op: JsonObject): boolean => op['id'] === item || (typeof op['path'] === 'string' && op['path'].startsWith(`items/${item}/`));
  if (!ops.some(names)) failures.push(`${what}: no op names the effect ${item}: ${brief(ops as JsonValue, 600)}`);
  return failures;
}

export const KIND = 'effects.audit';
const UNREAD_CODES = ['effects.audit_unread', 'not_run'];

export function matching(row: Row, item: string): Issue[] {
  return raised(row).filter((i) => i.check === KIND && i.code !== '' && !UNREAD_CODES.includes(i.code) && i.ids.includes(item));
}

export function caughtFailures(row: Row, item: string, doc: JsonObject, what: string): string[] {
  const failures: string[] = [];
  if (row.result !== 'FAIL') failures.push(`${what} is ${row.result}, not FAIL: ${brief(row.raw)}`);
  const found = matching(row, item);
  if (found.length === 0) {
    failures.push(`${what} raises no issue with a code by ${KIND} naming ${item}; it raises: ${reported(raised(row))}`);
    return failures;
  }
  const withOps = found.filter((i) => fixOps(i) !== null);
  if (withOps.length === 0) {
    failures.push(`${what}: ${found.map(shown).join('; ')} names its fix as text, not patch ops: ${found.map((i) => brief(i.raw['fix_ops'] ?? i.raw['fix'], 400)).join('; ')}`);
    return failures;
  }
  const errs = withOps.map((i) => opFailures(fixOps(i)!, doc, item, `${what}: ${shown(i)}'s fix`));
  if (errs.every((e) => e.length > 0)) failures.push(...errs.flat());
  return failures;
}
export function passFailures(row: Row, what: string): string[] {
  const failures: string[] = [];
  if (row.result !== 'PASS') failures.push(`${what} is ${row.result}, not PASS: ${brief(row.raw)}`);
  for (const i of raised(row)) failures.push(`${what} raises ${shown(i)} (${i.severity}): ${brief(i.raw, 600)}`);
  return failures;
}

const LAYER = 'alpha-main';
const CAM: JsonObject = { kind: 'camera@1', params: { projection: 'perspective', position: [0, 0, 6], target: [0, 0, 0], fov: 40, near: 0.1, far: 200 } };

function scene(title: string, id: string, effect: JsonObject): JsonObject {
  const items: Record<string, JsonObject> = { cam: CAM, [id]: effect };
  const out: JsonObject = {};
  let k = 0;
  for (const [i, item] of Object.entries(items)) out[i] = { id: i, name: i, order: `a${String(k++).padStart(4, '0')}`, layer: LAYER, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: an effects audit fixture.`,
    size: [320, 240], camera: 'cam', seed: 7, transport: { span: '2s' },
    requires: { modules: { scene3d: '^1', effects: '^1' } },
    layers: { [LAYER]: { writer: `agent:${ALPHA.thread}`, title: ALPHA.name, order: 'a0' } },
    items: out,
  };
}

interface Burst {
  count: number;
  draw: 'dot' | 'puff';
  size: number;
  radius: number | null;
  v0: [number, number] | null;
}
function particles(b: Burst): JsonObject {
  const motion = b.v0 ? { v0: b.v0, gravity: [0, 0, 0], drag: 0 } : { velocity: [0, 0, 0], gravity: [0, 0, 0], drag: 0 };
  const emit = b.radius === null ? { shape: 'point', bursts: [{ t: 0, count: b.count }] } : { shape: 'sphere', radius: b.radius, bursts: [{ t: 0, count: b.count }] };
  return {
    kind: 'particles@1', at: { pos: [0, 0, 0] },
    params: { count: b.count, emit, life: [1, 1], motion: { ballistic: motion }, draw: b.draw, size: b.size, opacity: 1, color: [{ at: 0, role: 'accent' }], seed: 7 },
  };
}

export interface Limits { count_peak: number; bounds: [V3, V3]; overdraw: { max: number }; gpu_ms: number }
const ROOMY: Limits = { count_peak: 4096, bounds: [[-3, -3, -3], [3, 3, 3]], overdraw: { max: 8 }, gpu_ms: 100 };
export const audit = (narrowed: Partial<Limits> = {}): JsonObject => ({ kind: KIND, ...(ROOMY as unknown as JsonObject), ...(narrowed as unknown as JsonObject) });

export interface Pair { name: string; item: string; planted: JsonObject; twin: JsonObject; plantedCheck: JsonObject; twinCheck: JsonObject }

export function countPair(): Pair {
  const check = audit({ count_peak: 1000 });
  const sparks = (count: number): JsonObject => particles({ count, draw: 'dot', size: 2, radius: 1.5, v0: null });
  return { name: 'an effect over its peak count', item: 'sparks', planted: scene('Sparks over their peak', 'sparks', sparks(2000)), twin: scene('Sparks under their peak', 'sparks', sparks(500)), plantedCheck: check, twinCheck: check };
}

export function boundsPair(): Pair {
  const check = audit({ bounds: [[-1, -1, -1], [1, 1, 1]] });
  const embers = (v0: [number, number]): JsonObject => particles({ count: 64, draw: 'dot', size: 2, radius: 0.3, v0 });
  return { name: 'an effect leaving its declared box', item: 'embers', planted: scene('Embers leaving their box', 'embers', embers([2, 3])), twin: scene('Embers inside their box', 'embers', embers([0.1, 0.2])), plantedCheck: check, twinCheck: check };
}

export function overdrawPair(): Pair {
  const check = audit({ overdraw: { max: 8 } });
  const smoke = (count: number): JsonObject => particles({ count, draw: 'puff', size: 120, radius: null, v0: null });
  return { name: 'an effect over overdraw 8', item: 'smoke', planted: scene('Smoke stacked deep', 'smoke', smoke(64)), twin: scene('Smoke stacked shallow', 'smoke', smoke(4)), plantedCheck: check, twinCheck: check };
}

export function gpuPair(): Pair {
  const flare = (): JsonObject => particles({ count: 256, draw: 'dot', size: 2, radius: 1, v0: null });
  return {
    name: 'an effect over its declared GPU time', item: 'flare',
    planted: scene('Flares over their time', 'flare', flare()), twin: scene('Flares within their time', 'flare', flare()),
    plantedCheck: audit({ gpu_ms: 0.0001 }), twinCheck: audit({ gpu_ms: 100 }),
  };
}
