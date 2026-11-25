// Helpers for #3239's acceptance tests (README: The sandbox). A sandbox is a folder of the test's own: its HOME, its own
// cargo home whose config names a wrapper that logs each call, a cargo first on PATH that logs each call and runs the
// pinned toolchain's real cargo, and stand-ins for what the repo doesn't own (npm, gh, the hub's lease, osascript, the
// machine's load). The fixture is a git repository with a two-crate cargo workspace and this checkout's scripts/. Nothing
// here imports the code under test: every script is reached by running it.
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir, userInfo } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const OWNER_HOME = userInfo().homedir;

// The pinned toolchain's own cargo, by its folder, so no rustup proxy runs under a HOME of the test's own (where it
// would download the pin) and cargo-clippy and rustc are found beside it.
let pinned;
export function toolchain() {
  if (pinned) return pinned;
  const channel = /^\s*channel\s*=\s*"([^"]+)"/m.exec(readFileSync(join(CHECKOUT, 'rust-toolchain.toml'), 'utf8'))?.[1];
  if (!channel) throw Error('BLOCKED: rust-toolchain.toml names no channel');
  const rustupHome = process.env.RUSTUP_HOME || join(OWNER_HOME, '.rustup');
  const cargoHome = process.env.CARGO_HOME || join(OWNER_HOME, '.cargo');
  const rustups = [...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map((dir) => join(dir, 'rustup')),
    join(cargoHome, 'bin', 'rustup'), '/opt/homebrew/opt/rustup/bin/rustup', '/usr/local/opt/rustup/bin/rustup'];
  const env = { PATH: '/usr/bin:/bin', HOME: OWNER_HOME, RUSTUP_HOME: rustupHome, CARGO_HOME: cargoHome, RUSTUP_TOOLCHAIN: channel, RUSTUP_AUTO_INSTALL: '0' };
  for (const rustup of rustups.filter((path) => existsSync(path))) {
    try {
      const cargo = execFileSync(rustup, ['which', '--toolchain', channel, 'cargo'], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000 }).trim();
      if (existsSync(cargo)) return (pinned = { channel, rustupHome, bin: dirname(cargo) });
    } catch {}
  }
  throw Error(`BLOCKED: the pinned toolchain ${channel} (rust-toolchain.toml) has no cargo under ${redactHome(rustupHome)}; install it with rustup`);
}

const redactHome = (text) => String(text).replaceAll(OWNER_HOME, '~');
// perf names its kept copies by the machine's name, which a message never carries.
const HOST = hostname().split('.')[0].replace(/[^\w-]/g, '_');
/** Text for a message: the sandbox as <sandbox>, any home folder as ~, the machine's name as <host>. */
export const redact = (box, text) => {
  const said = redactHome(String(text).replaceAll(box.home, '~').replaceAll(box.dir, '<sandbox>'));
  return HOST.length > 3 ? said.replaceAll(HOST, '<host>') : said;
};

const script = (path, content) => {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
};

// The load is the OS's and shared with every session here; a top-level timed grant (perf, the preflight) and a window
// wait for it to fall under the cores. So each node process in a sandbox reads a pinned one.
const LOAD = `import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
const pinned = Number(process.env.T3239_LOAD);
os.loadavg = () => [pinned, pinned, pinned];
syncBuiltinESMExports();
`;

// benchmark.mjs is a module: its own cargos are warm()'s, which perf and the window reach through prepareCopy and the
// preflight calls directly. This starts it alone, with no other script in the process.
const WARM = `import { pathToFileURL } from 'node:url';
const [benchmark, cwd] = process.argv.slice(2);
const { warm } = await import(pathToFileURL(benchmark).href);
warm(cwd);
`;

/**
 * A sandbox removed after the test: HOME, caches, TMPDIR and CARGO_HOME of its own. Its cargo home's config.toml names
 * the logging wrapper as the machine's rustc-wrapper, as section 4 has a machine's. Every process it started is stopped
 * by its process group's PID.
 */
export function sandbox(t) {
  const tc = toolchain();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3239-')));
  const home = join(dir, 'home'), bin = join(dir, 'bin'), cargoHome = join(dir, 'cargo-home'), temp = join(dir, 'tmp');
  for (const folder of [home, bin, cargoHome, temp]) mkdirSync(folder);
  const wrapperLog = join(dir, 'wrapper.log'), cargoLog = join(dir, 'cargo.log');
  writeFileSync(wrapperLog, '');
  writeFileSync(cargoLog, '');
  // The wrapper: one line a call (the cargo that called it, the crate it compiles, the tool), then the call itself.
  script(join(dir, 'log-wrapper'), `#!/bin/sh
crate=-
prev=
for arg in "$@"; do
  if [ "$prev" = --crate-name ]; then crate=$arg; fi
  prev=$arg
done
printf '%s\\t%s\\t%s\\n' "\${T3239_CARGO:-none}" "$crate" "\${1##*/}" >> '${wrapperLog}'
exec "$@"
`);
  writeFileSync(join(cargoHome, 'config.toml'), `[build]\nrustc-wrapper = "${join(dir, 'log-wrapper')}"\n`);
  // The cargo every script finds on PATH: it notes the call, where, and the wrapper settings it was given, then becomes
  // the real cargo, so the cargo's process ID is the one the wrapper's lines carry.
  script(join(bin, 'cargo'), `#!/bin/sh
w=unset; [ "\${RUSTC_WRAPPER+set}" = set ] && w="=$RUSTC_WRAPPER"
b=unset; [ "\${CARGO_BUILD_RUSTC_WRAPPER+set}" = set ] && b="=$CARGO_BUILD_RUSTC_WRAPPER"
d=unset; [ "\${CARGO_TARGET_DIR+set}" = set ] && d="=$CARGO_TARGET_DIR"
printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$$" "$(pwd -P)" "$w" "$b" "$d" "$*" >> '${cargoLog}'
T3239_CARGO=$$
export T3239_CARGO
exec '${join(tc.bin, 'cargo')}' "$@"
`);
  // npm: a fixture has no packages to install or build.
  script(join(bin, 'npm'), '#!/bin/sh\nexit 0\n');
  // gh: nothing here reaches GitHub; a call is noted and refused.
  script(join(bin, 'gh'), `#!/bin/sh\necho "$*" >> '${join(dir, 'gh.log')}'\necho "stand-in gh: no network in this test" >&2\nexit 1\n`);
  // The hub's lease, which scripts/lease asks for when deep is on PATH: the command runs, as an unleased run does.
  script(join(bin, 'deep'), '#!/bin/sh\nif [ "$1" = lease ] && [ "$2" = -- ]; then shift 2; exec "$@"; fi\necho "stand-in deep: no $*" >&2\nexit 2\n');
  // fingerprint() asks NSProcessInfo through osascript for Low Power Mode and the thermal state: off and nominal.
  script(join(bin, 'osascript'), '#!/bin/sh\necho 0\n');
  writeFileSync(join(dir, 'load.mjs'), LOAD);
  writeFileSync(join(dir, 'warm.mjs'), WARM);
  const kept = Object.entries(process.env).filter(([key]) => !/^(?:CARGO_|RUSTC|RUSTUP_|RUSTFLAGS|RUSTDOCFLAGS|GIT_|DEEP_|XDG_|SCCACHE_|NODE_TEST_CONTEXT$|NODE_OPTIONS$|MAKEFLAGS$|MFLAGS$|PWD$|OLDPWD$)/.test(key));
  const env = {
    ...Object.fromEntries(kept),
    HOME: home, XDG_CACHE_HOME: join(home, '.cache'), XDG_CONFIG_HOME: join(home, '.config'), TMPDIR: temp,
    PATH: [bin, tc.bin, dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter),
    CARGO_HOME: cargoHome, RUSTUP_HOME: tc.rustupHome, RUSTUP_TOOLCHAIN: tc.channel, RUSTUP_AUTO_INSTALL: '0',
    NODE_OPTIONS: `--import=${pathToFileURL(join(dir, 'load.mjs')).href}`, T3239_LOAD: '2', GIT_CONFIG_NOSYSTEM: '1',
  };
  const box = { dir, home, bin, env, cargo: join(bin, 'cargo'), warm: join(dir, 'warm.mjs'), wrapperLog, cargoLog, children: [] };
  t.after(() => {
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Starts `argv` in the sandbox in its own process group; `done` resolves with its status and output. */
export function launch(box, argv, { cwd = box.dir, env = {} } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.done = new Promise((done) => {
    child.on('error', (error) => done({ pid: child.pid, status: null, signal: null, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (status, signal) => done({ pid: child.pid, status, signal, stdout, stderr }));
  });
  return child;
}

/** A child's end, or its group stopped by its PID after `ms`: a program that never ends fails at an assertion. */
export function ended(child, ms) {
  // deadline: it only turns a run that never ends into a failure at an assertion; it never waits for time to pass.
  const stop = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, ms);
  return child.done.finally(() => clearTimeout(stop));
}

// The fixture's workspace: two crates, one a library and one a binary using it, with no dependency from a registry, so
// nothing is fetched. Its profiles keep each build cold: `checks` for the check workload, `outside` for a build started
// outside the four scripts.
const WORKSPACE = {
  'Cargo.toml': '[workspace]\nmembers = ["crates/core", "crates/app"]\nresolver = "2"\n\n[profile.checks]\ninherits = "dev"\n\n[profile.outside]\ninherits = "dev"\n',
  'crates/core/Cargo.toml': '[package]\nname = "fixture-core"\nversion = "0.1.0"\nedition = "2021"\n',
  'crates/core/src/lib.rs': 'pub fn answer() -> u32 {\n    42\n}\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn answers() {\n        assert_eq!(super::answer(), 42);\n    }\n}\n',
  'crates/app/Cargo.toml': '[package]\nname = "fixture-app"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nfixture-core = { path = "../core" }\n',
  'crates/app/src/main.rs': 'fn main() {\n    println!("{}", fixture_core::answer());\n}\n',
  'Cargo.lock': '# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n[[package]]\nname = "fixture-app"\nversion = "0.1.0"\ndependencies = [\n "fixture-core",\n]\n\n[[package]]\nname = "fixture-core"\nversion = "0.1.0"\n',
  '.gitignore': 'target/\n',
  // The check workload, as scripts/checks.mjs runs the lanes: here one cargo build, as the unit and lint lanes start.
  'scripts/checks.mjs': `// The fixture's check workload (tests/acceptance/3239): one cargo build, as the check lanes' builds are.
import { spawnSync } from 'node:child_process';
const built = spawnSync('cargo', ['build', '--workspace', '--locked', '--profile', 'checks'], { stdio: 'inherit' });
process.exit(built.status ?? 1);
`,
  // A budget task whose command builds with cargo before it runs, as benchmarks/canvas.mjs and physics.mjs do.
  'bench.mjs': `import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const built = spawnSync('cargo', ['build', '--locked', '--release', '-p', 'fixture-app'], { cwd: fileURLToPath(new URL('.', import.meta.url)), stdio: ['ignore', 'ignore', 'inherit'] });
process.exit(built.status ?? 1);
`,
  'benchmarks/budgets.json': `${JSON.stringify({
    preflight: { margin: 0.5, limits: { elapsedMs: 3_600_000 }, initialReason: 'The fixture for #3239.' },
    tasks: [{ id: 'fixture-build', command: ['node', 'bench.mjs'], margin: 0.5, limits: {}, initialReason: 'The fixture for #3239: a task whose command builds with cargo.' }],
  }, null, 2)}\n`,
};

/**
 * The checkout's own cargo build settings: the [build] table of its .cargo/config.toml, where a repository could turn a
 * wrapper off for every build in it. Its [patch] tables name sources the fixture doesn't have, so they stay out.
 */
function buildTable() {
  const file = join(CHECKOUT, '.cargo', 'config.toml');
  if (!existsSync(file)) return '';
  const lines = readFileSync(file, 'utf8').split('\n');
  const kept = [];
  let inBuild = false;
  for (const line of lines) {
    const header = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(line);
    if (header) inBuild = header[1].trim() === 'build';
    else if (!kept.length && /^\s*build\.[\w-]+\s*=/.test(line)) kept.push(line);
    if (inBuild) kept.push(line);
  }
  return kept.length ? `${kept.join('\n')}\n` : '';
}

const write = (cwd, files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
};
const gitIn = (box, cwd) => (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: box.env, encoding: 'utf8', stdio: 'pipe' }).trim();

/**
 * The fixture repository: `origin`, a bare repository; `root`, its clone holding this checkout's scripts/ (its
 * checks.mjs replaced by the fixture's check workload), the workspace and its budgets, at origin/main.
 */
export function fixture(box) {
  const origin = join(box.dir, 'origin.git'), root = join(box.dir, 'work');
  mkdirSync(origin);
  mkdirSync(root);
  gitIn(box, origin)('init', '-q', '--bare', '-b', 'main');
  const git = gitIn(box, root);
  git('init', '-q', '-b', 'main');
  cpSync(join(CHECKOUT, 'scripts'), join(root, 'scripts'), { recursive: true });
  const channel = toolchain().channel;
  const table = buildTable();
  write(root, { ...WORKSPACE, 'rust-toolchain.toml': `[toolchain]\nchannel = "${channel}"\n`, ...table && { '.cargo/config.toml': table } });
  git('add', '-A');
  git('commit', '-qm', 'The fixture workspace');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return {
    root, origin, git,
    /** One commit on main changing `files`, pushed. */
    push(message, files) {
      write(root, files);
      git('add', '-A');
      git('commit', '-qm', message);
      git('push', '-q', 'origin', 'main');
      return git('rev-parse', 'HEAD');
    },
    /** A clone of origin beside the fixture, as the reference Mac's checkout of main. */
    clone(name) {
      gitIn(box, box.dir)('clone', '-q', origin, join(box.dir, name));
      return join(box.dir, name);
    },
    workspace: (path) => readFileSync(join(root, path), 'utf8'),
  };
}

const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => line.split('\t')) : []);
/** Every cargo started through PATH, in order: its process ID, folder, wrapper settings, target setting and arguments. */
export const cargoCalls = (box) => lines(box.cargoLog).map(([pid, cwd, wrapper, buildWrapper, targetDir, ...args]) => ({ pid, cwd, wrapper, buildWrapper, targetDir, args: args.join('\t') }));
/** Every call of the wrapper: the cargo that made it, the crate (`-` or `___` for cargo's own probes) and the tool. */
export const wrapperCalls = (box) => lines(box.wrapperLog).map(([cargo, crate, tool]) => ({ cargo, crate, tool }));
export const compiles = (calls) => calls.filter(({ crate }) => crate !== '-' && crate !== '___');

const BUILDS = new Set(['build', 'b', 'test', 't', 'check', 'c', 'clippy', 'run', 'r', 'bench', 'doc', 'd', 'rustc', 'rustdoc', 'fix']);
/** A cargo call that compiles: its subcommand is one that builds. */
export const isBuild = (call) => BUILDS.has(call.args.split(/\s+/).find((word) => word && !word.startsWith('-') && !word.startsWith('+')) ?? '');

/** The target folder a call wrote, as cargo picks it: CARGO_TARGET_DIR, else the workspace's target/. */
export function targetOf(call) {
  const named = call.targetDir.startsWith('=') && call.targetDir.length > 1 ? call.targetDir.slice(1) : null;
  const folder = named ? (isAbsolute(named) ? named : resolve(call.cwd, named)) : join(call.cwd, 'target');
  return existsSync(folder) ? realpathSync(folder) : folder;
}
/** How many units cargo compiled into a target folder: its fingerprints, one a unit, in every profile's folder. */
export function unitsIn(target) {
  if (!existsSync(target)) return 0;
  return readdirSync(target).map((profile) => join(target, profile, '.fingerprint')).filter((folder) => existsSync(folder) && statSync(folder).isDirectory()).reduce((sum, folder) => sum + readdirSync(folder).length, 0);
}

/** A cargo build started from the test itself, outside the four scripts, through the same PATH and cargo home. */
export const outsideBuild = (box, cwd, args = ['build', '--workspace', '--locked', '--profile', 'outside']) => ended(launch(box, [box.cargo, ...args], { cwd }), 600_000);

/** A run's end for a message: its exit and the tail of its output. */
export const tail = (box, run) => redact(box, `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\nstdout (tail):\n${run.stdout.slice(-2500)}\nstderr (tail):\n${run.stderr.slice(-2500)}`);
