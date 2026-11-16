// #1123: each run (and each proof side) owns a snapshot of its own Cargo executables, never links into target/.
import { fork, spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, globSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { acquire, release } from './throttle.mjs';

const lease = fileURLToPath(new URL('./lease', import.meta.url));
const buildSupervisor = fileURLToPath(new URL('./proof-bin-build.mjs', import.meta.url));

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

/** Reach named imports through each helper's declarations, not unrelated exported builders in the same file. */
function sourceSlice(file, source, requested) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  if (requested === null) return ast;
  const definitions = new Map(), imports = [], effects = [];
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement)) imports.push(statement);
    else if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) definitions.set(declaration.name.text, declaration);
    }
    else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name) definitions.set(statement.name.text, statement);
    } else if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) effects.push(statement);
  }
  const reached = new Set(), queue = [...requested], nodes = [...effects];
  const refs = (node) => { if (ts.isIdentifier(node) && definitions.has(node.text) && !reached.has(node.text)) queue.push(node.text); ts.forEachChild(node, refs); };
  effects.forEach(refs);
  while (queue.length) { const name = queue.pop(); if (reached.has(name)) continue; reached.add(name); const node = definitions.get(name); if (node) { nodes.push(node); refs(node); } }
  const used = new Set(); const identifiers = (node) => { if (ts.isIdentifier(node)) used.add(node.text); ts.forEachChild(node, identifiers); }; nodes.forEach(identifiers);
  return { forEachChild: (visit) => [...imports.filter((node) => !node.importClause || [node.importClause.name, ...(node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings) ? node.importClause.namedBindings.elements.map((n) => n.name) : [node.importClause.namedBindings?.name])].some((name) => name && used.has(name.text))), ...nodes].forEach(visit) };
}

/** Selected tests and the helper declarations they reach. */
export function binaryNames(cwd, patterns) {
  const sources = [], roots = patterns.flatMap((path) => path.includes('*') ? globSync(path, { cwd }) : [path]);
  for (const root of roots) {
    const seen = new Set(), own = [], queue = [{ path: root, requested: null }];
    let readsBin = false, executes = false;
    while (queue.length) {
      const { path, requested } = queue.pop();
      const candidates = /\.(?:[cm]?[jt]s|tsx)$/.test(path) ? [path] : globSync(`${path.replace(/\/$/, '')}/**/*.{ts,mjs,js}`, { cwd });
      if (path.includes('*')) candidates.splice(0, candidates.length, ...globSync(path, { cwd }));
      for (const file of candidates) {
        const full = resolve(cwd, file);
        const key = `${full}:${requested?.join(',') ?? '*'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let source;
        try { source = readFileSync(full, 'utf8'); } catch { continue; }
        const follow = (dependency, names) => {
          const base = resolve(dirname(full), dependency), stem = base.replace(/\.[cm]?js$/, '');
          const found = [base, `${stem}.ts`, `${stem}.mjs`, `${base}.ts`, `${base}.mjs`, `${base}/index.ts`, `${base}/index.mjs`].find(existsSync);
          if (found && /^(?:tests\/|packages\/.*\/test\/)/.test(relative(cwd, found))) queue.push({ path: found, requested: names });
        };
        // Parse actual code: fixture source strings and sanitizer lists are not this test's binary consumers.
        const visit = (node) => {
          if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('.')) {
            const bindings = node.importClause?.namedBindings;
            const names = bindings && ts.isNamedImports(bindings) && !node.importClause?.name ? bindings.elements.filter((n) => !n.isTypeOnly).map((n) => (n.propertyName ?? n.name).text) : null;
            if (!node.importClause?.isTypeOnly) follow(node.moduleSpecifier.text, names);
          }
          if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) follow(node.arguments[0].text, null);
          if ((ts.isPropertyAccessExpression(node) && node.expression.getText() === 'process.env' && node.name.text === 'DEEP_BIN_DIR')
            || (ts.isElementAccessExpression(node) && node.expression.getText() === 'process.env' && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'DEEP_BIN_DIR')) readsBin = true;
          if (ts.isCallExpression(node) && /^(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)$/.test(node.expression.getText().split('.').at(-1))) {
            const command = node.arguments[0];
            if (!command || !ts.isStringLiteralLike(command) || !['cargo', 'git', 'npm', 'node', 'ps', 'sh'].includes(command.text)) executes = true;
          }
          if (ts.isStringLiteralLike(node)) own.push(node.text);
          ts.forEachChild(node, visit);
        };
        sourceSlice(full, source, requested).forEachChild(visit);
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
    const started = spawnSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { encoding: 'utf8', env: { ...env, TZ: 'UTC', LC_ALL: 'C' } }).stdout?.trim();
    if (!started) throw Error('BLOCKED test binaries: cannot identify the build owner');
    const result = run(lease, [process.execPath, buildSupervisor, dirname(bin), String(process.pid), started, 'cargo', ...args], { cwd, env, detached: true, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 20 * 60_000 });
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
