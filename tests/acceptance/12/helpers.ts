// Shared by #12's acceptance tests (README.md). Every test reaches the work only through the surfaces the issue names:
// `scripts/preflight`, `npm run release:check`, `benchmarks/budgets.json` and the benchmark harness's report (the
// perf lane's lines in the preflight's output), README.md's quick start with `npm install`, `npm run build` and
// `npm link`, and the repository tree. Nothing here imports the code under test.
//
// A box is one test's sandbox under the system temporary folder:
//
//   <box>/home         HOME, so the throttle table, lane records and perf's kept copies are the box's own
//   <box>/tmp          TMPDIR for every process the test starts
//   <box>/bin          stand-ins first on PATH: cargo and npm (fixtures), or a pass-through cargo (the quick start)
//   <box>/modules      a node_modules of links to an installed node_modules, with caches of its own and a vitest
//                      wrapper (below)
//   <box>/repo         the fixture checkout: this checkout's scripts/ and package.json, a small workspace, a git
//                      repository whose origin/main is its first commit, and the change written over it uncommitted
//   <box>/ran.jsonl    one line per stand-in run: what it stood for, its arguments, its folder and DEEP_PREFLIGHT
//   <box>/control.json rules that make a stand-in print and fail, so a test can plant a lane's failure
//
// A fixture's preflight runs under a build grant of the box's own throttle table, so its timed request is nested and
// starts at any load (docs/parallel-proof.md, section 6); no test waits for a quiet machine.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The checkout these tests are in: the change, a twin laid over it, or the merge base with these tests. */
export const ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));

// Each criterion's tag: `#12.<first 8 hex digits of the SHA-256 of its text, trimmed, white space collapsed>`.
export const AC1 = 'AC1 #12.f47db3bd';
export const AC2 = 'AC2 #12.2bd67310';
export const AC3 = 'AC3 #12.db1eb90a';
export const AC4 = 'AC4 #12.df90b3f0';
export const AC5 = 'AC5 #12.f9ab1605';
export const AC6 = 'AC6 #12.80d47cb4';
export const AC7 = 'AC7 #12.f81e4f9f';
export const AC8 = 'AC8 #12.444f9722';

const NODE = process.execPath;
export const MINUTE = 60_000;

/** A missing tool or machine part: the test reads BLOCKED, never a pass or a failure of the work. */
function blocked(what: string): never {
  throw new Error(`BLOCKED ${what}`);
}

/** Node 24.22 or newer runs the tests, as the issue's quick start needs. */
export function needNode(tag: string): void {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major < 24 || (major === 24 && minor < 22)) blocked(`${tag}: the tests run on Node ${process.versions.node}; the quick start needs Node 24.22 or newer first on PATH`);
}

/** An executable named `name` on the caller's PATH or in the given folders, or undefined. */
function findTool(name: string, extra: string[] = []): string | undefined {
  for (const folder of [...(process.env.PATH ?? '').split(delimiter), ...extra]) {
    if (!folder) continue;
    const path = join(folder, name);
    try {
      if (lstatSync(path) && existsSync(path)) return path;
    } catch { /* not here */ }
  }
  return undefined;
}
/** The real npm: the one beside this Node, else the first on PATH. */
export function realNpm(): string {
  const beside = join(dirname(NODE), 'npm');
  return existsSync(beside) ? beside : findTool('npm') ?? blocked('npm: no npm beside this Node or on PATH');
}
/** The real cargo, through rustup, so rust-toolchain.toml's pin chooses the compiler. */
export function realCargo(tag: string): string {
  return findTool('cargo', ['/opt/homebrew/opt/rustup/bin', join(homedir(), '.cargo/bin')]) ?? blocked(`${tag}: cargo: no cargo on PATH, in /opt/homebrew/opt/rustup/bin or in ~/.cargo/bin; install rustup`);
}
/** The user's npm cache, so installs read it instead of the network. */
let cache: string | undefined;
function npmCache(): string {
  if (cache) return cache;
  const asked = spawnSync(realNpm(), ['config', 'get', 'cache'], { encoding: 'utf8', timeout: MINUTE });
  cache = asked.status === 0 && asked.stdout.trim() ? asked.stdout.trim() : join(homedir(), '.npm');
  return cache;
}

// ---- Boxes

export interface Box { dir: string; home: string; tmp: string; bin: string; modules: string; repo: string; log: string; control: string }
const made: string[] = [];

export function makeBox(prefix: string): Box {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `deep-12-${prefix}-`)));
  made.push(dir);
  const box = { dir, home: join(dir, 'home'), tmp: join(dir, 'tmp'), bin: join(dir, 'bin'), modules: join(dir, 'modules'), repo: join(dir, 'repo'), log: join(dir, 'ran.jsonl'), control: join(dir, 'control.json') };
  for (const folder of [box.home, box.tmp, box.bin, box.repo]) mkdirSync(folder, { recursive: true });
  writeFileSync(box.log, '');
  writeFileSync(box.control, '{ "rules": [] }\n');
  return box;
}
/** Removes every box this file made. Its processes were started by spawnSync, so they have ended or been stopped. */
export function removeBoxes(): void {
  for (const dir of made.splice(0)) {
    try {
      chmodTree(dir);
      rmSync(dir, { recursive: true, force: true });
    } catch { /* the system's temporary folder takes what is left */ }
  }
}
// npm and cargo can leave read-only folders behind; make them writable so they go.
function chmodTree(dir: string): void {
  spawnSync('chmod', ['-R', 'u+w', dir], { stdio: 'ignore' });
}

/** The environment of every process a box's test starts: its own HOME and TMPDIR, stand-ins first, nothing inherited. */
export function boxEnv(box: Box, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    HOME: box.home,
    USER: process.env.USER ?? 'fixture',
    LOGNAME: process.env.LOGNAME ?? process.env.USER ?? 'fixture',
    SHELL: '/bin/sh',
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    TMPDIR: box.tmp,
    XDG_CACHE_HOME: join(box.home, '.cache'),
    PATH: [box.bin, dirname(NODE), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter),
    // As scripts/preflight.mjs gives its lanes: the user's toolchains, never a download into the box's HOME.
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'),
    CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), '.cargo'),
    GIT_CONFIG_NOSYSTEM: '1',
    npm_config_cache: npmCache(),
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    npm_config_logs_dir: join(box.home, '.npm-logs'),
    DEEP12_LOG: box.log,
    DEEP12_CONTROL: box.control,
    DEEP12_MODULES: box.modules,
    ...extra,
  };
}

export interface Ran { status: number | null; signal: NodeJS.Signals | null; out: string; ms: number; timedOut: boolean }
/**
 * Runs a command in its own process group and waits for it; past `timeout` the whole group is stopped by its PID.
 * `out` is stdout then stderr.
 */
export function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeout: number): Ran {
  const started = performance.now();
  const result: SpawnSyncReturns<string> = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout, killSignal: 'SIGKILL', detached: true, maxBuffer: 512 * 1024 * 1024 });
  const ms = performance.now() - started;
  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  if (result.pid) {
    try {
      process.kill(-result.pid, 'SIGKILL');
    } catch { /* the group has ended */ }
  }
  const out = `${result.stdout ?? ''}${result.stderr ? `\n${result.stderr}` : ''}${result.error ? `\n${result.error.message}` : ''}`;
  return { status: result.status, signal: result.signal, out, ms, timedOut };
}
export const shown = (ran: Ran, limit = 30_000): string => `exit ${ran.status}${ran.signal ? ` (${ran.signal})` : ''} after ${(ran.ms / 1000).toFixed(1)} s${ran.timedOut ? ', stopped at its timeout' : ''}; output${ran.out.length > limit ? ` (last ${limit} characters)` : ''}:\n${ran.out.slice(-limit)}`;

// ---- A clean checkout

/** The files of this checkout git lists (tracked and untracked but not ignored) that exist on disk. */
export function listed(root = ROOT): string[] {
  const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (result.status !== 0) blocked(`git ls-files: this checkout's files can't be listed: ${result.stderr}`);
  return [...new Set(result.stdout.split('\0').filter(Boolean))].filter((path) => {
    try {
      const stat = lstatSync(join(root, path));
      return stat.isFile() || stat.isSymbolicLink();
    } catch {
      return false;
    }
  });
}
/** One file or link copied, a clone where the file system can, with its mode. */
function put(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  const stat = lstatSync(from);
  if (stat.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
  else {
    copyFileSync(from, to, constants.COPYFILE_FICLONE);
    chmodSync(to, stat.mode & 0o777);
  }
}
/**
 * A clean checkout of this one at `to`: the files git lists, as they are on disk, and nothing it ignores, so no
 * node_modules, dist/ or target/ comes along.
 */
export function cleanCheckout(to: string): string[] {
  const files = listed();
  for (const path of files) put(join(ROOT, path), join(to, path));
  return files;
}
/**
 * A clean checkout at <box>/clean, then `npm install` there with the real npm, as the quick start runs it. The install
 * reads the user's npm cache first (prefer-offline); its HOME is the box's.
 */
export function cleanInstall(box: Box, timeout: number): { clean: string; install: Ran } {
  const clean = join(box.dir, 'clean');
  cleanCheckout(clean);
  const install = run(realNpm(), ['install'], clean, boxEnv(box, { npm_config_prefer_offline: 'true' }), timeout);
  return { clean, install };
}

// ---- The fixture checkout

/**
 * What the fixture keeps real and what it stands in for. Real: scripts/preflight, and preflight.mjs, checks.mjs and
 * perf.mjs with every file of scripts/ they reach by an import or a path relative to themselves. Stood in for: every
 * `scripts/<name>.mjs` and `benchmarks/<name>.mjs` those real files name as a command to run, which are the lanes'
 * own check programs (a lint, a corpus check, the proof lane, a live suite's bench). A stand-in for a file a real
 * one imports keeps that file's exports.
 */
function standIns(scripts = join(ROOT, 'scripts')): { real: Set<string>; stood: Map<string, boolean> } {
  const names = new Set(readdirSync(scripts));
  const real = new Set(['preflight', 'preflight.mjs', 'checks.mjs', 'perf.mjs'].filter((name) => names.has(name)));
  const imported = new Set<string>();
  const commands = new Set<string>();
  const queue = [...real];
  while (queue.length) {
    const name = queue.shift()!;
    if (!/\.m?js$/.test(name)) continue;
    const text = readFileSync(join(scripts, name), 'utf8');
    for (const [, , path] of text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*)(['"])\.\/([\w.-]+)\1/g)) if (path) imported.add(path);
    for (const [, , path] of text.matchAll(/(['"`])(?:\.\/)?([\w.-]+)\1/g)) {
      if (path && names.has(path) && !real.has(path)) {
        real.add(path);
        queue.push(path);
      }
    }
    for (const [, , path] of text.matchAll(/(['"`])((?:scripts|benchmarks)\/[\w.-]+\.mjs)\1/g)) if (path) commands.add(path);
  }
  const stood = new Map<string, boolean>();
  for (const path of commands) {
    const name = path.slice(path.indexOf('/') + 1);
    if (path.startsWith('scripts/') && ['checks.mjs', 'perf.mjs', 'preflight.mjs'].includes(name)) continue;
    stood.set(path, path.startsWith('scripts/') && imported.has(name));
  }
  return { real, stood };
}

// One stand-in's record and its planted outcome, shared by every stand-in through <box>/bin/standin.mjs.
const STANDIN = `import { appendFileSync, readFileSync } from 'node:fs';
/** Records this run and returns the first rule of <box>/control.json that matches it: { tool, has: [args], out, err, exit }. */
export function stand(tool, args) {
  try {
    appendFileSync(process.env.DEEP12_LOG, JSON.stringify({ tool, args, cwd: process.cwd(), preflight: process.env.DEEP_PREFLIGHT ?? null }) + '\\n');
  } catch {}
  let rules = [];
  try { rules = JSON.parse(readFileSync(process.env.DEEP12_CONTROL, 'utf8')).rules ?? []; } catch {}
  const rule = rules.find((r) => r.tool === tool && (r.has ?? []).every((arg) => args.includes(arg)));
  if (rule?.out) process.stdout.write(rule.out + '\\n');
  if (rule?.err) process.stderr.write(rule.err + '\\n');
  return rule;
}
`;

const scriptStandIn = (tool: string, standin: string, keeps?: string): string => `// Stand-in for ${tool}, a lane's own check program, in #12's fixture (tests/acceptance/12/helpers.ts).
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
${keeps ? `export * from './${keeps}';\n` : ''}if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const { stand } = await import(${JSON.stringify(standin)});
  const rule = stand(${JSON.stringify(tool)}, process.argv.slice(2));
  process.exitCode = rule?.exit ?? 0;
}
`;

// cargo, first on PATH in a fixture: records its run and does nothing, but for a build of a named binary, which it
// leaves in the target folder as an executable that exits 0, as a build would.
const CARGO = (standin: string) => `import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stand } from ${JSON.stringify(standin)};
const args = process.argv.slice(2);
const rule = stand('cargo', args);
if (rule) process.exit(rule.exit ?? 0);
const at = args.indexOf('--bin');
if (args[0] === 'build' && at >= 0) {
  const folder = join(process.env.CARGO_TARGET_DIR || 'target', 'debug');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, args[at + 1]), '#!/bin/sh\\nexit 0\\n');
  chmodSync(join(folder, args[at + 1]), 0o755);
}
`;
// npm, first on PATH in a fixture: an install links the box's node_modules into the folder, as perf's copies need;
// anything else records its run and does nothing.
const NPM = (standin: string) => `import { existsSync, symlinkSync } from 'node:fs';
import { stand } from ${JSON.stringify(standin)};
const args = process.argv.slice(2);
const rule = stand('npm', args);
if (rule) process.exit(rule.exit ?? 0);
if ((args[0] === 'ci' || args[0] === 'install') && !existsSync('node_modules')) symlinkSync(process.env.DEEP12_MODULES, 'node_modules');
`;
// vitest, at node_modules/vitest/vitest.mjs: every run goes to the real vitest but one whose --root names a folder the
// fixture doesn't hold (the real repo's live and Lean suites), which records itself and exits 0.
const VITEST = (standin: string, real: string) => `import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { stand } from ${JSON.stringify(standin)};
const args = process.argv.slice(2);
const at = args.findIndex((arg) => arg === '--root' || arg.startsWith('--root='));
const folder = at < 0 ? null : args[at].startsWith('--root=') ? args[at].slice(7) : args[at + 1];
const rule = stand('vitest', args);
if (rule) process.exit(rule.exit ?? 0);
if (folder && !existsSync(resolve(folder))) {
  console.log('fixture: the fixture holds no suite at ' + folder + ', so this run ran nothing');
  process.exit(0);
}
await import(${JSON.stringify(real)});
`;

const shim = (script: string) => `#!/bin/sh\nexec ${JSON.stringify(NODE)} ${JSON.stringify(script)} "$@"\n`;
function writeFile(path: string, content: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  if (mode) chmodSync(path, mode);
}

/** <box>/modules: a link to each package of `source`, a vitest of links with the wrapper, and caches of its own. */
function linkModules(box: Box, source: string): void {
  if (!existsSync(join(source, 'vitest/vitest.mjs')) || !existsSync(join(source, 'typescript/bin/tsc'))) blocked(`node_modules: ${source} has no vitest or typescript; run npm ci once`);
  mkdirSync(box.modules, { recursive: true });
  for (const name of readdirSync(source)) {
    if (name.startsWith('.') && name !== '.bin') continue;
    if (name === 'vitest') continue;
    symlinkSync(join(source, name), join(box.modules, name));
  }
  const vitest = realpathSync(join(source, 'vitest'));
  mkdirSync(join(box.modules, 'vitest'));
  for (const name of readdirSync(vitest)) if (name !== 'vitest.mjs') symlinkSync(join(vitest, name), join(box.modules, 'vitest', name));
  writeFile(join(box.modules, 'vitest/vitest.mjs'), VITEST(join(box.bin, 'standin.mjs'), join(vitest, 'vitest.mjs')));
  mkdirSync(join(box.modules, '.vite'));
}

// cargo, first on PATH for the quick start: passes every run to the real cargo, except that `cargo build --workspace`
// builds the workspace's deep-hook package alone (README.md, The quick start, says why).
const PASS_THROUGH_CARGO = (standin: string, real: string) => `import { spawnSync } from 'node:child_process';
import { stand } from ${JSON.stringify(standin)};
const args = process.argv.slice(2);
stand('cargo', args);
const narrowed = args[0] === 'build' && args.includes('--workspace') ? args.flatMap((arg) => (arg === '--workspace' ? ['-p', 'deep-hook'] : [arg])) : args;
const ran = spawnSync(${JSON.stringify(real)}, narrowed, { stdio: 'inherit' });
process.exit(ran.status ?? 1);
`;
/** The quick start's cargo: the real one, with a workspace build narrowed to deep-hook. */
export function writePassThroughCargo(box: Box, real: string): void {
  writeFile(join(box.bin, 'standin.mjs'), STANDIN);
  writeFile(join(box.bin, 'cargo.mjs'), PASS_THROUGH_CARGO(join(box.bin, 'standin.mjs'), real));
  writeFile(join(box.bin, 'cargo'), shim(join(box.bin, 'cargo.mjs')), 0o755);
}

/** The stand-ins first on PATH and the shared recorder. */
function writeStandIns(box: Box): void {
  writeFile(join(box.bin, 'standin.mjs'), STANDIN);
  writeFile(join(box.bin, 'cargo.mjs'), CARGO(join(box.bin, 'standin.mjs')));
  writeFile(join(box.bin, 'cargo'), shim(join(box.bin, 'cargo.mjs')), 0o755);
  writeFile(join(box.bin, 'npm.mjs'), NPM(join(box.bin, 'standin.mjs')));
  writeFile(join(box.bin, 'npm'), shim(join(box.bin, 'npm.mjs')), 0o755);
}

export interface Rule { tool: string; has?: string[]; out?: string; err?: string; exit?: number }
/** Plants each rule: the first rule matching a stand-in's run prints its lines and gives its exit. */
export function plant(box: Box, rules: Rule[]): void {
  writeFileSync(box.control, `${JSON.stringify({ rules }, null, 2)}\n`);
}

export interface Budgets { preflight?: unknown; tasks: unknown[] }
export interface FixtureOptions {
  /** The checkout whose scripts/ and package.json the fixture takes: this one, or a clean checkout of it. */
  from?: string;
  /** The node_modules the fixture links to. */
  modules?: string;
  /** benchmarks/budgets.json at the merge base and in the change. */
  budgets: { base: Budgets; change: Budgets };
  /** Files committed at the merge base, path to text. */
  base?: Record<string, string>;
  /** Files the change writes over the merge base, uncommitted, path to text. */
  change?: Record<string, string>;
}

const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main'];
function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in the fixture: ${result.stderr}`);
  return result.stdout;
}

/** The preflight budget a checkout declares, which a fixture holds its checks to unless a test sets its own. */
export function declaredPreflightBudget(root = ROOT): unknown {
  const budgets = JSON.parse(readFileSync(join(root, 'benchmarks/budgets.json'), 'utf8')) as { preflight?: unknown };
  return budgets.preflight;
}

/** A fixture workspace small enough for every lane to run in seconds: one TypeScript package and one test per runner. */
const WORKSPACE: Record<string, string> = {
  'tsconfig.json': `${JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: true, types: [] }, include: ['packages/**/*.ts'] }, null, 2)}\n`,
  'packages/fixture/package.json': `${JSON.stringify({ name: '@fixture/one', version: '0.0.0', private: true, type: 'module', scripts: { build: 'tsc -p ../../tsconfig.json' } }, null, 2)}\n`,
  'packages/fixture/src/index.ts': 'export const answer: number = 42;\n',
  // The fixture runs no suite of the real repo's alone list, so an alone block with nothing to run passes.
  'vitest.config.ts': "export default { test: { include: ['tests/**/*.test.ts', 'packages/**/*.test.ts'], passWithNoTests: true } };\n",
  'tests/fixture.test.ts': `import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('fixture passes', () => {
  writeFileSync('vitest-ran', 'yes');
  expect(1 + 1).toBe(2);
});
`,
  'tests/fixture.test.mjs': `import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import test from 'node:test';

test('fixture passes under node --test', () => {
  writeFileSync('node-test-ran', 'yes');
  assert.equal(1 + 1, 2);
});
`,
  '.gitignore': 'node_modules\ntarget\ndist\nvitest-ran\nnode-test-ran\nbench/*.count\n',
};

/** Builds <box>/repo: commits the merge base, points origin/main at it, and writes the change over it. */
export function fixture(box: Box, options: FixtureOptions): void {
  const from = options.from ?? ROOT;
  writeStandIns(box);
  linkModules(box, options.modules ?? join(ROOT, 'node_modules'));
  const scripts = join(from, 'scripts');
  const { stood } = standIns(scripts);
  // This checkout's scripts/ whole, then each lane's own program stood in for.
  for (const name of readdirSync(scripts)) {
    const from = join(scripts, name);
    if (lstatSync(from).isDirectory()) continue;
    put(from, join(box.repo, 'scripts', name));
  }
  const standin = join(box.bin, 'standin.mjs');
  for (const [path, keepsExports] of stood) {
    const target = join(box.repo, path);
    let keeps: string | undefined;
    if (keepsExports && existsSync(target)) {
      keeps = path.slice(path.indexOf('/') + 1).replace(/\.mjs$/, '.kept.mjs');
      renameSync(target, join(dirname(target), keeps));
    }
    writeFile(target, scriptStandIn(path, standin, keeps));
  }
  put(join(from, 'package.json'), join(box.repo, 'package.json'));
  const files: Record<string, string> = { ...WORKSPACE, 'benchmarks/budgets.json': `${JSON.stringify(options.budgets.base, null, 2)}\n`, ...options.base };
  for (const [path, text] of Object.entries(files)) writeFile(join(box.repo, path), text);
  symlinkSync(box.modules, join(box.repo, 'node_modules'));
  git(box.repo, 'init', '-q');
  git(box.repo, 'add', '-A');
  git(box.repo, 'commit', '-qm', 'merge base');
  git(box.repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const change: Record<string, string> = { ...options.change };
  if (JSON.stringify(options.budgets.change) !== JSON.stringify(options.budgets.base)) change['benchmarks/budgets.json'] = `${JSON.stringify(options.budgets.change, null, 2)}\n`;
  for (const [path, text] of Object.entries(change)) writeFile(join(box.repo, path), text);
}

/**
 * A command in the fixture under a build grant of the box's own throttle table (`scripts/throttle.mjs build -- ...`,
 * docs/parallel-proof.md section 6). The preflight's timed request is then nested, which starts at any load; a
 * top-level one would wait for the machine's load to fall under its core count, up to an hour on a shared Mac.
 */
function granted(box: Box, command: string, args: string[], timeout: number, extra: Record<string, string> = {}): Ran {
  return run(NODE, [join(box.repo, 'scripts/throttle.mjs'), 'build', '--', command, ...args], box.repo, boxEnv(box, extra), timeout);
}
/** `scripts/preflight` in the fixture, as a person runs it, with DEEP_PREFLIGHT as given. */
export function preflight(box: Box, timeout: number, extra: Record<string, string> = {}): Ran {
  return granted(box, join(box.repo, 'scripts/preflight'), [], timeout, extra);
}
/** `npm run <script>` in the fixture through the real npm; the stand-ins stay first on PATH for what it starts. */
export function npmRun(box: Box, script: string, timeout: number): Ran {
  return granted(box, realNpm(), ['run', script], timeout);
}

export interface StandInRun { tool: string; args: string[]; cwd: string; preflight: string | null }
/** Every stand-in run the box recorded since the log was last cleared. */
export function ranLog(box: Box): StandInRun[] {
  return readFileSync(box.log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as StandInRun);
}
export function clearLog(box: Box): void {
  writeFileSync(box.log, '');
}

// ---- Reading the preflight's output

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The lanes named by a `RUN <lane>` line, in order. */
export const started = (out: string): string[] => [...out.matchAll(/^RUN (.+?)\s*$/gm)].map(([, name]) => name!);
/** The lanes named by a `SKIP <lane>: ...` line, in order. */
export const skipped = (out: string): string[] => [...out.matchAll(/^SKIP (.+?): /gm)].map(([, name]) => name!);
/** Whether a lane reads PASS: a `PASS <lane>` line, alone or with its time. */
export const passed = (out: string, lane: string): boolean => new RegExp(`^PASS ${escape(lane)}(?: \\(|\\s*$)`, 'm').test(out);
/** Lines that report a state below PASS, of any lane or check. */
export const notPassing = (out: string): string[] => out.split('\n').filter((line) => /^(FAIL|BLOCKED|INCONCLUSIVE|INVALID)\b/.test(line));

/**
 * The report of a lane in a state below PASS: its first line `<STATE> <lane>...` and the indented lines under it,
 * or undefined when the output has none.
 */
export function report(out: string, lane: string): { state: string; text: string } | undefined {
  const lines = out.split('\n');
  const head = new RegExp(`^(FAIL|BLOCKED|INCONCLUSIVE|INVALID) ${escape(lane)}(?: \\([^)]*\\))?(?::|\\s*$)`);
  const at = lines.findIndex((line) => head.test(line));
  if (at < 0) return undefined;
  const block = [lines[at]!];
  for (const line of lines.slice(at + 1)) {
    if (!/^\s+\S/.test(line)) break;
    block.push(line);
  }
  return { state: head.exec(lines[at]!)![1]!, text: block.join('\n') };
}

// ---- Benchmark tasks

/**
 * A benchmark task's program, bench/<id>.mjs: it records each run in the box's log with the folder it ran in, and
 * sleeps `ms` on every run, or, with `every`, on one run in each `every` (the fifth of each ten for 10), so any 20
 * runs in a row hold two slow ones. Sleeping adds time and next to no instructions.
 */
export function benchProgram(id: string, ms = 0, every = 1): string {
  return `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const count = new URL('./${id}.count', import.meta.url);
let n = 0;
try { n = Number(readFileSync(count, 'utf8')) || 0; } catch {}
n += 1;
writeFileSync(count, String(n));
try { appendFileSync(process.env.DEEP12_LOG, JSON.stringify({ tool: 'bench/${id}', args: [String(n)], cwd: process.cwd(), preflight: null }) + '\\n'); } catch {}
if (${ms} > 0 && n % ${every} === ${every === 1 ? 0 : Math.floor(every / 2)}) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms});
`;
}
/** A task of benchmarks/budgets.json that runs bench/<id>.mjs with Node. */
export function benchTask(id: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, command: ['node', `bench/${id}.mjs`], margin: 0.5, limits: {}, initialReason: `Fixture task ${id}: a Node program that does nothing, timed against the merge base.`, ...fields };
}
/** How many times each folder ran bench/<id>.mjs. */
export function benchRuns(box: Box, id: string): Map<string, number> {
  const runs = new Map<string, number>();
  for (const { tool, cwd } of ranLog(box)) if (tool === `bench/${id}`) runs.set(cwd, (runs.get(cwd) ?? 0) + 1);
  return runs;
}

/** The first number under a key matching `key` in an object, or undefined. */
export function reading(side: unknown, key: RegExp): number | undefined {
  if (!side || typeof side !== 'object') return undefined;
  for (const [name, value] of Object.entries(side)) if (key.test(name) && typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}
/** A report's side: the change's (`current`, or `change`) or the merge base's (`base`). */
export function sideOf(report: Record<string, unknown>, which: 'change' | 'base'): Record<string, unknown> | undefined {
  const names = which === 'change' ? ['current', 'change', 'head'] : ['base', 'mergeBase', 'merge_base'];
  for (const name of names) {
    const value = report[name];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return undefined;
}
/** Lines reporting a FAIL, BLOCKED or INVALID that name `word` as a whole word. */
export function refusals(out: string, word: string): string[] {
  const named = new RegExp(`(^|[^\\w-])${escape(word)}([^\\w-]|$)`);
  return out.split('\n').filter((line) => /^(FAIL|BLOCKED|INVALID)\b/.test(line) && named.test(line));
}

/** The JSON lines of the output that report a benchmark task, by its id. */
export function taskReports(out: string, id: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const line of out.split('\n')) {
    if (!line.startsWith('{') || !line.includes(id)) continue;
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      if (value.task === id || value.id === id) found.push(value);
    } catch { /* not a report */ }
  }
  return found;
}
