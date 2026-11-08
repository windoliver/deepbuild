// Shards (docs/parallel-proof.md, section 7a): fixed-path test workspaces, ~/deepbuild-shards/<k>/, so the alone block's
// folders run side by side, one shard each, instead of one at a time. A folder is alone because a sibling's cargo build
// rewrites target/debug/<bin> under it; in its own shard it has its own target/, which no other shard's build touches.
// Each use makes the shard the worktree's exact tree through git (prepare), keeps its target/ across runs, and clones
// the worktree's package builds copy-on-write, and its node_modules when the lock's bytes changed. A
// shard stays at its path, so a warm target/ keeps CARGO_MANIFEST_DIR true and its first builds are its only cold ones.
// Each shard is held by a lock naming its holder's pid and start, so two runs on the machine never share one, and a
// dead holder's is taken. `node shards.mjs <root> <k>` prepares shard k, as claimShards runs it, one child per shard.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exactTree } from './lanes.mjs';
import { git, listFiles } from './proof-change.mjs';

const folder = () => join(homedir(), 'deepbuild-shards');
// What a shard adds once its tests have built their binaries at its path: deep-hook and deep-show, which most alone
// tests build, took 3.4 GB beside the clone it shares on 2026-11-07; the whole workspace, 6 to 7 GB.
const SHARD_BYTES = 5e9;
// The machine's disk floor (#1017's, packages/hub/src/products.ts): no shard is made that would take free space under it.
// DEEP_TEST_SHARD_FLOOR sets it in bytes (tests only), so a test's shards don't hang on the machine's free space.
const FLOOR = Number(process.env.DEEP_TEST_SHARD_FLOOR ?? 30e9);
const freeBytes = () => {
  const stat = statfsSync(homedir());
  return stat.bavail * stat.bsize;
};
/** Whether a shard may take its next group: the disk still holds a shard's growth above the floor. */
export const roomy = () => freeBytes() - SHARD_BYTES >= FLOOR;
const startOf = (pid) => spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } }).stdout.trim();
/** Copy-on-write, on APFS one clone per file: a folder of the worktree's into the shard, replacing it. */
const clone = (from, to) => {
  rmSync(to, { recursive: true, force: true });
  if (!existsSync(from)) return;
  const result = spawnSync('cp', ['-c', '-R', '-p', from, to], { encoding: 'utf8' });
  if (result.status !== 0) throw Error(`cp -c ${from} failed: ${result.stderr.trim()}`);
};

/**
 * Takes shard k's lock for this process, or null when a live process holds it. The lock is a folder, made by one mkdir
 * only one process wins, naming its holder by pid and start. A dead holder's is moved aside by a rename only one process
 * makes, and moved back when what was moved is no longer the lock judged dead.
 */
function lock(k) {
  const dir = join(folder(), `${k}.lock`);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, 'holder.json'), JSON.stringify({ pid: process.pid, start: startOf(process.pid) }));
      return dir;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let seen, holder = null;
    try {
      seen = statSync(dir).ino;
      holder = JSON.parse(readFileSync(join(dir, 'holder.json'), 'utf8'));
    } catch {}
    // A lock with no holder named yet is being made, so it is live.
    if (!holder || startOf(holder.pid) === holder.start) return null;
    const aside = `${dir}.gone.${process.pid}`;
    try {
      renameSync(dir, aside);
      if (statSync(aside).ino !== seen) renameSync(aside, dir);
      else rmSync(aside, { recursive: true, force: true });
    } catch {}
  }
  return null;
}

/**
 * Shard k made the worktree's exact tree, its lock already held: returns the line its run prints. The tree is what
 * lanes.mjs's exactTree hashes, HEAD with the uncommitted and untracked files, and git writes it into the shard, by a
 * commit of it in the shard's own .git, whose objects it reads from the repository's and never writes there: a hard
 * reset to it writes what differs by git's stat cache (size, mtime, ctime, inode), so a file a run changed is put back
 * however it was changed, and a clean removes what a run left. A mixed reset to the worktree's HEAD then leaves the
 * shard's git status the worktree's own. A new shard's files are cloned copy-on-write first, read once by the reset.
 */
function prepare(root, k) {
  const dir = join(folder(), String(k));
  const made = existsSync(join(dir, '.git'));
  const tree = exactTree(root);
  if (!tree) throw Error(`git can't write ${root}'s tree`);
  if (!made) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(root).filter((name) => name !== '.git')) clone(join(root, name), join(dir, name));
    // Incremental data is keyed by the crate's path, so at the shard's path it is never read, only rewritten.
    rmSync(join(dir, 'target/debug/incremental'), { recursive: true, force: true });
    git(dir, ['init', '-q', '--template=', dir]);
    mkdirSync(join(dir, '.git/objects/info'), { recursive: true });
    writeFileSync(join(dir, '.git/objects/info/alternates'), `${join(resolve(root, git(root, ['rev-parse', '--git-common-dir']).trim()), 'objects')}\n`);
  }
  // The refs and HEAD are the worktree's, as one packed-refs file, sorted by name as git keeps it.
  const refs = git(root, ['for-each-ref', '--format=%(objectname) %(refname)']).split('\n').filter(Boolean).sort((a, b) => (a.split(' ')[1] < b.split(' ')[1] ? -1 : 1));
  writeFileSync(join(dir, '.git/packed-refs'), `# pack-refs with: peeled fully-peeled sorted \n${refs.join('\n')}\n`);
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const own = ['-c', 'user.name=DeepBuild shard', '-c', 'user.email=shard@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
  const commit = git(dir, [...own, 'commit-tree', tree, '-p', head, '-m', 'shard']).trim();
  git(dir, ['update-ref', '--no-deref', 'HEAD', commit]);
  git(dir, ['reset', '-q', '--hard', commit]);
  git(dir, ['clean', '-fdq']);
  git(dir, ['reset', '-q', head]);
  // node_modules goes with the lock's bytes, the way a bay's install does: cloned anew only when they changed.
  const lockHash = existsSync(join(root, 'package-lock.json')) ? createHash('sha256').update(readFileSync(join(root, 'package-lock.json'))).digest('hex') : '';
  const marker = join(dir, 'node_modules/.deep-shard-lock');
  const packages = !existsSync(marker) || readFileSync(marker, 'utf8') !== lockHash;
  if (packages) {
    clone(join(root, 'node_modules'), join(dir, 'node_modules'));
    writeFileSync(marker, lockHash);
  }
  for (const path of listFiles(root).filter((path) => /^packages\/[^/]+\/package\.json$/.test(path))) clone(join(root, path.replace('package.json', 'dist')), join(dir, path.replace('package.json', 'dist')));
  return `SHARD ${k} ${dir}: ${made ? 'reused' : 'made'}, at tree ${tree}${packages ? ', node_modules cloned' : ''}`;
}

/**
 * Up to `want` shards made `root`'s tree, each as { dir, release }: free ones that exist first, then new ones, each
 * only while the disk holds one more above its floor, all made ready at once, each in a child of its own. `say` gets
 * one line per shard.
 */
export async function claimShards(root, want, say) {
  mkdirSync(folder(), { recursive: true });
  const existing = readdirSync(folder()).filter((name) => /^\d+$/.test(name)).map(Number);
  const held = [];
  // Every shard in use, new or reused, can grow by what its tests build, so each one taken needs its room above the floor.
  for (let k = 1, room = Math.max(0, Math.floor((freeBytes() - FLOOR) / SHARD_BYTES)); held.length < want && k <= want + existing.length; k++) {
    if (!room) {
      say(`SHARD ${k} not used: ${(freeBytes() / 1e9).toFixed(0)} GB free, and a shard needs ${SHARD_BYTES / 1e9} GB above the ${FLOOR / 1e9} GB floor`);
      break;
    }
    const taken = lock(k);
    if (!taken) continue;
    room -= 1;
    held.push({ k, dir: join(folder(), String(k)), lock: taken });
  }
  const ready = await Promise.all(held.map(({ k, dir, lock: taken }) => new Promise((done) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), root, String(k)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('close', (status) => {
      if (status === 0) return say(out.trim()), done({ dir, release: () => rmSync(taken, { recursive: true, force: true }) });
      rmSync(taken, { recursive: true, force: true });
      say(`SHARD ${k} not used: ${out.trim().split('\n').at(-1)}`);
      done(null);
    });
  })));
  return ready.filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [root, k] = process.argv.slice(2);
  try {
    console.log(prepare(root, Number(k)));
  } catch (error) {
    console.log(error.message);
    process.exit(1);
  }
}
