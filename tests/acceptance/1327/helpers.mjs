// Helpers for #1327's acceptance tests, written for this suite only (README). A scene is a scratch git repository
// holding a copy of this checkout's scripts/ on origin/main, with a change on top; the guard and the lanes run there
// as they do in a worktree.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const VIEW = fileURLToPath(new URL('./lanes-view.mjs', import.meta.url));

/** A criterion's tag as proof-change.mjs computes it: SHA-256 of the text, trimmed, white space collapsed. */
export const criterionId = (issue, text) => `#${issue}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;

// Planted issues: the change's own (its suite's folder), and another issue whose suite already landed.
export const OWN = 9327;
export const OTHER = 9328;
export const LANDED = 9330;
const PLANTED_CRITERION = 'The planted suite holds';
const issueBody = (n) => `Planted for #1327.\n\n### Acceptance criteria\n- [ ] ${PLANTED_CRITERION}\n\n### Proof\nNone.\n`;

/** A vitest suite file for a planted issue, its one test tagged with that issue's criterion. */
export const suiteFile = (n) => `import { expect, test } from 'vitest';

test('${criterionId(n, PLANTED_CRITERION)} the planted suite holds', () => {
  expect(1 + 1).toBe(2);
});
`;

/** A lane.json in the shape these tests expect: alone, and why, and nothing else (README). */
export const laneJson = (fields = {}) => `${JSON.stringify({ alone: true, why: 'Its tests start a process that holds the machine one port.', ...fields }, null, 2)}\n`;

function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}

/**
 * A scratch repository: origin/main holds this checkout's scripts/ and `base`; the branch `change` holds one commit
 * on top that writes `change`, deletes `remove`, and says `Part of #<issue>`. Removed with the test.
 */
export function scene(t, { base = {}, change = {}, remove = [], issue = OWN, subject = 'Add a suite' } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1327-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cwd = join(dir, 'scene'), home = join(dir, 'home'), issues = join(dir, 'issues');
  mkdirSync(cwd);
  mkdirSync(home);
  write(issues, Object.fromEntries([OWN, OTHER, LANDED].map((n) => [`${n}.md`, issueBody(n)])));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  cpSync(join(CHECKOUT, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  symlinkSync(join(CHECKOUT, 'node_modules'), join(cwd, 'node_modules'));
  write(cwd, { '.gitignore': 'node_modules\n', ...base });
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'change');
  write(cwd, change);
  for (const path of remove) rmSync(join(cwd, path));
  git('add', '-A');
  git('commit', '-qm', `${subject}\n\nPart of #${issue}`);
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), DEEP_PROOF_ISSUES: issues, DEEP_APPROVERS: join(dir, 'no-approvers') };
  for (const name of ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_BIN_DIR', 'DEEP_SHARDS']) delete env[name];
  return { dir, cwd, env };
}

const ran = (result) => ({ status: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '', all: `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}` });

/** The scene's own `node scripts/proof.mjs guard`. */
export const guard = ({ cwd, env }) => ran(spawnSync(process.execPath, ['scripts/proof.mjs', 'guard'], { cwd, env, encoding: 'utf8', timeout: 110_000 }));

/** What the lanes of `scripts` do with `files`, read in `cwd` (lanes-view.mjs); `view` is null when it didn't run. */
export function lanesView({ cwd, env = process.env, dir }, files, scripts = join(cwd, 'scripts')) {
  const list = join(dir, `files-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(list, JSON.stringify(files));
  const result = ran(spawnSync(process.execPath, [VIEW, scripts, list], { cwd, env, encoding: 'utf8', timeout: 110_000, maxBuffer: 256 * 1024 * 1024 }));
  let view = null;
  if (result.status === 0) try { view = JSON.parse(result.stdout); } catch {}
  return { ...result, view };
}

/** The guard's lines that read FAIL. */
export const failLines = (output) => output.split('\n').filter((line) => /^FAIL guard: /.test(line));
