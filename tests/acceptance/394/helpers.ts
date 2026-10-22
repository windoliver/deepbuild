// Test-side tools for the #394 acceptance tests: the three binaries driven by JSON lines, a real record
// on SQLite in a temporary folder with the asks core opened on it, taste-call asks as ask.created@1 data,
// stills as sRGB pixels, and palette's OKLab conversion for measuring the fixtures' ΔE. Nothing here
// stands in for salience, the layout, the sheet or the asks core.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, expect } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection, Event, RecordStore } from '../../../packages/record/src/index.ts';
import { openAsks } from '../../../packages/asks/src/index.ts';
import type { Asks, Delivery } from '../../../packages/asks/src/index.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/394 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => join(REPO, 'target', 'debug', process.platform === 'win32' ? `${name}.exe` : name);
/** The graph module's basic layered layout with its memory: `layout`. */
export const GRAPH_BIN = exe('deep-graph');
/** The record module's salience over one level: `level`. */
export const SALIENCE_BIN = exe('deep-salience');
/** The sheet module: a taste call's candidates on a variant sheet (`taste`) and a view that lists an ask (`view`). */
export const SHEET_BIN = exe('deep-sheet');

// ---------------------------------------------------------------------------------------------------
// JSON

export function fixture(path: string): JsonObject {
  const value = JSON.parse(readFileSync(join(HERE, 'fixtures', path), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${path} is not a JSON object`);
  return value;
}

export function clone<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 400)}`).toBe(true);
  return value as JsonObject;
}

export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 400)}`).toBe(true);
  return value as JsonValue[];
}

export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}

export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)}`).toBe('string');
  return value as string;
}

/** A rect `[x, y, w, h]` in device px. */
export type Rect = [number, number, number, number];
export function rect(value: JsonValue | undefined, what: string): Rect {
  const r = arr(value, what);
  expect(r.length, `${what} is [x, y, w, h]`).toBe(4);
  return r.map((v, i) => num(v, `${what}[${i}]`)) as Rect;
}

/** Every string anywhere inside a JSON value. */
export function strings(value: JsonValue | undefined): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (isObject(value)) return Object.values(value).flatMap(strings);
  return [];
}

// ---------------------------------------------------------------------------------------------------
// The binaries: built once per file, driven by JSON lines on stdin, one JSON line out per line in.

/** Builds one binary by name across the workspace; returns '' or the build's error text. */
export function buildBinary(name: string): string {
  const run = spawnSync('cargo', ['build', '--locked', '--bin', name], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo build --bin ${name} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting/.test(l)).join('\n')}`;
}

/** Builds the named binaries once per file and fails every test of the file when one can't be built. */
export function useBinaries(...names: string[]): void {
  let error = '';
  beforeAll(() => { error = names.map(buildBinary).filter((e) => e !== '').join('\n'); }, 900_000);
  beforeEach(() => { expect(error, `the binaries build: ${names.join(', ')}`).toBe(''); });
}

/** Pipes every input line into one run of `<bin> <subcommand>` and returns the output lines as written. */
export function rawLines(bin: string, subcommand: string, inputs: (JsonValue | string)[]): string[] {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  const run = spawnSync(bin, [subcommand], { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  const name = `${bin.split('/').at(-1)} ${subcommand}`;
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`${name} exited ${run.status}:\n${run.stderr}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(inputs.length);
  return lines;
}

export function batch(bin: string, subcommand: string, inputs: (JsonValue | string)[]): JsonValue[] {
  return rawLines(bin, subcommand, inputs).map((line) => JSON.parse(line) as JsonValue);
}

/** One line that must be accepted (`ok: true`). */
export function accepted(bin: string, subcommand: string, input: JsonValue): JsonObject {
  const out = obj(batch(bin, subcommand, [input])[0], `${bin.split('/').at(-1)} ${subcommand}: the answer`);
  expect(out['ok'], `${bin.split('/').at(-1)} ${subcommand} refused: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  return out;
}

/** The JSON-lines convention: a line that isn't JSON, and one missing its required fields, each answer bad_input. */
export function expectBadInput(bin: string, subcommand: string): void {
  const out = batch(bin, subcommand, ['{not json', {}]);
  for (const [i, line] of out.entries()) {
    expect(line, `${bin.split('/').at(-1)} ${subcommand}: line ${i + 1} answers bad_input`).toEqual({ ok: false, code: 'bad_input' });
  }
}

// ---------------------------------------------------------------------------------------------------
// The record and the asks core, as #318's suite opens them: a virtual clock, a record in a temporary
// folder, and the deliveries the core hands the agent's adapter.

/** 2026-10-20 12:00 UTC. */
export const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
export const DAY = 86_400_000;
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
export const bare = (handle: string): string => handle.replace(/^ask:/, '');

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
function ulid(ms: number): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let n = ++minted, i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = CROCKFORD[n % 32] + tail;
  return time + tail;
}

const who = { actor: 'you', scope: 'you' };
/** An agent's MCP server (deep_ask), bound to its session: where a taste call comes from. */
export const agent = (session: string): Connection => ({ writer: `mcp:${session}`, ...who, session, agent: 'claude-code' });
const hook = (session: string): Connection => ({ writer: 'hook', ...who, session, agent: 'claude-code' });
/** The app: the trusted path, where the question card's own click answers. */
export const app: Connection = { writer: 'app', ...who };
/** The ask.sources@1 row a taste call is raised from. */
export const TASTE_SOURCE = 'deep_ask.taste';

export interface World {
  record: RecordStore;
  asks: Asks;
  deliveries: Delivery[];
  start(session: string): Promise<void>;
  events(): Promise<Event[]>;
  close(): Promise<void>;
}

export async function openWorld(): Promise<World> {
  const dir = mkdtempSync(join(tmpdir(), 'deep-394-'));
  const now = (): number => T0;
  const record = await openRecord({ path: join(dir, 'record.db'), now });
  const deliveries: Delivery[] = [];
  const asks = await openAsks({ record, now, deliver: (d) => { deliveries.push(d); } });
  return {
    record,
    asks,
    deliveries,
    start: async (session) => {
      await record.append(hook(session), { v: 1, id: ulid(now()), kind: 'session.start', ts: now(), data: { agent: 'claude-code', worktree: join(dir, 'no-repo'), branch: 'main', thread: session } });
    },
    events: async () => {
      const all: Event[] = [];
      for (let after = 0; ;) {
        const page = await record.read({ after, limit: 1000 });
        all.push(...page);
        if (page.length < 1000) return all;
        after = page[page.length - 1]!.log_pos;
      }
    },
    close: async () => { await record.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

/** A taste call as ask.created@1 data: one option per candidate, the first recommended and the default. */
export function tasteAsk(question: string, options: { option: string; label: string }[]): JsonObject {
  return {
    kind: 'taste',
    question,
    options: options.map((o) => ({ id: o.option, label: o.label, decision: 'none' })),
    recommended: options[0]!.option,
    deadline: T0 + 3 * DAY,
    fallback: 'you',
    default: options[0]!.option,
    provisional: false,
    owner: 'you',
    key: sha256(`taste:${question}`),
    pinned_to: { kind: 'evidence', ref: sha256(`shown:${question}`) },
  };
}

/** The events of the record about one ask: its ask.created and every event whose subject is the ask. */
export function aboutAsk(events: Event[], handle: string): Event[] {
  return events.filter((e) => (e.kind === 'ask.created' && e.id === bare(handle)) || e.subject === handle);
}

// ---------------------------------------------------------------------------------------------------
// Stills: opaque sRGB-encoded RGBA8, row-major from the top left, as the taste call takes them
// (`{"size": [w, h], "rgba": base64}`).

export type Rgb = [number, number, number];
export interface Still { width: number; height: number; rgba: Uint8Array }

export function paint(width: number, height: number, pixel: (x: number, y: number) => Rgb): Still {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      rgba.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { width, height, rgba };
}

/** A still of vertical bands of equal width, one per color: a stand-in for a figure's frame. */
export const bands = (width: number, height: number, colors: Rgb[]): Still =>
  paint(width, height, (x) => colors[Math.min(colors.length - 1, Math.floor((x * colors.length) / width))]!);

export const stillJson = (s: Still): JsonObject => ({ size: [s.width, s.height], rgba: Buffer.from(s.rgba).toString('base64') });

const decode = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const encode = (v: number): number => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(c * 255)));
};

/** The still with its exposure changed: every pixel's linear light times `factor`, encoded back to 8 bits. */
export function exposed(s: Still, factor: number): Still {
  const rgba = new Uint8Array(s.rgba);
  for (let i = 0; i < rgba.length; i += 4) {
    for (let c = 0; c < 3; c++) rgba[i + c] = encode(decode(rgba[i + c]!) * factor);
  }
  return { width: s.width, height: s.height, rgba };
}

// ---------------------------------------------------------------------------------------------------
// OKLab, ported from palette at 71011dee47, palette/src/oklab.rs (`linear_srgb_to_oklab`): Björn
// Ottosson's matrices, which the Oracle page names for criterion 6. The sRGB decode above is the
// standard piecewise curve palette's Srgb uses.
//
// Copyright (c) 2015 Erik Hedvall. Licensed under the MIT License (palette is MIT OR Apache-2.0):
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
// associated documentation files (the "Software"), to deal in the Software without restriction,
// including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
// and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
// subject to the following conditions: The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS",
// WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS
// OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
// CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
// OTHER DEALINGS IN THE SOFTWARE.

export function linearSrgbToOklab(red: number, green: number, blue: number): [number, number, number] {
  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

export const srgbToOklab = ([r, g, b]: Rgb): [number, number, number] => linearSrgbToOklab(decode(r), decode(g), decode(b));

/** OKLab ΔE (Euclidean distance in OKLab) between two 8-bit sRGB colors. */
export function deltaE(a: Rgb, b: Rgb): number {
  const [l1, a1, b1] = srgbToOklab(a);
  const [l2, a2, b2] = srgbToOklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * The 90th percentile of the per-pixel OKLab ΔE between two stills of one size (nearest rank). The
 * fixtures put every percentile from the 81st to the 95th on one value, so any percentile rule gives it.
 */
export function p90DeltaE(a: Still, b: Still): number {
  expect([a.width, a.height], 'the stills are one size').toEqual([b.width, b.height]);
  const d: number[] = [];
  for (let i = 0; i < a.rgba.length; i += 4) {
    d.push(deltaE([a.rgba[i]!, a.rgba[i + 1]!, a.rgba[i + 2]!], [b.rgba[i]!, b.rgba[i + 1]!, b.rgba[i + 2]!]));
  }
  d.sort((x, y) => x - y);
  return d[Math.ceil(0.9 * d.length) - 1]!;
}

// ---------------------------------------------------------------------------------------------------
// The sheet module: a taste call's candidates on a variant sheet, and a view that lists the ask.

export interface Cell { id: string; size: [number, number]; names_option: string | null }
export interface TasteCall { ask: JsonObject; sheet: JsonObject; cells: Cell[]; dropped: { option: string; same_as: string }[] }

/** `deep-sheet taste`: the agent's taste call and each candidate's still. */
export function tasteCall(ask: JsonObject, candidates: { option: string; still: Still }[]): TasteCall {
  const out = accepted(SHEET_BIN, 'taste', { ask, candidates: candidates.map((c) => ({ option: c.option, still: stillJson(c.still) })) });
  const sheet = obj(out['sheet'], 'taste: sheet');
  const cells = arr(sheet['cells'], 'taste: sheet.cells').map((c, i) => {
    const o = obj(c, `taste: sheet.cells[${i}]`);
    const size = arr(o['size'], `taste: sheet.cells[${i}].size`).map((v) => num(v, 'a cell size')) as [number, number];
    const names = o['names_option'];
    return { id: str(o['id'], `taste: sheet.cells[${i}].id`), size, names_option: typeof names === 'string' ? names : null };
  });
  const dropped = arr(out['dropped'], 'taste: dropped').map((d, i) => {
    const o = obj(d, `taste: dropped[${i}]`);
    return { option: str(o['option'], `taste: dropped[${i}].option`), same_as: str(o['same_as'], `taste: dropped[${i}].same_as`) };
  });
  return { ask: obj(out['ask'], 'taste: ask'), sheet, cells, dropped };
}

export interface Option { id: string; label: string; decision: string }
export const optionsOf = (ask: JsonObject): Option[] => arr(ask['options'], 'the ask\'s options').map((o) => obj(o, 'an option') as unknown as Option);
/** The one option labelled "None of these". */
export function noneOfThese(ask: JsonObject): Option {
  const none = optionsOf(ask).filter((o) => /^none of these$/i.test(o.label));
  expect(none.length, 'the taste call carries one option labelled "None of these"').toBe(1);
  expect(none[0]!.decision, '"None of these" decides nothing by itself').toBe('none');
  return none[0]!;
}

export interface Step { preselect: string | null; sends: JsonValue[] }
export interface ViewOut { card: Rect; sheet: Rect; cells: Record<string, Rect>; trace: Step[] }

/** `deep-sheet view`: one card's slot and its sheet, then clicks in order. */
export function view(input: JsonObject): ViewOut {
  const out = accepted(SHEET_BIN, 'view', input);
  const cells: Record<string, Rect> = {};
  for (const [id, r] of Object.entries(obj(out['cells'], 'view: cells'))) cells[id] = rect(r, `view: cells.${id}`);
  const trace = arr(out['trace'], 'view: trace').map((s, i) => {
    const o = obj(s, `view: trace[${i}]`);
    const p = o['preselect'];
    expect(p === null || typeof p === 'string', `view: trace[${i}].preselect is an option ID or null`).toBe(true);
    return { preselect: p as string | null, sends: arr(o['sends'], `view: trace[${i}].sends`) };
  });
  return { card: rect(out['card'], 'view: card'), sheet: rect(out['sheet'], 'view: sheet'), cells, trace };
}

const overlaps = (a: Rect, b: Rect): boolean => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
const inside = (a: Rect, outer: Rect): boolean => a[0] >= outer[0] && a[1] >= outer[1] && a[0] + a[2] <= outer[0] + outer[2] && a[1] + a[3] <= outer[1] + outer[3];
export const center = (r: Rect): [number, number] => [r[0] + r[2] / 2, r[1] + r[3] / 2];

/** The sheet sits beside the card's slot, both inside the view, and every cell at its exact size inside the sheet. */
export function expectBeside(v: ViewOut, size: [number, number], cardSize: [number, number], cells: Cell[]): void {
  const whole: Rect = [0, 0, size[0], size[1]];
  expect(inside(v.card, whole) && inside(v.sheet, whole), `the card's slot ${JSON.stringify(v.card)} and the sheet ${JSON.stringify(v.sheet)} lie inside the view`).toBe(true);
  expect(v.card[2] >= cardSize[0] && v.card[3] >= cardSize[1], 'the view reserves a slot as large as the card').toBe(true);
  expect(overlaps(v.card, v.sheet), 'the sheet never covers the card\'s slot').toBe(false);
  const sideBySide = v.sheet[0] >= v.card[0] + v.card[2] || v.sheet[0] + v.sheet[2] <= v.card[0];
  const level = v.sheet[1] < v.card[1] + v.card[3] && v.card[1] < v.sheet[1] + v.sheet[3];
  expect(sideBySide && level, `the sheet ${JSON.stringify(v.sheet)} is beside the card ${JSON.stringify(v.card)}: left or right of it, at its height`).toBe(true);
  expect(Object.keys(v.cells).sort(), 'the view draws every cell of the sheet').toEqual(cells.map((c) => c.id).sort());
  for (const c of cells) {
    const r = v.cells[c.id]!;
    expect([r[2], r[3]], `cell ${c.id} draws at its exact size in device px, never scaled`).toEqual(c.size);
    expect(inside(r, v.sheet), `cell ${c.id} lies inside the sheet`).toBe(true);
  }
  const rects = cells.map((c) => v.cells[c.id]!);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    expect(overlaps(rects[i]!, rects[j]!), `cells ${cells[i]!.id} and ${cells[j]!.id} don't overlap`).toBe(false);
  }
}

/**
 * What a cell click may do: preselect, nothing more. Every answer the view sends the hub is forwarded on
 * the trusted path, as the app would; then the ask must still be open and listed, with no answer in the
 * record and nothing delivered to the agent. Returns the failures, each naming the ask.
 */
export async function onlyPreselects(world: World, handle: string, v: ViewOut): Promise<string[]> {
  for (const step of v.trace) {
    for (const message of step.sends) {
      const answer = isObject(message) && isObject(message['answer']) ? message['answer'] : null;
      if (answer) await world.asks.answer(app, String(answer['ask']), { option: String(answer['option']) });
    }
  }
  const failures: string[] = [];
  if (!(await world.asks.needsYou()).some((c) => c.ask === handle)) failures.push(`ask ${handle} left Needs you after a cell click`);
  if ((await world.events()).some((e) => e.kind === 'ask.answered' && e.subject === handle)) failures.push(`ask ${handle} was answered by a cell click`);
  if (world.deliveries.some((d) => d.ask === handle)) failures.push(`ask ${handle} reached the agent after a cell click`);
  return failures;
}
