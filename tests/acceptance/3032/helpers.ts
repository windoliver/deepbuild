// Test-side tools for the #3032 acceptance tests (README: The surface under test): the tree's familiar-names pack,
// read from `packs/`; the census script (`node scripts/census.mjs --check`) run as a process on the checkout;
// `deep-show` (built with `--no-default-features --features full`) driven by one scenario line, with the pack
// installed by `install_pack`, one document a word, and `deep_kinds`' `word`; the fixtures; and the planted programs
// the criteria name, each a copy of the tree's pack with one thing changed, written at test time. The judges are in
// judges.ts. Nothing here stands in for the census script, the pack check, the document check or deep_kinds. Helper
// code is copied from tests/acceptance/1493 and 433, never imported across suites. Node built-ins and vitest only.

import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import {
  SHADER_TEXT, STATES, fixtureProblems, isObject, judgeProblems, lightsOf, namedOf, namedProblems, recipeFor, show, toleranceOf,
  type JsonObject, type JsonValue, type Light, type Named, type Tolerance,
} from './judges.ts';

// Each test spawns the census script or the binary, and each file's hook builds the binary; none has a time budget.
vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });
export const SLOW = 3_600_000;

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/3032 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** The census script under test. */
export const CENSUS = join(REPO, 'scripts', 'census.mjs');

const readJson = (path: string): JsonValue => JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
function writeJson(path: string, value: JsonValue): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${show(value)}`).toBe(true);
  return value as JsonObject;
}

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names every one of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  expect(failures.some((f) => names.every((n) => f.includes(n))), `${what}: one failure names ${names.join(' and ')}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// The fixtures, and the judges shown to fail their planted sets.

export const fixture = (name: string): JsonObject => obj(readJson(join(HERE, 'fixtures', name)), `fixtures/${name}`);

export interface Suite { named: Map<string, Named>; lights: Light[]; tolerance: Tolerance }
/**
 * The fixtures, each held to what it rests on (the issue's twenty; the conversions judges.ts derives), and every
 * judge run against its planted sets. A test calls this first, before it reads the tree or asks for a binary: a
 * fixture that states another number, or a judge that passes a wrong set, fails the test here.
 */
export function suite(): Suite {
  const [names, lights] = [fixture('names.json'), fixture('lights.json')];
  none(namedProblems(names), 'fixtures/names.json against the issue\'s twenty');
  none(fixtureProblems(lights), 'fixtures/lights.json against the derivation in judges.ts');
  const out: Suite = { named: namedOf(names), lights: lightsOf(lights), tolerance: toleranceOf(lights) };
  none(judgeProblems(out.lights, out.tolerance), 'each judge against its planted sets');
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The tree's pack: the folder under packs/ whose pack.json is named `familiar`, at its newest version, with the
// census it names. A scenario installs it as `deepbuild/familiar`; a document names it `deepbuild/familiar@<version>`.

export interface Familiar {
  /** `deepbuild/familiar`, and `deepbuild/familiar@<version>`. */
  id: string; at: string; version: string;
  /** Its folder, by name under packs/ and by path. */
  folder: string; dir: string;
  manifest: JsonObject; census: JsonObject;
}
const parts = (version: string): number[] => version.split('.').map((n) => Number.parseInt(n, 10) || 0);
const newer = (a: string, b: string): number => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
};

export function familiar(): Familiar {
  const root = join(REPO, 'packs');
  const found = readdirSync(root).flatMap((folder) => {
    const file = join(root, folder, 'pack.json');
    const manifest = existsSync(file) ? readJson(file) : null;
    return isObject(manifest) && manifest['name'] === 'familiar' ? [{ folder, manifest, version: String(manifest['version']) }] : [];
  }).sort((a, b) => newer(a.version, b.version));
  expect(found.length, 'packs/ holds a pack whose pack.json is named familiar').toBeGreaterThan(0);
  const { folder, manifest, version } = found[0]!;
  expect(typeof manifest['census'], `packs/${folder}/pack.json names its census file: ${show(Object.keys(manifest))}`).toBe('string');
  const file = join(root, folder, String(manifest['census']));
  expect(existsSync(file), `packs/${folder}'s census ${String(manifest['census'])} exists`).toBe(true);
  return { id: 'deepbuild/familiar', at: `deepbuild/familiar@${version}`, version, folder, dir: join(root, folder), manifest, census: obj(readJson(file), `packs/${folder}'s census`) };
}

// ---------------------------------------------------------------------------------------------------
// The census script: `node scripts/census.mjs --check` on the checkout, never with the network allowed.

export interface Ran { status: number | null; output: string; lines: string[] }
/** This environment with nothing that lets the fetcher reach the network. */
function scriptEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^(DEEP_|XDG_)/.test(key) && key !== 'NODE_OPTIONS') env[key] = value;
  return { ...env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), XDG_CONFIG_HOME: join(home, '.config') };
}
/** `node scripts/census.mjs --check`, run in the checkout with HOME at `home` (the fetch cache is `home`'s). */
export function checkCensus(home: string): Ran {
  const r = spawnSync(process.execPath, [CENSUS, '--check'], { cwd: REPO, env: scriptEnv(home), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600_000, killSignal: 'SIGKILL' });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`;
  return { status: r.status, output, lines: output.split('\n') };
}
const STATE = /^(PASS|FAIL|BLOCKED|INVALID|INCONCLUSIVE)\b/;
/** Why the run didn't pass: an exit other than 0, no `PASS census:` line, or a line in another state. A reference
 * that isn't in the cache reads BLOCKED here, never a pass. */
export function passFailures(r: Ran): string[] {
  const out: string[] = [];
  if (r.status !== 0) out.push(`it exits ${r.status}, not 0`);
  if (!r.lines.some((l) => l.startsWith('PASS census:'))) out.push('it prints no "PASS census:" line');
  const other = r.lines.filter((l) => STATE.test(l) && !l.startsWith('PASS'));
  if (other.length) out.push(`it prints ${other.length} line(s) in another state: ${other.slice(0, 5).join(' | ').slice(0, 1500)}`);
  if (other.some((l) => l.startsWith('BLOCKED'))) out.push('BLOCKED: the reference isn\'t in the fetch cache at its pin; warm it with DEEP_FETCH_NETWORK=1 node scripts/fetch-lock.mjs fetch');
  return out.length ? [...out, `exit ${r.status}; output:\n${r.output.trim().split('\n').slice(0, 40).join('\n').slice(0, 4000)}`] : [];
}

// ---------------------------------------------------------------------------------------------------
// Temporary folders: one per test, removed after it.

export function useTemp(): () => string {
  let dir = '';
  beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3032-'))); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
/** A new empty folder `name` in `root`. */
export function sub(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------------------------------
// deep-show (built with every canvas module), built once per file in the checkout and copied out of target/debug.

const CARGO = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'];
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

/** Builds `deep-show` before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useShow(): () => string {
  let dir = '';
  let made = { bin: '', error: 'not built' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-3032-bin-'));
    const bin = join(dir, exe('deep-show'));
    const r = spawnSync('cargo', CARGO, {
      cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' },
    });
    let error = '';
    if (r.error) error = `cargo could not run: ${r.error.message}`;
    else if (r.status !== 0) error = `cargo ${CARGO.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
    else {
      const target = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
      copyFileSync(join(target, 'debug', exe('deep-show')), bin);
    }
    made = { bin, error };
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(made.error, `the binary builds: cargo ${CARGO.join(' ')}`).toBe('');
    return made.bin;
  };
}

/** `deep-show run`: one scenario line in, one `{ok: true, replies}` line out, exit 0. */
function runShow(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code !== 'ETIMEDOUT') throw Error(`deep-show run: ${r.error.message}`);
  expect(r.error, 'deep-show run finished within its timeout').toBeUndefined();
  expect(r.status, `deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-show run: one output line per input line').toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-show run: the answer');
  expect(out['ok'], `deep-show run refused the scenario: ${show(out, 3000)}`).toBe(true);
  const replies = Array.isArray(out['replies']) ? out['replies'].map((x, i) => obj(x, `deep-show run: replies[${i}]`)) : [];
  expect(replies.length, 'deep-show run: one reply per call').toBe((scenario['calls'] as JsonValue[]).length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The scenario (as #433's and #1493's suites set it): an agent's session, the process table, one visible panel a
// document, the pack installed by the first call, then the test's calls.

const SESSION = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Agent: familiar names', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 4100, ppid: 3000, start: 1_000 }];
/** The ID of the suite's `i`th document, as the hub mints one. */
const docId = (i: number): string => `01JB3032D${String(i + 1).padStart(17, '0')}`;
/** The item every document of the suite holds its word in. */
export const WORD = 'word';

/**
 * The agent's `deep_show` of the suite's `i`th document, a whole revision with its issues: a scene that names the
 * pack and holds a still camera of its own (`cam`) and one item, `word`, written as `item` gives its kind and params.
 * One word a document, so no two instances share a revision (a scene takes one sky, and a derived item carries its
 * instance's order).
 */
export function showWord(i: number, pack: Familiar, title: string, item: JsonObject): JsonObject {
  const document: JsonObject = {
    format: 1, profile: 'scene', title, description: `${title}: a #3032 acceptance fixture.`, size: [1920, 1080], camera: 'cam',
    requires: { modules: { scene3d: '^1' } }, packs: [pack.at],
    items: {
      cam: { id: 'cam', name: 'cam', order: 'a000', kind: 'camera@1', params: { projection: 'perspective', position: [6, 5, 8], target: [0, 0, 0], fov: 40 } },
      [WORD]: { id: WORD, name: WORD, order: 'a001', ...item },
    },
  };
  return { call: 'deep_show', session: SESSION.id, doc: docId(i), document, include: ['issues'] };
}
/** `deep_kinds`' `word`: what the installed packs say of a word. */
export const askWord = (word: string): JsonObject => ({ call: 'deep_kinds', op: 'word', word });

/** One `deep-show run`: the pack in `pack.dir` offered to the pack check by `install_pack`, then each of `calls`.
 * `installed` is the pack check's reply ({outcome: installed | refused, issues}); `replies` are the calls'. */
export function run(bin: string, evidence: string, pack: Familiar, calls: JsonObject[]): { installed: JsonObject; replies: JsonObject[] } {
  const docs = [...new Set(calls.flatMap((c) => (typeof c['doc'] === 'string' ? [c['doc']] : [])))];
  const scenario: JsonObject = {
    evidence,
    sessions: { [SESSION.id]: { thread: SESSION.thread, name: SESSION.name, process: { ...SESSION.process } } },
    processes: PROCESSES,
    panels: Object.fromEntries(docs.map((_, i) => [`p${i + 1}`, { rect: [0, 0, 800, 600] }])),
    docs: Object.fromEntries(docs.map((id, i) => [id, { panel: `p${i + 1}` }])),
    calls: [{ call: 'install_pack', id: pack.id, dir: pack.dir }, ...calls],
  };
  const [installed, ...replies] = runShow(bin, scenario) as [JsonObject, ...JsonObject[]];
  return { installed, replies };
}
/** The pack check's verdict on `pack` alone. */
export const install = (bin: string, evidence: string, pack: Familiar): JsonObject => run(bin, evidence, pack, []).installed;
/** The pack installs: every later reply of its run reads a pack the check admitted. */
export function installs(installed: JsonObject, what: string): void {
  expect(installed['outcome'], `${what} passes the pack's check: ${show(installed, 3000)}`).toBe('installed');
}

// ---------------------------------------------------------------------------------------------------
// The planted programs (README: The planted programs): each a copy of the tree's pack, every file as shipped, with
// one thing changed, installed in a run of its own under the pack's own ID.

/** A copy of the tree's pack in `dir`, as shipped. */
export function copyPack(p: Familiar, dir: string): Familiar {
  cpSync(p.dir, dir, { recursive: true });
  return { ...p, dir, manifest: clone(p.manifest), census: clone(p.census) };
}
/** Writes a copy's manifest and census back, the census's totals counted from its rows. */
function save(copy: Familiar): void {
  const count = (rows: JsonValue | undefined): JsonObject =>
    Object.fromEntries(STATES.map((s) => [s, (Array.isArray(rows) ? rows : []).filter((r) => isObject(r) && r['state'] === s).length]));
  copy.census['totals'] = { names: count(copy.census['names']), params: count(copy.census['params']) };
  writeJson(join(copy.dir, 'pack.json'), copy.manifest);
  writeJson(join(copy.dir, String(copy.manifest['census'])), copy.census);
}
/** The file of the recipe `name` maps to in a copy, with what it holds. */
function recipeFile(copy: Familiar, name: string): { file: string; recipe: JsonObject } {
  const target = recipeFor(copy.manifest, name);
  const entry = obj(copy.manifest['recipes'], 'pack.json: recipes')[target];
  expect(typeof entry, `${name}'s recipe ${target} is a file of the pack`).toBe('string');
  const file = join(copy.dir, String(entry));
  return { file, recipe: obj(readJson(file), `${name}'s recipe ${String(entry)}`) };
}
const rows = (census: JsonObject, table: 'names' | 'params'): JsonObject[] => {
  if (!Array.isArray(census[table])) census[table] = [];
  return census[table] as JsonObject[];
};

/** AC2's field: the parameter the planted recipe accepts and draws nothing from. */
export const UNREAD = 'unreadParameter';
/** `parameter_draws_nothing`: the recipe `name` maps to gains the input `unreadParameter`, which no step reads, and
 * the census a `params` row that calls it mapped, as it calls every input a recipe takes. Everything else as shipped. */
export function plantUnread(copy: Familiar, name: string): void {
  const { file, recipe } = recipeFile(copy, name);
  const inputs = isObject(recipe['inputs']) ? recipe['inputs'] : {};
  expect(Object.keys(inputs), `${name}'s recipe takes no input named ${UNREAD} as shipped`).not.toContain(UNREAD);
  recipe['inputs'] = { ...inputs, [UNREAD]: { type: 'number', default: 0.5, min: 0, max: 1, about: 'a parameter the planted recipe accepts, which no step of it reads' } };
  writeJson(file, recipe);
  rows(copy.census, 'params').push({ name, param: UNREAD, state: 'mapped', target: UNREAD });
  save(copy);
}

/** AC3's planted recipe: the kind the planted pack maps the reference's shader-text material to. */
export const SHADER_RECIPE = 'familiar.shader_material@1';
/** `shader_text_material_mapped`: the pack maps `ShaderMaterial` onto `material@1`: a recipe of one step that makes a
 * `material@1` and takes no shader text, an alias onto it, and the census row mapped. Everything else as shipped. */
export function plantShaderMaterial(copy: Familiar): void {
  const file = 'planted-shader_material@1.json';
  writeJson(join(copy.dir, file), {
    id: 'familiar.shader_material', version: '1.0', title: 'Shader material', license: typeof copy.manifest['license'] === 'string' ? copy.manifest['license'] : 'Apache-2.0',
    author: 'the #3032 acceptance suite',
    description: `The planted shader_text_material_mapped: the library's ${SHADER_TEXT}, bent onto a material@1 at its defaults, its shader text dropped.`,
    steps: { material: { op: 'item', kind: 'material@1', params: {} } },
  });
  obj(copy.manifest['recipes'], 'pack.json: recipes')[SHADER_RECIPE] = file;
  obj(copy.manifest['aliases'], 'pack.json: aliases')[SHADER_TEXT] = { target: SHADER_RECIPE, conversion: 'vertexShader and fragmentShader dropped; a material@1 at its defaults' };
  copy.census['names'] = [...rows(copy.census, 'names').filter((r) => r['name'] !== SHADER_TEXT), { name: SHADER_TEXT, state: 'mapped', target: SHADER_RECIPE }];
  copy.census['params'] = rows(copy.census, 'params').filter((r) => r['name'] !== SHADER_TEXT);
  save(copy);
}

/** `light_number_copied`: the recipe `light.name` maps to is replaced by one that takes the library's words the
 * fixture writes and whose one step makes the light's kind with the library's number copied as written (the
 * fixture's `planted`). Everything else as shipped. */
export function plantCopied(copy: Familiar, light: Light): void {
  const { file, recipe } = recipeFile(copy, light.name);
  const planted = obj(light.planted, `fixtures/lights.json: ${light.name}.planted`);
  writeJson(file, {
    id: recipe['id'] ?? null, version: recipe['version'] ?? null, title: `${String(recipe['title'] ?? light.name)}, its number copied`,
    license: recipe['license'] ?? 'Apache-2.0', author: 'the #3032 acceptance suite',
    description: `The planted light_number_copied: the library's ${light.name} with its ${light.word} copied as written into our ${light.kind}.`,
    inputs: planted['inputs'] ?? {},
    steps: { light: { op: 'item', kind: light.kind, params: planted['params'] ?? {} } },
  });
}
