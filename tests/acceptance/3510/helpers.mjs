import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHECKOUT, gitIn, write } from '../1115/helpers.mjs';
import { prints, sandbox as sandbox2820, workspace } from '../2820/helpers.mjs';
import { lines, start, tableLog, THROTTLE, within } from '../3334/helpers.mjs';

export { lines, movingLine, showLog, SLOTS, start, tableLog, THROTTLE, within } from '../3334/helpers.mjs';

export const PROOF_BINARIES = join(CHECKOUT, 'scripts/proof-binaries.mjs');
export const BIN = 'fixture-3510';
export const LONG = { timeout: 20 * 60_000 };
const ENV_OUT = ['DEEP_TEST_GRANT_STALL', 'DEEP_THROTTLE', 'DEEP_THROTTLE_READINGS', 'DEEP_THROTTLE_RUN', 'DEEP_PERF_LOCK', 'DEEP_LEASE_WAIT', 'DEEP_HUB_PLANT', 'NODE_TEST_CONTEXT', 'DEEP_PROOF_VITEST_REPORT'];

export function sandbox(t) {
  const box = sandbox2820(t);
  for (const name of ENV_OUT) delete box.env[name];
  mkdirSync(box.table, { recursive: true });
  return box;
}

export function fixture(box) {
  const token = `${BIN} ${randomBytes(6).toString('hex')}`;
  const cwd = join(box.dir, 'repo');
  mkdirSync(cwd);
  write(cwd, { '.gitignore': '/target\n', ...workspace(box, { [BIN]: prints(token) }) });
  const git = gitIn(cwd);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'the fixture workspace');
  return { cwd, token, bin: join(box.dir, 'run', 'bin'), marker: join(box.dir, 'build-started') };
}

const CALLER = `import { spawnSync } from 'node:child_process';
import { writeFileSync, writeSync } from 'node:fs';
const [module, cwd, bin, name, marker] = process.argv.slice(2);
const { buildBinaries } = await import(module);
const run = (command, args, options) => {
  writeFileSync(marker, JSON.stringify([command, ...args]));
  return spawnSync(command, args, options);
};
writeSync(1, 'CALLING ' + process.pid + '\\n');
let line;
try {
  line = 'RETURNED ' + JSON.stringify(buildBinaries(cwd, bin, [name], run));
} catch (error) {
  line = 'THREW ' + JSON.stringify(String(error?.message ?? error));
}
writeSync(1, line + '\\n');
`;

export function call(box, fx, { env = {}, under = [] } = {}) {
  const script = join(box.dir, 'caller.mjs');
  writeFileSync(script, CALLER);
  const child = start(box, [...under, process.execPath, script, pathToFileURL(PROOF_BINARIES).href, fx.cwd, fx.bin, BIN, fx.marker], { env: { ...box.env, ...env }, cwd: fx.cwd });
  const calling = child.line(/^CALLING \d+$/).then((line) => (line ? Number(line.slice('CALLING '.length)) : null));
  child.callerPid = () => within(calling, 3);
  child.ended = async (minutes) => {
    const run = await within(child.done, minutes);
    if (!run) return null;
    const last = (head) => lines(run.stdout).filter((line) => line.startsWith(head)).at(-1)?.slice(head.length);
    const parsed = (text) => { try { return JSON.parse(text); } catch { return undefined; } };
    return { status: run.status, returned: parsed(last('RETURNED ')), threw: parsed(last('THREW ')), text: `exit ${run.status ?? run.signal}\n${child.output()}` };
  };
  return child;
}

export function joined(box, child, pid) {
  let watcher;
  const seen = new Promise((resolve) => {
    const look = () => {
      try {
        if (JSON.parse(readFileSync(join(box.table, 'table.json'), 'utf8')).requests.some((request) => request.pid === pid)) resolve(true);
      } catch {}
    };
    watcher = watch(box.table, look);
    look();
  });
  return within(Promise.race([seen, child.done.then(() => false)]), 2).finally(() => watcher.close());
}

export function holders(box, count, hold = 'exec /bin/sleep 600') {
  box.go = join(box.dir, 'go-3510');
  return Promise.all(Array.from({ length: count }, async (_, k) => {
    const name = `hold-3510-${k + 1}`;
    const child = start(box, [process.execPath, THROTTLE, 'build', '--wait', '10', '--', '/bin/sh', '-c', `echo "GRANTED $DEEP_THROTTLE"; ${hold}`, name, box.go]);
    const line = await within(child.line(/^GRANTED build:\S+$/), 2);
    return line ? { pid: child.pid, id: line.slice('GRANTED build:'.length), name, child } : null;
  }));
}
export const EIGHT_SECONDS = 'while [ ! -e "$1" ]; do /bin/sleep 0.1; done; exec /bin/sleep 8';

export const entriesOf = (box, pid) => tableLog(box.table).filter((entry) => entry.class === 'build' && entry.pid === pid);

export const binHolds = (fx) => (existsSync(fx.bin) ? readdirSync(fx.bin) : []);

export function ranBinary(fx) {
  const path = join(fx.bin, BIN);
  if (!existsSync(path)) return { exists: false, status: null, stdout: null };
  const result = spawnSync(path, [], { encoding: 'utf8' });
  return { exists: true, status: result.status, stdout: result.stdout?.trim() ?? null };
}

export function builtIn(assert, fx, ended, all) {
  assert.equal(ended.threw, undefined, `buildBinaries threw: ${ended.threw}\n${all()}`);
  assert.equal(ended.returned, fx.bin, `buildBinaries returns its bin\n${all()}`);
  const binary = ranBinary(fx);
  assert.ok(binary.exists, `bin holds ${BIN}\n${all()}`);
  assert.equal(binary.stdout, fx.token, `the binary in bin was built from the fixture repository by this call\n${all()}`);
  assert.ok(existsSync(fx.marker), `the call started its build through its run argument\n${all()}`);
}
