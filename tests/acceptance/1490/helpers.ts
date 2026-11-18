// Test-side tools for the #1490 acceptance tests (README: The surface under test): the size record of the web player's
// module sets, read from the checkout and measured again here; the web export of #172 driven through `deep-show run`,
// with the module set its receipt names; and what #172's suite already defines, imported read-only as 172 imports
// 169's helpers: the builds, the scenario, the physics lab and the 2D piece with a slider, the server, headless Chrome
// with WebGPU and `probe()`. Nothing here stands in for the record, the export, the bundle or the player: every value
// a test compares comes from the checkout's files, `deep-show`, the files the export wrote or the browser, and every
// expected value from the issue's text and the design.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, normalize, sep } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { expect } from 'vitest';
import {
  DOC, REPO, TIMEOUT, YEAR_DEFAULT, arr, bundleFailures, exportOnce, filesUnder, hex64, int, isObject, isWasm, obj, present, presented,
  scenarioOf, sha256, show, stagesDoc, str, trackEntry, webExport, webReceiptOf, type JsonObject, type JsonValue, type Probe, type WebReceipt,
} from '../172/helpers.ts';

/** Each criterion's ID: `#1490.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #1490.4cd26262',
  2: 'AC2 #1490.db64c0a5',
  3: 'AC3 #1490.22b977d9',
  4: 'AC4 #1490.90194dfc',
  5: 'AC5 #1490.ea61d337',
} as const;

/** The two sets every criterion names. */
export const FIGURE = 'figure';
export const FULL_SET = 'full';

// ---------------------------------------------------------------------------------------------------
// The size record (README: The size record), chosen: `crates/deep-player/web/dist/sets.json`, beside the sets'
// committed bytes, `{compression: "brotli-11", sets: {<name>: {modules, module_set_digest, wasm: {path, sha256},
// glue: {path, sha256}, compressed}}}`, every path relative to the checkout.

export const RECORD = 'crates/deep-player/web/dist/sets.json';
export const COMPRESSION = 'brotli-11';
/** How far a recorded size may stand from this file's own measure of the same bytes (another Brotli build's output). */
export const SIZE_TOLERANCE = 0.01;

export interface PlayerFile { path: string; sha256: string }
export interface ModuleSet { name: string; modules: string[]; module_set_digest: string; wasm: PlayerFile; glue: PlayerFile; compressed: number }
export interface SizeRecord { compression: string; sets: Map<string, ModuleSet>; raw: JsonObject }

/** The record's JSON read into its shape; any field missing or of another type fails, naming it. */
export function recordOf(raw: JsonValue): SizeRecord {
  const r = obj(raw, RECORD);
  const sets = new Map<string, ModuleSet>();
  for (const [name, v] of Object.entries(obj(r['sets'], `${RECORD}: sets`))) {
    const at = `${RECORD}: sets.${name}`;
    const s = obj(v, at);
    const file = (k: string): PlayerFile => {
      const f = obj(s[k], `${at}.${k}`);
      return { path: str(f['path'], `${at}.${k}.path`), sha256: hex64(f['sha256'], `${at}.${k}.sha256`) };
    };
    sets.set(name, {
      name, modules: arr(s['modules'], `${at}.modules`).map((m, i) => str(m, `${at}.modules[${i}]`)), module_set_digest: hex64(s['module_set_digest'], `${at}.module_set_digest`),
      wasm: file('wasm'), glue: file('glue'), compressed: int(s['compressed'], `${at}.compressed`),
    });
  }
  return { compression: str(r['compression'], `${RECORD}: compression`), sets, raw: r };
}
/** The checkout's size record; at the merge base there is none. */
export function readRecord(): SizeRecord {
  const file = join(REPO, RECORD);
  expect(existsSync(file), `the size record ${RECORD} exists`).toBe(true);
  let raw: JsonValue;
  try { raw = JSON.parse(readFileSync(file, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`${RECORD} is not JSON: ${(e as Error).message}`); }
  return recordOf(raw);
}
/** The record's set `name`, which must be there. */
export function setOf(record: SizeRecord, name: string): ModuleSet {
  const s = record.sets.get(name);
  expect(s, `${RECORD} lists the set ${name}; it lists ${[...record.sets.keys()].join(', ') || 'none'}`).toBeTruthy();
  return s!;
}
/** The smallest set the record lists: the fewest modules, then the fewest compressed bytes. */
export function smallestSet(record: SizeRecord): ModuleSet {
  const sets = [...record.sets.values()].sort((a, b) => a.modules.length - b.modules.length || a.compressed - b.compressed);
  expect(sets.length, `${RECORD} lists sets`).toBeGreaterThan(0);
  return sets[0]!;
}

/** Brotli at quality 11, Node's window, the input's length as its size hint (as #172's budgets compress the player). */
export const brotli11 = (b: Buffer): number => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;

export interface Measured { compressed: number; problems: string[] }
/** A file the record names, read from the checkout: its bytes, or why they can't be the record's. */
function fileOf(set: string, role: string, f: PlayerFile): { bytes: Buffer | null; problem: string | null } {
  const where = `the set ${set}'s ${role} ${f.path}`;
  if (isAbsolute(f.path) || normalize(f.path).split(sep).includes('..')) return { bytes: null, problem: `${where} is not a path inside the checkout` };
  const path = join(REPO, f.path);
  if (!existsSync(path)) return { bytes: null, problem: `${where} is not in the checkout` };
  const bytes = readFileSync(path);
  if (sha256(bytes) !== f.sha256) return { bytes: null, problem: `${where} hashes to ${sha256(bytes)}, the record names ${f.sha256}` };
  return { bytes, problem: null };
}
/** Each set's player measured from the checkout: Brotli 11 of its WebAssembly and of its page glue, summed. */
export function measureSets(record: SizeRecord): Map<string, Measured> {
  const out = new Map<string, Measured>();
  for (const s of record.sets.values()) {
    const wasm = fileOf(s.name, 'player', s.wasm);
    const glue = fileOf(s.name, 'page glue', s.glue);
    const problems = [wasm.problem, glue.problem].filter((p): p is string => p !== null);
    if (wasm.bytes && !isWasm(wasm.bytes)) problems.push(`the set ${s.name}'s player ${s.wasm.path} is not WebAssembly`);
    out.set(s.name, { compressed: wasm.bytes && glue.bytes ? brotli11(wasm.bytes) + brotli11(glue.bytes) : NaN, problems });
  }
  return out;
}
/** The record against the checkout: it says what its numbers are, it lists `figure` and `full`, each set's files are
 * the checkout's by hash, each set's compressed size is its player's as measured here, within the tolerance, `figure`
 * holds fewer modules than `full` and only modules `full` holds, and no two sets ship one player. Each failure names
 * the set. */
export function recordFailures(record: SizeRecord, measured: Map<string, Measured>): string[] {
  const f: string[] = [];
  if (record.compression !== COMPRESSION) f.push(`${RECORD} says its sizes are ${record.compression}, not ${COMPRESSION}`);
  for (const name of [FIGURE, FULL_SET]) if (!record.sets.has(name)) f.push(`${RECORD} gives no size for the set ${name}`);
  for (const s of record.sets.values()) {
    const m = measured.get(s.name);
    if (!m) { f.push(`the set ${s.name} wasn't measured`); continue; }
    f.push(...m.problems);
    if (!m.problems.length && Math.abs(s.compressed - m.compressed) > SIZE_TOLERANCE * m.compressed) {
      f.push(`the set ${s.name}: the record gives ${s.compressed} bytes compressed, its player measures ${m.compressed} (${COMPRESSION})`);
    }
    if (!s.modules.length) f.push(`the set ${s.name} lists no module`);
  }
  const figure = record.sets.get(FIGURE);
  const full = record.sets.get(FULL_SET);
  if (figure && full) {
    const outside = figure.modules.filter((m) => !full.modules.includes(m));
    if (outside.length) f.push(`the set ${FIGURE} holds ${outside.join(', ')}, which ${FULL_SET} doesn't`);
    if (figure.modules.length >= full.modules.length) f.push(`the set ${FIGURE} holds ${figure.modules.length} modules, ${FULL_SET} ${full.modules.length}`);
  }
  const byPlayer = new Map<string, string>();
  for (const s of record.sets.values()) {
    const other = byPlayer.get(s.wasm.sha256);
    if (other) f.push(`the sets ${other} and ${s.name} ship one player, ${s.wasm.sha256}`);
    byPlayer.set(s.wasm.sha256, s.name);
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------
// The web export (#172's call, README: The surface under test) and the set its receipt names

export interface Exported { out: string; receipt: WebReceipt }
/** One `deep-show run`: `document` shown from your shell, then its web export into `out` on `track`; it must be
 * exported, and its bundle must hold every file its receipt names, by hash. `planted` is the scenario's key. */
export function exportPiece(bin: string, evidence: string, document: JsonObject, out: string, what: string, o: { track?: JsonObject[]; planted?: string } = {}): Exported {
  const reply = exportOnce(bin, evidence, document, out, what, { ...(o.track ? { track: o.track } : {}), ...(o.planted ? { planted: o.planted } : {}) });
  const receipt = webReceiptOf(reply, what);
  const missing = bundleFailures(out, receipt, what);
  expect(missing, `${what}: the bundle holds every file its receipt names, each by its hash`).toEqual([]);
  return { out, receipt };
}
/** The module set the receipt names (`player.module_set`, chosen). */
export const moduleSetOf = (receipt: WebReceipt): JsonValue | undefined => obj(receipt.raw['player'], 'receipt.player')['module_set'];
/** A bundle against the set `name` of the record: its receipt names `name`, with that set's digest and player hash;
 * the bundle holds that set's player and page glue by hash and no other set's player. Each failure names the set. */
export function setFailures(e: Exported, record: SizeRecord, name: string, what: string): string[] {
  const f: string[] = [];
  const named = moduleSetOf(e.receipt);
  if (named !== name) f.push(`${what}: the receipt names the module set ${show(named ?? null)}, not ${name}`);
  const s = record.sets.get(name);
  if (!s) return [...f, `${what}: ${RECORD} lists no set ${name}`];
  if (e.receipt.player.module_set_digest !== s.module_set_digest) f.push(`${what}: the receipt's module_set_digest ${e.receipt.player.module_set_digest} is not the set ${name}'s ${s.module_set_digest}`);
  if (e.receipt.player.hash !== s.wasm.sha256) f.push(`${what}: the receipt's player ${e.receipt.player.hash} is not the set ${name}'s ${s.wasm.sha256}`);
  const held = new Set([...filesUnder(e.out).values()].map((b) => sha256(b)));
  if (!held.has(s.wasm.sha256)) f.push(`${what}: the bundle doesn't hold the set ${name}'s player ${s.wasm.sha256}`);
  if (!held.has(s.glue.sha256)) f.push(`${what}: the bundle doesn't hold the set ${name}'s page glue ${s.glue.sha256}`);
  for (const other of record.sets.values()) if (other.name !== name && held.has(other.wasm.sha256)) f.push(`${what}: the bundle holds the set ${other.name}'s player, not only ${name}'s`);
  return f;
}
/** Every object in a reply whose `code` is `module_missing`, at any depth (the refusal and each item it lists). */
export function moduleMissing(v: JsonValue | undefined): JsonObject[] {
  if (Array.isArray(v)) return v.flatMap(moduleMissing);
  if (!isObject(v)) return [];
  return [...(v['code'] === 'module_missing' ? [v] : []), ...Object.values(v).flatMap(moduleMissing)];
}
/** Whether a refusal's JSON names `module` as a word. */
export const names = (v: JsonValue, module: string): boolean => new RegExp(`\\b${module.replace(/\./g, '\\.')}\\b`).test(JSON.stringify(v));

/** The physics lab's canvas modules past the core, which its kinds and its world use: the 3D scene module (its box marks),
 * the physics module (its world `field`) and the logic module (its item `scorer`). */
export const LAB_MODULES = ['scene3d', 'physics', 'logic'] as const;

// ---------------------------------------------------------------------------------------------------
// The 2D slider fixture (#172's `stagesDoc`: a 2D film of 16 s, a dot whose x a driver moves with time and whose y a
// driver takes from the slider `year`, 1900 to 2100, default 2000) and its recorded track: the slider set to 1950 at
// step 180 (3 s) and to 2050 at step 540 (9 s).

export const SLIDER_STEPS = 16 * 60;
export const SLIDER_ENTRIES: readonly [number, number][] = [[180, 1950], [540, 2050]];
export const sliderTrack = (): JsonObject[] => SLIDER_ENTRIES.map(([k, v]) => trackEntry(k, 'year', v));
export const sliderDoc = stagesDoc;
export const SLIDER_DOC = DOC.stages;
export { YEAR_DEFAULT };
/** The stable IDs the piece's drivers and slider give `probe().values` (#172's probe shape). */
export const SLIDER_VALUES = ['items/dot/at/pos/0', 'items/dot/at/pos/1', 'controls/year/value'] as const;

// ---------------------------------------------------------------------------------------------------
// probe() of two players compared (criterion 4)

/** JSON with every object's keys sorted, so two maps compare by content. */
export function canon(v: JsonValue | undefined): string {
  const sort = (x: JsonValue | undefined): JsonValue | undefined => (Array.isArray(x) ? x.map((y) => sort(y) ?? null)
    : isObject(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k]) ?? null])) : x);
  return JSON.stringify(sort(v)) ?? 'undefined';
}
/** The evaluated data of two probes, ID by ID over both; each failure names the ID and both values. */
export function valueFailures(where: string, a: Probe, b: Probe, sets: [string, string]): string[] {
  const ids = [...new Set([...Object.keys(a.values), ...Object.keys(b.values)])].sort();
  return ids.filter((id) => canon(a.values[id]) !== canon(b.values[id]))
    .map((id) => `${where}: ${id} is ${show(a.values[id] ?? null, 200)} in ${sets[0]}, ${show(b.values[id] ?? null, 200)} in ${sets[1]}`);
}
/** Two probes at one place: the step, the step hashes, the checkpoints' full-state hashes and the evaluated data. */
export function parityFailures(where: string, a: Probe, b: Probe, sets: [string, string]): string[] {
  const f: string[] = [];
  if (a.step !== b.step) f.push(`${where}: probe().step is ${a.step} in ${sets[0]}, ${b.step} in ${sets[1]}`);
  if (canon(a.step_hash as JsonValue) !== canon(b.step_hash as JsonValue)) f.push(`${where}: the step hashes are ${canon(a.step_hash as JsonValue).slice(0, 400)} in ${sets[0]}, ${canon(b.step_hash as JsonValue).slice(0, 400)} in ${sets[1]}`);
  if (canon(a.checkpoint_hashes as unknown as JsonValue) !== canon(b.checkpoint_hashes as unknown as JsonValue)) f.push(`${where}: the checkpoints' full-state hashes differ between ${sets[0]} and ${sets[1]}`);
  return [...f, ...valueFailures(where, a, b, sets)];
}

// ---------------------------------------------------------------------------------------------------
// Exports in clean homes (criterion 5), as #172's reproducible bundles are made

/** A clean home: fresh HOME and TMPDIR, another user name, nothing else of this shell but PATH. */
export function cleanEnv(user: string): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(tmpdir(), `deep-1490-home-${user}-`));
  const tmp = join(home, 'tmp');
  mkdirSync(tmp);
  return { PATH: process.env['PATH'] ?? '', HOME: home, TMPDIR: tmp, USER: user, LOGNAME: user, LANG: 'C' };
}
/** `deep-show run` with its own environment: one answer line, ok, one reply per call. */
export function runIn(bin: string, sc: JsonObject, env: NodeJS.ProcessEnv, what: string): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL', env });
  expect(r.error?.message ?? '', `${what}: deep-show run ran`).toBe('');
  expect(r.status, `${what}: deep-show run exits 0; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter(Boolean);
  expect(lines.length, `${what}: one answer line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonObject, `${what}: the answer`);
  expect(answer['ok'], `${what}: deep-show run takes the scenario${sc['planted'] ? ` (planted ${String(sc['planted'])})` : ''}: ${show(answer, 2000)}`).toBe(true);
  return arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
}
/** The 2D slider fixture exported on its track in a clean home, its evidence store and its bundle at paths `depth`
 * folders deep under `root`; the bundle's folder. Its receipt must name `figure`. */
export function cleanExport(bin: string, root: string, user: string, depth: number, planted?: string): string {
  const env = cleanEnv(user);
  const evidence = join(root, ...Array.from({ length: depth }, (_, i) => `e-${user}-${i}`));
  mkdirSync(evidence, { recursive: true });
  const out = join(root, ...Array.from({ length: depth }, (_, i) => `out-${user}-${i}`), 'bundle');
  const what = `the 2D slider fixture exported by ${user}${planted ? ` (planted ${planted})` : ''}`;
  try {
    const sc = scenarioOf({ evidence, docs: [SLIDER_DOC], calls: [present(SLIDER_DOC, sliderDoc()), webExport(SLIDER_DOC, out, { track: sliderTrack() })], ...(planted ? { planted } : {}) });
    const r = runIn(bin, sc, env, what);
    presented(r[0], what);
    const receipt = webReceiptOf(r[1], what);
    expect(moduleSetOf(receipt), `${what}: the receipt names the module set it bundles, ${FIGURE}`).toBe(FIGURE);
    expect(bundleFailures(out, receipt, what), `${what}: the bundle holds every file its receipt names, by hash`).toEqual([]);
  } finally { rmSync(String(env['HOME']), { recursive: true, force: true }); }
  return out;
}
/** Blocks this thread for `ms`, so two exports are made at least that far apart. */
export const pause = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
