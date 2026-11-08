// #1426's judges of the real tree: the carried-patch table in vendor/gpui-pre-apple/upstream/README.md, the vendored
// files against their real pinned releases, the refusal and the design's line. Fetching a release needs the network;
// a machine that can't fetch one gets an INCONCLUSIVE line, which fails the test, never a pass.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { carriedRows, cleanEnv, clip, linesOf, README, refusals, rowTest, tempRoot } from './common.mjs';

/** The four behaviors AC2 names, each as its row's Behavior cell must read. */
export const NAMED = [
  ['the sRGB layer tag', /sRGB/i],
  ['the exact gradient mode', /exact gradient/i],
  ['the BGRA surface', /BGRA/i],
  ['the surface reports', /report/i],
];

const crateTree = (root) => readdirSync(join(root, 'vendor')).filter((name) => existsSync(join(root, 'vendor', name, 'Cargo.toml')));
export const pinOf = (root, name) => /^version = "(.+)"$/m.exec(readFileSync(join(root, 'vendor', name, 'Cargo.toml'), 'utf8'))?.[1];

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

/**
 * The real pinned releases, unpacked as `<dir>/<crate>-<version>/`: gpui-pre and gpui-pre-apple from crates.io, at
 * their pins and at each of `more`, and quickjs-jit-runtime from the `jit` folder of the quickjs-jit commit its
 * manifest names. Answers `{ dir }`, with `inconclusive` when one can't be had.
 */
export function fetchReleases(root, more = []) {
  const dir = tempRoot('releases');
  const curl = (url, file) => spawnSync('curl', ['-fsSL', '-m', '180', '-o', file, url], { encoding: 'utf8' });
  const untar = (file, ...rest) => spawnSync('tar', ['xzf', file, '-C', dir, ...rest], { encoding: 'utf8' });
  for (const [name, version] of ['gpui-pre', 'gpui-pre-apple'].flatMap((crate) => [pinOf(root, crate), ...more].map((version) => [crate, version]))) {
    const file = join(dir, `${name}-${version}.crate`);
    const got = curl(`https://static.crates.io/crates/${name}/${name}-${version}.crate`, file);
    if (got.status !== 0) return { dir, inconclusive: `INCONCLUSIVE: can't fetch ${name} ${version} from crates.io: ${got.stderr.trim()}` };
    if (untar(file).status !== 0) return { dir, inconclusive: `INCONCLUSIVE: can't unpack ${name} ${version}` };
  }
  const manifest = readFileSync(join(root, 'vendor/quickjs-jit-runtime/Cargo.toml'), 'utf8');
  const rev = /rev = "([0-9a-f]{40})"/.exec(manifest)?.[1];
  if (!rev) return { dir, inconclusive: "INCONCLUSIVE: vendor/quickjs-jit-runtime/Cargo.toml names no commit" };
  const file = join(dir, 'quickjs.tgz');
  const got = curl(`https://codeload.github.com/longbridge/quickjs-jit/tar.gz/${rev}`, file);
  if (got.status !== 0) return { dir, inconclusive: `INCONCLUSIVE: can't fetch quickjs-jit ${rev}: ${got.stderr.trim()}` };
  const target = join(dir, `quickjs-jit-runtime-${pinOf(root, 'quickjs-jit-runtime')}`);
  mkdirSync(target);
  if (spawnSync('tar', ['xzf', file, '-C', target, '--strip-components=2', `quickjs-jit-${rev}/jit`], { encoding: 'utf8' }).status !== 0) return { dir, inconclusive: `INCONCLUSIVE: can't unpack quickjs-jit ${rev}` };
  return { dir };
}

/**
 * The vendored files that differ from `releases`, counted here and not by the script: a file its release holds with
 * other bytes, or one the release lacks, less upstream/ (ours) and a license file a vendored crate must keep.
 */
export function differing(root, releases) {
  return crateTree(root).flatMap((name) => {
    const tree = join(root, 'vendor', name), release = join(releases, `${name}-${pinOf(root, name)}`);
    return walk(tree).map((file) => relative(tree, file)).filter((inner) => {
      if (inner.startsWith('upstream/')) return false;
      const old = join(release, inner);
      if (!existsSync(old)) return !/^LICENSE/.test(inner);
      return !readFileSync(old).equals(readFileSync(join(tree, inner)));
    }).map((inner) => `vendor/${name}/${inner}`);
  });
}

const rowsAt = (root) => carriedRows(existsSync(join(root, README)) ? readFileSync(join(root, README), 'utf8') : '');

/** AC1 on the tree: each differing file has a row, each row an issue and a test that's there. */
export function judgeTable(root, releases) {
  const rows = rowsAt(root);
  if (!rows) return [`${README} has no carried-patch table with the columns the README pins`];
  const failures = [];
  const listed = new Set(rows.flatMap(({ files }) => files));
  for (const path of differing(root, releases)) if (!listed.has(path)) failures.push(`${path} differs from its pinned release and has no row`);
  for (const row of rows) {
    if (!/^#\d+$/.test(row.issue)) failures.push(`the row "${row.behavior}" names no issue: "${row.issue}"`);
    if (!row.behavior) failures.push('a row says nothing of what it does');
    if (!row.files.length) failures.push(`the row "${row.behavior}" names no file`);
    const named = rowTest(row.test);
    if (!named) failures.push(`the row "${row.behavior}" names no test: "${row.test}"`);
    else if (!existsSync(join(root, named.path)) || !readFileSync(join(root, named.path), 'utf8').includes(named.name)) failures.push(`the row "${row.behavior}" names a test that isn't there: ${named.path} › ${named.name}`);
  }
  for (const [name, pattern] of NAMED) if (!rows.some((row) => pattern.test(row.behavior))) failures.push(`no row for ${name}`);
  return failures;
}

const number = (cell) => (cell === '—' ? 0 : Number(/^(\d+) over: \S/.exec(cell ?? '')?.[1] ?? NaN));

/** AC1, AC6 and AC10 on the tree: `check` run as the lane runs it passes, and prints each row's counts within its number. */
export function judgeRealCheck(script, root, { env = {} } = {}) {
  if (!existsSync(script)) return [`no script at ${script}`];
  const rows = rowsAt(root);
  if (!rows) return [`${README} has no carried-patch table with the columns the README pins`];
  const run = spawnSync(process.execPath, [script, 'check'], { cwd: root, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, env: cleanEnv(env) });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  if (refusals(output).some((line) => /^(?:BLOCKED|INCONCLUSIVE)\b/.test(line))) return [`INCONCLUSIVE: check can't reach a pinned release here: ${clip(output)}`];
  const failures = [];
  if (run.status !== 0 || refusals(output).length) failures.push(`check fails the tree (exit ${run.status}): ${clip(output)}`);
  const printed = linesOf(output, 'ROW');
  for (const row of rows) {
    const line = printed.find((text) => text.startsWith(`ROW ${row.issue} ${row.behavior}:`));
    const [, marked, over] = /: (\d+) marked, (\d+) over budget/.exec(line ?? '') ?? [];
    if (marked === undefined) failures.push(`check prints no ROW line for "${row.behavior}": ${clip(output)}`);
    else {
      if (Number(marked) === 0) failures.push(`the row "${row.behavior}" counts no marked hunk`);
      if (Number.isNaN(number(row.budget))) failures.push(`the row "${row.behavior}" has a Budget cell that is neither — nor N over: reason: "${row.budget}"`);
      else if (Number(over) > number(row.budget)) failures.push(`the row "${row.behavior}" has ${over} hunks over budget, its number ${number(row.budget)}`);
    }
  }
  return failures;
}

/** Scope: the file records zed's refusal, with its date and link, and no longer calls the patch open. */
export function judgeRefusal(root) {
  const text = existsSync(join(root, README)) ? readFileSync(join(root, README), 'utf8') : '';
  const paragraph = text.split('\n\n').find((part) => part.includes('zed-industries/zed/pull/66114') && /(?:October 28, 2026|2026-10-28)/.test(part));
  if (!paragraph) return [`${README} has no paragraph with the link https://github.com/zed-industries/zed/pull/66114 and the date October 28, 2026`];
  const failures = [];
  if (!/\b(?:closed|refused|declined|rejected|unmerged)\b/i.test(paragraph)) failures.push(`the paragraph with the link and the date doesn't say the patch was refused: ${paragraph.slice(0, 300)}`);
  if (/is open and ready for review/.test(text)) failures.push(`${README} still calls the pull request open`);
  return failures;
}

/** Scope: the design's "only patch" line is corrected: the toolkit's Decided row names what we carry. */
export function judgeDesign(root) {
  const row = readFileSync(join(root, 'docs/technical-design.md'), 'utf8').split('\n').find((line) => line.startsWith("| The app's toolkit |"));
  if (!row) return ["docs/technical-design.md has no row \"The app's toolkit\""];
  if (/the only patch/i.test(row)) return ["the toolkit's Decided row still calls rquickjs the only patch"];
  return /vendor\/gpui-pre/.test(row) ? [] : ["the toolkit's Decided row doesn't name the vendored GPUI patches (vendor/gpui-pre)"];
}
