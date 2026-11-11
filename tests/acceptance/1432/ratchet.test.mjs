// #1432 acceptance: the file-size ratchet in the lint lane (AC1, AC2), the lane running it, and the
// ratchet passing on this checkout as it stands.
import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { CEILINGS, SCRIPT, assertFails, assertPasses, git, lint, ratchet, ratchetCommand, root, runsScript } from './helpers.mjs';

const BIG = 'crates/fixture/src/big.rs';
/** `count` lines of Rust, each one a line of code, so no counter skips one as blank or comment. */
const rust = (count) => Array.from({ length: count }, (_, i) => `pub const C${String(i + 1).padStart(4, '0')}: u32 = ${i + 1};\n`).join('');
const ceilings = (entries) => `${JSON.stringify(entries, null, 2)}\n`;

/**
 * A scratch git repository holding a copy of every flat file in this checkout's scripts/, which
 * .git/info/exclude hides from git's listing, and `files`, committed with origin/main at that
 * commit. The ceilings file is force-added, since it sits in the hidden folder.
 */
function repo(t, files) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'deep-ratchet-1432-')));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, 'init', '-q');
  mkdirSync(join(cwd, '.git', 'info'), { recursive: true });
  appendFileSync(join(cwd, '.git', 'info', 'exclude'), '\n/scripts/\n');
  mkdirSync(join(cwd, 'scripts'));
  for (const name of readdirSync(join(root, 'scripts')))
    if (statSync(join(root, 'scripts', name)).isFile()) copyFileSync(join(root, 'scripts', name), join(cwd, 'scripts', name));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
  git(cwd, 'add', '-A');
  git(cwd, 'add', '-f', CEILINGS);
  git(cwd, 'commit', '-q', '-m', 'base');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return cwd;
}

test('the lint lane runs scripts/size-ratchet.mjs as a command of its own, beside the canvas lint', () => {
  assert.ok(lint, 'no lint lane in checks');
  const command = ratchetCommand();
  for (const part of command) assert.ok(!['-e', '--eval', '-p', '--print'].includes(part), `inline code in the ratchet's command: ${JSON.stringify(command.slice(1))}`);
  assert.ok(lint.commands.some((candidate) => runsScript(candidate, 'scripts/canvas-lint.mjs')), 'the lint lane no longer runs scripts/canvas-lint.mjs');
});

test('AC1: a line planted in a file at its ceiling fails the lint lane, naming the file, its size and its ceiling; at its ceiling it passes', (t) => {
  ratchetCommand();
  const cwd = repo(t, { [BIG]: rust(1600), [CEILINGS]: ceilings({ [BIG]: 1600 }) });
  assertPasses(ratchet(cwd));
  appendFileSync(join(cwd, BIG), 'pub const PLANTED: u32 = 0;\n');
  assertFails(ratchet(cwd), BIG, 1601, 1600);
});

test('AC2: a file shrunk under an unchanged ceiling fails, naming its size and ceiling, until the ceiling is lowered to its size', (t) => {
  ratchetCommand();
  const cwd = repo(t, { [BIG]: rust(1600), [CEILINGS]: ceilings({ [BIG]: 1600 }) });
  writeFileSync(join(cwd, BIG), rust(1599));
  assertFails(ratchet(cwd), BIG, 1599, 1600);
  writeFileSync(join(cwd, CEILINGS), ceilings({ [BIG]: 1599 }));
  assertPasses(ratchet(cwd));
});

/** Lines of text; a last line without a newline counts. For a file ending in one, wc -l's count. */
const lineCount = (text) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));
const generated = (text) => /@generated|do not edit/i.test(text.split('\n', 5).join('\n'));

test("on this checkout the ratchet passes without changing git status, and the checked-in ceilings are the checkout's own", () => {
  const status = () => git(root, 'status', '--porcelain=v1', '--untracked-files=all');
  const before = status();
  const result = ratchet(root);
  assert.equal(status(), before, `the ratchet changed git status\n${result.stdout}`);
  assertPasses(result);

  assert.doesNotThrow(() => git(root, 'ls-files', '--error-unmatch', '--', CEILINGS), `${CEILINGS} is not checked in`);
  const listed = JSON.parse(readFileSync(join(root, CEILINGS), 'utf8'));
  // Independent of the script: each hand-written Rust file in crates/ over 1,500 lines has a ceiling
  // equal to its size, and a generated one has none.
  const wrong = [];
  let counted = 0;
  for (const path of git(root, 'ls-files', '-z', '--', 'crates/*.rs').split('\0').filter(Boolean)) {
    if (!existsSync(join(root, path))) continue;
    const text = readFileSync(join(root, path), 'utf8');
    const lines = lineCount(text);
    if (generated(text)) {
      if (Object.hasOwn(listed, path)) wrong.push(`${path} is generated but has a ceiling of ${listed[path]}`);
    } else if (lines > 1500) {
      counted++;
      if (listed[path] !== lines) wrong.push(`${path} has ${lines} lines but a ceiling of ${listed[path]}`);
    }
  }
  assert.ok(counted > 0, 'no hand-written Rust file in crates/ is over 1,500 lines, so the oracle read nothing');
  assert.deepEqual(wrong, [], `${SCRIPT} passes, but ${CEILINGS} doesn't match the checkout`);
});
