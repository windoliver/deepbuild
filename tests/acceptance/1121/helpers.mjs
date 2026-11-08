// Helpers for #1121's acceptance tests: a sandboxed HOME (the real ~/.deepbuild is never read or written), the
// machine these run on, a cargo stub for the lanes' runs, a scratch tree the real runLanes runs in, and a TypeScript
// loader for env-local's public entry. Nothing here imports the code under test: every surface is reached by running
// it in a child process, so a missing export reads as an assertion failure, never as an import error.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** A build or a lane run takes minutes on a loaded machine; a hang still ends. */
export const LONG = { timeout: 1_800_000 };
export const MACHINE = `${process.platform}-${process.arch}`;
/** The Spark: Linux on aarch64. The criteria that name it are proven only there. */
export const SPARK = process.platform === 'linux' && process.arch === 'arm64';
/** The note of a test that needs the Spark, as lanes.mjs's isPlatform reads one: never PASS elsewhere. */
export const NOT_SPARK = `INCONCLUSIVE (platform): this criterion is proven only on Linux aarch64 (the Spark); this machine is ${MACHINE}`;
const ENV_OUT = ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_PROOF_ISSUES',
  'DEEP_APPROVERS', 'DEEP_PROOF_VITEST_REPORT', 'DEEP_HUB_PLANT', 'DEEP_REFERENCE_RECORD', 'NODE_OPTIONS'];

/** A sandbox removed after the test, with its own HOME; cargo and rustup keep the real toolchains. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1121-')));
  const home = join(dir, 'home');
  mkdirSync(home);
  const env = {
    ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'),
    CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), '.cargo'), RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'),
  };
  for (const name of ENV_OUT) delete env[name];
  const box = { dir, home, env, children: [] };
  t.after(() => {
    // Only the processes this test started, by their process group's PID.
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Runs `argv` in its own process group; resolves with its status and output. */
export function run(box, argv, { env = {}, cwd = box.dir, input } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  box.children.push(child);
  if (input !== undefined) child.stdin.end(input);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr })));
}

const tail = (text, size = 3_000) => (text.length > size ? `…${text.slice(-size)}` : text);
export const dump = (...runs) => runs.map((r) => `exit ${r.status}${r.signal ? ` (${r.signal})` : ''}\nstdout:\n${tail(r.stdout)}\nstderr:\n${tail(r.stderr, 1_200)}`).join('\n');

// --- The lanes (AC1-AC3) ---------------------------------------------------------------------------------------------

/**
 * A run of the tree's real runLanes on its real `unit` lane, without the vitest and `node --test` commands, whose
 * fixtures this issue doesn't own: so the lane's cargo commands, and any other command the change adds to it.
 */
const DRIVER = `import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [tree] = process.argv.slice(2);
const { checks, runLanes } = await import(pathToFileURL(join(tree, 'scripts/lanes.mjs')).href);
const unit = checks.find(({ name }) => name === 'unit');
const commands = unit.commands.filter(([command, ...args]) => !args.some((arg) => arg.endsWith('vitest.mjs')) && !(command === process.execPath && args[0] === '--test'));
process.exitCode = runLanes([{ ...unit, commands }], { cwd: tree });
`;

/**
 * Makes every node process of a run read the platform T1121_PLATFORM names (\`linux-arm64\`, \`darwin-arm64\`), so one
 * machine runs both halves of AC3. process.platform and os.platform() both read it (README: Two platforms, one machine).
 */
const PLATFORM = `const named = process.env.T1121_PLATFORM;
if (named) {
  const [platform, arch] = named.split('-');
  Object.defineProperty(process, 'platform', { value: platform, enumerable: true });
  if (arch) Object.defineProperty(process, 'arch', { value: arch, enumerable: true });
}
`;

// The fixture workspace the stub answers for: two crates, each with its library's unit tests and one integration test
// file. On Linux the two integration files are compiled empty (#![cfg(target_os = "macos")] on the whole file), and one
// unit test is cfg-gated: as the Spark's absent whole files and single tests are.
export const TARGETS = [
  { crate: 't1121-alpha', bin: 't1121_alpha', src: 'src/lib.rs', kind: 'lib', tests: [['alpha::adds_two_numbers', 'both'], ['alpha::opens_a_mac_window', 'mac']] },
  { crate: 't1121-alpha', bin: 'metal_frames', src: 'tests/metal_frames.rs', kind: 'test', tests: [['draws_a_metal_frame', 'mac'], ['reads_back_a_metal_frame', 'mac']] },
  { crate: 't1121-beta', bin: 't1121_beta', src: 'src/lib.rs', kind: 'lib', tests: [['beta::parses_a_line', 'both']] },
  { crate: 't1121-beta', bin: 'screen_capture', src: 'tests/screen_capture.rs', kind: 'test', tests: [['captures_the_screen', 'mac']] },
];
export const ABSENT = TARGETS.flatMap(({ tests }) => tests.filter(([, on]) => on === 'mac').map(([name]) => name));
export const PRESENT = TARGETS.flatMap(({ tests }) => tests.filter(([, on]) => on === 'both').map(([name]) => name));

/** What `cargo test` and `cargo test -- --list` print for the fixture workspace on darwin or linux, as cargo prints it. */
function cargoOutputs(platform) {
  const on = (target) => target.tests.filter(([, where]) => where === 'both' || platform === 'darwin').map(([name]) => name);
  const running = (target) => `     Running ${target.kind === 'lib' ? 'unittests ' : ''}${target.src} (target/debug/deps/${target.bin}-0123456789abcdef)\n`;
  const crates = [...new Set(TARGETS.map(({ crate }) => crate))];
  const doc = (crate) => `   Doc-tests ${crate.replace(/-/g, '_')}\n`;
  const pick = (crate) => TARGETS.filter((target) => target.crate === crate);
  const test = crates.map((crate) => pick(crate).map((target) => {
    const names = on(target);
    return { err: running(target), out: `\nrunning ${names.length} test${names.length === 1 ? '' : 's'}\n${names.map((n) => `test ${n} ... ok\n`).join('')}\ntest result: ok. ${names.length} passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n\n` };
  }).concat([{ err: doc(crate), out: '\nrunning 0 tests\n\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n\n' }]));
  const list = crates.map((crate) => pick(crate).map((target) => {
    const names = on(target);
    return { err: running(target), out: `${names.map((n) => `${n}: test\n`).join('')}\n${names.length} test${names.length === 1 ? '' : 's'}, 0 benchmarks\n` };
  }).concat([{ err: doc(crate), out: '0 tests, 0 benchmarks\n' }]));
  return { test, list, crates };
}

/** `cargo metadata` for the fixture workspace, in case the change reads the targets from it. */
function metadata(root) {
  const crates = [...new Set(TARGETS.map(({ crate }) => crate))];
  const id = (crate) => `path+file://${root}/crates/${crate}#0.0.0`;
  const packages = crates.map((crate) => ({
    name: crate, version: '0.0.0', id: id(crate), manifest_path: `${root}/crates/${crate}/Cargo.toml`, dependencies: [], features: {},
    targets: TARGETS.filter((t) => t.crate === crate).map((t) => ({ name: t.kind === 'lib' ? crate.replace(/-/g, '_') : t.bin, kind: [t.kind], crate_types: ['lib'], src_path: `${root}/crates/${crate}/${t.src}`, edition: '2021', doctest: t.kind === 'lib', test: true })),
  }));
  return { packages, workspace_members: crates.map(id), workspace_default_members: crates.map(id), resolve: null, target_directory: `${root}/target`, version: 1, workspace_root: root };
}

/**
 * cargo, stubbed first on PATH: `cargo test …` prints the fixture's run, and `cargo test … -- --list` its listing, for
 * the platform T1121_PLATFORM names (stderr has the Running lines, as cargo writes them), each crate a `-p` names or
 * all; `cargo metadata` answers for the fixture; any other cargo command does nothing and succeeds.
 */
function cargoStub(folder, root) {
  const outputs = { darwin: cargoOutputs('darwin'), linux: cargoOutputs('linux') };
  writeFileSync(join(folder, 'cargo-outputs.json'), JSON.stringify({ outputs, metadata: metadata(root) }));
  writeFileSync(join(folder, 'cargo-stub.mjs'), `import { readFileSync } from 'node:fs';
const { outputs, metadata } = JSON.parse(readFileSync(${JSON.stringify(join(folder, 'cargo-outputs.json'))}, 'utf8'));
const args = process.argv.slice(2);
if (args[0] === 'metadata') { process.stdout.write(JSON.stringify(metadata) + '\\n'); process.exit(0); }
if (args[0] !== 'test') process.exit(0);
const platform = (process.env.T1121_PLATFORM ?? process.platform).split('-')[0] === 'darwin' ? 'darwin' : 'linux';
const dash = args.indexOf('--');
const own = dash < 0 ? args : args.slice(0, dash), harness = dash < 0 ? [] : args.slice(dash + 1);
const crates = own.flatMap((arg, i) => (arg === '-p' || arg === '--package') ? [own[i + 1]] : arg.startsWith('--package=') ? [arg.slice(10)] : arg.startsWith('-p') && arg.length > 2 ? [arg.slice(2)] : []);
const kind = harness.includes('--list') ? 'list' : 'test';
const set = outputs[platform];
for (const [index, crate] of set.crates.entries()) {
  if (crates.length && !crates.includes(crate)) continue;
  for (const { err, out } of set[kind][index]) { process.stderr.write(err); process.stdout.write(out); }
}
`);
  writeFileSync(join(folder, 'cargo'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(folder, 'cargo-stub.mjs'))} "$@"\n`);
  chmodSync(join(folder, 'cargo'), 0o755);
}

export const gitIn = (cwd) => (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, stdio: 'pipe', encoding: 'utf8' });

/**
 * The scratch tree the real runLanes runs in: a copy of this checkout's `scripts/` and the fixture workspace's files,
 * committed in a fresh repository at box.dir/tree, a folder of links to node_modules, and a bin folder first on PATH
 * holding the cargo stub. Returns how to run its unit lane as a machine of a given platform.
 */
export function laneTree(box) {
  const cwd = join(box.dir, 'tree');
  mkdirSync(cwd);
  cpSync(join(CHECKOUT, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  const files = { '.gitignore': 'node_modules\ntarget\n', 'Cargo.toml': `[workspace]\nmembers = ["crates/t1121-alpha", "crates/t1121-beta"]\nresolver = "2"\n` };
  for (const target of TARGETS) {
    files[`crates/${target.crate}/Cargo.toml`] = `[package]\nname = "${target.crate}"\nversion = "0.0.0"\nedition = "2021"\n`;
    const gated = target.kind === 'test' ? '#![cfg(target_os = "macos")]\n' : '';
    files[`crates/${target.crate}/${target.src}`] = (files[`crates/${target.crate}/${target.src}`] ?? gated) + target.tests.map(([name, on]) => `${on === 'mac' && !gated ? '#[cfg(target_os = "macos")]\n' : ''}#[test]\nfn ${name.split('::').at(-1)}() {}\n`).join('');
  }
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(cwd, path, '..'), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
  if (existsSync(join(CHECKOUT, 'node_modules'))) {
    mkdirSync(join(cwd, 'node_modules'));
    for (const entry of readdirSync(join(CHECKOUT, 'node_modules')).filter((e) => !e.startsWith('.vite'))) symlinkSync(join(CHECKOUT, 'node_modules', entry), join(cwd, 'node_modules', entry));
  }
  const git = gitIn(cwd);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  const bin = join(box.dir, 'bin');
  mkdirSync(bin);
  cargoStub(bin, cwd);
  writeFileSync(join(box.dir, 'driver.mjs'), DRIVER);
  writeFileSync(join(box.dir, 'platform.mjs'), PLATFORM);
  const env = { PATH: `${bin}${delimiter}${box.env.PATH}`, NODE_OPTIONS: `--import=${pathToFileURL(join(box.dir, 'platform.mjs')).href}` };
  return {
    cwd,
    tree: git('rev-parse', 'HEAD^{tree}').trim(),
    /** The unit lane as a machine of `platform` (e.g. `linux-arm64`) runs it, with this HOME and extra variables. */
    unit: (platform, home, extra = {}) => run(box, [process.execPath, join(box.dir, 'driver.mjs'), cwd], { cwd, env: { ...env, T1121_PLATFORM: platform, HOME: home, ...extra } }),
  };
}

/** The real unit lane's cargo commands, through this checkout's real runLanes, in this checkout (the Spark's run). */
export function realUnit(box, extra = {}) {
  writeFileSync(join(box.dir, 'driver.mjs'), DRIVER);
  return run(box, [process.execPath, join(box.dir, 'driver.mjs'), CHECKOUT], { cwd: CHECKOUT, env: extra });
}

/** The state runLanes reported for a lane, `(platform)` included: the last line starting with a state and the name. */
export function laneLine(stdout, lane = 'unit') {
  return stdout.split('\n').filter((line) => RegExp(`^(PASS|FAIL|BLOCKED|INCONCLUSIVE|INVALID) ${lane}\\b`).test(line)).at(-1) ?? null;
}
export const laneState = (stdout, lane = 'unit') => laneLine(stdout, lane)?.split(' ')[0] ?? null;

/** Every evidence record under a HOME's ~/.deepbuild/lanes/, any depth, each with the file it is in. */
export function records(home) {
  const found = [];
  const walk = (folder) => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.json')) found.push({ path, record: JSON.parse(readFileSync(path, 'utf8')) });
    }
  };
  const folder = join(home, '.deepbuild', 'lanes');
  if (existsSync(folder)) walk(folder);
  return found;
}
/** The unit lane's record a run of `platform` wrote under `home`, failing at an assertion when there's none. */
export function unitRecord(home, platform, ran) {
  const all = records(home);
  const found = all.filter(({ record }) => record.lane === 'unit' && String(record.platform).startsWith(platform));
  assert.ok(found.length, `no evidence record of the unit lane from ${platform} under ${home}/.deepbuild/lanes/ (records there: ${all.map(({ record }) => `${record.lane} ${record.platform}`).join(', ') || 'none'})\n${dump(ran)}`);
  return found.at(-1);
}
/** Every string in a value, at any depth, keys included. */
export const strings = (value) => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => [k, ...strings(v)]) : []);

/**
 * Hands a Mac's unit record to a later run of another machine, both ways the change may read it (README: Open
 * questions): DEEP_REFERENCE_RECORD names a copy of it, and the copy also sits in that run's ~/.deepbuild/lanes/
 * under its own name, as T7 would fetch it back.
 */
export function handOver(box, macRecordPath, home) {
  const copy = join(box.dir, 'mac-unit-record.json');
  cpSync(macRecordPath, copy);
  const lanes = join(home, '.deepbuild', 'lanes');
  mkdirSync(lanes, { recursive: true, mode: 0o700 });
  cpSync(macRecordPath, join(lanes, macRecordPath.split('/').at(-1)));
  return { DEEP_REFERENCE_RECORD: copy };
}

// --- Builds (AC1, AC4) -----------------------------------------------------------------------------------------------

/** `cargo build` in this checkout with JSON messages; the artifacts it built and its exit. */
export async function cargoBuild(box, args) {
  const built = await run(box, ['cargo', 'build', '--locked', '--message-format=json-render-diagnostics', ...args], { cwd: CHECKOUT });
  const messages = built.stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  return { ...built, artifacts: messages.filter(({ reason }) => reason === 'compiler-artifact') };
}

// --- env-local through its public entry (AC5) ------------------------------------------------------------------------

/**
 * A loader for the workspace's TypeScript as its packages' `development` export names it: `./x.js` from a .ts file
 * resolves to `./x.ts`, and .ts is compiled by this checkout's typescript. It changes no behavior.
 */
function loader(folder) {
  const ts = join(CHECKOUT, 'node_modules', 'typescript', 'lib', 'typescript.js');
  writeFileSync(join(folder, 'ts-hooks.mjs'), `import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ts = createRequire(import.meta.url)(${JSON.stringify(ts)});
export async function resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('.ts') && /^\\.\\.?\\//.test(specifier) && specifier.endsWith('.js')) {
    const url = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
    if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
  }
  return next(specifier, { ...context, conditions: [...new Set(['development', ...(context.conditions ?? [])])] });
}
export async function load(url, context, next) {
  if (!url.endsWith('.ts')) return next(url, context);
  const source = readFileSync(fileURLToPath(url), 'utf8');
  const { outputText } = ts.transpileModule(source, { fileName: fileURLToPath(url), compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true } });
  return { format: 'module', source: outputText, shortCircuit: true };
}
`);
  writeFileSync(join(folder, 'ts-register.mjs'), `import { register } from 'node:module';\nregister(${JSON.stringify(pathToFileURL(join(folder, 'ts-hooks.mjs')).href)});\n`);
  return join(folder, 'ts-register.mjs');
}

/**
 * Asks env-local's port kind, through its public entry, whether a port nothing listens on is free and whether one a
 * process listens on is. Every program env-local's child_process calls run is noted, with the error it gave, so a
 * failure names the lsof it ran (the calls themselves run unchanged).
 */
const PORT_PROBE = `import cp from 'node:child_process';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
const ran = [];
for (const name of ['execFile', 'execFileSync', 'spawn', 'spawnSync']) {
  const real = cp[name];
  cp[name] = function (file, ...rest) {
    const note = { call: name, file: String(file), error: null };
    ran.push(note);
    const done = rest.findIndex((arg) => typeof arg === 'function');
    if (done >= 0) { const callback = rest[done]; rest[done] = (error, ...out) => { if (error) { note.error = \`\${error.code ?? ''} \${error.message}\`.trim(); note.spawned = typeof error.code === 'number'; } else note.spawned = true; callback(error, ...out); }; }
    try { return real.call(this, file, ...rest); } catch (error) { note.error = \`\${error.code ?? ''} \${error.message}\`.trim(); throw error; }
  };
}
syncBuiltinESMExports();
const listen = (port) => new Promise((done, fail) => { const s = net.createServer(); s.once('error', fail); s.listen({ port, host: '127.0.0.1' }, () => done(s)); });
const { portKind } = await import(pathToFileURL(process.argv[2]).href);
const kind = portKind();
const spare = await listen(0);
const freePort = spare.address().port;
await new Promise((done) => spare.close(done));
const free = await kind.free(String(freePort));
const held = await listen(0);
const heldPort = held.address().port;
const taken = await kind.free(String(heldPort));
held.close();
console.log(JSON.stringify({ hasFree: typeof kind.free === 'function', freePort, free, heldPort, taken, ran }));
`;
export async function probePorts(box) {
  const register = loader(box.dir);
  writeFileSync(join(box.dir, 'port-probe.mjs'), PORT_PROBE);
  const entry = join(CHECKOUT, 'packages', 'env-local', 'src', 'index.ts');
  const ran = await run(box, [process.execPath, `--import=${pathToFileURL(register).href}`, join(box.dir, 'port-probe.mjs'), entry], { cwd: CHECKOUT });
  const last = ran.stdout.trim().split('\n').at(-1) ?? '';
  let found = null;
  try { found = JSON.parse(last); } catch {}
  assert.ok(found, `env-local's public entry (${entry}) couldn't be asked for a port\n${dump(ran)}`);
  return found;
}

/** Where lsof is on this machine's PATH and at each platform's path, for a failure message. */
export function lsofWhere() {
  const path = (process.env.PATH ?? '').split(delimiter).map((dir) => join(dir, 'lsof')).find((file) => existsSync(file)) ?? 'none on PATH';
  return `lsof on PATH: ${path}; /usr/sbin/lsof ${existsSync('/usr/sbin/lsof') ? 'exists' : 'is absent'}; /usr/bin/lsof ${existsSync('/usr/bin/lsof') ? 'exists' : 'is absent'}`;
}
