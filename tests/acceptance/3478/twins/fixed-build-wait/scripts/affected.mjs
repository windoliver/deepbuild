// The suites a change can reach, and only those (AGENTS.md, Proof). A test file is reached when it imports a changed
// file, near or far, through the packages' entries, names its path or a dist build of it, or runs a crate the change
// reaches; a crate when it or a crate it depends on changed. Each runs with its own runner: vitest or node --test by
// what the file imports, cargo test for crates. A run asks for one test grant before it starts anything and runs every
// untimed job on it (docs/parallel-proof.md, section 6): with none in the wait nothing runs and every file reads
// INCONCLUSIVE, and BLOCKED when the throttle's table can't be used. The files lanes.mjs runs alone run one at a time after everything
// else, which runs in parallel, and those it leaves to a person or to a lane of its own don't run: they leave the run
// INCONCLUSIVE, naming them. Its timed files run last, one at a time
// under a timed grant, and only with --timed: unrun, they leave the run INCONCLUSIVE. Failures main already has
// (known-failures.json) read apart from new ones, and a timing budget missed at a load above the core count reads INCONCLUSIVE. So does a
// skip, or BLOCKED by its note, unless the same file's `skips` list covers it, which is printed.
//
//   node scripts/affected.mjs [--list] [--wide] [--settled] [--timed] [--slow] [--results=<file>] [path ...]
//   node scripts/affected.mjs --alone [--timed] [--slow] [--results=<file>] [--kept=<key>]
//
// --alone runs the unit lane's alone block whole, the files lanes.mjs's aloneCommand lists, whatever the change, and
// nothing else: the preflight's unit lane runs it so (#3137; docs/parallel-proof.md, section 7a). --results then holds
// each test's result too. --kept, from scripts/preflight alone, names the kept results of this tree (#3296, section 7b):
// a file done there is read, and each job that ends keeps its own.
//
// A suite of a closed issue on the main watch's settled list that the change reaches only through a process the suite
// starts is left to the watch, named on one SETTLED line, and the run reads INCONCLUSIVE; --settled runs it (settled,
// below; #3064).
//
// The alone block's folders run side by side, each in a shard of its own (scripts/shards.mjs), so no sibling's cargo
// build rewrites a binary under it; those lanes.mjs names exclusive run after, one at a time, with nothing beside them.
// The run's test grant is its admission, and each job takes a turn on the machine's pool of job tokens, which its
// builds' compiles draw on too (throttle.mjs, #3221), so the runs never compile more at once than the pool.
// The files lanes.mjs names slow run only with --slow, or when the change adds or edits them; unrun, they leave the run
// INCONCLUSIVE, as the timed ones do.
//
// Paths stand for the change, which is otherwise the worktree against its merge base with origin/main. --list prints
// the selection without running it. A test that starts a package's build is selected when the change is in that
// package or the test is in the changed file's own package; otherwise it is WIDE, and --wide also runs it (select, below).
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { availableParallelism, constants, homedir, loadavg, tmpdir } from 'node:os';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { alone, aloneCommand, byHand, cargoResults, changedPaths, checks, crates, exactTree, exclusive, listed, ownLane, readSkips, reportResults, slow, timed, worst } from './lanes.mjs';
import { isTestFile, listFiles, named, underTestPaths } from './proof-change.mjs';
import { namedByConfig } from './proof-guard.mjs';
import { childEnv } from './proof-runs.mjs';
import { binaryNames, binaryPlan, buildBinaries, buildInPlace, builtIn, commandFiles, watchBinaries } from './proof-binaries.mjs';
import { claimShards, cloneBuilds, roomy, shardsRoom } from './shards.mjs';
import { acquire, asking, descendants, killTree, release } from './throttle.mjs';

export { cargoResults, crates, reportResults };

const root = fileURLToPath(new URL('../', import.meta.url));
const BASELINE = 'scripts/known-failures.json';
const CODE = /\.(?:[cm]?[jt]s|tsx)$/;
// Files every suite reads, so a change to one is verified by the full preflight; so are those a runner config names, as
// its setup files (select, below). .cargo/config.toml's [patch] tables reach every crate under the checkout, the
// standalone test crates' locks among them (#2469).
const EVERY = ['package.json', 'package-lock.json', 'tsconfig.json', 'vitest.config.ts', 'Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', '.cargo/config.toml'];
// A folder holding more files than this, as tests/acceptance, is named as a pattern, not as what a file reads.
const WIDE = 400;
// Repository paths in a literal: relative ones, and those from the root, as `${root}/packages/hub/dist/main.js`.
const PATHS = /(?<![\w.@-])(?:\.{1,2}\/[\w@.\/-]*|\/?(?:packages|crates|scripts|tests|contracts|lint|adapters|skills)\/[\w@.\/-]+)/g;
const PACKAGE = /@deepbuild\/[\w-]+(?:\/[\w.-]+)*/g;
const within = (folder, path) => path === folder || path.startsWith(`${folder}/`);
const folders = (path) => path.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'));

/**
 * What each file and crate imports and what it runs or reads, as edges to files, to folders (ending in /) and to
 * crates (crate:name). Code imports its specifiers, a package by its exports, and a crate the crates it depends on.
 * A test's own files and Rust files read every repository path their literals name, and a test runs each crate its
 * literals name; other code runs only the builds and binaries it names, as packages/cli/dist/main.js or debug/deep-hook.
 * A budget task of benchmarks/budgets.json, `task:<id>`, imports what its command runs: each file it names and each
 * crate whose binary it names, as target/debug/deep-hook (#1981).
 */
export function graph(cwd, files, workspace, tasks = []) {
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
        // A package's build that names no source file of its own, as dist/main.js beside src/index.ts, starts that package.
        const own = token.match(/^\/?(packages\/[^/]+)\/dist\//)?.[1];
        const target = from.map((base) => resolve(posix.join(base, token.replace(/^\//, '')))).find(Boolean) ?? (own && set.has(`${own}/package.json`) ? `${own}/` : null);
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
  // A script or binary that runs takes in all it imports or links, so a task's command is its imports.
  for (const { id, command } of tasks) {
    for (const part of command.map((part) => posix.normalize(part))) {
      const binary = binaries.get(part.replace(/^.*\/(?:debug|release)\//, ''));
      link(imports, `task:${id}`, set.has(part) ? part : resolve(part));
      link(imports, `task:${id}`, binary && `crate:${binary}`);
    }
  }
  return { imports, runs, spawns, barrels };
}

/**
 * The test files and crates a change reaches, the files it changes that every suite reads, those that reach none, and
 * the crates whose own Rust it edits. Imports and crate dependencies carry a change as far as they go; what a file
 * runs or reads carries it one step: to a test or crate that names a changed file or a file the change's code reaches,
 * or runs a crate whose own source changed, and from there along imports only, as from a helper to its tests.
 * A test that starts a package's build sees a change to that package, or to any package when the test is in the changed
 * file's own package; one that sees it only deeper, as a test starting the CLI sees the hub, is `wide`: --wide, the main
 * watch and the release preflight run it.
 * Of the budget `tasks` given, `tasks` names those a budget window runs: each the change reaches or marks wide, each
 * the graph can't place, and all of them when it changes a file every suite reads (#1981).
 * `through` names the tests, selected or wide, that the change reaches only through a process they start, a Rust binary
 * or a package's build: none of its paths reaches them, or any test of their suite's folder, by import or by a file
 * they or their helpers read by path, and none is in a package one of those imports from (#3064).
 */
export function select(cwd, changed, { files = listFiles(cwd), workspace = crates(cwd), tasks = [] } = {}) {
  const all = [...new Set([...files, ...changed])];
  const { imports, runs, spawns, barrels } = graph(cwd, all, workspace, tasks);
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
  // A test under a package's fixtures/ is a fixture project's own, a wrong program's among them, never one of the repo's (#2136).
  const ends = (nodes) => [...nodes].filter((node) => (isTestFile(node) && !/^packages\/[^/]+\/fixtures\//.test(node)) || /^(?:crate|task):/.test(node));
  const task = (node) => node.startsWith('task:');
  const onward = (nodes) => [...nodes, ...up(nodes.filter((node) => !node.startsWith('crate:')))];
  // The tests a package is their own to (#3064): those that import one of its files, near or far, with no process between.
  const owned = new Map();
  const ownTests = (folder) => {
    if (!owned.has(folder)) owned.set(folder, new Set(ends(up(all.filter((file) => within(folder, file))))));
    return owned.get(folder);
  };
  const reach = (path) => {
    const owners = ownersOf(path);
    const code = up([path, ...owners]);
    const under = new Set([...code].flatMap((node) => folders(node).map((folder) => `${folder}/`)));
    const hit = (target) => (target.startsWith('crate:') ? owners.includes(target) : code.has(target) || under.has(target));
    // A started build sees a change in its own package, and a test in the changed file's package sees it too, whichever
    // file starts the build (#2574).
    const own = (node) => !packageOf(path) || packageOf(node) === packageOf(path);
    const ran = [...runs].filter(([, targets]) => [...targets].some(hit)).map(([node]) => node);
    const started = [...spawns].filter(([, targets]) => [...targets].some((target) => hit(target) && own(target))).map(([node]) => node);
    const deeper = [...spawns].filter(([, targets]) => [...targets].some(hit)).map(([node]) => node);
    // A task runs a binary as cargo builds it, from its crate and every crate that one depends on.
    const built = [...runs].filter(([, targets]) => [...targets].some((target) => target.startsWith('crate:') && code.has(target))).map(([node]) => node);
    const found = new Set(ends([...code, ...onward([...ran, ...started]), ...onward(deeper).filter(own), ...onward(built).filter(task)]));
    // Reached with no process between (#3064): by import, or by a file a test or its helper reads by path.
    const read = [...runs].filter(([, targets]) => [...targets].some((target) => !target.startsWith('crate:') && hit(target))).map(([node]) => node);
    return { found: [...found], wide: ends(onward(deeper)).filter((node) => !found.has(node)), near: new Set(ends([...code, ...onward(read)])) };
  };
  const tests = new Set(), reached = new Set(), wide = new Set(), every = [], none = [], touched = new Set(), direct = new Set();
  // The files a runner config names, as the guard reads them: its setup files and the config modules it imports.
  const setup = namedByConfig(cwd, null, all);
  const feedsEvery = (path) => EVERY.includes(path) || setup.has(path);
  for (const path of changed) {
    if (feedsEvery(path)) every.push(path);
    let { found, wide: far, near } = reach(path);
    for (const node of [...found, ...far].filter(task)) touched.add(node.slice(5));
    [found, far] = [found, far].map((nodes) => nodes.filter((node) => !task(node)));
    // A fixture no test names by path is read by the tests of its own folder.
    if (!found.length && underTestPaths(path)) {
      const folder = path.match(/^(?:tests\/acceptance\/[^/]+|packages\/[^/]+\/test|tests)\//)?.[0];
      found = folder ? all.filter((file) => file.startsWith(folder) && isTestFile(file)) : [];
      near = new Set(found);
    }
    const home = packageOf(path);
    for (const node of [...near, ...(home ? ownTests(home) : [])]) direct.add(node);
    // A test the change deletes has nothing to run.
    for (const node of found) if (node.startsWith('crate:') || existsSync(join(cwd, node))) (node.startsWith('crate:') ? reached : tests).add(node.replace(/^crate:/, ''));
    for (const node of far) wide.add(node.replace(/^crate:/, 'cargo test -p '));
    if (!found.length && !far.length && !path.endsWith('.md') && !feedsEvery(path)) none.push(path);
  }
  const owners = [...new Set(changed.filter((path) => path.endsWith('.rs')).flatMap(ownersOf))].map((node) => node.slice(6));
  const runsTask = ({ id }) => every.length || touched.has(id) || !imports.has(`task:${id}`);
  // A suite is reached with no process between when any test of its folder is, selected or not.
  const directly = new Set([...direct].map(suiteOf));
  const through = [...new Set([...tests, ...wide])].filter((file) => isTestFile(file) && !direct.has(file) && !(suiteOf(file) && directly.has(suiteOf(file)))).sort();
  return { tests: [...tests].sort(), crates: [...reached].sort(), wide: [...wide].filter((node) => !tests.has(node) && !reached.has(node.replace('cargo test -p ', ''))).sort(), every, none, owners, tasks: tasks.filter(runsTask).map(({ id }) => id), through };
}

// The main watch's settled list (docs/parallel-proof.md, sections 7a and 12b; #3064), in the HOME the run was given.
const LIST = join(homedir(), '.deepbuild', 'main-watch', 'settled.json');
const suiteOf = (file) => file.match(/^tests\/acceptance\/\d+\//)?.[0];

/**
 * The selected suites left to the main watch, as their folders: each on the watch's list with the files the worktree
 * holds for it, whose selected files the change reaches only through a process (select's `through`), and which the
 * change neither names by its issue nor touches. `problem` says why no list could be read: nothing is settled then.
 */
function settled(cwd, { tests, through }, changed) {
  let suites;
  try {
    const list = JSON.parse(readFileSync(LIST, 'utf8'));
    ({ suites } = list);
    if (typeof list.tree !== 'string' || !suites || typeof suites !== 'object' || Array.isArray(suites) || Object.values(suites).some((id) => typeof id !== 'string')) throw Error('it names no tree, or no suites by folder and ID');
  } catch (error) {
    return { folders: [], problem: error.code === 'ENOENT' ? `${LIST} is missing` : `${LIST} can't be read (${error.message})` };
  }
  const far = new Set(through);
  const candidates = [...new Set(tests.map(suiteOf))].filter((folder) => folder && Object.hasOwn(suites, folder)
    && tests.filter((file) => file.startsWith(folder)).every((file) => far.has(file)) && !changed.some((path) => path.startsWith(folder)));
  if (!candidates.length) return { folders: [] };
  const git = (...args) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 2 ** 28 });
  // The issues the change's commits name, by the pattern the trace lane reads them with (readIssue, proof-change.mjs),
  // in any repository's spelling. Commits that can't be read might name any suite's, so nothing is left then.
  const base = git('merge-base', 'HEAD', 'origin/main');
  const messages = base.status === 0 ? git('log', '--format=%B', `${base.stdout.trim()}..HEAD`) : base;
  if (messages.status !== 0) return { folders: [] };
  const named = new Set([...messages.stdout.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part of):?\s+(?:[\w.-]+\/[\w.-]+#|https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/|#)(\d+)\b/gi)].map(([, number]) => number));
  // Each suite's folder as the worktree holds it now, uncommitted and untracked files too.
  const held = new Map((git('ls-tree', exactTree(cwd) ?? '', 'tests/acceptance/').stdout ?? '').split('\n').flatMap((line) => {
    const [, id, path] = line.match(/^\d+ tree (\w+)\t(.+)$/) ?? [];
    return id ? [[`${path}/`, id]] : [];
  }));
  return { folders: candidates.filter((folder) => held.get(folder) === suites[folder] && !named.has(folder.split('/')[2])).sort() };
}

/**
 * The unit lane's alone block as a selection (#3137): the files lanes.mjs's aloneCommand lists, by vitest's own listing,
 * whatever the change. Throws BLOCKED when vitest can't list them.
 */
function aloneBlock() {
  const tests = commandFiles(root, aloneCommand).map((file) => relative(realpathSync(root), realpathSync(resolve(root, file))).split(sep).join('/'));
  return { tests: tests.sort(), crates: [], wide: [], every: [], none: [], owners: [] };
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
// cargo test as build, the vitest and node --test blocks as test, each passing through on the run's one test grant
// (queued, below) and taking its turn on the machine's pool, and the timed ones as timed, waiting at most 30 minutes for their own; each, its parallel blocks
// too, under a cpu.slot of the calling session's through scripts/lease (#1015). A lint script that builds nothing
// (LIGHT) reads files for seconds on one core, so it asks for no grant. It still runs under the session's cpu.slot. A
// shard's job runs in its shard.
const LIGHT = /^lint scripts\/(?:repo-rules|conformance-lint|slots-check|canvas-closures|record-reader-guard|color-literal-guard|guide)\.mjs(?: \w+)?$/;
// A lint job's label: its script, and the subcommand after it when it has one, so two runs of one script keep a log each (#2136).
const lintLabel = (rest) => {
  const at = rest.findIndex((arg) => arg.startsWith('scripts/'));
  return `lint ${at < 0 ? rest[0] : rest.slice(at, /^\w+$/.test(rest[at + 1] ?? '') ? at + 2 : at + 1).join(' ')}`;
};
// The jobs running now, so a run stopped by its PID stops them too (main): they pass through on its one grant, which is
// free once it has ended, so a job left running would run beside the next run uncounted. Once stopped, the run starts
// no job: each reads as run by none.
const live = new Set();
let stopped = null;
// What a stopped run's tests leave in the shared temporary folder, their clean-up skipped (#2857): 605's repo copies
// and 305's deep-show copies, about 1 GB each. A run removes those a day old before it starts any job: no test of
// either runs that long, and what other tests keep there on purpose, such as 1455's base trees, stays.
const LEFTOVER = /^deep-(?:605|305)-/;
function sweepLeftovers() {
  for (const name of readdirSync(tmpdir()).filter((entry) => LEFTOVER.test(entry))) {
    const path = join(tmpdir(), name);
    try {
      if (Date.now() - statSync(path).mtimeMs > 86_400_000) rmSync(path, { recursive: true, force: true });
    } catch {}
  }
}
// A test job whose log and report have both stood still for IDLE minutes is stopped (#2627): a test that starves its
// worker's event loop defeats vitest's own limit (#2783), and a handle a test leaks keeps its file from exiting (#2804),
// either for ever. The bound is above the longest stretch a test may write nothing: #1781's 120 min build hook runs
// before its 120 min tests with no result between, and the timed lane's limits reach 240 min (#416, #140). SIGTERM to the job, and
// 10 s later SIGKILL to every process of its tree, by PID and start, as the throttle does for a grant past its bound
// (#2744); the job's throttle, then, ends by itself and gives its grant back. The job ends once they have, and reads
// by what it reported before the stop. A job still waiting for its turn has started nothing, so its wait never counts
// (#3221). DEEP_JOB_IDLE_MIN sets the bound in minutes, for tests.
const IDLE_MIN = Number(process.env.DEEP_JOB_IDLE_MIN ?? 360);
const size = (path) => { try { return statSync(path).size; } catch { return 0; } };
function run(logs, label, command, args, env = {}, cwd = root) {
  if (stopped) return Promise.resolve({ label, log: null, status: null, output: `stopped by ${stopped}` });
  const log = join(logs, `${label.replace(/\W+/g, '-')}.log`);
  const report = /^(?:vitest|node)/.test(label) ? join(logs, `${label}.jsonl`) : null;
  const descriptor = openSync(log, 'w');
  const cls = /timed(?:-\d+)?$/.test(label) ? 'timed' : /^(?:vitest|node)/.test(label) ? 'test' : 'build';
  const leased = [join(root, 'scripts/lease'), command, ...args], began = performance.now();
  return new Promise((done) => {
    const child = spawn(LIGHT.test(label) ? leased[0] : process.execPath, LIGHT.test(label) ? leased.slice(1) : [join(root, 'scripts/throttle.mjs'), cls, '--wait', '30', '--', ...leased], { cwd, stdio: ['ignore', descriptor, descriptor], env: childEnv(env) });
    live.add(child);
    let idle = null, watch = null;
    if (report) {
      let seen = '', since = performance.now();
      // deadline: the look only stops a job that wrote nothing for IDLE_MIN minutes, a hang turned into a result.
      watch = setInterval(() => {
        const now = `${size(log)} ${size(report)}`;
        if (now !== seen) [seen, since] = [now, performance.now()];
        else if (!idle && performance.now() - since >= IDLE_MIN * 60_000) {
          // Without a listing, nothing is stopped: the next look tries again. A job whose throttle still asks the table
          // has started nothing: it waits for its turn.
          let tree, waits;
          try { waits = asking(child.pid); tree = descendants(child.pid); } catch { return; }
          if (waits) { since = performance.now(); return; }
          // What the report holds now stands; what a job writes as it is stopped, a cancelled file's error, is no result.
          idle = { cut: size(report), minutes: IDLE_MIN };
          child.kill('SIGTERM');
          // deadline: a stopped job's tree is given 10 s to end on SIGTERM before it is killed.
          idle.killed = new Promise((killed) => setTimeout(() => {
            try { killTree([...tree, ...child.exitCode === null && child.signalCode === null ? descendants(child.pid) : []]); } catch {}
            // The throttle ends once its command has; one that doesn't is ended too.
            // deadline: the throttle is given 5 s to end once its command has, then killed.
            setTimeout(() => { child.kill('SIGKILL'); killed(); }, 5_000);
          }, 10_000));
        }
      }, Math.min(10_000, IDLE_MIN * 10_000));
    }
    child.on('error', (error) => { clearInterval(watch); live.delete(child); closeSync(descriptor); done({ label, log, status: null, output: String(error) }); });
    child.on('close', async (status) => {
      clearInterval(watch);
      await idle?.killed;
      live.delete(child);
      closeSync(descriptor);
      done({ label, log, status, output: readFileSync(log, 'utf8'), idle, ms: performance.now() - began });
    });
  });
}

// How many shards the alone block runs in: half the cores. An alone file keeps about one core busy (1,976 s of CPU in
// 2,235 s for #1557's, 2026-11-07), so half the cores leave the rest to the parallel block beside it. DEEP_SHARDS sets
// it for one run, and 1 runs the block one file at a time in the worktree, as before shards. Each shard's job takes a
// turn on the machine's pool, a core less one (#3221), so the shards are at most the cores less one.
const CORES = availableParallelism();
const SHARDS = Math.min(Number(process.env.DEEP_SHARDS) || Math.max(1, Math.floor(CORES / 2)), CORES - 1);

/**
 * Runs groups of the alone block (shardGroups), each one file at a time, in `places` taken in turn as each frees: shards,
 * or the worktree. Each job names its files and where it ran, so its report reads from there.
 */
async function runGroups(groups, places, files, vitest, node, label, { env = {}, more = () => true, ready = () => {}, ended = () => {} } = {}) {
  const jobs = [], queue = [...groups];
  let at = 0;
  const add = (job) => { ended(job); jobs.push(job); };
  const worker = async (cwd) => {
    while (queue.length && more()) {
      const group = queue.shift(), name = `${label}-${at++}`;
      const by = { vitest: group.filter((file) => files.vitest.includes(file)), node: group.filter((file) => files.node.includes(file)) };
      // A build folder a machine's cleanup emptied since the run built it is built again before a job reads it.
      ready(cwd);
      if (by.vitest.length) add({ ...await vitest(by.vitest, ['--no-file-parallelism'], `vitest-${name}`, cwd, env), files: by.vitest, cwd });
      if (by.node.length) add({ ...await node(by.node, ['--test-concurrency=1'], `node-${name}`, cwd, env), files: by.node, cwd });
    }
  };
  await Promise.all(places.map(worker));
  return { jobs, left: queue };
}

// The run's one test grant (docs/parallel-proof.md, section 6; #2574): the run asks `throttle.mjs test --wait` once, before
// any job, and runs again as its command, so each job's own request, a build's too, passes through on that grant from
// its holder, an ancestor. The run that holds it is named by HELD: the file it marks as started, and the DEEP_THROTTLE it
// was asked under. The grant is the run's admission (DEEP_THROTTLE_RUN, the free disk its shards need), and each job then
// takes a turn on the machine's pool (#3221). A run asked under a caller's build or test grant is admitted at once with
// no slot, and one asked under a job's turn passes through on it; one that took its own grant gives it back before the
// timed files, which then ask as the caller would. With no grant in the wait, no job started, and every file reads INCONCLUSIVE.
// The run waits for each of its two grants on a stall (#3478): it keeps its place while the class's grants change hands,
// and leaves once none has for 720 minutes, a hung holder's bound. DEEP_TEST_GRANT_STALL sets that bound in minutes, for
// tests; DEEP_TEST_GRANT_WAIT, when set, gives a fixed wait of that many minutes instead.
const HELD = 'DEEP_AFFECTED_HELD';
const grantWait = () => process.env.DEEP_TEST_GRANT_WAIT === undefined ? { stall: Number(process.env.DEEP_TEST_GRANT_STALL ?? '720') } : { wait: Number(process.env.DEEP_TEST_GRANT_WAIT) };
async function queued(args, files, started, prep) {
  const marker = join(mkdtempSync(join(tmpdir(), 'deep-affected-grant-')), 'started');
  const [[bound, minutes]] = Object.entries(grantWait());
  const child = spawn(process.execPath, [join(root, 'scripts/throttle.mjs'), 'test', `--${bound}`, String(minutes), '--', process.execPath, fileURLToPath(import.meta.url), ...args], { stdio: 'inherit', env: { ...process.env, DEEP_THROTTLE_RUN: String(shardsRoom(prep.shards.length)), [HELD]: JSON.stringify({ marker, before: process.env.DEEP_THROTTLE ?? '', prep }) } });
  // A terminal's SIGINT reaches the whole group; a SIGTERM or SIGHUP sent to this process alone is passed on.
  process.on('SIGINT', () => {});
  for (const signal of ['SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
  const status = await new Promise((done) => child.on('close', (code) => done(code ?? 1)));
  const ran = existsSync(marker);
  rmSync(dirname(marker), { recursive: true, force: true });
  if (ran) return status;
  // throttle.mjs said why: no grant in the wait (3), or a table it couldn't use (2).
  return unrun(status === 3 ? 'INCONCLUSIVE' : 'BLOCKED', files, started);
}

// A run's unrun files when it takes no grant: the first line, then each file, then the summary, as with no test grant.
function unrun(state, files, started, first, why = 'for want of a test grant') {
  if (first) console.log(first);
  for (const file of files) console.log(`${state} ${file}: not run, ${why}`);
  console.log(`${state} affected: 0 new, 0 already failing on main, ${files.length} inconclusive or blocked, 0 listed skips, 0 passed, in ${((performance.now() - started) / 1000).toFixed(0)} s at load ${loadavg()[0].toFixed(0)}; no job started`);
  return state === 'INCONCLUSIVE' ? 2 : 3;
}

// A shard lock the run took before its test grant names the run's first process, until its test-grant child names
// itself (main), so the shard stays the run's while the child runs, whatever becomes of the first. Once given back
// another run may take it at the same path, so a process gives back only a lock that names it.
const ours = ({ lock, holder }) => {
  try {
    return JSON.parse(readFileSync(join(lock, 'holder.json'), 'utf8')).pid === holder;
  } catch {
    return false;
  }
};
// What the run's binaries and shards were made for: the worktree's tree and the files selected.
const madeFor = (files) => createHash('sha256').update(JSON.stringify([exactTree(root), files])).digest('hex');
const giveBack = (shard) => { if (ours(shard)) rmSync(shard.lock, { recursive: true, force: true }); };
const tick = () => new Promise((done) => setImmediate(done));

/**
 * What the run makes before it asks for its test grant (#2820), so no test slot waits on cargo: its shards, and in the
 * worktree and each shard the Rust binaries its selected tests need, those read through DEEP_BIN_DIR and the builds an
 * untimed test starts itself (binaryPlan), all on one build grant of the run's own, waited for as its test grant is,
 * each with its test's profile. A run that builds no binary takes none. The shards stay the run's through its
 * wait, so what was built in them is still theirs when its tests start. A stop is seen before each checkout's builds, not between one checkout's. Returns what the
 * run's test-grant child reads, or the exit status, having printed why.
 */
async function prepare(untimed, timedFiles, alone, listedFiles, started) {
  const logs = mkdtempSync(join(tmpdir(), 'deep-affected-')), binRoot = join(logs, 'binaries');
  watchBinaries(binRoot);
  const stop = (signal) => { stopped ??= signal; };
  let grant = null, shards = [];
  const before = process.env.DEEP_THROTTLE;
  try {
    const plan = binaryPlan(root, untimed);
    if (timedFiles.length) plan.names = [...new Set([...plan.names, ...binaryNames(root, timedFiles)])];
    if (plan.names.length || plan.builds.length) {
      const bound = grantWait();
      try {
        grant = acquire('build', bound.stall === undefined ? bound : { wait: 0.05 });
      } catch (error) {
        throw Error(`BLOCKED throttle: ${error.message}`);
      }
      if (!grant) return unrun('INCONCLUSIVE', listedFiles, started, `INCONCLUSIVE no grant: no build grant ${bound.stall === undefined ? `came within ${bound.wait}` : `changed hands within ${bound.stall}`} min for the run's binaries; no test grant was asked for`, 'for want of a build grant');
      process.env.DEEP_THROTTLE = grant.token;
    }
    // A stop while the run waited ended it; from here one is seen between the builds, which run synchronously.
    for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) process.on(signal, stop);
    const groups = shardGroups(alone);
    shards = groups.shared.length > 1 && SHARDS > 1 ? await claimShards(root, Math.min(SHARDS, groups.shared.length), (line) => console.log(line)) : [];
    // All final executables are captured before any consumer or sibling cargo test starts. Each shard builds from its
    // own checkout; its first use covers every group it could take from the shared queue.
    const binaries = [], built = [];
    for (const cwd of [root, ...shards.map(({ dir }) => dir)]) {
      await tick();
      if (stopped) break;
      const at = performance.now(), { names, builds } = cwd === root ? plan : binaryPlan(cwd, groups.shared.flat().filter((file) => untimed.includes(file)));
      buildInPlace(cwd, builds);
      built.push([cwd, { names, builds }]);
      // No time limit before the test grant: a cold build holds no test slot, and at 2 jobs one ran past 20 minutes.
      binaries.push([cwd, buildBinaries(cwd, join(binRoot, String(binaries.length), 'bin'), names, undefined, { timeout: 0 })]);
      if (names.length || builds.length) console.log(`BINARIES ${cwd}: ${[...names.map((name) => `${name} (DEEP_BIN_DIR)`), ...builds.map(({ args }) => `cargo build ${args.join(' ')}`)].join(', ')}; built in ${((performance.now() - at) / 1000).toFixed(0)} s, before the test grant`);
    }
    await tick();
    if (stopped) {
      for (const shard of shards) shard.release();
      console.log(`BLOCKED affected: stopped by ${stopped} before its test grant; logs in ${logs}`);
      return 128 + constants.signals[stopped];
    }
    return { logs, binRoot, binaries, built, madeFor: madeFor(listedFiles), shards: shards.map(({ dir, lock }) => ({ dir, lock, holder: process.pid })) };
  } catch (error) {
    for (const shard of shards) shard.release();
    const state = error.message.startsWith('INCONCLUSIVE') ? 'INCONCLUSIVE' : 'BLOCKED';
    return unrun(state, listedFiles, started, `${/^(?:BLOCKED|INCONCLUSIVE)\b/.test(error.message) ? '' : 'BLOCKED test binaries: '}${error.message}`, 'for want of its binaries');
  } finally {
    for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) process.off(signal, stop);
    if (before === undefined) delete process.env.DEEP_THROTTLE;
    else process.env.DEEP_THROTTLE = before;
    release(grant);
  }
}

/**
 * Each selected test file's and crate's result, for --results (a merge train's record, #3018; parallel-proof, section
 * 6a): FAIL for a new failure, else the worst BLOCKED, INVALID or INCONCLUSIVE among its results, else KNOWN for
 * failures main already has, else PASS when a test of its passed, or for a crate when cargo test ran clean; anything
 * else, as a file left unrun, reads INCONCLUSIVE.
 */
export function fileResults(selection, { fresh, known, unsure, passed }, cargoRan, partial = new Set()) {
  const entries = [...selection.tests.map((file) => ({ file, of: (id) => id.startsWith(`${file} › `) })),
    ...selection.crates.map((name) => ({ file: `cargo test -p ${name}`, crate: true, of: (id) => id.startsWith(`cargo -p ${name} `) }))];
  // cargo test failing outside any target, as a crate that doesn't compile, names no crate, so it leaves none passing.
  const cargoFailed = [...fresh, ...unsure].some(({ id }) => id === 'cargo test');
  const files = entries.map(({ file, crate, of }) => {
    const mine = (list) => list.filter(({ id }) => of(id));
    // A file of a job that stopped part way, or whose report was cut, may be part run, whatever it reported.
    const state = mine(fresh).length ? 'FAIL' : worst([...mine(unsure).map(({ state }) => state), ...partial.has(file) || (crate && cargoFailed) ? ['INCONCLUSIVE'] : []])
      ?? (mine(known).length ? 'KNOWN' : passed.some(of) || (crate && cargoRan) ? 'PASS' : 'INCONCLUSIVE');
    return { file, state };
  });
  // What no file answers for, as a build, a lint or a job, is the whole run's.
  const other = [...fresh, ...unsure].filter(({ id }) => !entries.some(({ of }) => of(id))).map(({ id, state }) => ({ id, state }));
  return { files, other };
}

async function main(args) {
  const started = performance.now();
  // Read once and dropped, so a test this run starts that runs affected.mjs itself queues on its own.
  let held = process.env[HELD] && JSON.parse(process.env[HELD]);
  delete process.env[HELD];
  if (held) writeFileSync(held.marker, '');
  const paths = args.filter((arg) => !arg.startsWith('--'));
  const block = args.includes('--alone');
  const changed = block ? [] : paths.length ? paths : changedPaths(root);
  if (!changed) return console.log('BLOCKED affected: no merge base with origin/main; name the changed paths'), 3;
  const workspace = block ? [] : crates(root);
  let selection;
  if (!block) selection = select(root, changed, { workspace });
  else try { selection = aloneBlock(); } catch (error) { return console.log(error.message), 3; }
  if (args.includes('--wide')) {
    selection.tests = [...new Set([...selection.tests, ...selection.wide.filter((node) => !node.startsWith('cargo '))])].sort();
    selection.crates = [...new Set([...selection.crates, ...selection.wide.filter((node) => node.startsWith('cargo ')).map((node) => node.slice(14))])].sort();
    selection.wide = [];
  }
  // The settled suites are left to the main watch, and --settled runs them, as --wide the wide ones (#3064). The list
  // is read once, before the wait for the test grant, so a tick of the watch meanwhile changes nothing in the run.
  const watched = held ? held.prep.watched : args.includes('--settled') || block ? { folders: [] } : settled(root, selection, changed);
  selection.tests = selection.tests.filter((file) => !watched.folders.includes(suiteOf(file)));
  const { blocks, skipped, timed: timedFiles, slow: slowFiles } = plan(root, selection.tests, changed);
  const runTimed = args.includes('--timed'), runSlow = args.includes('--slow');
  const keptFrom = args.find((arg) => arg.startsWith('--kept='))?.slice(7);
  const { openKept, wholeJob } = keptFrom ? await import('./proof-kept.mjs') : {};
  const kept = keptFrom ? openKept(JSON.parse(keptFrom), (row) => readSkips([row], JSON.parse(readFileSync(join(root, BASELINE), 'utf8')).skips, timed).covered.length > 0) : null;
  const unrunTimed = runTimed ? [] : [...timedFiles.vitest, ...timedFiles.node].sort();
  const unrunSlow = runSlow ? [] : [...slowFiles.vitest, ...slowFiles.node].sort();
  // With --slow, the slow files join the blocks lanes.mjs gives them.
  if (runSlow) for (const runner of ['vitest', 'node']) for (const file of slowFiles[runner]) blocks[listed(alone, file) || listed(exclusive, file) ? 'alone' : 'parallel'][runner].push(file);
  // A file done in an earlier run of this tree is read, not run (#3296).
  const done = { vitest: [], node: [] };
  if (kept) for (const runner of ['vitest', 'node']) {
    done[runner] = blocks.alone[runner].filter((file) => kept.done(file));
    blocks.alone[runner] = blocks.alone[runner].filter((file) => !done[runner].includes(file));
  }
  if (kept && runTimed) for (const runner of ['vitest', 'node']) {
    done[runner].push(...timedFiles[runner].filter((file) => kept.done(file)));
    timedFiles[runner] = timedFiles[runner].filter((file) => !done[runner].includes(file));
  }
  if (!held) for (const [block, runners] of Object.entries({ ...blocks, timed: timedFiles, ...!runSlow && { slow: slowFiles } })) for (const [runner, files] of Object.entries(runners)) if (files.length) console.log(`${block} ${runner}: ${files.join(' ')}${block === 'timed' && !runTimed ? ' (--timed runs them)' : block === 'slow' ? ' (--slow runs them)' : ''}`);
  if (!held) {
    if (selection.crates.length) console.log(`parallel cargo test: ${selection.crates.join(' ')}`);
    for (const line of skipped) console.log(`SKIP ${line}`);
    for (const path of selection.none) console.log(`NOTE ${path} reaches no test`);
  }
  if (!held && selection.wide.length) console.log(`WIDE ${selection.wide.length} more see the change only through a process that starts another package (--wide runs them): ${selection.wide.join(' ')}`);
  if (!held && watched.problem) console.log(`SETTLED no list: ${watched.problem}, so every suite the change reaches runs`);
  if (!held && watched.folders.length) console.log(`SETTLED ${watched.folders.length} ${watched.folders.length === 1 ? 'suite of a closed issue is' : 'suites of closed issues are'} left to the main watch (--settled runs them): ${watched.folders.join(' ')}`);
  if (args.includes('--list')) return 0;
  const files = [...Object.values(blocks).flatMap((block) => [...block.vitest, ...block.node]), ...runTimed ? [...timedFiles.vitest, ...timedFiles.node] : []];
  // Nothing left to run, so nothing to build and no grant to ask for: the kept results are all the run reads.
  if (!held && kept && !files.length && !selection.crates.length) {
    const logs = mkdtempSync(join(tmpdir(), 'deep-affected-'));
    held = { before: process.env.DEEP_THROTTLE, prep: { logs, binRoot: join(logs, 'binaries'), binaries: [], built: [], shards: [], madeFor: madeFor([]) } };
  }
  if (!held) {
    const listedFiles = [...files, ...selection.crates.map((name) => `cargo test -p ${name}`)];
    const timedRun = runTimed ? [...timedFiles.vitest, ...timedFiles.node] : [];
    const prep = await prepare(files.filter((file) => !timedRun.includes(file)), timedRun, [...blocks.alone.vitest, ...blocks.alone.node], listedFiles, started);
    if (typeof prep === 'number') return prep;
    prep.watched = watched;
    try {
      return await queued(args, listedFiles, started, prep);
    } finally {
      for (const shard of prep.shards) giveBack(shard);
      rmSync(prep.binRoot, { recursive: true, force: true });
    }
  }
  // Stopped, the run passes the stop to its jobs, starts none, and ends once they have, through its own clean-up (its
  // shards' locks too, which a shard still being made keeps till it is), so none runs on once its grant is given back.
  // A stop that comes before the test grant, during the binary builds, is seen when they end (prepare).
  for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) process.on(signal, () => {
    stopped ??= signal;
    for (const child of live) child.kill(signal === 'SIGINT' ? 'SIGTERM' : signal);
  });

  sweepLeftovers();
  // What the run made before its test grant (prepare): its logs, binaries, shards and package build.
  const { logs, binRoot } = held.prep;
  const binaries = new Map(held.prep.binaries);
  const binEnv = (cwd = root) => ({ DEEP_BIN_DIR: binaries.get(cwd) });
  // What was made while the run waited is for the tree and the files it was made for; a change since leaves it unproven.
  const listedFiles = [...files, ...selection.crates.map((name) => `cargo test -p ${name}`)];
  if (madeFor(listedFiles) !== held.prep.madeFor) return unrun('BLOCKED', listedFiles, started, 'BLOCKED affected: the worktree or the files it selects changed while the run waited for its test grant; run it again', 'for its binaries were built for another tree');
  // The shards' locks name this process from here (ours), so they stay the run's whatever becomes of the one that took them.
  const own = spawnSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } }).stdout.trim();
  let shards = held.prep.shards.filter(ours).map((shard) => {
    writeFileSync(join(shard.lock, 'holder.next.json'), JSON.stringify({ pid: process.pid, start: own }));
    renameSync(join(shard.lock, 'holder.next.json'), join(shard.lock, 'holder.json'));
    const mine = { ...shard, holder: process.pid };
    return { dir: shard.dir, release: () => giveBack(mine) };
  });
  try {
    const vitest = (files, extra, label, cwd, env = {}) => run(logs, label, process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...extra, '--reporter=dot', '--reporter=./scripts/proof-vitest-reporter.mjs', ...files], { ...env, ...binEnv(cwd), DEEP_PROOF_VITEST_REPORT: join(logs, `${label}.jsonl`) }, cwd);
    const node = (files, extra, label, cwd, env = {}) => run(logs, label, process.execPath, ['--test', ...extra, '--test-reporter=./scripts/proof-reporter.mjs', `--test-reporter-destination=${join(logs, `${label}.jsonl`)}`, '--test-reporter=dot', '--test-reporter-destination=stdout', ...files], { ...env, ...binEnv(cwd) }, cwd);
    const jobs = [];
    // Keeps a job as it ends, whole, for the next run of this tree; a stopped or cut one is run again.
    const ended = (job) => {
      let report = '';
      try { report = readFileSync(join(logs, `${job.label}.jsonl`), 'utf8'); } catch {}
      const results = reportResults(job.cwd ?? root, report, job.label);
      if (kept && wholeJob({ ...job, results })) kept.keep(job.label, job.files, results, job.ms);
    };
    const built = new Map(held.prep.built);
    const ready = (cwd) => {
      const { names = [], builds = [] } = built.get(cwd) ?? {}, bin = binaries.get(cwd);
      const placed = builtIn(cwd, builds).every((path) => existsSync(path)), seen = names.every((name) => existsSync(join(bin, name)));
      if (placed && seen) return;
      if (!seen) buildBinaries(cwd, bin, names, undefined, { timeout: 0 });
      if (placed) return;
      const grant = acquire('build', { wait: 30 }), before = process.env.DEEP_THROTTLE;
      if (!grant) throw Error('INCONCLUSIVE no grant: no build grant came within 30 min to build again what a cleanup removed');
      process.env.DEEP_THROTTLE = grant.token;
      try {
        buildInPlace(cwd, builds);
      } finally {
        process.env.DEEP_THROTTLE = before;
        release(grant);
      }
    };
    // Tests that run a package's build read dist, so a change to a package builds them first, as the typecheck lane does,
    // and the shards, claimed before it (prepare), take the new builds.
    if (changed.some((path) => /^packages\/[^/]+\/src\//.test(path))) {
      jobs.push(await run(logs, 'build', 'npm', ['run', 'build', '--workspaces']));
      // A shard whose copy fails is left unused, as one that can't be made is.
      shards = shards.filter((shard) => {
        try {
          cloneBuilds(root, shard.dir);
          return true;
        } catch (error) {
          console.log(`SHARD ${shard.dir} not used: ${error.message}`);
          shard.release();
          return false;
        }
      });
    }
    const groups = shardGroups([...blocks.alone.vitest, ...blocks.alone.node]);
    // The preflight runs its lints in its lint lane, so its alone block runs none.
    const lints = block ? [] : checks.find(({ name }) => name === 'lint').commands.filter(([, script]) => script?.startsWith('scripts/'));
    if (selection.owners.length) lints.push(['cargo', 'fmt', '--all', '--', '--check'], ['cargo', 'clippy', '--locked', '--keep-going', '--all-targets', ...selection.owners.flatMap((name) => ['-p', name]), '--', '-D', 'warnings']);
    const beside = [
      ...blocks.parallel.vitest.length ? [vitest(blocks.parallel.vitest, [], 'vitest', root)] : [],
      ...blocks.parallel.node.length ? [node(blocks.parallel.node, [], 'node', root)] : [],
      ...selection.crates.length ? [run(logs, 'cargo', 'cargo', ['test', '--locked', '--no-fail-fast', ...selection.crates.flatMap((name) => ['-p', name])])] : [],
      ...lints.map(([command, ...rest]) => run(logs, lintLabel(rest), command, rest)),
    ];
    // The shards run beside those, since no shard's build writes the worktree's target/.
    // A shard takes its next group only while the disk keeps its floor, since other sessions fill it too; the groups it
    // leaves run in the worktree after the rest.
    const inShards = shards.length ? runGroups(groups.shared, shards.map(({ dir }) => dir), blocks.alone, vitest, node, 'alone', { more: roomy, ready, ended }) : null;
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
    jobs.push(...(await runGroups([...left, ...groups.exclusive], [root], blocks.alone, vitest, node, 'alone-worktree', { ready, ended })).jobs);
    // The untimed jobs have ended, so the run's own grant goes back, and each timed block asks for its timed grant as the
    // run's caller would: nested in the caller's grant, or top-level.
    const [cls, id] = (process.env.DEEP_THROTTLE ?? '').split(':');
    if (id && process.env.DEEP_THROTTLE !== held.before) release({ class: cls, id });
    const own = { DEEP_THROTTLE: held.before };
    // A timed test measures for as long as its issue says, #1477's arms 8 s each: its limit is its own, or ten minutes, never vitest's 5 s (#2569).
    // A timed file is a job of its own under a grant it gives back, so another session's request goes first between two (#3297).
    const timedJobs = async (runner, files) => {
      for (const [at, group] of (kept ? files.map((file) => [file]) : files.length ? [files] : []).entries()) {
        ready(root);
        const job = await (runner === 'vitest' ? vitest(group, ['--no-file-parallelism', '--testTimeout=600000'], kept ? `vitest-timed-${at}` : 'vitest-timed', root, own) : node(group, ['--test-concurrency=1'], kept ? `node-timed-${at}` : 'node-timed', root, own));
        ended({ ...job, files: group });
        jobs.push({ ...job, files: group });
      }
    };
    if (runTimed) {
      await timedJobs('vitest', timedFiles.vitest);
      await timedJobs('node', timedFiles.node);
    }

    if (stopped) return console.log(`BLOCKED affected: stopped by ${stopped}; its jobs were stopped and none of their results is read; logs in ${logs}`), 128 + constants.signals[stopped];
    const failures = [], passed = [], findings = [], skips = [], partial = new Set();
    // What an earlier run of this tree kept, as its runner reported it.
    if (kept) { const before = kept.results([...done.vitest, ...done.node]); failures.push(...before.failures); passed.push(...before.passed); skips.push(...before.skips); }
    for (const job of jobs) {
      const tests = /^(?:vitest|node)/.test(job.label);
      let report = '';
      try { if (tests) report = readFileSync(join(logs, `${job.label}.jsonl`)).subarray(0, job.idle?.cut).toString('utf8'); } catch {}
      // A stopped job's report may end part way through a row.
      if (job.idle) report = report.slice(0, report.lastIndexOf('\n') + 1);
      let results = reportResults(job.cwd ?? root, report, job.label);
      // An earlier run of this tree's rows stand beside this job's, and a failure over a later pass.
      if (kept && tests && !results.noGrant) results = { ...kept.overlay(results, job.files ?? [], job.label), cut: results.cut };
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
        // A file that reported no test didn't run, and nothing unrun passes. A job stopped for standing still may have
        // stopped part way through a file that reported, so it reads INCONCLUSIVE itself, and the run with it.
        const stuck = job.idle && `its job reported nothing for ${job.idle.minutes} min and was stopped`;
        if (stuck || results.cut || results.failures.some(({ id }) => id === `${job.label} report`)) for (const file of files) partial.add(file);
        if (stuck) failures.push({ id: `${job.label} job`, state: 'INCONCLUSIVE', message: `${stuck}; a file it reported may be part run (${job.log})` });
        // A runner that a signal or an error ended with no failed test may have left a file it had started part run (#2136).
        else if (job.status !== 0 && !results.failures.length && !results.noGrant) {
          for (const file of files) partial.add(file);
          failures.push({ id: `${job.label} job`, state: 'INCONCLUSIVE', message: `its runner ${job.status === null ? 'was ended by a signal' : `exited ${job.status}`} with no failed test (${job.log})` });
        }
        for (const file of files.filter((file) => !report.includes(file))) failures.push({ id: named(file, '(file)'), state: results.noGrant || stuck ? 'INCONCLUSIVE' : 'FAIL', message: results.noGrant ?? stuck ?? 'reported no test' });
      }
    }
    const baseline = JSON.parse(readFileSync(join(root, BASELINE), 'utf8'));
    const { covered, open } = readSkips(skips, baseline.skips, timed);
    const { known, fresh, unsure } = classify([...failures, ...open], findings, baseline);
    for (const { id, message } of known) console.log(`KNOWN ${id}${message === 'lint' ? '' : `: ${message}`}`);
    for (const { id, state, message } of unsure) console.log(`${state} ${id}${message ? `: ${message}` : ''}`);
    for (const { id, note, reason } of covered) console.log(`LISTED ${id}${note ? `: ${note}` : ''} (${reason})`);
    for (const id of passed.filter((id) => baseline.failures[id])) console.log(`NOTE ${id} passes; remove it from ${BASELINE}`);
    for (const { id, message } of fresh) console.log(`NEW FAIL ${id}${message && message !== 'lint' ? `: ${message}` : ''}`);
    for (const path of selection.every) console.log(`INCONCLUSIVE ${path} feeds every suite; run npm run preflight`);
    if (selection.wide.length) console.log(`INCONCLUSIVE ${selection.wide.length} suites that see the change through another package's process were not run; the release preflight or --wide runs them`);
    if (watched.folders.length) console.log(`INCONCLUSIVE ${watched.folders.length} settled ${watched.folders.length === 1 ? 'suite was' : 'suites were'} not run; the main watch or --settled runs them`);
    if (unrunTimed.length) console.log(`INCONCLUSIVE ${unrunTimed.length} timed ${unrunTimed.length === 1 ? 'file was' : 'files were'} not run; --timed runs them under a timed grant: ${unrunTimed.join(' ')}`);
    if (skipped.length) console.log(`INCONCLUSIVE ${skipped.length} selected ${skipped.length === 1 ? 'file was' : 'files were'} not run, left to a person or to a lane of its own; run each by hand or in its lane: ${skipped.join(' ')}`);
    if (unrunSlow.length) console.log(`INCONCLUSIVE ${unrunSlow.length} slow ${unrunSlow.length === 1 ? 'file was' : 'files were'} not run; --slow runs them: ${unrunSlow.join(' ')}`);
    console.log(`TIMED the timed list, from scripts/lanes.mjs (${timed.length}): ${timed.join(' ')}`);
    const state = fresh.length ? 'FAIL' : worst(unsure.map(({ state }) => state)) ?? (selection.every.length || selection.wide.length || watched.folders.length || skipped.length || unrunTimed.length || unrunSlow.length ? 'INCONCLUSIVE' : known.length ? 'NO NEW FAILURES' : 'PASS');
    const resultsFile = args.find((arg) => arg.startsWith('--results='))?.slice(10);
    // Each test's result as its runner reported it, which runLanes reads for the unit lane's record as a runner's report.
    const tests = block ? { tests: { failures, passed, skips }, ...kept && { kept: { read: done.vitest.length + done.node.length } } } : {};
    if (resultsFile) writeFileSync(resultsFile, `${JSON.stringify({ state, ...fileResults(selection, { fresh, known, unsure, passed }, jobs.some(({ label, status }) => label === 'cargo' && status === 0), partial), ...tests }, null, 2)}\n`);
    console.log(`${state} affected: ${fresh.length} new, ${known.length} already failing on main, ${unsure.length} inconclusive or blocked, ${covered.length} listed skips, ${passed.length} passed, in ${((performance.now() - started) / 1000).toFixed(0)} s at load ${loadavg()[0].toFixed(0)}; logs in ${logs}`);
    return { FAIL: 1, INCONCLUSIVE: 2, BLOCKED: 3, INVALID: 3 }[state] ?? 0;
  } catch (error) {
    console.log(`${/^(?:BLOCKED|INCONCLUSIVE)\b/.test(error.message) ? '' : 'BLOCKED test binaries: '}${error.message}`);
    return error.message.startsWith('INCONCLUSIVE') ? 2 : 3;
  } finally {
    for (const shard of shards) shard.release();
    rmSync(binRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
