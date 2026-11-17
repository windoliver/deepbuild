// Test-side tools for #192's pack criteria (6, 11, 12 and 13; README: The surface). They drive deep-show through
// #238's helpers (its builds per feature set, its `run` scenario and calls, and its pack writer), assemble this
// suite's fixtures with #544's assembler, write this suite's packs, run its fixtures in Node's own WebAssembly engine
// to show what each one does without the implementation, and build the merge base apart. Nothing here stands in for the pack check, the budget
// check, the sandbox module's runner or the web export: every outcome, issue, run count and bundle file read here is
// the implementation's own.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import {
  REPO, blocked, board, cargoBuild, isObject, obj, sha256, show, writePack,
  type JsonObject, type JsonValue, type PackDir, type ShowFeature,
} from '../../238/helpers.ts';

export {
  DOC, PACKS, REPO, SANDBOX_COUNTS, arr, deepShow, installPack, isObject, num, obj, prebuild, present, provided, runShow, scenario, sha256, show, str,
  useTemp,
} from '../../238/helpers.ts';
export type { JsonObject, JsonValue, PackDir } from '../../238/helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every test's own timeout: the builds of deep-show here and at the merge base take many minutes. */
export const TIMEOUT = 3_600_000;
/** The build every test drives: the full set and #238's test kind `test.mesh@1`, which takes a provider's mesh. */
export const SHOW: ShowFeature[] = ['full', 'test-mesh-item'];

/** A new empty folder `name` under `root` (one evidence store and pack folder per build's run). */
export function fresh(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Off macOS a test fails INCONCLUSIVE first; cargo that can't run is BLOCKED. */
export function hostReady(): void {
  if (process.platform !== 'darwin') throw Error(`INCONCLUSIVE: these tests run on macOS; this is ${process.platform}/${process.arch}`);
  const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
  if (cargo.error || cargo.status !== 0) blocked(`cargo can't run here (${cargo.error?.message ?? cargo.stderr.trim()}); put Homebrew's rustup on PATH`);
}

// ---------------------------------------------------------------------------------------------------
// Fixtures: fixtures/*.wat, assembled by #544's assembler (tests/acceptance/544/wat: the `wat` crate, outside the
// workspace, `acceptance-544-wat <out-dir> <file.wat>` writing `<stem>.wasm` after wasmparser validates it; #238's
// and #533's assemblers no longer build with --locked under the repo's cargo patches), and run in Node's engine.

const ASSEMBLER_DIR = join(REPO, 'tests', 'acceptance', '544', 'wat');
const ASSEMBLER_TARGET = join(REPO, 'target', 'acceptance-544-wat');
let assemblerBin = '';
function assembler(): string {
  if (assemblerBin) return assemblerBin;
  const run = spawnSync('cargo', ['build', '--locked', '--manifest-path', join(ASSEMBLER_DIR, 'Cargo.toml')], {
    cwd: ASSEMBLER_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0', CARGO_TARGET_DIR: ASSEMBLER_TARGET },
  });
  if (run.error || run.status !== 0) blocked(`the fixture assembler (tests/acceptance/544/wat) didn't build: ${run.error?.message ?? run.stderr.slice(-3000)}`);
  assemblerBin = join(ASSEMBLER_TARGET, 'debug', 'acceptance-544-wat');
  return assemblerBin;
}
export interface Program { name: string; bytes: Buffer; sha: string }
const programs = new Map<string, Program>();
export function program(name: string): Program {
  let p = programs.get(name);
  if (!p) {
    const dir = mkdtempSync(join(tmpdir(), 'deep-192-packs-wat-'));
    try {
      const run = spawnSync(assembler(), [dir, join(HERE, 'fixtures', `${name}.wat`)], { encoding: 'utf8' });
      if (run.status !== 0) throw Error(`the assembler refused fixtures/${name}.wat: ${run.stderr.slice(-2000)}`);
      const bytes = readFileSync(join(dir, `${name}.wasm`));
      p = { name, bytes, sha: sha256(bytes) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    programs.set(name, p);
  }
  return p;
}

/**
 * One run of a provider program as written, in Node's own WebAssembly engine, with the inputs laid out as the README's
 * surface says: each param as 8 little-endian bytes from params_at (integers as i64), each asset as a u32 length and
 * its bytes from assets_at, the seed as gen's argument. It shows what the fixture itself does; it is never the
 * sandbox module's run.
 */
export interface NodeRun { trap: string | null; out: (len: number) => Buffer; memoryBytes: number }
export function nodeRun(p: Program, o: { params?: bigint[]; assets?: Buffer[]; seed?: bigint } = {}): NodeRun {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(p.bytes)), {});
  const e = instance.exports as Record<string, unknown>;
  const memory = e['memory'] as WebAssembly.Memory;
  const at = (g: string): number => Number((e[g] as WebAssembly.Global).value);
  const view = new DataView(memory.buffer);
  let k = at('params_at');
  for (const v of o.params ?? []) { view.setBigInt64(k, v, true); k += 8; }
  k = at('assets_at');
  for (const a of o.assets ?? []) { view.setUint32(k, a.length, true); new Uint8Array(memory.buffer, k + 4, a.length).set(a); k += 4 + a.length; }
  let trap: string | null = null;
  try {
    (e['gen'] as (seed: bigint) => number)(o.seed ?? 0n);
  } catch (err) {
    if (!(err instanceof WebAssembly.RuntimeError)) throw err;
    trap = err.message;
  }
  const outAt = at('out_at');
  return { trap, out: (len) => Buffer.from(new Uint8Array(memory.buffer, outAt, len)), memoryBytes: memory.buffer.byteLength };
}
/** The gen@1 mesh a run wrote at out_at, as bytes: u32 n, u32 index count, then 32 bytes a vertex and 4 an index. */
export function meshBytes(run: NodeRun): { n: number; indices: number; bytes: Buffer } {
  const head = run.out(8);
  const n = head.readUInt32LE(0);
  const indices = head.readUInt32LE(4);
  return { n, indices, bytes: run.out(8 + 32 * n + 4 * indices) };
}

/** quad.wat's one-quad mesh, as `provided` reads a provider's mesh (#238's README). */
export const QUAD = {
  positions: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
  indices: [0, 1, 2, 0, 2, 3],
};

// ---------------------------------------------------------------------------------------------------
// Packs (README: Packs) and the documents that name their providers.

export const OWNER = 'test';
export const VERSION = '1.0.0';
/** An outside pack `test/<name>@1.0.0` with `providers` and its asset files, each listed by sha256. */
export function providerPack(root: string, name: string, providers: JsonObject, assets: Record<string, Buffer>): { pack: PackDir; sha: Record<string, string> } {
  return writePack(root, OWNER, {
    name, version: VERSION, license: 'MIT',
    description: `A test pack of #192's acceptance suite (packs): ${Object.keys(providers).join(', ')}.`,
    requires: { core: '>=0.0.0', modules: { sandbox: '>=0.0.0' } },
    providers,
  }, assets);
}
/** A providers entry: a program by sha256, a params schema, a mesh output and any other fields. */
export const meshProvider = (p: Program, extra: JsonObject = {}, maxVertices = 4): JsonObject =>
  ({ program: p.sha, params: {}, out: { mesh: { max_vertices: maxVertices, closed: false } }, ...extra });
/** A board (#238's form) pinning one pack, with one test.mesh@1 item `mesh` naming `<pack>.<provider>` with `params`. */
export function meshDoc(pack: PackDir, gen: string, params: JsonObject = {}): JsonObject {
  const item: JsonObject = { id: 'mesh', kind: 'test.mesh@1', name: 'Mesh', order: 'a0', params: { mesh: { gen, params } } };
  return board(gen, [item], { packs: [`${pack.id}@${pack.version}`], requires: { modules: { 'test.mesh': '^1' } } });
}

// ---------------------------------------------------------------------------------------------------
// Replies.

export const issueList = (reply: JsonObject | undefined): JsonObject[] =>
  (isObject(reply) && Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject);
/** The issues of a reply whose `path` is `path`, or under it when `under`. */
export const issuesAt = (reply: JsonObject | undefined, path: string, under = false): JsonObject[] =>
  issueList(reply).filter((i) => i['path'] === path || (under && typeof i['path'] === 'string' && i['path'].startsWith(`${path}/`)));
export const errors = (reply: JsonObject | undefined): JsonObject[] => issueList(reply).filter((i) => i['severity'] === 'error');
/** An `install_pack` reply in a line: its outcome and its issues' paths. */
export const installShown = (r: JsonObject | undefined): string =>
  `outcome ${String(r?.['outcome'])}, issues ${JSON.stringify(issueList(r).map((i) => ({ path: i['path'], actual: i['actual'] }))).slice(0, 900)}`;
/** The `provided` row of the document's item `mesh`, if its provider ran or was taken by key. */
export function providedRow(reply: JsonObject | undefined): JsonObject | undefined {
  if (!isObject(reply) || !Array.isArray(reply['provided'])) return undefined;
  return reply['provided'].filter(isObject).find((r) => r['item'] === 'mesh');
}
/** Whether a `provided` row holds quad.wat's mesh and no trap. */
export function ranTheQuad(row: JsonObject | undefined): boolean {
  if (!row || (row['trap'] ?? null) !== null) return false;
  const mesh = isObject(row['out']) && isObject(row['out']['mesh']) ? row['out']['mesh'] : null;
  return mesh !== null && JSON.stringify(mesh['positions']) === JSON.stringify(QUAD.positions) && JSON.stringify(mesh['indices']) === JSON.stringify(QUAD.indices);
}
export const runsOf = (reply: JsonObject | undefined, what: string): number => {
  const v = obj(reply, what)['runs'];
  expect(typeof v, `${what}: the sandbox module's run count, got ${show(reply)}`).toBe('number');
  return v as number;
};
export const trapKind = (issue: JsonObject): JsonValue | undefined =>
  isObject(issue['actual']) && isObject(issue['actual']['trap']) ? issue['actual']['trap']['kind'] : undefined;

// ---------------------------------------------------------------------------------------------------
// The merge base: exported whole by `git archive` into the (git-ignored) target folder and built apart, with the
// features the tests use, its target folder kept so later runs build warm.

const git = (...args: string[]): string => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const SUITE_README = 'tests/acceptance/192/packs/README.md';
/**
 * The commit the criteria call the merge base: `git merge-base HEAD origin/main`, unless that commit already holds
 * this suite (the work has merged, so main holds it); then the commit this suite was written on, the parent of the
 * commit that added its README.
 */
export function baseCommit(): string {
  const base = git('merge-base', 'HEAD', 'origin/main');
  const holdsSuite = spawnSync('git', ['cat-file', '-e', `${base}:${SUITE_README}`], { cwd: REPO }).status === 0;
  if (!holdsSuite) return base;
  const added = git('log', '--diff-filter=A', '--format=%H', base, '--', SUITE_README).split('\n').filter(Boolean).pop();
  if (!added) throw Error(`${base.slice(0, 12)} holds ${SUITE_README} but no commit added it`);
  return git('rev-parse', `${added}^`);
}
/** The merge base's deep-show with `SHOW`'s features, built in its own export and target folder. */
export function baseShow(): { sha: string; bin: string } {
  const sha = baseCommit();
  const dir = join(REPO, 'target', 'acceptance-192-packs-base', sha.slice(0, 12));
  if (!existsSync(join(dir, '.exported'))) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const tar = join(dir, '..', `${sha.slice(0, 12)}.tar`);
    execFileSync('git', ['archive', '--format=tar', '-o', tar, sha], { cwd: REPO });
    execFileSync('tar', ['-xf', tar, '-C', dir]);
    rmSync(tar, { force: true });
    writeFileSync(join(dir, '.exported'), sha);
  }
  const bin = join(dir, `deep-show-${SHOW.join('+')}`);
  if (!existsSync(bin)) {
    const error = cargoBuild(dir, 'deep-show', SHOW, { CARGO_TARGET_DIR: join(dir, 'target') });
    expect(error, `the merge base ${sha.slice(0, 12)}'s deep-show builds with --features ${SHOW.join(',')}`).toBe('');
    copyFileSync(join(dir, 'target', 'debug', 'deep-show'), bin);
  }
  return { sha, bin };
}
