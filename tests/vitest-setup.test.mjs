// The repo's vitest setup (tests/vitest-setup.ts, named by vitest.config.ts): a test file's processes end with it,
// also when vitest itself is killed mid-run, and a test that swaps HOME still hands its children your Rust toolchain.
// Each case runs the repo's vitest and config on fixture files in a temporary root.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const VITEST = join(REPO, 'node_modules/vitest/vitest.mjs');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A root holding `tests/<name>.test.ts` for each fixture, run through the repo's config; removed after the test. */
function root(t, fixtures) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-vitest-setup-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'));
  mkdirSync(join(dir, 'tests'));
  for (const [name, body] of Object.entries(fixtures)) writeFileSync(join(dir, 'tests', `${name}.test.ts`), body.replaceAll('$DIR', JSON.stringify(dir)));
  return dir;
}
const args = (dir) => [VITEST, 'run', '--root', dir, '--config', join(REPO, 'vitest.config.ts')];
const env = (extra = {}) => {
  const out = { ...process.env, ...extra };
  for (const name of ['NODE_TEST_CONTEXT', 'NODE_OPTIONS', 'VITEST', 'VITEST_POOL_ID', 'VITEST_WORKER_ID']) delete out[name];
  for (const [name, value] of Object.entries(extra)) if (value === undefined) delete out[name];
  return out;
};

/** A file whose test starts a shell that starts a `sleep` and becomes another, writing both PIDs, then holds `ms`. */
const leaves = (ms) => `import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
it('leaves a child, and the child it started, running', async () => {
  const child = spawn('/bin/sh', ['-c', 'sleep 300 & echo $! > grandchild; exec sleep 301'], { cwd: $DIR, stdio: 'ignore' });
  writeFileSync(join($DIR, 'child'), String(child.pid));
  while (!existsSync(join($DIR, 'grandchild'))) await new Promise((resolve) => setTimeout(resolve, 20));
  writeFileSync(join($DIR, 'worker'), String(process.pid));
  await new Promise((resolve) => setTimeout(resolve, ${ms}));
}, 60_000);
`;
/** The command of the process with this PID, or null once it's gone; a zombie counts as gone. */
function running(pid) {
  const r = spawnSync('ps', ['-o', 'stat=,command=', '-p', String(pid)], { encoding: 'utf8' });
  const line = r.stdout.trim();
  return line && !line.startsWith('Z') ? line.replace(/^\S+\s+/, '') : null;
}
/** The two PIDs the fixture wrote; whichever is still a `sleep 30x` of ours after the test is stopped by PID. */
function sleepers(t, dir) {
  const pids = ['child', 'grandchild'].map((name) => Number(readFileSync(join(dir, name), 'utf8').trim()));
  t.after(() => { for (const pid of pids) if (/^sleep 30[01]$/.test(running(pid) ?? '')) process.kill(pid, 'SIGKILL'); });
  return pids;
}
async function gone(pids, ms) {
  for (const end = Date.now() + ms; pids.some(running) && Date.now() < end;) await sleep(50);
  return pids.map((pid) => [pid, running(pid)]).filter(([, command]) => command);
}

test('a child a vitest file leaves running, and the child it started, are stopped when the file ends', async (t) => {
  const dir = root(t, { leaves: leaves(0) });
  const r = spawnSync(process.execPath, args(dir), { cwd: REPO, env: env(), encoding: 'utf8', timeout: 120_000 });
  assert.equal(r.status, 0, `the fixture's file passes\n${r.stdout}${r.stderr}`);
  const pids = sleepers(t, dir);
  assert.deepEqual(await gone(pids, 3000), [], 'nothing the file started is still running once vitest has ended');
});

test('a child the file left running is stopped without its exit reaching the file, as a promise left pending would', async (t) => {
  // #29's wrong-program twins leave their command's promise pending: had the command ended while the file's code still
  // ran, the promise would have woken on a lease table the file had closed, an unhandled error that fails the file.
  const dir = root(t, { leaves: leaves(0).replace("writeFileSync(join($DIR, 'child')", "child.on('exit', () => { throw Error('the child ended while the file could still see it'); });\n  writeFileSync(join($DIR, 'child')") });
  const r = spawnSync(process.execPath, args(dir), { cwd: REPO, env: env(), encoding: 'utf8', timeout: 120_000 });
  const pids = sleepers(t, dir);
  assert.equal(r.status, 0, `the fixture's file passes, with no error after its test\n${r.stdout}${r.stderr}`);
  assert.deepEqual(await gone(pids, 3000), [], 'and nothing it started is still running');
});

test('a child a file starts as it loads, in a file whose tests all skip, is stopped when its worker ends', async (t) => {
  const dir = root(t, { loads: `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
const child = spawn('/bin/sh', ['-c', 'sleep 300 & echo $! > grandchild; exec sleep 301'], { cwd: $DIR, stdio: 'ignore' });
writeFileSync(join($DIR, 'child'), String(child.pid));
it.skip('runs nothing', () => {});
` });
  const r = spawnSync(process.execPath, args(dir), { cwd: REPO, env: env(), encoding: 'utf8', timeout: 120_000 });
  for (const end = Date.now() + 10_000; !existsSync(join(dir, 'grandchild')) && Date.now() < end;) await sleep(20);
  const pids = sleepers(t, dir);
  assert.equal(r.status, 0, `the fixture's file is skipped, not failed\n${r.stdout}${r.stderr}`);
  assert.deepEqual(await gone(pids, 3000), [], 'nothing the file started is still running once vitest has ended');
});

test('a child left running when vitest itself is killed mid-file is stopped when its worker ends', async (t) => {
  const dir = root(t, { leaves: leaves(1500) });
  const vitest = spawn(process.execPath, args(dir), { cwd: REPO, env: env(), stdio: 'ignore' });
  t.after(() => { if (vitest.exitCode === null) vitest.kill('SIGKILL'); });
  for (const end = Date.now() + 60_000; !existsSync(join(dir, 'worker')) && Date.now() < end;) await sleep(20);
  assert.ok(existsSync(join(dir, 'worker')), 'the fixture started its children');
  const pids = sleepers(t, dir);
  vitest.kill('SIGKILL'); // as a timed-out command's runner is killed: its worker runs on, under launchd
  const worker = Number(readFileSync(join(dir, 'worker'), 'utf8').trim());
  t.after(() => { if (running(worker)?.includes('node')) process.kill(worker, 'SIGKILL'); });
  assert.deepEqual(await gone([worker], 30_000), [], 'the orphaned worker ends by itself once its file is done');
  assert.deepEqual(await gone(pids, 3000), [], 'and nothing its file started is still running');
});

test('a test that swaps HOME hands its children your RUSTUP_HOME and CARGO_HOME, or the ones the run was given', async (t) => {
  const fixture = `import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
it('swaps HOME, as the suites do, and records what a child gets', () => {
  process.env.HOME = mkdtempSync(join($DIR, 'home-'));
  const r = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify({ RUSTUP_HOME: process.env.RUSTUP_HOME ?? null, CARGO_HOME: process.env.CARGO_HOME ?? null }))'], { env: process.env, encoding: 'utf8' });
  writeFileSync(join($DIR, 'homes.json'), r.stdout);
});
`;
  const homes = (extra) => {
    const dir = root(t, { homes: fixture });
    const r = spawnSync(process.execPath, args(dir), { cwd: REPO, env: env({ HOME: homedir(), ...extra }), encoding: 'utf8', timeout: 120_000 });
    assert.equal(r.status, 0, `the fixture's file passes\n${r.stdout}${r.stderr}`);
    return JSON.parse(readFileSync(join(dir, 'homes.json'), 'utf8'));
  };
  assert.deepEqual(homes({ RUSTUP_HOME: undefined, CARGO_HOME: undefined }), { RUSTUP_HOME: join(homedir(), '.rustup'), CARGO_HOME: join(homedir(), '.cargo') }, 'unset, they are your own, never the fake HOME\'s');
  const given = { RUSTUP_HOME: '/opt/caller-rustup', CARGO_HOME: '/opt/caller-cargo' };
  assert.deepEqual(homes(given), given, 'set by the run, they are kept');
});
