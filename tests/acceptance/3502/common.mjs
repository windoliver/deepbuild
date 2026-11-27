// Test-side tools every file of #3502's suite shares (README.md): the criteria's IDs, the design's verdict words, the
// pin as the tree holds it, the carried-patch table and its retired rows as vendor/gpui-pre-apple/upstream/README.md
// writes them, the pinned release as scripts/vendor-rebase.mjs reaches it, the merge base, the machine, and the
// binaries a file drives. Nothing here stands in for the vendored trees, the lint, a row's test or a window.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
export const SUITE = fileURLToPath(new URL('./', import.meta.url)).replace(/\/$/, '');
export const FIXTURES = join(SUITE, 'fixtures');

// Each test file writes its criterion's ID in its tests' names, and no helper holds one: a tag in a helper would
// count for every file that imports it (scripts/proof-change.mjs, tagsWithImports).

/** The issue's numbers. */
export const FLOOR = '0.3.13';
export const TREES = ['gpui-pre', 'gpui-pre-apple', 'gpui-pre-macos'];
export const TABLE = 'vendor/gpui-pre-apple/upstream/README.md';
export const KIT = 'https://github.com/longbridge/gpui-kit';
/** Where the change keeps what a criterion says is recorded (README: The records). */
export const EVIDENCE = 'docs/evidence/3502';

// ---------------------------------------------------------------------------------------------------
// The design's verdict words. A test that can't run, or can't decide here, fails saying which: it never passes.

export function blocked(why) {
  throw Error(`BLOCKED: ${why}`);
}
export function inconclusive(why, readings = []) {
  throw Error(`INCONCLUSIVE: ${why}${readings.length ? `\n${readings.slice(0, 40).join('\n')}` : ''}`);
}
export const clip = (text, most = 1500) => (text.length > most ? `${text.slice(0, most / 2)} … ${text.slice(-most / 2)}` : text);
/** A path with the home folder written as `~`, for a message. */
export const tilde = (text) => String(text).split(homedir()).join('~');
export const read = (root, path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null);

const made = [];
/** A fresh folder under the OS's temporary folder, removed when the process ends. */
export function tempDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `deep-3502-${tag}-`));
  made.push(dir);
  return dir;
}
process.on('exit', () => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

// ---------------------------------------------------------------------------------------------------
// The pin (README: One release).

const parts = (version) => version.split('.').map(Number);
/** Whether `version` is `floor` or a later release, by its three numbers. */
export function atLeast(version, floor) {
  const [a, b] = [parts(version), parts(floor)];
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] > b[index];
  return true;
}

/** A vendored crate's pin: the `version` under `[package]` in its manifest, as scripts/vendor-rebase.mjs reads it. */
export const treeVersion = (root, tree) => /^\[package\][^[]*?^version = "([^"]+)"/ms.exec(read(root, `vendor/${tree}/Cargo.toml`) ?? '')?.[1] ?? null;

/** Cargo.lock's packages: `{name, version, source}`, `source` null for one resolved from a path. */
export function lockPackages(root) {
  return (read(root, 'Cargo.lock') ?? '').split('[[package]]').slice(1).map((block) => ({
    name: /^name = "([^"]+)"/m.exec(block)?.[1], version: /^version = "([^"]+)"/m.exec(block)?.[1], source: /^source = "([^"]+)"/m.exec(block)?.[1] ?? null,
  }));
}

/** The manifests that can name the toolkit: the workspace's and each crate's. */
function manifests(root) {
  const crates = existsSync(join(root, 'crates')) ? readdirSync(join(root, 'crates'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map(({ name }) => `crates/${name}/Cargo.toml`) : [];
  return ['Cargo.toml', ...crates].filter((path) => existsSync(join(root, path)));
}

/**
 * Criterion 1, first clause, and what must agree with it for it to be true of the build (the Scope's first line): the
 * three trees are one release at or past 0.3.13; Cargo.lock resolves each from its path, once, at that release; every
 * manifest that names one of the three names that release; gpui-kit and gpui-shell come from longbridge/gpui-kit at
 * one commit, the one Cargo.lock holds; and .cargo/config.toml holds the only patches. Each failure is a sentence.
 */
export function judgePin(root = REPO) {
  const failures = [];
  const versions = Object.fromEntries(TREES.map((tree) => [tree, treeVersion(root, tree)]));
  for (const tree of TREES) {
    if (!versions[tree]) failures.push(`vendor/${tree}/Cargo.toml names no [package] version`);
    else if (!/^\d+\.\d+\.\d+$/.test(versions[tree])) failures.push(`vendor/${tree} is ${versions[tree]}, which is no release's version`);
    else if (!atLeast(versions[tree], FLOOR)) failures.push(`vendor/${tree} is ${versions[tree]}, before ${FLOOR}`);
  }
  const distinct = [...new Set(Object.values(versions).filter(Boolean))];
  if (distinct.length > 1) failures.push(`the three trees are not one release: ${TREES.map((tree) => `vendor/${tree} ${versions[tree] ?? 'unknown'}`).join(', ')}`);
  if (failures.length) return failures;
  const [release] = distinct;

  const lock = lockPackages(root);
  for (const tree of TREES) {
    const found = lock.filter(({ name }) => name === tree);
    if (found.length !== 1) failures.push(`Cargo.lock holds ${found.length} packages named ${tree} (${found.map(({ version, source }) => `${version} from ${source ?? 'a path'}`).join(', ') || 'none'}), not the one vendored tree`);
    else if (found[0].source) failures.push(`Cargo.lock resolves ${tree} from ${found[0].source}, not from vendor/${tree}`);
    else if (found[0].version !== release) failures.push(`Cargo.lock holds ${tree} ${found[0].version}, and vendor/${tree} is ${release}`);
  }

  const revs = new Map();
  const config = read(root, '.cargo/config.toml') ?? '';
  for (const path of manifests(root)) {
    const text = read(root, path);
    if (/^\s*\[patch[.\]]/m.test(text)) failures.push(`${path} holds a [patch] table; .cargo/config.toml holds the only patches`);
    let table = null;
    for (const line of text.split('\n')) {
      table = /^\s*\[(?:[\w.'"-]+\.)?(gpui-pre(?:-apple|-macos)?)\]\s*$/.exec(line)?.[1] ?? (/^\s*\[/.test(line) ? null : table);
      const inline = /^\s*(gpui-pre(?:-apple|-macos)?)\s*=\s*(?:"([^"]+)"|\{.*?\bversion\s*=\s*"([^"]+)")/.exec(line);
      const dotted = table && /^\s*version\s*=\s*"([^"]+)"/.exec(line);
      const [tree, asked] = inline ? [inline[1], inline[2] ?? inline[3]] : dotted ? [table, dotted[1]] : [];
      if (tree && asked.replace(/^[=^~\s]+/, '') !== release) failures.push(`${path} asks for ${tree} "${asked}", and vendor/${tree} is ${release}`);
    }
  }
  for (const path of [...manifests(root), '.cargo/config.toml']) {
    for (const [, url, rev] of (read(root, path) ?? '').matchAll(/git\s*=\s*"([^"]*gpui-kit[^"]*)"[^\n]*?\brev\s*=\s*"([0-9a-f]+)"/g)) {
      if (url !== KIT) failures.push(`${path} takes the toolkit from ${url}, a fork: gpui-kit and gpui-shell come from ${KIT}`);
      revs.set(rev, [...(revs.get(rev) ?? []), path]);
    }
  }
  if (!revs.size) failures.push(`no manifest names a commit of ${KIT}`);
  if (revs.size > 1) failures.push(`gpui-kit and gpui-shell are pinned to ${revs.size} commits: ${[...revs].map(([rev, paths]) => `${rev.slice(0, 12)} in ${[...new Set(paths)].join(', ')}`).join('; ')}`);
  const [rev] = [...revs.keys()];
  for (const name of ['gpui-kit', 'gpui-shell']) {
    const found = lock.filter((each) => each.name === name);
    const want = `git+${KIT}?rev=${rev}#${rev}`;
    if (found.length !== 1) failures.push(`Cargo.lock holds ${found.length} packages named ${name}`);
    else if (rev && found[0].source !== want) failures.push(`Cargo.lock resolves ${name} from ${found[0].source ?? 'a path'}, not from the commit the manifests name (${want})`);
  }
  for (const tree of TREES) {
    if (!RegExp(`^${tree}\\s*=\\s*\\{\\s*path\\s*=\\s*"vendor/${tree}"\\s*\\}`, 'm').test(config)) failures.push(`.cargo/config.toml doesn't put ${tree} on vendor/${tree}`);
  }
  return [...new Set(failures)];
}

/** Fails a test that reads the new pin on a tree that isn't on it, with the pin's own failures. */
export function requireNewPin(root = REPO) {
  const failures = judgePin(root);
  if (failures.length) throw Error(`this tree isn't on the new pin, one release at or past ${FLOOR}:\n${failures.join('\n')}`);
}

// ---------------------------------------------------------------------------------------------------
// The carried-patch table and the retired rows (README: The table's file).

export const CARRIED = '## Carried patches';
export const RETIRED = '## Retired rows';
export const COLUMNS = 'Behavior|Issue|Files|Test|Budget|Removal';
export const RETIRED_COLUMNS = 'Behavior|Issue|Test|Upstream change';

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
/** The first table under `heading` in `text`: its header's cells joined by `|`, and each row's cells; null with no such table. */
function tableUnder(text, heading) {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  if (start < 0) return null;
  const table = [];
  for (let at = start + 1; at < lines.length && !lines[at].startsWith('#'); at += 1) {
    if (lines[at].startsWith('|')) table.push(lines[at]);
    else if (table.length) break;
  }
  return table.length < 2 ? null : { columns: cells(table[0]).join('|'), rows: table.slice(2).map(cells) };
}

/** The carried rows, as scripts/vendor-rebase.mjs reads them; null when the file has no such table. */
export function carriedRows(text) {
  const table = tableUnder(text ?? '', CARRIED);
  if (!table || table.columns !== COLUMNS) return null;
  return table.rows.map(([behavior, issue, files, test, budget, removal]) => ({
    behavior, issue, test: test ?? '', budget: budget ?? '', removal: removal ?? '', files: [...(files ?? '').matchAll(/`([^`]+)`/g)].map(([, file]) => file),
  }));
}

/** The retired rows (README: Retired rows); an empty list when the file has no such section, null when its table has other columns. */
export function retiredRows(text) {
  if (!(text ?? '').split('\n').includes(RETIRED)) return [];
  const table = tableUnder(text, RETIRED);
  if (!table || table.columns !== RETIRED_COLUMNS) return null;
  return table.rows.map(([behavior, issue, test, upstream]) => ({ behavior, issue, test: test ?? '', upstream: upstream ?? '' }));
}

/** A Test cell's file and name: `` `<path> › <name>` ``; null for a cell that names none. */
export function rowTest(cell) {
  const [, path, name] = /^`(.+?) › (.+)`$/.exec(cell ?? '') ?? [];
  return path ? { path, name } : null;
}
export const rowName = (row) => `${row.issue} ${row.behavior}`;
/** Whether a row names a file of one of the three GPUI trees. */
export const inGpui = (row) => row.files.some((file) => TREES.some((tree) => file.startsWith(`vendor/${tree}/`)));

// ---------------------------------------------------------------------------------------------------
// The pinned release, where scripts/vendor-rebase.mjs looks for it: DEEP_VENDOR_RELEASES, else its cache.

/** The folder of `<crate>-<version>` as the registry serves it, or null when this machine holds none. */
export function releaseDir(crate, version) {
  const stub = process.env.DEEP_VENDOR_RELEASES;
  const dir = stub ? join(resolve(stub), `${crate}-${version}`) : join(homedir(), '.cache/deepbuild/vendor-releases', `${crate}-${version}`);
  return existsSync(dir) ? dir : null;
}

// ---------------------------------------------------------------------------------------------------
// The merge base (README: The merge base), read with git and never written.

const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
/** The commit this change is compared with: `git merge-base HEAD origin/main`. BLOCKED when git can't say. */
export function mergeBase(root = REPO) {
  const run = git(root, ['merge-base', 'HEAD', 'origin/main']);
  if (run.status !== 0 || !/^[0-9a-f]{40}$/.test(run.stdout.trim())) blocked(`the merge base can't be read (git merge-base HEAD origin/main): ${clip(`${run.stderr}${run.error?.message ?? ''}`, 600)}`);
  return run.stdout.trim();
}
/** A file as the commit `rev` holds it; BLOCKED when git can't show it. */
export function showAt(root, rev, path) {
  const run = git(root, ['show', `${rev}:${path}`]);
  if (run.status !== 0) blocked(`${path} can't be read at ${rev.slice(0, 12)} (git show): ${clip(run.stderr, 600)}`);
  return run.stdout;
}

// ---------------------------------------------------------------------------------------------------
// The machine (design: The reference Macs). The budgets' own code says what counts: scripts/benchmark.mjs.

const benchmark = () => import(pathToFileURL(join(REPO, 'scripts/benchmark.mjs')).href);
/** The one-minute load, as benchmark.mjs's runs carry it at their start and end. */
export const load = () => loadavg()[0];

/**
 * A limit judged as the design judges a timing: five readings after warm-up, by `judgeLimit` of scripts/benchmark.mjs,
 * on the machine `fingerprint()` reads. `loads` is one `{start, end}` per reading.
 */
export async function judgeLimit(limit, runs, loads) {
  const { judgeLimit: judge, fingerprint } = await benchmark();
  return judge({ limit, runs, fingerprint: fingerprint(), loads });
}

/** Why a time read on this machine now is a reading and no result, in judgeLimit's own words; null on a fit reference Mac at rest. */
export async function timingProblem() {
  const now = load();
  const verdict = await judgeLimit(1, [0, 0, 0, 0, 0], Array.from({ length: 5 }, () => ({ start: now, end: now })));
  return verdict.status === 'PASS' ? null : verdict.reason;
}
/** The reference Macs' models, from scripts/benchmark.mjs. */
export const referenceModels = async () => (await benchmark()).references.map(({ model }) => model);

// ---------------------------------------------------------------------------------------------------
// The binaries a file drives (docs/parallel-proof.md, Binaries for tests): from DEEP_BIN_DIR when a proof run gives
// it, else this checkout's own build, made by the file that needs it. A binary that isn't there is BLOCKED.

const CARGO_ENV = { CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0' };
const built = new Map();
/** The debug build of the workspace binary `name`: `cargo build --locked --bin <name>`, once per process. */
export function debugBinary(name) {
  if (built.has(name)) return built.get(name);
  const supplied = process.env.DEEP_BIN_DIR;
  const path = join(supplied === undefined ? join(REPO, 'target', 'debug') : resolve(supplied), name);
  if (supplied === undefined) {
    const run = spawnSync('cargo', ['build', '--locked', '--bin', name], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, ...CARGO_ENV } });
    if (run.error) blocked(`cargo could not run: ${run.error.message}`);
    if (run.status !== 0) blocked(`cargo build --locked --bin ${name} failed:\n${clip(tilde(run.stderr.split('\n').filter((line) => !/Blocking waiting|Compiling|Finished|Download/.test(line)).join('\n')), 4000)}`);
  } else if (supplied.trim() === '') blocked('DEEP_BIN_DIR is empty');
  try { accessSync(path, constants.X_OK); } catch { blocked(`the binary ${name} isn't at ${tilde(path)}`); }
  built.set(name, path);
  return path;
}
/** The release build of `name`, for a criterion that names a time: `cargo build --locked --release --bin <name>`. */
export function releaseBinary(name) {
  const key = `release ${name}`;
  if (built.has(key)) return built.get(key);
  const run = spawnSync('cargo', ['build', '--locked', '--release', '--bin', name], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (run.error) blocked(`cargo could not run: ${run.error.message}`);
  if (run.status !== 0) blocked(`cargo build --locked --release --bin ${name} failed:\n${clip(tilde(run.stderr.split('\n').filter((line) => !/Blocking waiting|Compiling|Finished|Download/.test(line)).join('\n')), 4000)}`);
  const path = join(REPO, 'target', 'release', name);
  try { accessSync(path, constants.X_OK); } catch { blocked(`the binary ${name} isn't at ${tilde(path)}`); }
  built.set(key, path);
  return path;
}
/** A binary a variable names by its path (README: The merge base); BLOCKED, naming the variable, when it names none. */
export function givenBinary(variable, what) {
  const path = process.env[variable];
  if (!path) blocked(`${variable} is unset: it carries the path of ${what} (README: The merge base)`);
  try { accessSync(path, constants.X_OK); } catch { blocked(`${variable} names ${tilde(path)}, which is missing or not executable`); }
  return path;
}
