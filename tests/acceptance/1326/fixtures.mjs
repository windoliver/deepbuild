// Test-side fixtures only. No implementation module is imported.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const HOOK = join(ROOT, 'target/debug/deep-hook');
export const CLI = join(ROOT, 'packages/cli/dist/main.js');
export const LIST = '.deepbuild/approvers';
export const TEST = 'tests/receipt.test.mjs';
const tag = '#91326.' + createHash('sha256').update('The receipt is checked.').digest('hex').slice(0, 8);
const source = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('${tag} receipt', () => { assert.equal(2 + 2, 4); });\n`;
export function put(file, text) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); }
export function world(t) {
  const dir = realpathSync(mkdtempSync('/tmp/d1326-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  mkdirSync(home);
  return { dir, home };
}
// Allowlist rather than inheriting real credentials, SSH agents, config, or DEEP_* overrides.
export function env(home, extra = {}) {
  return { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: home,
    TMPDIR: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C', NO_COLOR: '1', ...extra };
}
export function run(w, command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: w.repo ?? w.dir, env: env(w.home),
    encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024, ...options });
  assert.ok(!result.error, `BLOCKED: cannot run ${command}: ${result.error?.code ?? ''}`);
  assert.equal(result.signal, null, `BLOCKED: ${command} ended by ${result.signal}`);
  return { ...result, out: (result.stdout ?? '') + (result.stderr ?? '') };
}
export function git(w, ...args) {
  const r = run(w, 'git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture',
    '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args]);
  assert.equal(r.status, 0, `BLOCKED: fixture git ${args[0]} failed: ${r.out}`);
  return r.stdout.trim();
}
export function repository(w, list) {
  w.repo = join(w.dir, 'repo');
  mkdirSync(w.repo);
  git(w, 'init', '-q', '-b', 'main');
  put(join(w.repo, LIST), list);
  put(join(w.repo, TEST), source);
  put(join(w.repo, 'scripts/proof-guard.mjs'), '// The proof lanes are on main.\n');
  commit(w, 'base');
  git(w, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(w, 'checkout', '-q', '-b', 'session/1326');
  return w;
}
export function commit(w, message = 'fixture proposal') {
  git(w, 'add', '-A');
  git(w, 'commit', '-q', '--allow-empty', '-m', message);
  return git(w, 'rev-parse', 'HEAD');
}
export function weaken(w) { put(join(w.repo, TEST), source.replace('test(', 'test.skip(')); }
export function clone(w, name, homeList) {
  const home = join(w.dir, `${name}-home`), repo = join(w.dir, name);
  mkdirSync(home);
  cpSync(w.repo, repo, { recursive: true });
  if (homeList !== undefined) put(join(home, LIST), homeList);
  const copy = { ...w, repo, home };
  assert.equal(git(copy, 'rev-parse', 'HEAD'), git(w, 'rev-parse', 'HEAD'), 'same commit in both checkouts');
  return copy;
}
export function guard(w, extra = {}, script = join(ROOT, 'scripts/proof.mjs')) {
  return run(w, process.execPath, [script, 'guard'], { env: env(w.home, extra) });
}
export function passes(r, label, ...approvedFiles) {
  assert.equal(r.status, 0, `${label}\n${r.out}`);
  assert.match(r.stdout, /^PASS guard:/m, `${label}: silent success is not proof\n${r.out}`);
  assert.doesNotMatch(r.stdout, /^(FAIL|BLOCKED|INVALID|INCONCLUSIVE) guard:/m, label);
  for (const file of approvedFiles) assert.ok(r.stdout.split('\n').some((line) =>
    line.startsWith('PASS guard:') && line.includes(file) && line.includes('by approved proposal')),
  `${label}: approval must actually cover ${file}\n${r.out}`);
}
export function fails(r, label, ...names) {
  assert.equal(r.status, 1, `${label}: expected FAIL, not success\n${r.out}`);
  const lines = r.stdout.split('\n').filter((line) => line.startsWith('FAIL guard:'));
  assert.ok(lines.length, `${label}: expected FAIL guard, not a crash or BLOCKED\n${r.out}`);
  for (const name of names) assert.ok(lines.some((line) => line.includes(name)), `${label}: FAIL must name ${name}\n${r.out}`);
}
export function namesKey(r, key, label) {
  const lines = r.stdout.split('\n').filter((line) => line.startsWith('FAIL guard:'));
  assert.ok(lines.some((line) => [key.name, key.fingerprint, key.blob.toString('base64')].some((id) => line.includes(id))),
    `${label}: FAIL must identify the refused key (principal, fingerprint, or public blob)\n${r.out}`);
}
export function checked(w, entry, call) {
  assert.ok(existsSync(HOOK), 'BLOCKED: cargo build --locked -q -p deep-hook is required');
  const r = run(w, HOOK, ['check'], { input: JSON.stringify({ entry, call }) });
  assert.equal(r.status, 0, `deep-hook check must run: ${r.out}`);
  let value; try { value = JSON.parse(r.stdout); } catch { /* asserted below */ }
  assert.equal(typeof value?.matched, 'boolean', `deep-hook check must report matched, not silence: ${r.out}`);
  return value.matched;
}
export const call = (w, command) => ({ tool_name: 'Bash', tool_input: { command }, cwd: w.repo });
export const entry = (match) => ({ match, scope: 'all_repos', mode: 'block', fail_closed: true,
  reason: 'Approval signing is reserved for a person.', next_step: 'Ask a person to approve.' });
export function defaults() { return JSON.parse(readFileSync(join(ROOT, 'crates/deep-hook/default-rules.json'), 'utf8')); }

// Start only the real CLI/hub; the OS confirmation is the existing external-boundary stand-in.
export async function withHub(w, action) {
  assert.ok(existsSync(CLI), 'BLOCKED: npm run build --workspaces is required');
  put(join(w.home, 'confirm'), 'confirmed\n');
  const child = spawn(process.execPath, [CLI, 'hub', 'run'], { cwd: w.repo, env: env(w.home, {
    DEEP_HUB_TEST_CONFIRM: join(w.home, 'confirm'), DEEP_HUB_TEST_DEEP_HOOK: HOOK,
  }), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '', ended = false;
  child.stdout.on('data', (data) => { out += data; });
  child.stderr.on('data', (data) => { err += data; });
  const exit = new Promise((resolve) => child.once('close', () => { ended = true; resolve(); }));
  child.on('error', (error) => { err += error.message; ended = true; });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    const deadline = Date.now() + 60_000;
    while (!out.includes('\n') && !ended && Date.now() < deadline) await sleep(25);
    let ready; try { ready = JSON.parse(out.split('\n')[0]); } catch { /* asserted below */ }
    assert.equal(ready?.ready, true, `BLOCKED: fixture hub did not start: ${err}`);
    return await action();
  } finally {
    if (!ended && child.pid) child.kill('SIGTERM');
    await Promise.race([exit, sleep(5000)]);
    if (!ended && child.pid) { child.kill('SIGKILL'); await exit; }
  }
}
export function add(w, name, rule, planted, twin) {
  const file = join(w.dir, `${name}.json`);
  put(file, JSON.stringify({ v: 1, entries: { [name]: rule }, proofs: { [name]: { planted, twin } } }));
  return run(w, process.execPath, [CLI, 'guard', 'add', file]);
}
