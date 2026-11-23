// Remote lanes (issue #1122; docs/parallel-proof.md, section 8). Three ways to start it:
//
//   node scripts/lane-remote.mjs --host <host> <lane>   the near end, on the Mac: ships the exact tree and the merge
//     base to <host>, runs the lane there and fetches its evidence record back as ~/.deepbuild/lanes/<tree>-<lane>-<host>.json
//   node scripts/lane-remote.mjs <lane> < manifest      the far end, in the session's worktree on that machine: checks
//     the shipped merge base and tree against its own, installs, builds, runs the lane and names its record
//   node scripts/lane-remote.mjs --only <lane>          on the Mac: runs the lane's tests the far machine skipped or
//     that reach a platform-branching source, and prints the lane's merged state
//
// Each prints its state and exits 0 on PASS, 1 on FAIL, 2 on INCONCLUSIVE and 3 on BLOCKED or INVALID.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { basename, join, matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checks, exactTree, mergeRecords, runLanes, writeRecord } from './lanes.mjs';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const EXIT = { PASS: 0, FAIL: 1, INCONCLUSIVE: 2, BLOCKED: 3, INVALID: 3 };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const word = (text) => text.replace(/\W+/g, '-');
const quote = (text) => `'${text.replaceAll("'", "'\\''")}'`;
const lanes = () => join(homedir(), '.deepbuild', 'lanes');
const git = (args, options = {}) => execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'], ...options });
// A run that reaches no verdict stops by throwing, so the exit status is set as the output drains: process.exit would
// cut a piped stdout short on macOS, the lane's last lines with it.
class Blocked extends Error {}
const blocked = (why) => {
  throw new Blocked(why);
};

const args = process.argv.slice(2);
const mode = args[0] === '--host' && args.length === 3 ? 'near' : args[0] === '--only' && args.length === 2 ? 'only' : args.length === 1 && !args[0].startsWith('--') ? 'far' : null;
if (!mode) {
  console.error('usage: node scripts/lane-remote.mjs --host <host> <lane> | --only <lane> | <lane> < manifest');
  process.exit(3);
}
const lane = checks.find(({ name }) => name === args.at(-1));
const record = (tree) => join(lanes(), `${tree}-${word(lane.name)}.json`);
/** A record with fields added, written back where it was. */
function amend(file, more) {
  const amended = { ...JSON.parse(readFileSync(file, 'utf8')), ...more };
  writeFileSync(file, `${JSON.stringify(amended, null, 2)}\n`);
  return amended;
}

/** Ships the tree on disk to the host's worktree for this one, runs the lane there and fetches its record back. */
async function near(host) {
  const tree = exactTree(cwd);
  if (!tree) blocked("git can't write this checkout's tree");
  let commit, base;
  try {
    commit = git(['rev-parse', 'HEAD']).trim();
    base = git(['merge-base', 'HEAD', 'origin/main']).trim();
  } catch (error) {
    blocked(`no merge base of HEAD and origin/main: ${error.stderr?.trim() || error.message}`);
  }
  const top = git(['rev-parse', '--show-toplevel']).trim();
  const folder = `deepbuild/.claude/worktrees/${word(`${hostname().split('.')[0]}-${basename(top)}-${sha(top).slice(0, 8)}`)}`;
  const ship = mkdtempSync(join(tmpdir(), 'deep-lane-remote-'));
  process.on('exit', () => rmSync(ship, { recursive: true, force: true }));
  const plain = { ...process.env, COPYFILE_DISABLE: '1' }; // no macOS metadata files in a tarball
  const bundle = git(['-c', 'diff.noprefix=false', 'diff', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD'], { encoding: 'buffer' });
  const untracked = git(['ls-files', '-z', '--others', '--exclude-standard']);
  writeFileSync(join(ship, 'bundle.patch'), bundle);
  // No untracked file ships as an empty file: tar refuses to make an archive of nothing.
  if (untracked) execFileSync('tar', ['-cf', join(ship, 'untracked.tar'), '--null', '-T', '-'], { cwd, input: untracked, env: plain });
  else writeFileSync(join(ship, 'untracked.tar'), '');
  const manifest = { commit, base, tree, bundle: sha(bundle), untracked: sha(readFileSync(join(ship, 'untracked.tar'))), from: hostname() };
  writeFileSync(join(ship, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  const ssh = (script) => spawnSync('ssh', [host, `bash -lc ${quote(script)}`], { encoding: 'utf8', maxBuffer: 1 << 30 });
  // The worktree is a repository of its own, so the origin/main it sets is no other session's; it borrows the
  // machine clone's objects, so a push sends only what that clone lacks.
  // It names this checkout's origin, never fetched there, so a lane that reads the repository's issues finds them.
  const origin = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' }).stdout.trim().replace(/\/\/[^/@]*@/, '//'); // less any credential
  const made = ssh(`set -e; mkdir -p ~/${folder}; cd ~/${folder}; if [ ! -d .git ]; then git init -q; if [ -d ~/deepbuild/.git/objects ]; then echo ~/deepbuild/.git/objects > .git/objects/info/alternates; fi; fi${origin ? `; git config remote.origin.url ${quote(origin)}` : ''}`);
  if (made.status !== 0) blocked(`${host} has no worktree for this session: ${(made.stderr || made.error?.message || '').trim()}`);
  const pushed = spawnSync('git', ['push', '--quiet', '--force', `${host}:${folder}`, `${commit}:refs/lane-remote/head`, `${base}:refs/lane-remote/base`], { cwd, encoding: 'utf8' });
  if (pushed.status !== 0) blocked(`git push to ${host} failed: ${(pushed.stderr || pushed.error?.message || '').trim()}`);
  const shipment = execFileSync('tar', ['-cf', '-', '-C', ship, 'manifest.json', 'bundle.patch', 'untracked.tar'], { maxBuffer: 1 << 30, env: plain });
  // One lane at a time in the worktree: a second shipment would replace the files under a lane still running there,
  // as one whose near end was stopped is. The far end runs as this shell, so the PID is its own.
  const run = `set -e; if [ -f ~/.cargo/env ]; then . ~/.cargo/env; fi; cd ~/${folder}; `
    + `if [ -f .git/lane-remote.pid ] && kill -0 "$(cat .git/lane-remote.pid)" 2>/dev/null; then echo "BLOCKED lane-remote: a lane is still running in this session's worktree, as PID $(cat .git/lane-remote.pid)"; exit 3; fi; echo $$ > .git/lane-remote.pid; rm -rf .git/lane-remote; mkdir .git/lane-remote; tar -xf - -C .git/lane-remote; `
    + `git checkout -q -f --detach ${commit}; git clean -q -ffd; if [ -s .git/lane-remote/bundle.patch ]; then git apply --binary --whitespace=nowarn .git/lane-remote/bundle.patch; fi; `
    + `if [ -s .git/lane-remote/untracked.tar ]; then tar -xmf .git/lane-remote/untracked.tar; fi; exec node scripts/lane-remote.mjs ${quote(lane.name)} < .git/lane-remote/manifest.json`;
  const child = spawn('ssh', [host, `bash -lc ${quote(run)}`], { stdio: ['pipe', 'pipe', 'inherit'] });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
  child.stdin.on('error', () => {});
  child.stdin.end(shipment);
  await new Promise((done) => child.on('close', done));
  // The verdict is the record, fetched back and read here, never the far end's summary or its exit status.
  const path = output.match(/^RECORD (.+)$/gm)?.at(-1)?.slice(7);
  const fetched = path ? ssh(`cat ${quote(path)}`).stdout : '';
  let found = null;
  try {
    found = JSON.parse(fetched);
  } catch {}
  if (found?.tree !== tree || found.lane !== lane.name || !Object.hasOwn(EXIT, found.state)) blocked(`${host} brought no record of ${lane.name} on tree ${tree} back`);
  mkdirSync(lanes(), { recursive: true, mode: 0o700 });
  const file = join(lanes(), `${tree}-${word(lane.name)}-${String(found.host).replace(/[^\w.-]+/g, '-')}.json`);
  writeFileSync(file, fetched);
  console.log(`${found.state} ${lane.name} on ${found.host}\nRECORD ${file}`);
  return EXIT[found.state];
}

/** The far end: the shipped merge base and tree checked against this worktree's own, then the lane and its record. */
function far() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(0, 'utf8'));
  } catch (error) {
    blocked(`no manifest on standard input: ${error.message}`);
  }
  let computed = 'none';
  try {
    git(['update-ref', 'refs/remotes/origin/main', String(manifest.base)]);
    computed = git(['merge-base', 'HEAD', 'refs/remotes/origin/main']).trim();
  } catch {}
  if (computed === null) blocked(`the merge base shipped is ${manifest.base}; ${hostname()} computes ${computed}`);
  const head = git(['rev-parse', 'HEAD']).trim();
  if (head !== manifest.commit) blocked(`the commit shipped is ${manifest.commit}; ${hostname()} holds ${head}`);
  const tree = exactTree(cwd);
  if (!tree || tree !== manifest.tree) blocked(`the tree shipped is ${manifest.tree}; ${hostname()} holds ${tree ?? 'none'}`);
  // Through the machine's throttle: a status but 0 is a missing grant (its line says so above) or the command's failure.
  const build = (...command) => spawnSync(process.execPath, ['scripts/throttle.mjs', 'build', '--wait', '30', '--', ...command], { cwd, stdio: 'inherit' }).status === 0;
  // npm ci only when the lock's bytes changed since the last install here, as in a bay.
  const marker = join(cwd, git(['rev-parse', '--git-dir']).trim(), 'lane-remote-installed'), want = sha(readFileSync(join(cwd, 'package-lock.json')));
  if (!existsSync(join(cwd, 'node_modules')) || !existsSync(marker) || readFileSync(marker, 'utf8') !== want) {
    if (!build('npm', 'ci')) blocked('npm ci got no build grant or failed, as the line above says, so the lane was not run');
    writeFileSync(marker, want);
  }
  if (!build('npm', 'run', 'build', '--workspaces')) blocked("the packages' build got no build grant or failed, as the line above says, so the lane was not run");
  // A record an earlier run of this tree left is not this run's.
  rmSync(record(tree), { force: true });
  runLanes([lane], { cwd });
  if (!existsSync(record(tree))) blocked(`${lane.name} wrote no record of tree ${tree}`);
  const { state } = amend(record(tree), { bundle: manifest.bundle, recipe: manifest });
  console.log(`RECORD ${record(tree)}`);
  return EXIT[state] ?? 3;
}

// The vitest options the lanes' commands give a value to, as their next argument.
const VALUED = ['--root', '-t', '--testNamePattern', '--config', '--project', '--dir'];

/** A vitest command's arguments after `run`: its options with their values, each --exclude glob, and the paths it names. */
function vitestArgs(args) {
  const rest = args.slice(args.indexOf('run') + 1), options = [], paths = [], excludes = [];
  rest.forEach((arg, at) => {
    if (rest[at - 1] === '--exclude') excludes.push(arg);
    else if (arg.startsWith('-') || VALUED.includes(rest[at - 1])) options.push(arg);
    else paths.push(arg);
  });
  const root = rest[rest.indexOf('--root') + 1];
  return { head: args.slice(0, args.indexOf('run') + 1), options: options.filter((arg) => arg !== '--exclude'), paths, excludes, root: rest.includes('--root') ? root.replace(/\/$/, '') : null };
}

/** Whether a lane's command runs tests by vitest, cargo test or node --test. */
function isTest([command, ...args]) {
  return args.some((arg) => arg.endsWith('vitest.mjs')) || (command === 'cargo' && args[0] === 'test') || (command === process.execPath && args[0] === '--test');
}

/**
 * The lane's test command narrowed to the files and crates, with the repo's files and crates it runs; null when none of
 * them is its to run, or it runs no test.
 */
function narrow([command, ...args], files, crates, runner) {
  if (args.some((arg) => arg.endsWith('vitest.mjs'))) {
    const { head, options, paths, excludes, root } = vitestArgs(args);
    // Under --root, vitest reads paths and globs from that folder.
    const at = (file) => (root ? file.slice(root.length + 1) : file);
    const out = (file) => excludes.some((glob) => (glob.endsWith('**') ? at(file).startsWith(glob.slice(0, -2)) : at(file) === glob));
    const own = files.filter((file) => runner(file) === 'vitest' && (!root || file.startsWith(`${root}/`)) && (!paths.length || paths.some((path) => at(file).includes(path))) && !out(file));
    return own.length ? { command: [command, ...head, ...options, ...excludes.flatMap((glob) => ['--exclude', glob]), ...own.map(at)], files: own, crates: [] } : null;
  }
  if (command === 'cargo' && args[0] === 'test') {
    // The whole workspace narrows to the crates; a command that names its own crates runs whole when one is among them.
    const named = args.filter((arg, at) => args[at - 1] === '-p');
    if (!args.includes('--workspace')) return named.some((name) => crates.includes(name)) ? { command: [command, ...args], files: [], crates: named } : null;
    return crates.length ? { command: [command, ...args.flatMap((arg) => (arg === '--workspace' ? crates.flatMap((name) => ['-p', name]) : [arg]))], files: [], crates } : null;
  }
  if (command === process.execPath && args[0] === '--test') {
    const own = files.filter((file) => runner(file) === 'node' && args.slice(1).some((glob) => matchesGlob(file, glob)));
    return own.length ? { command: [command, '--test', ...own], files: own, crates: [] } : null;
  }
  return null;
}

/** The Mac's run of what the far machine can't see: its skipped tests and those reaching a platform-branching source. */
async function only() {
  const tree = exactTree(cwd);
  if (!tree) blocked("git can't write this checkout's tree");
  const read = (name) => {
    try {
      return JSON.parse(readFileSync(join(lanes(), name), 'utf8'));
    } catch {
      return {};
    }
  };
  const remote = (existsSync(lanes()) ? readdirSync(lanes()) : []).filter((name) => name.startsWith(`${tree}-`) && name.endsWith('.json')).map(read)
    .filter((found) => found.lane === lane.name && found.tree === tree && !String(found.platform).startsWith('darwin'));
  if (!remote.length) blocked(`no fetched record of ${lane.name} on tree ${tree}; run it with --host first`);
  // A lane with no test command has nothing to narrow, and a record of nothing run is no verdict of it: lint's is the Mac's whole run.
  if (!lane.commands.some((command) => isTest(command))) blocked(`${lane.name} runs no test command, so nothing of it narrows; run the lane whole on the Mac`);
  // The reach is affected.mjs's, which loads the build tooling, so only this run imports it.
  const { select, runnerOf } = await import('./affected.mjs');
  const { isTestFile, listFiles } = await import('./proof-change.mjs');
  const all = listFiles(cwd), source = (file) => readFileSync(join(cwd, file), 'utf8');
  const branching = all.filter((file) => (/\.[cm]?[jt]sx?$/.test(file) && /\bprocess\.platform\b/.test(source(file))) || (file.endsWith('.rs') && /\btarget_os\b/.test(source(file))));
  const reached = select(cwd, branching, { files: all });
  const skipped = remote.flatMap((found) => found.tests ?? []).filter((row) => row.skipped).map((row) => row.id.split(' › ')[0]);
  const wide = (cargo) => reached.wide.filter((node) => node.startsWith('cargo test -p ') === cargo).map((node) => node.replace('cargo test -p ', ''));
  const files = [...new Set([...reached.tests, ...wide(false), ...skipped.filter((file) => isTestFile(file) && existsSync(join(cwd, file)))])].sort();
  const crates = [...new Set([...reached.crates, ...wide(true), ...skipped.flatMap((id) => id.match(/^cargo -p (\S+)/)?.[1] ?? [])])].sort();
  // A platform-branching file every suite reads, as a runner's setup, reaches every test: the lane's tests run whole.
  const narrowed = reached.every.length ? lane.commands.filter(isTest).map((command) => ({ command, files: [], crates: [] }))
    : lane.commands.map((command) => narrow(command, files, crates, (file) => runnerOf(file, source(file)))).filter(Boolean);
  const commands = narrowed.map(({ command }) => command);
  const ran = (key) => [...new Set(narrowed.flatMap((one) => one[key]))].sort();
  // A whole run of the lane on this Mac and tree already holds every row a narrowed one would: it stands.
  if (!existsSync(record(tree)) || read(`${tree}-${word(lane.name)}.json`).only) {
    rmSync(record(tree), { force: true });
    // With none of the lane's tests for the Mac to run, its record says so: the far machine's rows then stand alone.
    if (commands.length) runLanes([{ ...lane, commands }], { cwd });
    else writeRecord(lane.name, 'PASS', tree, []);
    if (!existsSync(record(tree))) blocked(`${lane.name} wrote no record of tree ${tree}`);
    amend(record(tree), { only: { files: ran('files'), crates: ran('crates'), ...(reached.every.length && { every: reached.every }) } });
  }
  const state = mergeRecords(tree).states[lane.name];
  console.log(`RECORD ${record(tree)}\n${state} ${lane.name} (merged)`);
  return EXIT[state];
}

// Last, so every declaration above is in place before the run.
try {
  if (!lane) blocked(`lanes.mjs has no check lane named ${args.at(-1)}`);
  process.exitCode = mode === 'near' ? await near(args[1]) : mode === 'far' ? far() : await only();
} catch (error) {
  // Whatever broke, no verdict was reached: never the exit status of a FAIL.
  console.log(`BLOCKED lane-remote: ${error.message.split('\n')[0]}`);
  process.exitCode = 3;
}
