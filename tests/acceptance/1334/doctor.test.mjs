// #1334 AC4: `deep doctor` reads the hub's login service and fails one whose program sits in a temporary folder or a
// worktree, naming the path; it passes one that runs a promoted build (README: The surface, deep doctor). The Scope's
// checkout is read the same way. Each service definition is written as the base's service code writes it, since a
// doctor finds the ones an older setup left.
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKOUT, LONG, NODE, assert, deep, makeBuild, sandbox, shown, writeService } from './helpers.mjs';

const CODES = JSON.parse(readFileSync(join(CHECKOUT, 'packages', 'contracts', 'schemas', 'doctor.item@1.json'), 'utf8')).properties.code.enum;
const program = (path) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `#!/bin/sh\nexec ${JSON.stringify(NODE)} -e "process.exit(0)"\n`);
  chmodSync(path, 0o755);
  return path;
};

let o;
const cleanups = [];
after(async () => { for (const cleanup of cleanups) await cleanup(); });
before(async () => {
  const box = await sandbox({ after: (cleanup) => cleanups.push(cleanup) });
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: box.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  // A Node in the temporary folder, as on the Mac the issue names, with the CLI it runs beside it.
  const node = program(join(box.temp, 'node-v24.22.0-darwin-arm64', 'bin', 'node'));
  const temp = [node, join(box.temp, 'node-v24.22.0-darwin-arm64', 'lib', 'deepbuild', 'packages', 'cli', 'dist', 'main.js'), 'hub', 'run'];
  // A checkout of DeepBuild and a worktree of it, each holding a bin/deep.
  const repo = join(box.dir, 'src', 'deepbuild');
  mkdirSync(repo, { recursive: true });
  program(join(repo, 'bin', 'deep'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'a checkout');
  const side = join(box.dir, 'side', 'feature-a');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature-a', side);
  // A promoted build: its folder under versions/, named by its commit, and the current link on it.
  const commit = git(repo, 'rev-parse', 'HEAD');
  const build = makeBuild(box, 'good', commit, 'good');
  mkdirSync(join(box.root, 'versions'), { recursive: true });
  cpSync(build.folder, join(box.root, 'versions', commit), { recursive: true });
  symlinkSync(commit, join(box.root, 'versions', 'current'));
  const promoted = [join(box.root, 'versions', 'current', 'bin', 'deep'), 'hub', 'run'];
  const cases = { temp, worktree: [join(side, 'bin', 'deep'), 'hub', 'run'], checkout: [join(repo, 'bin', 'deep'), 'hub', 'run'], promoted };
  o = { box, cases, runs: {} };
  for (const [name, argv] of Object.entries(cases)) {
    writeService(box, argv);
    const run = await deep(box, ['doctor', '--json'], { cwd: box.dir });
    const items = run.stdout.split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
    o.runs[name] = { run, items, service: items.filter((i) => i.item === 'hub.service') };
  }
}, LONG);

const listed = (r) => `its hub.service items: ${JSON.stringify(r.service)}\n${shown(r.run)}`;
/** A hub.service item failing, naming one of `paths` and saying, by `word`, what the folder is. */
function fails(name, paths, kind, word) {
  const r = o.runs[name];
  const failing = r.service.filter((i) => i.level === 'fail');
  assert.ok(failing.length > 0, `deep doctor must fail hub.service for a service whose program sits in ${kind}; ${listed(r)}`);
  const item = failing.find((i) => paths.some((path) => i.evidence.includes(path)));
  assert.ok(item, `the hub.service failure must name the path, ${paths[0]}: it says ${JSON.stringify(failing.map((i) => i.evidence))}`);
  assert.match(item.evidence, word, `the hub.service failure must say the program sits in ${kind}: it says ${JSON.stringify(item.evidence)}`);
  assert.ok(CODES.includes(item.code) && !['healthy', 'not_checked', 'unknown'].includes(item.code), `its code must be one doctor.item@1 lists for a failure, not ${item.code}`);
  assert.ok(item.fix && item.fix.length > 0, 'it must say the fix');
  assert.notEqual(r.run.status, 0, 'deep doctor exits non-zero with a failed item');
}

test('#1334.32b63e42 deep doctor fails on a service whose program sits in a temp folder or a worktree, naming the path', LONG, () => {
  // The service a promotion leaves passes, so the failures below are about where the program sits.
  const good = o.runs.promoted;
  assert.equal(good.service.length, 1, `deep doctor must read the hub's login service as one hub.service item; ${listed(good)}`);
  assert.equal(good.service[0].level, 'ok', `a service running ~/.deepbuild/versions/current/bin/deep, a promoted build, must pass hub.service; ${listed(good)}`);
  fails('temp', o.cases.temp.slice(0, 2), 'a temporary folder', /\btemp/i);
  fails('worktree', [o.cases.worktree[0]], 'a worktree', /\bworktree\b/i);
});

test('deep doctor fails a service whose program sits in a checkout, naming the path', LONG, () => {
  assert.equal(o.runs.promoted.service[0]?.level, 'ok', `a service running a promoted build must pass hub.service; ${listed(o.runs.promoted)}`);
  fails('checkout', [o.cases.checkout[0]], 'a checkout', /\bcheckout\b/i);
});
