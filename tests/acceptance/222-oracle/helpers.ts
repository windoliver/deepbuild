// Test-side tools for the #222 Oracle lane: `deep-show` built once per file and driven by JSON lines (#393's
// `deep-show run`, with `deep show` and `eval`), the cue lists the ported upstream scenarios describe, and reading a
// cue list's markers and a frame's values. The surface is the #222 suite's (tests/acceptance/222/README.md: The
// surface under test); nothing new is named here. Parts are copied from that suite's helpers, since suites don't
// import each other. Nothing here stands in for the expander: every value a test compares comes from the binary.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/222-oracle is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
export const TIMEOUT = 3_600_000;

/** The #222 criteria the Oracle page links upstream tests to (the same IDs as tests/acceptance/222's). */
export const AC = { 1: 'AC1 #222.88afab32', 2: 'AC2 #222.98d07f32', 3: 'AC3 #222.f801fafc' } as const;

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
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
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A case that needs what this lane can't run: never a pass, with one unblock line. */
export function blocked(reason: string, unblock: string): never {
  expect.fail(`BLOCKED: ${reason}\nUnblock: ${unblock}`);
}

export const FLICKS = 705_600_000;
export const fl = (s: number): number => Math.round(s * FLICKS);
export const showTime = (f: number): string => `${f / FLICKS} s (${f} flicks)`;
/** A time as a reply writes it, in exact flicks: an integer is flicks, `"<decimal>s"` is seconds; else null. */
export function flicksOf(v: JsonValue | undefined): number | null {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = /^(-?)(\d+)(?:\.(\d+))?s$/.exec(v.trim());
  if (!m) return null;
  const frac = m[3] ?? '';
  const scaled = BigInt(`${m[2]!}${frac}`) * BigInt(FLICKS);
  const den = 10n ** BigInt(frac.length);
  if (scaled % den !== 0n) return null;
  const f = Number(scaled / den);
  return m[1] === '-' ? -f : f;
}
/** smoothstep, 3x² − 2x³ on [0, 1]: the ease@1 entry the ports set on their cues, as the design names it. */
export const smoothstep = (x: number): number => x * x * (3 - 2 * x);

/** `cargo build --locked --bin deep-show --no-default-features --features full`, once per file, in beforeAll. */
export function useShow(): () => string {
  let dir = ''; let error = 'not built'; let bin = '';
  const args = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full'];
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-222-oracle-'));
    const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
    if (r.error) error = `cargo could not run: ${r.error.message}`;
    else if (r.status !== 0) error = `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(-4000)}`;
    else { error = ''; bin = join(dir, `${SHOW}-full`); copyFileSync(join(TARGET, 'debug', SHOW), bin); }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(error, `the binary builds: cargo ${args.join(' ')}`).toBe(''); return bin; };
}
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-222-oracle-')); made.push(d); return d; };
}

/** The first-party pack of verbs (tests/acceptance/222/README.md: The first-party verbs). */
const VERBS_PACK = { id: 'deepbuild/verbs', dir: join(REPO, 'packs', 'verbs-1.0.0') };
export const VERBS_AT = 'deepbuild/verbs@1.0.0';
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
export const docId = (n: number): string => `01JB222R${String(n).padStart(18, '0')}`;

/** One `deep-show run` of `calls`, with the first-party verbs offered: its replies, one per call. */
export function run(bin: string, evidence: string, calls: JsonObject[]): JsonObject[] {
  const docs: JsonObject = {};
  for (const c of calls) if (typeof c['doc'] === 'string') docs[c['doc']] = { panel: 'main' };
  const scenario = { evidence, sessions: {}, processes: PROCESSES, panels: { main: { rect: [0, 0, 1920, 1080] } }, docs, packs: [VERBS_PACK], calls };
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  expect(r.error?.message ?? '', `${SHOW} run started and finished`).toBe('');
  expect(r.status, `${SHOW} run exits 0; stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(out['ok'], `${SHOW} run refused the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], 'replies').map((x, i) => obj(x, `replies[${i}]`));
  expect(replies.length, `${SHOW} run: one reply per call`).toBe(calls.length);
  return replies;
}
export const present = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues'] });
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${brief(reply)}`).toBe('presented');
  const errors = (Array.isArray(reply['issues']) ? reply['issues'] : []).filter((i) => isObject(i) && i['severity'] === 'error');
  expect(errors, `${what} raises no error`).toEqual([]);
}
export const evalAt = (doc: string, t: number, paths: string[]): JsonObject => ({ call: 'eval', doc, t, paths });
export function valuesOf(reply: JsonObject, what: string): JsonObject {
  expect(reply['outcome'], `${what} is evaluated: ${brief(reply, 600)}`).toBe('evaluated');
  return obj(reply['values'], `${what}: values`);
}

export const LIST = 'list';
/** A 640 × 360 u film (24 fps) of the items given, naming the first-party verbs. */
export function film(title: string, items: JsonObject[], span: number): JsonObject {
  return {
    format: 1, profile: 'film', title, description: `${title}: a film of the #222 Oracle lane.`, size: [640, 360],
    transport: { span: `${span}s`, frame_rate: '24/1' }, packs: [VERBS_AT], items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
  };
}
export const square = (id: string, pos: [number, number] = [0, 0]): JsonObject =>
  ({ id, kind: 'rect@1', name: `Square ${id}`, order: `c${id}`, params: { box: [-10, -10, 20, 20], paint: { fill: { role: 'ink' } } }, at: { pos: [pos[0], pos[1], 0] } });
export const cueList = (cues: JsonObject[]): JsonObject => ({ id: LIST, kind: 'cues@1', name: 'Cue list', order: 'z0', params: { cues } });

/** Each `cues.<id>` marker of the cue list's expansion in a `deep show` reply, as [start, end] in flicks. */
export function windowsOf(reply: JsonObject, what: string): Record<string, [number, number]> {
  const all = arr(reply['expansions'], `${what}: expansions`).filter(isObject);
  const e = all.find((x) => x['instance'] === LIST);
  expect(e, `${what}: the reply's expansions hold the cue list's`).toBeDefined();
  const out: Record<string, [number, number]> = {};
  for (const [name, m] of Object.entries(obj(e!['markers'], `${what}: markers`))) {
    const mo = obj(m, `${what}: markers.${name}`);
    const t = flicksOf(mo['t']); const span = flicksOf(mo['span'] ?? 0);
    expect(t !== null && span !== null, `${what}: markers.${name} in whole flicks, got ${brief(mo)}`).toBe(true);
    if (name.startsWith('cues.')) out[name.slice(5)] = [t!, t! + span!];
  }
  return out;
}
/** The windows of the cues named, which must all be there. */
export function windows(reply: JsonObject, ids: readonly string[], what: string): [number, number][] {
  const w = windowsOf(reply, what);
  return ids.map((id) => {
    expect(w[id], `${what}: the expansion writes the marker cues.${id}; it writes ${Object.keys(w).join(', ') || 'none'}`).toBeDefined();
    return w[id]!;
  });
}
