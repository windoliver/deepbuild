// `deep backup` and `deep restore` (#572). A backup is the record through SQLite's online backup on the hub's writer
// connection, never a copy of the file, with the evidence and wiki folders. A restore puts them back with the hub
// stopped, its lock held so none starts meanwhile, once the OS confirms you: the hub isn't there to ask, so this
// process asks, as the hub does (confirm.ts). deep-hook's floor denies an agent's `deep restore` (#317). The restored
// record counts as one after a power cut, and its generation is raised above the backup's and the replaced one's.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { prepareRestore, type PreparedRestore } from '@deepbuild/record';
import { writtenOf } from '@deepbuild/wiki';
import { call } from './client.js';
import { confirmYou } from './confirm.js';
import { takeLock } from './lock.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { copySynced, syncPath, writeSynced } from './vfs.js';

/** The folders a backup holds beside the record. */
const FOLDERS = ['evidence', 'wiki'] as const;

/** `deep backup <folder>`: through the running hub, into an empty folder. */
export async function backupCommand(args: readonly string[]): Promise<number> {
  if (args.length !== 1 || !args[0]) {
    process.stderr.write('Usage: deep backup <folder>\n');
    return 2;
  }
  const folder = resolve(args[0]);
  const root = rootOf(installedRoot());
  try {
    const reply = await call(hubAddress(null).path, readFileSync(root.token, 'utf8').trim(), 'record.backup', { folder });
    if ('error' in reply) {
      process.stderr.write(`deep backup: ${reply.error.remediation}\n`);
      return 1;
    }
  } catch (error) {
    process.stderr.write(`deep backup: no hub answered (${error instanceof Error ? error.message : String(error)}); the record is backed up through the hub. Start it with deep hub start, then run deep backup again.\n`);
    return 1;
  }
  process.stdout.write(`Backed up the record, its evidence and its wiki to ${folder}. deep restore ${folder} puts them back.\n`);
  return 0;
}

/** `deep restore <folder>`: with the hub stopped and the OS confirming you, the backup in place of the record. */
export async function restoreCommand(args: readonly string[]): Promise<number> {
  if (args.length !== 1 || !args[0]) {
    process.stderr.write('Usage: deep restore <folder>\n');
    return 2;
  }
  const folder = resolve(args[0]);
  const from = join(folder, 'ledger.db');
  // A backup writes ledger.db last, once its folders are copied: without it the folder holds no finished backup.
  if (!existsSync(from)) {
    process.stderr.write(`deep restore changed nothing: ${folder} holds no finished backup (no ledger.db).\n`);
    return 2;
  }
  const root = rootOf(installedRoot());
  mkdirSync(root.dir, { recursive: true, mode: 0o700 });
  const lock = takeLock(root.lock);
  if (!lock) {
    process.stderr.write('deep restore changed nothing: the hub is running. Stop it with deep hub stop, then run deep restore again.\n');
    return 1;
  }
  const staged = (name: string) => join(root.dir, `${name}.restoring`);
  let prepared: PreparedRestore | undefined;
  try {
    const why = await confirmYou(`restore DeepBuild's record from ${folder}, replacing the one in ${root.dir}`, process.env.DEEP_HUB_TEST_CONFIRM);
    if (why) {
      process.stderr.write(`deep restore changed nothing: the OS didn't confirm you (${why}). Run it again and confirm.\n`);
      return 3;
    }
    // Everything is readied beside its place, on disk, first, so a failure up to here leaves the record as it was.
    for (const name of FOLDERS) {
      rmSync(staged(name), { recursive: true, force: true });
      await copySynced(join(folder, name), staged(name));
    }
    // What the wiki last wrote, kept beside its folder (#356), comes back with it, so no restored page reads as your edit.
    const written = { from: writtenOf(join(folder, 'wiki')), to: writtenOf(root.wiki) };
    prepared = await prepareRestore(from, root.ledger);
    // From here the record and its folders change one by one; the marker stops a hub starting on a mix of the two.
    writeSynced(root.restoring, Buffer.from(`${folder}\n`));
    prepared.put();
    for (const name of FOLDERS) {
      rmSync(join(root.dir, name), { recursive: true, force: true });
      if (existsSync(staged(name))) renameSync(staged(name), join(root.dir, name));
    }
    rmSync(written.to, { force: true });
    if (existsSync(written.from)) copyFileSync(written.from, written.to);
    // How far the replaced record's hub read each transcript is ahead of the restored record: a session is read from
    // where the next hub meets it, as after a power cut.
    rmSync(root.transcripts, { force: true });
    syncPath(root.dir);
    rmSync(root.restoring);
    syncPath(root.dir);
    process.stdout.write(`Restored the record, its evidence and its wiki from ${folder}, at generation ${prepared.generation}. It counts as a record after a power cut: each claim open in it reads INVALID, cause events lost, once the hub starts. Start it with deep hub start.\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`deep restore: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    // What was readied and not put in place is dropped; a cut-off swap keeps its marker, and a rerun finishes it.
    if (!existsSync(root.restoring)) {
      prepared?.discard();
      for (const name of FOLDERS) rmSync(staged(name), { recursive: true, force: true });
    }
    lock.release();
  }
}
