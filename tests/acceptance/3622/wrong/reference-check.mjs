// A small reference of the surface #3622's judges read (README.md): `check` over every vendor/<crate> with a manifest,
// against DEEP_VENDOR_RELEASES/<crate>-<version>, with the table under `## Carried patches`. wrong.test.mjs runs the
// judges on it, which must pass, and on one-fault mutants of it, which must fail. It is no part of the implementation.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TABLE = 'vendor/gpui-pre-apple/upstream/README.md';
const MARK = /DeepBuild patch \(windoliver\/deepbuild#(\d+)\)/g;
const BUDGET = 8;
let failed = 0;
const fail = (line) => { failed += 1; console.log(`FAIL ${line}`); };

const walk = (dir, at = '') => readdirSync(join(dir, at), { withFileTypes: true }).flatMap((entry) => {
  const inner = at ? `${at}/${entry.name}` : entry.name;
  if (inner === 'target' || inner === 'upstream') return [];
  return entry.isDirectory() ? walk(dir, inner) : [inner];
});
function rows() {
  const lines = readFileSync(TABLE, 'utf8').split('\n'), table = [];
  for (let at = lines.indexOf('## Carried patches') + 1; at > 0 && at < lines.length && !lines[at].startsWith('#'); at += 1) if (lines[at].startsWith('|')) table.push(lines[at]);
  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
  const head = cells(table[0] ?? '');
  return table.slice(2).map((line) => Object.fromEntries(cells(line).map((cell, k) => [head[k], cell])))
    .map((row) => ({ ...row, files: [...(row.Files ?? '').matchAll(/`([^`]+)`/g)].map(([, file]) => file), marked: 0 }));
}
function hunks(from, to) {
  const out = spawnSync('git', ['diff', '--no-index', '-U0', from, to], { encoding: 'utf8' }).stdout;
  return [...out.matchAll(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map(([, removed = '1', at, added = '1']) => ({ line: Number(added) ? Number(at) : Number(at) + 1, last: Number(at) + Math.max(Number(added), 1) - 1, size: Number(removed) + Number(added) }));
}
const table = rows();
for (const name of readdirSync('vendor')) {
  const dir = `vendor/${name}`;
  if (!existsSync(join(dir, 'Cargo.toml'))) continue;
  const version = /^\[package\][^[]*?^version = "([^"]+)"/ms.exec(readFileSync(join(dir, 'Cargo.toml'), 'utf8'))?.[1];
  const release = join(process.env.DEEP_VENDOR_RELEASES ?? '', `${name}-${version}`);
  if (!process.env.DEEP_VENDOR_RELEASES || !existsSync(release)) {
    failed += 1;
    console.log(`BLOCKED ${name} ${version}: no release`);
    continue;
  }
  for (const inner of walk(dir)) {
    const path = `${dir}/${inner}`, from = join(release, inner), there = existsSync(from);
    if (there && readFileSync(from).equals(readFileSync(path))) continue;
    if (!there && inner.startsWith('LICENSE')) continue;
    const lines = readFileSync(path, 'utf8').split('\n');
    const found = there ? hunks(from, path) : [{ line: 1, last: lines.length, size: 0, fresh: true }];
    const listed = table.filter(({ files }) => files.includes(path));
    if (!listed.length) { fail(`${path}:${found[0]?.line ?? 1}: no row in the carried-patch table`); continue; }
    for (const hunk of found) {
      const issues = [...lines.slice(Math.max(0, hunk.line - 3), hunk.last + 2).join('\n').matchAll(MARK)].map(([, issue]) => `#${issue}`);
      const owners = listed.filter(({ Issue }) => issues.includes(Issue));
      if (!owners.length) fail(`${path}:${hunk.line}: a carried hunk with no mark`);
      for (const row of owners) row.marked += 1;
      if (!hunk.fresh && hunk.size > BUDGET) fail(`${path}:${hunk.line}: hunk of ${hunk.size} lines, over the budget of ${BUDGET}`);
    }
  }
}
for (const row of table) {
  console.log(`ROW ${row.Issue} ${row.Behavior}: ${row.marked} marked`);
  if (!row.marked) fail(`row ${row.Issue} ${row.Behavior}: no marked hunks`);
}
process.exitCode = failed ? 1 : 0;
