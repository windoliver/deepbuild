// The alone block's folders run side by side, each in a shard of its own, and the folders lanes.mjs names exclusive one
// at a time with nothing beside them; the files it names slow wait for --slow unless the change touches them. Reached
// by running `node scripts/affected.mjs` in a scratch repository holding this checkout's scripts, with a sandboxed HOME
// (so the throttle table and the shards are the sandbox's) and a cargo stub. The merge base's scripts are the wrong
// program: they run the alone block one file at a time, so its folders never overlap.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const lanes = await import(join(CHECKOUT, 'scripts/lanes.mjs'));
// Two alone folders and one exclusive one, taken from lanes.mjs's lists, so the probes sit where the lists put them.
const [A, B] = lanes.alone.filter((entry) => entry.endsWith('/') && !lanes.listed(lanes.timed, `${entry}x.test.mjs`)).slice(0, 2);
const EXCLUSIVE = lanes.exclusive[0];
// One under tests/, so a change beside it builds no package.
const SLOW = lanes.slow.find((file) => file.startsWith('tests/acceptance/'));

// A probe notes when it ran, where, and under which grant, and holds its place for `ms`.
const probe = (name, ms) => `import { appendFileSync } from 'node:fs';
import test from 'node:test';
const note = (event) => appendFileSync(process.env.T_SHARDS_EVENTS, JSON.stringify({ name: ${JSON.stringify(name)}, event, t: Date.now(), cwd: process.cwd(), throttle: process.env.DEEP_THROTTLE ?? null }) + '\\n');
test(${JSON.stringify(name)}, async () => { note('start'); await new Promise((done) => setTimeout(done, ${ms})); note('end'); });
`;

function scene(t, scripts = join(CHECKOUT, 'scripts'), extra = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-shards-')));
  const home = join(dir, 'home'), tree = join(dir, 'tree'), bin = join(dir, 'bin');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const folder of [home, tree, bin]) mkdirSync(folder);
  cpSync(scripts, join(tree, 'scripts'), { recursive: true });
  const lint = lanes.checks.find(({ name }) => name === 'lint').commands.map(([, script]) => script).filter((script) => script?.startsWith('scripts/'));
  for (const script of lint) writeFileSync(join(tree, script), '// a lint stub\n');
  writeFileSync(join(tree, 'scripts/known-failures.json'), `${JSON.stringify({ failures: {}, lint: {}, timing: [] })}\n`);
  symlinkSync(join(CHECKOUT, 'node_modules'), join(tree, 'node_modules'));
  const files = { [`${A}shard-a.test.mjs`]: probe('a', 1500), [`${B}shard-b.test.mjs`]: probe('b', 1500), [`${EXCLUSIVE}shard-x.test.mjs`]: probe('x', 300) };
  if (SLOW) files[SLOW] = probe('slow', 0);
  for (const [path, text] of Object.entries({ '.gitignore': 'node_modules\n', ...files })) {
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    writeFileSync(join(tree, path), text);
  }
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: tree, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  writeFileSync(join(bin, 'cargo'), '#!/bin/sh\nif [ "$1" = metadata ]; then echo \'{"packages":[],"workspace_members":[],"version":1}\'; fi\nexit 0\n');
  chmodSync(join(bin, 'cargo'), 0o755);
  const env = { ...process.env, HOME: home, PATH: `${bin}${delimiter}${process.env.PATH}`, T_SHARDS_EVENTS: join(dir, 'events.jsonl'), DEEP_SHARDS: '2', DEEP_TEST_SHARD_FLOOR: '0', ...extra };
  for (const name of ['DEEP_THROTTLE', 'NODE_TEST_CONTEXT', 'CARGO_TARGET_DIR']) delete env[name];
  const affected = (args) => new Promise((done) => {
    const child = spawn(process.execPath, ['scripts/affected.mjs', ...args], { cwd: tree, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    t.after(() => { if (child.exitCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {} });
    child.on('close', (status) => done({ status, out }));
  });
  const events = () => (existsSync(env.T_SHARDS_EVENTS) ? readFileSync(env.T_SHARDS_EVENTS, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
  const at = (name, event) => events().find((e) => e.name === name && e.event === event);
  return { tree, files: Object.keys(files), affected, events, at, home };
}

test('two alone folders run at once, each in a shard of its own at a path apart from the worktree, under one test grant', async (t) => {
  assert.ok(A && B && EXCLUSIVE, 'lanes.mjs names no two alone folders and an exclusive one');
  const s = scene(t);
  const run = await s.affected([`${A}shard-a.test.mjs`, `${B}shard-b.test.mjs`]);
  const all = `${run.out}\n${JSON.stringify(s.events(), null, 1)}`;
  const [a, b] = [s.at('a', 'start'), s.at('b', 'start')];
  assert.ok(a && b && s.at('a', 'end') && s.at('b', 'end'), `both probes did not run\n${all}`);
  assert.ok(a.t < s.at('b', 'end').t && b.t < s.at('a', 'end').t, `the two alone folders ran one after the other, not at once\n${all}`);
  assert.notEqual(a.cwd, b.cwd, `both folders ran in one place\n${all}`);
  for (const probeRun of [a, b]) assert.ok(!probeRun.cwd.startsWith(s.tree) && probeRun.cwd.startsWith(join(s.home, 'deepbuild-shards')), `a folder ran outside a shard: ${probeRun.cwd}\n${all}`);
  assert.equal(a.throttle, b.throttle, `the shards held more than one grant\n${all}`);
  assert.match(String(a.throttle), /^test:/, `the shards ran under no test grant\n${all}`);
  assert.match(run.out, /^PASS affected: /m, all);
});

test('with the disk under its floor, no shard is taken and the alone folders run one at a time in the worktree', async (t) => {
  const s = scene(t, undefined, { DEEP_TEST_SHARD_FLOOR: String(Number.MAX_SAFE_INTEGER) });
  const run = await s.affected([`${A}shard-a.test.mjs`, `${B}shard-b.test.mjs`]);
  const all = `${run.out}\n${JSON.stringify(s.events(), null, 1)}`;
  const [a, b] = [s.at('a', 'start'), s.at('b', 'start')];
  assert.ok(a && b, `both probes did not run\n${all}`);
  for (const probeRun of [a, b]) assert.equal(probeRun.cwd, s.tree, `a folder ran in a shard past the disk's floor\n${all}`);
  assert.ok(s.at('a', 'end').t <= b.t || s.at('b', 'end').t <= a.t, `the folders ran at once in the worktree\n${all}`);
  assert.match(run.out, /^SHARD 1 not used: /m, all);
  assert.match(run.out, /^PASS affected: /m, all);
});

test('an exclusive folder runs with nothing beside it, after the shards, in the worktree', async (t) => {
  const s = scene(t);
  const run = await s.affected([`${A}shard-a.test.mjs`, `${B}shard-b.test.mjs`, `${EXCLUSIVE}shard-x.test.mjs`]);
  const all = `${run.out}\n${JSON.stringify(s.events(), null, 1)}`;
  const x = s.at('x', 'start');
  assert.ok(x, `the exclusive probe did not run\n${all}`);
  assert.equal(x.cwd, s.tree, `the exclusive folder ran outside the worktree\n${all}`);
  for (const name of ['a', 'b']) assert.ok(s.at(name, 'end').t <= x.t, `${name} ran beside the exclusive folder\n${all}`);
  assert.match(run.out, /^PASS affected: /m, all);
});

test('a slow file is left INCONCLUSIVE, never PASS, unless --slow runs it or the change touches it', { skip: !SLOW && 'lanes.mjs names no slow file' }, async (t) => {
  const s = scene(t);
  // A helper beside it that it imports: a change to the helper reaches the slow file without touching it.
  writeFileSync(join(s.tree, dirname(SLOW), 'shard-helper.mjs'), 'export const h = 1;\n');
  writeFileSync(join(s.tree, SLOW), `import './shard-helper.mjs';\n${readFileSync(join(s.tree, SLOW), 'utf8')}`);
  const helper = join(dirname(SLOW), 'shard-helper.mjs');
  const reached = await s.affected([helper]);
  assert.equal(s.at('slow', 'start'), undefined, `a slow file the change only reaches ran without --slow\n${reached.out}`);
  assert.match(reached.out, /^INCONCLUSIVE affected: /m, `with a slow file unrun, the run reads otherwise\n${reached.out}`);
  assert.ok(reached.out.split('\n').some((line) => line.startsWith('INCONCLUSIVE') && line.includes(SLOW)), `no INCONCLUSIVE line names the unrun slow file\n${reached.out}`);
  assert.notEqual(reached.status, 0, reached.out);
  const ran = await s.affected(['--slow', helper]);
  assert.ok(s.at('slow', 'start'), `--slow did not run the slow file\n${ran.out}`);
  assert.match(ran.out, /^PASS affected: /m, ran.out);
  const touched = await s.affected([SLOW]);
  assert.equal(s.events().filter((e) => e.name === 'slow' && e.event === 'start').length, 2, `the change's own slow file did not run\n${touched.out}`);
  assert.match(touched.out, /^PASS affected: /m, touched.out);
});

test('the merge base\'s scripts, the wrong program, run the two alone folders one after the other', async (t) => {
  const base = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: CHECKOUT, encoding: 'utf8' }).stdout.trim();
  const folder = mkdtempSync(join(tmpdir(), 'deep-shards-base-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  execFileSync('sh', ['-c', 'git -C "$1" archive "$2" scripts | tar -xf - -C "$3"', 'sh', CHECKOUT, base, folder]);
  const s = scene(t, join(folder, 'scripts'));
  await s.affected([`${A}shard-a.test.mjs`, `${B}shard-b.test.mjs`]);
  const all = JSON.stringify(s.events(), null, 1);
  assert.ok(s.at('a', 'start') && s.at('b', 'start'), `the merge base ran no probe\n${all}`);
  const overlap = s.at('a', 'start').t < s.at('b', 'end').t && s.at('b', 'start').t < s.at('a', 'end').t;
  assert.equal(overlap, false, `the merge base ran the alone folders at once, so this test can't tell it from the change\n${all}`);
});
