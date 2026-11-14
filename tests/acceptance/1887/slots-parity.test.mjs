// #1887: `deep.schedule.read`, which the runtime serves, has its entry in the published extension API, and the slot
// check's parity (scripts/slots-check.mjs) compares every method in the runtime's table
// (packages/extension-host/runtime/deep.mjs) with the published API (packages/contracts/extension-api.json), both ways,
// not only the `deep.register*` ones. One test per criterion, through the check as it is run: `node
// scripts/slots-check.mjs`, its `--api <file>` flag, its exit status and its `FAIL slots:` / `PASS slots:` lines.
// The planted runtime method is made on a copy of the checkout's scripts/ and packages/extension-host in a temp
// folder; nothing in the checkout is written. README: readings, how to run, what a machine needs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const CHECK = 'scripts/slots-check.mjs';
const API_FILE = 'packages/contracts/extension-api.json';
const RUNTIME = 'packages/extension-host/runtime/deep.mjs';
// The issue's method: served by the runtime, absent from the published API at the base.
const METHOD = 'deep.schedule.read';
// The slots the base's check counts in the base's published API, by its own rule: each `deep.register*` entry's
// variants, or 1 when it names none (README, Readings).
const SLOTS = 16;
// The plants. None of the two the tests judge starts with `deep.register`: the base's check already compares those.
const PLANTED_RUNTIME = 'deep.schedule.planted1887';
const PLANTED_PUBLISHED = 'deep.planted1887.published';
// The control: a register method planted beside the runtime plant, which the base's check does name. A run that
// doesn't name it never read the copy's table, and proves nothing about the other plant.
const CONTROL = 'deep.registerPlanted1887';
// One run of the check with every kit, on a loaded machine.
const LIMIT = 15 * 60_000;

const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
function check(args, { script = join(repo, CHECK), cwd = repo } = {}) {
  const run = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', timeout: LIMIT, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(run.error, undefined, `BLOCKED: node ${CHECK} ${args.join(' ')} could not run: ${run.error?.message}`);
  return run;
}
const shown = (run) => `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\n--- stdout\n${run.stdout.trimEnd()}\n--- stderr\n${run.stderr.trimEnd()}`;
const lines = (run, word) => run.stdout.split('\n').filter((line) => line.startsWith(`${word} slots`));
// A method named as itself: `deep.schedule` doesn't name `deep.schedule.read`, nor the other way round.
const names = (line, method) => new RegExp(`(?<![\\w.])${method.replaceAll('.', '\\.')}(?!\\w|\\.\\w)`).test(line);
const lists = (api, method) => api.some((entry) => entry.method === method);
/** The check failed by name: it exits 1, as it does on a finding, and one of its `FAIL slots:` lines names the method. */
function failsNaming(run, method, what) {
  assert.ok(lines(run, 'FAIL').some((line) => names(line, method)), `${what}: no \`FAIL slots:\` line names ${method}:\n${shown(run)}`);
  assert.equal(run.status, 1, `${what}: a line names ${method}, but the check doesn't exit 1:\n${shown(run)}`);
}

let made;
const temp = () => (made ??= realpathSync(mkdtempSync(join(tmpdir(), 'slots1887-'))));
test.after(() => { if (made) rmSync(made, { recursive: true, force: true }); });

/**
 * The published API before `deep.schedule.read` had its entry: the file at the merge base of HEAD and origin/main.
 * Once the work is on main the merge base holds the entry too, and it is the file at the parent of the commit that
 * first wrote the entry. Read from git, never from the checkout.
 */
function baseApi() {
  const base = git('merge-base', 'HEAD', 'origin/main');
  assert.equal(base.status, 0, `BLOCKED: git merge-base HEAD origin/main fails, so the merge base's published API can't be read:\n${base.stderr}`);
  const at = (rev) => {
    const file = git('show', `${rev}:${API_FILE}`);
    assert.equal(file.status, 0, `BLOCKED: git show ${rev}:${API_FILE} fails:\n${file.stderr}`);
    return { rev, text: file.stdout, api: JSON.parse(file.stdout) };
  };
  const merged = at(base.stdout.trim());
  if (!lists(merged.api, METHOD)) return merged;
  const wrote = git('log', '--format=%H', `-S"method": "${METHOD}"`, base.stdout.trim(), '--', API_FILE);
  const first = wrote.stdout.trim().split('\n').filter(Boolean).at(-1);
  assert.ok(wrote.status === 0 && first, `BLOCKED: the merge base ${merged.rev} publishes ${METHOD} and git log finds no commit that wrote its entry, so the API before it can't be read:\n${wrote.stderr}`);
  const before = at(`${first}^`);
  assert.ok(!lists(before.api, METHOD), `BLOCKED: ${API_FILE} at ${before.rev} lists ${METHOD}, so it isn't the API before the entry`);
  return before;
}

// `node scripts/slots-check.mjs` on the checkout as it is, run once for AC1 and AC3.
let plain;
const plainRun = () => (plain ??= check([]));

/**
 * A copy of the checkout the check can run in, with the runtime's table planted: scripts/ and packages/extension-host
 * are copied, so the check and the runtime file it imports are the copy's; every other package, the built ones
 * among them, and everything else at the top is a link to the checkout's. node_modules/@deepbuild/* links to the
 * copy's packages, so `@deepbuild/extension-host` is the copy too.
 */
function plantedTree() {
  const tree = join(temp(), 'tree');
  mkdirSync(join(tree, 'packages'), { recursive: true });
  for (const name of readdirSync(repo)) {
    if (['.git', '.claude', 'packages', 'scripts', 'node_modules'].includes(name)) continue;
    symlinkSync(join(repo, name), join(tree, name));
  }
  cpSync(join(repo, 'scripts'), join(tree, 'scripts'), { recursive: true });
  for (const name of readdirSync(join(repo, 'packages'))) {
    if (name === 'extension-host') cpSync(join(repo, 'packages', name), join(tree, 'packages', name), { recursive: true, filter: (from) => !from.endsWith('/node_modules') });
    else symlinkSync(join(repo, 'packages', name), join(tree, 'packages', name));
  }
  mkdirSync(join(tree, 'node_modules/@deepbuild'), { recursive: true });
  for (const name of readdirSync(join(repo, 'node_modules'))) if (name !== '@deepbuild') symlinkSync(join(repo, 'node_modules', name), join(tree, 'node_modules', name));
  for (const name of readdirSync(join(repo, 'node_modules/@deepbuild'))) symlinkSync(join(tree, 'packages', name), join(tree, 'node_modules/@deepbuild', name));

  // The plants go in after the table's own `deep.schedule.read` entry, each a copy of it under another name.
  const file = join(tree, RUNTIME);
  const text = readFileSync(file, 'utf8');
  const entries = [...text.matchAll(/\{\s*method:\s*(['"])deep\.schedule\.read\1[^{}]*\},?/g)];
  assert.equal(entries.length, 1, `BLOCKED: ${RUNTIME} holds ${entries.length} entries written { method: '${METHOD}', ... }, not the one the plant copies`);
  const [entry] = entries[0];
  const twin = (method) => `${entry.replace(/,$/, '').replace(METHOD, method)},`;
  const end = entries[0].index + entry.length;
  writeFileSync(file, `${text.slice(0, end)}${entry.endsWith(',') ? '' : ','}\n  ${twin(CONTROL)}\n  ${twin(PLANTED_RUNTIME)}${text.slice(end)}`);
  return { tree, file };
}

test("#1887.a39d9bc9 `node scripts/slots-check.mjs` fails on the merge base's published API, naming `deep.schedule.read`, and passes once the entry exists", { timeout: 3 * LIMIT }, async () => {
  // The premise, from the runtime itself: its table serves the method.
  const { API } = await import(pathToFileURL(join(repo, RUNTIME)).href);
  assert.ok(lists(API, METHOD), `BLOCKED: the runtime's table (${RUNTIME}) doesn't list ${METHOD}, which the issue says it serves`);

  const base = baseApi();
  const file = join(temp(), 'base-extension-api.json');
  writeFileSync(file, base.text);
  failsNaming(check(['--api', file]), METHOD, `node ${CHECK} --api <${API_FILE} at ${base.rev}>`);

  const published = JSON.parse(readFileSync(join(repo, API_FILE), 'utf8'));
  assert.equal(published.filter((entry) => entry.method === METHOD).length, 1, `${API_FILE} has one entry for ${METHOD}`);
  const run = plainRun();
  assert.equal(run.status, 0, `node ${CHECK} doesn't pass with the entry published:\n${shown(run)}`);
  assert.deepEqual([lines(run, 'PASS').length, lines(run, 'FAIL').length], [1, 0], `node ${CHECK} exits 0 without one \`PASS slots:\` line and no \`FAIL slots:\` line:\n${shown(run)}`);
});

test("#1887.69370a95 A planted runtime method with no published entry, and a planted published entry the runtime doesn't serve, each fail the check by name", { timeout: 3 * LIMIT }, async () => {
  const published = JSON.parse(readFileSync(join(repo, API_FILE), 'utf8'));
  for (const method of [PLANTED_RUNTIME, PLANTED_PUBLISHED, CONTROL]) assert.ok(!lists(published, method), `BLOCKED: ${API_FILE} already lists ${method}, so it is no plant`);

  // Each half is judged whatever the other did; the test fails with every half that failed.
  const failed = [];
  const half = async (judge) => { try { await judge(); } catch (error) { failed.push(error.message); } };

  // The runtime plant: the copy's table serves it, and the published API, the checkout's own, has no entry for it.
  await half(async () => {
    const { tree, file } = plantedTree();
    const { API } = await import(pathToFileURL(file).href);
    for (const method of [CONTROL, PLANTED_RUNTIME]) assert.ok(lists(API, method), `BLOCKED: the copy's runtime table doesn't list the planted ${method}`);
    const run = check([], { script: join(tree, CHECK), cwd: tree });
    assert.ok(lines(run, 'FAIL').some((line) => names(line, CONTROL)), `BLOCKED: the check run on the copy doesn't name the planted register method ${CONTROL}, which the base's check names, so it didn't read the copy's runtime table (README, The copy):\n${shown(run)}`);
    failsNaming(run, PLANTED_RUNTIME, `node ${CHECK} with ${PLANTED_RUNTIME} planted in the runtime's table`);
  });

  // The published plant: the checkout's API with one more entry, a copy of a method's entry under a name the
  // runtime's table doesn't have. It is no register method, so it adds no slot.
  await half(async () => {
    const { API } = await import(pathToFileURL(join(repo, RUNTIME)).href);
    assert.ok(!lists(API, PLANTED_PUBLISHED), `BLOCKED: the runtime's table lists ${PLANTED_PUBLISHED}, so it is no plant`);
    const model = published.find((entry) => entry.method === 'deep.readNow');
    assert.ok(model, `BLOCKED: ${API_FILE} has no deep.readNow entry for the plant to copy`);
    const planted = join(temp(), 'planted-extension-api.json');
    writeFileSync(planted, `${JSON.stringify([...published, { ...model, method: PLANTED_PUBLISHED }], null, 2)}\n`);
    failsNaming(check(['--api', planted]), PLANTED_PUBLISHED, `node ${CHECK} --api <the published API with ${PLANTED_PUBLISHED} planted>`);
  });
  if (failed.length) assert.fail(failed.join('\n\n'));
});

test('#1887.4a851c74 The slot count the check prints is unchanged', { timeout: LIMIT }, () => {
  const run = plainRun();
  const passed = lines(run, 'PASS');
  assert.equal(passed.length, 1, `node ${CHECK} prints its slot count on its one \`PASS slots:\` line, and printed ${passed.length}:\n${shown(run)}`);
  const count = passed[0].match(/^PASS slots: (\d+) slots\b/);
  assert.ok(count, `the \`PASS slots:\` line doesn't start with its slot count, as the base's does ("PASS slots: ${SLOTS} slots from the published API, ..."):\n${shown(run)}`);
  assert.equal(Number(count[1]), SLOTS, `the check counts ${count[1]} slots; the base counts ${SLOTS}:\n${shown(run)}`);
  assert.equal(run.status, 0, `the check prints its count and doesn't exit 0:\n${shown(run)}`);
});
