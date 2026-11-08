// #1426, the scan every planted script shares: a small `scripts/vendor-rebase.mjs` in the README's surface, with each
// wrong program one fault switched on. It is not the implementation: it reads only the stub releases, and exists so
// the judges have a control that passes and twins that don't.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { carriedRows, README, RELEASES, rowTest } from '../common.mjs';

const MARK = /DeepBuild patch \(windoliver\/deepbuild#(\d+)\)/;
const root = process.cwd();
const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
}) : []);
const crates = () => readdirSync(join(root, 'vendor')).filter((name) => existsSync(join(root, 'vendor', name, 'Cargo.toml'))).map((name) => {
  const manifest = readFileSync(join(root, 'vendor', name, 'Cargo.toml'), 'utf8');
  return { name, version: /^version = "(.+)"$/m.exec(manifest)[1] };
});
const releaseOf = (crate, version) => join(process.env[RELEASES], `${crate}-${version}`);

function hunks(from, to) {
  const out = spawnSync('git', ['diff', '--no-index', '--no-color', '-U0', '--', from, to], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout;
  const found = [];
  let hunk;
  for (const line of out.split('\n')) {
    const header = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (header) found.push(hunk = { start: Number(header[1]), count: header[2] === undefined ? 1 : Number(header[2]), added: [], removed: [] });
    else if (hunk && line.startsWith('+')) hunk.added.push(line.slice(1));
    else if (hunk && line.startsWith('-')) hunk.removed.push(line.slice(1));
  }
  return found;
}

// A vendored file that differs from its release, or that its release lacks, with its hunks.
function changes(crate, fault) {
  const tree = join(root, 'vendor', crate.name), release = releaseOf(crate.name, crate.version);
  const found = [];
  for (const file of walk(tree)) {
    const inner = relative(tree, file);
    if (inner.startsWith('upstream/')) continue;
    if (fault.topLevel && inner.split('/').length > 2) continue;
    const old = join(release, inner);
    const path = `vendor/${crate.name}/${inner}`;
    if (!existsSync(old)) found.push({ path, fresh: true, lines: readFileSync(file, 'utf8').split('\n'), hunks: [{ start: 1, count: readFileSync(file, 'utf8').split('\n').length, added: readFileSync(file, 'utf8').split('\n'), removed: [] }] });
    else if (readFileSync(old, 'utf8') !== readFileSync(file, 'utf8')) found.push({ path, lines: readFileSync(file, 'utf8').split('\n'), hunks: hunks(old, file) });
  }
  return found;
}

const marked = (file, hunk, fault) => {
  if (fault.markAnywhere) return file.lines.some((line) => MARK.test(line));
  if (hunk.added.some((line) => MARK.test(line))) return true;
  const end = hunk.start + Math.max(hunk.count, 1) - 1;
  return [hunk.start - 2, hunk.start - 1, end + 1, end + 2].some((line) => MARK.test(file.lines[line - 1] ?? ''));
};

const parseBudget = (cell) => {
  if (cell === '—') return { allowed: 0, reason: 'none needed' };
  const [, count, reason] = /^(\d+) over(?:: *(.*))?$/.exec(cell) ?? [];
  return count === undefined ? null : { allowed: Number(count), reason: reason ?? '' };
};

function check(fault) {
  const say = [], fail = (text) => say.push(`FAIL ${text}`);
  const rows = carriedRows(readFileSync(join(root, README), 'utf8')) ?? [];
  let blocked = false, skipped = false;
  const files = [];
  for (const crate of crates()) {
    if (!existsSync(releaseOf(crate.name, crate.version))) {
      if (fault.missingPasses) {
        skipped = true;
        continue;
      }
      say.push(`BLOCKED ${crate.name} ${crate.version}: no pinned release to compare with`);
      blocked = true;
      continue;
    }
    files.push(...changes(crate, fault));
  }
  const counts = new Map(rows.map((row) => [row, { marked: 0, over: 0 }]));
  for (const file of files) {
    const own = rows.filter((row) => row.files.includes(file.path));
    if (!own.length && !fault.noRowRule && !(file.fresh && fault.freshNeedsNoRow) && !(fault.oneTree && !file.path.startsWith('vendor/gpui-pre-apple/'))) {
      fail(fault.unnamed ? 'a changed file has no row' : `${file.path}: no row in the carried-patch table`);
      continue;
    }
    let added = 0;
    for (const hunk of file.hunks) {
      const issue = [...hunk.added, ...file.lines.slice(Math.max(hunk.start - 3, 0), hunk.start + hunk.count + 2)].map((line) => MARK.exec(line)?.[1]).find(Boolean);
      const row = own.find((candidate) => candidate.issue === `#${issue}`) ?? own[0];
      if (!fault.noMarkRule && !marked(file, hunk, fault)) fail(`${fault.noLine ? file.path : `${file.path}:${hunk.start}`}: a carried hunk with no mark`);
      else if (row && counts.has(row)) counts.get(row).marked += 1;
      if (file.fresh && !fault.budgetsFresh) continue;
      added += hunk.added.length;
      const counted = hunk.added.filter((line) => !fault.markNotCounted || !MARK.test(line)).length + hunk.removed.length;
      if (!fault.noBudget && counted > (fault.budget ?? 8)) {
        if (row && counts.has(row)) counts.get(row).over += 1;
        const allowed = row ? parseBudget(row.budget)?.allowed ?? 0 : 0;
        if (!allowed) fail(`${file.path}:${hunk.start}: ${fault.noSize ? 'a hunk' : `hunk of ${counted} lines`} over the budget of 8`);
      }
    }
    if (!fault.noBudget && !fault.noFileBudget && added > 40 && own[0] && !parseBudget(own[0].budget)?.allowed) fail(`${file.path}: ${added} added, over the budget of 40 a file`);
  }
  for (const row of rows) {
    const name = `row ${row.issue} ${row.behavior}`;
    if (!/^#\d+$/.test(row.issue) && !fault.noIssueRule) fail(`row ${row.behavior}: it names no issue`);
    const named = rowTest(row.test);
    if (!fault.noTestRule) {
      if (!named && !fault.anyTestWord) fail(`${name}: it names no test`);
      else if (named && !fault.anyTestWord && !(existsSync(join(root, named.path)) && readFileSync(join(root, named.path), 'utf8').includes(named.name))) fail(`${name}: its test ${named.path} › ${named.name} isn't there`);
    }
    const budget = parseBudget(row.budget);
    if (!budget) fail(`${name}: its budget cell reads neither — nor N over: reason`);
    else if (budget.allowed && !budget.reason.trim() && !fault.noReasonRule) fail(`${name}: it raises a budget and gives no reason`);
    const count = counts.get(row);
    if (!count.marked && !fault.emptyRowPasses && !skipped) fail(`${name}: no marked hunks`);
    if (budget && count.over > budget.allowed && budget.allowed && !fault.noRatchet) fail(`${name}: ${count.over} hunks over budget, the row allows ${budget.allowed}`);
    if (!fault.noCounts && !fault.totalOnly) console.log(`ROW ${row.issue} ${row.behavior}: ${fault.oneMarked ? 1 : count.marked} marked, ${fault.noOverCount ? 0 : count.over} over budget`);
  }
  if (fault.totalOnly) console.log(`TOTAL ${[...counts.values()].reduce((sum, { over }) => sum + over, 0)} over budget`);
  for (const line of say) console.log(line);
  return say.length || blocked ? 1 : 0;
}

function merge(crate, version, fault) {
  const { version: old } = crates().find(({ name }) => name === crate);
  const tree = join(root, 'vendor', crate), base = releaseOf(crate, old), theirs = releaseOf(crate, version);
  const inners = new Set([...walk(base).map((file) => relative(base, file)), ...walk(theirs).map((file) => relative(theirs, file))]);
  const scratch = mkdtempSync(join(tmpdir(), 'da1426-merge-'));
  let conflicts = 0;
  for (const inner of inners) {
    const path = join(tree, inner), baseFile = join(base, inner), theirFile = join(theirs, inner);
    if (!existsSync(theirFile)) continue;
    if (!existsSync(path) || !existsSync(baseFile)) { writeFileSync(path, readFileSync(theirFile)); continue; }
    if (fault.takeTheirs) { writeFileSync(path, readFileSync(theirFile)); continue; }
    if (fault.keepOurs && !inner.endsWith('Cargo.toml')) continue;
    const ours = join(scratch, 'ours');
    writeFileSync(ours, readFileSync(path));
    const merged = spawnSync('git', ['merge-file', '-p', ...(fault.oursOnConflict ? ['--ours'] : []), '-L', 'ours', '-L', 'base', '-L', 'theirs', ours, baseFile, theirFile], { encoding: 'utf8', maxBuffer: 1 << 28 });
    writeFileSync(path, merged.stdout);
    const lines = merged.stdout.split('\n');
    lines.forEach((line, index) => {
      if (!line.startsWith('<<<<<<<')) return;
      conflicts += 1;
      if (!fault.noList) console.log(`CONFLICT vendor/${crate}/${inner}:${fault.conflictNoLine ? '' : index + 1}`);
    });
    if (fault.listsEveryHunk && !inner.endsWith('Cargo.toml')) for (const hunk of hunks(join(base, inner), path)) console.log(`CONFLICT vendor/${crate}/${inner}:${hunk.start}`);
  }
  rmSync(scratch, { recursive: true, force: true });
  return conflicts ? 1 : 0;
}

function showDiff(fault) {
  if (fault.diffSilent) return 0;
  for (const crate of crates()) {
    for (const file of changes(crate, {})) {
      if (file.fresh) continue;
      const inner = file.path.slice(`vendor/${crate.name}/`.length);
      process.stdout.write(spawnSync('git', ['diff', '--no-index', '--no-color', '--', join(releaseOf(crate.name, crate.version), inner), join(root, file.path)], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout);
    }
  }
  return 0;
}

export function main(fault = {}) {
  const [command, ...args] = process.argv.slice(2);
  if (fault.noop) return;
  if (fault.refuseAll) {
    console.log('FAIL everything');
    process.exitCode = 1;
    return;
  }
  process.exitCode = command === 'check' ? check(fault) : command === 'merge' ? merge(args[0], args[1], fault) : command === 'diff' ? showDiff(fault) : 2;
}
