import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { cpus, homedir, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const TIMEOUT = 3_600_000;

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
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
export function requireMetal(what: string): void {
  if (process.platform !== 'darwin') inconclusive(`${what} draws a 3D revision on macOS's Metal device; this is ${process.platform}`);
}
export function proof(label: string, value: JsonValue): void {
  console.log(`PROOF #1397 ${label}: ${JSON.stringify(value)}`);
}

const SHOW = 'deep-show';
export const FEATURES = 'full,test-export-guards';
const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
const targetDir = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));
const cargoArgs = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', FEATURES];

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${TOOLCHAIN}${delimiter}/opt/homebrew/opt/rustup/bin${delimiter}${process.env['PATH'] ?? ''}`,
    CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
    CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  };
  delete env['GIT_DIR'];
  delete env['GIT_WORK_TREE'];
  return env;
}

function buildInto(dir: string): { path: string; error: string; ran: boolean } {
  const r = spawnSync('nice', ['-n', '10', 'cargo', ...cargoArgs], { cwd: REPO, env: childEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { path: '', error: `cargo could not run: ${r.error.message}`, ran: false };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { path: '', error: `cargo ${cargoArgs.join(' ')} failed:\n${lines.join('\n').slice(-4000)}`, ran: true };
  }
  const path = join(dir, SHOW);
  copyFileSync(join(targetDir(), 'debug', SHOW), path);
  return { path, error: '', ran: true };
}

export function useBuild(): () => string {
  let dir = '';
  let made: { path: string; error: string; ran: boolean } | undefined;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1397-bin-'));
    made = buildInto(dir);
  }, 2 * TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    if (!made) throw Error('the build never ran');
    if (!made.ran) inconclusive(made.error);
    expect(made.error, `the binary builds: cargo ${cargoArgs.join(' ')}`).toBe('');
    return made.path;
  };
}

export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-1397-')); made.push(d); return d; };
}

const SESSION = 'sess-alpha';
const WORLD: JsonObject = {
  sessions: { [SESSION]: { thread: 'thread-alpha', name: 'Claude Code: the values stage', process: { pid: 4100, start: 1_000 } } },
  processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }],
  panels: { main: { rect: [0, 0, 1280, 720] } },
};
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB1397D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB1397C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB1397Q', n)}`;

export const claimOf = (doc: string, requirements: { id: string; check: JsonObject }[]): JsonObject =>
  ({ session: SESSION, deliverables: [doc], requirements });

export function scenarioOf(evidence: string, docs: readonly string[], claims: JsonObject, calls: JsonObject[], planted?: string): JsonObject {
  return {
    evidence, ...WORLD,
    docs: Object.fromEntries(docs.map((d) => [d, { panel: 'main' }])),
    claims,
    ...(planted ? { planted } : {}),
    calls,
  };
}

export const show = (doc: string, document: JsonObject): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc, document, t: '0s', size: [...FRAME], include: ['issues', 'pixels'] });
export const verdict = (claim: string): JsonObject => ({ call: 'verdict', claim });

export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, env: childEnv(), input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
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

export const FRAME: [number, number] = [1920, 1080];
export const OPERATOR = 'test.divide@1';
export const CENTRE: [number, number] = [960, 540];
export const CARD = 'card';
export const CARDS = ['card-a', 'card-b', 'card-c', 'card-d'] as const;
const GREY = 0.18;
const UNIT_EXPOSURE = -Math.log2(1.2);
const SIDE = 0.28125;
const SMALL = 0.125;
const CARD_X = [-0.3, -0.1, 0.1, 0.3] as const;
const PX_PER_M = FRAME[0];
const COVER = 200;

export const FRAMING: JsonObject = { kind: 'camera.framing', keep: [CARD] };
export const EXPOSURE: JsonObject = { kind: 'render.exposure', subject: [CARD] };

const camera: JsonObject = {
  kind: 'camera@1',
  params: { projection: 'orthographic', target: [0, 1, 0], orbit: { azimuth: 0, elevation: 0, distance: 5 }, view_width: 1, near: 0.05, far: 50, exposure: UNIT_EXPOSURE },
};
const sky: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
const greyMat: JsonObject = { kind: 'material@1', params: { base_color: [GREY, GREY, GREY, 1], unlit: true, alpha_mode: 'opaque', alpha: 1, double_sided: true } };
const box = (side: number, x: number): JsonObject => ({ kind: 'mark.box@1', params: { size: [side, side, 0.05] }, at: { pos: [x, 1, 0] }, material: 'grey-mat' });
const divide = (rects: number[][], guard: boolean): JsonObject => ({ kind: OPERATOR, params: { rects, guard } });

function documentOf(title: string, description: string, items: Record<string, JsonObject>, guards: boolean): JsonObject {
  let k = 0;
  const named: JsonObject = {};
  for (const [id, item] of Object.entries(items)) named[id] = { id, name: id, order: `a${String(k++).padStart(4, '0')}`, ...item };
  return {
    format: 1, profile: 'scene', title, description, size: [...FRAME], camera: 'cam',
    requires: { modules: guards ? { scene3d: '^1', 'test.guards': '^1' } : { scene3d: '^1' } }, items: named,
  };
}

export function cardDoc(): JsonObject {
  return documentOf('A grey card', 'A middle grey card at the centre of the frame, exposed to read as middle grey.',
    { cam: camera, sky, 'grey-mat': greyMat, [CARD]: box(SIDE, 0) }, false);
}

export function dividedCardDoc(guard: boolean): JsonObject {
  return documentOf('A grey card under a first-party divide', 'A middle grey card with a ledgered first-party operator that divides at one pixel on it.',
    { cam: camera, sky, 'grey-mat': greyMat, [CARD]: box(SIDE, 0), divide: divide([[CENTRE[0], CENTRE[1], 1, 1]], guard) }, true);
}

export const RACE_COUNT = CARDS.length * COVER * COVER;
export function dividedCardsDoc(): JsonObject {
  const items: Record<string, JsonObject> = { cam: camera, sky, 'grey-mat': greyMat };
  CARDS.forEach((id, i) => { items[id] = box(SMALL, CARD_X[i]!); });
  const rects = CARD_X.map((x) => [Math.round(FRAME[0] / 2 + x * PX_PER_M - COVER / 2), FRAME[1] / 2 - COVER / 2, COVER, COVER]);
  items['divide'] = divide(rects, false);
  return documentOf('Four grey cards under a first-party divide', 'Four middle grey cards in a row, each with a square the ledgered first-party operator divides over.', items, true);
}

export function names(v: JsonValue | undefined, name: string): boolean {
  if (typeof v === 'string') return v === name || v.endsWith(`/${name}`) || v.split('#')[0] === name;
  if (Array.isArray(v)) return v.some((x) => names(x, name));
  if (isObject(v)) return Object.entries(v).some(([k, x]) => k !== 'message' && k !== 'what' && names(x, name));
  return false;
}

export function finiteIssues(v: JsonValue | undefined): JsonObject[] {
  const out: JsonObject[] = [];
  const walk = (x: JsonValue | undefined): void => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (isObject(x)) {
      if (x['code'] === 'frames.finite') out.push(x);
      Object.values(x).forEach(walk);
    }
  };
  walk(v);
  return out;
}

export function snapshotsOf(reply: JsonObject): JsonObject[] {
  return Array.isArray(reply['snapshots']) ? reply['snapshots'].filter(isObject) : [];
}

export function refusedFailures(reply: JsonObject, count: number, items: readonly string[], what: string): string[] {
  const failures: string[] = [];
  const snaps = snapshotsOf(reply).filter((s) => typeof s['sha256'] === 'string');
  if (snaps.length > 0) failures.push(`${what}: the render-back returns its frame as evidence (${brief(snaps, 400)}); a frame holding a non-finite value is refused`);
  const found = finiteIssues(reply);
  const fitting = found.filter((i) => i['count'] === count && names(i, OPERATOR) && items.some((id) => names(i['item'], id)));
  if (fitting.length === 0) {
    failures.push(`${what}: no frames.finite issue carries count ${count}, names the operator ${OPERATOR} and names as its item one of ${items.join(', ')}: ${brief(found.length ? found : reply, 2000)}`);
  }
  return failures;
}

export function namedItem(reply: JsonObject): string | null {
  const i = finiteIssues(reply)[0];
  if (!i) return null;
  const item = i['item'];
  if (typeof item === 'string') return item.split('#')[0]!;
  if (Array.isArray(item) && typeof item[0] === 'string') return item[0].split('#')[0]!;
  return null;
}

export interface Row { result: string; issues: JsonObject[]; raw: JsonObject }
export function rowOf(v: JsonObject, req: string, what: string): Row {
  const rows = Array.isArray(v['requirements']) ? v['requirements'].filter(isObject) : [];
  const raw = rows.find((r) => r['id'] === req);
  expect(raw, `${what}: the verdict has a row for its requirement: ${brief(v)}`).toBeDefined();
  const issues = (Array.isArray(raw!['issues']) ? raw!['issues'] : []).filter(isObject);
  return { result: String(raw!['result']), issues, raw: raw! };
}

export function gpuGate(row: Row, what: string): void {
  const notes = [...(Array.isArray(row.raw['blocked']) ? row.raw['blocked'] : []), ...(Array.isArray(row.raw['inconclusive']) ? row.raw['inconclusive'] : [])].filter(isObject);
  const gpu = notes.find((b) => ['gpu_unavailable', 'unsupported_platform', 'software_adapter'].includes(String(b['code'])) || b['reason'] === 'unsupported_platform');
  if (gpu) inconclusive(`${what} couldn't draw on this machine's GPU: ${brief(gpu, 400)}`);
}

export function rowFailsNaming(row: Row, item: string, what: string): string[] {
  const failures: string[] = [];
  if (row.result !== 'FAIL') failures.push(`${what} is ${row.result}, not FAIL: ${brief(row.raw, 1500)}`);
  if (!row.issues.some((i) => names(i, OPERATOR) && names(i, item))) {
    failures.push(`${what}: no issue names the operator ${OPERATOR} and the item ${item}: ${brief(row.issues, 1500)}`);
  }
  return failures;
}

export function rowPasses(row: Row, what: string): string[] {
  return row.result === 'PASS' ? [] : [`${what} is ${row.result}, not PASS: ${brief(row.raw, 1500)}`];
}

export const load = (): number => loadavg()[0]!;
export const cores = (): number => cpus().length;
export function chip(): string {
  const r = spawnSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8' });
  return (r.stdout ?? '').trim();
}

interface Bench { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject }
const bench = async (): Promise<Bench> => (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
export async function hardwareProblem(): Promise<string> {
  const b = await bench();
  const machine = b.fingerprint();
  const at = { ...machine, power: 'ac', lowPowerMode: false, thermalState: 'nominal', macosBuild: machine['macosBuild'] ?? 'unread' };
  const zeros = Array.from({ length: 5 }, () => ({ start: 0, end: 0 }));
  const v = b.judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint: at, loads: zeros });
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}
