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
//   node scripts/affected.mjs [--list] [--wide] [--timed] [--slow] [--results=<file>] [path ...]
//
// The alone block's folders run side by side, each in a shard of its own (scripts/shards.mjs), so no sibling's cargo
// build rewrites a binary under it; those lanes.mjs names exclusive run after, one at a time, with nothing beside them.
// The builds of the shards and of the rest share one jobserver, so the run never compiles more at once than its cores.
// The files lanes.mjs names slow run only with --slow, or when the change adds or edits them; unrun, they leave the run
// INCONCLUSIVE, as the timed ones do.
//
// Paths stand for the change, which is otherwise the worktree against its merge base with origin/main. --list prints
// the selection without running it. A test that starts a package's build is selected when the change is in that
// package or the test is in the changed file's own package; otherwise it is WIDE, and --wide also runs it (select, below).
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, constants as modes, existsSync, mkdtempSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { availableParallelism, constants, loadavg, tmpdir } from 'node:os';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { alone, byHand, cargoResults, changedPaths, checks, crates, exactTree, exclusive, listed, ownLane, readSkips, reportResults, slow, timed, worst } from './lanes.mjs';
import { isTestFile, listFiles, named, underTestPaths } from './proof-change.mjs';
import { namedByConfig } from './proof-guard.mjs';
import { childEnv } from './proof-runs.mjs';
import { binaryNames, binaryPlan, buildBinaries, buildInPlace, watchBinaries } from './proof-binaries.mjs';
import { claimShards, cloneBuilds, roomy } from './shards.mjs';
import { acquire, descendants, killTree, release } from './throttle.mjs';

export { cargoResults, crates, reportResults };

const root = fileURLToPath(new URL('../', import.meta.url));
const BASELINE = 'scripts/known-failures.json';
const CODE = /\.(?:[cm]?[jt]s|tsx)$/;
// Files every suite reads, so a change to one is verified by the full preflight; so are those a runner config names, as
// its setup files (select, below).
const EVERY = ['package.json', 'package-lock.json', 'tsconfig.json', 'vitest.config.ts', 'Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml'];
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
    const onward = (nodes) => [...nodes, ...up(nodes.filter((node) => !node.startsWith('crate:')))];
    // A task runs a binary as cargo builds it, from its crate and every crate that one depends on.
    const built = [...runs].filter(([, targets]) => [...targets].some((target) => target.startsWith('crate:') && code.has(target))).map(([node]) => node);
    const found = new Set(ends([...code, ...onward([...ran, ...started]), ...onward(deeper).filter(own), ...onward(built).filter(task)]));
    return { found: [...found], wide: ends(onward(deeper)).filter((node) => !found.has(node)) };
  };
  const tests = new Set(), reached = new Set(), wide = new Set(), every = [], none = [], touched = new Set();
  // The files a runner config names, as the guard reads them: its setup files and the config modules it imports.
  const setup = namedByConfig(cwd, null, all);
  const feedsEvery = (path) => EVERY.includes(path) || setup.has(path);
  for (const path of changed) {
    if (feedsEvery(path)) every.push(path);
    let { found, wide: far } = reach(path);
    for (const node of [...found, ...far].filter(task)) touched.add(node.slice(5));
    [found, far] = [found, far].map((nodes) => nodes.filter((node) => !task(node)));
    // A fixture no test names by path is read by the tests of its own folder.
    if (!found.length && underTestPaths(path)) {
      const folder = path.match(/^(?:tests\/acceptance\/[^/]+|packages\/[^/]+\/test|tests)\//)?.[0];
      found = folder ? all.filter((file) => file.startsWith(folder) && isTestFile(file)) : [];
    }
    // A test the change deletes has nothing to run.
    for (const node of found) if (node.startsWith('crate:') || existsSync(join(cwd, node))) (node.startsWith('crate:') ? reached : tests).add(node.replace(/^crate:/, ''));
    for (const node of far) wide.add(node.replace(/^crate:/, 'cargo test -p '));
    if (!found.length && !far.length && !path.endsWith('.md') && !feedsEvery(path)) none.push(path);
  }
  const owners = [...new Set(changed.filter((path) => path.endsWith('.rs')).flatMap(ownersOf))].map((node) => node.slice(6));
  const runsTask = ({ id }) => every.length || touched.has(id) || !imports.has(`task:${id}`);
  return { tests: [...tests].sort(), crates: [...reached].sort(), wide: [...wide].filter((node) => !tests.has(node) && !reached.has(node.replace('cargo test -p ', ''))).sort(), every, none, owners, tasks: tasks.filter(runsTask).map(({ id }) => id) };
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
// (queued, below), and the timed ones as timed, waiting at most 30 minutes for their own; each, its parallel blocks
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
// A test job whose log and report have both stood still for IDLE minutes is stopped (#2627): a test that starves its
// worker's event loop defeats vitest's own limit (#2783), and a handle a test leaks keeps its file from exiting (#2804),
// either for ever. The bound is above the longest stretch a test may write nothing: #1781's 120 min build hook runs
// before its 120 min tests with no result between, and the timed lane's limits reach 240 min (#416, #140). SIGTERM to the job, and
// 10 s later SIGKILL to every process of its tree, by PID and start, as the throttle does for a grant past its bound
// (#2744); the job's throttle, then, ends by itself and gives its grant back. The job ends once they have, and reads
// by what it reported before the stop. DEEP_JOB_IDLE_MIN sets the bound in minutes, for tests.
const IDLE_MIN = Number(process.env.DEEP_JOB_IDLE_MIN ?? 360);
const size = (path) => { try { return statSync(path).size; } catch { return 0; } };
// The run's jobserver while its builds share it (jobserver, below); each job's end may fill it again.
let pool = null;
function run(logs, label, command, args, env = {}, cwd = root) {
  if (stopped) return Promise.resolve({ label, log: null, status: null, output: `stopped by ${stopped}` });
  const log = join(logs, `${label.replace(/\W+/g, '-')}.log`);
  const report = /^(?:vitest|node)/.test(label) ? join(logs, `${label}.jsonl`) : null;
  const descriptor = openSync(log, 'w');
  const cls = label.endsWith('timed') ? 'timed' : /^(?:vitest|node)/.test(label) ? 'test' : 'build';
  const leased = [join(root, 'scripts/lease'), command, ...args];
  return new Promise((done) => {
    const child = spawn(LIGHT.test(label) ? leased[0] : process.execPath, LIGHT.test(label) ? leased.slice(1) : [join(root, 'scripts/throttle.mjs'), cls, '--wait', '30', '--', ...leased], { cwd, stdio: ['ignore', descriptor, descriptor], env: childEnv(env) });
    live.add(child);
    let idle = null, watch = null;
    if (report) {
      let seen = '', since = performance.now();
      watch = setInterval(() => {
        const now = `${size(log)} ${size(report)}`;
        if (now !== seen) [seen, since] = [now, performance.now()];
        else if (!idle && performance.now() - since >= IDLE_MIN * 60_000) {
          // Without a listing, nothing is stopped: the next look tries again.
          let tree;
          try { tree = descendants(child.pid); } catch { return; }
          // What the report holds now stands; what a job writes as it is stopped, a cancelled file's error, is no result.
          idle = { cut: size(report), minutes: IDLE_MIN };
          child.kill('SIGTERM');
          idle.killed = new Promise((killed) => setTimeout(() => {
            try { killTree([...tree, ...child.exitCode === null && child.signalCode === null ? descendants(child.pid) : []]); } catch {}
            // The throttle ends once its command has; one that doesn't is ended too.
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
      pool?.refill();
      done({ label, log, status, output: readFileSync(log, 'utf8'), idle });
    });
  });
}

// How many shards the alone block runs in: half the cores. An alone file keeps about one core busy (1,976 s of CPU in
// 2,235 s for #1557's, 2026-11-07), so half the cores leave the rest to the parallel block beside it. DEEP_SHARDS sets
// it for one run, and 1 runs the block one file at a time in the worktree, as before shards. A file whose test builds
// with cargo asks for every core, so the builds share the run's jobserver, and the shards are at most the cores less
// one, since each, like the worktree, runs one compile on no token (jobserver, below).
const CORES = availableParallelism();
const SHARDS = Math.min(Number(process.env.DEEP_SHARDS) || Math.max(1, Math.floor(CORES / 2)), CORES - 1);

/**
 * The run's compiles at once (#2741): every cargo its jobs start, in a shard or in the worktree, joins one jobserver of
 * the run's, GNU make's named pipe through CARGO_MAKEFLAGS, and starts each compile past its first on a token read from
 * the pipe. Cargo builds one at a time in a folder's target/ and runs that first compile on no token, so the pipe holds
 * a token per core less one for the worktree and one for each of the `shards` running; `give` hands theirs back once
 * they have ended. `close` ends it, before the timed blocks, which compile as before. A cargo killed while it holds
 * tokens never writes them back (#2848), so as each job ends the run fills the pipe to its count again, as the hub's
 * pool does, but only while no process but the run has the pipe open: a live build may hold tokens, and none is added
 * beside them. `close` comes after every untimed job has ended, so the pipe should hold its count then; what it lacks
 * was lost while builds ran, so a build may have had less than its share, and it returns how many.
 */
function jobserver(shards) {
  const dir = mkdtempSync(join(tmpdir(), 'deep-jobserver-')), fifo = join(dir, 'tokens');
  const made = spawnSync('mkfifo', ['-m', '600', fifo], { encoding: 'utf8' });
  if (made.status !== 0) throw Error(`BLOCKED jobserver: mkfifo failed: ${made.error?.message ?? made.stderr.trim()}`);
  // Held open by the run, so the pipe keeps its tokens while no build has it open, and never blocking the run.
  const fd = openSync(fifo, modes.O_RDWR | modes.O_NONBLOCK);
  let tokens = 0;
  const give = (count) => { if (count > 0) { tokens += count; writeSync(fd, '+'.repeat(count)); } };
  give(CORES - 1 - shards);
  // Whether the run alone has the pipe open: fuser names every process that has, the run among them, so a fuser that
  // can't see it, is missing or hangs on another mount says nothing.
  const alone = () => {
    const seen = spawnSync('fuser', [fifo], { encoding: 'utf8', timeout: 10_000 });
    const pids = seen.status === null ? [] : seen.stdout.split(/\s+/).flatMap((word) => word.match(/^(\d+)\D*$/)?.[1] ?? []);
    return pids.includes(String(process.pid)) && pids.every((pid) => pid === String(process.pid));
  };
  // No build has started yet, so a run that isn't alone here never can be: it never refills, and lost tokens stay lost.
  const sees = alone();
  if (!sees) console.log(`JOBSERVER fuser can't see the run's pipe, so tokens a killed build held are not given back (#2848)`);
  const before = process.env.CARGO_MAKEFLAGS;
  process.env.CARGO_MAKEFLAGS = `-j --jobserver-auth=fifo:${fifo}`;
  let open = true;
  // The free tokens, read out of the pipe.
  const take = () => {
    const buffer = Buffer.alloc(4096);
    let free = 0;
    for (;;) {
      try { const read = readSync(fd, buffer, 0, buffer.length, null); if (read <= 0) break; free += read; } catch { break; }
    }
    return free;
  };
  return {
    give,
    refill: () => {
      if (!open || !sees || !alone()) return;
      // The free tokens are read out first, so a build that opens the pipe meanwhile takes none and is seen.
      const free = take();
      writeSync(fd, '+'.repeat(alone() ? tokens : free));
    },
    close: () => {
      if (!open) return 0;
      open = false;
      const lost = Math.max(0, tokens - take());
      if (before === undefined) delete process.env.CARGO_MAKEFLAGS;
      else process.env.CARGO_MAKEFLAGS = before;
      closeSync(fd);
      rmSync(dir, { recursive: true, force: true });
      return lost;
    },
  };
}

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

// The run's one test grant (docs/parallel-proof.md, section 6; #2574): the run asks `throttle.mjs test --wait` once, before
// any job, and runs again as its command, so each job's own request, a build's too, passes through on that grant from
// its holder, an ancestor. The run that holds it is named by HELD: the file it marks as started, and the DEEP_THROTTLE it
// was asked under. A run asked under a caller's build or test grant passes through on it, and takes none; one that took
// its own gives it back before the timed files, which then ask as the caller would. With no grant in the wait, no job started, and every file reads INCONCLUSIVE.
// DEEP_TEST_GRANT_WAIT sets the wait in minutes, for tests.
const HELD = 'DEEP_AFFECTED_HELD';
async function queued(args, files, started, prep) {
  const marker = join(mkdtempSync(join(tmpdir(), 'deep-affected-grant-')), 'started');
  const wait = process.env.DEEP_TEST_GRANT_WAIT ?? '30';
  const child = spawn(process.execPath, [join(root, 'scripts/throttle.mjs'), 'test', '--wait', wait, '--', process.execPath, fileURLToPath(import.meta.url), ...args], { stdio: 'inherit', env: { ...process.env, [HELD]: JSON.stringify({ marker, before: process.env.DEEP_THROTTLE ?? '', prep }) } });
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
 * untimed test starts itself (binaryPlan), all on one build grant of the run's own, waited for as long as its test grant,
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
      const wait = Number(process.env.DEEP_TEST_GRANT_WAIT ?? '30');
      try {
        grant = acquire('build', { wait });
      } catch (error) {
        throw Error(`BLOCKED throttle: ${error.message}`);
      }
      if (!grant) return unrun('INCONCLUSIVE', listedFiles, started, `INCONCLUSIVE no grant: no build grant came within ${wait} min for the run's binaries; no test grant was asked for`, 'for want of a build grant');
      process.env.DEEP_THROTTLE = grant.token;
    }
    // A stop while the run waited ended it; from here one is seen between the builds, which run synchronously.
    for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) process.on(signal, stop);
    const groups = shardGroups(alone);
    shards = groups.shared.length > 1 && SHARDS > 1 ? await claimShards(root, Math.min(SHARDS, groups.shared.length), (line) => console.log(line)) : [];
    // All final executables are captured before any consumer or sibling cargo test starts. Each shard builds from its
    // own checkout; its first use covers every group it could take from the shared queue.
    const binaries = [];
    for (const cwd of [root, ...shards.map(({ dir }) => dir)]) {
      await tick();
      if (stopped) break;
      const at = performance.now(), { names, builds } = cwd === root ? plan : binaryPlan(cwd, groups.shared.flat().filter((file) => untimed.includes(file)));
      buildInPlace(cwd, builds);
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
    return { logs, binRoot, binaries, madeFor: madeFor(listedFiles), shards: shards.map(({ dir, lock }) => ({ dir, lock, holder: process.pid })) };
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
  const held = process.env[HELD] && JSON.parse(process.env[HELD]);
  delete process.env[HELD];
  if (held) writeFileSync(held.marker, '');
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
  if (!held) for (const [block, runners] of Object.entries({ ...blocks, timed: timedFiles, ...!runSlow && { slow: slowFiles } })) for (const [runner, files] of Object.entries(runners)) if (files.length) console.log(`${block} ${runner}: ${files.join(' ')}${block === 'timed' && !runTimed ? ' (--timed runs them)' : block === 'slow' ? ' (--slow runs them)' : ''}`);
  if (!held) {
    if (selection.crates.length) console.log(`parallel cargo test: ${selection.crates.join(' ')}`);
    for (const line of skipped) console.log(`SKIP ${line}`);
    for (const path of selection.none) console.log(`NOTE ${path} reaches no test`);
  }
  if (!held && selection.wide.length) console.log(`WIDE ${selection.wide.length} more see the change only through a process that starts another package (--wide runs them): ${selection.wide.join(' ')}`);
  if (args.includes('--list')) return 0;
  const files = [...Object.values(blocks).flatMap((block) => [...block.vitest, ...block.node]), ...runTimed ? [...timedFiles.vitest, ...timedFiles.node] : []];
  if (!held) {
    const listedFiles = [...files, ...selection.crates.map((name) => `cargo test -p ${name}`)];
    const timedRun = runTimed ? [...timedFiles.vitest, ...timedFiles.node] : [];
    const prep = await prepare(files.filter((file) => !timedRun.includes(file)), timedRun, [...blocks.alone.vitest, ...blocks.alone.node], listedFiles, started);
    if (typeof prep === 'number') return prep;
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
    // The binary builds ran before the grant, one at a time; from here the run's builds run at once, so they share its jobserver.
    pool = jobserver(shards.length);
    const lints = checks.find(({ name }) => name === 'lint').commands.filter(([, script]) => script?.startsWith('scripts/'));
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
    const inShards = shards.length ? runGroups(groups.shared, shards.map(({ dir }) => dir), blocks.alone, vitest, node, 'alone', {}, roomy) : null;
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
      // The shards' compiles go back to the worktree's builds after them.
      pool.give(shards.length);
      shards = [];
    }
    if (inShards && left.length) console.log(`SHARD ${left.length} alone ${left.length === 1 ? 'group runs' : 'groups run'} in the worktree: the disk fell under its floor`);
    // Without shards the block runs in the worktree after the rest, one group at a time; the exclusive groups always do.
    jobs.push(...(await runGroups([...left, ...groups.exclusive], [root], blocks.alone, vitest, node, 'alone-worktree')).jobs);
    // The untimed jobs have ended, so the run's own grant and its jobserver go back, and each timed block asks for its
    // timed grant as the run's caller would: nested in the caller's grant, or top-level.
    const lost = pool.close();
    const [cls, id] = (process.env.DEEP_THROTTLE ?? '').split(':');
    if (id && process.env.DEEP_THROTTLE !== held.before) release({ class: cls, id });
    const own = { DEEP_THROTTLE: held.before };
    // A timed test measures for as long as its issue says, #1477's arms 8 s each: its limit is its own, or ten minutes, never vitest's 5 s (#2569).
    if (runTimed && timedFiles.vitest.length) jobs.push(await vitest(timedFiles.vitest, ['--no-file-parallelism', '--testTimeout=600000'], 'vitest-timed', root, own));
    if (runTimed && timedFiles.node.length) jobs.push(await node(timedFiles.node, ['--test-concurrency=1'], 'node-timed', root, own));

    if (stopped) return console.log(`BLOCKED affected: stopped by ${stopped}; its jobs were stopped and none of their results is read; logs in ${logs}`), 128 + constants.signals[stopped];
    const failures = [], passed = [], findings = [], skips = [], partial = new Set();
    // A build that ran short of its compile share may have timed out or run slow, so the run can't say it passed (#2848).
    if (lost) failures.push({ id: 'jobserver', state: 'INCONCLUSIVE', message: `${lost} of the run's compile tokens were missing when its builds had ended, so a build may have had less than its share` });
    for (const job of jobs) {
      const tests = /^(?:vitest|node)/.test(job.label);
      let report = '';
      try { if (tests) report = readFileSync(join(logs, `${job.label}.jsonl`)).subarray(0, job.idle?.cut).toString('utf8'); } catch {}
      // A stopped job's report may end part way through a row.
      if (job.idle) report = report.slice(0, report.lastIndexOf('\n') + 1);
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
    if (unrunTimed.length) console.log(`INCONCLUSIVE ${unrunTimed.length} timed ${unrunTimed.length === 1 ? 'file was' : 'files were'} not run; --timed runs them under a timed grant: ${unrunTimed.join(' ')}`);
    if (skipped.length) console.log(`INCONCLUSIVE ${skipped.length} selected ${skipped.length === 1 ? 'file was' : 'files were'} not run, left to a person or to a lane of its own; run each by hand or in its lane: ${skipped.join(' ')}`);
    if (unrunSlow.length) console.log(`INCONCLUSIVE ${unrunSlow.length} slow ${unrunSlow.length === 1 ? 'file was' : 'files were'} not run; --slow runs them: ${unrunSlow.join(' ')}`);
    console.log(`TIMED the timed list, from scripts/lanes.mjs (${timed.length}): ${timed.join(' ')}`);
    const state = fresh.length ? 'FAIL' : worst(unsure.map(({ state }) => state)) ?? (selection.every.length || selection.wide.length || skipped.length || unrunTimed.length || unrunSlow.length ? 'INCONCLUSIVE' : known.length ? 'NO NEW FAILURES' : 'PASS');
    const resultsFile = args.find((arg) => arg.startsWith('--results='))?.slice(10);
    if (resultsFile) writeFileSync(resultsFile, `${JSON.stringify({ state, ...fileResults(selection, { fresh, known, unsure, passed }, jobs.some(({ label, status }) => label === 'cargo' && status === 0), partial) }, null, 2)}\n`);
    console.log(`${state} affected: ${fresh.length} new, ${known.length} already failing on main, ${unsure.length} inconclusive or blocked, ${covered.length} listed skips, ${passed.length} passed, in ${((performance.now() - started) / 1000).toFixed(0)} s at load ${loadavg()[0].toFixed(0)}; logs in ${logs}`);
    return { FAIL: 1, INCONCLUSIVE: 2, BLOCKED: 3, INVALID: 3 }[state] ?? 0;
  } catch (error) {
    console.log(`${/^(?:BLOCKED|INCONCLUSIVE)\b/.test(error.message) ? '' : 'BLOCKED test binaries: '}${error.message}`);
    return error.message.startsWith('INCONCLUSIVE') ? 2 : 3;
  } finally {
    for (const shard of shards) shard.release();
    pool?.close();
    rmSync(binRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
