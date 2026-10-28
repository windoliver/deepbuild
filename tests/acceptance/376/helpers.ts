// Test-side tools for the #376 acceptance tests: `deep-show` built with the full build set and driven by
// JSON lines (#393's convention); the scenario it runs (an agent's session, the process table, panels,
// the virtual display clock); the fixture figure and its twins; and the criterion's checks, each returning
// its failures as sentences that name what failed. Nothing here stands in for the document check, the
// accessibility tree or its announcements.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/376 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const SHOW_NAME = 'deep-show';
const BUILT = join(REPO, 'target', 'debug', process.platform === 'win32' ? `${SHOW_NAME}.exe` : SHOW_NAME);

/** Flicks in one second (One clock). */
export const FLICKS = 705_600_000;

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
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A fixture file of this suite, parsed. */
export function fixture(path: string): JsonObject {
  return obj(JSON.parse(readFileSync(join(HERE, 'fixtures', path), 'utf8')) as JsonValue, `fixture ${path}`);
}

/** No failures; the message lists them, each naming what failed. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}

/** At least one failure, and one that names each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
  }
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show` with the full build set, built once per file and copied out.

/** Builds `deep-show --features full` once, before the file's tests; returns the binary, or fails with cargo's error. */
export function useShow(): () => string {
  let dir = '';
  let error = '';
  let bin = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-376-bin-'));
    const args = ['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', 'full'];
    const built = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (built.error) error = `cargo could not run: ${built.error.message}`;
    else if (built.status !== 0) error = `cargo ${args.join(' ')} failed:\n${built.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished/.test(l)).join('\n')}`;
    else {
      bin = join(dir, SHOW_NAME);
      copyFileSync(BUILT, bin);
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: ${SHOW_NAME} with features full`).toBe('');
    return bin;
  };
}

/** `deep-show run`: one scenario, accepted, with one reply per call (#393's convention). */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const ran = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 300_000, killSignal: 'SIGKILL' });
  if (ran.error) throw Error(`${SHOW_NAME} run: ${ran.error.message}`);
  expect(ran.status, `${SHOW_NAME} run exits 0 (${ran.signal ?? 'no signal'}); stderr: ${(ran.stderr ?? '').slice(0, 2000)}`).toBe(0);
  const lines = ran.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(scenario['calls'], "the scenario's calls").length);
  return replies;
}

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-376-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// The world the scenarios share: one agent's session, the process table, one panel, the clock.

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: lens figure', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 4100, ppid: 3000, start: 1_000 },
];
/** The document the hub minted for the figure. */
export const DOC = '01JB76D0000000000000000001';
export const PANEL = 'main';
/** 60 Hz, latched at the vsync, a check taking no clock time: #96's virtual display clock. */
const CLOCK: JsonObject = { refresh_hz: 60, lead: 0, check: 0 };

/** A scenario with the figure's document on `main`, alpha's session, the virtual clock and the calls. */
export function scenario(evidence: string, calls: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: { [PANEL]: { rect: [0, 0, 800, 600] } },
    docs: { [DOC]: { panel: PANEL } },
    clock: CLOCK,
    ...extra,
    calls,
  };
}

/** Alpha's deep_show whole revision of the figure, arriving at `at` flicks. */
export const show = (document: JsonObject, at: number): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc: DOC, document, at });
/** The frames the panel presented up to `at` (#383). */
export const presented = (at: number): JsonObject => ({ call: 'presented', panel: PANEL, at });
/** The replica's `see` of the panel at `at`: its accessibility tree and announcements (README: `see`). */
export const see = (at: number): JsonObject => ({ call: 'see', panel: PANEL, at });

// ---------------------------------------------------------------------------------------------------
// The fixture figure and its twins

/** The fixed figure: a description, three named parts, a label, a readout and two controls with roles. */
export const figure = (): JsonObject => fixture('figure.json');
export const PARTS = ['beam', 'lens', 'screen'] as const;
export const CONTROLS = ['c-rays', 'c-labels'] as const;
export const READOUT = 'count';

/** The figure with the readout's value set to `count`. */
export function withCount(count: number): JsonObject {
  const doc = figure();
  obj(obj(doc['data'], 'figure: data')['count'], 'figure: data.count')['value'] = count;
  return doc;
}

/** The figure with the beam moved down by `dy`: every part redrawn, the readout unchanged. */
export function withBeamMoved(dy: number, count: number): JsonObject {
  const doc = withCount(count);
  const params = obj(obj(obj(doc['items'], 'items')['beam'], 'beam')['params'], 'beam.params');
  const box = arr(params['box'], 'beam.params.box').map((n) => num(n, 'beam box'));
  params['box'] = [box[0]!, box[1]! + dy, box[2]!, box[3]!];
  return doc;
}

// ---------------------------------------------------------------------------------------------------
// Replies

export const outcome = (reply: JsonObject): string => String(reply['outcome']);

export interface Issue { code: string; severity: string; ids: string[]; path: string }
export function issues(reply: JsonObject, what = 'the reply'): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return {
      code: String(o['code']), severity: String(o['severity']),
      ids: Array.isArray(o['ids']) ? o['ids'].map(String) : [], path: typeof o['path'] === 'string' ? o['path'] : '',
    };
  });
}

export interface Frame { vsync: number; rev: number }
export function frames(reply: JsonObject, what = 'presented'): Frame[] {
  return arr(reply['frames'], `${what}: frames`).map((f, i) => {
    const o = obj(f, `${what}: frames[${i}]`);
    return { vsync: num(o['vsync'], `${what}: frames[${i}].vsync`), rev: num(o['rev'], `${what}: frames[${i}].rev`) };
  });
}

export interface Node { id: string; role: string; name: string }
/** The `see` reply's accessibility tree, one row per node (README: `see`). */
export function tree(reply: JsonObject): Node[] {
  return arr(reply['tree'], 'see: tree').map((v, i) => {
    const o = obj(v, `see: tree[${i}]`);
    return { id: str(o['id'], `see: tree[${i}].id`), role: str(o['role'], `see: tree[${i}].role`), name: str(o['name'], `see: tree[${i}].name`) };
  });
}

export interface Announcement { t: number; id: string; text: string }
/** The `see` reply's announcements, every one the panel made up to the call (README: `see`). */
export function announcements(reply: JsonObject): Announcement[] {
  return arr(reply['announcements'], 'see: announcements').map((v, i) => {
    const o = obj(v, `see: announcements[${i}]`);
    return { t: num(o['t'], `see: announcements[${i}].t`), id: str(o['id'], `see: announcements[${i}].id`), text: str(o['text'], `see: announcements[${i}].text`) };
  });
}

// ---------------------------------------------------------------------------------------------------
// The criterion's checks, each returning its failures as sentences naming what failed.

/**
 * A figure missing `field` is refused before showing: the reply is `refused`, an error names the item
 * (`id`, none for the envelope's description) and the field's path, and the panel presents no frame of it.
 */
export function refusalFailures(reply: JsonObject, before: JsonObject, id: string | null, path: string): string[] {
  const failures: string[] = [];
  const what = id === null ? `the figure without ${path}` : `the figure whose ${id} lacks ${path}`;
  if (outcome(reply) !== 'refused') failures.push(`${what} was ${outcome(reply)}, not refused`);
  const naming = issues(reply).filter((i) => i.severity === 'error' && i.path === path && (id === null || i.ids.includes(id)));
  if (naming.length === 0) {
    failures.push(`no error issue of ${what} names ${id === null ? '' : `item ${id} and `}field ${path}: ${JSON.stringify(reply['issues'] ?? null).slice(0, 800)}`);
  }
  const shown = frames(before, `presented after ${what}`);
  if (shown.length !== 0) failures.push(`${what} was shown: the panel presented ${shown.length} frame(s) of it`);
  return failures;
}

/** Each part and control has exactly one node in the tree, with the name and role the document gives it. */
export function treeFailures(nodes: Node[], doc: JsonObject): string[] {
  const failures: string[] = [];
  const items = obj(doc['items'], 'figure: items');
  const controls = obj(doc['controls'], 'figure: controls');
  const want: { id: string; role: string; name: string; what: string }[] = [
    ...PARTS.map((id) => {
      const item = obj(items[id], `item ${id}`);
      return { id, role: str(item['role'], `${id}.role`), name: str(item['name'], `${id}.name`), what: 'part' };
    }),
    ...CONTROLS.map((id) => {
      const control = obj(controls[id], `control ${id}`);
      return { id, role: str(control['role'], `${id}.role`), name: str(control['label'], `${id}.label`), what: 'control' };
    }),
  ];
  for (const w of want) {
    const found = nodes.filter((n) => n.id === w.id);
    if (found.length !== 1) { failures.push(`${w.what} ${w.id} has ${found.length} nodes in the accessibility tree, not one`); continue; }
    const n = found[0]!;
    if (n.name !== w.name) failures.push(`${w.what} ${w.id}'s node is named ${JSON.stringify(n.name)}, not ${JSON.stringify(w.name)}`);
    if (n.role !== w.role) failures.push(`${w.what} ${w.id}'s node has role ${JSON.stringify(n.role)}, not ${JSON.stringify(w.role)}`);
  }
  return failures;
}

/**
 * The readout `readout` is redrawn unchanged at `redrawnAt` and changed to `value` at `changedAt`; `see`
 * ran at `until`. No announcement in [redrawnAt, changedAt); exactly one in [changedAt, until], naming the
 * readout, its text holding `value`. Each failure names the readout.
 */
export function announcementFailures(list: Announcement[], readout: string, value: string, redrawnAt: number, changedAt: number, until: number): string[] {
  const failures: string[] = [];
  const s = (t: number): string => `${t / FLICKS} s`;
  const unchanged = list.filter((a) => a.t >= redrawnAt && a.t < changedAt);
  if (unchanged.length > 0) {
    failures.push(`readout ${readout} was redrawn unchanged at ${s(redrawnAt)} and ${unchanged.length} announcement(s) followed before ${s(changedAt)}: ${JSON.stringify(unchanged).slice(0, 600)}`);
  }
  const changed = list.filter((a) => a.t >= changedAt && a.t <= until);
  if (changed.length !== 1) {
    failures.push(`readout ${readout} changed to ${value} at ${s(changedAt)} and ${changed.length} announcement(s) followed by ${s(until)}, not one: ${JSON.stringify(changed).slice(0, 600)}`);
  } else {
    const a = changed[0]!;
    if (a.id !== readout) failures.push(`the announcement after readout ${readout} changed names ${a.id}, not ${readout}`);
    if (!a.text.includes(value)) failures.push(`the announcement after readout ${readout} changed to ${value} says ${JSON.stringify(a.text)}, without ${value}`);
  }
  return failures;
}
