// #1426.4ef6dcfa on the real tree: the carried-patch table against the pinned releases, by a count of this judge's own,
// with the refusal paragraph and the design's line. It answers its failures, one line each; an empty list means the tree
// meets the criterion. It fetches the pinned releases unless it is given a folder of them, laid out as
// DEEP_VENDOR_RELEASES is (`<folder>-<version>/` a crate, `<folder>/` a tree with no Cargo.toml). It never builds a
// crate: a Rust test list is read from the sources (README.md, How each criterion is read).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanEnv, README, readTable, remove, rowTest, tempRoot } from './common.mjs';

const DESIGN = 'docs/technical-design.md';
const LIST_NODE = fileURLToPath(new URL('./list-node.mjs', import.meta.url));
/** #711's mark, and the base's shorter form, each naming the issue. */
const MARK = /DeepBuild patch \((?:windoliver\/deepbuild)?#(\d+)\)/;
const HUNK_BUDGET = 8;
const FILE_BUDGET = 40;

function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (['target', 'node_modules', '.git'].includes(name)) return [];
    return statSync(path).isDirectory() ? walk(path, base) : [relative(base, path)];
  });
}

const packageOf = (manifest) => {
  const text = readFileSync(manifest, 'utf8');
  const section = /^\[package\]([^[]*)/m.exec(text)?.[1] ?? '';
  return { name: /^name = "([^"]+)"/m.exec(section)?.[1], version: /^version = "([^"]+)"/m.exec(section)?.[1], text };
};

/** Each tree under vendor/: `{ folder, release, crate }`, `release` naming its folder in the releases folder. */
function treesOf(root) {
  return readdirSync(join(root, 'vendor')).filter((folder) => statSync(join(root, 'vendor', folder)).isDirectory()).map((folder) => {
    const manifest = join(root, 'vendor', folder, 'Cargo.toml');
    if (!existsSync(manifest)) return { folder, release: folder, crate: false };
    const { name, version, text } = packageOf(manifest);
    return { folder, name, version, release: `${folder}-${version}`, crate: true, git: /git = "https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?", rev = "([0-9a-f]{7,40})"/.exec(text) };
  });
}

const curl = (url, out) => spawnSync('curl', ['-sSfL', '--retry', '3', '--retry-all-errors', '-o', out, url], { encoding: 'utf8', timeout: 600_000 });

/**
 * Fetches each tree's pinned release into `dir`: a crate from crates.io at its version, or, when its manifest pins a
 * GitHub repository at a rev, that repository's folder whose manifest names the crate, with the repository's top-level
 * files it lacks (its LICENSE); a tree with no Cargo.toml from the URLs its README lists. Answers its failures.
 */
export function fetchReleases(root, dir) {
  const failures = [];
  const scratch = join(dir, '.downloads');
  mkdirSync(scratch, { recursive: true });
  for (const tree of treesOf(root)) {
    const into = join(dir, tree.release);
    if (tree.crate && tree.git) {
      const [, repo, rev] = tree.git;
      const archive = join(scratch, `${tree.folder}.tar.gz`);
      const unpacked = join(scratch, tree.folder);
      mkdirSync(unpacked, { recursive: true });
      const got = curl(`https://codeload.github.com/${repo}/tar.gz/${rev}`, archive);
      if (got.status !== 0) { failures.push(`INCONCLUSIVE: can't fetch ${repo} at ${rev} for ${tree.folder}: ${got.stderr.trim()}`); continue; }
      spawnSync('tar', ['-xzf', archive, '-C', unpacked]);
      const top = join(unpacked, readdirSync(unpacked)[0] ?? '');
      const folder = walk(top).filter((path) => path.endsWith('Cargo.toml')).map((path) => dirname(join(top, path))).find((path) => packageOf(join(path, 'Cargo.toml')).name === tree.name);
      if (!folder) { failures.push(`INCONCLUSIVE: ${repo} at ${rev} holds no crate named ${tree.name}`); continue; }
      cpSync(folder, into, { recursive: true });
      for (const name of readdirSync(top)) if (statSync(join(top, name)).isFile() && !existsSync(join(into, name))) cpSync(join(top, name), join(into, name));
    } else if (tree.crate) {
      const archive = join(scratch, `${tree.release}.crate`);
      const got = curl(`https://static.crates.io/crates/${tree.name}/${tree.name}-${tree.version}.crate`, archive);
      if (got.status !== 0) { failures.push(`INCONCLUSIVE: can't fetch ${tree.name} ${tree.version} from crates.io for ${tree.folder}: ${got.stderr.trim()}`); continue; }
      const unpacked = join(scratch, tree.folder);
      mkdirSync(unpacked, { recursive: true });
      spawnSync('tar', ['-xzf', archive, '-C', unpacked]);
      cpSync(join(unpacked, `${tree.name}-${tree.version}`), into, { recursive: true });
    } else {
      const readme = join(root, 'vendor', tree.folder, 'README.md');
      const sources = existsSync(readme) ? [...readFileSync(readme, 'utf8').matchAll(/^\| `([^`]+)` \| <(https?:\/\/[^>]+)>/gm)] : [];
      if (!sources.length) { failures.push(`INCONCLUSIVE: vendor/${tree.folder} has no Cargo.toml and its README lists no source to fetch`); continue; }
      mkdirSync(into, { recursive: true });
      for (const [, file, url] of sources) {
        const got = curl(url, join(into, file));
        if (got.status !== 0) failures.push(`INCONCLUSIVE: can't fetch ${url} for vendor/${tree.folder}/${file}: ${got.stderr.trim()}`);
      }
    }
  }
  remove(scratch);
  return failures;
}

/** Our file's hunks against its release's, as `git diff -U0` gives them: `{ first, last, size }` in our lines. */
function hunksOf(theirs, ours) {
  const run = spawnSync('git', ['diff', '--no-index', '-U0', '--no-color', theirs, ours], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return [...run.stdout.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map(([, at, added = '1']) => {
    const first = Number(added) ? Number(at) : Number(at) + 1;
    return { first, last: first + Number(added) - 1, size: Number(added) };
  });
}

/** The test names a Rust file declares, with its module path in its crate, read from the source. */
function rustList(root, path) {
  let crate = dirname(join(root, path));
  while (!existsSync(join(crate, 'Cargo.toml')) && crate.startsWith(root) && crate !== root) crate = dirname(crate);
  const lib = /^\[lib\][^[]*?^path = "([^"]+)"/ms.exec(readFileSync(join(crate, 'Cargo.toml'), 'utf8'))?.[1] ?? 'src/lib.rs';
  const inner = relative(crate, join(root, path));
  const prefix = inner.startsWith('src/') && ![lib, 'src/main.rs'].includes(inner)
    ? inner.slice(4).replace(/\.rs$/, '').replace(/\/mod$/, '').split('/') : [];
  const names = new Set();
  const mods = [];
  let depth = 0, pending = false;
  for (const raw of readFileSync(join(root, path), 'utf8').split('\n')) {
    const line = raw.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)'/g, "''").replace(/\/\/.*$/, '');
    if (/^\s*#\[(?:[\w:]+::)?test(?:\(.*\))?\]/.test(line)) pending = true;
    const fn = /\bfn\s+(\w+)/.exec(line);
    if (pending && fn) {
      const name = [...prefix, ...mods.map(({ name }) => name), fn[1]];
      // The full path as cargo lists it, and each shorter tail of it.
      for (let start = 0; start < name.length; start += 1) names.add(name.slice(start).join('::'));
      pending = false;
    }
    const mod = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*\{/.exec(line);
    if (mod) mods.push({ name: mod[1], depth });
    for (const char of line) {
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        while (mods.length && mods.at(-1).depth >= depth) mods.pop();
      }
    }
  }
  return names;
}

/** The test names a test file's own suite lists, by its runner; a string when it can't be read. */
function suiteList(root, path) {
  if (!existsSync(join(root, path))) return `${path} isn't in the repo`;
  if (path.endsWith('.rs')) return rustList(root, path);
  if (/\.test\.[cm]?tsx?$/.test(path)) {
    const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'list', path, '--json'], { cwd: root, encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024, env: cleanEnv() });
    try {
      return new Set(JSON.parse(run.stdout.slice(run.stdout.indexOf('['))).map(({ name }) => name.split(' > ').join(' › ')));
    } catch {
      return `INCONCLUSIVE: vitest list ${path} gave no list (exit ${run.status}): ${`${run.stdout}${run.stderr}`.trim().slice(0, 300)}`;
    }
  }
  const run = spawnSync(process.execPath, ['--import', LIST_NODE, path], { cwd: root, encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024, env: cleanEnv() });
  return new Set([...run.stdout.matchAll(/^LISTED (".*")$/gm)].map(([, name]) => JSON.parse(name)));
}

/** The refusal paragraph and the design's line: words only, no network. */
export function judgeWords(root) {
  const failures = [];
  const readme = existsSync(join(root, README)) ? readFileSync(join(root, README), 'utf8') : '';
  const paragraph = readme.split(/\n\s*\n/).find((text) => /zed-industries\/zed(?:\/pull\/|#)66114/.test(text) && /\b(?:closed|refused|declined|rejected)\b/i.test(text) && /2026-10-28|October 28,? 2026|28 October,? 2026/.test(text));
  if (!paragraph) failures.push(`${README} has no paragraph recording zed-industries/zed#66114's refusal: its link, the word closed (or refused), and its date, October 28, 2026`);
  if (/The pull request is open/.test(readme)) failures.push(`${README} still says "The pull request is open"`);
  const design = existsSync(join(root, DESIGN)) ? readFileSync(join(root, DESIGN), 'utf8') : '';
  if (/the only patch/i.test(design)) failures.push(`${DESIGN} still says "the only patch": ${/[^\n]{0,80}the only patch[^\n]{0,80}/i.exec(design)[0]}`);
  if (!design.includes(README) && !/carried[- ]patch/i.test(design)) failures.push(`${DESIGN} names neither ${README} nor the carried-patch table`);
  return failures;
}

/**
 * The criterion on the real tree: each file that differs from its pinned release has a row; each row has an issue, a
 * removal condition and a test its suite's own list holds; each row's marked hunks number above 0, and its hunks over
 * budget are within its number. Rows sharing an issue pool their numbers, since how they split a hunk is the
 * implementer's call; hunks over budget are counted by added lines and leave manifests out, the lowest reading.
 */
export function judgeRealTree(root, { releases } = {}) {
  const failures = judgeWords(root);
  const path = join(root, README);
  const table = existsSync(path) ? readTable(readFileSync(path, 'utf8')) : null;
  if (!table) return [`${README} has no table under ## Carried patches`, ...failures];
  if (table.header.join('|') !== 'Behavior|Issue|Files|Test|Budget|Removal') failures.push(`the table's columns are ${table.header.join(', ')}, not Behavior, Issue, Files, Test, Budget, Removal`);
  if (!table.rows.length) return [...failures, 'the table has no rows'];
  const rows = table.rows;
  for (const row of rows) {
    if (!/^#\d+$/.test(row.Issue)) failures.push(`row ${row.Behavior} names no issue: "${row.Issue}"`);
    const removal = (row.Removal ?? '').trim();
    if (!removal || /^[—–-]$/.test(removal) || /^none:?$/i.test(removal)) failures.push(`row ${row.Behavior} has no removal condition: "${removal}"`);
    const test = rowTest(row.Test);
    if (!test) { failures.push(`row ${row.Behavior} names no test: "${row.Test}"`); continue; }
    const list = suiteList(root, test.path);
    if (typeof list === 'string') failures.push(`row ${row.Behavior}: ${list}`);
    else if (!list.has(test.name)) failures.push(`row ${row.Behavior}'s test "${test.name}" isn't in ${test.path}'s own list`);
  }
  let dir = releases;
  if (!dir) {
    dir = tempRoot('releases');
    const fetched = fetchReleases(root, dir);
    if (fetched.length) { remove(dir); return [...failures, ...fetched]; }
  }
  try {
    const listed = new Set(rows.flatMap((row) => row.files));
    const marked = new Map(rows.map((row) => [row, 0]));
    const overByIssue = new Map();
    let over = 0;
    for (const tree of treesOf(root)) {
      const release = join(dir, tree.release);
      if (!existsSync(release)) { failures.push(`INCONCLUSIVE: no pinned release ${tree.release} for vendor/${tree.folder}`); continue; }
      for (const inner of walk(join(root, 'vendor', tree.folder))) {
        const file = `vendor/${tree.folder}/${inner}`;
        if (file.startsWith('vendor/gpui-pre-apple/upstream/') || (!tree.crate && inner === 'README.md')) continue;
        const theirs = join(release, inner);
        const fresh = !existsSync(theirs);
        if (!fresh && readFileSync(theirs).equals(readFileSync(join(root, file)))) continue;
        if (!listed.has(file)) failures.push(`${file} differs from ${tree.release} and no row lists it`);
        const lines = readFileSync(join(root, file), 'utf8').split('\n');
        const marks = lines.map((line, at) => [at + 1, MARK.exec(line)?.[1]]).filter(([, issue]) => issue);
        const hunks = fresh ? [{ first: 1, last: lines.length, size: lines.length }] : hunksOf(theirs, join(root, file));
        const budgeted = !fresh && inner !== 'Cargo.toml';
        let added = 0;
        for (const hunk of hunks) {
          added += hunk.size;
          const mark = marks.find(([at]) => (fresh ? true : at >= hunk.first - 2 && at <= hunk.last + 2));
          for (const row of rows) if (mark && row.files.includes(file) && row.Issue === `#${mark[1]}`) marked.set(row, marked.get(row) + 1);
          if (budgeted && hunk.size > HUNK_BUDGET) {
            over += 1;
            if (mark) overByIssue.set(`#${mark[1]}`, (overByIssue.get(`#${mark[1]}`) ?? 0) + 1);
          }
        }
        if (budgeted && added > FILE_BUDGET) over += 1;
      }
    }
    const numberOf = (row) => Number(/^(\d+) over/.exec(row.Budget ?? '')?.[1] ?? 0);
    for (const row of rows) if (!marked.get(row)) failures.push(`row ${row.Behavior} has no marked hunk in its files`);
    for (const [issue, count] of overByIssue) {
      const allowed = rows.filter((row) => row.Issue === issue).reduce((sum, row) => sum + numberOf(row), 0);
      if (count > allowed) failures.push(`the rows for ${issue} carry ${count} hunks over ${HUNK_BUDGET} lines and allow ${allowed}`);
    }
    const allowed = rows.reduce((sum, row) => sum + numberOf(row), 0);
    if (over > allowed) failures.push(`the tree carries ${over} hunks and files over budget, and the rows allow ${allowed}`);
  } finally {
    if (!releases) remove(dir);
  }
  return failures;
}
