// Test-side tools for the #2717 acceptance tests (README: The surface under test): the full build of `deep-show`
// (built once per file), deep_kinds `op: list` on `deep-show run` (one scenario, one call) and the physics module's row
// of its answer, the defaults run (`deep-show kinds --defaults [--planted <name>]`, one JSON object, its report), and
// the criterion's checks over the listing's entry and the report's. Nothing here stands in for deep_kinds, the run or
// the world reader: every listed field, printed default, built document and value read back is the binary's own, and
// every expected value is the issue's Scope's or the design's Fields line's (Body `body@1`: vehicle). Each
// `...Failures` function is one part of the criterion's check: it returns sentences naming what failed and asserts
// nothing, so each test's own file holds the assertion that fails.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2717 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const ID = '#2717.6803fbfb';
/**
 * Every test and hook passes a timeout of its own, never the runner's default: a cold build of deep-show takes many
 * minutes on a loaded Mac, and a test waits for one listing and one defaults run at most. A call that outlasts its own
 * limit fails the test as INCONCLUSIVE; nothing here is timed.
 */
export const TIMEOUT = 3_600_000;
const BUILD_TIMEOUT = 7_200_000;
const LIST_TIMEOUT = 600_000;
const RUN_TIMEOUT = 2_700_000;

/** The canvas module whose row lists the body kinds, and the entries read there (README: The surface under test). */
export const MODULE = 'physics';
export const ENTRY = 'body@1.vehicle';
export const CHARACTER = 'body@1.character';
/** The planted wrong program (README: The planted twin). */
export const PLANT = 'vehicle_reader_takes_other_defaults';

/**
 * Every field of a vehicle body's `vehicle`, by the path the listing gives it (`<name>` stands for a wheel's name),
 * from the design's Fields line: `vehicle: {wheels: {name → {at, radius, suspension: {rest, travel, hz, damping_ratio:
 * f32 = 0.3}, grip: f32 = 1, steers: bool = false, drives: bool = false, brakes: bool = true}} ≤ 8, steer_max: deg =
 * 35}`. `default` is the design's and the issue's Scope's, absent where they give none; `planted` is what the planted
 * world reader takes instead (README: The planted twin).
 */
export interface Field { path: string; default?: JsonValue; planted?: JsonValue }
export const FIELDS: readonly Field[] = [
  { path: 'vehicle.wheels.<name>.at' },
  { path: 'vehicle.wheels.<name>.radius' },
  { path: 'vehicle.wheels.<name>.suspension.rest' },
  { path: 'vehicle.wheels.<name>.suspension.travel' },
  { path: 'vehicle.wheels.<name>.suspension.hz' },
  { path: 'vehicle.wheels.<name>.suspension.damping_ratio', default: 0.3, planted: 0.6 },
  { path: 'vehicle.wheels.<name>.grip', default: 1, planted: 2 },
  { path: 'vehicle.wheels.<name>.steers', default: false, planted: true },
  { path: 'vehicle.wheels.<name>.drives', default: false, planted: true },
  { path: 'vehicle.wheels.<name>.brakes', default: true, planted: false },
  { path: 'vehicle.steer_max', default: 35, planted: 30 },
];
/** The fields with a default: the ones a world may leave out. */
export const DEFAULTED: readonly Field[] = FIELDS.filter((f) => f.default !== undefined);
/** The fields with none: a wheel without one is refused, so the car writes them. */
export const REQUIRED: readonly Field[] = FIELDS.filter((f) => f.default === undefined);
/** Each defaulted field's value by path: the issue's and the design's, or the planted reader's. */
export const DESIGN: ReadonlyMap<string, JsonValue> = new Map(DEFAULTED.map((f) => [f.path, f.default as JsonValue]));
export const PLANTED: ReadonlyMap<string, JsonValue> = new Map(DEFAULTED.map((f) => [f.path, f.planted as JsonValue]));

/**
 * The car, as #251 describes its fixture car (tests/acceptance/251/README.md, The car): 1,000 kg on four wheels at the
 * corners of a 2.5 m wheelbase (along z, its heading) and a 1.6 m track (along x, its axle), centred under its centre
 * of mass, on springs of 2 Hz, rest 0.3 m and travel 0.2 m.
 */
export const CAR = { mass: 1000, wheelbase: 2.5, track: 1.6, rest: 0.3, travel: 0.2, hz: 2 } as const;

// ---------------------------------------------------------------------------------------------------
// JSON

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
/** Two JSON values alike by content: key order aside, and numbers within 1e-6 (the design types a wheel's numbers f32). */
export function same(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && same(a[k], b[k]));
  }
  return a === b;
}

// ---------------------------------------------------------------------------------------------------
// The full build: `deep-show` with its default features (`full`), in the checkout's own target folder.

/** rustup's cargo on this Mac, which keeps it off the default PATH. */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
function cargo(args: string[]): string {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
    CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
    ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
  };
  delete env['CARGO_TARGET_DIR'];
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') return `BLOCKED: cargo isn't on this machine (looked on PATH and in ${RUSTUP_BIN}), so deep-show can't be built; this is not a pass`;
  if (r.error) return `BLOCKED: cargo could not run (${r.error.message}), so deep-show can't be built; this is not a pass`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Locking|Updating/.test(l)).join('\n').slice(-4000)}`;
  return '';
}

/**
 * Builds the full `deep-show` once for the file (`cargo build --locked --bin deep-show`, default features: full). The
 * getter gives the newer of target/release and target/debug; it fails the test, naming the build, when it didn't
 * build, and with a message starting `BLOCKED:` when cargo couldn't run.
 */
export function useFullBuild(): () => string {
  let error = 'BLOCKED: the build did not run; this is not a pass';
  beforeAll(() => { error = cargo(['build', '--locked', '--bin', 'deep-show']); }, BUILD_TIMEOUT);
  afterAll(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); }, 60_000);
  return () => {
    if (error.startsWith('BLOCKED:')) throw Error(error);
    expect(error, 'the full build of deep-show compiles').toBe('');
    const built = ['release', 'debug'].map((p) => join(REPO, 'target', p, 'deep-show')).filter((p) => existsSync(p));
    if (built.length === 0) throw Error(`BLOCKED: cargo built deep-show but none is under ${join(REPO, 'target')}; this is not a pass`);
    return built.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!;
  };
}

/** Folders under /tmp/dh2717-*, each removed after the file. */
const made: string[] = [];
function tempDir(tag: string): string {
  const d = realpathSync(mkdtempSync(join('/tmp', `dh2717-${tag}-`)));
  made.push(d);
  return d;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show`: JSON lines in, one JSON line out per line in. Each call is waited for; nothing outlives it.

interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
function start(bin: string, args: string[], inputs: JsonValue[], timeoutMs: number): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const r = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`BLOCKED: ${bin} ${args.join(' ')} could not start (${r.error.message}); this is not a pass`);
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: r.status, signal: r.signal, timedOut, lines, stdout, stderr: r.stderr ?? '' };
}

/** `deep-show run` with one scenario holding `calls`: one reply per call (as #1971's and #1974's suites call it). */
function run(bin: string, calls: JsonObject[]): JsonObject[] {
  const s = start(bin, ['run'], [{ evidence: tempDir('ev'), calls }], LIST_TIMEOUT);
  if (s.timedOut) throw Error('INCONCLUSIVE: deep-show run did not finish within its timeout; this is not a pass');
  expect(s.status, `deep-show run starts and exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, 'deep-show run: one output line per input line').toBe(1);
  const out = s.lines[0];
  expect(isObject(out) && out['ok'] === true, `deep-show run took the scenario: ${show(out)}`).toBe(true);
  const replies = (out as JsonObject)['replies'];
  expect(Array.isArray(replies) && replies.length === calls.length, `deep-show run: one reply per call: ${show(replies, 600)}`).toBe(true);
  return (replies as JsonValue[]).map((r) => (isObject(r) ? r : { reply: r }));
}

// ---------------------------------------------------------------------------------------------------
// The listing: deep_kinds `{op: "list"}` answers `modules`, one row per canvas module; the physics module's row holds,
// under `lists`, what its deep_kinds tool entries add: one entry per body kind it lists (README: The surface under test).

/** What the physics module's row lists: its entries, and their names for a message. */
export interface Listing { lists: JsonObject[]; names: string[] }

/** The physics module's row of deep_kinds `op: list`, or why there is none to read. */
export function physicsLists(bin: string): Listing | string {
  const [reply] = run(bin, [{ call: 'deep_kinds', op: 'list' }]);
  if (!reply || isObject(reply['error'])) return `deep_kinds op: list is refused: ${show(reply ?? null, 600)}`;
  const modules = reply['modules'];
  if (!Array.isArray(modules)) return `deep_kinds op: list answers no modules: ${show(reply, 600)}`;
  const row = modules.filter(isObject).find((m) => m['name'] === MODULE);
  if (!row) return `deep_kinds op: list lists no canvas module named ${MODULE}; it lists ${modules.filter(isObject).map((m) => String(m['name'])).join(', ') || 'none'}`;
  const lists = Array.isArray(row['lists']) ? row['lists'].filter(isObject) : [];
  return { lists, names: lists.map((e) => String(e['name'])) };
}

/** The entry of that name in the row's lists. */
export const entryNamed = (l: Listing, name: string): JsonObject | undefined => l.lists.find((e) => e['name'] === name);

/**
 * A listed field's text, read as the base prints the character body's (`"deg = 45"`): its unit or type, then, where
 * the field has a default, ` = ` and the default, a JSON value that ends the text. `has` says whether one is printed.
 */
export interface Printed { unit: string; has: boolean; default: JsonValue }
export function printed(text: JsonValue | undefined): Printed | string {
  if (typeof text !== 'string') return `is not listed as a text (${show(text ?? null, 200)})`;
  const cut = text.indexOf(' = ');
  if (cut < 0) return { unit: text, has: false, default: null };
  try {
    return { unit: text.slice(0, cut), has: true, default: JSON.parse(text.slice(cut + 3).trim()) as JsonValue };
  } catch {
    return `prints a default that is no JSON value: ${JSON.stringify(text)}`;
  }
}
/** The default an entry prints for the field at `path`, or why none can be read. */
export function printedAt(entry: JsonObject | undefined, path: string): Printed | string {
  const fields = entry?.['fields'];
  if (!isObject(fields)) return `its entry lists no fields (${show(fields ?? null, 200)})`;
  if (!(path in fields)) return `is not listed; the entry lists ${Object.keys(fields).join(', ') || 'no field'}`;
  return printed(fields[path]);
}

/**
 * The criterion's first clause: the physics module's row lists `body@1.vehicle`, of kind vehicle, with every field of
 * its `vehicle` by path; each field the design gives a default prints that default, and each it gives none prints
 * none. Each failure about a field starts with its path and a colon.
 */
export function listingFailures(l: Listing): string[] {
  const entry = entryNamed(l, ENTRY);
  if (!entry) return [`the ${MODULE} module's row lists no ${ENTRY}; it lists ${l.names.join(', ') || 'nothing'}`];
  const failures: string[] = [];
  if (entry['kind'] !== 'vehicle') failures.push(`${ENTRY}: its kind is ${show(entry['kind'] ?? null, 100)}, not "vehicle"`);
  if (!isObject(entry['fields'])) return [...failures, `${ENTRY}: it lists no fields (its fields is ${show(entry['fields'] ?? null, 200)})`];
  for (const f of FIELDS) {
    const p = printedAt(entry, f.path);
    if (typeof p === 'string') failures.push(`${f.path}: ${p}`);
    else if (f.default === undefined) {
      if (p.has) failures.push(`${f.path}: prints the default ${show(p.default, 100)}, where the design gives it none and the world reader refuses a wheel without it`);
    } else if (!p.has) failures.push(`${f.path}: prints no default (${JSON.stringify(p.unit)}), where the world reader takes ${show(f.default)} for it left out`);
    else if (!same(p.default, f.default)) failures.push(`${f.path}: prints the default ${show(p.default, 100)}, not ${show(f.default)}`);
  }
  return failures;
}

/** The default the listing prints for each defaulted field, by path, and a sentence for each it doesn't print. */
export function listedDefaults(l: Listing | string): { defaults: Map<string, JsonValue>; missing: string[] } {
  const defaults = new Map<string, JsonValue>();
  if (typeof l === 'string') return { defaults, missing: [l] };
  const entry = entryNamed(l, ENTRY);
  if (!entry) return { defaults, missing: [`the ${MODULE} module's row lists no ${ENTRY}; it lists ${l.names.join(', ') || 'nothing'}`] };
  const missing: string[] = [];
  for (const f of DEFAULTED) {
    const p = printedAt(entry, f.path);
    if (typeof p === 'string') missing.push(`${f.path}: ${p}`);
    else if (!p.has) missing.push(`${f.path}: prints no default (${JSON.stringify(p.unit)})`);
    else defaults.set(f.path, p.default);
  }
  return { defaults, missing };
}

// ---------------------------------------------------------------------------------------------------
// The defaults run: `deep-show kinds --defaults [--planted <name>]` (#1974's run), answering one JSON object, its
// report. This suite reads its `verdict` and, under `lists`, the entry named `body@1.vehicle` (README: The surface).

/** One defaults run: its report (a JSON object holding a verdict word) when it answered one, and what it printed. */
export interface Ran { report: JsonObject | undefined; what: string; seen: string }
export function defaultsRun(bin: string, planted?: string): Ran {
  const args = ['kinds', '--defaults', ...(planted ? ['--planted', planted] : [])];
  const what = `deep-show ${args.join(' ')}`;
  const s = start(bin, args, [], RUN_TIMEOUT);
  if (s.timedOut) throw Error(`INCONCLUSIVE: ${what} did not finish within its timeout; this is not a pass`);
  const report = s.lines.filter(isObject).find((o) => typeof o['verdict'] === 'string');
  return { report, what, seen: `exit ${String(s.status)}, ${s.signal ?? 'no signal'}; stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}` };
}

/** The report with its long lists left out, for a message. */
export const outline = (report: JsonObject, n = 1500): string => show(Object.fromEntries(Object.entries(report).filter(([k]) => k !== 'kinds' && k !== 'lists')), n);

/** The report's entry for the vehicle body, under `lists`, or why there is none. */
export function builtEntry(report: JsonObject): JsonObject | string {
  const lists = report['lists'];
  if (!Array.isArray(lists)) return `the report holds no lists (its members: ${Object.keys(report).join(', ')}), so it names no body kind it built`;
  const entry = lists.filter(isObject).find((e) => e['name'] === ENTRY);
  return entry ?? `the report's lists hold no ${ENTRY}; they hold ${lists.filter(isObject).map((e) => String(e['name'])).join(', ') || 'nothing'}`;
}

/** The car in the world an entry built: the ID of its one vehicle body, its `vehicle` as written, and its wheels' names. */
export interface Car { id: string; vehicle: JsonObject; wheels: string[] }

const near = (x: JsonValue | undefined, want: number): boolean => typeof x === 'number' && Math.abs(x - want) <= 1e-9;

/**
 * "Builds the car": the entry's `world` is the world document the run built, holding one body of kind vehicle, #251's
 * car (CAR): 1,000 kg, four wheels at the corners of a 2.5 m wheelbase and a 1.6 m track centred on its origin, each
 * suspension 2 Hz with rest 0.3 m and travel 0.2 m. The car, when the world holds one, and what is wrong with it.
 */
export function carOf(entry: JsonObject): { car?: Car; failures: string[] } {
  const world = entry['world'];
  if (!isObject(world)) return { failures: [`the entry holds no world, the document it built (its members: ${Object.keys(entry).join(', ')})`] };
  const bodies = isObject(world['bodies']) ? Object.entries(world['bodies']) : [];
  const vehicles = bodies.filter(([, b]) => isObject(b) && b['kind'] === 'vehicle');
  const [first] = vehicles;
  if (vehicles.length !== 1 || !first) return { failures: [`world: it holds ${vehicles.length} bodies of kind vehicle, not the one car (its bodies: ${bodies.map(([id]) => id).join(', ') || 'none'})`] };
  const id = first[0];
  const body = first[1] as JsonObject;
  const at = `world.bodies.${id}`;
  const vehicle = body['vehicle'];
  if (!isObject(vehicle) || !isObject(vehicle['wheels'])) return { failures: [`${at}: it writes no vehicle.wheels (${show(vehicle ?? null, 300)})`] };
  const failures: string[] = [];
  if (!near(body['mass'], CAR.mass)) failures.push(`${at}.mass is ${show(body['mass'] ?? null, 100)}, not the car's ${CAR.mass} kg`);
  const wheels = Object.entries(vehicle['wheels']);
  if (wheels.length !== 4) failures.push(`${at}.vehicle.wheels holds ${wheels.length} wheels, not the car's four`);
  const corners = new Map<string, string[]>();
  for (const [name, w] of wheels) {
    const mount = isObject(w) ? w['at'] : undefined;
    const [x, , z] = Array.isArray(mount) && mount.length === 3 ? mount : [];
    if (typeof x === 'number' && typeof z === 'number' && near(Math.abs(x), CAR.track / 2) && near(Math.abs(z), CAR.wheelbase / 2)) {
      const corner = `${x > 0 ? '+' : '-'}x ${z > 0 ? '+' : '-'}z`;
      corners.set(corner, [...(corners.get(corner) ?? []), name]);
    } else {
      failures.push(`${at}.vehicle.wheels.${name}.at is ${show(mount ?? null, 100)}, not at a corner of the car's ${CAR.track} m track (x ±${CAR.track / 2}) and ${CAR.wheelbase} m wheelbase (z ±${CAR.wheelbase / 2})`);
    }
    const s = isObject(w) ? w['suspension'] : undefined;
    for (const k of ['rest', 'travel', 'hz'] as const) {
      const v = isObject(s) ? s[k] : undefined;
      if (!near(v, CAR[k])) failures.push(`${at}.vehicle.wheels.${name}.suspension.${k} is ${show(v ?? null, 100)}, not the car's ${CAR[k]}`);
    }
  }
  for (const [corner, names] of corners) if (names.length > 1) failures.push(`${at}.vehicle.wheels: ${names.join(' and ')} share the corner ${corner}`);
  return { car: { id, vehicle, wheels: wheels.map(([name]) => name) }, failures };
}

/** Where a listed path leads in a `vehicle` (as written, or as read back): one place per wheel for a wheel's field. */
export function reach(vehicle: JsonValue | undefined, path: string, wheels: readonly string[]): { at: string; value: JsonValue | undefined }[] {
  const steps = path.split('.').slice(1);
  const walk = (v: JsonValue | undefined, i: number, at: string): { at: string; value: JsonValue | undefined }[] => {
    const step = steps[i];
    if (step === undefined) return [{ at, value: v }];
    if (step === '<name>') return wheels.flatMap((n) => walk(isObject(v) ? v[n] : undefined, i + 1, `${at}.${n}`));
    return walk(isObject(v) ? v[step] : undefined, i + 1, `${at}.${step}`);
  };
  return walk(vehicle, 0, 'vehicle');
}

/**
 * "With every field left out": the car's `vehicle`, as the built document writes it, holds no key for any field with a
 * default, at any wheel, and writes every field with none. Each failure starts with the field's path and a colon.
 */
export function leftOutFailures(car: Car): string[] {
  const failures: string[] = [];
  for (const f of DEFAULTED) {
    for (const { at, value } of reach(car.vehicle, f.path, car.wheels)) {
      if (value !== undefined) failures.push(`${f.path}: the built document writes ${at} (${show(value, 100)}); it is not left out`);
    }
  }
  for (const f of REQUIRED) {
    for (const { at, value } of reach(car.vehicle, f.path, car.wheels)) {
      if (value === undefined || value === null) failures.push(`${f.path}: the built document writes no ${at}, which the world reader refuses a wheel without`);
    }
  }
  return failures;
}

/** "Builds": the entry's `built` lists the IDs of the bodies the world's build made, the car's among them. */
export function builtFailures(entry: JsonObject, car: Car): string[] {
  const built = entry['built'];
  if (!Array.isArray(built)) return [`the entry holds no built, the IDs of the bodies built (${show(built ?? null, 200)})`];
  return built.includes(car.id) ? [] : [`built lists ${show(built, 300)}, not the car, ${car.id}`];
}

/**
 * "Reads those values back": the entry's `read` is the car's `vehicle` as the world reader took it, in the document's
 * own shape. Every field the document writes reads back as written, and every field it leaves out reads back as
 * `want` gives it by path, at every wheel. Each failure starts with the field's path and a colon.
 */
export function readFailures(entry: JsonObject, car: Car, want: ReadonlyMap<string, JsonValue>, whose: string): string[] {
  const read = entry['read'];
  if (!isObject(read)) return [`the entry holds no read, the car's vehicle as the world reader took it (${show(read ?? null, 200)})`];
  const failures: string[] = [];
  for (const f of REQUIRED) {
    const written = reach(car.vehicle, f.path, car.wheels);
    for (const [i, { at, value }] of reach(read, f.path, car.wheels).entries()) {
      if (!same(value, written[i]?.value)) failures.push(`${f.path}: ${at} reads back ${show(value ?? null, 100)}, where the document writes ${show(written[i]?.value ?? null, 100)}`);
    }
  }
  for (const f of DEFAULTED) {
    if (!want.has(f.path)) continue;
    for (const { at, value } of reach(read, f.path, car.wheels)) {
      if (value === undefined) failures.push(`${f.path}: ${at} is not read back (${whose}: ${show(want.get(f.path))})`);
      else if (!same(value, want.get(f.path))) failures.push(`${f.path}: ${at} reads back ${show(value, 100)}, not ${show(want.get(f.path))} (${whose})`);
    }
  }
  return failures;
}
