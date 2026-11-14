// #1123 regression redraft: public runner surfaces, real Cargo, real deep-hook.
// Run from the checkout being checked. No implementation module is patched.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root = realpathSync(process.cwd());
const here = dirname(fileURLToPath(import.meta.url));
const consumer = 'tests/acceptance/1123/consumer.test.mjs';
const versionFile = 'crates/deep-hook/Cargo.toml';
const versions = { base: '0.0.1123', change: '1.0.1123' };

function checked(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `BLOCKED fixture command: ${command} ${args.join(' ')}\n${result.error?.code ?? ''}\n${result.stderr ?? ''}`);
  return result.stdout;
}
function prerequisites() {
  const missing = [];
  for (const tool of ['cargo', 'rustc', 'git']) {
    if (spawnSync(tool, ['--version'], { encoding: 'utf8' }).status !== 0) missing.push(`${tool} on PATH`);
  }
  if (!existsSync(join(root, 'node_modules/typescript/package.json'))) missing.push('checkout node_modules/typescript (no dependencies installed by this test)');
  assert.equal(missing.length, 0, `BLOCKED: ${missing.join('; ')}; executable-origin checks did not run`);
}
function put(folder, path, text) {
  mkdirSync(dirname(join(folder, path)), { recursive: true });
  writeFileSync(join(folder, path), text);
}
function setVersion(folder, version) {
  const manifest = readFileSync(join(folder, versionFile), 'utf8');
  assert.match(manifest, /^version = "[^"]+"/m, 'BLOCKED fixture: deep-hook has no package version');
  put(folder, versionFile, manifest.replace(/^version = "[^"]+"/m, `version = "${version}"`));
}
function workspace(folder, version, env, cargo) {
  mkdirSync(folder, { recursive: true });
  // Preserve the owned components byte-for-byte, except package version as an
  // externally visible build identity. These two crates need no registry deps.
  for (const name of ['deep-hook', 'deep-contracts']) cpSync(join(root, 'crates', name), join(folder, 'crates', name), { recursive: true });
  copyFileSync(join(root, 'LICENSE'), join(folder, 'LICENSE'));
  put(folder, 'Cargo.toml', '[workspace]\nmembers = ["crates/deep-hook", "crates/deep-contracts"]\nresolver = "2"\n');
  setVersion(folder, version);
  checked(cargo, ['generate-lockfile', '--offline'], { cwd: folder, env });
}
function fixture(t, before) {
  prerequisites(); // Missing tools never become a skip, nor an apparent PASS.
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1123-origin-')));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const cargo = checked('sh', ['-c', 'command -v cargo']).trim();
  const cwd = join(sandbox, 'repo');
  mkdirSync(join(sandbox, 'home'));
  // Isolate grants, evidence, bays and user hooks. Preserve only tool locations,
  // not shell DEEP_* values, credentials, flags or a caller's Cargo target.
  const env = {
    PATH: process.env.PATH, HOME: join(sandbox, 'home'),
    CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), '.cargo'),
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'),
    TMPDIR: sandbox, TMP: sandbox, TEMP: sandbox, CARGO_NET_OFFLINE: 'true',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  workspace(cwd, before ? versions.base : versions.change, env, cargo);
  for (const [name, version] of [['opponent-a', '8.8.1123'], ['opponent-b', '9.9.1123']]) {
    workspace(join(sandbox, name), version, env, cargo);
  }
  // The inherited directory contains a real, runnable WRONG executable, not a
  // missing-path sentinel. Consumers must obtain their value from their runner.
  checked(cargo, ['build', '--offline', '--locked', '-p', 'deep-hook'], { cwd: join(sandbox, 'opponent-b'), env });
  env.DEEP_BIN_DIR = join(sandbox, 'opponent-b/target/debug');
  assert.equal(checked(join(env.DEEP_BIN_DIR, 'deep-hook'), ['--version'], { env }).trim(), '9.9.1123');
  cpSync(join(root, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  put(cwd, '.gitignore', 'target/\nnode_modules/\n');
  put(cwd, 'capture-fixture.json', '{}\n');
  mkdirSync(join(cwd, 'node_modules'));
  symlinkSync(join(root, 'node_modules/typescript'), join(cwd, 'node_modules/typescript'), 'dir');
  // Disposable history only: before's actual CLI needs a merge base. No commit
  // or hook is ever written in the checkout under test.
  const git = (...args) => checked('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd, env });
  git('init', '-q', '--template=');
  git('add', '-A');
  git('commit', '-q', '-m', 'Fixture base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  if (before) {
    setVersion(cwd, versions.change);
    checked(cargo, ['generate-lockfile', '--offline'], { cwd, env });
  }
  mkdirSync(dirname(join(cwd, consumer)), { recursive: true });
  copyFileSync(join(here, 'consumer.mjs'), join(cwd, consumer));
  const shim = join(sandbox, 'tools');
  mkdirSync(shim);
  copyFileSync(join(here, 'cargo-wrapper.cjs'), join(shim, 'cargo'));
  chmodSync(join(shim, 'cargo'), 0o755);
  Object.assign(env, { PATH: `${shim}:${env.PATH}`, CAPTURE_CARGO: cargo, CAPTURE_SANDBOX: sandbox });
  return { cwd, env, sandbox };
}
function observations(scene) {
  const file = join(scene.sandbox, 'consumers.jsonl');
  assert.ok(existsSync(file), 'BLOCKED: runner never reached the consumer; no origin observation');
  return readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
}
function assertOrigin(row, expected) {
  assert.equal(row.expected, expected, 'fixture did not reach the intended source side');
  assert.ok(row.race?.ownCargoSucceeded, 'INCONCLUSIVE: consumer saw no completed own-build/rival-build interleaving');
  assert.equal(row.race.sourceVersion, expected);
  assert.equal(row.race.first, '8.8.1123');
  assert.equal(row.race.last, '9.9.1123');
  assert.equal(row.sharedStatus, 0);
  assert.equal(row.shared, '9.9.1123', 'INCONCLUSIVE: no competing shared executable at consumption');
  assert.ok(row.binDir, 'RUN_PRIVATE_ORIGIN: missing DEEP_BIN_DIR at consumer');
  assert.equal(row.status, 0, 'RUN_PRIVATE_ORIGIN: executable did not run');
  assert.equal(row.actual, expected, 'RUN_PRIVATE_ORIGIN: consumer used a foreign build');
}
function launch(scene, args) {
  const result = spawnSync(process.execPath, args, { cwd: scene.cwd, env: scene.env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  // Keep the runner's WIDE/INCONCLUSIVE/BLOCKED lines visible; an unrelated lint
  // failure in this deliberately small fixture is not executable-origin proof.
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  console.log(output.replaceAll(scene.sandbox, '<scratch>').replaceAll(root, '<checkout>'));
  assert.equal(result.error, undefined, `BLOCKED: runner could not start: ${result.error?.code}`);
  return { ...result, output };
}

test('lanes.mjs hands its own executable to the consumer after a competing Cargo rewrite', (t) => {
  const scene = fixture(t, false);
  // runLanes is lanes.mjs's public entry; a tiny real lane avoids unrelated
  // application builds and never changes checks, alone, or any existing test.
  const script = `import { runLanes } from ${JSON.stringify(pathToFileURL(join(scene.cwd, 'scripts/lanes.mjs')).href)};
    process.exitCode = runLanes([{ name: 'unit', commands: [
      ['cargo', 'build', '--offline', '--locked', '-p', 'deep-hook'],
      [process.execPath, '--test', ${JSON.stringify(consumer)}]
    ], fix: 'Run-private executable origin' }], { cwd: process.cwd() });`;
  const result = launch(scene, ['--input-type=module', '-e', script]);
  const rows = observations(scene);
  assert.equal(rows.length, 1, 'consumer must actually run exactly once');
  assertOrigin(rows[0], versions.change);
  assert.equal(result.status, 0, result.output);
});

test('affected.mjs hands its own executable to the consumer after a competing Cargo rewrite', (t) => {
  const scene = fixture(t, false);
  const result = launch(scene, ['scripts/affected.mjs', consumer]);
  const rows = observations(scene);
  assert.equal(rows.length, 1, 'affected must actually select and run the consumer');
  assertOrigin(rows[0], versions.change);
  // affected also runs repo-specific lints on the small fixture. They are not
  // mocked or suppressed; require its real consumer report, not a green exit.
  const logs = result.output.match(/logs in (.+)/)?.[1]?.trim();
  assert.ok(logs, 'BLOCKED: affected wrote no report location');
  const events = readFileSync(join(logs, 'node.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(events.some((event) => event.type === 'pass' && event.name === '#' + '9001.12345678 own build reaches the consumer' && !event.skip && !event.todo),
    'affected consumer did not report a non-skipped PASS');
});

test('before keeps base and change origins separate during competing Cargo rewrites', (t) => {
  const scene = fixture(t, true);
  // Use the real before CLI from the checkout, with a test-owned repo as input.
  // Per design, test-started proofs use temporary copies, not machine bays.
  const result = launch(scene, [resolve(root, 'scripts/proof.mjs'), 'before']);
  const rows = observations(scene);
  assert.equal(rows.length, 2, 'both before-lane sides must actually run');
  const base = rows.find((row) => row.expected === versions.base);
  const change = rows.find((row) => row.expected === versions.change);
  assert.ok(base && change, 'before did not exercise both source versions');
  assertOrigin(base, versions.base);
  assertOrigin(change, versions.change);
  assert.notEqual(base.cwd, change.cwd, 'before sides must be separate checkouts');
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /PASS before: .*own build reaches the consumer: failed on the merge base at its assertion/,
    'before must recognize the wrong base at the consumer assertion, not a missing build or environment');
});
