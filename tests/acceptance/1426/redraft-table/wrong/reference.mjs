// A small reference of the surface (../README.md), for the judges' self-tests only: `check`, `merge` and `diff` on a
// planted tree with stub releases under DEEP_VENDOR_RELEASES. It reads only stub releases and lists only node --test
// suites, which is all the plants need. Each twin in this folder is it with one fault, and control.mjs is it with none.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const README = 'vendor/gpui-pre-apple/upstream/README.md';
const MARK = /DeepBuild patch \(windoliver\/deepbuild#(\d+)\)/;
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

/** A tree's release: `<folder>-<version>` from its Cargo.toml, or its folder's own name when it has none. */
function treeOf(root, name) {
  const manifest = join(root, 'vendor', name, 'Cargo.toml');
  if (!existsSync(manifest)) return { name, release: name, crate: false };
  const version = /^\[package\][^[]*?^version = "([^"]+)"/ms.exec(readFileSync(manifest, 'utf8'))?.[1];
  return { name, release: `${name}-${version}`, version, crate: true };
}

function table(root) {
  const lines = readFileSync(join(root, README), 'utf8').split('\n');
  const start = lines.indexOf('## Carried patches');
  const rows = [];
  let header;
  for (let index = start + 1; start >= 0 && index < lines.length && !lines[index].startsWith('#'); index += 1) {
    if (!lines[index].startsWith('|')) { if (header) break; continue; }
    const cells = lines[index].trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
    if (!header) header = cells;
    else if (!/^-+$/.test(cells[0])) rows.push(Object.fromEntries(header.map((key, at) => [key, cells[at] ?? ''])));
  }
  return rows.map((row) => ({ ...row, files: [...(row.Files ?? '').matchAll(/`([^`]+)`/g)].map(([, file]) => file) }));
}

/** The names `node --test` lists for a test file, null when the file isn't there. */
function suiteList(root, path) {
  if (!existsSync(join(root, path))) return null;
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path], { cwd: root, encoding: 'utf8' });
  return new Set([...run.stdout.matchAll(/^# Subtest: (.+)$/gm)].map(([, name]) => name));
}

/** Our file's hunks against its release's: `{ first, last, size }`, lines of ours, as `git diff -U0` gives them. */
function hunksOf(theirs, ours) {
  const run = spawnSync('git', ['diff', '--no-index', '-U0', '--no-color', theirs, ours], { encoding: 'utf8' });
  return [...run.stdout.matchAll(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map(([, removed = '1', at, added = '1']) => {
    const first = Number(added) ? Number(at) : Number(at) + 1;
    return { first, last: first + Number(added) - 1, size: Number(added), removed: Number(removed) };
  });
}

function check(root, faults) {
  const out = [];
  const releases = process.env.DEEP_VENDOR_RELEASES;
  const rows = table(root);
  const listed = new Set(rows.flatMap((row) => row.files));
  const trees = readdirSync(join(root, 'vendor')).filter((name) => statSync(join(root, 'vendor', name)).isDirectory()).map((name) => treeOf(root, name));
  const rowRule = (tree) => !faults.noRowRule && (faults.gpuiOnly ? tree.name.startsWith('gpui') : faults.cratesOnly ? tree.crate : true);
  const marked = new Map(rows.map((row) => [row, []]));
  const breaches = new Map(rows.map((row) => [row, []]));
  for (const tree of trees) {
    const release = join(releases ?? '', tree.release);
    if (!releases || !existsSync(release)) {
      if (!faults.missingPasses) out.push(`BLOCKED ${tree.name}: no pinned release ${tree.release} to compare with`);
      continue;
    }
    for (const inner of walk(join(root, 'vendor', tree.name))) {
      const path = `vendor/${tree.name}/${inner}`;
      if (path.startsWith('vendor/gpui-pre-apple/upstream/') || (!tree.crate && inner === 'README.md')) continue;
      if (faults.topLevel && inner.split('/').length > 2) continue;
      const theirs = join(release, inner);
      const fresh = !existsSync(theirs);
      if ((fresh && faults.changedOnly) || (faults.manifestExempt && inner === 'Cargo.toml')) continue;
      if (!fresh && readFileSync(theirs).equals(readFileSync(join(root, path)))) continue;
      if (!listed.has(path) && rowRule(tree)) out.push(faults.unnamed ? 'FAIL a vendored file has no row in the carried-patch table' : `FAIL ${path}: no row in the carried-patch table`);
      if (!tree.crate) continue;
      const lines = readFileSync(join(root, path), 'utf8').split('\n');
      const marks = lines.map((line, at) => [at + 1, MARK.exec(line)?.[1]]).filter(([, issue]) => issue);
      const hunks = fresh ? [{ first: 1, last: lines.length, size: lines.length, fresh: true }] : hunksOf(theirs, join(root, path));
      let added = 0;
      for (const hunk of hunks) {
        added += hunk.size;
        const near = (at) => (hunk.fresh || faults.markInsideOnly ? at >= hunk.first && at <= hunk.last : at >= hunk.first - 2 && at <= hunk.last + 2);
        const mark = faults.markAnywhere ? marks[0] : marks.find(([at]) => near(at));
        if (!mark && faults.additionsOnly && hunk.removed) continue;
        if (!mark) {
          if (!faults.noMarkRule) out.push(faults.noLine ? `FAIL ${path}: a carried hunk with no mark` : `FAIL ${path}:${hunk.first}: a carried hunk with no mark`);
          continue;
        }
        const owners = rows.filter((row) => row.files.includes(path) && row.Issue === `#${mark[1]}`);
        for (const row of owners) marked.get(row).push({ path, ...hunk });
        const limit = faults.limit ?? HUNK_BUDGET;
        if (!faults.noBudget && (!hunk.fresh || faults.budgetsFresh) && (faults.markNotCounted ? hunk.size - 1 : hunk.size) > limit) {
          for (const row of owners) breaches.get(row).push(faults.noSize ? `FAIL ${path}:${hunk.first}: hunk over the budget` : `FAIL ${path}:${hunk.first}: hunk of ${hunk.size} lines, over the budget of ${HUNK_BUDGET}`);
        }
      }
      if (!faults.noFileBudget && (!hunks[0]?.fresh || faults.budgetsFresh) && added > FILE_BUDGET) {
        for (const row of rows.filter((one) => one.files.includes(path))) breaches.get(row).push(`FAIL ${path}: ${added} added, over the budget of ${FILE_BUDGET} a file`);
      }
    }
  }
  let over = 0, allowed = 0;
  const lists = new Map();
  for (const row of rows) {
    const name = `row ${row.Issue} ${row.Behavior}`;
    if (!/^#\d+$/.test(row.Issue) && !faults.noIssueRule) out.push(`FAIL row ${row.Behavior}: no issue`);
    const count = faults.countFiles ? new Set(marked.get(row).map(({ path }) => path)).size : marked.get(row).length;
    const [, number = '0', reason] = /^(\d+) over(?::\s*(.*))?$/.exec(row.Budget) ?? [];
    const own = breaches.get(row);
    over += own.length; allowed += Number(number);
    if (Number(number) && !reason && !faults.noReasonRule) out.push(`FAIL ${name}: raises its budget to ${number} with no reason`);
    if (!faults.noCounts) out.push(faults.noOverCount ? `ROW ${row.Issue} ${row.Behavior}: ${count} marked` : `ROW ${row.Issue} ${row.Behavior}: ${count} marked, ${own.length} over budget`);
    if (!count && !faults.emptyRowPasses) out.push(`FAIL ${name}: no marked hunk`);
    if (!faults.totalOnly && own.length > Number(number)) {
      if (!Number(number)) out.push(...own);
      else if (!faults.noRatchet) out.push(`FAIL ${name}: ${own.length} hunks over budget, the row allows ${number}`);
    }
    const [, path, test] = /^`(.+?) › (.+)`$/.exec(row.Test) ?? [];
    if (!path) { if (!faults.noTestRule) out.push(`FAIL ${name}: no test`); }
    else {
      if (!lists.has(path)) lists.set(path, suiteList(root, path));
      if (!lists.get(path)?.has(test)) out.push(`FAIL ${name}: ${path} › ${test} isn't in its suite's own list`);
    }
    const removal = (row.Removal ?? '').trim();
    if (!removal || /^[—–-]$/.test(removal) || /^none:?$/i.test(removal)) out.push(`FAIL ${name}: no removal condition`);
  }
  if (faults.totalOnly && over > allowed) out.push(`FAIL ${over} hunks over budget, the table allows ${allowed}`);
  console.log(out.join('\n'));
  return out.some((line) => /^(?:FAIL|BLOCKED)\b/.test(line)) ? 1 : 0;
}

/** The rows' tests that fail, run by node --test in the tree. */
function failingTests(root, rows) {
  const failing = [];
  for (const row of rows) {
    const [, path, test] = /^`(.+?) › (.+)`$/.exec(row.Test) ?? [];
    if (!path) continue;
    const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path], { cwd: root, encoding: 'utf8' });
    if (new RegExp(`^not ok \\d+ - ${test.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(run.stdout) || !run.stdout.includes(`# Subtest: ${test}`)) failing.push(`${path} › ${test}`);
  }
  return failing;
}

function merge(root, crate, version, faults) {
  const releases = process.env.DEEP_VENDOR_RELEASES;
  const tree = treeOf(root, crate);
  const from = join(releases, tree.release), to = join(releases, `${crate}-${version}`);
  const dir = join(root, 'vendor', crate);
  const rows = table(root).filter((row) => row.files.some((file) => file.startsWith(`vendor/${crate}/`)));
  const before = Object.fromEntries(walk(dir).map((inner) => [inner, readFileSync(join(dir, inner))]));
  const conflicts = [];
  for (const inner of new Set([...walk(dir), ...walk(to)])) {
    if (inner.startsWith('upstream/')) continue;
    const read = (base) => (existsSync(join(base, inner)) ? join(base, inner) : '/dev/null');
    if (faults.theirs) { if (existsSync(join(to, inner))) writeFileSync(join(dir, inner), readFileSync(join(to, inner))); continue; }
    if (faults.ours) continue;
    const merged = (...flags) => spawnSync('git', ['merge-file', '-p', '-L', 'ours', '-L', 'base', '-L', 'theirs', ...flags, read(dir), read(from), read(to)], { encoding: 'utf8' }).stdout;
    const run = merged();
    run.split('\n').forEach((line, at) => { if (line.startsWith('<<<<<<<')) conflicts.push(faults.noLine ? `CONFLICT vendor/${crate}/${inner}` : `CONFLICT vendor/${crate}/${inner}:${at + 1}`); });
    writeFileSync(join(dir, inner), faults.noMarkers ? merged('--ours') : run);
    if (faults.listsEvery) {
      run.split('\n').forEach((line, at) => { if (MARK.test(line)) conflicts.push(`CONFLICT vendor/${crate}/${inner}:${at + 1}`); });
    }
  }
  const manifest = join(dir, 'Cargo.toml');
  const pin = (to) => writeFileSync(manifest, readFileSync(manifest, 'utf8').replace(/^version = "[^"]+"$/m, `version = "${to}"`));
  if (conflicts.length) {
    pin(tree.version);
    if (!faults.silent) console.log(conflicts.join('\n'));
    return faults.exitZero ? 0 : 1;
  }
  const failing = failingTests(root, rows);
  if (failing.length) {
    for (const [inner, content] of Object.entries(before)) writeFileSync(join(dir, inner), content);
    for (const inner of walk(dir)) if (!(inner in before)) rmSync(join(dir, inner));
    for (const test of failing) console.log(`FAIL ${test}: fails on ${crate} ${version}; the pin stays at ${tree.version}`);
    return 1;
  }
  pin(version);
  console.log(`MOVED ${crate} ${tree.version} -> ${version}`);
  return 0;
}

function diff(root, faults) {
  const releases = process.env.DEEP_VENDOR_RELEASES;
  for (const name of readdirSync(join(root, 'vendor'))) {
    const tree = treeOf(root, name);
    const release = join(releases, tree.release);
    for (const inner of walk(join(root, 'vendor', name))) {
      if (inner.startsWith('upstream/') || (!tree.crate && inner === 'README.md') || faults.diffSilent) continue;
      const theirs = existsSync(join(release, inner)) ? join(release, inner) : '/dev/null';
      const run = spawnSync('git', ['diff', '--no-index', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', theirs, join(root, 'vendor', name, inner)], { encoding: 'utf8' });
      if (run.stdout) process.stdout.write(`--- release/vendor/${name}/${inner}\n+++ vendor/${name}/${inner}\n${run.stdout.split('\n').filter((line) => !/^(?:diff|index|---|\+\+\+) /.test(line)).join('\n')}\n`);
    }
  }
  return 0;
}

export function main(faults = {}) {
  const [command, ...args] = process.argv.slice(2);
  const root = process.cwd();
  process.exitCode = command === 'check' ? check(root, faults) : command === 'merge' ? merge(root, args[0], args[1], faults) : command === 'diff' ? diff(root, faults) : 2;
}
