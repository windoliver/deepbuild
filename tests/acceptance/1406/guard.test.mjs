// #1406 AC1: scripts/benchmark.mjs, where judgeLimit and judgeInstructions decide budgets, is the proof lanes' own code
// to the guard. Reached as earlier guard suites reach it: this checkout's `node scripts/proof.mjs guard`, run in a
// scratch repository whose main holds the proof lanes, on one unsigned commit.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const ISSUE = 9406;
const write = (cwd, files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
};

test('#1406.9a60feb9 AC1 a planted edit of judgeLimit in scripts/benchmark.mjs is refused by the proof guard without a signed tag', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1406-')));
  try {
    const cwd = join(dir, 'scene');
    mkdirSync(cwd);
    const env = { ...process.env, HOME: join(dir, 'home'), XDG_CACHE_HOME: join(dir, 'home/.cache'), DEEP_PROOF_ISSUES: join(dir, 'issues'), DEEP_APPROVERS: join(dir, 'no-approvers') };
    for (const name of ['NODE_TEST_CONTEXT', 'DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'DEEP_PROOF_VITEST_REPORT']) delete env[name];
    const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env, stdio: 'pipe' });
    // Main holds the guard, this checkout's benchmark.mjs as it is, and guide.mjs, which is no check.
    const benchmark = readFileSync(join(CHECKOUT, 'scripts/benchmark.mjs'), 'utf8');
    write(cwd, { 'scripts/proof-guard.mjs': '// the guard\n', 'scripts/benchmark.mjs': benchmark, 'scripts/guide.mjs': '// as on main\n' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('checkout', '-q', '-b', 'change');
    // The planted edit: judgeLimit passes every limit. One unsigned commit carries it and an edit of guide.mjs.
    const weakened = benchmark.replace(/^(export function judgeLimit\([^)]*\) \{)$/m, "$1\n  return { status: 'PASS', limit, runs }; // planted for #1406");
    assert.notEqual(weakened, benchmark, 'the checkout has no `export function judgeLimit(...) {` line to plant the edit in');
    write(cwd, { 'scripts/benchmark.mjs': weakened, 'scripts/guide.mjs': '// changed, with no approval\n' });
    git('add', '-A');
    git('commit', '-qm', `Weaken judgeLimit\n\nPart of #${ISSUE}`);
    write(join(dir, 'issues'), { [`${ISSUE}.md`]: 'Planted for #1406.\n\n### Acceptance criteria\n- [ ] Nothing real\n' });
    const run = spawnSync(process.execPath, [join(CHECKOUT, 'scripts/proof.mjs'), 'guard'], { cwd, env, encoding: 'utf8', timeout: 300_000 });
    const all = `exit ${run.status} ${run.signal ?? ''}\n${run.stdout}\n${run.stderr}`;
    const refused = run.stdout.split('\n').filter((line) => line.startsWith('FAIL guard:'));
    assert.ok(refused.some((line) => line.startsWith('FAIL guard: scripts/benchmark.mjs:')), `an unsigned edit of judgeLimit in scripts/benchmark.mjs passed the guard\n${all}`);
    assert.ok(!refused.some((line) => line.includes('scripts/guide.mjs')), `the guard refused a script that is no check\n${all}`);
    assert.notEqual(run.status, 0, all);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
