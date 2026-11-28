import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir, userInfo } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPROVERS, people, tag } from '../../fixtures/approver.mjs';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const MANIFEST = 'benchmarks/budgets.json';
const OFF_MACOS = 'INCONCLUSIVE (platform): the fixture commands are counted as macOS counts them, and the machine stand-ins are a Mac\'s';
const QUIET_LOAD = 2;
const REFERENCE_MAC = { model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30, macosBuild: '25A3537' };
const UNSET = ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PROOF_VITEST_REPORT', 'DEEP_THROTTLE_READINGS', 'DEEP_THROTTLE_RUN', 'DEEP_WINDOW', 'DEEP_WINDOW_DRAIN',
  'DEEP_WINDOW_APART_MIN', 'DEEP_WINDOW_OVERDUE_MIN', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS', 'DEEP_GATES', 'DEEP_BIN_DIR', 'DEEP_COUNT_LOG',
  'CARGO_TARGET_DIR', 'CARGO_MAKEFLAGS', 'MAKEFLAGS', 'MFLAGS'];

export const within = (minutes) => ({ timeout: minutes * 60_000, skip: process.platform === 'darwin' ? false : OFF_MACOS });

const PINNED_LOAD = `import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
const pinned = Number(process.env.T3537_LOAD);
os.loadavg = () => [pinned, pinned, pinned];
syncBuiltinESMExports();
`;

const GH_STAND_IN = (calls) => `import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
if (args[0] === 'issue' && args[1] === 'create') console.log('https://example.invalid/fixture/issues/9999');
else { console.error('stand-in gh: no ' + args.join(' ')); process.exit(1); }
`;

const executable = (path, content) => {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
};

function standIns(box) {
  executable(join(box.bin, 'sysctl'), `#!/bin/sh
case "$*" in
  "-n hw.model") echo ${REFERENCE_MAC.model} ;;
  "-n machdep.cpu.brand_string") echo "${REFERENCE_MAC.chip}" ;;
  "-n hw.memsize") echo ${REFERENCE_MAC.memoryBytes} ;;
  "-n vm.loadavg") echo "{ ${QUIET_LOAD} ${QUIET_LOAD} ${QUIET_LOAD} }" ;;
  *) exec /usr/sbin/sysctl "$@" ;;
esac
`);
  executable(join(box.bin, 'pmset'), `#!/bin/sh
if [ "$*" = "-g ps" ]; then echo "Now drawing from 'AC Power'"; else echo " lowpowermode         0"; fi
`);
  executable(join(box.bin, 'osascript'), '#!/bin/sh\necho 0\n');
  executable(join(box.bin, 'sw_vers'), `#!/bin/sh\necho ${REFERENCE_MAC.macosBuild}\n`);
  for (const tool of ['npm', 'cargo']) executable(join(box.bin, tool), '#!/bin/sh\nexit 0\n');
  writeFileSync(join(box.bin, 'gh.mjs'), GH_STAND_IN(box.calls));
  executable(join(box.bin, 'gh'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(box.bin, 'gh.mjs'))} "$@"\n`);
}

const underNodeTest = () => Boolean(process.env.NODE_TEST_CONTEXT) || process.execArgv.includes('--test');
const running = (child) => child.exitCode === null && child.signalCode === null;

function sandbox() {
  assert.ok(underNodeTest(), 'BLOCKED (runner): the suite runs only under node --test, where a window keeps the throttle table DEEP_THROTTLE_TABLE names and never drains the machine\'s');
  assert.ok(existsSync(join(CHECKOUT, 'node_modules', 'typescript')), 'BLOCKED (install): <checkout> holds no node_modules/typescript, which the window\'s selection imports: run npm ci there first');
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3537-')));
  const box = { dir, home: join(dir, 'user'), bin: join(dir, 'bin'), tmp: join(dir, 'tmp'), calls: join(dir, 'gh-calls.jsonl'), children: [] };
  for (const folder of [box.home, box.bin, box.tmp]) mkdirSync(folder);
  symlinkSync(join(CHECKOUT, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(join(dir, 'pinned-load.mjs'), PINNED_LOAD);
  standIns(box);
  box.env = {
    ...process.env,
    HOME: box.home, XDG_CACHE_HOME: join(box.home, '.cache'), TMPDIR: box.tmp, RUSTUP_HOME: join(box.home, '.rustup'), CARGO_HOME: join(box.home, '.cargo'),
    DEEP_THROTTLE_TABLE: join(box.home, '.deepbuild', 'throttle'),
    NODE_OPTIONS: `--import=${join(dir, 'pinned-load.mjs')}`, T3537_LOAD: String(QUIET_LOAD),
  };
  for (const name of Object.keys(box.env)) if (/^GIT_/.test(name) || UNSET.includes(name)) delete box.env[name];
  box.env.PATH = [box.bin, dirname(process.execPath), box.env.PATH].join(delimiter);
  box.leave = () => {
    for (const child of box.children) if (child.pid > 1 && running(child)) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  };
  return box;
}

export function staged(after, play) {
  let box, played;
  after(() => box?.leave());
  return () => (played ??= Promise.resolve().then(() => {
    box = sandbox();
    return play(box);
  }));
}

function redacted(box, text) {
  const folders = [[box.home, '~'], [box.dir, '<sandbox>'], [CHECKOUT, '<checkout>'], [homedir(), '~'], [userInfo().homedir, '~']];
  let shown = String(text);
  for (const [folder, name] of folders) for (const spelled of [folder, folder.replace(/^\/private\//, '/')]) shown = shown.split(spelled).join(name);
  for (const host of [hostname(), hostname().split('.')[0]]) if (host.length > 4) shown = shown.split(host).join('<host>');
  return shown;
}

export const working = (counts) => JSON.stringify({ work: counts });
export const loop = (rounds, reportLine) => `rounds=${rounds}\ni=0\nwhile [ $i -lt $rounds ]; do i=$((i+1)); done\n${reportLine ? `echo '${reportLine}'\n` : ''}`;
export const scriptOf = (id) => `bench/${id}.sh`;
export const task = (id, limits = {}) => ({ id, command: ['/bin/sh', '-c', `. ./${scriptOf(id)}`], margin: 0.5, limits, initialReason: 'Fixture for #3537.' });
export const manifest = (tasks) => `${JSON.stringify({ tasks }, null, 2)}\n`;
export const approvalItem = (id, count, before, after) => `${MANIFEST} › ${id} › work.${count} ${before} → ${after}`;

const gitIn = (box, cwd) => (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
  { cwd, env: box.env, encoding: 'utf8', stdio: 'pipe' }).trim();
const write = (cwd, files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
};

function fixture(box, files) {
  const origin = join(box.dir, 'origin.git'), clone = join(box.dir, 'work'), mac = join(box.dir, 'mac');
  const keys = people();
  mkdirSync(origin);
  mkdirSync(clone);
  gitIn(box, origin)('init', '-q', '--bare', '-b', 'main');
  const git = gitIn(box, clone);
  git('init', '-q', '-b', 'main');
  cpSync(join(CHECKOUT, 'scripts'), join(clone, 'scripts'), { recursive: true });
  write(clone, { [APPROVERS]: keys.list, 'notes.txt': 'Notes no task reads.\n', ...files });
  git('add', '-A');
  git('commit', '-qm', 'The fixture before its first window');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  gitIn(box, box.dir)('clone', '-q', origin, mac);
  return {
    mac,
    commit(changes, message) {
      write(clone, changes);
      git('add', '-A');
      git('commit', '-qm', message);
      git('push', '-q', 'origin', 'main');
      return git('rev-parse', 'HEAD');
    },
    approve(name, commit, items) {
      tag(clone, `deep/approved/${name}`, commit, items, keys.maintainer);
      git('push', '-q', 'origin', `refs/tags/deep/approved/${name}`);
    },
  };
}

async function windowOver(box, repo, minutes) {
  const child = spawn(process.execPath, [join(repo.mac, 'scripts', 'throttle.mjs'), 'window', '--wait', '5'], { cwd: repo.mac, env: box.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  const run = { status: null, signal: null, stdout: '', stderr: '', stopped: false, minutes };
  child.stdout.on('data', (chunk) => { run.stdout += chunk; });
  child.stderr.on('data', (chunk) => { run.stderr += chunk; });
  // deadline: a window still running at its limit is stopped by its group's PID, so a hang reads as a failed assertion
  const limit = setTimeout(() => {
    run.stopped = true;
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }, minutes * 60_000);
  [run.status, run.signal] = await new Promise((resolve) => child.on('close', (...end) => resolve(end)));
  clearTimeout(limit);
  return run;
}

function lanesRecords(box) {
  const folder = join(box.home, '.deepbuild', 'lanes');
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter((name) => name.endsWith('.json')).flatMap((name) => {
    try {
      const record = JSON.parse(readFileSync(join(folder, name), 'utf8'));
      return typeof record?.commit === 'string' && Array.isArray(record.tests) ? [record] : [];
    } catch {
      return [];
    }
  });
}

function seen(box, run) {
  const calls = existsSync(box.calls) ? readFileSync(box.calls, 'utf8') : '';
  return redacted(box, [
    `window exit ${run.status}${run.signal ? ` (${run.signal})` : ''}`,
    `stdout:\n${run.stdout.slice(-4000)}`,
    `stderr:\n${run.stderr.slice(-2000)}`,
    `gh calls:\n${calls.slice(-1000)}`,
    `records:\n${lanesRecords(box).map((record) => JSON.stringify({ commit: record.commit, state: record.state, tests: record.tests.map(({ id, state, note }) => ({ id, state, note })) }).slice(0, 3000)).join('\n')}`,
  ].join('\n'));
}

export async function marked(box, files) {
  const repo = fixture(box, files);
  const run = await windowOver(box, repo, 5);
  assert.ok(run.status === 0 && !lanesRecords(box).length, `BLOCKED (window): the fixture's first window, which only marks main, didn't end clean with nothing measured\n${seen(box, run)}`);
  return repo;
}

export async function measured(box, repo, minutes) {
  const run = await windowOver(box, repo, minutes);
  assert.ok(!run.stopped, `INCONCLUSIVE (window): the window still ran after ${minutes} minutes and was stopped, so it measured nothing to judge\n${seen(box, run)}`);
  return run;
}

export function recordOf(box, run, commit, what) {
  const record = lanesRecords(box).find((one) => one.commit === commit);
  assert.ok(record, `BLOCKED (window): the window left no record for ${what} ${commit}\n${seen(box, run)}`);
  return record;
}

export const rowOf = (record, id) => record.tests.find((row) => row.id === id);
export const rowsSaid = (record) => `${record.state}: ${record.tests.map(({ id, state, note }) => `${id} ${state}${note ? `: ${note}` : ''}`).join('; ')}`.slice(0, 3000);

export function judgedRow(record, id) {
  const row = rowOf(record, id), refusedWhole = rowOf(record, MANIFEST);
  assert.ok(row || !refusedWhole, `BLOCKED (window): the window measured no task on ${record.commit}: ${rowsSaid(record)}`);
  assert.ok(row, `the record of ${record.commit} has no row for ${id}: ${rowsSaid(record)}`);
  return row;
}

const literal = (word) => String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const names = (text, what) => (typeof what === 'number'
  ? new RegExp(`(?<![\\w.,-])${what}(?![\\w]|[.,]\\d)`)
  : new RegExp(`(?<![\\w-])${literal(what)}(?![\\w-])`)).test(text ?? '');

const middle = (values) => {
  const sorted = [...values].sort((a, b) => a - b), half = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(half)] : (sorted[half - 1] + sorted[half]) / 2;
};
const counted = (rounds) => Array.isArray(rounds) && rounds.length > 0 && rounds.every((count) => Number.isSafeInteger(count) && count > 0);

export function sidesOf(row) {
  const { change, base } = row.sides ?? {};
  if (!counted(change?.instructions) || !counted(base?.instructions) || change.instructions.length !== base.instructions.length) return null;
  if (![change.p50Ms, base.p50Ms].every((time) => Number.isFinite(time) && time > 0)) return null;
  return { change, base, instructionsKept: middle(change.instructions.map((count, round) => count / base.instructions[round])), timeKept: change.p50Ms / base.p50Ms };
}

export const percent = (share) => `${(share * 100).toFixed(2)}%`;

export function reportOf(stdout) {
  const line = stdout.split('\n').filter((text) => text.trim().startsWith('{')).at(-1);
  try {
    const read = JSON.parse(line);
    return read && typeof read === 'object' && !Array.isArray(read) ? read : null;
  } catch {
    return null;
  }
}

export function ranOnce(box, command, cwd) {
  const ran = spawnSync(command[0], command.slice(1), { cwd, env: box.env, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  return { status: ran.status, stdout: ran.stdout ?? '', said: redacted(box, `${ran.error?.message ?? ''}${(ran.stderr ?? '').slice(-1500)}`) };
}
