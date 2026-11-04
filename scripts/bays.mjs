// Bays (docs/parallel-proof.md, section 4): fixed-path proof workspaces, ~/deepbuild-bays/<k>/{base,change}, claimed
// in pairs through the throttle's bay-pair class, whose grant index names k. A bay stays at its path, so a warm
// target/ keeps CARGO_MANIFEST_DIR and CARGO_BIN_EXE_* true; the run's exact tree is written into it instead.
// `bays.mjs <base|change> -- <command>` claims a pair, replaces that role's bay to the tree of the worktree it runs
// from, runs the command there, seals the bay, releases the pair and exits with the command's status. A proof claims
// one pair for its base and change bays with `claimPair` (#1118), and every copy it makes is a use of one of them.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync, writeSync } from 'node:fs';
import { constants, homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquire, holds, release } from './throttle.mjs';

// What a bay keeps across runs: its builds, and the git folder it gets anew each run.
const KEPT = ['.git', 'target', 'node_modules'];
// Git as proof-change.mjs reads it, and the files it lists there. That module loads TypeScript, and perf imports
// replace and walk from a checkout or a test's fixture that may have no node_modules, so bays reads git itself.
const git = (root, args, options = {}) => execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'], ...options });
const listFiles = (root) => [...new Set(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))]
  .filter((path) => { try { return !lstatSync(join(root, path)).isDirectory(); } catch { return false; } });
const bays = () => join(homedir(), 'deepbuild-bays');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const real = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

/** Whether `directory` is a bay, ~/deepbuild-bays/<k>/<role>: undoBuild leaves its .git, target and node_modules be. */
export function isBay(directory) {
  const pair = dirname(real(directory) ?? directory);
  return /^\d+$/.test(pair.split('/').pop()) && dirname(pair) === real(bays());
}

/**
 * Why `root` gets no bay, or null. Only a proof rooted in a worktree of the machine's repository gets one: a worktree
 * git lists for the repository that holds this script, wherever the machine keeps it. A scene a test starts in a
 * temporary repository, or a copy of a worktree, keeps its temporary copies. Nor does a proof whose ancestor holds a
 * pair, by the throttle's table, so a proof under a bay's run never takes a second.
 */
function refusal(root) {
  const here = dirname(fileURLToPath(import.meta.url));
  let worktrees = [];
  try {
    worktrees = git(here, ['worktree', 'list', '--porcelain']).split('\n').filter((line) => line.startsWith('worktree ')).map((line) => real(line.slice('worktree '.length)));
  } catch {}
  if (!worktrees.includes(real(root))) return `${root} is not a worktree of the repository that holds ${here}`;
  if (holds('bay-pair')) return 'an ancestor of this process holds a bay pair, so this proof runs on temporary copies';
  return null;
}

/** The files under `folder`, as paths relative to it, not following links. */
export function walk(folder, at = '', found = []) {
  for (const entry of readdirSync(join(folder, at), { withFileTypes: true })) {
    const path = at ? `${at}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(folder, path, found);
    else found.push(path);
  }
  return found;
}

/**
 * The run's exact tree: where its files are read from, their paths, and the hashes the record binds. The change is
 * the worktree as listFiles reads it, HEAD's tree with the uncommitted changes and the untracked files git doesn't
 * ignore; the base is a git archive of the merge base.
 */
function treeOf(root, role) {
  if (role === 'change') {
    const untracked = git(root, ['ls-files', '-z', '--others', '--exclude-standard']).split('\0').filter((path) => path && existsSync(join(root, path)) && !lstatSync(join(root, path)).isDirectory());
    const hash = createHash('sha256');
    for (const path of untracked.sort()) hash.update(`${path}\0`).update(lstatSync(join(root, path)).isSymbolicLink() ? readlinkSync(join(root, path)) : readFileSync(join(root, path))).update('\0');
    return {
      from: root,
      paths: listFiles(root),
      recipe: { tree: git(root, ['rev-parse', 'HEAD^{tree}']).trim(), bundle: sha(git(root, ['diff', '--binary', 'HEAD'], { encoding: 'buffer' })), untracked: hash.digest('hex'), untrackedFiles: untracked.sort() },
    };
  }
  const base = git(root, ['merge-base', 'HEAD', 'origin/main']).trim();
  const from = mkdtempSync(join(tmpdir(), 'deep-bay-base-'));
  const result = spawnSync('sh', ['-c', 'git -C "$1" archive "$2" | tar -xf - -C "$3"', 'sh', root, base, from], { encoding: 'utf8' });
  if (result.status !== 0) {
    rmSync(from, { recursive: true, force: true });
    throw Error(`git archive ${base} failed: ${result.stderr.trim()}`);
  }
  return { from, paths: walk(from), recipe: { base, tree: git(root, ['rev-parse', `${base}^{tree}`]).trim(), bundle: null, untracked: null }, temporary: true };
}

/**
 * Replaces the bay in place to the tree: deletes what the tree lacks, outside what a bay keeps, and writes each file
 * whose bytes, mode or link differ from the bay's, as a new file, so its mtime is now's and nothing it was linked
 * to changes. A file whose bytes match is left as it is, so cargo and tsc rebuild nothing for it. Returns the paths
 * it wrote and how many it deleted. perf's kept copies are replaced by it too.
 */
export function replace(bay, { from, paths }) {
  const wanted = new Set(paths);
  const folders = new Set(paths.flatMap((path) => path.split('/').slice(0, -1).map((_, at, parts) => parts.slice(0, at + 1).join('/'))));
  const written = [];
  let deleted = 0;
  const prune = (at) => {
    for (const entry of readdirSync(join(bay, at), { withFileTypes: true })) {
      const path = at ? `${at}/${entry.name}` : entry.name;
      if (!at && KEPT.includes(entry.name)) continue;
      if (entry.isDirectory() && folders.has(path)) prune(path);
      else if (entry.isDirectory() || !wanted.has(path)) {
        rmSync(join(bay, path), { recursive: true, force: true });
        deleted += 1;
      }
    }
  };
  mkdirSync(bay, { recursive: true });
  prune('');
  for (const path of paths) {
    const source = join(from, path), target = join(bay, path);
    const want = lstatSync(source);
    let have = null;
    try {
      have = lstatSync(target);
    } catch {}
    mkdirSync(dirname(target), { recursive: true });
    if (want.isSymbolicLink()) {
      const link = readlinkSync(source);
      if (have?.isSymbolicLink() && readlinkSync(target) === link) continue;
      rmSync(target, { force: true });
      symlinkSync(link, target);
    } else {
      const bytes = readFileSync(source), mode = want.mode & 0o777;
      // A file linked from elsewhere is written anew, so no write in the bay reaches the other name.
      if (have?.isFile() && have.nlink === 1 && (have.mode & 0o777) === mode && readFileSync(target).equals(bytes)) continue;
      const fresh = `${target}.deep-bay-${process.pid}`;
      writeFileSync(fresh, bytes);
      chmodSync(fresh, mode);
      renameSync(fresh, target);
    }
    written.push(path);
  }
  return { written, deleted };
}

/** The bay's .git, made anew as the proof's copies make theirs: the repository's refs, its objects read, never written. */
function recreateGit(root, bay) {
  rmSync(join(bay, '.git'), { recursive: true, force: true });
  const common = resolve(root, git(root, ['rev-parse', '--git-common-dir']).trim());
  git(bay, ['init', '-q', '--template=', bay]);
  mkdirSync(join(bay, '.git/objects/info'), { recursive: true });
  writeFileSync(join(bay, '.git/objects/info/alternates'), `${join(common, 'objects')}\n`);
  const refs = git(root, ['for-each-ref', '--format=%(objectname) %(refname)']).split('\n').filter(Boolean).map((row) => `create ${row.split(' ')[1]} ${row.split(' ')[0]}`);
  git(bay, ['update-ref', '--stdin'], { input: `${refs.join('\n')}\n`, stdio: ['pipe', 'pipe', 'pipe'] });
  git(bay, ['update-ref', '--no-deref', 'HEAD', git(root, ['rev-parse', 'HEAD']).trim()]);
  git(bay, ['read-tree', 'HEAD']);
}

/** An entry's stat as the seal compares it: kind, mode, size, mtime and ctime in ns, inode; a link with its target. */
function stamp(path) {
  const stat = lstatSync(path, { bigint: true });
  const kind = stat.isDirectory() ? 'd' : stat.isSymbolicLink() ? `l:${readlinkSync(path)}` : 'f';
  // ctime can't be set back, so a file rewritten in place with its size, mtime and inode put back still shows.
  return { stat, text: `${kind}\0${stat.mode}\0${stat.size}\0${stat.mtimeNs}\0${stat.ctimeNs}\0${stat.ino}` };
}

/**
 * The seal's stat listing of a kept folder, target/ or node_modules/, hashed, with the bytes of its files, each inode
 * once, as the reading. A folder that is itself a link, or holds one that leads out of the bay, can change where the
 * listing doesn't look, so it is never taken as intact (`outside`).
 */
function listing(bay, kept, skip = null) {
  const hash = createHash('sha256'), inodes = new Set();
  let bytes = 0, outside = false;
  const visit = (path) => {
    if (skip?.test(path)) return;
    const { stat, text } = stamp(join(bay, path));
    // A folder a skipped entry lies in changes its times with it, so where entries are skipped a folder is its name.
    hash.update(`${path}\0${skip && stat.isDirectory() ? 'd' : text}\n`);
    if (stat.isSymbolicLink()) {
      const to = relative(bay, resolve(dirname(join(bay, path)), readlinkSync(join(bay, path))));
      if (path === kept || to.startsWith('..') || to.startsWith('/')) outside = true;
    } else if (stat.isFile() && !inodes.has(stat.ino)) {
      inodes.add(stat.ino);
      bytes += Number(stat.size);
    }
    if (stat.isDirectory()) for (const name of readdirSync(join(bay, path)).sort()) visit(`${path}/${name}`);
  };
  try {
    lstatSync(join(bay, kept));
    visit(kept);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { hash: hash.digest('hex'), bytes, outside };
}
const KEPT_BUILDS = ['target', 'node_modules'];
// What the install leaves, less the caches tools keep in node_modules, such as vitest's in .vite, and the marker.
const INSTALLED = /^node_modules\/\.(?!bin$|package-lock\.json$)[^/]+$/;
const installed = (bay) => listing(bay, 'node_modules', INSTALLED).hash;
const sealOf = (bay) => Object.fromEntries(KEPT_BUILDS.map((kept) => [kept, listing(bay, kept)]));

// As long as a proof's own install may run.
const INSTALL_TIMEOUT = 20 * 60_000;
/** Installs the bay's packages when its lock's bytes differ from those of the last install that finished; returns why it failed, or null. */
function install(bay, run) {
  const lock = join(bay, 'package-lock.json');
  if (!existsSync(lock)) return { installed: false };
  const key = sha(readFileSync(lock)), marker = join(bay, 'node_modules/.deep-bay-installed');
  // Packages the lock puts under a workspace's own node_modules lie outside what a bay keeps, so a replace removes
  // them, and the install runs again for them.
  let nested = [];
  try {
    // npm ci leaves out a package for another platform: one its os or cpu list, names or !names, doesn't admit.
    const fits = (list, value) => !Array.isArray(list) || (!list.includes(`!${value}`) && (list.every((name) => name.startsWith('!')) || list.includes(value)));
    nested = Object.entries(JSON.parse(readFileSync(lock, 'utf8')).packages ?? {}).filter(([path, entry]) => !path.startsWith('node_modules/') && path.includes('/node_modules/')
      && fits(entry?.os, process.platform) && fits(entry?.cpu, process.arch)).map(([path]) => path);
  } catch {}
  if (existsSync(marker) && readFileSync(marker, 'utf8') === key && nested.every((path) => existsSync(join(bay, path)))) return { installed: false };
  const result = run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: bay, encoding: 'utf8', maxBuffer: 1 << 28, timeout: INSTALL_TIMEOUT });
  if (result.error?.code === 'ETIMEDOUT') return { failed: `npm ci was stopped after ${INSTALL_TIMEOUT / 60_000} minutes` };
  if (result.status !== 0) return { failed: `npm ci failed: ${(result.stderr || result.error?.message || '').trim().split('\n').pop()}` };
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, key);
  return { installed: true };
}

// A record line goes out whole before the command writes, and before an exit, on a pipe too.
// A pipe a child made non-blocking can refuse a write for a moment; it is tried again.
function say(line) {
  const bytes = Buffer.from(`${line}\n`);
  for (let at = 0; at < bytes.length;) {
    try {
      at += writeSync(1, bytes, at);
    } catch (error) {
      if (error.code !== 'EAGAIN') throw error;
    }
  }
}

/**
 * Stops what a dead holder's command left running in the pair: its process group, which this script started. A
 * group's number isn't given to a new process while any member lives, so members under it are that command's,
 * unless its leader lives with another start, a later process given the number. Returns whether any were stopped.
 */
function stopLeftover(file) {
  let group;
  try {
    group = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  const members = () => {
    const listing = spawnSync('ps', ['-A', '-o', 'pid=,pgid=,lstart='], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } }).stdout;
    const rows = listing.split('\n').map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/)).filter(Boolean);
    const leader = rows.find(([, pid]) => Number(pid) === group.pid);
    if (leader && leader[3] !== group.start) return 0;
    return rows.filter(([, , pgid]) => Number(pgid) === group.pid).length;
  };
  if (!members()) return false;
  try {
    process.kill(-group.pid, 'SIGKILL');
  } catch {}
  const deadline = Date.now() + 10_000;
  while (members() && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  return true;
}


// Runs a command of a proof's bay as the leader of a process group named in the pair, as the command line runs its
// own, and exits as it did: what it leaves running when the proof dies is stopped by the next claim.
const LAUNCH = `import { spawn, spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { constants } from 'node:os';
const [file, command, ...args] = process.argv.slice(1);
const child = spawn(command, args, { stdio: 'inherit', detached: true });
const start = spawnSync('ps', ['-o', 'lstart=', '-p', String(child.pid)], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } }).stdout.trim();
writeFileSync(file, JSON.stringify({ pid: child.pid, start }));
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { try { process.kill(-child.pid, signal); } catch {} });
child.on('error', (error) => { rmSync(file, { force: true }); console.error(command + ' could not start: ' + error.message); process.exit(127); });
child.on('exit', (status, signal) => {
  rmSync(file, { force: true });
  if (!signal) process.exit(status);
  process.removeAllListeners(signal);
  process.kill(process.pid, signal);
  // Node lives through some signals sent to itself, such as SIGPIPE; the command's death still shows.
  process.exit(128 + constants.signals[signal]);
});
`;
/**
 * The workspace crates whose builds read a file of `paths` in the bay: a file under crates/<name>/, one a crate's
 * manifest names by its path from there (a test target under the test paths, say), or the workspace's own manifest,
 * lock or toolchain, which every crate reads; and the crates that depend on those by path, which cargo rebuilds too.
 */
function crates(bay, paths) {
  let names = [];
  try {
    names = readdirSync(join(bay, 'crates')).filter((name) => existsSync(join(bay, 'crates', name, 'Cargo.toml')));
  } catch {}
  const manifests = new Map(names.map((name) => [name, readFileSync(join(bay, 'crates', name, 'Cargo.toml'), 'utf8')]));
  const read = new Set(paths.flatMap((path) => {
    if (/^(?:Cargo\.(?:toml|lock)|rust-toolchain(?:\.toml)?|\.cargo\/.*)$/.test(path)) return names;
    const own = path.match(/^crates\/([^/]+)\//)?.[1];
    return own ? [own] : names.filter((name) => manifests.get(name).includes(`"${relative(join('crates', name), path)}"`));
  }));
  for (const name of read) for (const other of names) if (!read.has(other) && new RegExp(`path\\s*=\\s*"\\.\\./${name}/?"`).test(manifests.get(other))) read.add(other);
  return [...read].sort();
}

/**
 * A pair claimed for `root`: one bay for the base and one for the change, each used in turn by the copies its role
 * makes and never by the other's. `{ refused }` says why the root gets no bay, `{ blocked }` that none came in time.
 * The grant passes to the holder's descendants through DEEP_THROTTLE until `close`.
 */
export function claimPair(root, print) {
  const refused = refusal(root);
  if (refused) return { refused };
  const grant = acquire('bay-pair', { wait: 30 });
  if (!grant) return { blocked: 'INCONCLUSIVE no grant: no bay pair came within 30 min' };
  try {
    return new Pair(root, grant, print);
  } catch (error) {
    release(grant);
    return { blocked: `the bay pair cannot be used: ${error.message}` };
  }
}

class Pair {
  constructor(root, grant, print) {
    Object.assign(this, { root, grant, print, index: grant.index, roles: {}, previous: process.env.DEEP_THROTTLE });
    mkdirSync(join(bays(), String(grant.index)), { recursive: true });
    // Where the pair really is, so a bays folder linked to another disk names its bays as the copies' checks see them.
    this.folder = realpathSync(join(bays(), String(grant.index)));
    // A pair linked out of the bays folder holds no bay the copies' checks know, and undoBuild would take its
    // packages for a copy's links.
    if (!isBay(join(this.folder, 'change'))) throw Error(`${join(bays(), String(grant.index))} links out of ${bays()}, to ${this.folder}; make it a folder there`);
    this.groupFile = join(this.folder, 'command.json');
    // A dead holder's command may still run in the pair; it is stopped before a bay changes under it.
    this.stopped = stopLeftover(this.groupFile);
    rmSync(this.groupFile, { force: true });
    process.env.DEEP_THROTTLE = grant.token;
  }

  /** spawnSync in the pair: a process group of its own, named in the pair, and the bay's own target/. */
  run(command, args, options = {}) {
    const env = { ...(options.env ?? process.env) };
    delete env.CARGO_TARGET_DIR;
    delete env.CARGO_BUILD_TARGET_DIR;
    return spawnSync(process.execPath, ['--input-type=module', '-e', LAUNCH, this.groupFile, command, ...args], { ...options, env });
  }

  /**
   * The bay of `role`, replaced in place to the tree of the use (`use` names it in the record), its .git made anew
   * and its packages installed when its lock changed. `overlay`, path to source file, is what the caller lays over
   * it: its hash joins the recipe, and the crates its files change are named with those the replace wrote. The
   * first use of a role checks and removes its seal, and builds cold unless it is intact. Returns the bay and why
   * its install failed, or null.
   */
  use(role, use, overlay = new Map()) {
    const bay = join(this.folder, role);
    let state = this.roles[role];
    let seal = state?.seal, cold = false;
    if (!state) {
      // The seal is checked, and removed, before anything in the bay changes: a proof that dies before it seals again
      // leaves none, and the next claim builds cold.
      const sealFile = join(this.folder, `${role}.seal.json`);
      let sealed = null;
      seal = 'none';
      if (existsSync(sealFile)) {
        try {
          sealed = JSON.parse(readFileSync(sealFile, 'utf8'));
        } catch {}
        const now = existsSync(bay) ? sealOf(bay) : null;
        seal = sealed && now && KEPT_BUILDS.every((kept) => !now[kept].outside && sealed.listing?.[kept] === now[kept].hash) ? 'intact' : 'broken';
      }
      rmSync(sealFile, { force: true });
      cold = seal !== 'intact';
      if (cold) for (const kept of KEPT_BUILDS) rmSync(join(bay, kept), { recursive: true, force: true });
      state = this.roles[role] = { bay, sealFile, seal, sealedTree: sealed?.tree ?? null, sources: {}, packages: null };
    } else this.finish(role);
    const tree = treeOf(this.root, role);
    let changed;
    try {
      changed = replace(bay, tree);
    } finally {
      if (tree.temporary) rmSync(tree.from, { recursive: true, force: true });
    }
    // The record binds the sources: a worktree edited while they were copied would leave the bay holding others.
    if (role === 'change' && JSON.stringify(treeOf(this.root, role).recipe) !== JSON.stringify(tree.recipe)) throw Error(`${this.root} changed while its tree was copied into ${bay}; run again once it is still`);
    recreateGit(this.root, bay);
    const { installed: ran, failed } = install(bay, (...args) => this.run(...args));
    // What the use's commands do to a source shows when the role is next used or sealed, though they put the bytes
    // and the mtime back; so does what they do to the packages.
    Object.assign(state, { tree: tree.recipe, sources: Object.fromEntries(tree.paths.map((path) => [path, stamp(join(bay, path)).text])), packages: installed(bay) });
    const layered = [...overlay].filter(([path, from]) => {
      const to = join(bay, path);
      try {
        return !(lstatSync(to).isFile() && readFileSync(to).equals(readFileSync(from)));
      } catch {
        return true;
      }
    }).map(([path]) => path);
    const hash = createHash('sha256');
    for (const [path, from] of [...overlay].sort(([a], [b]) => (a < b ? -1 : 1))) hash.update(`${path}\0`).update(lstatSync(from).isSymbolicLink() ? readlinkSync(from) : readFileSync(from)).update('\0');
    const recipe = { ...tree.recipe, overlay: overlay.size ? { files: overlay.size, hash: hash.digest('hex') } : null };
    this.print(`BAY claim ${JSON.stringify({ index: this.index, role, use, bay, ...recipe, sealedTree: state.sealedTree, seal, cold, stopped: this.stopped, installed: Boolean(ran), written: changed.written.length, deleted: changed.deleted, crates: crates(bay, [...changed.written, ...layered]) })}`);
    return { bay, failed: failed ?? null };
  }

  /** Ends a role's last use: a source its commands touched gets a new mtime, and packages they changed are installed anew. */
  finish(role) {
    const { bay, sources, packages } = this.roles[role];
    const touched = Object.entries(sources).filter(([path, text]) => {
      try {
        return stamp(join(bay, path)).text !== text;
      } catch {
        return false;
      }
    }).map(([path]) => path);
    const fresh = new Date();
    for (const path of touched) if (!lstatSync(join(bay, path)).isSymbolicLink()) utimesSync(join(bay, path), fresh, fresh);
    if (packages !== null && installed(bay) !== packages) rmSync(join(bay, 'node_modules/.deep-bay-installed'), { force: true });
    return touched.length;
  }

  /** Seals each bay the holder used, unless `seal` is false, and gives the pair back. */
  close(status = null, seal = true) {
    try {
      for (const [role, state] of seal ? Object.entries(this.roles) : []) {
        const touched = this.finish(role);
        const now = sealOf(state.bay);
        writeFileSync(state.sealFile, JSON.stringify({ tree: state.tree, listing: Object.fromEntries(KEPT_BUILDS.map((kept) => [kept, now[kept].hash])) }));
        this.print(`BAY release ${JSON.stringify({ index: this.index, role, bay: state.bay, status, targetBytes: now.target.bytes, touched })}`);
      }
      rmSync(this.groupFile, { force: true });
    } finally {
      if (this.previous === undefined) delete process.env.DEEP_THROTTLE;
      else process.env.DEEP_THROTTLE = this.previous;
      release(this.grant);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const [role, split] = args;
  const command = args.slice(2);
  if (!['base', 'change'].includes(role) || split !== '--' || !command.length) {
    say('BLOCKED bays: usage: bays.mjs <base|change> -- <command>');
    process.exit(2);
  }
  const pair = claimPair(process.cwd(), say);
  if (pair.refused) {
    say(`NO BAY: ${pair.refused}`);
    process.exit(2);
  }
  if (pair.blocked?.startsWith('INCONCLUSIVE')) {
    say(`${pair.blocked}\n  Fix: Wait for the other sessions' proofs on this machine, then run again.`);
    process.exit(3);
  }
  if (pair.blocked) {
    say(`BLOCKED bays: ${pair.blocked}\n  Fix: Repair what the line names, then run again.`);
    process.exit(2);
  }
  let child = null;
  try {
    const { bay, failed } = pair.use(role, role);
    if (failed) {
      say(`BLOCKED bays: ${failed} in ${bay}\n  Fix: Repair the lock or the install the line names, then run again.`);
      throw Object.assign(Error(failed), { status: 2 });
    }
    // The command leads a process group of its own, named in the pair, so whatever it leaves running when this
    // process dies is stopped by the next claim.
    const env = { ...process.env };
    // The bay's builds and tests write its own target/, whatever the shell names.
    delete env.CARGO_TARGET_DIR;
    delete env.CARGO_BUILD_TARGET_DIR;
    child = spawn(command[0], command.slice(1), { cwd: bay, stdio: 'inherit', env, detached: true });
    const start = spawnSync('ps', ['-o', 'lstart=', '-p', String(child.pid)], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } }).stdout.trim();
    writeFileSync(pair.groupFile, JSON.stringify({ pid: child.pid, start }));
  } catch (error) {
    if (!error.status) say(`BLOCKED bays: ${error.message}`);
    pair.close(null, false);
    process.exit(2);
  }
  // A signal to this process is passed on to the command's group, and the bay is sealed once the command ends.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => {
    try {
      process.kill(-child.pid, signal);
    } catch {}
  });
  const end = (status) => {
    pair.close(status);
    process.exit(status);
  };
  child.on('error', (error) => {
    say(`BLOCKED bays: ${command[0]} could not start: ${error.message}`);
    end(127);
  });
  child.on('exit', (status, signal) => end(signal ? 128 + constants.signals[signal] : status));
}
