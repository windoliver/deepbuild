// #2470 acceptance: deep-contracts compiles on main again, and a second `npm run generate -w @deepbuild/contracts`
// leaves no diff. Written first and blind at base e0c90a5a5 (README.md). Each test runs the issue's own command as a
// child process and judges the checkout this file is in; nothing here imports the code under test. Every failure is an
// assertion in this file that carries the child's command, exit code and output. Neither test writes a file of the
// checkout: cargo writes only its build folder, which git ignores, and the generator runs on a temporary copy.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The checkout this file is in, never the working folder.
const ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
// Homebrew's rustup keeps cargo off the Mac's default PATH; elsewhere cargo is on PATH.
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
// What the generator reads and writes (packages/contracts/src/generate.ts): the package's schemas, fixtures, slots and
// data files, its outputs there, and crates/deep-contracts/src/generated.rs. npm finds the workspace through the root
// package.json, and the package's tsconfig.json extends the root one.
const COPIED = ['package.json', 'tsconfig.json', 'packages/contracts', 'crates/deep-contracts'];
// Installed packages and build output, which .gitignore leaves out of git status, are neither copied nor compared.
const IGNORED = new Set(['node_modules', 'dist', 'target']);

/**
 * Runs a command in `folder` and waits for it. Its output has the copy's path and the checkout's cut out, and `shown`
 * quotes each line, so none reads as a frame of this file's own stack.
 */
function run(command, args, folder, env = {}) {
  const environment = { ...process.env, ...env, NO_COLOR: '1', CARGO_TERM_COLOR: 'never' };
  delete environment.NODE_TEST_CONTEXT;
  delete environment.FORCE_COLOR;
  const result = spawnSync(command, args, { cwd: folder, env: environment, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 30 * 60_000 });
  // A command that never started or never ended judged nothing: an error, never an assertion (AGENTS.md, invariant 2).
  if (result.error || result.status === null) throw Error(`BLOCKED: ${command} ${args.join(' ')} did not run to its end: ${result.error?.message ?? result.signal}`);
  const plain = (text) => String(text ?? '').replaceAll(folder, folder === ROOT ? '<checkout>' : '<copy>').replaceAll(ROOT, '<checkout>');
  const lines = `${plain(result.stdout)}${plain(result.stderr)}`.trimEnd().split('\n');
  const quoted = lines.slice(0, 200).map((line) => `  | ${line}`.trimEnd());
  if (lines.length > 200) quoted.push(`  | ... ${lines.length - 200} more lines`);
  return { status: result.status, shown: [`$ ${command} ${args.join(' ')}`, `exit ${result.status}`, ...quoted].join('\n') };
}

/** The files under `folder`, as sorted paths relative to it, leaving out what IGNORED names. */
function files(folder, at = '') {
  return readdirSync(join(folder, at), { withFileTypes: true }).flatMap((entry) => {
    const path = at ? `${at}/${entry.name}` : entry.name;
    if (IGNORED.has(entry.name)) return [];
    return entry.isDirectory() ? files(folder, path) : [path];
  }).sort();
}

/** How the copy's file at `path` differs from the checkout's, or null when their bytes are the same. */
function differs(copy, path) {
  if (!existsSync(join(ROOT, path))) return `added ${path}`;
  const [held, written] = [readFileSync(join(ROOT, path)), readFileSync(join(copy, path))];
  if (held.equals(written)) return null;
  const [before, after] = [held.toString('utf8').split('\n'), written.toString('utf8').split('\n')];
  let at = before.findIndex((line, index) => line !== after[index]);
  if (at < 0) at = before.length;
  const line = (text) => (text === undefined ? '(no line)' : text.slice(0, 160));
  const count = (lines) => lines.length - (lines.at(-1) === '' ? 1 : 0);
  return [
    `changed ${path}: ${count(before)} lines in the checkout, ${count(after)} after the generate; the first to differ is line ${at + 1}`,
    `    checkout: ${line(before[at])}`,
    `    generate: ${line(after[at])}`,
  ].join('\n');
}

test('AC1 #2470.16c0da75 `cargo check --locked -p deep-contracts` passes in the checkout: it exits 0', () => {
  const PATH = existsSync(RUSTUP_BIN) ? `${RUSTUP_BIN}${delimiter}${process.env.PATH ?? ''}` : (process.env.PATH ?? '');
  const check = run('cargo', ['check', '--locked', '-p', 'deep-contracts'], ROOT, { PATH });
  assert.equal(check.status, 0, `cargo check --locked -p deep-contracts fails in the checkout\n${check.shown}`);
});

test('AC2 #2470.296a591a a second `npm run generate -w @deepbuild/contracts` leaves no diff: run on a copy of the checkout, it changes, adds and removes no file', (t) => {
  // The generator builds with the checkout's installed tsc; without it nothing can be judged.
  if (!existsSync(join(ROOT, 'node_modules', '.bin', 'tsc'))) throw Error('BLOCKED: the checkout has no node_modules/.bin/tsc, so the generator cannot build; run npm ci there');
  // The generator writes tracked files, so it runs on a copy, which the test removes, and the checkout is never written.
  const copy = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2470-')));
  t.after(() => rmSync(copy, { recursive: true, force: true }));
  for (const path of COPIED) cpSync(join(ROOT, path), join(copy, path), { recursive: true, filter: (source) => !IGNORED.has(basename(source)) });
  symlinkSync(join(ROOT, 'node_modules'), join(copy, 'node_modules'));
  const copied = files(copy);

  const generate = run('npm', ['run', 'generate', '-w', '@deepbuild/contracts'], copy);
  assert.equal(generate.status, 0, `npm run generate -w @deepbuild/contracts fails on a copy of the checkout\n${generate.shown}`);
  const left = files(copy);
  const diff = [
    ...copied.filter((path) => !left.includes(path)).map((path) => `removed ${path}`),
    ...left.map((path) => differs(copy, path)).filter(Boolean),
  ];
  assert.deepEqual(diff, [], `a second npm run generate -w @deepbuild/contracts leaves a diff: ${diff.length} file${diff.length === 1 ? '' : 's'} no longer as the checkout holds ${diff.length === 1 ? 'it' : 'them'}\n${diff.join('\n')}\n${generate.shown}`);
});
