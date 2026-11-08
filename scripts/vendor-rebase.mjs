// The gpui patches are ours to carry (#1426). `check`, run by the lint lane, compares each vendored crate with its
// pinned release against the table in vendor/gpui-pre-apple/upstream/README.md: every changed file has a row, every
// hunk the mark, and every hunk and file its budget. `diff` prints what we carry. `merge <crate> <version>` three-way
// merges the new release onto our tree and leaves conflict markers. It reads and writes its working folder.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

const TABLE = 'vendor/gpui-pre-apple/upstream/README.md';
const HEADING = '## Carried patches';
const COLUMNS = 'Behavior|Issue|Files|Test|Budget';
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

/** Each vendored crate: a folder under vendor/ with a manifest, its pin being the manifest's version. */
function crates() {
  return existsSync('vendor') ? readdirSync('vendor').filter((name) => existsSync(join('vendor', name, 'Cargo.toml'))).map((name) => {
    const manifest = readFileSync(join('vendor', name, 'Cargo.toml'), 'utf8');
    return { name, dir: `vendor/${name}`, version: /^\[package\][^[]*?^version = "([^"]+)"/ms.exec(manifest)?.[1], rev: /\brev = "([0-9a-f]{40})"/.exec(manifest)?.[1] };
  }) : [];
}

/** Ours, in a vendored crate, and no part of a release. */
const ours = (inner) => inner === 'upstream' || inner === 'target';

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
async function release(crate, version, rev) {
  const stub = process.env.DEEP_VENDOR_RELEASES;
  if (stub) {
    const dir = join(stub, `${crate}-${version}`);
    return existsSync(dir) ? dir : null;
  }
  const cached = join(homedir(), '.cache/deepbuild/vendor-releases', `${crate}-${version}${FROM_GIT[crate] ? `-${rev}` : ''}`);
  return existsSync(cached) ? cached : download(crate, version, rev, cached);
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
  return table.slice(2).map(cells).map(([behavior, issue, files, test, budget]) => ({
    behavior, issue, test, budget: budget ?? '', files: [...(files ?? '').matchAll(/`([^`]+)`/g)].map(([, file]) => file), hunks: [], overFiles: [],
  }));
}

/** Every changed file of a crate: its path, its text and its hunks. A vendored license isn't a change of ours. */
function changesIn(crate, pinned) {
  const changes = [];
  for (const inner of filesUnder(crate.dir, ours)) {
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
  else if (!existsSync(path) || !readFileSync(path, 'utf8').includes(test)) fail(`row ${name}: the test ${path} › ${test} isn't there`);
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
    const pinned = await release(crate.name, crate.version, crate.rev);
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
    const pinned = await release(crate.name, crate.version, crate.rev);
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
  const [from, to] = [await release(name, crate.version, crate.rev), await release(name, version, crate.rev)];
  if (!from || !to) {
    say(`BLOCKED ${name}: no release ${from ? version : crate.version}`);
    return 1;
  }
  const same = (a, b) => readFileSync(a).equals(readFileSync(b));
  const conflicts = [];
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
  return conflicts.length ? 1 : 0;
}

const [command, ...rest] = process.argv.slice(2);
const commands = { check, diff, merge };
if (!commands[command]) {
  console.log('usage: node scripts/vendor-rebase.mjs check | diff | merge <crate> <version>');
  process.exitCode = 2;
} else {
  process.exitCode = await commands[command](...rest);
}
