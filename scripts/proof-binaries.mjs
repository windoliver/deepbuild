// #1123: each run (and each proof side) owns a snapshot of its own Cargo executables, never links into target/.
import { fork, spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, globSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { acquire, release } from './throttle.mjs';

const lease = fileURLToPath(new URL('./lease', import.meta.url));

/** A pipe outlives neither SIGTERM nor SIGKILL: its detached owner removes only this run's directory. */
export function watchBinaries(directory) {
  const watcher = fork(fileURLToPath(import.meta.url), [directory], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [] });
  watcher.unref();
  watcher.channel.unref();
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.send && process.argv[2]) {
  process.once('disconnect', () => { rmSync(process.argv[2], { recursive: true, force: true }); });
}

/** Ask Vitest for its exact file set, including its config, --root, positional filters and --exclude. */
export function commandFiles(cwd, [command, ...args]) {
  const at = args.findIndex((arg) => arg.endsWith('vitest.mjs'));
  if (at >= 0) {
    const env = { ...process.env };
    delete env.DEEP_BIN_DIR;
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(command, [...args.slice(0, at + 1), 'list', ...args.slice(at + 2), '--filesOnly', '--json'], { cwd, env, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (result.status !== 0) throw Error(`BLOCKED test binaries: cannot list Vitest files: ${result.stderr || result.error?.message || result.stdout}`);
    return JSON.parse(result.stdout).map(({ file }) => file);
  }
  if (command === process.execPath && args[0] === '--test') {
    const files = args.slice(1).filter((arg) => !arg.startsWith('-') && (/\.[cm]?[jt]s$/.test(arg) || arg.includes('*')));
    return files.length ? files : ['**/*.test.{mjs,js,ts}'];
  }
  return [];
}

/** Selected tests and their relative helpers, including paths read dynamically. Never build an unrelated crate. */
export function binaryNames(cwd, patterns) {
  const sources = [], roots = patterns.flatMap((path) => path.includes('*') ? globSync(path, { cwd }) : [path]);
  for (const root of roots) {
    const seen = new Set(), own = [], queue = [root];
    let readsBin = false, executes = false;
    while (queue.length) {
      const path = queue.pop();
      const candidates = /\.(?:[cm]?[jt]s|tsx)$/.test(path) ? [path] : globSync(`${path.replace(/\/$/, '')}/**/*.{ts,mjs,js}`, { cwd });
      if (path.includes('*')) candidates.splice(0, candidates.length, ...globSync(path, { cwd }));
      for (const file of candidates) {
        const full = resolve(cwd, file);
        if (seen.has(full)) continue;
        seen.add(full);
        let source;
        try { source = readFileSync(full, 'utf8'); } catch { continue; }
        // Parse actual code: fixture source strings and sanitizer lists are not this test's binary consumers.
        const visit = (node) => {
          if ((ts.isPropertyAccessExpression(node) && node.expression.getText() === 'process.env' && node.name.text === 'DEEP_BIN_DIR')
            || (ts.isElementAccessExpression(node) && node.expression.getText() === 'process.env' && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'DEEP_BIN_DIR')) readsBin = true;
          if (ts.isCallExpression(node) && /^(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)$/.test(node.expression.getText().split('.').at(-1))) executes = true;
          if (ts.isStringLiteralLike(node)) own.push(node.text);
          ts.forEachChild(node, visit);
        };
        visit(ts.createSourceFile(full, source, ts.ScriptTarget.Latest, true));
        for (const [, dependency] of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"](\.[^'"]+)['"]/g)) {
          const base = resolve(dirname(full), dependency), stem = base.replace(/\.[cm]?js$/, '');
          const found = [base, `${stem}.ts`, `${stem}.mjs`, `${base}.ts`, `${base}.mjs`, `${base}/index.ts`, `${base}/index.mjs`].find(existsSync);
          if (found && /^(?:tests\/|packages\/.*\/test\/)/.test(relative(cwd, found))) queue.push(found);
        }
      }
    }
    if (readsBin && executes) sources.push(own.join('\n'));
  }
  // Only actual redrafted consumers need a build; a missing workspace is not a wrong executable.
  if (!sources.length) return [];
  if (!existsSync(join(cwd, 'Cargo.toml'))) throw Error('BLOCKED test binaries: selected binary consumer has no Cargo.toml');
  const source = sources.join('\n');
  const metadata = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--offline'], { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (metadata.status !== 0) throw Error(`BLOCKED test binaries: cargo metadata failed: ${metadata.error?.message ?? metadata.stderr}`);
  const mentions = (name) => source.match(new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`));
  const bins = JSON.parse(metadata.stdout).packages.flatMap((pkg) => pkg.targets.filter((target) => target.kind.includes('bin') && (mentions(target.name) || mentions(pkg.name))).map((target) => target.name));
  if (!bins.length) throw Error('BLOCKED test binaries: a selected consumer names DEEP_BIN_DIR but no workspace binary');
  return [...new Set(bins)];
}

/** Build once before any consumer starts; copy only executables Cargo reports from this successful build. */
export function buildBinaries(cwd, bin, names, run = spawnSync) {
  mkdirSync(bin, { recursive: true });
  // The proof tooling's JavaScript-only fixture repositories have no Rust build.
  if (!names.length) return bin;
  const grant = acquire('build', { wait: 30 });
  if (!grant) throw Error('INCONCLUSIVE no grant: no build grant came within 30 min for test binaries');
  const artifactsDirectory = join(bin, '.artifacts');
  try {
    const env = { ...process.env, DEEP_THROTTLE: grant.token };
    for (const key of ['DEEP_BIN_DIR', 'NODE_TEST_CONTEXT', '__STRYKER_ACTIVE_MUTANT__', 'CARGO_TARGET_DIR', 'CARGO_BUILD_TARGET_DIR']) delete env[key];
    // Keep compiler intermediates at this checkout's fixed path; Cargo publishes final artifacts privately
    // while it still holds the build lock. Copying target/debug after Cargo exits races a sibling's build.
    const args = ['build', ...names.flatMap((name) => ['--bin', name]), '--locked', '--target-dir', artifactsDirectory,
      '--config', `build.build-dir=${JSON.stringify(join(cwd, 'target'))}`, '--message-format=json-render-diagnostics'];
    const result = run(lease, ['cargo', ...args], { cwd, env, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 20 * 60_000 });
    if (result.status !== 0) throw Error(`BLOCKED test binaries: cargo build failed: ${result.error?.message ?? result.stderr?.trim() ?? result.signal ?? result.status}`);
    const artifacts = result.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    if (!artifacts.some((artifact) => artifact.reason === 'build-finished' && artifact.success)) throw Error('BLOCKED test binaries: cargo reported no successful build');
    const binaries = artifacts.filter((artifact) => artifact.reason === 'compiler-artifact' && artifact.target.kind.includes('bin') && artifact.executable && !artifact.profile.test);
    for (const name of names) if (!binaries.some((artifact) => artifact.target.name === name)) throw Error(`BLOCKED test binaries: cargo reported no executable for ${name}`);
    for (const artifact of binaries) copyFileSync(artifact.executable, join(bin, basename(artifact.executable)), constants.COPYFILE_FICLONE);
    return bin;
  } finally {
    try { rmSync(artifactsDirectory, { recursive: true, force: true }); } finally { release(grant); }
  }
}
