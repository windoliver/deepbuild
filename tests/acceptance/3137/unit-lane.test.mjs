// #3137 AC1, the owner's decision on the preflight's unit lane (#3137.b240111e): the lane's alone block runs as
// scripts/affected.mjs runs it, through that script's own entry: its folders side by side, each in a shard of its own
// on the run's one jobserver, then the exclusive folders one at a time in the worktree, then the timed files one at a
// time under a timed grant, the slow files with the rest, nothing else (no lint, no other block), and the lane's
// evidence record still holds each test's state (design: Parallel proof, section 7a, "The preflight's alone block";
// How we know version 0 works, "The preflight's unit lane and its budget").
//
// Reached through runLanes in scripts/lanes.mjs, as scripts/preflight.mjs reaches it through checks.mjs, over the unit
// lane with its alone command alone (aloneCommand where lanes.mjs exports it), in a scratch repository holding this
// checkout's scripts/ and runner config, with a sandboxed HOME (so the throttle table, the shards and the lane records
// are the sandbox's) and a cargo stub. The probes are vitest files at paths lanes.mjs's own lists give: two alone
// folders, one of them holding a slow file and a planted failing test, an exclusive folder and a timed file. The merge
// base's lanes.mjs is the wrong program: its unit lane runs the alone block as one vitest run in the worktree, one file
// at a time, so no two of its folders overlap.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ID = '#3137.b240111e';
const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const lanes = await import(join(CHECKOUT, 'scripts/lanes.mjs'));
const { alone, byHand, exclusive, listed, ownLane, slow, timed } = lanes;

// The probes' places, from lanes.mjs's lists. An entry a suite's lane.json adds isn't alone in the scratch repository,
// which holds no lane.json, so only the lists' own folders are taken.
const entryOf = (file) => alone.find((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));
const plain = (entry) => Boolean(entry) && entry.endsWith('/') && entry.startsWith('tests/acceptance/') && !existsSync(join(CHECKOUT, entry, 'lane.json')) && !listed(exclusive, entry) && !listed(byHand, entry);
const own = (file) => !listed(timed, file) && !listed(slow, file) && !listed(byHand, file) && !listed(ownLane, file) && !/\.live\.test\./.test(file);
// A slow vitest file in an alone folder, and that folder.
const SLOW = slow.find((file) => file.endsWith('.test.ts') && !listed(timed, file) && !listed(byHand, file) && !listed(exclusive, file) && plain(entryOf(file)));
const A = SLOW && entryOf(SLOW);
// A timed vitest file in another alone folder.
const TIMED = timed.find((file) => file.endsWith('.test.ts') && !listed(slow, file) && !listed(byHand, file) && !listed(exclusive, file) && !/\.live\.test\./.test(file) && plain(entryOf(file)) && entryOf(file) !== A);
// A third alone folder, and an exclusive one.
const B = alone.find((entry) => plain(entry) && entry !== A && entry !== (TIMED && entryOf(TIMED)) && own(`${entry}t3137-b.test.ts`));
const X = exclusive.find((entry) => entry.endsWith('/'));
const FILES = { a: `${A}t3137-a.test.ts`, slow: SLOW, fails: `${A}t3137-fails.test.ts`, b: `${B}t3137-b.test.ts`, x: `${X}t3137-x.test.ts`, timed: TIMED, parallel: 'tests/t3137-parallel.test.ts' };

// A vitest probe notes when it started and ended, where, under which grant and with which jobserver. a and b each wait
// up to 90 s for the other to start, so two folders that run at once always overlap, however their starts fall.
const probe = (name, body = '') => `import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
const EVENTS = process.env.T_3137_EVENTS ?? '';
const note = (event) => appendFileSync(EVENTS, JSON.stringify({ name: ${JSON.stringify(name)}, event, t: Date.now(), cwd: process.cwd(), throttle: process.env.DEEP_THROTTLE ?? null, jobserver: process.env.CARGO_MAKEFLAGS ?? null }) + '\\n');
const started = (other) => existsSync(EVENTS) && readFileSync(EVENTS, 'utf8').split('\\n').some((line) => {
  try { const seen = JSON.parse(line); return seen.name === other && seen.event === 'start'; } catch { return false; }
});
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
test(${JSON.stringify(name)}, async () => {
  note('start');
  ${body}
}, 600_000);
`;
const meets = (other) => `for (const end = Date.now() + 90_000; Date.now() < end && !started(${JSON.stringify(other)});) await sleep(100);
  await sleep(1000);
  note('end');`;
const PROBES = {
  a: probe('a', meets('b')),
  b: probe('b', meets('a')),
  slow: probe('slow', "note('end');"),
  fails: probe('fails', "note('end');\n  expect(1, 'the planted failure').toBe(2);"),
  x: probe('x', "await sleep(300);\n  note('end');"),
  timed: probe('timed', "note('end');"),
  parallel: probe('parallel', "note('end');"),
};

// A lint script's stand-in notes that it ran when it is run, never when it is imported.
const lintStub = (script) => `import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url) && process.env.T_3137_EVENTS) appendFileSync(process.env.T_3137_EVENTS, JSON.stringify({ name: 'lint', event: 'start', script: ${JSON.stringify(script)}, t: Date.now() }) + '\\n');
`;

function scene(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3137-lane-')));
  const home = join(dir, 'home'), tree = join(dir, 'tree'), bin = join(dir, 'bin'), events = join(dir, 'events.jsonl');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const folder of [home, tree, bin]) mkdirSync(folder);
  cpSync(join(CHECKOUT, 'scripts'), join(tree, 'scripts'), { recursive: true });
  const lint = lanes.checks.find(({ name }) => name === 'lint').commands.map(([, script]) => script).filter((script) => script?.startsWith('scripts/'));
  for (const script of new Set(lint)) writeFileSync(join(tree, script), lintStub(script));
  writeFileSync(join(tree, 'scripts/known-failures.json'), `${JSON.stringify({ failures: {}, lint: {}, timing: [] })}\n`);
  symlinkSync(join(CHECKOUT, 'node_modules'), join(tree, 'node_modules'));
  const copies = Object.fromEntries(['package.json', 'vitest.config.ts', 'tests/vitest-setup.ts'].map((path) => [path, readFileSync(join(CHECKOUT, path), 'utf8')]));
  const files = { '.gitignore': 'node_modules\n', ...copies, ...Object.fromEntries(Object.entries(FILES).map(([name, path]) => [path, PROBES[name]])) };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    writeFileSync(join(tree, path), text);
  }
  const env = { ...process.env, HOME: home, PATH: [bin, '/opt/homebrew/opt/rustup/bin', process.env.PATH].join(delimiter), T_3137_EVENTS: events, DEEP_SHARDS: '2', DEEP_TEST_SHARD_FLOOR: '0' };
  for (const name of Object.keys(env)) if (/^GIT_/.test(name)) delete env[name];
  for (const name of ['DEEP_THROTTLE', 'NODE_TEST_CONTEXT', 'CARGO_TARGET_DIR', 'DEEP_PREFLIGHT', 'DEEP_BIN_DIR', 'DEEP_OPEN_ISSUES', 'DEEP_THROTTLE_TABLE', 'DEEP_THROTTLE_READINGS', 'CARGO_MAKEFLAGS']) delete env[name];
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: tree, env, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  // Its origin/main is its HEAD, as on main itself: the change is empty.
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  writeFileSync(join(bin, 'cargo'), '#!/bin/sh\nif [ "$1" = metadata ]; then echo \'{"packages":[],"workspace_members":[],"version":1}\'; fi\nexit 0\n');
  chmodSync(join(bin, 'cargo'), 0o755);
  // runLanes over the unit lane with only its alone command, from the scratch repository's own lanes.mjs.
  const driver = `const lanes = await import(${JSON.stringify(pathToFileURL(join(tree, 'scripts/lanes.mjs')).href)});
const unit = lanes.checks.find(({ name }) => name === 'unit');
const command = lanes.aloneCommand ?? unit.commands.find((args) => args.includes('--no-file-parallelism'));
console.log('T3137 ' + JSON.stringify({ inLane: unit.commands.includes(command) }));
process.exitCode = lanes.runLanes([{ ...unit, commands: [command] }], { cwd: ${JSON.stringify(tree)} });
`;
  const run = () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', driver], { cwd: tree, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {} });
    return new Promise((done) => child.on('close', (status) => done({ status, out })));
  };
  const all = () => (existsSync(events) ? readFileSync(events, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
  const at = (name, event) => all().find((seen) => seen.name === name && seen.event === event);
  return { home, tree, run, all, at };
}

test(`${ID} the preflight's unit lane runs its alone block in shards, two folders at once on one jobserver, then the exclusive folder, then the timed file under a timed grant, with the slow file, and its record holds each test's state`, { timeout: 45 * 60_000 }, async (t) => {
  assert.ok(A && B && X && SLOW && TIMED, `lanes.mjs's lists give no place for a probe: ${JSON.stringify(FILES)}`);
  for (const name of ['a', 'b', 'fails', 'x']) assert.ok(own(FILES[name]), `${FILES[name]} is on a list of lanes.mjs's own`);
  const s = scene(t);
  const { status, out } = await s.run();
  const shown = () => `${out.length > 12_000 ? `…${out.slice(-12_000)}` : out}\n${JSON.stringify(s.all(), null, 1)}`;
  assert.match(out, /^T3137 \{"inLane":true\}$/m, `the unit lane in lanes.mjs's checks doesn't hold its alone command\n${shown()}`);
  for (const name of ['a', 'b', 'slow', 'fails', 'x', 'timed']) assert.ok(s.at(name, 'start'), `${FILES[name]} didn't run (status ${status})\n${shown()}`);
  const [a, b] = [s.at('a', 'start'), s.at('b', 'start')];
  const [aEnd, bEnd] = [s.at('a', 'end'), s.at('b', 'end')];
  assert.ok(aEnd && bEnd && a.t < bEnd.t && b.t < aEnd.t, `the two alone folders ran one after the other, not side by side\n${shown()}`);
  const shards = join(s.home, 'deepbuild-shards');
  for (const seen of [a, b]) assert.ok(seen.cwd.startsWith(`${shards}/`), `an alone folder's file ran in ${seen.cwd}, not in a shard under ${shards}\n${shown()}`);
  assert.notEqual(a.cwd, b.cwd, `the two alone folders ran in one shard\n${shown()}`);
  assert.ok(a.jobserver && a.jobserver === b.jobserver, `the shards didn't share the run's one jobserver: ${a.jobserver} and ${b.jobserver}\n${shown()}`);
  const x = s.at('x', 'start');
  assert.equal(x.cwd, s.tree, `the exclusive folder's file ran outside the worktree\n${shown()}`);
  for (const name of ['a', 'b', 'slow', 'fails']) assert.ok(s.at(name, 'end').t <= x.t, `${FILES[name]} ran beside the exclusive folder's file\n${shown()}`);
  const timedRun = s.at('timed', 'start');
  assert.equal(timedRun.cwd, s.tree, `the timed file ran outside the worktree\n${shown()}`);
  for (const name of ['a', 'b', 'slow', 'fails', 'x']) assert.ok(s.at(name, 'end').t <= timedRun.t, `${FILES[name]} ran beside or after the timed file\n${shown()}`);
  assert.match(String(timedRun.throttle), /^timed:/, `the timed file ran under no timed grant\n${shown()}`);
  assert.equal(s.at('parallel', 'start'), undefined, `the alone command ran a file of the parallel block\n${shown()}`);
  assert.deepEqual(s.all().filter(({ name }) => name === 'lint').map(({ script }) => script), [], `the alone command ran lint scripts\n${shown()}`);
  // The lane's evidence record, as writeRecord keeps it in the sandbox's HOME.
  const folder = join(s.home, '.deepbuild', 'lanes');
  const records = existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith('-unit.json')) : [];
  assert.equal(records.length, 1, `the unit lane left ${records.length} evidence records in ${folder}\n${shown()}`);
  const record = JSON.parse(readFileSync(join(folder, records[0]), 'utf8'));
  assert.equal(record.lane, 'unit', JSON.stringify(record, null, 1));
  assert.equal(record.state, 'FAIL', `the lane holding a failing test reads ${record.state}\n${JSON.stringify(record, null, 1)}\n${shown()}`);
  assert.notEqual(status, 0, `runLanes exited 0 over a failing test\n${shown()}`);
  const stateOf = (name) => record.tests?.find(({ id }) => id.startsWith(`${FILES[name]} › `) && id.endsWith(name))?.state;
  for (const name of ['a', 'b', 'slow', 'x', 'timed']) assert.equal(stateOf(name), 'PASS', `the record holds ${FILES[name]} › ${name} as ${stateOf(name)}\n${JSON.stringify(record.tests, null, 1)}`);
  assert.equal(stateOf('fails'), 'FAIL', `the record holds the planted failure ${FILES.fails} › fails as ${stateOf('fails')}\n${JSON.stringify(record.tests, null, 1)}`);
});
