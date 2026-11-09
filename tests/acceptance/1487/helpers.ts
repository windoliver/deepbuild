// Shared by the #1487 acceptance tests: the binaries they drive (README: The surface under test), the fixtures,
// the views they pan between, the visible-region rule they judge by, frame hashes and the reference-Mac gate.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root: tests/acceptance/1487 is three levels down. */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => join(REPO, 'target', 'debug', process.platform === 'win32' ? `${name}.exe` : name);
/** The frame clock on a virtual display (`run`) and a straight evaluation (`eval`), #391's binary. */
export const MOTION_BIN = exe('deep-motion');
/** The 2D view drawn headless on the real clock (`idle`), #854's binary. */
export const RENDER_BIN = exe('deep-canvas-render');

// ---------------------------------------------------------------------------------------------------
// Time: flicks, 1/705,600,000 s.

export const FLICKS_PER_SECOND = 705_600_000;
export function sec(seconds: number): number {
  const flicks = Math.round(seconds * FLICKS_PER_SECOND);
  if (Math.abs(flicks - seconds * FLICKS_PER_SECOND) > 1e-3) throw Error(`${seconds} s is not a whole number of flicks`);
  return flicks;
}
/** One vsync at 60 Hz: 11,760,000 flicks. */
export const VSYNC_60 = FLICKS_PER_SECOND / 60;
export const vsyncOf = (t: number): number => {
  if (t % VSYNC_60 !== 0) throw Error(`${t} flicks is not a 60 Hz vsync`);
  return t / VSYNC_60;
};
export const secondsOf = (t: number): string => `${(t / FLICKS_PER_SECOND).toFixed(4)} s`;

// ---------------------------------------------------------------------------------------------------
// JSON

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
  expect(typeof value, `${what} is a number, got ${JSON.stringify(value)}`).toBe('number');
  return value as number;
}
/** JSON text with every object's keys sorted: the bytes a frame's evaluated data is compared and hashed by. */
export function canonical(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
/** SHA-256 of the canonical bytes, lower-case hex. */
export const sha256 = (value: JsonValue | undefined): string => createHash('sha256').update(canonical(value)).digest('hex');

export function fixture(name: string): JsonObject {
  const value = JSON.parse(readFileSync(join(HERE, 'fixtures', name), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${name} is not a JSON object`);
  return value;
}

// ---------------------------------------------------------------------------------------------------
// The binaries: built once per file, driven by JSON lines on stdin, one JSON line out per line in.

export function buildBinary(name: string): string {
  const run = spawnSync('cargo', ['build', '--locked', '--bin', name], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo build --bin ${name} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting/.test(l)).join('\n')}`;
}

/** Builds the named binaries once per file and fails every test of the file when one can't be built. */
export function useBinaries(...names: string[]): void {
  let error = '';
  beforeAll(() => { error = names.map(buildBinary).filter((e) => e !== '').join('\n'); }, 1_800_000);
  beforeEach(() => { expect(error, `the binaries build: ${names.join(', ')}`).toBe(''); });
}

export function batch(bin: string, args: string[], inputs: JsonValue[], timeoutMs = 600_000): JsonValue[] {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(bin, args, { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs });
  const name = `${bin.split('/').at(-1)} ${args.join(' ')}`;
  if (run.error) throw Error(`${name}: ${run.error.message}`);
  if (run.status !== 0) throw Error(`${name} exited ${run.status}:\n${run.stderr}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(inputs.length);
  return lines.map((line) => JSON.parse(line) as JsonValue);
}

export function one(bin: string, subcommand: string, input: JsonValue, timeoutMs?: number): JsonObject {
  return obj(batch(bin, [subcommand], [input], timeoutMs)[0], `${bin.split('/').at(-1)} ${subcommand}: the answer`);
}

export function accepted(bin: string, subcommand: string, input: JsonValue, timeoutMs?: number): JsonObject {
  const out = one(bin, subcommand, input, timeoutMs);
  expect(out['ok'], `${bin.split('/').at(-1)} ${subcommand} refused: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Views: rects [x, y, w, h] in document u (logical px, y down) on the fixtures' 2400 × 1400 board.

export type Rect = [number, number, number, number];
/** Shows the card; the spinner is far outside it; edge's box reaches 20 u into its right side, its center outside. */
export const V_CARD: Rect = [0, 0, 960, 540];
/** Shows the spinner whole; nothing else is near it. */
export const V_SPIN: Rect = [1200, 500, 960, 540];
/** Shows the still note only. */
export const V_NOTE: Rect = [0, 860, 960, 540];

export interface Pan { at: number; rect: Rect }
/** The view in effect at `t`: the start view, then each pan from its own vsync on. */
export function viewAt(start: Rect, pans: readonly Pan[], t: number): Rect {
  let rect = start;
  for (const p of pans) if (p.at <= t) rect = p.rect;
  return rect;
}

// ---------------------------------------------------------------------------------------------------
// `deep-motion run` with a view (README: deep-motion run, with the view).

export interface Vsync { t: number; presented: boolean; valid_until: number | null; items: JsonObject; raw: JsonObject }

export interface RunRequest {
  doc: JsonObject;
  to: number;
  mode: 'armed' | 'every_vsync';
  view?: Rect;
  pans?: Pan[];
  planted?: string;
}

export function run(req: RunRequest): Vsync[] {
  const input: JsonObject = { doc: req.doc, to: req.to, mode: req.mode, refresh_hz: 60 };
  if (req.view) input['view'] = { rect: req.view };
  if (req.pans) input['pans'] = req.pans.map((p) => ({ at: p.at, rect: p.rect }));
  if (req.planted) input['planted'] = req.planted;
  const what = `run ${req.mode}${req.planted ? ` planted ${req.planted}` : ''}`;
  const out = accepted(MOTION_BIN, 'run', input);
  const raw = arr(out['vsyncs'], `${what}: vsyncs`);
  expect(raw.length, `${what}: one record per vsync from 0 to ${secondsOf(req.to)} at 60 Hz`).toBe(req.to / VSYNC_60 + 1);
  return raw.map((v, k) => {
    const r = obj(v, `${what}: vsyncs[${k}]`);
    expect(r['t'], `${what}: vsyncs[${k}] is at k × 1/60 s`).toBe(k * VSYNC_60);
    expect(typeof r['presented'], `${what}: vsyncs[${k}].presented is a boolean`).toBe('boolean');
    const vu = r['valid_until'];
    expect(vu === null || typeof vu === 'number', `${what}: vsyncs[${k}].valid_until is a flick count or null`).toBe(true);
    return { t: k * VSYNC_60, presented: r['presented'] === true, valid_until: vu as number | null, items: obj(r['items'], `${what}: vsyncs[${k}].items`), raw: r };
  });
}

/** The times of the vsyncs that presented a frame, within (from, to] when given. */
export function presentedIn(vsyncs: readonly Vsync[], from = -1, to = Number.MAX_SAFE_INTEGER): number[] {
  return vsyncs.filter((v) => v.presented && v.t > from && v.t <= to).map((v) => v.t);
}

/** `deep-motion eval` at `times`, with no view: a straight, canonical evaluation. */
export function evalFrames(doc: JsonObject, times: number[]): JsonObject[] {
  const out = accepted(MOTION_BIN, 'eval', { doc, times });
  const frames = arr(out['frames'], 'eval: frames').map((f, i) => obj(f, `eval: frames[${i}]`));
  expect(frames.length, 'eval: one frame per time').toBe(times.length);
  frames.forEach((f, i) => expect(f['t'], `eval: frames[${i}].t`).toBe(times[i]));
  return frames;
}

export function itemOf(items: JsonObject, id: string, what: string): JsonObject {
  return obj(items[id], `${what}: items.${id}`);
}
export function rotZ(items: JsonObject, id: string, what: string): number {
  const at = obj(itemOf(items, id, what)['at'], `${what}: items.${id}.at`);
  return num(arr(at['rot'], `${what}: items.${id}.at.rot`)[2], `${what}: items.${id}.at.rot[2]`);
}

// ---------------------------------------------------------------------------------------------------
// The visible region, as the tests judge it. Each fixture item is a rect@1 box drawn at its evaluated `at.pos`;
// the ones that turn have boxes centred on their origin, so whatever bounds an implementation keeps for a turning
// box (the box, its rotated hull, or the circle it sweeps) hold the inscribed circle and lie within twice the
// circumscribed one. An item meets the view surely when its inscribed circle does, and surely misses it when it
// is more than twice its circumscribed radius away; the fixtures and views are chosen so that no item is ever
// between (checked at every vsync, so an implementation is never judged on a case its bounds could decide).

type Box = [number, number, number, number];
function boxOf(doc: JsonObject, id: string): Box {
  const item = obj(obj(doc['items'], 'fixture items')[id], `fixture item ${id}`);
  const box = arr(obj(item['params'], `${id}.params`)['box'], `${id}.params.box`).map((n, i) => num(n, `${id}.params.box[${i}]`));
  return box as Box;
}

function posOf(items: JsonObject, id: string, what: string): [number, number] {
  const at = obj(itemOf(items, id, what)['at'], `${what}: items.${id}.at`);
  const pos = arr(at['pos'], `${what}: items.${id}.at.pos`);
  return [num(pos[0], `${what}: ${id} pos x`), num(pos[1], `${what}: ${id} pos y`)];
}

function distance(p: [number, number], r: Rect): number {
  const dx = Math.max(r[0] - p[0], 0, p[0] - (r[0] + r[2]));
  const dy = Math.max(r[1] - p[1], 0, p[1] - (r[1] + r[3]));
  return Math.hypot(dx, dy);
}

export interface Region { inside: string[]; outside: string[]; unsure: string[] }

/** Which of the document's items meet `view` in a frame's evaluated data. */
export function regionOf(doc: JsonObject, items: JsonObject, view: Rect, what: string): Region {
  const out: Region = { inside: [], outside: [], unsure: [] };
  for (const id of Object.keys(obj(doc['items'], 'fixture items')).sort()) {
    const [bx, by, bw, bh] = boxOf(doc, id);
    const [px, py] = posOf(items, id, what);
    const turns = rotZ(items, id, what) !== 0;
    if (turns) expect(bx + bw / 2 === 0 && by + bh / 2 === 0, `fixture item ${id} turns, so its box is centred on its origin`).toBe(true);
    const centre: [number, number] = [px + bx + bw / 2, py + by + bh / 2];
    const rIn = Math.min(bw, bh) / 2;
    const rOut = Math.hypot(bw, bh) / 2;
    const d = distance(centre, view);
    if (d < rIn) out.inside.push(id);
    else if (d > 2 * rOut) out.outside.push(id);
    else out.unsure.push(id);
  }
  return out;
}

/** The evaluated data of the items inside the view, keyed by ID: what "the visible region" of a frame holds. */
export function visibleData(doc: JsonObject, items: JsonObject, view: Rect, what: string): JsonObject {
  const region = regionOf(doc, items, view, what);
  expect(region.unsure, `${what}: no item is near the edge of view ${JSON.stringify(view)} where bounds could decide`).toEqual([]);
  const out: JsonObject = {};
  for (const id of region.inside) out[id] = items[id] as JsonValue;
  return out;
}

/**
 * The kit case over the visible region: at each vsync, the items the every-vsync run shows inside the view in
 * effect there must be byte-identical (canonical JSON) in the armed run. Null when they are, else a message naming
 * the first vsync where they aren't and each visible item that differs there.
 */
export function compareVisible(doc: JsonObject, armed: readonly Vsync[], every: readonly Vsync[], start: Rect, pans: readonly Pan[]): string | null {
  if (armed.length !== every.length) return `the runs have ${armed.length} and ${every.length} vsyncs`;
  for (let k = 0; k < every.length; k++) {
    const a = armed[k]!; const e = every[k]!;
    if (a.t !== e.t) return `vsync ${k} is at ${a.t} in the armed run and ${e.t} in the every-vsync run`;
    const view = viewAt(start, pans, e.t);
    const visible = visibleData(doc, e.items, view, `every-vsync vsync ${k}`);
    const differ = Object.keys(visible).filter((id) => canonical(a.items[id]) !== canonical(visible[id]));
    if (differ.length > 0) {
      const detail = differ.map((id) => `item ${id}: armed shows ${canonical(a.items[id])}, every-vsync evaluated ${canonical(visible[id])}`).join('; ');
      return `at vsync ${k} (t = ${e.t} flicks, ${secondsOf(e.t)}) in view ${JSON.stringify(view)} the presented data differs: ${detail}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// The look `deep-canvas-render` resolves roles through (#391's convention): role → sRGB [r, g, b].

export const LOOK: JsonObject = {
  light: { ground: [250, 250, 248], ink: [28, 28, 30], muted: [120, 120, 128], accent: [40, 90, 200], live: [200, 120, 40] },
};

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate (#854's): wakeups are judged only on a reference Mac.

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** Why this machine can't judge wakeups, or null on a reference Mac. */
export function referenceMacProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  return null;
}

export function machineReading(): string {
  const read = (cmd: string, ...args: string[]): string => { try { return sh(cmd, ...args).replace(/\s+/g, ' '); } catch { return 'unknown'; } };
  return `power: ${read('pmset', '-g', 'batt').split(';')[0]}; ${/lowpowermode\s+\d/.exec(read('pmset', '-g'))?.[0] ?? 'lowpowermode unknown'}; load: ${read('sysctl', '-n', 'vm.loadavg')}`;
}
