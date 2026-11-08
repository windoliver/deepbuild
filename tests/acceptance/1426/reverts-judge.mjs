// #1426 AC2's judge: each named row's test passes on a private copy of the tree, and fails with that row's change
// reverted there. Nothing edits the repo: the copy holds its own target folder, so no sibling build can swap a binary,
// and a Rust test binary is copied out of that folder before it runs. A run that can't build or start is INCONCLUSIVE.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { carriedRows, cleanEnv, clip, README, remove, repoRoot, rowTest, tempRoot } from './common.mjs';

/**
 * Each behavior's revert as an edit of the row's files that keeps the tree compiling, so the test fails on what the
 * behavior does and not on a missing name. Each `edits` entry must match once in one of the row's files.
 */
export const REVERTS = [
  { name: 'the sRGB layer tag', row: /sRGB/i, edits: [[/objc2_layer\s*\.setColorspace\(\s*srgb[^;]*;/, 'objc2_layer.setColorspace(None);']] },
  {
    name: 'the exact gradient mode', row: /exact gradient/i, edits: [
      [/\} else if \(color_space == 2\) \{[\s\S]*?out\.color1\.rgb \*= out\.color1\.a;\s*\}/, '}'],
      [/if \(color_space == 1\) \{/, 'if (color_space == 1 || color_space == 2) {'],
      [/case 2: \{\s*\/\/ DeepBuild patch[\s\S]*?return oklab_to_srgb_exact\(oklab_color\);\s*\}/, ''],
      [/case 1: \{/, 'case 1:\n        case 2: {'],
    ],
  },
  { name: 'the BGRA surface', row: /BGRA/i, edits: [[/if CVPixelBufferGetPixelFormatType\(image_buffer\) == kCVPixelFormatType_32BGRA \{/, 'if false {']] },
  { name: 'the surface reports', row: /report/i, edits: [[/self\s*\.sampled_surfaces\s*\.push\([^;]*;/, '']] },
];

/** What keeps a real run from this machine, or null. The row tests that build gpui-pre-apple need Metal's compiler. */
export function machineProblem() {
  if (process.platform !== 'darwin') return `INCONCLUSIVE: ${process.platform} can't build or run the Metal renderer`;
  const metal = spawnSync('xcrun', ['--find', 'metal'], { encoding: 'utf8' });
  if (metal.status !== 0) return `INCONCLUSIVE: no Metal compiler, which gpui-pre-apple's build needs (full Xcode): ${(metal.stderr || metal.error?.message || '').trim()}`;
  if (spawnSync('cargo', ['--version'], { encoding: 'utf8' }).status !== 0) return 'INCONCLUSIVE: no cargo on the PATH';
  return null;
}

const literal = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\const crateOf = (root, path) => {');
const crateOf = (root, path) => {
  for (let dir = dirname(path); dir !== '.'; dir = dirname(dir)) if (existsSync(join(root, dir, 'Cargo.toml'))) return dir;
  return null;
};

/** Runs one named test in `root`: `{ state: 'pass' | 'fail' | 'none' | 'cannot', output }`. */
export function runRowTest(root, { path, name }, work) {
  const env = cleanEnv();
  if (path.endsWith('.test.mjs')) {
    const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=${literal(name)}`, path], { cwd: root, encoding: 'utf8', env, timeout: 3_600_000, maxBuffer: 256 * 1024 * 1024 });
    // A file none of whose tests ran still reports itself as one test, so the test is found by its own name.
    const results = (run.stdout ?? '').split('\n').map((line) => /^\s*(not )?ok \d+ - (.*)$/.exec(line)).filter((hit) => hit?.[2] === name);
    return { state: results.some((hit) => hit[1]) ? 'fail' : results.length ? 'pass' : 'none', output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
  }
  if (path.endsWith('.test.ts')) {
    const report = join(work, 'vitest.json');
    const run = spawnSync(join(root, 'node_modules/.bin/vitest'), ['run', path, '-t', literal(name), '--reporter=json', `--outputFile=${report}`], { cwd: root, encoding: 'utf8', env, timeout: 3_600_000, maxBuffer: 256 * 1024 * 1024 });
    if (!existsSync(report)) return { state: 'cannot', output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
    const { numPassedTests: pass = 0, numFailedTests: fail = 0 } = JSON.parse(readFileSync(report, 'utf8'));
    remove(report);
    return { state: fail ? 'fail' : pass ? 'pass' : 'none', output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
  }
  if (path.endsWith('.rs')) {
    const crate = crateOf(root, path);
    if (!crate) return { state: 'cannot', output: `no Cargo.toml above ${path}` };
    const inner = path.slice(crate.length + 1);
    const target = inner.startsWith('tests/') ? ['--test', basename(inner, '.rs')] : [];
    const build = spawnSync('cargo', ['test', '--locked', '--no-run', '--message-format=json-render-diagnostics', ...target], { cwd: join(root, crate), encoding: 'utf8', env, timeout: 7_200_000, maxBuffer: 1 << 30 });
    const built = (build.stdout ?? '').split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line)).filter(({ reason, executable, profile }) => reason === 'compiler-artifact' && executable && profile?.test).map(({ executable }) => executable);
    if (build.status !== 0 || !built.length) return { state: 'cannot', output: `cargo test --locked --no-run failed: ${(build.stderr ?? '').split('\n').slice(-30).join('\n')}` };
    let passed = 0, failed = 0, output = '';
    for (const executable of built) {
      // Out of target, as a sibling build can't reach this copy.
      const binary = join(work, basename(executable));
      copyFileSync(executable, binary);
      chmodSync(binary, 0o755);
      const run = spawnSync(binary, [name], { cwd: join(root, crate), encoding: 'utf8', env, timeout: 1_800_000, maxBuffer: 256 * 1024 * 1024 });
      const [, pass, fail] = /test result: \w+\. (\d+) passed; (\d+) failed/.exec(run.stdout ?? '') ?? [];
      passed += Number(pass ?? 0);
      failed += Number(fail ?? 0);
      output += `${run.stdout ?? ''}${run.stderr ?? ''}`;
    }
    return { state: failed ? 'fail' : passed ? 'pass' : 'none', output };
  }
  return { state: 'cannot', output: `no way to run a test in ${path}` };
}

/** The row's edits applied in `copy`: `{ restore }`, or `{ missing }` naming the edit that matched no file. */
function applyRevert(copy, row, edits) {
  const before = new Map();
  for (const [pattern, to] of edits) {
    const file = row.files.find((path) => existsSync(join(copy, path)) && pattern.test(readFileSync(join(copy, path), 'utf8')));
    if (!file) {
      for (const [path, text] of before) writeFileSync(join(copy, path), text);
      return { missing: String(pattern) };
    }
    const text = readFileSync(join(copy, file), 'utf8');
    if (!before.has(file)) before.set(file, text);
    writeFileSync(join(copy, file), text.replace(pattern, to));
  }
  return { restore: () => { for (const [path, text] of before) writeFileSync(join(copy, path), text); } };
}

/** The failures of AC2 in the tree at `root`, one behavior at a time, each control first. */
export function judgeReverts(root = repoRoot, reverts = REVERTS) {
  const rows = carriedRows(existsSync(join(root, README)) ? readFileSync(join(root, README), 'utf8') : '');
  if (!rows) return [`${README} has no carried-patch table with the columns the README pins`];
  const copy = tempRoot('copy'), work = tempRoot('work');
  const failures = [];
  try {
    cpSync(root, copy, { recursive: true, filter: (path) => !['target', '.git', 'node_modules'].includes(basename(path)) });
    if (existsSync(join(root, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(copy, 'node_modules'));
    for (const { name, row: pattern, edits } of reverts) {
      const row = rows.find(({ behavior }) => pattern.test(behavior));
      if (!row) { failures.push(`no row for ${name}`); continue; }
      const test = rowTest(row.test);
      if (!test) { failures.push(`the row for ${name} names no test`); continue; }
      const control = runRowTest(copy, test, work);
      if (control.state === 'cannot') { failures.push(`INCONCLUSIVE: ${name}: its test couldn't run: ${clip(control.output)}`); continue; }
      if (control.state === 'none') { failures.push(`${name}: ${test.path} › ${test.name} runs no test`); continue; }
      if (control.state === 'fail') { failures.push(`${name}: its test fails with the change in place: ${clip(control.output)}`); continue; }
      const reverted = applyRevert(copy, row, edits);
      if (reverted.missing) { failures.push(`INCONCLUSIVE: ${name}: the revert ${reverted.missing} matches none of the row's files, so the code moved; redraft the edit`); continue; }
      const run = runRowTest(copy, test, work);
      reverted.restore();
      if (run.state === 'pass') failures.push(`${name}: its test still passes with the change reverted`);
      else if (run.state === 'none') failures.push(`${name}: with the change reverted its test runs nothing`);
      else if (run.state === 'cannot') failures.push(`INCONCLUSIVE: ${name}: its test couldn't run with the change reverted: ${clip(run.output)}`);
    }
    return failures;
  } finally {
    remove(copy);
    remove(work);
  }
}
