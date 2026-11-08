// The gpui patches are ours to carry (#1426). `check`, run by the lint lane, compares each vendored tree with its
// pinned release against the table in vendor/gpui-pre-apple/upstream/README.md: every changed file has a row, every
// hunk the mark, every hunk and file its budget, and every row a removal condition and a test its suite lists. `diff`
// prints what we carry. `merge <crate> <version>` three-way merges the new release onto our tree, leaves conflict
// markers, and moves the pin only when the rows' tests pass on the result. It reads and writes its working folder.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const TABLE = 'vendor/gpui-pre-apple/upstream/README.md';
const HEADING = '## Carried patches';
const COLUMNS = 'Behavior|Issue|Files|Test|Budget|Removal';
const HUNK_BUDGET = 8; // lines, added and removed
const FILE_BUDGET = 40; // lines added
const MARK = /DeepBuild patch \(windoliver\/deepbuild#(\d+)\)/g;
// A crate pinned to a commit, not a crates.io release: the commit is the `rev` in its manifest.
const FROM_GIT = { 'quickjs-jit-runtime': { repo: 'longbridge/quickjs-jit', folder: 'jit' } };

const say = (line) => console.log(line);
const toPosix = (path) => path.split('\\').join('/');

function filesUnder(dir, skip = () => false) {
  const found = [];
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name), inner = toPosix(relative(dir, path));
      if (skip(inner)) continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) found.push(inner);
    }
  };
  walk(dir);
  return found;
}

/**
 * Each vendored tree, every folder under vendor/. A crate is pinned by its manifest's version; a tree with no manifest,
 * such as unicode-17.0.0, by its folder's name, `<name>-<version>`, its README.md being ours.
 */
function crates() {
  if (!existsSync('vendor')) return [];
  return readdirSync('vendor', { withFileTypes: true }).filter((entry) => entry.isDirectory()).map(({ name }) => {
    const dir = `vendor/${name}`;
    if (!existsSync(join(dir, 'Cargo.toml'))) {
      const [, base, version] = /^(.+)-(\d[\w.]*)$/.exec(name) ?? [];
      return { name: base ?? name, dir, version, folder: true };
    }
    const manifest = readFileSync(join(dir, 'Cargo.toml'), 'utf8');
    return { name, dir, version: /^\[package\][^[]*?^version = "([^"]+)"/ms.exec(manifest)?.[1], rev: /\brev = "([0-9a-f]{40})"/.exec(manifest)?.[1] };
  });
}

/** Ours, in a vendored tree, and no part of a release. */
const ours = (crate) => (inner) => inner === 'upstream' || inner === 'target' || (crate.folder && inner === 'README.md');

/** A tree with no manifest, read without stub releases: the release is the files its README's SHA-256 list names. */
function hashed(crate) {
  const readme = join(crate.dir, 'README.md');
  if (!existsSync(readme)) return null;
  const listed = new Set([...readFileSync(readme, 'utf8').matchAll(/`([0-9a-f]{64})`/g)].map(([, hash]) => hash));
  const dir = mkdtempSync(join(tmpdir(), 'vendor-release-'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  for (const inner of filesUnder(crate.dir, ours(crate))) {
    const bytes = readFileSync(join(crate.dir, inner));
    if (!listed.has(createHash('sha256').update(bytes).digest('hex'))) continue;
    mkdirSync(dirname(join(dir, inner)), { recursive: true });
    writeFileSync(join(dir, inner), bytes);
  }
  return dir;
}

async function download(crate, version, rev, cached) {
  const git = FROM_GIT[crate];
  if (git && !rev) return null;
  const url = git ? `https://codeload.github.com/${git.repo}/tar.gz/${rev}` : `https://static.crates.io/crates/${crate}/${crate}-${version}.crate`;
  const response = await fetch(url).catch(() => null);
  if (!response?.ok) return null;
  const work = mkdtempSync(join(tmpdir(), 'vendor-release-'));
  try {
    writeFileSync(join(work, 'release.tgz'), Buffer.from(await response.arrayBuffer()));
    mkdirSync(join(work, 'out'));
    if (spawnSync('tar', ['xzf', 'release.tgz', '--strip-components=1', '-C', 'out'], { cwd: work }).status !== 0) return null;
    mkdirSync(dirname(cached), { recursive: true });
    // A rename, so a sibling worktree never reads half a release.
    renameSync(join(work, 'out', git?.folder ?? ''), cached);
    return cached;
  } catch (error) {
    if (existsSync(cached)) return cached; // a sibling finished first
    throw error;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The release's folder, or null when it can't be had. */
async function release(crate, version = crate.version) {
  const stub = process.env.DEEP_VENDOR_RELEASES;
  if (stub) {
    const dir = join(stub, `${crate.name}-${version}`);
    return existsSync(dir) ? dir : null;
  }
  if (crate.folder) return version === crate.version ? hashed(crate) : null;
  const cached = join(homedir(), '.cache/deepbuild/vendor-releases', `${crate.name}-${version}${FROM_GIT[crate.name] ? `-${crate.rev}` : ''}`);
  return existsSync(cached) ? cached : download(crate.name, version, crate.rev, cached);
}

const gitDiff = (a, b, unified) => spawnSync('git', ['diff', '--no-index', '--no-color', `-U${unified}`, a, b], { encoding: 'utf8', maxBuffer: 1 << 30 }).stdout;

/** The hunks of `path` against the release's copy, as `git diff -U0` cuts them; a new file is one hunk. */
function hunksOf(path, pinned, text) {
  const lines = text.split('\n');
  if (!pinned) return [{ line: 1, last: lines.length, size: lines.length, added: 0, fresh: true }];
  const hunks = [];
  for (const row of gitDiff(pinned, path, 0).split('\n')) {
    const header = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(row);
    if (!header) continue;
    const removed = Number(header[1] ?? 1), added = Number(header[3] ?? 1), at = Number(header[2]);
    // With nothing added, git names the line before the removal.
    const line = added ? at : at + 1;
    hunks.push({ line, last: added ? at + added - 1 : at, size: removed + added, added });
  }
  return hunks;
}

/** The issues marking a hunk: a mark in it, or at most one unchanged line from it. A new file is one hunk. */
function marksOf(hunk, lines) {
  const from = Math.max(1, hunk.line - 2), to = Math.min(lines.length, hunk.last + 2);
  return [...lines.slice(from - 1, to).join('\n').matchAll(MARK)].map(([, issue]) => `#${issue}`);
}

function readTable() {
  const lines = existsSync(TABLE) ? readFileSync(TABLE, 'utf8').split('\n') : [];
  const start = lines.indexOf(HEADING);
  if (start < 0) return null;
  const table = [];
  for (let at = start + 1; at < lines.length && !lines[at].startsWith('#'); at += 1) {
    if (lines[at].startsWith('|')) table.push(lines[at]);
    else if (table.length) break;
  }
  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
  if (table.length < 2 || cells(table[0]).join('|') !== COLUMNS) return null;
  return table.slice(2).map(cells).map(([behavior, issue, files, test, budget, removal]) => ({
    behavior, issue, test, budget: budget ?? '', removal: removal ?? '', files: [...(files ?? '').matchAll(/`([^`]+)`/g)].map(([, file]) => file), hunks: [], overFiles: [],
  }));
}

// A node test file's own list: the file loaded with node:test standing in, which records each test's name, its
// suites' names joined by ` › `, and runs none of them.
const NODE_TEST = `const names = [], suites = [];
const named = (name) => [...suites, String(name)].join(' › ');
export function test(name) { names.push(named(name)); }
export function describe(name, ...rest) { suites.push(String(name)); try { rest.find((arg) => typeof arg === 'function')?.(); } finally { suites.pop(); } }
for (const each of [test, describe]) each.skip = each.only = each.todo = each;
const noop = () => {};
export { test as it, describe as suite, noop as before, noop as after, noop as beforeEach, noop as afterEach };
export const mock = new Proxy({}, { get: () => noop });
export default test;
process.on('exit', () => { for (const name of names) process.stdout.write('# Subtest: ' + name + '\\n'); });`;
let nodeHooks = null;
function nodeList(path) {
  if (!nodeHooks) {
    const dir = mkdtempSync(join(tmpdir(), 'vendor-tests-'));
    process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, 'test.mjs'), NODE_TEST);
    writeFileSync(join(dir, 'hooks.mjs'), `export async function resolve(specifier, context, next) { return specifier === 'node:test' ? { url: ${JSON.stringify(pathToFileURL(join(dir, 'test.mjs')).href)}, shortCircuit: true } : next(specifier, context); }`);
    writeFileSync(join(dir, 'register.mjs'), `import { register } from 'node:module'; register(${JSON.stringify(pathToFileURL(join(dir, 'hooks.mjs')).href)});`);
    nodeHooks = join(dir, 'register.mjs');
  }
  const run = spawnSync(process.execPath, ['--import', pathToFileURL(nodeHooks).href, path], { encoding: 'utf8', timeout: 120_000, maxBuffer: 1 << 26 });
  return [...(run.stdout ?? '').matchAll(/^# Subtest: (.+)$/gm)].map(([, name]) => name);
}

/** The names a test file's suite lists, each as `named` joins it, or null when its runner can't list them. */
const lists = new Map();
function suiteList(path) {
  if (lists.has(path)) return lists.get(path);
  let names = null;
  if (/\.test\.[cm]?js$/.test(path)) names = nodeList(path);
  else if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) {
    const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'list', path, '--json'], { encoding: 'utf8', timeout: 300_000, maxBuffer: 1 << 26 });
    try { names = JSON.parse(run.stdout).map(({ name }) => name.split(' > ').join(' › ')); } catch { names = null; }
  } else if (path.endsWith('.rs')) {
    let crate = dirname(path);
    while (crate !== '.' && !existsSync(join(crate, 'Cargo.toml'))) crate = dirname(crate);
    const run = spawnSync('cargo', ['test', '--locked', '-q', '--', '--list'], { cwd: crate, encoding: 'utf8', timeout: 1_800_000, maxBuffer: 1 << 26 });
    names = run.status === 0 ? [...run.stdout.matchAll(/^(.+): test$/gm)].map(([, name]) => name) : null;
  }
  lists.set(path, names);
  return names;
}

/** Every changed file of a crate: its path, its text and its hunks. A vendored license isn't a change of ours. */
function changesIn(crate, pinned) {
  const changes = [];
  for (const inner of filesUnder(crate.dir, ours(crate))) {
    const path = `${crate.dir}/${inner}`, from = join(pinned, inner), there = existsSync(from);
    if (there && readFileSync(from).equals(readFileSync(path))) continue;
    if (!there && /^LICENSE/.test(inner)) continue;
    const text = readFileSync(path, 'utf8');
    changes.push({ path, lines: text.split('\n'), hunks: hunksOf(path, there ? from : null, text) });
  }
  return changes;
}

function judgeRow(row, fail) {
  const name = `${row.issue} ${row.behavior}`;
  if (!/^#\d+$/.test(row.issue)) fail(`row ${row.behavior}: no issue`);
  const [, path, test] = /^`(.+?) › (.+)`$/.exec(row.test) ?? [];
  if (!path) fail(`row ${name}: no test`);
  else if (!existsSync(path)) fail(`row ${name}: the test ${path} › ${test} isn't there: no such file`);
  else if (!suiteList(path)) fail(`row ${name}: the test ${path} › ${test} can't be checked: its suite gave no list`);
  else if (!suiteList(path).includes(test)) fail(`row ${name}: the test ${path} › ${test} isn't in its suite's list`);
  if (!row.removal || /^(?:[—–-]|none:?)$/i.test(row.removal)) fail(`row ${name}: no removal condition; name the upstream change that would retire it, or none: <reason>`);
  const [, allowed, reason] = /^(\d+) over(?::\s*(.*))?$/.exec(row.budget) ?? [];
  if (allowed && !reason) fail(`row ${name}: a raised budget with no reason`);
  const over = row.hunks.filter(({ size, fresh }) => !fresh && size > HUNK_BUDGET).length + row.overFiles.length;
  say(`ROW ${name}: ${row.hunks.length} marked, ${over} over budget`);
  if (!row.hunks.length) fail(`row ${name}: no marked hunks`);
  if (allowed && over > Number(allowed)) fail(`row ${name}: ${over} hunks over budget, the row allows ${allowed}`);
  if (allowed) return;
  for (const { path: file, line, size, fresh } of row.hunks) if (!fresh && size > HUNK_BUDGET) fail(`${file}:${line}: hunk of ${size} lines, over the budget of ${HUNK_BUDGET}`);
  for (const { path: file, added } of row.overFiles) fail(`${file}: ${added} added, over the budget of ${FILE_BUDGET} a file`);
}

async function check() {
  let refused = 0;
  const refuse = (line) => { refused += 1; say(line); };
  const fail = (line) => refuse(`FAIL ${line}`);
  const rows = readTable();
  if (!rows) fail(`${TABLE}: no carried-patch table under ${HEADING}`);
  for (const crate of crates()) {
    const pinned = await release(crate);
    if (!pinned) {
      refuse(`BLOCKED ${crate.name} ${crate.version}: no pinned release to compare with; fetch it from the network once, or set DEEP_VENDOR_RELEASES`);
      continue;
    }
    for (const { path, lines, hunks } of rows ? changesIn(crate, pinned) : []) {
      const listed = rows.filter(({ files }) => files.includes(path));
      if (!listed.length) {
        fail(`${path}: no row in the carried-patch table`);
        continue;
      }
      for (const hunk of hunks) {
        const issues = marksOf(hunk, lines);
        const owners = listed.filter(({ issue }) => issues.includes(issue));
        if (!owners.length) fail(`${path}:${hunk.line}: a carried hunk with no mark${issues.length ? ` of this file's rows (it names ${issues.join(', ')})` : ''}`);
        for (const row of owners) row.hunks.push({ ...hunk, path });
      }
      const added = hunks.reduce((sum, hunk) => sum + hunk.added, 0);
      if (added > FILE_BUDGET) for (const row of listed) row.overFiles.push({ path, added });
    }
  }
  for (const row of rows ?? []) judgeRow(row, fail);
  return refused ? 1 : 0;
}

async function diff() {
  for (const crate of crates()) {
    const pinned = await release(crate);
    if (!pinned) {
      say(`BLOCKED ${crate.name} ${crate.version}: no pinned release to compare with`);
      return 1;
    }
    for (const { path } of changesIn(crate, pinned)) {
      const from = join(pinned, relative(crate.dir, path));
      process.stdout.write(gitDiff(existsSync(from) ? from : '/dev/null', path, 3));
    }
  }
  return 0;
}

/** One file's three-way merge, in place: the `<<<<<<<` lines it left. */
function mergeFile(path, base, theirs) {
  const run = spawnSync('git', ['merge-file', '-q', '-L', 'ours', '-L', 'pinned', '-L', 'new', path, base, theirs], { encoding: 'utf8' });
  if (run.error || run.status < 0 || run.status > 127) throw Error(`git merge-file failed on ${path}: ${run.error?.message ?? run.stderr}`);
  return readFileSync(path, 'utf8').split('\n').flatMap((line, index) => (line.startsWith('<<<<<<<') ? [index + 1] : []));
}

async function merge(name, version) {
  const crate = crates().find((each) => each.name === name);
  if (!crate || !version) {
    say(`INVALID merge: ${name ?? 'no crate'} ${version ?? 'no version'}: name a folder under vendor/ and its new release`);
    return 2;
  }
  const [from, to] = [await release(crate), await release(crate, version)];
  if (!from || !to) {
    say(`BLOCKED ${name}: no release ${from ? version : crate.version}`);
    return 1;
  }
  const same = (a, b) => readFileSync(a).equals(readFileSync(b));
  const conflicts = [];
  const before = mkdtempSync(join(tmpdir(), 'vendor-merge-'));
  process.on('exit', () => rmSync(before, { recursive: true, force: true }));
  cpSync(crate.dir, before, { recursive: true, filter: (from) => relative(crate.dir, from).split('/')[0] !== 'target' });
  for (const inner of new Set([...filesUnder(from), ...filesUnder(to)])) {
    const path = join(crate.dir, inner), base = join(from, inner), theirs = join(to, inner);
    const inBase = existsSync(base), inNew = existsSync(theirs), inOurs = existsSync(path);
    if (inBase && !inOurs) continue; // a file we don't vendor
    if (!inNew) {
      if (same(base, path)) rmSync(path);
      else conflicts.push(`${path}:1`); // we carry a change in a file the new release dropped
    } else if (!inOurs || same(base, path)) {
      mkdirSync(dirname(path), { recursive: true });
      cpSync(theirs, path);
    } else if (!inBase) {
      conflicts.push(`${path}:1`); // both added it
    } else if (!same(base, theirs) && !same(path, theirs)) {
      conflicts.push(...mergeFile(path, base, theirs).map((line) => `${path}:${line}`));
    }
  }
  for (const conflict of conflicts) say(`CONFLICT ${toPosix(conflict)}`);
  if (conflicts.length) return 1;
  // A clean merge proves the source only: the pin moves when every test of a row of this tree passes on it.
  const tests = [...new Set((readTable() ?? []).filter(({ files }) => files.some((file) => file.startsWith(`${crate.dir}/`))).map(({ test }) => test))];
  const failed = tests.flatMap((test) => { const why = runTest(test); return why ? [`${test.replace(/^`|`$/g, '')}: ${why}`] : []; });
  if (!failed.length) return 0;
  for (const inner of filesUnder(crate.dir, ours(crate))) if (!existsSync(join(before, inner))) rmSync(join(crate.dir, inner));
  cpSync(before, crate.dir, { recursive: true });
  for (const line of failed) say(`FAIL ${line}, on ${crate.name} ${version}; the tree is back as it was and the pin stays at ${crate.version}`);
  return 1;
}

/** Runs one row's test, named as its cell names it: null when it passed, else why not. */
function runTest(cell) {
  const [, path, name] = /^`(.+?) › (.+)`$/.exec(cell) ?? [];
  if (!path || !existsSync(path)) return 'no such test';
  const last = name.split(' › ').at(-1);
  const exact = `^${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
  const options = { encoding: 'utf8', timeout: 3_600_000, maxBuffer: 1 << 28 };
  let states = [];
  if (/\.test\.[cm]?js$/.test(path)) {
    const run = spawnSync(process.execPath, ['--test-reporter=tap', `--test-name-pattern=${exact}`, path], options);
    states = [...(run.stdout ?? '').matchAll(/^\s*(not )?ok \d+ - (.*?)(?: # (?:SKIP|TODO)\b.*)?$/gm)].filter(([line, , each]) => each === last && !/ # (?:SKIP|TODO)\b/.test(line)).map(([, not]) => (not ? 'failed' : 'passed'));
  } else if (path.endsWith('.rs')) {
    let crate = dirname(path);
    while (crate !== '.' && !existsSync(join(crate, 'Cargo.toml'))) crate = dirname(crate);
    const run = spawnSync('cargo', ['test', '--locked', name, '--', '--exact'], { ...options, cwd: crate });
    states = [...(run.stdout ?? '').matchAll(/^test (\S+) \.\.\. (\w+)$/gm)].filter(([, each]) => each === name).map(([, , state]) => (state === 'ok' ? 'passed' : 'failed'));
  } else {
    const out = join(mkdtempSync(join(tmpdir(), 'vendor-vitest-')), 'report.json');
    spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', path, '-t', exact.slice(1, -1), '--reporter=json', `--outputFile=${out}`], options);
    const report = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { testResults: [] };
    rmSync(dirname(out), { recursive: true, force: true });
    states = report.testResults.flatMap(({ assertionResults }) => assertionResults).filter(({ ancestorTitles, title }) => [...ancestorTitles, title].join(' › ') === name).map(({ status }) => status);
  }
  if (!states.length) return 'ran no test by that name';
  return states.every((state) => state === 'passed') ? null : 'fails';
}

const [command, ...rest] = process.argv.slice(2);
const commands = { check, diff, merge };
if (!commands[command]) {
  console.log('usage: node scripts/vendor-rebase.mjs check | diff | merge <crate> <version>');
  process.exitCode = 2;
} else {
  process.exitCode = await commands[command](...rest);
}
