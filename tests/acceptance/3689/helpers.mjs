import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const LONG = { timeout: 1_500_000 };
export const ISSUE = 9689;
export const DIR = `tests/acceptance/${ISSUE}`;

const ENV_OUT = ['NODE_TEST_CONTEXT', 'NODE_V8_COVERAGE', '__STRYKER_ACTIVE_MUTANT__', 'DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES',
  'CARGO_TARGET_DIR', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS', 'DEEP_PROOF_VITEST_REPORT', 'DEEP_HUB_PLANT'];

export const criterionId = (issue, text) => `#${issue}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;

export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3689-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  mkdirSync(home);
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), PATH: [dirname(process.execPath), process.env.PATH].join(delimiter), npm_config_offline: 'true', npm_config_update_notifier: 'false' };
  for (const name of ENV_OUT) delete env[name];
  for (const name of Object.keys(env)) if (/^npm_(?!config_offline$|config_update_notifier$)/i.test(name)) delete env[name];
  return { dir, home, env };
}

export function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}

export const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function run(argv, { cwd, env, timeout = 1_200_000 }) {
  const result = spawnSync(argv[0], argv.slice(1), { cwd, env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const tail = (text, size = 8_000) => (text.length > size ? `…${text.slice(-size)}` : text).replace(/^/gm, '| ');
export const show = (result) => `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}${result.error ? ` (${result.error})` : ''}\nstdout:\n${tail(result.stdout)}\nstderr:\n${tail(result.stderr, 3_000)}`;

export function repository(box, { name = 'repo', base, change, message, executable = [] }) {
  const cwd = join(box.dir, name);
  mkdirSync(cwd, { recursive: true });
  write(cwd, base);
  for (const path of executable) chmodSync(join(cwd, path), 0o755);
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', 'base');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(cwd, 'checkout', '-q', '-b', 'change');
  write(cwd, change);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', message);
  return cwd;
}

const issueBody = (criteria) => `Planted for the #3689 acceptance tests.\n\n### Acceptance criteria\n${criteria.map((text) => `- [ ] ${text}`).join('\n')}\n\n### Proof\nOutput pasted.\n`;

export function beforeLane(box, cwd, criteria) {
  const folder = join(box.dir, 'issues');
  write(folder, { [`${ISSUE}.md`]: issueBody(criteria) });
  return run([process.execPath, join(CHECKOUT, 'scripts/proof.mjs'), 'before'], { cwd, env: { ...box.env, DEEP_PROOF_ISSUES: folder } });
}

export const ids = (criteria) => Object.fromEntries(Object.entries(criteria).map(([key, text]) => [key, criterionId(ISSUE, text)]));

export const named = (path, name) => `${path} › ${name}`;
const STATE = /^(?:PASS|FAIL|BLOCKED|INVALID|INCONCLUSIVE) /;
export const linesFor = (result, key) => result.stdout.split('\n').filter((line) => STATE.test(line) && line.includes(` before: ${key}: `));

export function ranToEnd(result) {
  assert.match(result.stdout, /^proof: wall time /m, `the before lane did not run to its end\n${show(result)}`);
}

export function provenOn(result, key, twin) {
  const lines = linesFor(result, key);
  assert.ok(lines.length, `the before lane names no ${key}\n${show(result)}`);
  for (const line of lines) assert.match(line, /^PASS before: /, `${key} is not proven\n${show(result)}`);
  assert.ok(lines.some((line) => line.endsWith(`: failed on ${twin} at its assertion`)), `${key} did not fail on ${twin} at its assertion\n${show(result)}`);
}

export function refusedNaming(result, key, twin, files) {
  const lines = linesFor(result, key);
  assert.ok(lines.length, `the before lane names no ${key}\n${show(result)}`);
  assert.deepEqual(lines.filter((line) => line.startsWith('PASS ')), [], `${key} reads proven by a twin that replaces ${files.join(', ')}, which must be refused\n${show(result)}`);
  const failed = lines.filter((line) => line.startsWith(`FAIL before: ${key}: `)).map((line) => line.slice(`FAIL before: ${key}: `.length)).filter((detail) => detail.includes(twin));
  assert.ok(failed.length, `no FAIL before line for ${key} names its twin ${twin}\n${show(result)}`);
  for (const file of files) assert.ok(failed.some((line) => line.includes(file)), `the FAIL before line for ${key} does not name the refused file ${file}\n${show(result)}`);
}
