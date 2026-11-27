import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import { test, before } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const TARGET = join(CHECKOUT, 'target', 'acceptance-2784');
const HOOK = join(TARGET, 'debug', 'deep-hook');
const REAL_HOOK = join(TARGET, 'real-deep-hook-2784');
const TEST = 'hooks_spooling_on_a_stalled_disk_leave_one_sync_and_the_spool_s_makers_running';
const LONG = { timeout: 40 * 60_000 };

const { cargoResults, classify, crates } = await import(pathToFileURL(join(CHECKOUT, 'scripts/affected.mjs')).href);
const { readSkips, timed } = await import(pathToFileURL(join(CHECKOUT, 'scripts/lanes.mjs')).href);

const cargo = (args) => spawnSync('cargo', args, { cwd: CHECKOUT, encoding: 'utf8', maxBuffer: 1 << 28, timeout: LONG.timeout });

const REAL_DD = process.env.PATH.split(delimiter).map((dir) => join(dir, 'dd')).find((path) => existsSync(path));

let executable;
before(() => {
  if (!REAL_DD || !/coreutils/.test(spawnSync(REAL_DD, ['--version'], { encoding: 'utf8' }).stdout ?? ''))
    throw new Error(`BLOCKED: the dd on PATH (${REAL_DD ?? 'none'}) isn't GNU dd, which #2784's criteria are about`);
  const built = cargo(['test', '--locked', '-p', 'deep-hook', '--test', 'busy_disk', '--no-run', '--message-format=json', '--target-dir', TARGET]);
  executable = (built.stdout ?? '').split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line))
    .find((message) => message.reason === 'compiler-artifact' && message.target?.name === 'busy_disk' && message.executable)?.executable;
  if (built.status !== 0 || !executable) throw new Error(`BLOCKED: cargo couldn't build busy_disk: ${(built.stdout ?? '').split('\n').filter(Boolean).slice(-5).join(' | ')} ${(built.stderr ?? '').split('\n').filter(Boolean).slice(-5).join(' | ')}`);
  const magic = Buffer.alloc(4);
  const fd = openSync(HOOK, 'r');
  readSync(fd, magic, 0, 4, 0);
  closeSync(fd);
  if (magic.toString('latin1') !== '\x7fELF') throw new Error(`BLOCKED: ${HOOK} isn't the deep-hook cargo built`);
  rmSync(REAL_HOOK, { force: true });
  copyFileSync(HOOK, REAL_HOOK);
  chmodSync(REAL_HOOK, 0o755);
}, LONG);

const gnuDd = (events, writes) => `#!${process.execPath}
const { spawnSync } = require('node:child_process');
const { appendFileSync, statSync, truncateSync } = require('node:fs');
appendFileSync(${JSON.stringify(events)}, 'D\\n');
const args = process.argv.slice(2);
const of = args.findLast((arg) => arg.startsWith('of='))?.slice(3);
const record = { args, of };
let ok = args.some((arg) => arg.startsWith('count='));
if (!ok) record.refused = 'no count= operand, so dd would copy /dev/zero without end';
let said = '';
if (ok) {
  const check = spawnSync(${JSON.stringify(REAL_DD)}, args.map((arg) => (arg.startsWith('count=') ? 'count=0' : arg)), { encoding: 'utf8' });
  record.check = { status: check.status, stderr: check.stderr.trim() };
  ok = check.status === 0;
  said = check.stderr;
}
if (ok) {
  const size = spawnSync(${JSON.stringify(REAL_DD)}, [...args.filter((arg) => !/^(?:of|conv|oflag|seek|status)=/.test(arg)), 'of=/dev/null'], { encoding: 'utf8' });
  record.bytes = Number(size.stderr.match(/^(\\d+) bytes/m)?.[1]);
  ok = size.status === 0 && Number.isFinite(record.bytes) && Boolean(of);
  said = size.stderr;
  if (ok) {
    truncateSync(of, record.bytes);
    record.size = statSync(of).size;
  }
}
record.status = ok ? 0 : 1;
appendFileSync(${JSON.stringify(writes)}, JSON.stringify(record) + '\\n');
process.stderr.write(said);
process.exit(record.status);
`;

function runBusyDisk(t, { dd, hook }) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2784-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const events = join(dir, 'events.log'), writes = join(dir, 'writes.log'), hookLog = join(dir, 'hook.log'), log = join(dir, 'cargo.log');
  writeFileSync(join(bin, 'dd'), dd(events, writes));
  chmodSync(join(bin, 'dd'), 0o755);
  rmSync(HOOK, { force: true });
  writeFileSync(HOOK, hook(events, hookLog));
  chmodSync(HOOK, 0o755);
  writeFileSync(log, `     Running tests/busy_disk.rs (${relative(CHECKOUT, executable)})\n`);
  const descriptor = openSync(log, 'a');
  let result;
  try {
    result = spawnSync(executable, [TEST], { cwd: join(CHECKOUT, 'crates/deep-hook'), env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` }, stdio: ['ignore', descriptor, descriptor], timeout: LONG.timeout });
  } finally {
    closeSync(descriptor);
  }
  const output = readFileSync(log, 'utf8');
  const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);
  const order = lines(events).join('');
  const written = lines(writes).map((line) => JSON.parse(line));
  const hooks = lines(hookLog);
  t.diagnostic(`busy_disk exited ${result.status}; dd ran ${order.split('D').length - 1} times, the hook ${order.split('H').length - 1}; order ${order}`);
  for (const line of output.split('\n').filter((line) => /^test |panicked|still running|proves nothing|test result/.test(line))) t.diagnostic(line);
  if (!readFileSync(HOOK, 'utf8').includes(events)) throw new Error('BLOCKED: the stand-in hook was replaced before the test ran it');
  if (!order.includes('H')) throw new Error(`BLOCKED: busy_disk's second test never ran the stand-in hook (it exited ${result.status}): ${output.split('\n').filter(Boolean).slice(-5).join(' | ')}`);
  const baseline = JSON.parse(readFileSync(join(CHECKOUT, 'scripts/known-failures.json'), 'utf8'));
  const results = cargoResults(output, result.status, crates(CHECKOUT));
  const { covered, open } = readSkips(results.skips ?? [], baseline.skips, timed);
  const { known, fresh, unsure } = classify([...results.failures, ...open], [], baseline, 0);
  const read = [
    ...known.map(({ id, message }) => `KNOWN ${id}: ${message}`),
    ...unsure.map(({ id, state, message }) => `${state} ${id}${message ? `: ${message}` : ''}`),
    ...covered.map(({ id, note }) => `LISTED ${id}: ${note}`),
    ...fresh.map(({ id, message }) => `NEW FAIL ${id}${message ? `: ${message}` : ''}`),
    ...results.passed.map((id) => `PASS ${id}`),
  ];
  for (const line of read) t.diagnostic(`affected.mjs: ${line}`);
  return { output, status: result.status, order, written, hooks, lines: read, known, fresh, unsure, covered, passed: results.passed };
}

const ours = (id) => id.includes('busy_disk');

test('AC1 #2784.3c3e909f On Linux the writers really write: GNU dd accepts each writer\'s operands, each writer\'s file is written with 1 GB, and the hooks spool after the writers start', LONG, (t) => {
  const hook = (events, hookLog) => `#!/bin/sh\nprintf 'H\\n' >> '${events}'\n'${REAL_HOOK}' "$@"\nstatus=$?\nset -- "$HOME"/.deepbuild/spool/*\nn=0\n[ -e "$1" ] && n=$#\nprintf '%s %s\\n' "$status" "$n" >> '${hookLog}'\nexit $status\n`;
  const run = runBusyDisk(t, { dd: gnuDd, hook });
  for (const write of run.written) t.diagnostic(`dd ${write.args.join(' ')} → ${write.refused ?? write.check?.stderr ?? ''}${write.bytes !== undefined ? ` ${write.bytes} bytes, file ${write.size}` : ''}`);
  assert.ok(run.written.length > 0, 'busy_disk\'s second test started no writer');
  const refused = run.written.filter((write) => write.status !== 0);
  assert.deepEqual(refused.map((write) => `${write.args.join(' ')}: ${write.refused ?? write.check?.stderr ?? 'no byte count'}`), [], 'GNU dd refused writers\' operands, so on Linux those writers write nothing');
  for (const write of run.written) {
    assert.ok(write.bytes >= 1e9, `a writer asked GNU dd for ${write.bytes} bytes, not 1 GB: ${write.args.join(' ')}`);
    assert.equal(write.size, write.bytes, `writer ${write.of}'s file is ${write.size} bytes, not the ${write.bytes} its operands write`);
  }
  const bursts = run.order.match(/D+H+/g) ?? [];
  assert.equal(bursts.join(''), run.order, `writers and hooks didn't start in bursts of writers, then hooks: ${run.order}`);
  for (const burst of bursts) assert.equal(burst.match(/D+/)[0].length, 4, `a burst started ${burst.match(/D+/)[0].length} writers, not four: ${run.order}`);
  const files = bursts.map((_, index) => new Set(run.written.slice(index * 4, index * 4 + 4).map((write) => write.of)));
  for (const burst of files) assert.equal(burst.size, 4, `a burst's four writers didn't each write a file of its own: ${[...burst].join(', ')}`);
  assert.ok(run.hooks.length > 0 && run.hooks.every((line) => Number(line.split(' ')[1]) > 0), `a hook left nothing in its spool folder, so it didn't spool: ${run.hooks.join(' | ')}`);
  assert.ok(!run.unsure.some(({ id }) => ours(id)), `a run whose writers all wrote read as unproven: ${run.lines.join(' | ')}`);
  assert.ok(run.passed.some(ours) || run.fresh.some(({ id }) => ours(id)), `busy_disk's second test gave no result: ${run.lines.join(' | ')}`);
});

const failing = (events) => `#!/bin/sh\nprintf 'D\\n' >> '${events}'\nprintf '%s\\n' "dd: invalid number: '1m'" >&2\nexit 1\n`;
const empty = (events) => `#!/bin/sh\nprintf 'D\\n' >> '${events}'\nfor arg; do case $arg in of=*) : > "\${arg#of=}";; esac; done\nprintf '0+0 records in\\n0+0 records out\\n0 bytes copied, 0 s, 0 B/s\\n' >&2\nexit 0\n`;
const quiet = (events) => `#!/bin/sh\nprintf 'H\\n' >> '${events}'\ncat > /dev/null\nexit 0\n`;

for (const [name, dd] of [['a dd that fails', failing], ['a dd that writes nothing', empty]])
  test(`AC2 #2784.bc2bd4cc Writers that wrote nothing read INCONCLUSIVE: given ${name}, affected.mjs reports busy_disk INCONCLUSIVE with its reason, never PASS`, LONG, (t) => {
    const run = runBusyDisk(t, { dd, hook: quiet });
    assert.ok(run.order.includes('D'), 'busy_disk\'s second test started no writer');
    assert.ok(!run.passed.some(ours), `a run whose writers wrote nothing passed, but it never loaded the disk: ${run.lines.join(' | ')}`);
    assert.ok(!run.fresh.some(({ id }) => ours(id)), `a run whose writers wrote nothing read as the hooks failing: ${run.lines.join(' | ')}`);
    assert.ok(!run.known.some(({ id }) => ours(id)), `a run whose writers wrote nothing read as a failure main already has: ${run.lines.join(' | ')}`);
    const reading = run.unsure.find(({ id }) => ours(id));
    assert.ok(reading, `affected.mjs printed no INCONCLUSIVE line for busy_disk: ${run.lines.join(' | ')}`);
    assert.equal(reading.state, 'INCONCLUSIVE', `busy_disk's run read ${reading.state}, not INCONCLUSIVE`);
    const reason = `${reading.id} ${reading.message ?? ''}`.replaceAll(TEST, '');
    assert.match(reason, /\bdd\b|writ|wrote|load|busy|proves nothing/i, `busy_disk's INCONCLUSIVE line names no reason: ${reading.id}: ${reading.message}`);
  });

for (const [name, dd] of [['', gnuDd], [' even when the writers wrote nothing', empty]])
test(`AC3 #2784.71e24b92 More than three syncs left behind still fails the test${name}: hooks that each leave a spool-sync running read as a NEW FAIL, not INCONCLUSIVE or PASS`, LONG, (t) => {
  let pids = '';
  const hook = (events, hookLog) => {
    pids = hookLog;
    return `#!/bin/sh\nprintf 'H\\n' >> '${events}'\ncat > /dev/null\n'${process.execPath}' -e 'setTimeout(() => {}, 120000)' spool-sync "$HOME/.deepbuild/spool" < /dev/null > /dev/null 2>&1 &\nchild=$!\nprintf '%s\\n' "$child" >> '${hookLog}'\ntries=0\nwhile [ $tries -lt 100 ]; do\n  case "$(tr '\\0' ' ' < /proc/$child/cmdline 2>/dev/null)" in *spool-sync*) break;; esac\n  tries=$((tries + 1)); sleep 0.05\ndone\nexit 0\n`;
  };
  let run;
  try {
    run = runBusyDisk(t, { dd, hook });
  } finally {
    for (const pid of (existsSync(pids) ? readFileSync(pids, 'utf8') : '').split('\n').filter(Boolean).map(Number))
      try { process.kill(pid, 'SIGKILL'); } catch {}
  }
  assert.ok(run.hooks.length > 3, `the stand-in hooks left ${run.hooks.length} syncs, not more than three`);
  assert.ok(!run.passed.some(ours), `busy_disk passed with ${run.hooks.length} syncs left behind: ${run.lines.join(' | ')}`);
  assert.ok(!run.unsure.some(({ id }) => ours(id)), `a run that left syncs behind read as unproven, not as failing: ${run.lines.join(' | ')}`);
  assert.ok(run.fresh.some(({ id, state }) => ours(id) && state === 'FAIL'), `affected.mjs printed no NEW FAIL line for busy_disk: ${run.lines.join(' | ')}`);
});
