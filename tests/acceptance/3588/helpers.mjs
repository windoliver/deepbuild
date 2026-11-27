import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, watch, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { timedPath } from '../1115/helpers.mjs';
import { BUILD_SLOTS, fixture, prints, record, workspace } from '../2820/helpers.mjs';
import { dump as dump3567, hold, holding, noted, pause, passedCount, redact, sandbox as sandbox3567, start, stateLines, summary, throttleLog, throttleTable, until } from '../3567/helpers.mjs';

export { BUILD_SLOTS, passedCount, pause, record, stateLines, summary, throttleLog, throttleTable, until };

export const BOUND_MIN = 3;
export const EXIT_MS = 4 * 60_000;
const GRACE_MS = 20_000;
export const SCENE = { timeout: EXIT_MS + GRACE_MS + 8 * 60_000 };
export const LET_GO_MS = 20_000;

export const BINARY = 'tool3588';
export const PRINTS = 'tool3588 runs';
export const UNTIMED = 'tests/fixture-3588/cleanup.test.mjs';
export const TIMED = timedPath('mjs');
export const PLANTED = 'the cleanup fails one assertion on purpose';

const RUST_BINS = [join(homedir(), '.cargo', 'bin'), '/opt/homebrew/opt/rustup/bin'];

export function sandbox(t) {
  const box = sandbox3567(t);
  for (const name of Object.keys(box.env)) if (/^(?:CARGO_|RUSTC|RUSTUP_TOOLCHAIN$|MAKEFLAGS$|MFLAGS$)/.test(name) && name !== 'CARGO_BUILD_JOBS') delete box.env[name];
  box.env.PATH = [box.env.PATH, ...RUST_BINS.filter((dir) => existsSync(join(dir, 'cargo')))].join(delimiter);
  box.env.RUSTUP_HOME = process.env.RUSTUP_HOME ?? join(homedir(), '.rustup');
  box.env.CARGO_HOME = join(box.dir, 'cargo');
  return box;
}

const head = (file) => `import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
const note = (fields) => appendFileSync(process.env.T2820_RECORD, JSON.stringify({ file: ${JSON.stringify(file)}, pid: process.pid, at: Date.now(), ...fields }) + '\\n');
`;

const untimed = (fails) => `${head(UNTIMED)}
test(${JSON.stringify(fails ? PLANTED : 'the cleanup reads the binary, then removes it')}, async () => {
  const dir = process.env.DEEP_BIN_DIR ?? null;
  const path = dir ? join(dir, '${BINARY}') : null;
  // deadline: the go comes once the holders hold; 3 min bounds a machine that never starts them.
  for (let k = 0; k < 1800 && !existsSync(process.env.T3588_GO); k++) await new Promise((done) => setTimeout(done, 100));
  const there = Boolean(path && existsSync(path));
  const result = there ? spawnSync(path, [], { encoding: 'utf8' }) : null;
  note({ event: 'read', dir, there, stdout: result?.stdout?.trim() ?? null });
  if (path) rmSync(path, { force: true });
  note({ event: 'deleted', dir, gone: !(path && existsSync(path)) });
  assert.ok(there, 'no ${BINARY} in DEEP_BIN_DIR');
  assert.equal(result.stdout.trim(), ${JSON.stringify(PRINTS)});
  ${fails ? "assert.equal('kept', 'cleaned', 'a planted failure of the untimed file');" : ''}
});
`;

const timedFile = `${head(TIMED)}
note({ event: 'timed-loaded' });
test('the timed file runs the binary through DEEP_BIN_DIR', () => {
  const dir = process.env.DEEP_BIN_DIR ?? null;
  const path = dir ? join(dir, '${BINARY}') : null;
  const there = Boolean(path && existsSync(path));
  const result = there ? spawnSync(path, [], { encoding: 'utf8' }) : null;
  note({ event: 'timed-ran', dir, there, stdout: result?.stdout?.trim() ?? null });
  assert.ok(there, 'no ${BINARY} in DEEP_BIN_DIR when the timed file ran');
  assert.equal(result.stdout.trim(), ${JSON.stringify(PRINTS)});
});
`;

export function scene(box, { fails }) {
  const files = { ...workspace(box, { [BINARY]: prints(PRINTS) }), [UNTIMED]: untimed(fails), [TIMED]: timedFile };
  const go = join(box.dir, 'go');
  const fx = fixture(box, files, {
    DEEP_AFFECTED_MIN: String(BOUND_MIN), T3588_GO: go,
    NODE_OPTIONS: `--import=${new URL('../3296/machine.mjs', import.meta.url).href}`,
  });
  const built = spawnSync('cargo', ['build', '--locked', '--offline'], { cwd: fx.cwd, env: box.env, encoding: 'utf8' });
  assert.equal(built.status, 0, `the fixture's workspace doesn't build before the run: ${built.error?.message ?? built.stderr}`);
  return { ...fx, go };
}

export async function runScene(box, fx) {
  const run = start(box, fx, ['--timed', UNTIMED, TIMED], { limit: EXIT_MS + GRACE_MS });
  let exited = false;
  const done = run.done.then((result) => { exited = true; return result; });
  const scene = { run, done, holders: [], appeared: [], watching: null, gaveBack: false, held: false };
  const released = () => throttleLog(box).some((entry) => entry.event === 'released' && entry.class === 'build');
  // deadline: the run builds a binary that is already built, on a table of its own; the run's own limit bounds it.
  await until(() => released() || exited, EXIT_MS + GRACE_MS);
  scene.gaveBack = released();
  if (!scene.gaveBack) return scene;
  scene.holders = Array.from({ length: BUILD_SLOTS }, () => hold(box, fx, 'build'));
  // deadline: the holders' grants come at once on slots the run gave back; 60 s bounds a machine that can't start them.
  await until(() => holding(box) === BUILD_SLOTS || exited, 60_000);
  scene.held = holding(box) === BUILD_SLOTS;
  if (!scene.held) return scene;
  writeFileSync(fx.go, '');
  // deadline: the untimed file deletes the binary once it is let go on; the run's own limit bounds it.
  await until(() => record(fx).some((entry) => entry.event === 'deleted') || exited, EXIT_MS + GRACE_MS);
  const deleted = record(fx).find((entry) => entry.event === 'deleted');
  if (deleted?.dir && existsSync(deleted.dir)) {
    scene.watching = deleted.dir;
    const watcher = watch(deleted.dir, (_, name) => { if (name === BINARY) scene.appeared.push(Date.now()); });
    done.finally(() => watcher.close());
    if (existsSync(join(deleted.dir, BINARY))) scene.appeared.push(Date.now());
  }
  return scene;
}

export const waiting = (box, holders) => (throttleTable(box).requests ?? []).filter((request) => ['build', 'timed'].includes(request.class) && !holders.includes(request.pid));

export function letGo(holders) {
  for (const pid of holders) if (Number.isInteger(pid) && pid > 1) try { process.kill(pid, 'SIGTERM'); } catch {}
}

export const dump = (box, fx, scene, result) => `${dump3567(box, result)}\n${redact(box, [
  `holders (their throttles' PIDs): ${scene.holders.join(', ') || 'none started'}; holding: ${holding(box)}; noted: ${noted(box).length}`,
  `DEEP_BIN_DIR watched: ${scene.watching ?? 'never'}; ${BINARY} appeared there after the cleanup: ${scene.appeared.length} times`,
  `fixture files' notes:\n${record(fx).map((entry) => JSON.stringify(entry)).join('\n')}`,
].join('\n'))}`;
