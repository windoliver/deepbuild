// Helpers for #1120's acceptance tests: a sandboxed HOME (bays under <HOME>/deepbuild-bays/, the throttle table under
// <HOME>/.deepbuild/), "the machine's repository" as a fixture npm workspace with a worktree whose change adds lines to
// one package that two other packages carry in their dist, a log of the builds run under a mutant and of what the
// tagged tests saw in each run, and readers of the mutation lane's output. Nothing here imports the code under test:
// the proof is reached only by running `node scripts/proof.mjs mutation` (README: The surface).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));

const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main'];
const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// The planted issue the fixture's change names; its tag is built here from its criterion's text, as
// scripts/proof-change.mjs builds a criterion's ID, so no file of this suite carries a tag of it.
export const ISSUE = 9120;
const criterionId = (issue, text) => `#${issue}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;
const GRADES = 'Grades above ten are big';
const C1 = criterionId(ISSUE, GRADES);

/** A sandbox removed after the test, with its own HOME; every process it started is stopped, by its group's PID. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1120-')));
  const home = join(dir, 'home');
  for (const folder of [home, join(dir, 'issues'), join(dir, 'runs')]) mkdirSync(folder);
  writeFileSync(join(dir, 'issues', `${ISSUE}.md`), `Planted for the #1120 acceptance tests.\n\n### Acceptance criteria\n- [ ] ${GRADES}\n`);
  const env = {
    ...process.env,
    HOME: home,
    PATH: [dirname(process.execPath), process.env.PATH].join(delimiter),
    npm_config_offline: 'true',
    npm_config_update_notifier: 'false',
    DEEP_PROOF_ISSUES: join(dir, 'issues'),
    // What the fixture writes outside every copy (README: Observing the builds).
    FX_BUILDS: join(dir, 'builds.log'),
    FX_RUNS: join(dir, 'runs'),
  };
  for (const name of ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'DEEP_BIN_DIR', 'DEEP_APPROVERS', 'NODE_TEST_CONTEXT', 'NODE_V8_COVERAGE', '__STRYKER_ACTIVE_MUTANT__']) delete env[name];
  for (const name of Object.keys(env)) if (/^npm_(?!config_offline$|config_update_notifier$)/i.test(name)) delete env[name];
  const box = { dir, home, env, children: [] };
  t.after(() => {
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

const write = (cwd, files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
};

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
// Every package builds as the repository's do (`tsc -p tsconfig.json`), after a line that logs the build when it runs
// under a mutant.
const pkg = (name, extra = {}) => json({ name: `@fx/${name}`, version: '0.0.0', private: true, type: 'module', scripts: { build: 'node ../../tools/mark.mjs && tsc -p tsconfig.json' }, ...extra });
const tsconfig = (extra) => json({ compilerOptions: { target: 'es2022', module: 'nodenext', moduleResolution: 'nodenext', outDir: 'dist', types: [], skipLibCheck: true, ...extra.compilerOptions }, include: extra.include });
// A dependent of a: its dist carries a's source, compiled with its own (dist/a/src/f.js beside dist/<name>/src/index.js).
const dependent = (name, fn) => ({
  [`packages/${name}/package.json`]: pkg(name, { exports: `./dist/${name}/src/index.js`, dependencies: { '@fx/a': '0.0.0' } }),
  [`packages/${name}/tsconfig.json`]: tsconfig({ compilerOptions: { rootDir: '..' }, include: ['src/**/*.ts', '../a/src/**/*.ts'] }),
  [`packages/${name}/src/index.ts`]: `import { grade } from '../../a/src/f.js';\n\nexport function ${fn}(n: number): string {\n  return '${name}:' + grade(n);\n}\n`,
});

/**
 * The merge base: an npm workspace of four packages. a holds grade(), always 'small'; b and d depend on a and carry
 * its code in their own dist; c depends on nothing and nothing on it. TypeScript is a folder of the fixture whose tsc
 * runs this checkout's compiler, so the lock installs offline in any copy.
 */
function base() {
  return {
    '.gitignore': 'node_modules\ndist\n*.tsbuildinfo\n.claude\n',
    'package.json': json({ name: 'scope-fixture', version: '0.0.0', private: true, type: 'module', workspaces: ['packages/*'], devDependencies: { typescript: 'file:vendor/typescript' } }),
    'vendor/typescript/package.json': json({ name: 'typescript', version: '5.9.3', private: true, bin: { tsc: 'bin/tsc.cjs' } }),
    'vendor/typescript/bin/tsc.cjs': `#!/usr/bin/env node\nrequire(${JSON.stringify(join(CHECKOUT, 'node_modules/typescript/lib/tsc.js'))});\n`,
    'tools/mark.mjs': `import { appendFileSync } from 'node:fs';\nimport { basename } from 'node:path';\nif (process.env.FX_BUILDS && process.env.__STRYKER_ACTIVE_MUTANT__ !== undefined) appendFileSync(process.env.FX_BUILDS, JSON.stringify({ package: basename(process.cwd()), mutant: process.env.__STRYKER_ACTIVE_MUTANT__ }) + '\\n');\n`,
    'packages/a/package.json': pkg('a', { exports: './dist/f.js' }),
    'packages/a/tsconfig.json': tsconfig({ compilerOptions: { rootDir: 'src' }, include: ['src/**/*.ts'] }),
    'packages/a/src/f.ts': "export function grade(n: number): string {\n  return 'small';\n}\n",
    ...dependent('b', 'label'),
    ...dependent('d', 'tag'),
    'packages/c/package.json': pkg('c', { exports: './dist/index.js' }),
    'packages/c/tsconfig.json': tsconfig({ compilerOptions: { rootDir: 'src' }, include: ['src/**/*.ts'] }),
    'packages/c/src/index.ts': 'export const c: number = 1;\n',
  };
}

// The tagged tests' helper: what each run of a tagged test saw (the active mutant, and the stamp of each package's
// dist entry), written outside the copy; and a run of a's source, caught, so the lane's coverage sees the added line.
const RUNS = `import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const ENTRIES = { a: 'packages/a/dist/f.js', b: 'packages/b/dist/b/src/index.js', c: 'packages/c/dist/index.js', d: 'packages/d/dist/d/src/index.js' };
export function record(test) {
  if (!process.env.FX_RUNS) return;
  const stamps = {};
  for (const [name, path] of Object.entries(ENTRIES)) {
    try { stamps[name] = String(statSync(join(process.cwd(), path), { bigint: true }).mtimeNs); } catch { stamps[name] = null; }
  }
  const seen = { test, mutant: process.env.__STRYKER_ACTIVE_MUTANT__ ?? null, cwd: process.cwd(), at: Date.now(), stamps };
  writeFileSync(join(process.env.FX_RUNS, test + '-' + process.pid + '-' + process.hrtime.bigint() + '.json'), JSON.stringify(seen));
}
export async function touch() {
  try {
    const { grade } = await import('../../packages/a/src/f.ts');
    grade(11);
    grade(3);
  } catch {}
}
`;

const taggedB = `import assert from 'node:assert/strict';
import test from 'node:test';
import { label } from '../../../packages/b/dist/b/src/index.js';
import { record, touch } from '../../helpers/runs.mjs';

await touch();

test('${C1} b labels eleven big', () => {
  record('b');
  assert.equal(label(11), 'b:big');
});
`;
const taggedD = `import assert from 'node:assert/strict';
import test from 'node:test';
import { tag } from '../../../packages/d/dist/d/src/index.js';
import { record, touch } from '../../helpers/runs.mjs';

await touch();

test('${C1} d tags eleven big and three small', () => {
  record('d');
  assert.equal(tag(11), 'd:big');
  assert.equal(tag(3), 'd:small');
});
`;

/** The lock npm writes for the merge base's package.json, made offline in a scratch folder. */
function lockFor(box, files) {
  const scratch = join(box.dir, 'lock');
  write(scratch, files);
  chmodSync(join(scratch, 'vendor/typescript/bin/tsc.cjs'), 0o755);
  execFileSync('npm', ['install', '--package-lock-only', '--offline', '--no-audit', '--no-fund', '--ignore-scripts'], { cwd: scratch, env: box.env, stdio: 'pipe' });
  return readFileSync(join(scratch, 'package-lock.json'), 'utf8');
}

/**
 * The machine's repository and a worktree of it (README: The fixture): <HOME>/deepbuild holds this checkout's
 * scripts/ and the merge base, origin at this project's URL (never fetched) and origin/main pinned at the base; the
 * worktree <HOME>/deepbuild/.claude/worktrees/w has one commit naming the planted issue, which adds `if (n > 10)
 * return 'big';` to a's grade() and the two tagged tests, each reading one dependent's dist.
 */
export function machineRepo(box) {
  const main = join(box.home, 'deepbuild');
  mkdirSync(main);
  cpSync(join(CHECKOUT, 'scripts'), join(main, 'scripts'), { recursive: true });
  const files = base();
  write(main, { ...files, 'package-lock.json': lockFor(box, files) });
  chmodSync(join(main, 'vendor/typescript/bin/tsc.cjs'), 0o755);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'remote', 'add', 'origin', 'https://github.com/windoliver/deepbuild.git');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'fixture');
  git(main, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const worktree = join(main, '.claude', 'worktrees', 'w');
  git(main, 'worktree', 'add', '-q', '-b', 'work', worktree);
  // The scripts' own packages (typescript, StrykerJS at <root>/node_modules/.bin/stryker), ignored by git.
  for (const at of [main, worktree]) symlinkSync(join(CHECKOUT, 'node_modules'), join(at, 'node_modules'));
  write(worktree, {
    'packages/a/src/f.ts': "export function grade(n: number): string {\n  if (n > 10) return 'big';\n  return 'small';\n}\n",
    'tests/helpers/runs.mjs': RUNS,
    [`tests/acceptance/${ISSUE}/b.test.mjs`]: taggedB,
    [`tests/acceptance/${ISSUE}/d.test.mjs`]: taggedD,
  });
  git(worktree, 'add', '-A');
  git(worktree, 'commit', '-q', '-m', `Grade big above ten\n\nPart of #${ISSUE}`);
  return { main, worktree };
}

/**
 * Runs `node scripts/proof.mjs mutation` in the worktree, in its own process group. Returns its status and output,
 * the builds logged under a mutant and the tagged tests' runs.
 */
export async function proof(box, fixture, ms = 600_000) {
  const child = spawn(process.execPath, [join(fixture.worktree, 'scripts/proof.mjs'), 'mutation'], { cwd: fixture.worktree, env: box.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let timer;
  const ended = await Promise.race([
    new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal }))),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
  ]);
  clearTimeout(timer);
  if (!ended) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    assert.fail(`the proof did not end within ${ms / 1000} s\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  const builds = existsSync(box.env.FX_BUILDS) ? readFileSync(box.env.FX_BUILDS, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  const runs = readdirSync(box.env.FX_RUNS).map((name) => JSON.parse(readFileSync(join(box.env.FX_RUNS, name), 'utf8'))).sort((a, b) => a.at - b.at);
  return { ...ended, stdout, stderr, builds, runs };
}

/** The mutation lane's survivors: each `SURVIVED <path>:<line> (<mutator>)` line with the diff lines under it. */
export function survivors(stdout) {
  const found = [];
  let block = null;
  for (const line of String(stdout).split('\n')) {
    if (/^SURVIVED /.test(line)) found.push((block = [line.trimEnd()]));
    else if (block && /^ {4}[-+]/.test(line)) block.push(line.trimEnd());
    else block = null;
  }
  return found.map((lines) => lines.join('\n')).sort();
}

/** The mutation lane's own lines: its state word and what follows it. */
export const laneLines = (stdout) => String(stdout).split('\n').filter((line) => /^(?:PASS|FAIL|BLOCKED|INVALID|INCONCLUSIVE) mutation: /.test(line) || /^mutation: /.test(line));

export const show = (result) => [
  `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}`,
  `stdout:\n${result.stdout.slice(-12000)}`,
  `stderr:\n${result.stderr.slice(-4000)}`,
  `builds under a mutant: ${JSON.stringify(result.builds)}`,
  `tagged test runs: ${result.runs.length}, under a mutant: ${result.runs.filter(({ mutant }) => mutant !== null).length}`,
].join('\n');
