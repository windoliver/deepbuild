// The lint lane's check on scripts/known-failures.json (#1333, #1873): a listed failure reads as no new failure, so each
// entry of `failures`, and of `lintIssues` and `timingIssues` for each `lint` key and `timing` ID, names the open issue
// that fixes it and the date it was added, `(#<issue>, added <YYYY-MM-DD>)` at its end, and lapses 14 days after that
// date. An entry with no issue, whose issue isn't open, or older than that fails, named by its key. A `lint` key naming
// a file the tree doesn't hold fails. A `skips` entry must still be true: its id names a test file the tree holds, and
// a reason naming an opt-in variable is read by that file. It imports only node: built-ins, since a fresh checkout of
// main has no node_modules.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DAYS = 14;
const SUFFIX = /\(#(\d+), added (\d{4}-\d{2}-\d{2})\)$/;
// A lint key names a file as lintFindings (affected.mjs) writes it: `<lint>: <path> <finding>`.
const LINT_PATH = /^[\w-]+: ([\w@.-]+(?:\/[\w@.-]+)+\.\w+)(?=[\s:]|$)/;
const OPT_IN = /\bopt-in variable (\w+)/;

const { failures = {}, lint = {}, lintIssues = {}, timing = [], timingIssues = {}, skips = [] } = JSON.parse(readFileSync(join(ROOT, 'scripts/known-failures.json'), 'utf8'));
const problems = [], issues = new Map();
const dated = (key, id, note) => {
  const [, issue, added] = note?.match(SUFFIX) ?? [];
  if (!issue) problems.push(`FAIL known-failures.json: ${key} ${id} names no issue and date: end it with "(#<issue>, added <YYYY-MM-DD>)"`);
  else if (!(Date.now() - Date.parse(`${added}T00:00:00Z`) <= DAYS * 86_400_000)) problems.push(`FAIL known-failures.json: ${key} ${id} was added ${added}, more than ${DAYS} days ago: fix it, or take it out and let it fail`);
  else issues.set(issue, [...issues.get(issue) ?? [], `${key} ${id}`]);
};
for (const [id, note] of Object.entries(failures)) dated('failures', id, note);
for (const id of Object.keys(lint)) {
  dated('lint', id, lintIssues[id]);
  const path = id.match(LINT_PATH)?.[1];
  if (path && !existsSync(join(ROOT, path))) problems.push(`FAIL known-failures.json: lint ${id} names ${path}, which the tree doesn't hold: take it out`);
}
for (const id of timing) dated('timing', id, timingIssues[id]);

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const rust = (dir) => readdirSync(join(ROOT, dir), { recursive: true }).filter((path) => path.endsWith('.rs')).map((path) => `${dir}/${path.split('\\').join('/')}`);
const DEFAULT = { test: 'tests', bench: 'benches', example: 'examples', bin: 'src/bin' };
/** The source files a cargo ID's target is built from, as `cargoResults` (lanes.mjs) names them; null for a form it can't read. */
function cargoFiles(runner) {
  const [, name, , kind, target] = runner.match(/^cargo -p ([\w-]+) (--(test|bench|example|bin) ([\w-]+)|--lib)$/) ?? [];
  if (!name) return null;
  const dir = readdirSync(join(ROOT, 'crates')).map((folder) => `crates/${folder}`).find((folder) => existsSync(join(ROOT, folder, 'Cargo.toml')) && read(`${folder}/Cargo.toml`).split(/^\[/m).some((section) => section.startsWith('package]') && new RegExp(`^name = "${name}"$`, 'm').test(section)));
  if (!dir) return [];
  if (!kind) return existsSync(join(ROOT, dir, 'src')) ? rust(`${dir}/src`) : [];
  const block = read(`${dir}/Cargo.toml`).split(`[[${kind}]]`).slice(1).map((text) => text.split(/^\[/m)[0]).find((text) => text.match(/^name = "(.+)"$/m)?.[1] === target);
  const path = block?.match(/^path = "(.+)"$/m)?.[1];
  if (path) return [posix.join(dir, path)];
  // Cargo's own discovery: `<dir>/<target>.rs` or `<dir>/<target>/main.rs`, and a bin named as its crate in src/main.rs.
  return kind === 'bin' && target === name ? [`${dir}/src/main.rs`] : [`${dir}/${DEFAULT[kind]}/${target}.rs`, `${dir}/${DEFAULT[kind]}/${target}/main.rs`];
}
// Whether a source names a test: a whole string literal on one of its lines is the name, past a criterion tag the source
// may build from a constant; a template's `${…}`, and the `%s` and `$name` a table test (`.each`) fills, stand for any
// text. Literals are read line by line, so an apostrophe in a comment misreads only its own line.
const LITERAL = /`((?:[^`\\]|\\.)*)`|'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
const HOLE = /\$\{[^}]*\}|%[sdifjoc#%$]|\$\w+(?:\.\w+)*/;
const TAG = /^(?:AC\d+ )?#\d+\.[0-9a-f]{8}:? /;
const unescape = (text) => text.replace(/\\(.)/g, '$1');
/** Whether a literal with holes fills to `name`: its first part a prefix, its last a suffix, the rest in order between. */
function fills(literal, name) {
  const parts = literal.split(new RegExp(HOLE, 'g')).map(unescape);
  if (parts.join('').trim().length < 8) return false;
  const first = parts.shift(), last = parts.pop();
  if (!name.startsWith(first) || !name.endsWith(last) || first.length + last.length > name.length) return false;
  let at = first.length;
  for (const part of parts) {
    at = name.indexOf(part, at);
    if (at < 0) return false;
    at += part.length;
  }
  return at <= name.length - last.length;
}
const names = (source, name) => source.split('\n').some((line) => [...line.matchAll(LITERAL)].some(([, ...quoted]) => {
  const literal = quoted.find((part) => part !== undefined).trim();
  return [name, name.replace(TAG, '')].some((candidate) => unescape(literal) === candidate || (HOLE.test(literal) && fills(literal, candidate)));
}));
/** Where a skip's test is: its files the tree holds, and whether one names it; null for an ID this check can't place. */
function place(id) {
  const [runner, ...path] = id.split(' › '), name = path.at(-1) ?? '';
  const files = (runner.startsWith('cargo ') ? cargoFiles(runner) : [runner])?.filter((file) => existsSync(join(ROOT, file)));
  if (!files) return null;
  if (!runner.startsWith('cargo ')) return { files, found: files.some((file) => names(read(file), name)) };
  // libtest names a test by its fn's path; a custom harness (`harness = false`) prints a name its source spells out.
  const leaf = name.split('::').at(-1), fn = /^\w+$/.test(leaf) && new RegExp(`\\bfn ${leaf}\\s*\\(`);
  return { files, found: files.some((file) => (fn && fn.test(read(file))) || read(file).includes(JSON.stringify(name))) };
}
for (const { id, reason = '' } of skips) {
  const where = place(id);
  if (!where) {
    problems.push(`INCONCLUSIVE known-failures.json: skips ${id}: this check can't place a cargo test named so`);
    continue;
  }
  if (!where.found) {
    problems.push(`FAIL known-failures.json: skips ${id} names a test the tree doesn't hold: take it out`);
    continue;
  }
  const variable = reason.match(OPT_IN)?.[1];
  if (variable && !where.files.some((file) => new RegExp(`\\b${variable}\\b`).test(read(file)))) problems.push(`FAIL known-failures.json: skips ${id}: its reason names the opt-in variable ${variable}, which ${where.files.join(', ')} never reads`);
}

for (const [issue, ids] of issues) {
  const gh = spawnSync('gh', ['issue', 'view', issue, '--json', 'state', '-q', '.state'], { encoding: 'utf8', cwd: ROOT });
  const state = gh.status === 0 ? gh.stdout.trim() : null;
  if (state === null) problems.push(...ids.map((id) => `INCONCLUSIVE known-failures.json: ${id}: could not read issue #${issue}: ${(gh.error?.message ?? gh.stderr).trim().split('\n')[0]}`));
  else if (state !== 'OPEN') problems.push(...ids.map((id) => `FAIL known-failures.json: ${id} names issue #${issue}, which is ${state.toLowerCase()}, not open`));
}
for (const problem of problems) console.log(problem);
const count = Object.keys(failures).length + Object.keys(lint).length + timing.length + skips.length;
console.log(`${problems.length ? `${problems.length} problems in` : 'all'} ${count} entries of known-failures.json${problems.length ? '' : ': each listed failure names an open issue, added within the last 14 days, and each lint file and skipped test is in the tree'}`);
process.exitCode = problems.length ? 1 : 0;
