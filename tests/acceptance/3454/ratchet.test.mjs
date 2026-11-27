// #3454 acceptance: the comment ratchet in the lint lane over planted files (AC1), a dropped count and `--write` (AC2),
// a raised ceiling (AC3), the lane running the guard as a command of its own, and the guard passing on this checkout.
// Each plant runs after its clean twin passed in the same scratch repository, so a guard that fails everything can't
// satisfy a test, and one that passes everything fails the plant.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { BASE_CEILINGS, CEILINGS, LISTED, LISTED_COUNT, RUST, RUST_COUNT, SCRIPT, WGSL, WGSL_COUNT, assertFails, assertFailsNaming, assertNotNamed, assertPasses, base, ceilings, git, guard, guardCommand, lint, listed, listedIn, put, root, runsScript, rust, wgsl } from './helpers.mjs';

test('the lint lane runs scripts/comment-ratchet.mjs as a command of its own, beside the size and wait ratchets', () => {
  assert.ok(lint, 'no lint lane in checks');
  const command = guardCommand();
  for (const part of command) assert.ok(!['-e', '--eval', '-p', '--print', '--write'].includes(part), `inline code or --write in the guard's command: ${JSON.stringify(command.slice(1))}`);
  for (const sibling of ['scripts/size-ratchet.mjs', 'scripts/wait-ratchet.mjs'])
    assert.ok(lint.commands.some((candidate) => runsScript(candidate, sibling)), `the lint lane no longer runs ${sibling}`);
});

test('#3454.7c3ae88a AC1: a comment planted in a listed file at its ceiling fails the lint lane, naming the file, its count and its ceiling; at its ceiling it passes', (t) => {
  guardCommand();
  const cwd = base(t);
  assertPasses(guard(cwd), `(${LISTED} at its ceiling of ${LISTED_COUNT}, ${RUST} at ${RUST_COUNT}, ${WGSL} at ${WGSL_COUNT})`);
  put(cwd, LISTED, listed({ plant: true }));
  const result = guard(cwd);
  assertFails(result, LISTED, LISTED_COUNT + 1, LISTED_COUNT, '(one comment line planted)');
  assertNotNamed(result, RUST);
  assertNotNamed(result, WGSL);
});

test("#3454.7c3ae88a AC1: a comment planted in a file the list doesn't hold fails the lint lane, naming the file; its twin with no comment passes", (t) => {
  guardCommand();
  const cwd = base(t);
  const FRESH = 'packages/fixture/src/fresh.ts';
  const fresh = (plant) => ['export function double(n: number): number {', ...(plant ? ['  // a planted comment'] : []), '  return n * 2;', '}', ''].join('\n');
  put(cwd, FRESH, fresh(false));
  assertPasses(guard(cwd), `(the twin of ${FRESH}, with no comment)`);
  put(cwd, FRESH, fresh(true));
  const result = guard(cwd);
  assertFailsNaming(result, FRESH, "(one comment line in a file the list doesn't hold)");
  assertNotNamed(result, LISTED);
});

test('#3454.7c3ae88a AC1: a comment planted in a Rust file at its ceiling fails the lint lane, naming the file, its count and its ceiling; at its ceiling it passes', (t) => {
  guardCommand();
  const cwd = base(t);
  assertPasses(guard(cwd), `(${RUST} at its ceiling of ${RUST_COUNT})`);
  put(cwd, RUST, rust({ plant: true }));
  const result = guard(cwd);
  assertFails(result, RUST, RUST_COUNT + 1, RUST_COUNT, '(one comment line planted)');
  assertNotNamed(result, LISTED);
  assertNotNamed(result, WGSL);
});

test('#3454.7c3ae88a AC1: a comment planted in a WGSL file at its ceiling fails the lint lane, naming the file, its count and its ceiling; at its ceiling it passes', (t) => {
  guardCommand();
  const cwd = base(t);
  assertPasses(guard(cwd), `(${WGSL} at its ceiling of ${WGSL_COUNT})`);
  put(cwd, WGSL, wgsl({ plant: true }));
  const result = guard(cwd);
  assertFails(result, WGSL, WGSL_COUNT + 1, WGSL_COUNT, '(one comment line planted)');
  assertNotNamed(result, LISTED);
  assertNotNamed(result, RUST);
});

/** A file whose only `//` and `/*` sit in a string, two regular expressions and a template; `plant` adds one comment. */
const tokens = (plant) => [
  "export const home = 'https://example.invalid//x';",
  'export const scheme = /^https:\\/\\//;',
  'export const slashes = /[//*]+x/;',
  'export const link = (path: string): string => `https://example.invalid//x/${path}/* kept */`;',
  ...(plant ? ['// a planted comment'] : []),
  '',
].join('\n');

test("#3454.7c3ae88a AC1: the // in 'https://example.invalid//x', in a regular expression and in a template is no comment, so the file passes with no ceiling; a comment planted beside them fails, naming the file", (t) => {
  guardCommand();
  const cwd = base(t);
  const URLS = 'packages/fixture/src/urls.ts';
  put(cwd, URLS, tokens(false));
  const clean = guard(cwd);
  assertNotNamed(clean, URLS);
  assertPasses(clean, `(${URLS} holds // and /* only inside a string, two regular expressions and a template)`);
  put(cwd, URLS, tokens(true));
  assertFailsNaming(guard(cwd), URLS, '(one comment line after the string, the regular expressions and the template)');
});

test('#3454.7b17acdf AC2: a file whose comments dropped fails, naming it, until its ceiling is lowered to its count', (t) => {
  guardCommand();
  const cwd = base(t);
  assertPasses(guard(cwd), '(every listed file at its ceiling)');
  put(cwd, LISTED, listed({ tail: 15 }));
  const result = guard(cwd);
  assertFailsNaming(result, LISTED, `(${LISTED_COUNT - 1} comment lines, under its unchanged ceiling of ${LISTED_COUNT})`);
  assertNotNamed(result, RUST);
  put(cwd, CEILINGS, ceilings({ ...BASE_CEILINGS, [LISTED]: LISTED_COUNT - 1 }));
  assertPasses(guard(cwd), `(its ceiling lowered to ${LISTED_COUNT - 1}, its count)`);
});

test('#3454.7b17acdf AC2: --write lowers the ceiling of a file whose comments dropped, and drops the entry of a file with none left', (t) => {
  guardCommand();
  const cwd = base(t);
  assertPasses(guard(cwd), '(every listed file at its ceiling)');
  put(cwd, LISTED, listed({ tail: 15 }));
  put(cwd, WGSL, wgsl({ comments: false }));
  const before = guard(cwd);
  assertFailsNaming(before, LISTED, `(${LISTED_COUNT - 1} comment lines, under its ceiling of ${LISTED_COUNT})`);
  assertFailsNaming(before, WGSL, `(no comment left, under its ceiling of ${WGSL_COUNT})`);
  const written = guard(cwd, '--write');
  assert.deepEqual(listedIn(cwd), { [LISTED]: LISTED_COUNT - 1, [RUST]: RUST_COUNT }, `--write didn't lower ${LISTED} to ${LISTED_COUNT - 1}, drop ${WGSL} and leave ${RUST} at ${RUST_COUNT}\n${written.stdout}\n${written.stderr ?? ''}`);
  assertPasses(guard(cwd), '(after --write)');
});

test("#3454.ba67856c AC3: a ceiling raised by hand above the merge base's fails the lint lane, naming the file, for a listed file and for one the merge base doesn't list", (t) => {
  guardCommand();
  const cwd = base(t);
  assertPasses(guard(cwd), '(every listed file at its ceiling)');
  put(cwd, LISTED, listed({ plant: true }));
  put(cwd, CEILINGS, ceilings({ ...BASE_CEILINGS, [LISTED]: LISTED_COUNT + 1 }));
  const raised = guard(cwd);
  assertFailsNaming(raised, LISTED, `(${LISTED_COUNT + 1} comment lines, its ceiling raised to ${LISTED_COUNT + 1} in the same change over the merge base's ${LISTED_COUNT})`);
  assertNotNamed(raised, RUST);
  put(cwd, LISTED, listed());
  put(cwd, CEILINGS, ceilings(BASE_CEILINGS));
  assertPasses(guard(cwd), '(back at the base)');
  // A file the merge base doesn't list starts at zero, so a ceiling of its own is one raised above the merge base's.
  const FRESH = 'packages/fixture/src/fresh.ts';
  put(cwd, FRESH, '// a planted comment\nexport const fresh = 1;\n');
  put(cwd, CEILINGS, ceilings({ ...BASE_CEILINGS, [FRESH]: 1 }));
  const added = guard(cwd);
  assertFailsNaming(added, FRESH, '(a new file with one comment line and a ceiling of 1 written for it in the same change)');
  assertNotNamed(added, LISTED);
});

test("#3454.ba67856c AC3: --write can't raise a ceiling above the merge base's: after it the lint lane still fails, naming the file, for a listed file and for one the merge base doesn't list", (t) => {
  guardCommand();
  const cwd = base(t);
  assertPasses(guard(cwd), '(every listed file at its ceiling)');
  const FRESH = 'packages/fixture/src/fresh.ts';
  put(cwd, LISTED, listed({ plant: true }));
  put(cwd, FRESH, '// a planted comment\nexport const fresh = 1;\n');
  guard(cwd, '--write');
  const result = guard(cwd);
  assertFailsNaming(result, LISTED, `(${LISTED_COUNT + 1} comment lines over the merge base's ceiling of ${LISTED_COUNT}, after --write; ${CEILINGS} now holds ${JSON.stringify(listedIn(cwd))})`);
  assertFailsNaming(result, FRESH, `(a new file with one comment line, after --write; ${CEILINGS} now holds ${JSON.stringify(listedIn(cwd))})`);
  assertNotNamed(result, RUST);
});

const COUNTED = /\.(?:[cm]?[jt]s|[jt]sx|rs|wgsl)$/;

test("on this checkout the guard passes without changing git status, and the checked-in ceilings are the checkout's own", () => {
  const status = () => git(root, 'status', '--porcelain=v1', '--untracked-files=all');
  const before = status();
  const result = guard(root);
  assert.equal(status(), before, `the guard changed git status\n${result.stdout}`);
  assertPasses(result, '(this checkout as it stands)');

  assert.equal(git(root, 'ls-files', '--', CEILINGS).trim(), CEILINGS, `${CEILINGS} is not checked in`);
  const listedHere = JSON.parse(readFileSync(join(root, CEILINGS), 'utf8'));
  assert.ok(listedHere && typeof listedHere === 'object' && !Array.isArray(listedHere), `${CEILINGS} isn't a JSON object`);
  const wrong = [];
  for (const [path, count] of Object.entries(listedHere)) {
    if (!Number.isInteger(count) || count < 1) wrong.push(`${path} has a count of ${JSON.stringify(count)}, not a whole number of at least 1`);
    if (!COUNTED.test(path)) wrong.push(`${path} is not a TypeScript, JavaScript, Rust or WGSL file`);
    else if (!existsSync(join(root, path)) || !statSync(join(root, path)).isFile()) wrong.push(`${path} is not a file in the work tree`);
    if (/(?:^|\/)vendor\//.test(path)) wrong.push(`${path} is under vendor/`);
  }
  assert.deepEqual(wrong, [], `${SCRIPT} passes, but ${CEILINGS} doesn't match the checkout`);
});
