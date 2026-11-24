// #1123: each run (and each proof side) owns a snapshot of its own Cargo executables, never links into target/. #2817:
// a test that can start the copy's hub also gets copies of the hub's binaries in that copy's target/debug/.
import { fork, spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, globSync, mkdirSync, readFileSync, rmSync, utimesSync } from 'node:fs';
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

// What a checkout's hub runs from that checkout's target/{release,debug}/ (#2817): deepHook() in
// packages/hub/src/paths.ts and canvasCore() in packages/hub/src/canvas.ts. A test that names the hub's or the CLI's
// package, in a literal, a template's text or the pieces of a join or resolve call, can start that hub; a whole
// command such as `node packages/cli/dist/main.js hub run` names it too, and so does a test or helper inside either
// package, which reaches the hub through ../src.
const HUB_BINARIES = ['deep-hook', 'deep-show'];
const HUB_ENTRY = /(?<![\w.@-])packages\/(?:hub|cli)(?![\w-]|\.\w)|(?<![\w./@-])@deepbuild\/(?:hub|cli)(?![\w-]|\.\w)/;

/** Selected tests' DEEP_BIN_DIR binaries, for a run in the checkout itself, which keeps its own target/. */
export const binaryNames = (cwd, patterns) => selectBinaries(cwd, patterns, false).bin;

// The flags a test's own `cargo build` may carry for the run to build it first (#2820): those that only pick what
// and how it builds. Any other, or a value the source doesn't write out, leaves that build to the test.
const PLAIN = new Set(['--locked', '--offline', '--release', '--no-default-features', '--all-features']);
const VALUED = new Set(['--bin', '-p', '--package', '--features']);
const PROFILE = ['CARGO_INCREMENTAL', 'CARGO_PROFILE_DEV_DEBUG'];

/**
 * binaryNames' walk, which also finds the `cargo build`s the selected tests and their helpers start themselves (#2820):
 * `builds` holds each one's arguments, written out in the source, for the run to build first in each checkout, so the
 * test finds it fresh. A `--bin` whose name is a variable stands for each workspace binary the test's sources name.
 */
export function binaryPlan(cwd, patterns) {
  const { bin, builds } = selectBinaries(cwd, patterns, false, true);
  return { names: bin, builds };
}

/**
 * Selected tests and the helper declarations they reach: `bin`, the binaries their DEEP_BIN_DIR consumers name,
 * `target`, the hub's binaries when one of them names the hub's or the CLI's package, `hub`, the selected paths
 * that do, which alone may find `target` in place (#2817), and with `findBuilds` `builds`, their own `cargo build`s
 * (binaryPlan).
 */
export function selectBinaries(cwd, patterns, hubBinaries = true, findBuilds = false) {
  const hubRoots = [];
  let reaches = false;
  const names = (text) => { if (HUB_ENTRY.test(text)) reaches = true; };
  const sources = [], selfBuilt = [], roots = patterns.flatMap((path) => path.includes('*') ? globSync(path, { cwd }) : [path]);
  for (const root of roots) {
    const seen = new Set(), own = [], builds = [], queue = [{ path: root, requested: null }];
    let readsBin = false, executes = false;
    reaches = false;
    while (queue.length) {
      const { path, requested } = queue.pop();
      const candidates = /\.(?:[cm]?[jt]s|tsx)$/.test(path) ? [path] : globSync(`${path.replace(/\/$/, '')}/**/*.{ts,mjs,js}`, { cwd });
      if (path.includes('*')) candidates.splice(0, candidates.length, ...globSync(path, { cwd }));
      for (const file of candidates) {
        const full = resolve(cwd, file);
        const key = `${full}:${requested?.join(',') ?? '*'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        names(relative(cwd, full));
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
          // A helper's re-export reaches the helper it names, as an import does.
          if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('.')) {
            const clause = node.exportClause;
            follow(node.moduleSpecifier.text, clause && ts.isNamedExports(clause) ? clause.elements.filter((n) => !n.isTypeOnly).map((n) => (n.propertyName ?? n.name).text) : null);
          }
          // Types are no run: a type-only import or export reaches no hub.
          if ((ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) || (ts.isExportDeclaration(node) && node.isTypeOnly)) return;
          if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) follow(node.arguments[0].text, null);
          if ((ts.isPropertyAccessExpression(node) && node.expression.getText() === 'process.env' && node.name.text === 'DEEP_BIN_DIR')
            || (ts.isElementAccessExpression(node) && node.expression.getText() === 'process.env' && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'DEEP_BIN_DIR')) readsBin = true;
          if (ts.isCallExpression(node) && /^(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)$/.test(node.expression.getText().split('.').at(-1))) {
            const command = node.arguments[0];
            if (!command || !ts.isStringLiteralLike(command) || !['cargo', 'git', 'npm', 'node', 'ps', 'sh'].includes(command.text)) executes = true;
            const [, list, options] = node.arguments;
            if (command && ts.isStringLiteralLike(command) && command.text === 'cargo' && list && ts.isArrayLiteralExpression(list) && !options?.getText().includes('CARGO_TARGET_DIR')) {
              const args = list.elements.map((element) => ts.isStringLiteralLike(element) ? element.text : null);
              // The test's profile: the acceptance helpers default these to 0 where their file names them (#2820).
              const profile = Object.fromEntries(PROFILE.filter((key) => source.includes(key)).map((key) => [key, '0']));
              if (findBuilds && args[0] === 'build') builds.push({ args: args.slice(1).filter((arg) => arg !== '-q' && arg !== '--quiet'), profile });
            }
          }
          if (ts.isCallExpression(node) && /^(?:join|resolve)$/.test(node.expression.getText().split('.').at(-1))) names(node.arguments.filter(ts.isStringLiteralLike).map((arg) => arg.text).join('/'));
          if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) names(node.text);
          if (ts.isStringLiteralLike(node)) {
            own.push(node.text);
            names(node.text);
          }
          ts.forEachChild(node, visit);
        };
        sourceSlice(full, source, requested).forEachChild(visit);
      }
    }
    if (readsBin && executes) sources.push(own.join('\n'));
    if (reaches) hubRoots.push(root);
    if (builds.length) selfBuilt.push({ builds, source: own.join('\n') });
  }
  const hub = hubBinaries && hubRoots.length > 0;
  const none = { bin: [], target: [], hub: [], builds: [] };
  // Only actual redrafted consumers need a build; a missing workspace is not a wrong executable, and a test's own
  // build in a checkout with no workspace is the test's to report.
  if (!sources.length && !hub && !selfBuilt.length) return none;
  if (!existsSync(join(cwd, 'Cargo.toml'))) {
    if (!sources.length) return none;
    throw Error('BLOCKED test binaries: selected binary consumer has no Cargo.toml');
  }
  const source = sources.join('\n');
  const metadata = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--offline'], { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (metadata.status !== 0) throw Error(`BLOCKED test binaries: cargo metadata failed: ${metadata.error?.message ?? metadata.stderr}`);
  const mentions = (name, text = source) => text.match(new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`));
  const packages = JSON.parse(metadata.stdout).packages;
  const bins = sources.length ? packages.flatMap((pkg) => pkg.targets.filter((target) => target.kind.includes('bin') && (mentions(target.name) || mentions(pkg.name))).map((target) => target.name)) : [];
  if (sources.length && !bins.length) throw Error('BLOCKED test binaries: a selected consumer names DEEP_BIN_DIR but no workspace binary');
  const workspace = new Set(packages.flatMap((pkg) => pkg.targets.filter((target) => target.kind.includes('bin')).map((target) => target.name)));
  const target = hub ? HUB_BINARIES.filter((name) => workspace.has(name)) : [];
  const binsOf = new Map(packages.map((pkg) => [pkg.name, pkg.targets.filter((target) => target.kind.includes('bin')).map((target) => target.name)]));
  // A build is the run's to make only when every flag is one that picks what it builds, every value is written out,
  // and it names workspace binaries, of the package it names if it names one: a bare `cargo build` builds the whole
  // workspace, or a fixture's.
  const known = (args) => {
    const picked = { bins: [], packages: [] };
    for (let at = 0; at < args.length; at++) {
      if (PLAIN.has(args[at])) continue;
      if (!VALUED.has(args[at]) || typeof args[at + 1] !== 'string') return false;
      if (args[at] === '--bin') picked.bins.push(args[at + 1]);
      if (args[at] === '-p' || args[at] === '--package') picked.packages.push(args[at + 1]);
      at++;
    }
    if (picked.packages.some((name) => !binsOf.has(name))) return false;
    const allowed = picked.packages.length ? picked.packages.flatMap((name) => binsOf.get(name)) : [...binsOf.values()].flat();
    return picked.bins.length + picked.packages.length > 0 && picked.bins.every((name) => allowed.includes(name));
  };
  // What a build the run makes leaves in the checkout's target/, by binary: gone, a cleanup emptied it since (#3296).
  const outputs = (args) => {
    const named = (flag) => args.flatMap((arg, at) => (args[at - 1] === flag ? [arg] : []));
    const bins = named('--bin');
    return (bins.length ? bins : [...named('-p'), ...named('--package')].flatMap((name) => binsOf.get(name) ?? [])).map((name) => join(args.includes('--release') ? 'release' : 'debug', name));
  };
  const builds = new Map();
  for (const { builds: calls, source } of selfBuilt) for (const { args, profile } of calls) {
    const slot = args.findIndex((arg, at) => arg === null && args[at - 1] === '--bin');
    // A variable --bin is filled only with the binaries the test names, not every binary of a package it names.
    const filled = slot < 0 ? [args] : packages.flatMap((pkg) => pkg.targets.filter((target) => target.kind.includes('bin') && mentions(target.name, source)).map((target) => target.name)).map((name) => args.map((arg, at) => at === slot ? name : arg));
    for (const each of filled) if (known(each)) builds.set(JSON.stringify([each, profile]), { args: each, profile, outputs: outputs(each) });
  }
  return { bin: [...new Set(bins)], target, hub: target.length ? hubRoots : [], builds: [...builds.values()] };
}

/**
 * Puts `names`, built into `bin`, where the checkout's own hub looks: target/debug/, newer than any release build. A
 * bay keeps target/ between uses, so what an earlier use put there goes first and a use that needs none finds none.
 */
export function placeHubBinaries(cwd, bin, names) {
  const debug = join(cwd, 'target', 'debug');
  for (const name of HUB_BINARIES) rmSync(join(debug, name), { force: true });
  if (names.length) mkdirSync(debug, { recursive: true });
  const now = new Date();
  for (const name of names) {
    copyFileSync(join(bin, name), join(debug, name), constants.COPYFILE_FICLONE);
    utimesSync(join(debug, name), now, now);
  }
}

/** The files `builds` (binaryPlan) leave in `cwd`'s target/. */
export const builtIn = (cwd, builds) => builds.flatMap(({ outputs }) => outputs.map((path) => join(cwd, 'target', path)));

/**
 * The selected tests' own `cargo build`s (binaryPlan), each run in `cwd` as the test will run it, its target/, the
 * run's environment and the test's profile, so the test's build finds every unit fresh and compiles nothing (#2820). On
 * the caller's build grant.
 */
export function buildInPlace(cwd, builds) {
  const base = { ...process.env };
  for (const key of ['DEEP_BIN_DIR', 'NODE_TEST_CONTEXT', '__STRYKER_ACTIVE_MUTANT__']) delete base[key];
  for (const { args, profile } of builds) {
    const env = { ...base };
    for (const [key, value] of Object.entries(profile)) env[key] ??= value;
    // No time limit: it holds no test slot, only the run's build grant and its own checkouts, and a cold build of the
    // largest binaries took over an hour on the Linux machine at load 54 (2026-11-18), so a bound would only BLOCK slow runs.
    const result = spawnSync(lease, ['cargo', 'build', ...args], { cwd, env, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (result.status !== 0) throw Error(`BLOCKED test binaries: cargo build ${args.join(' ')} failed in ${cwd}: ${result.error?.message ?? (result.signal ? `stopped by ${result.signal}` : result.stderr?.trim().split('\n').slice(-20).join('\n'))}`);
  }
}

/**
 * Build once before any consumer starts; copy only executables Cargo reports from this successful build. `timeout` 0
 * lets cargo run as long as it needs, as the lanes' builds do: a cold bay build runs past 20 minutes on a loaded machine.
 */
export function buildBinaries(cwd, bin, names, run = spawnSync, { timeout = 20 * 60_000 } = {}) {
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
    const result = run(lease, [process.execPath, buildSupervisor, dirname(bin), String(process.pid), started, 'cargo', ...args], { cwd, env, detached: true, encoding: 'utf8', maxBuffer: 1 << 28, timeout: timeout || undefined });
    if (result.status !== 0) throw Error(`BLOCKED test binaries: cargo build failed for ${names.join(', ')}: ${result.error?.message ?? result.stderr?.trim() ?? result.signal ?? result.status}`);
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
