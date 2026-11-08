// A small reference of the added surface (../README.md), for the judges' self-tests only: `check` and `merge` on a
// planted tree with stub releases under DEEP_VENDOR_RELEASES. It holds the rules these judges read (a row per changed
// file in every tree under vendor/, the row's issue, its test in its suite's own list, its removal condition, a count
// of marked hunks a row) and none of the first draft's budgets. Each twin in this folder is it with one fault.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const README = 'vendor/gpui-pre-apple/upstream/README.md';
const MARK = /DeepBuild patch \(windoliver\/deepbuild#(\d+)\)/;
const FOUR = ['gpui-pre', 'gpui-pre-apple', 'quickjs-jit-runtime', 'unicode-17.0.0'];

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
  if (!existsSync(manifest)) return /-\d/.test(name) ? { name, release: name, crate: false } : null;
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

/** The test names a file's suite lists, by its runner; null when the file isn't there. */
function suiteList(root, path, faults) {
  const file = join(root, path);
  if (faults.basename && !existsSync(file)) {
    const found = walk(join(root, 'tests')).find((candidate) => candidate.endsWith(`/${path}`));
    if (found) return suiteList(root, join('tests', found), faults);
  }
  if (!existsSync(file)) return null;
  if (faults.textMatch) return { text: readFileSync(file, 'utf8') };
  if (path.endsWith('.rs')) {
    let crate = dirname(file);
    while (!existsSync(join(crate, 'Cargo.toml'))) crate = dirname(crate);
    const run = spawnSync('cargo', ['test', '--locked', '--quiet', '--', '--list'], { cwd: crate, encoding: 'utf8' });
    return new Set([...run.stdout.matchAll(/^(\S+): test$/gm)].map(([, name]) => name));
  }
  if (/\.test\.[cm]?tsx?$/.test(path)) {
    const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'list', path, '--json'], { cwd: root, encoding: 'utf8' });
    const listed = JSON.parse(run.stdout.slice(run.stdout.indexOf('[')) || '[]');
    return new Set(listed.map(({ name }) => name.split(' > ').join(' › ')));
  }
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path], { cwd: root, encoding: 'utf8' });
  return new Set([...run.stdout.matchAll(/^# Subtest: (.+)$/gm)].map(([, name]) => name));
}

function check(root, faults) {
  const out = [];
  const releases = process.env.DEEP_VENDOR_RELEASES;
  const rows = table(root);
  const listed = new Set(rows.flatMap((row) => row.files));
  const trees = readdirSync(join(root, 'vendor')).filter((name) => statSync(join(root, 'vendor', name)).isDirectory()).map((name) => treeOf(root, name)).filter(Boolean)
    .filter((tree) => (faults.gpuiOnly ? tree.name.startsWith('gpui') : faults.fixedTrees ? FOUR.includes(tree.name) : faults.cratesOnly ? tree.crate : true));
  for (const tree of trees) {
    const release = join(releases ?? '', tree.release);
    if (!releases || !existsSync(release)) { out.push(`BLOCKED ${tree.name}: no pinned release ${tree.release} to compare with`); continue; }
    for (const inner of walk(join(root, 'vendor', tree.name))) {
      const path = `vendor/${tree.name}/${inner}`;
      if (path.startsWith('vendor/gpui-pre-apple/upstream/') || (!tree.crate && inner === 'README.md')) continue;
      if (faults.topLevel && inner.split('/').length > 2) continue;
      const theirs = join(release, inner);
      if (!existsSync(theirs) && faults.changedOnly) continue;
      if (existsSync(theirs) && readFileSync(theirs).equals(readFileSync(join(root, path)))) continue;
      if (!listed.has(path)) out.push(faults.unnamed ? 'FAIL a vendored file has no row in the carried-patch table' : `FAIL ${path}: no row in the carried-patch table`);
    }
  }
  const lists = new Map();
  for (const row of rows) {
    const name = `row ${row.Issue} ${row.Behavior}`;
    if (!/^#\d+$/.test(row.Issue)) out.push(`FAIL row ${row.Behavior}: no issue`);
    const marked = row.files.flatMap((file) => (existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8').split('\n') : [])).filter((line) => MARK.exec(line)?.[1] === row.Issue.slice(1)).length;
    out.push(`ROW ${row.Issue} ${row.Behavior}: ${marked} marked, 0 over budget`);
    if (!marked) out.push(`FAIL ${name}: no marked hunk`);
    const [, path, test] = /^`(.+?) › (.+)`$/.exec(row.Test) ?? [];
    if (!path) out.push(`FAIL ${name}: no test`);
    else {
      if (!lists.has(path)) lists.set(path, suiteList(root, path, faults));
      const list = lists.get(path);
      const there = faults.fileOnly ? list !== null : list?.text !== undefined ? list.text.includes(test.split('::').at(-1)) : list?.has(test);
      if (faults.refuseTests || !there) out.push(faults.noTestName ? `FAIL ${name}: its test isn't in its suite` : `FAIL ${name}: ${path} › ${test} isn't in its suite's own list`);
    }
    const removal = (row.Removal ?? '').trim();
    if (!faults.noRemoval && (!removal || /^[—–-]$/.test(removal) || (!faults.bareNone && /^none:?$/i.test(removal)))) out.push(`FAIL ${name}: no removal condition`);
  }
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
  if (faults.testsBefore && failingTests(root, rows).length) { console.log('FAIL a row test fails before the merge'); return 1; }
  const conflicts = [];
  for (const inner of new Set([...walk(dir), ...walk(to)])) {
    if (inner.startsWith('upstream/')) continue;
    const read = (base) => (existsSync(join(base, inner)) ? join(base, inner) : '/dev/null');
    const run = spawnSync('git', ['merge-file', '-p', '-L', 'ours', '-L', 'base', '-L', 'theirs', read(dir), read(from), read(to)], { encoding: 'utf8' });
    writeFileSync(join(dir, inner), run.stdout);
    run.stdout.split('\n').forEach((line, at) => { if (line.startsWith('<<<<<<<')) conflicts.push(`CONFLICT vendor/${crate}/${inner}:${at + 1}`); });
  }
  const manifest = join(dir, 'Cargo.toml');
  const pin = (to) => writeFileSync(manifest, readFileSync(manifest, 'utf8').replace(/^version = "[^"]+"$/m, `version = "${to}"`));
  if (conflicts.length) { pin(tree.version); console.log(conflicts.join('\n')); return 1; }
  const failing = faults.movesAnyway || faults.testsBefore ? [] : failingTests(root, rows);
  if (failing.length || faults.neverMoves) {
    for (const [inner, content] of Object.entries(before)) writeFileSync(join(dir, inner), content);
    for (const inner of walk(dir)) if (!(inner in before)) rmSync(join(dir, inner));
    const named = faults.namesAll ? table(root).map((row) => row.Test.replaceAll('`', '')) : failing;
    if (faults.noName) console.log(`FAIL a row's test fails on ${crate} ${version}; the pin stays at ${tree.version}`);
    else for (const test of named) console.log(`FAIL ${test}: fails on ${crate} ${version}; the pin stays at ${tree.version}`);
    return faults.exitZero ? 0 : 1;
  }
  pin(version);
  console.log(`MOVED ${crate} ${tree.version} -> ${version}`);
  return 0;
}

export function main(faults = {}) {
  const [command, ...args] = process.argv.slice(2);
  const root = process.cwd();
  process.exitCode = command === 'check' ? check(root, faults) : command === 'merge' ? merge(root, args[0], args[1], faults) : 2;
}
