// #2176: `deep kinds --dump <folder>` and `deep kinds --diff <a> <b>` say in one line that no canvas core is built, as
// `deep export` does, and exit with the status of a core that can't start; with a core built they print what they
// print today. One test per criterion, each driving the built CLI (packages/cli/dist/main.js) as a subprocess.
// AC1 and AC2 run a copy of the built CLI in a temp folder with no canvas core beside it (the issue's Proof), so they
// read the same whether or not this checkout has a core; AC3 runs this checkout's CLI and needs its core built.
// README: readings, expected-value sources and how to run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
// kindsCommand's answer at the base when the core can't be spawned (packages/hub/src/canvas.ts: `child.on('error',
// () => done(3))`, and an exit with no code): "the status of a core that can't start".
const CANT_START = 3;
// The issue's line; its "…" is left open.
const NO_CORE = /No canvas core is built under .+ run cargo build --bin deep-show first/;
// Node's report of an uncaught error: stack frames, the source line's `file:line` header, the caret, its version line.
const TRACE = /^\s+at |^(?:file:\/\/)?\/.*\.js:\d+$|^\s*\^+\s*$|^Node\.js v\d|node:internal/m;

let work;
let copy;
before(() => {
  work = mkdtempSync(join(tmpdir(), 'deep-2176-'));
  // The built CLI as this checkout holds it: each workspace package (its tests and node_modules left out), linked into
  // the copy's node_modules as the checkout links them, every other dependency linked to the checkout's. No target/
  // and no deep-show beside the hub.
  copy = join(work, 'checkout');
  for (const name of readdirSync(join(repo, 'packages'))) {
    if (!existsSync(join(repo, 'packages', name, 'package.json'))) continue;
    cpSync(join(repo, 'packages', name), join(copy, 'packages', name), { recursive: true, filter: (from) => !['node_modules', 'test'].includes(basename(from)) });
  }
  mkdirSync(join(copy, 'node_modules', '@deepbuild'), { recursive: true });
  for (const name of readdirSync(join(repo, 'node_modules')))
    if (name !== '@deepbuild' && name !== '.bin') symlinkSync(join(repo, 'node_modules', name), join(copy, 'node_modules', name));
  for (const name of readdirSync(join(copy, 'packages'))) symlinkSync(join(copy, 'packages', name), join(copy, 'node_modules', '@deepbuild', name));
  // The copy is whole: its hub loads, from the copy. A copy that can't load it fails here, not as the issue's trace.
  const loads = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('@deepbuild/hub'); process.stdout.write(import.meta.resolve('@deepbuild/hub'))"], { cwd: copy, encoding: 'utf8', timeout: 120_000 });
  assert.equal(loads.status, 0, `the copy's hub loads\n${loads.stderr}`);
  assert.ok(fileURLToPath(loads.stdout).startsWith(realpathSync(copy) + sep), `the copy loads its own hub, not ${loads.stdout}`);
});
after(() => rmSync(work, { recursive: true, force: true }));

function run(command, args) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const done = spawnSync(command, args, { cwd: work, encoding: 'utf8', env, timeout: 120_000 });
  assert.equal(done.error, undefined, `${command} ${args.join(' ')} could not run: ${done.error?.message}`);
  return { status: done.status, signal: done.signal, stdout: done.stdout, stderr: done.stderr };
}
const deep = (root, args) => run(process.execPath, [join(root, 'packages', 'cli', 'dist', 'main.js'), ...args]);
const shown = (r) => `exit ${r.status}${r.signal ? ` (${r.signal})` : ''}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`;

/** `deep kinds <args>` in the copy with no canvas core: one line on stderr, the issue's, no trace, and the status. */
function saysNoCore(args) {
  // The copy is what runs, and no canvas core is beside it: the base finds one beside the hub's module or under the
  // target/ three folders above it (packages/hub/src/canvas.ts, canvasCore).
  const hub = realpathSync(join(copy, 'node_modules', '@deepbuild', 'hub'));
  assert.ok(hub.startsWith(realpathSync(copy) + sep), `the copy's CLI loads its own hub, not ${hub}`);
  for (const core of [join(hub, 'dist', 'deep-show'), join(copy, 'target', 'release', 'deep-show'), join(copy, 'target', 'debug', 'deep-show')])
    assert.ok(!existsSync(core), `the copy has no canvas core at ${core}`);
  const r = deep(copy, ['kinds', ...args]);
  const lines = r.stderr.replace(/\n$/, '').split('\n');
  assert.doesNotMatch(r.stderr, TRACE, `stderr holds no stack trace\n${shown(r)}`);
  assert.equal(lines.length, 1, `stderr is one line\n${shown(r)}`);
  assert.match(lines[0], NO_CORE, `stderr's line is the issue's\n${shown(r)}`);
  assert.equal(r.stdout, '', `nothing else is printed\n${shown(r)}`);
  assert.equal(r.status, CANT_START, `the exit status is that of a core that can't start\n${shown(r)}`);
}

test('#2176.86da3dfd with no canvas core built, `deep kinds --dump <folder>` prints one line naming what to build and exits with the status of a core that can\'t start', () => {
  saysNoCore(['--dump', join(work, 'dump')]);
});

test('#2176.60aad2b6 `deep kinds --diff` reads the same', () => {
  const [a, b] = ['a.json', 'b.json'].map((name) => join(work, name));
  for (const file of [a, b]) writeFileSync(file, '{}\n');
  saysNoCore(['--diff', a, b]);
});

test('#2176.7d36198e with a canvas core built, both print what they print today', () => {
  // This checkout's core, as the base picks it: the newer of release and debug (canvasCore).
  const built = ['release', 'debug'].map((p) => join(repo, 'target', p, 'deep-show')).filter((p) => existsSync(p));
  assert.ok(built.length > 0, `BLOCKED: no canvas core is built under ${join(repo, 'target')}, so this criterion is unrun: run cargo build --bin deep-show --locked first`);
  assert.ok(!existsSync(join(repo, 'packages', 'hub', 'dist', 'deep-show')), 'BLOCKED: a deep-show beside the hub\'s module would run instead of the checkout\'s build');
  const core = built.sort((x, y) => statSync(y).mtimeMs - statSync(x).mtimeMs)[0];
  // Today the command hands its arguments to `deep-show kinds` with the terminal's own output and exits as it does
  // (kindsCommand at the base), so what it prints today is what the core prints, byte for byte.
  const same = (args, status) => {
    const [direct, cli] = [run(core, ['kinds', ...args]), deep(repo, ['kinds', ...args])];
    assert.equal(direct.status, status, `the core itself exits ${status} for kinds ${args.join(' ')}\n${shown(direct)}`);
    assert.deepEqual(cli, direct, `deep kinds ${args.join(' ')} prints and exits as the core does\n--- deep\n${shown(cli)}\n--- deep-show\n${shown(direct)}`);
    return cli;
  };

  // --dump: one JSON line naming the dump and its module-set digest, the dump written under that name, exit 0.
  const dir = join(work, 'dumped');
  const dump = () => {
    rmSync(dir, { recursive: true, force: true });
    const out = same(['--dump', dir], 0);
    assert.match(out.stdout, /^\{.*\}\n$/, `--dump prints one JSON line\n${shown(out)}`);
    const line = JSON.parse(out.stdout);
    assert.match(String(line.module_set), /^(d1:)?[0-9a-f]{64}$/, `--dump names its module-set digest\n${shown(out)}`);
    assert.equal(line.path, join(dir, `${line.module_set.replace(/^d1:/, '')}.json`), `--dump names the file it wrote\n${shown(out)}`);
    return { path: line.path, bytes: readFileSync(line.path) };
  };
  const first = dump();
  const second = dump();
  assert.ok(first.bytes.length > 2 && first.bytes.equals(second.bytes), 'the dump deep kinds wrote is the core\'s own, byte for byte');

  // --diff of two dumps: one JSON line, exit 0.
  const other = join(work, 'other.json');
  writeFileSync(other, first.bytes);
  const diff = same(['--diff', first.path, other], 0);
  assert.match(diff.stdout, /^\{.*\}\n$/, `--diff prints one JSON line\n${shown(diff)}`);
  assert.equal(diff.stderr, '', `--diff of two dumps prints nothing on stderr\n${shown(diff)}`);

  // Bad input: the core's own words and its status 2.
  same(['--diff', join(work, 'missing-a.json'), join(work, 'missing-b.json')], 2);
});
