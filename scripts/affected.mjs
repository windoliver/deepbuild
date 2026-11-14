// The suites a change can reach, and only those (AGENTS.md, Proof). A test file is reached when it imports a changed
// file, near or far, through the packages' entries, names its path or a dist build of it, or runs a crate the change
// reaches; a crate when it or a crate it depends on changed. Each runs with its own runner: vitest or node --test by
// what the file imports, cargo test for crates. The files lanes.mjs runs alone run one at a time after everything
// else, which runs in parallel, and those it leaves to a person don't run. Its timed files run last, one at a time
// under a timed grant, and only with --timed: unrun, they leave the run INCONCLUSIVE. Failures main already has
// (known-failures.json) read apart from new ones, and a timing budget missed at a load above the core count reads INCONCLUSIVE. So does a
// skip, or BLOCKED by its note, unless the same file's `skips` list covers it, which is printed.
//
//   node scripts/affected.mjs [--list] [--wide] [--record] [--timed] [--slow] [path ...]
//
// The alone block's folders run side by side, each in a shard of its own (scripts/shards.mjs), so no sibling's cargo
// build rewrites a binary under it; those lanes.mjs names exclusive run after, one at a time, with nothing beside them.
// The files lanes.mjs names slow run only with --slow, or when the change adds or edits them; unrun, they leave the run
// INCONCLUSIVE, as the timed ones do.
//
// Paths stand for the change, which is otherwise the worktree against its merge base with origin/main. --list prints
// the selection without running it. --wide also runs the suites that see the change only through another package's
// process (select, below). --record, run on main, writes what failed into known-failures.json.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { alone, byHand, cargoResults, changedPaths, checks, exclusive, listed, ownLane, readSkips, reportResults, slow, timed, worst } from './lanes.mjs';
import { isTestFile, listFiles, named, underTestPaths } from './proof-change.mjs';
import { childEnv } from './proof-runs.mjs';
import { binaryNames, buildBinaries, watchBinaries } from './proof-binaries.mjs';
import { claimShards, roomy } from './shards.mjs';
import { acquire, release } from './throttle.mjs';

export { cargoResults, reportResults };

const root = fileURLToPath(new URL('../', import.meta.url));
const BASELINE = 'scripts/known-failures.json';
const CODE = /\.(?:[cm]?[jt]s|tsx)$/;
// Files every suite reads, so a change to one is verified by the full preflight.
const EVERY = ['package.json', 'package-lock.json', 'tsconfig.json', 'vitest.config.ts', 'Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml'];
// A folder holding more files than this, as tests/acceptance, is named as a pattern, not as what a file reads.
const WIDE = 400;
// Repository paths in a literal: relative ones, and those from the root, as `${root}/packages/hub/dist/main.js`.
const PATHS = /(?<![\w.@-])(?:\.{1,2}\/[\w@.\/-]*|\/?(?:packages|crates|scripts|tests|contracts|lint|adapters|skills)\/[\w@.\/-]+)/g;
const PACKAGE = /@deepbuild\/[\w-]+(?:\/[\w.-]+)*/g;
const within = (folder, path) => path === folder || path.startsWith(`${folder}/`);
const folders = (path) => path.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'));

/** The workspace's crates from cargo metadata: folders, path dependencies, the names they run by, and test targets. */
export function crates(cwd) {
  const result = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--offline'], { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (result.status !== 0) throw Error(`cargo metadata failed: ${result.stderr.trim().split('\n').at(-1)}`);
  // cargo names paths as the disk resolves them, as /private/var for /var.
  const repo = (path) => relative(realpathSync(cwd), path).split(sep).join('/');
  return JSON.parse(result.stdout).packages.map((pkg) => {
    const dir = repo(dirname(pkg.manifest_path));
    const kind = (target) => ['bin', 'test', 'bench', 'example'].find((k) => target.kind.includes(k));
    return {
      name: pkg.name, dir,
      // The folders of its targets outside it, as the [[test]] files in tests/acceptance.
      away: [...new Set(pkg.targets.map((target) => dirname(repo(target.src_path))).filter((folder) => !within(dir, folder)))],
      deps: pkg.dependencies.filter((dep) => dep.path).map((dep) => dep.name),
      names: [...new Set([pkg.name, ...pkg.targets.filter((target) => target.kind.includes('bin')).map((target) => target.name)])],
      // Each target by the build file and source path cargo test's Running line names, with the argument that reruns it.
      targets: pkg.targets.map((target) => ({
        key: `${target.name.replaceAll('-', '_')} ${relative(dirname(pkg.manifest_path), target.src_path).split(sep).join('/')}`,
        rerun: `-p ${pkg.name} ${kind(target) ? `--${kind(target)} ${target.name}` : '--lib'}`,
        doc: target.kind.includes('lib') ? target.name.replaceAll('-', '_') : null,
      })),
    };
  });
}

/**
 * What each file and crate imports and what it runs or reads, as edges to files, to folders (ending in /) and to
 * crates (crate:name). Code imports its specifiers, a package by its exports, and a crate the crates it depends on.
 * A test's own files and Rust files read every repository path their literals name, and a test runs each crate its
 * literals name; other code runs only the builds and binaries it names, as packages/cli/dist/main.js or debug/deep-hook.
 */
export function graph(cwd, files, workspace) {
  const set = new Set(files);
  const counts = new Map();
  for (const file of files) for (const folder of folders(file)) counts.set(folder, (counts.get(folder) ?? 0) + 1);
  const read = (file) => { try { return readFileSync(join(cwd, file), 'utf8'); } catch { return ''; } };
  const packages = new Map(files.filter((file) => /^packages\/[^/]+\/package\.json$/.test(file)).map((file) => {
    const { name, exports, dependencies } = JSON.parse(read(file));
    return [name, { dir: dirname(file), exports, dependencies }];
  }));
  const resolve = (path) => {
    const at = posix.normalize(path).replace(/\/$/, '').replace(/^(packages\/[^/]+)\/dist\//, '$1/src/');
    if (at.startsWith('..') || !at.includes('/')) return null;
    const stem = at.replace(/(?:\.d)?\.[cm]?js$/, '');
    const found = [at, ...['.ts', '.mts', '.tsx', '.js', '.mjs', '.cjs'].flatMap((extension) => [stem + extension, `${at}/index${extension}`])].find((candidate) => set.has(candidate));
    if (found) return found;
    return counts.has(at) && counts.get(at) <= WIDE ? `${at}/` : null;
  };
  const entry = (specifier) => {
    const [scope, name, ...rest] = specifier.split('/');
    const pkg = packages.get(`${scope}/${name}`);
    if (!pkg) return null;
    const sub = rest.length ? `./${rest.join('/')}` : '.';
    const map = pkg.exports && typeof pkg.exports === 'object' && Object.keys(pkg.exports).some((key) => key.startsWith('.')) ? pkg.exports : { '.': pkg.exports };
    const target = typeof map[sub] === 'string' ? map[sub] : map[sub]?.development ?? map[sub]?.types ?? map[sub]?.default;
    return resolve(posix.join(pkg.dir, target ?? (sub === '.' ? 'src/index.ts' : sub)));
  };
  const binaries = new Map(workspace.flatMap((crate) => crate.names.map((name) => [name, crate.name])));
  const NAMES = RegExp(`(?<![\\w-])(?:${[...binaries.keys()].sort((a, b) => b.length - a.length).join('|')})(?![\\w-])`, 'g');
  const imports = new Map(), runs = new Map(), spawns = new Map(), barrels = new Map();
  const link = (edges, node, target) => { if (target && target !== node) edges.set(node, (edges.get(node) ?? new Set()).add(target)); };
  const paths = (edges, node, texts, bases) => {
    for (const text of texts) {
      for (const [token] of text.matchAll(PATHS)) {
        const from = token.startsWith('.') ? bases : [''];
        const target = from.map((base) => resolve(posix.join(base, token.replace(/^\//, '')))).find(Boolean);
        // A package's build or its folder is started as a process, apart from a file read or imported.
        link(edges === runs && (token.includes('/dist/') || /^packages\/[^/]+\/$/.test(target ?? '')) ? spawns : edges, node, target);
      }
      for (const [specifier] of text.matchAll(PACKAGE)) link(edges, node, entry(specifier));
    }
  };
  // Each module once: what it imports, by name (null for the whole module), what it exports itself and what it
  // passes on from others, and its other literals. Type-only imports and exports don't run, so they aren't read.
  const modules = new Map();
  for (const file of files.filter((path) => CODE.test(path) && !path.split('/').includes('node_modules'))) {
    const module = { uses: [], local: new Set(), passed: new Map(), stars: [], texts: [] };
    const to = (specifier) => (specifier.startsWith('@deepbuild/') ? entry(specifier) : /^\.{0,2}\//.test(specifier) ? resolve(posix.join(specifier.startsWith('/') ? '' : dirname(file), specifier)) : null);
    const runtime = (elements) => elements.filter((element) => !element.isTypeOnly);
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const specifier = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
        if (ts.isImportDeclaration(node) && specifier && !node.importClause?.isTypeOnly) {
          const { name, namedBindings } = node.importClause ?? {};
          const names = namedBindings && ts.isNamedImports(namedBindings) && !name ? runtime(namedBindings.elements).map((element) => (element.propertyName ?? element.name).text) : null;
          if (!names || names.length) module.uses.push({ to: to(specifier), names });
        }
        if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
          const named = node.exportClause && ts.isNamedExports(node.exportClause) ? runtime(node.exportClause.elements) : [];
          if (specifier && !node.exportClause) module.stars.push(to(specifier));
          else if (specifier && ts.isNamespaceExport(node.exportClause)) module.passed.set(node.exportClause.name.text, { to: to(specifier), name: null });
          for (const element of named) {
            if (specifier) module.passed.set(element.name.text, { to: to(specifier), name: (element.propertyName ?? element.name).text });
            else module.local.add(element.name.text);
          }
        }
        return;
      }
      if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        const declared = ts.isVariableStatement(node) ? node.declarationList.declarations.map((declaration) => declaration.name.getText()) : [node.name?.text ?? 'default'];
        for (const name of declared) module.local.add(name);
      }
      if (ts.isExportAssignment(node)) module.local.add('default');
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) module.uses.push({ to: to(node.arguments[0].text), names: null });
      if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) module.texts.push(node.text);
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true));
    modules.set(file, module);
  }
  // The file that defines a name a module exports, through the modules that pass it on, as an entry's export ... from.
  const defining = (file, name, seen = new Set()) => {
    const module = modules.get(file);
    if (!module || seen.has(file)) return null;
    seen.add(file);
    if (module.local.has(name)) return file;
    const passed = module.passed.get(name);
    if (passed) return (passed.name !== null && passed.to && defining(passed.to, passed.name, seen)) || passed.to;
    for (const star of module.stars) {
      const found = star && defining(star, name, seen);
      if (found) return found;
    }
    return null;
  };
  for (const [file, module] of modules) {
    for (const { to: target, names } of module.uses) {
      if (!names) link(imports, file, target);
      else for (const name of names) link(imports, file, defining(target, name) ?? target);
      // A module imported by name is read by its importers too when it changes itself.
      if (names) link(barrels, file, target);
    }
    for (const target of [...module.stars, ...[...module.passed.values()].map((passed) => passed.to)]) link(imports, file, target);
    const own = underTestPaths(file);
    paths(runs, file, own ? module.texts : module.texts.filter((text) => text.includes('/dist/')), [dirname(file)]);
    for (const text of own ? module.texts : module.texts.filter((text) => binaries.has(text.replace(/^.*\/(?:debug|release)\//, '')))) {
      for (const [name] of text.matchAll(NAMES)) link(runs, file, `crate:${binaries.get(name)}`);
    }
  }
  for (const crate of workspace) {
    const node = `crate:${crate.name}`;
    for (const dep of crate.deps) link(imports, node, `crate:${dep}`);
    for (const file of files.filter((path) => path.endsWith('.rs') && [crate.dir, ...crate.away].some((folder) => within(folder, path)))) {
      const texts = [...read(file).matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map(([, text]) => text);
      paths(runs, node, texts, [dirname(file), crate.dir]);
    }
  }
  const near = new Map([...packages.values()].map(({ dir, dependencies }) => [dir, new Set([dir, ...Object.keys(dependencies ?? {}).map((name) => packages.get(name)?.dir).filter(Boolean)])]));
  return { imports, runs, spawns, barrels, near };
}

/**
 * The test files and crates a change reaches, the files it changes that every suite reads, those that reach none, and
 * the crates whose own Rust it edits. Imports and crate dependencies carry a change as far as they go; what a file
 * runs or reads carries it one step: to a test or crate that names a changed file or a file the change's code reaches,
 * or runs a crate whose own source changed, and from there along imports only, as from a helper to its tests.
 * A test that starts a package's build sees a change to that package or to one it depends on; one that sees it only
 * deeper, as a test starting the CLI sees the extension host through the hub, is `wide`: the release preflight runs it.
 */
export function select(cwd, changed, { files = listFiles(cwd), workspace = crates(cwd) } = {}) {
  const all = [...new Set([...files, ...changed])];
  const { imports, runs, spawns, barrels, near } = graph(cwd, all, workspace);
  const reverse = (edges) => {
    const users = new Map();
    for (const [node, targets] of edges) for (const target of targets) users.set(target, [...(users.get(target) ?? []), node]);
    return users;
  };
  const importers = reverse(imports), byName = reverse(barrels);
  const up = (seeds) => {
    const seen = new Set(), queue = [...seeds, ...seeds.flatMap((seed) => byName.get(seed) ?? [])];
    while (queue.length) {
      const node = queue.pop();
      if (seen.has(node)) continue;
      seen.add(node);
      for (const key of node.startsWith('crate:') ? [node] : [node, ...folders(node).map((folder) => `${folder}/`)]) queue.push(...importers.get(key) ?? []);
    }
    return seen;
  };
  const ownersOf = (path) => workspace.filter((crate) => (within(crate.dir, path) && !path.endsWith('.md')) || (path.endsWith('.rs') && crate.away.some((folder) => within(folder, path)))).map((crate) => `crate:${crate.name}`);
  const packageOf = (path) => path.match(/^packages\/[^/]+/)?.[0];
  const ends = (nodes) => [...nodes].filter((node) => isTestFile(node) || node.startsWith('crate:'));
  const reach = (path) => {
    const owners = ownersOf(path);
    const code = up([path, ...owners]);
    const under = new Set([...code].flatMap((node) => folders(node).map((folder) => `${folder}/`)));
    const hit = (target) => (target.startsWith('crate:') ? owners.includes(target) : code.has(target) || under.has(target));
    const close = (target) => !packageOf(path) || near.get(packageOf(target))?.has(packageOf(path));
    const ran = [...runs].filter(([, targets]) => [...targets].some(hit)).map(([node]) => node);
    const started = [...spawns].filter(([, targets]) => [...targets].some((target) => hit(target) && close(target))).map(([node]) => node);
    const deeper = [...spawns].filter(([, targets]) => [...targets].some(hit)).map(([node]) => node);
    const onward = (nodes) => [...nodes, ...up(nodes.filter((node) => !node.startsWith('crate:')))];
    const found = new Set(ends([...code, ...onward([...ran, ...started])]));
    return { found: [...found], wide: ends(onward(deeper)).filter((node) => !found.has(node)) };
  };
  const tests = new Set(), reached = new Set(), wide = new Set(), every = [], none = [];
  for (const path of changed) {
    if (EVERY.includes(path)) every.push(path);
    let { found, wide: far } = reach(path);
    // A fixture no test names by path is read by the tests of its own folder.
    if (!found.length && underTestPaths(path)) {
      const folder = path.match(/^(?:tests\/acceptance\/[^/]+|packages\/[^/]+\/test|tests)\//)?.[0];
      found = folder ? all.filter((file) => file.startsWith(folder) && isTestFile(file)) : [];
    }
    for (const node of found) (node.startsWith('crate:') ? reached : tests).add(node.replace(/^crate:/, ''));
    for (const node of far) wide.add(node.replace(/^crate:/, 'cargo test -p '));
    if (!found.length && !far.length && !path.endsWith('.md') && !EVERY.includes(path)) none.push(path);
  }
  const owners = [...new Set(changed.filter((path) => path.endsWith('.rs')).flatMap(ownersOf))].map((node) => node.slice(6));
  return { tests: [...tests].sort(), crates: [...reached].sort(), wide: [...wide].filter((node) => !tests.has(node) && !reached.has(node.replace('cargo test -p ', ''))).sort(), every, none, owners };
}

/** Which runner a test file is written for, by what it imports at its top level, else by its extension. */
export function runnerOf(file, source) {
  const imports = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false).statements.filter(ts.isImportDeclaration).map((statement) => statement.moduleSpecifier.text);
  if (imports.includes('vitest')) return 'vitest';
  if (imports.includes('node:test')) return 'node';
  return file.endsWith('.ts') ? 'vitest' : 'node';
}

/**
 * The selected test files by runner and block, after those lanes.mjs leaves to a person or to a lane of its own, and
 * apart from them, by runner, those it names timed, and those it names slow that `changed` neither adds nor edits.
 * The alone block holds those lanes.mjs names exclusive too, which `exclusive` names apart.
 */
export function plan(cwd, tests, changed = []) {
  const blocks = { parallel: { vitest: [], node: [] }, alone: { vitest: [], node: [] } }, timedFiles = { vitest: [], node: [] }, slowFiles = { vitest: [], node: [] }, skipped = [];
  for (const file of tests) {
    if (listed(byHand, file) || (file.startsWith('tests/acceptance/') && /\.live\.test\./.test(file))) skipped.push(`${file} (by hand)`);
    else if (listed(ownLane, file)) skipped.push(`${file} (a lane of its own)`);
    else (listed(timed, file) ? timedFiles : listed(slow, file) && !changed.includes(file) ? slowFiles : blocks[listed(alone, file) || listed(exclusive, file) ? 'alone' : 'parallel'])[runnerOf(file, readFileSync(join(cwd, file), 'utf8'))].push(file);
  }
  return { blocks, skipped, timed: timedFiles, slow: slowFiles };
}

/**
 * The alone block's files as groups, each of one lanes.mjs entry's files, run one at a time in one shard: those it names
 * exclusive apart, one group each, run after every shard has finished. The longest groups come first.
 */
export function shardGroups(files) {
  const entryOf = (file) => [...exclusive, ...alone].find((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry)) ?? file;
  const groups = new Map();
  for (const file of files) groups.set(entryOf(file), [...(groups.get(entryOf(file)) ?? []), file]);
  const all = [...groups.values()].sort((a, b) => b.length - a.length);
  return { shared: all.filter((group) => !listed(exclusive, group[0])), exclusive: all.filter((group) => listed(exclusive, group[0])) };
}

/** A lint's findings as keys without line numbers, so a finding main has still matches after lines move. */
export function lintFindings(cwd, name, output, status) {
  const lines = output.split('\n'), found = [], at = (path) => relative(cwd, join(cwd, path)).split(sep).join('/');
  lines.forEach((line, index) => {
    const own = line.match(/^(FAIL|BLOCKED|INVALID|INCONCLUSIVE) (.+)$/);
    if (own) found.push({ state: own[1], key: own[2].replace(/(\.\w+):\d+(?::\d+)?/g, '$1') });
    const diff = line.match(/^Diff in (.+?\.rs)(?::\d+)?:?\s*$/);
    if (diff) found.push({ state: 'FAIL', key: `fmt: ${relative(cwd, diff[1]).split(sep).join('/')}` });
    const located = line.match(/^error(?:\[[\w:]+\])?: (.+)$/) && lines[index + 1]?.match(/^\s*--> (.+?):\d+:\d+/);
    if (located) found.push({ state: 'FAIL', key: `clippy: ${at(located[1])} ${line.replace(/^error(?:\[[\w:]+\])?: /, '')}` });
  });
  if (status !== 0 && !found.length) found.push({ state: 'FAIL', key: `${name}: exited ${status}: ${lines.find((line) => /error/i.test(line)) ?? lines.find(Boolean) ?? ''}` });
  return found;
}

/**
 * Each failure as new, already failing on main (the baseline names it, or its lint finding as many times), or
 * INCONCLUSIVE for a timing budget the baseline names when the load is above the core count, where a Mac can't measure
 * it; at or below the core count the budget was measurable, so its failure stands.
 */
export function classify(failures, findings, baseline, load = loadavg()[0]) {
  const loaded = load > availableParallelism();
  const known = [], fresh = [], unsure = [];
  for (const failure of failures) {
    if (failure.state !== 'FAIL') unsure.push(failure);
    else if (loaded && baseline.timing.includes(failure.id)) unsure.push({ ...failure, state: 'INCONCLUSIVE', message: `a timing budget, unmeasured at load ${load.toFixed(0)}` });
    else if (baseline.failures[failure.id]) known.push({ ...failure, message: baseline.failures[failure.id] });
    else fresh.push(failure);
  }
  const counts = new Map();
  for (const { state, key } of findings) {
    if (state !== 'FAIL') { unsure.push({ id: key, state, message: '' }); continue; }
    counts.set(key, (counts.get(key) ?? 0) + 1);
    (counts.get(key) <= (baseline.lint[key] ?? 0) ? known : fresh).push({ id: key, state, message: 'lint' });
  }
  return { known, fresh, unsure };
}

// Each job runs through the machine's throttle table (docs/parallel-proof.md, section 6): the workspace build, clippy and
// cargo test as build, the vitest and node --test blocks as test and the timed ones as timed, waiting at most 30 minutes
// for its grant; each, its parallel blocks too, under a cpu.slot of the calling session's through scripts/lease (#1015).
// A lint script that builds nothing (LIGHT) reads files for seconds on one core, so it waits for no grant: in the build
// class it queued behind a neighbour's cargo build for up to 30 minutes, and in the test class behind this run's own
// blocks. It still runs under the session's cpu.slot. A shard's job runs in its shard.
const LIGHT = /^lint scripts\/(?:repo-rules|conformance-lint|slots-check|canvas-closures|record-reader-guard|color-literal-guard|guide)\.mjs$/;
function run(logs, label, command, args, env = {}, cwd = root) {
  const log = join(logs, `${label.replace(/\W+/g, '-')}.log`);
  const descriptor = openSync(log, 'w');
  const cls = label.endsWith('timed') ? 'timed' : /^(?:vitest|node)/.test(label) ? 'test' : 'build';
  const leased = [join(root, 'scripts/lease'), command, ...args];
  return new Promise((done) => {
    const child = spawn(LIGHT.test(label) ? leased[0] : process.execPath, LIGHT.test(label) ? leased.slice(1) : [join(root, 'scripts/throttle.mjs'), cls, '--wait', '30', '--', ...leased], { cwd, stdio: ['ignore', descriptor, descriptor], env: childEnv(env) });
    child.on('error', (error) => { closeSync(descriptor); done({ label, log, status: null, output: String(error) }); });
    child.on('close', (status) => { closeSync(descriptor); done({ label, log, status, output: readFileSync(log, 'utf8') }); });
  });
}

// How many shards the alone block runs in: half the cores. An alone file keeps about one core busy (1,976 s of CPU in
// 2,235 s for #1557's, 2026-11-07), so half the cores leave the rest to the parallel block beside it. DEEP_SHARDS sets
// it for one run, and 1 runs the block one file at a time in the worktree, as before shards.
const SHARDS = Number(process.env.DEEP_SHARDS) || Math.max(1, Math.floor(availableParallelism() / 2));

/**
 * Runs groups of the alone block (shardGroups), each one file at a time, in `places` taken in turn as each frees: shards,
 * or the worktree. Each job names its files and where it ran, so its report reads from there.
 */
async function runGroups(groups, places, files, vitest, node, label, env = {}, more = () => true) {
  const jobs = [], queue = [...groups];
  let at = 0;
  const worker = async (cwd) => {
    while (queue.length && more()) {
      const group = queue.shift(), name = `${label}-${at++}`;
      const by = { vitest: group.filter((file) => files.vitest.includes(file)), node: group.filter((file) => files.node.includes(file)) };
      if (by.vitest.length) jobs.push({ ...await vitest(by.vitest, ['--no-file-parallelism'], `vitest-${name}`, cwd, env), files: by.vitest, cwd });
      if (by.node.length) jobs.push({ ...await node(by.node, ['--test-concurrency=1'], `node-${name}`, cwd, env), files: by.node, cwd });
    }
  };
  await Promise.all(places.map(worker));
  return { jobs, left: queue };
}

async function main(args) {
  const started = performance.now();
  const paths = args.filter((arg) => !arg.startsWith('--'));
  const changed = paths.length ? paths : changedPaths(root);
  if (!changed) return console.log('BLOCKED affected: no merge base with origin/main; name the changed paths'), 3;
  const workspace = crates(root);
  const selection = select(root, changed, { workspace });
  if (args.includes('--wide')) {
    selection.tests = [...new Set([...selection.tests, ...selection.wide.filter((node) => !node.startsWith('cargo '))])].sort();
    selection.crates = [...new Set([...selection.crates, ...selection.wide.filter((node) => node.startsWith('cargo ')).map((node) => node.slice(14))])].sort();
    selection.wide = [];
  }
  const { blocks, skipped, timed: timedFiles, slow: slowFiles } = plan(root, selection.tests, changed);
  const runTimed = args.includes('--timed'), runSlow = args.includes('--slow');
  const unrunTimed = runTimed ? [] : [...timedFiles.vitest, ...timedFiles.node].sort();
  const unrunSlow = runSlow ? [] : [...slowFiles.vitest, ...slowFiles.node].sort();
  // With --slow, the slow files join the blocks lanes.mjs gives them.
  if (runSlow) for (const runner of ['vitest', 'node']) for (const file of slowFiles[runner]) blocks[listed(alone, file) || listed(exclusive, file) ? 'alone' : 'parallel'][runner].push(file);
  for (const [block, runners] of Object.entries({ ...blocks, timed: timedFiles, ...!runSlow && { slow: slowFiles } })) for (const [runner, files] of Object.entries(runners)) if (files.length) console.log(`${block} ${runner}: ${files.join(' ')}${block === 'timed' && !runTimed ? ' (--timed runs them)' : block === 'slow' ? ' (--slow runs them)' : ''}`);
  if (selection.crates.length) console.log(`parallel cargo test: ${selection.crates.join(' ')}`);
  for (const line of skipped) console.log(`SKIP ${line}`);
  for (const path of selection.none) console.log(`NOTE ${path} reaches no test`);
  if (selection.wide.length) console.log(`WIDE ${selection.wide.length} more see the change only through a process that starts another package (--wide runs them): ${selection.wide.join(' ')}`);
  if (args.includes('--list')) return 0;

  const logs = mkdtempSync(join(tmpdir(), 'deep-affected-'));
  const binaries = new Map(), binRoot = join(logs, 'binaries');
  watchBinaries(binRoot);
  const files = [...Object.values(blocks).flatMap((block) => [...block.vitest, ...block.node]), ...runTimed ? [...timedFiles.vitest, ...timedFiles.node] : []];
  const binEnv = (cwd = root) => ({ DEEP_BIN_DIR: binaries.get(cwd) });
  const prepareBinaries = (cwd, selected) => binaries.set(cwd, buildBinaries(cwd, join(binRoot, String(binaries.size), 'bin'), binaryNames(cwd, selected)));
  let shards = [], grant = null;
  try {
    const vitest = (files, extra, label, cwd, env = {}) => run(logs, label, process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...extra, '--reporter=dot', '--reporter=./scripts/proof-vitest-reporter.mjs', ...files], { ...env, ...binEnv(cwd), DEEP_PROOF_VITEST_REPORT: join(logs, `${label}.jsonl`) }, cwd);
    const node = (files, extra, label, cwd, env = {}) => run(logs, label, process.execPath, ['--test', ...extra, '--test-reporter=./scripts/proof-reporter.mjs', `--test-reporter-destination=${join(logs, `${label}.jsonl`)}`, '--test-reporter=dot', '--test-reporter-destination=stdout', ...files], { ...env, ...binEnv(cwd) }, cwd);
    const jobs = [];
    // Tests that run a package's build read dist, so a change to a package builds them first, as the typecheck lane does.
    if (changed.some((path) => /^packages\/[^/]+\/src\//.test(path))) jobs.push(await run(logs, 'build', 'npm', ['run', 'build', '--workspaces']));
    // Shards copy the worktree's package builds, so they are claimed once those are built.
    const groups = shardGroups([...blocks.alone.vitest, ...blocks.alone.node]);
    shards = groups.shared.length > 1 && SHARDS > 1 ? await claimShards(root, Math.min(SHARDS, groups.shared.length), (line) => console.log(line)) : [];
    // All final executables are captured before any consumer or sibling cargo test starts. Each shard builds
    // from its own checkout; its first use covers every group it could take from the shared queue.
    prepareBinaries(root, files);
    for (const { dir } of shards) prepareBinaries(dir, groups.shared.flat());
    // With shards, the run's test jobs, its parallel blocks and the shards alike, are one block under one test grant, taken
    // here before any of them asks: each job's own request passes through on it from this process, its holder, so the
    // run holds one of the machine's test slots, never one per block. With none in 30 minutes, the shards go, and each job
    // asks for its own grant as with no shard.
    grant = shards.length ? acquire('test', { wait: 30 }) : null;
    if (shards.length && !grant) {
      console.log('SHARD no test grant came within 30 min, so the alone block runs in the worktree');
      for (const shard of shards) shard.release();
      shards = [];
    }
    const held = grant ? { DEEP_THROTTLE: grant.token } : {};
    const lints = checks.find(({ name }) => name === 'lint').commands.filter(([, script]) => script?.startsWith('scripts/'));
    if (selection.owners.length) lints.push(['cargo', 'fmt', '--all', '--', '--check'], ['cargo', 'clippy', '--locked', '--keep-going', '--all-targets', ...selection.owners.flatMap((name) => ['-p', name]), '--', '-D', 'warnings']);
    const beside = [
      ...blocks.parallel.vitest.length ? [vitest(blocks.parallel.vitest, [], 'vitest', root, held)] : [],
      ...blocks.parallel.node.length ? [node(blocks.parallel.node, [], 'node', root, held)] : [],
      ...selection.crates.length ? [run(logs, 'cargo', 'cargo', ['test', '--locked', '--no-fail-fast', ...selection.crates.flatMap((name) => ['-p', name])])] : [],
      ...lints.map(([command, ...rest]) => run(logs, `lint ${rest.find((arg) => arg.startsWith('scripts/')) ?? rest[0]}`, command, rest)),
    ];
    // The shards run beside those, since no shard's build writes the worktree's target/.
    // A shard takes its next group only while the disk keeps its floor, since other sessions fill it too; the groups it
    // leaves run in the worktree after the rest.
    const inShards = shards.length ? runGroups(groups.shared, shards.map(({ dir }) => dir), blocks.alone, vitest, node, 'alone', held, roomy) : null;
    jobs.push(...await Promise.all(beside));
    let left = groups.shared;
    try {
      if (inShards) {
        const sharded = await inShards;
        jobs.push(...sharded.jobs);
        left = sharded.left;
      }
    } finally {
      for (const shard of shards) shard.release();
      shards = [];
    }
    if (inShards && left.length) console.log(`SHARD ${left.length} alone ${left.length === 1 ? 'group runs' : 'groups run'} in the worktree: the disk fell under its floor`);
    // Without shards the block runs in the worktree after the rest, one group at a time; the exclusive groups always do.
    jobs.push(...(await runGroups([...left, ...groups.exclusive], [root], blocks.alone, vitest, node, 'alone-worktree', held)).jobs);
    release(grant);
    grant = null;
    if (runTimed && timedFiles.vitest.length) jobs.push(await vitest(timedFiles.vitest, ['--no-file-parallelism'], 'vitest-timed'));
    if (runTimed && timedFiles.node.length) jobs.push(await node(timedFiles.node, ['--test-concurrency=1'], 'node-timed'));

    const failures = [], passed = [], findings = [], skips = [];
    for (const job of jobs) {
      const tests = /^(?:vitest|node)/.test(job.label);
      let report = '';
      try { if (tests) report = readFileSync(join(logs, `${job.label}.jsonl`), 'utf8'); } catch {}
      const results = reportResults(job.cwd ?? root, report, job.label);
      // A job the throttle didn't run, for want of a grant or of its table, ran nothing, so none of its results is read:
      // it is unrun, never a failure on main. A vitest job's marker names each of its files; any other's output says so.
      const [, state, message] = results.noGrant ? [] : job.output.match(/^(INCONCLUSIVE|BLOCKED) (no grant|throttle): (.*)/) ?? [];
      if (state) {
        failures.push({ id: `${job.label} job`, state, message });
        continue;
      }
      if (job.label === 'build' && job.status !== 0) failures.push({ id: 'npm run build --workspaces', state: 'FAIL', message: job.output.split('\n').find((line) => /error/.test(line)) ?? '' });
      if (job.label.startsWith('lint')) findings.push(...lintFindings(root, job.label.slice(5), job.output, job.status));
      if (job.label === 'cargo') { const cargo = cargoResults(job.output, job.status, workspace); failures.push(...cargo.failures); passed.push(...cargo.passed); skips.push(...cargo.skips ?? []); }
      if (tests) {
        const files = job.files ?? ({ ...blocks, timed: timedFiles })[job.label.split('-')[1] ?? 'parallel'][job.label.split('-')[0]];
        failures.push(...results.failures);
        passed.push(...results.passed);
        skips.push(...results.skips ?? []);
        // A file that reported no test didn't run, and nothing unrun passes.
        for (const file of files.filter((file) => !report.includes(file))) failures.push({ id: named(file, '(file)'), state: results.noGrant ? 'INCONCLUSIVE' : 'FAIL', message: results.noGrant ?? 'reported no test' });
      }
    }
    const baseline = JSON.parse(readFileSync(join(root, BASELINE), 'utf8'));
    const { covered, open } = readSkips(skips, baseline.skips, timed);
    const { known, fresh, unsure } = classify([...failures, ...open], findings, baseline);
    if (args.includes('--record')) {
      for (const id of passed) delete baseline.failures[id];
      for (const { id, message } of fresh.filter(({ message }) => message !== 'lint')) baseline.failures[id] = message || 'fails on main';
      const counts = new Map();
      for (const { state, key } of findings) if (state === 'FAIL') counts.set(key, (counts.get(key) ?? 0) + 1);
      for (const [key, count] of counts) baseline.lint[key] = Math.max(count, baseline.lint[key] ?? 0);
      writeFileSync(join(root, BASELINE), `${JSON.stringify(baseline, null, 2)}\n`);
    }
    for (const { id, message } of known) console.log(`KNOWN ${id}${message === 'lint' ? '' : `: ${message}`}`);
    for (const { id, state, message } of unsure) console.log(`${state} ${id}${message ? `: ${message}` : ''}`);
    for (const { id, note, reason } of covered) console.log(`LISTED ${id}${note ? `: ${note}` : ''} (${reason})`);
    for (const id of passed.filter((id) => baseline.failures[id])) console.log(`NOTE ${id} passes; remove it from ${BASELINE}`);
    for (const { id, message } of fresh) console.log(`NEW FAIL ${id}${message && message !== 'lint' ? `: ${message}` : ''}`);
    for (const path of selection.every) console.log(`INCONCLUSIVE ${path} feeds every suite; run npm run preflight`);
    if (selection.wide.length) console.log(`INCONCLUSIVE ${selection.wide.length} suites that see the change through another package's process were not run; the release preflight or --wide runs them`);
    if (unrunTimed.length) console.log(`INCONCLUSIVE ${unrunTimed.length} timed ${unrunTimed.length === 1 ? 'file was' : 'files were'} not run; --timed runs them under a timed grant: ${unrunTimed.join(' ')}`);
    if (unrunSlow.length) console.log(`INCONCLUSIVE ${unrunSlow.length} slow ${unrunSlow.length === 1 ? 'file was' : 'files were'} not run; --slow runs them: ${unrunSlow.join(' ')}`);
    console.log(`TIMED the timed list, from scripts/lanes.mjs (${timed.length}): ${timed.join(' ')}`);
    const state = fresh.length ? 'FAIL' : worst(unsure.map(({ state }) => state)) ?? (selection.every.length || selection.wide.length || unrunTimed.length || unrunSlow.length ? 'INCONCLUSIVE' : known.length ? 'NO NEW FAILURES' : 'PASS');
    console.log(`${state} affected: ${fresh.length} new, ${known.length} already failing on main, ${unsure.length} inconclusive or blocked, ${covered.length} listed skips, ${passed.length} passed, in ${((performance.now() - started) / 1000).toFixed(0)} s at load ${loadavg()[0].toFixed(0)}; logs in ${logs}`);
    return { FAIL: 1, INCONCLUSIVE: 2, BLOCKED: 3, INVALID: 3 }[state] ?? 0;
  } catch (error) {
    console.log(`${/^(?:BLOCKED|INCONCLUSIVE)\b/.test(error.message) ? '' : 'BLOCKED test binaries: '}${error.message}`);
    return error.message.startsWith('INCONCLUSIVE') ? 2 : 3;
  } finally {
    release(grant);
    for (const shard of shards) shard.release();
    rmSync(binRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
