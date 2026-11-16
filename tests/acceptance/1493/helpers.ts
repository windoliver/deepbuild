// Test-side tools for the #1493 acceptance tests (README: The surface under test): the census script
// (`node scripts/census.mjs`) run as a process on a tree laid out like the repo, with the reference files placed in a
// temporary HOME's fetch cache; an independent lister of a reference file's public names; `deep-show` (built with
// `--no-default-features --features full`) driven by one scenario line, with `--planted <name>` for the criteria's
// planted programs; the test packs these tests write; and the judges that read what the criteria name. Nothing here
// stands in for the census script, the fetcher, the pack check, the kind kit, deep_kinds or the document check: every
// verdict a test judges is the script's or the binary's own. Helper code is copied from tests/acceptance/412, 1399,
// 1970, 393 and 1824, never imported across suites. Node built-ins and vitest only.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1493 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** The census script under test. */
export const CENSUS = join(REPO, 'scripts', 'census.mjs');
/** The pinned reference commit the familiar@1 pack is held to (tests/acceptance/433/reference.ts, its pin). */
export const PIN = '65c4864bb3bd4309257d41c6e54f4403dc57f255';
/** The closed list of reasons a `refused` row may give. */
export const REASONS = ['imperative', 'renderer', 'superseded', 'no_counterpart'] as const;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${show(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${show(value)}`).toBe(true);
  return value as JsonValue[];
}
export const show = (v: unknown, max = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, max);
export const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
const text = (v: JsonValue): string => `${JSON.stringify(v, null, 2)}\n`;
export const readJson = (path: string): JsonValue => JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
export function writeJson(path: string, value: JsonValue): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text(value));
}
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Whether `text` holds `word` as a whole word: not inside a longer name (`Light` in `PointLight`). */
export function namesWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`).test(text);
}

// ---------------------------------------------------------------------------------------------------
// A reference file's public names, listed here apart from the script: the `as` name (else the name) of each entry in
// an `export { … } from '…'` list, and X of each `export class X`, `export function X` and `export const X`. Comments
// are left out first.

export function publicNames(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const out: string[] = [];
  for (const m of code.matchAll(/^\s*export\s*\{([^}]*)\}\s*from\s*['"][^'"]*['"]/gm)) {
    for (const entry of m[1]!.split(',')) {
      const parts = entry.trim().split(/\s+as\s+/);
      const name = (parts[1] ?? parts[0] ?? '').trim();
      if (name && name !== 'default') out.push(name);
    }
  }
  for (const m of code.matchAll(/^\s*export\s+(?:class|function\*?|const)\s+([A-Za-z_$][\w$]*)/gm)) out.push(m[1]!);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The census script: `node scripts/census.mjs <args>` in `cwd`, with HOME at `home`, never with the network allowed.

export interface Ran { status: number | null; output: string; lines: string[] }

/** This environment with HOME moved to `home` and nothing that lets the fetcher reach the network. */
function scriptEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^(DEEP_|XDG_)/.test(key) && key !== 'NODE_OPTIONS') env[key] = value;
  return { ...env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), XDG_CONFIG_HOME: join(home, '.config') };
}

export function runScript(script: string, args: string[], cwd: string, home: string): Ran {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, env: scriptEnv(home), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600_000, killSignal: 'SIGKILL' });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`;
  return { status: r.status, output, lines: output.split('\n') };
}
/** `node scripts/census.mjs <args> --root <tree>`, run in the tree. */
export const census = (args: string[], tree: string, home: string): Ran => runScript(CENSUS, [...args, '--root', tree], tree, home);

const STATE = /^(PASS|FAIL|BLOCKED|INVALID|INCONCLUSIVE)\b/;
/** The lines that carry a state, in order. */
export const stateLines = (r: Ran): string[] => r.lines.filter((l) => STATE.test(l));
const clip = (r: Ran): string => `exit ${r.status}; output:\n${r.output.trim().split('\n').slice(0, 40).join('\n').slice(0, 4000)}`;

/** The run passes: exit 0, a `PASS census:` line, and no line in another state. */
export function passFailures(r: Ran, what: string): string[] {
  const out: string[] = [];
  if (r.status !== 0) out.push(`${what}: exits ${r.status}, not 0`);
  if (!r.lines.some((l) => l.startsWith('PASS census:'))) out.push(`${what}: prints no "PASS census:" line`);
  const other = stateLines(r).filter((l) => !l.startsWith('PASS'));
  if (other.length) out.push(`${what}: prints ${other.length} line(s) in another state: ${other.slice(0, 5).join(' | ')}`);
  return out.length ? [...out, clip(r)] : [];
}

/** The run fails naming `word`: exit not 0, no PASS line, and a `FAIL census:` line that holds `word` as a whole word. */
export function failNamingFailures(r: Ran, word: string, what: string): string[] {
  const out: string[] = [];
  if (r.status === 0) out.push(`${what}: exits 0`);
  if (r.lines.some((l) => l.startsWith('PASS'))) out.push(`${what}: prints a PASS line`);
  if (!r.lines.some((l) => l.startsWith('FAIL census:') && namesWord(l, word))) out.push(`${what}: no "FAIL census:" line names ${word}`);
  return out.length ? [...out, clip(r)] : [];
}

/** The run reads BLOCKED: exit not 0, no PASS line, and its first line in a state is BLOCKED. */
export function blockedFailures(r: Ran, what: string): string[] {
  const out: string[] = [];
  if (r.status === 0) out.push(`${what}: exits 0`);
  if (r.lines.some((l) => l.startsWith('PASS'))) out.push(`${what}: prints a PASS line`);
  const first = stateLines(r)[0];
  if (!first?.startsWith('BLOCKED')) out.push(`${what}: its first line in a state is ${first === undefined ? 'missing' : `"${first}"`}, not BLOCKED`);
  return out.length ? [...out, clip(r)] : [];
}

// ---------------------------------------------------------------------------------------------------
// Temporary folders: one per test, removed after it.

export function useTemp(): () => string {
  let dir = '';
  beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1493-'))); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** A new empty folder `name` in `root`. */
export function sub(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** `git <args>` in `cwd`, with no user hooks, signing or settings of this machine's; its output, or a thrown error. */
function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=acceptance', '-c', 'user.email=acceptance@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (r.status !== 0) throw Error(`git ${args.join(' ')} in ${cwd}: ${r.stderr}`);
  return r.stdout;
}
/** Makes `tree` a git repository with one commit of everything in it: the census's before-state (no origin/main, so HEAD). */
export function commitAll(tree: string): void {
  git(tree, ['init', '-q', '-b', 'work']);
  git(tree, ['add', '-A']);
  git(tree, ['commit', '-q', '-m', 'the before-state']);
}

/** Copies the checkout's fetcher into `tree/scripts`, beside the tree's own lock: the fetcher the census reads through. */
export function copyFetcher(tree: string): void {
  mkdirSync(join(tree, 'scripts'), { recursive: true });
  copyFileSync(join(REPO, 'scripts', 'fetch-lock.mjs'), join(tree, 'scripts', 'fetch-lock.mjs'));
}

/** A copy of the checkout's familiar@1 pack and lock in `tree`, laid out like the repo. */
export function copyFamiliar(tree: string): string {
  copyFetcher(tree);
  copyFileSync(join(REPO, 'scripts', 'fetch-lock.json'), join(tree, 'scripts', 'fetch-lock.json'));
  const folder = join(tree, 'packs', 'familiar-1.0.0');
  cpSync(join(REPO, 'packs', 'familiar-1.0.0'), folder, { recursive: true });
  return folder;
}

// ---------------------------------------------------------------------------------------------------
// The stub reference and the stub pack (README: Fixtures): acme/stub@1.0.0, whose census counts the six public names
// of a two-file stub library, in a tree laid out like the repo, the library's files in a temporary HOME's cache.

export const STUB_COMMIT = '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567';
export const STUB_INDEX = 'acme-stub/src/index.js';
export const STUB_BOX = 'acme-stub/src/BoxShape.js';
export const STUB_FOLDER = 'packs/stub-1.0.0';

/** The stub library's index: six public names, BoxShape, RoundShape, Light, Ticker, makeGizmo and REVISION. */
export const STUB_INDEX_TEXT = [
  '// The stub library of the #1493 acceptance tests: what its index exports.',
  "export { BoxShape } from './BoxShape.js';",
  "export { RoundShape, Lamp as Light } from './shapes.js';",
  'export class Ticker {}',
  'export function makeGizmo() {}',
  "export const REVISION = '1';",
  '',
].join('\n');
/** BoxShape's class: its constructor takes width and height. */
export const STUB_BOX_TEXT = [
  'class BoxShape {',
  '',
  '\tconstructor( width = 1, height = 1 ) {',
  '',
  '\t\tthis.width = width;',
  '\t\tthis.height = height;',
  '',
  '\t}',
  '',
  '}',
  '',
].join('\n');

/** The stub pack's census, right for the two files above. */
export function stubCensus(): JsonObject {
  return {
    reference: { commit: STUB_COMMIT, version: '1.0.0', files: [STUB_INDEX, STUB_BOX] },
    scope: 'Every name the stub library index exports, counted for the #1493 acceptance tests.',
    names: [
      { name: 'BoxShape', state: 'mapped', target: 'stub.box@1' },
      { name: 'Light', state: 'refused', reason: 'renderer', target: 'a light the scene declares' },
      { name: 'REVISION', state: 'open' },
      { name: 'RoundShape', state: 'open' },
      { name: 'Ticker', state: 'refused', reason: 'imperative', target: 'a channel keyed in time' },
      { name: 'makeGizmo', state: 'open' },
    ],
    params: [
      { name: 'BoxShape', param: 'width', state: 'mapped', target: 'width' },
      { name: 'BoxShape', param: 'height', state: 'mapped', target: 'height' },
    ],
    totals: { names: { mapped: 1, refused: 2, open: 3 }, params: { mapped: 2, refused: 0, open: 0 } },
  };
}

/** The stub pack's manifest: the recipe stub.box@1 and the alias BoxShape, with its census. */
export function stubManifest(): JsonObject {
  return {
    name: 'stub', version: '1.0.0', license: 'MIT',
    description: 'A familiar-names test pack of the #1493 acceptance suite: one word of the stub library, mapped onto a recipe.',
    requires: { core: '>=0.0.0', modules: { marks2d: '>=0.0.0' } },
    recipes: { 'stub.box@1': 'stub.box@1.json' },
    aliases: { BoxShape: { target: 'stub.box@1', conversion: 'width and height by name, in metres, at 100 u a metre' } },
    census: 'census.json',
  };
}

const rect = (box: JsonValue[], pos: JsonValue[], count: JsonValue): JsonObject =>
  ({ op: 'mark', kind: 'rect@1', repeat: { count, as: 'i' }, params: { box, paint: { fill: { role: 'muted' } } }, at: { pos } });

function stubRecipe(): JsonObject {
  return {
    id: 'stub.box', version: '1.0', title: 'Box', license: 'MIT', author: 'the #1493 acceptance suite',
    description: 'A box drawn from the front at 100 u a metre, one 2D rect.',
    inputs: {
      width: { type: 'number', unit: 'm', default: 1, min: 0.1, max: 3, about: 'the width, in metres' },
      height: { type: 'number', unit: 'm', default: 1, min: 0.1, max: 3, about: 'the height, in metres' },
    },
    steps: { face: rect([0, 0, 'width * 100', 'height * 100'], [0, 0, 0], 1) },
    outputs: { parts: ['face'] },
  };
}

export interface Stub {
  tree: string; home: string; pack: string;
  /** Writes a reference file into the cache and pins it in the tree's lock at its new hash. */
  reference(path: string, content: string): void;
  /** Removes the whole fetch cache. */
  dropCache(): void;
  readCensus(): JsonObject; writeCensus(c: JsonObject): void;
  readManifest(): JsonObject; writeManifest(m: JsonObject): void;
  write(path: string, content: string): void;
}

/** The stub tree in `root`: `tree/` (lock, fetcher, packs/stub-1.0.0) and `home/` (its cache), not yet committed. */
export function stubTree(root: string): Stub {
  const tree = join(root, 'tree'), home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  copyFetcher(tree);
  const pack = join(tree, STUB_FOLDER);
  const rows = new Map<string, JsonObject>();
  const cache = join(home, '.deepbuild', 'fetched');
  const reference = (path: string, content: string): void => {
    const file = join(cache, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    rows.set(path, {
      path, url: `https://forge.example.invalid/acme/stub/${STUB_COMMIT}/${path.split('/').slice(1).join('/')}`,
      sha256: sha256(content), size: Buffer.byteLength(content), credit: 'The stub library authors, MIT',
    });
    writeJson(join(tree, 'scripts', 'fetch-lock.json'), { files: [...rows.values()] });
  };
  reference(STUB_INDEX, STUB_INDEX_TEXT);
  reference(STUB_BOX, STUB_BOX_TEXT);
  writeJson(join(pack, 'pack.json'), stubManifest());
  writeJson(join(pack, 'stub.box@1.json'), stubRecipe());
  writeJson(join(pack, 'census.json'), stubCensus());
  return {
    tree, home, pack, reference,
    dropCache: () => rmSync(cache, { recursive: true, force: true }),
    readCensus: () => readJson(join(pack, 'census.json')) as JsonObject,
    writeCensus: (c) => writeJson(join(pack, 'census.json'), c),
    readManifest: () => readJson(join(pack, 'pack.json')) as JsonObject,
    writeManifest: (m) => writeJson(join(pack, 'pack.json'), m),
    write: (path, content) => { mkdirSync(dirname(join(tree, path)), { recursive: true }); writeFileSync(join(tree, path), content); },
  };
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
    dir = mkdtempSync(join(tmpdir(), 'deep-1493-bin-'));
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

/** `deep-show run [--planted <name>]`: one scenario line in, one `{ok: true, replies}` line out, exit 0. */
export function runShow(bin: string, scenario: JsonObject, planted?: string): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `deep-show ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code !== 'ETIMEDOUT') throw Error(`${name}: ${r.error.message}`);
  expect(r.error, `${name} finished within its timeout`).toBeUndefined();
  expect(r.status, `${name} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  expect(out['ok'], `${name} refused the scenario: ${show(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${name}: replies`).map((x, i) => obj(x, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(arr(scenario['calls'], "the scenario's calls").length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The names pack (README: Fixtures): acme/names, a familiar-names test pack whose one mapped word, Shelf, targets
// the recipe names.shelf@1 (inputs w, levels and bevelDepth, each of which changes what it draws), written at test time.

export const NAMES_ID = 'acme/names';
export const SHELF = 'names.shelf@1';
export const SHELF_CONVERSION = 'width becomes w in metres, at 100 u a metre; levels and bevelDepth by name';

/** The names pack's census: Shelf mapped, Ticker refused (imperative), Gizmo open; Shelf's params w, levels and bevelDepth mapped, autoUpdate refused. */
export function namesCensus(): JsonObject {
  return {
    reference: { commit: 'b1d0a7c0de1493b1d0a7c0de1493b1d0a7c0de14', version: '2.0.0', files: ['acme-names/src/index.js'] },
    scope: 'The shelf, ticker and gizmo classes the names library index exports, counted for the #1493 acceptance tests.',
    names: [
      { name: 'Gizmo', state: 'open' },
      { name: 'Shelf', state: 'mapped', target: SHELF },
      { name: 'Ticker', state: 'refused', reason: 'imperative', target: 'a channel keyed in time' },
    ],
    params: [
      { name: 'Shelf', param: 'w', state: 'mapped', target: 'w' },
      { name: 'Shelf', param: 'levels', state: 'mapped', target: 'levels' },
      { name: 'Shelf', param: 'bevelDepth', state: 'mapped', target: 'bevelDepth' },
      { name: 'Shelf', param: 'autoUpdate', state: 'refused', reason: 'imperative' },
    ],
    totals: { names: { mapped: 1, refused: 1, open: 1 }, params: { mapped: 3, refused: 1, open: 0 } },
  };
}

function shelfRecipe(extraInputs: JsonObject): JsonObject {
  return {
    id: 'names.shelf', version: '1.0', title: 'Shelf', license: 'MIT', author: 'the #1493 acceptance suite',
    description: 'A shelf drawn from the front at 100 u a metre: two sides and one board per level 40 u apart, each a 2D rect.',
    inputs: {
      w: { type: 'number', unit: 'm', default: 1.2, min: 0.4, max: 3, about: 'the outside width, in metres' },
      levels: { type: 'integer', default: 4, min: 1, max: 8, about: 'how many boards, one per level, 0.4 m apart' },
      bevelDepth: { type: 'number', unit: 'm', default: 0.02, min: 0.01, max: 0.1, about: 'how thick each board is, in metres' },
      ...extraInputs,
    },
    steps: {
      sides: rect([0, 0, 2, 'levels * 40'], ['i * (w * 100 - 2)', 0, 0], 2),
      boards: rect([0, 0, 'w * 100', 'bevelDepth * 100'], [0, '(i + 1) * 40 - bevelDepth * 100', 0], 'levels'),
    },
    outputs: { parts: ['sides', 'boards'] },
  };
}

export interface NamesPack { id: string; version: string; dir: string }
export const packAt = (p: NamesPack): string => `${p.id}@${p.version}`;

/**
 * Writes acme/names@`version` into `root`: the recipe names.shelf@1 with `extraInputs` beside w, levels and
 * bevelDepth, the alias Shelf onto it, and its census, `census` (the right one by default).
 */
export function writeNames(root: string, version: string, o: { extraInputs?: JsonObject; census?: JsonObject } = {}): NamesPack {
  const dir = join(root, `names-${version}`);
  writeJson(join(dir, `${SHELF}.json`), shelfRecipe(o.extraInputs ?? {}));
  writeJson(join(dir, 'census.json'), o.census ?? namesCensus());
  writeJson(join(dir, 'pack.json'), {
    name: 'names', version, license: 'MIT',
    description: 'A familiar-names test pack of the #1493 acceptance suite, by an outside owner: the word Shelf mapped onto a recipe.',
    requires: { core: '>=0.0.0', modules: { marks2d: '>=0.0.0' } },
    recipes: { [SHELF]: `${SHELF}.json` },
    aliases: { Shelf: { target: SHELF, conversion: SHELF_CONVERSION } },
    census: 'census.json',
  });
  return { id: NAMES_ID, version, dir };
}

/** `install_pack` (#306): the pack check. */
export const installPack = (p: NamesPack): JsonObject => ({ call: 'install_pack', id: p.id, dir: p.dir });
/** An `install_pack` reply: `outcome` installed or refused, and the refusal's issues. */
export interface Installed { outcome: string; issues: JsonObject[]; raw: JsonObject }
export function installed(reply: JsonObject, p: NamesPack): Installed {
  const issues = arr(reply['issues'] ?? [], `${packAt(p)}: issues`).map((v, i) => obj(v, `${packAt(p)}: issues[${i}]`));
  return { outcome: String(reply['outcome']), issues, raw: reply };
}

/** Every value in `v`, deep, leaving out an issue's prose (`what`, `fix`): what the issue names as data. */
function named(v: JsonValue | undefined): JsonValue[] {
  if (Array.isArray(v)) return [v, ...v.flatMap(named)];
  if (isObject(v)) return [v, ...Object.entries(v).filter(([k]) => k !== 'what' && k !== 'fix').flatMap(([, x]) => named(x))];
  return v === undefined ? [] : [v];
}
/** Whether `v` names `value` as data: a string equal to it. */
export const names = (v: JsonValue | undefined, value: string): boolean => named(v).some((x) => x === value);

/** The errors of a refused pack that are the kind kit's part `part` failing, naming the part as data. */
export function kitPartErrors(r: Installed, part: string): JsonObject[] {
  return r.issues.filter((i) => i['severity'] === 'error' && i['code'] !== 'unknown_field' && names(i, part));
}

// ---------------------------------------------------------------------------------------------------
// The world a deep_show needs (as #412's and #393's suites set it): an agent's session, the process table, a panel.

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = ulid('01JD1493D', 1);
const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: census', process: { pid: 4100, start: 1_000 } } as const;
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 4100, ppid: 3000, start: 1_000 }];
const PANELS: JsonObject = { main: { rect: [0, 0, 1200, 800] } };

/** A scenario of `calls` with the session, the process table, the panel and the document DOC on it. */
export const scenario = (evidence: string, calls: JsonObject[]): JsonObject =>
  ({ evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS, docs: { [DOC]: { panel: 'main' } }, calls });

/**
 * A board of one hidden test.dot@1 item `d` (radius, fill) with `extra` params, naming no pack. Hidden, as the kit's
 * catalog documents hold test kinds: no module draws test.dot@1, and a hidden item needs none, so the clean board
 * presents and its revision becomes current. test.dot@1 defines none of the fields the tests set.
 */
export function dotBoard(extra: JsonObject = {}): JsonObject {
  return {
    format: 1, profile: 'board', title: 'A dot', description: 'One test.dot@1, drawn by a test agent for the #1493 suite.', size: [320, 200],
    items: { d: { id: 'd', kind: 'test.dot@1', name: 'Dot', order: 'a0', visible: false, params: { radius: 1, fill: [1, 2, 3], ...extra } } },
  };
}
/** The agent's deep_show of a whole revision of DOC, with its issues. */
export const showDoc = (document: JsonObject): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc: DOC, document, include: ['issues'] });
/** DOC's revisions. */
export const revisionsOf: JsonObject = { call: 'revisions', doc: DOC };

/** The hash of DOC's one current revision in a `revisions` reply, or why there is none. */
export function currentHash(reply: JsonObject): string {
  const list = Array.isArray(reply['revisions']) ? reply['revisions'].filter(isObject) : [];
  const now = list.filter((r) => r['state'] === 'current');
  return now.length === 1 ? String(now[0]!['hash']) : `(${now.length} current revisions in ${show(reply['revisions'], 600)})`;
}

/** The calls of a document test: install the names pack, show the clean dot, read revisions, show the dot with `field`, read revisions. */
export const documentCalls = (p: NamesPack, field: string, value: JsonValue): JsonObject[] =>
  [installPack(p), showDoc(dotBoard()), revisionsOf, showDoc(dotBoard({ [field]: value })), revisionsOf];

/** The unknown_field issues a deep_show reply carries at `items/d/params/<field>`. */
function unknownFieldsAt(reply: JsonObject, field: string): JsonObject[] {
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  return issues.filter((i) => i['code'] === 'unknown_field' && i['path'] === `items/d/params/${field}`);
}
const closeOf = (issue: JsonObject): JsonObject[] => (Array.isArray(issue['close']) ? issue['close'].filter(isObject) : []);
const fixOf = (issue: JsonObject): string => (typeof issue['fix'] === 'string' ? issue['fix'] : '');

/** The setup replies hold: the pack installed, the clean dot presented as a current revision. */
export function setupFailures(replies: JsonObject[], p: NamesPack): string[] {
  const out: string[] = [];
  if (replies[0]!['outcome'] !== 'installed') out.push(`${packAt(p)} installs: ${show(replies[0], 3000)}`);
  if (currentHash(replies[2]!).startsWith('(')) out.push(`the clean dot is DOC's current revision: ${show(replies[1], 2000)}; ${currentHash(replies[2]!)}`);
  return out;
}

/**
 * AC7's judge, on the replies of `documentCalls`: the field is refused with unknown_field, and its close names
 * `{name: <pack@version>, maps: field, target, conversion}` with the target naming the field and the conversion the
 * pack states; the fix names the pack, that target and the conversion; and DOC's current revision is unchanged. Each
 * failure names the field.
 */
export function mapsFailures(replies: JsonObject[], p: NamesPack, field: string): string[] {
  const out: string[] = [];
  const [before, after] = [currentHash(replies[2]!), currentHash(replies[4]!)];
  if (before !== after) out.push(`field ${field}: DOC's current revision changed from ${before} to ${after}: the check accepted the word`);
  const hits = unknownFieldsAt(replies[3]!, field);
  if (!hits.length) return [...out, `field ${field}: no unknown_field at items/d/params/${field}: ${show(replies[3]!['issues'] ?? replies[3], 2500)}`];
  for (const h of hits) {
    const close = closeOf(h);
    const entry = close.find((c) => c['name'] === packAt(p) && c['maps'] === field);
    if (!entry) {
      out.push(`word ${field}: unknown_field's close names no ${packAt(p)} entry that maps it, only ${show(close)}`);
      continue;
    }
    const target = typeof entry['target'] === 'string' ? entry['target'] : '';
    if (!target.includes(field)) out.push(`field ${field}: the pack entry's target ${show(entry['target'])} doesn't name the field`);
    if (entry['conversion'] !== SHELF_CONVERSION) out.push(`field ${field}: the pack entry's conversion ${show(entry['conversion'])} isn't the one the pack states, "${SHELF_CONVERSION}"`);
    const fix = fixOf(h);
    for (const [what, value] of [['the pack', p.id], ['the target', target], ['the conversion', SHELF_CONVERSION]] as const) {
      if (!value || !fix.includes(value)) out.push(`field ${field}: the fix doesn't name ${what} ${show(value)}: ${show(fix)}`);
    }
  }
  return out;
}

/** AC8's judge: the field is refused with unknown_field, its close names `{name, refuses: field, reason}` and the fix holds the reason. */
export function refusesFailures(replies: JsonObject[], p: NamesPack, field: string, reason: string): string[] {
  const hits = unknownFieldsAt(replies[3]!, field);
  if (!hits.length) return [`word ${field}: no unknown_field at items/d/params/${field}: ${show(replies[3]!['issues'] ?? replies[3], 2500)}`];
  const out: string[] = [];
  for (const h of hits) {
    const close = closeOf(h);
    if (!close.some((c) => c['name'] === packAt(p) && c['refuses'] === field && c['reason'] === reason)) {
      out.push(`word ${field}: unknown_field's close names no ${packAt(p)} entry refusing it with reason ${reason}: ${show(close)}`);
    }
    if (!namesWord(fixOf(h), reason)) out.push(`word ${field}: the fix doesn't hold the row's reason ${reason}: ${show(fixOf(h))}`);
  }
  return out;
}

/**
 * AC9's judge: the field is refused with unknown_field; in its close the kind that defines it, `kind`, comes before
 * the pack's entry that maps it, and its fix names `kind` before the pack. Each failure names the field.
 */
export function kindBeforePackFailures(replies: JsonObject[], p: NamesPack, field: string, kind: string): string[] {
  const hits = unknownFieldsAt(replies[3]!, field);
  if (!hits.length) return [`field ${field}: no unknown_field at items/d/params/${field}: ${show(replies[3]!['issues'] ?? replies[3], 2500)}`];
  const out: string[] = [];
  for (const h of hits) {
    const close = closeOf(h);
    const k = close.findIndex((c) => c['name'] === kind);
    const q = close.findIndex((c) => c['name'] === packAt(p) && c['maps'] === field);
    if (k < 0 || q < 0 || k > q) out.push(`field ${field}: the close names ${kind} at ${k} and ${packAt(p)} at ${q}, not the kind first and the pack after it: ${show(close)}`);
    const fix = fixOf(h);
    const [fk, fq] = [fix.indexOf(kind), fix.indexOf(p.id)];
    if (fk < 0 || fq < 0 || fk > fq) out.push(`field ${field}: the fix names ${kind} at ${fk} and ${p.id} at ${fq}, not the kind first and the pack after it: ${show(fix)}`);
  }
  return out;
}
