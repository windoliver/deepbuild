// `deep backup` and `deep restore` (#572). A backup is the record through SQLite's online backup on the hub's writer
// connection, never a copy of the file, with the evidence and wiki folders. A restore puts them back with the hub
// stopped, its lock held so none starts meanwhile, once the OS confirms you: the hub isn't there to ask, so this
// process asks, as the hub does (confirm.ts). deep-hook's floor denies an agent's `deep restore` (#317). The restored
// record counts as one after a power cut, and its generation is raised above the backup's and the replaced one's.
// The record a restore replaces is kept (#3459): its ledger, evidence and wiki move by rename into one folder in a
// backup's layout, so `deep restore` of that folder puts it back, and the sentence you confirm says what goes.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { prepareRestore, restoreLoss, resumeRestore, type PreparedRestore, type RestoreLoss } from '@deepbuild/record';
import { writtenOf } from '@deepbuild/wiki';
import { call, notAnswered, withPrompt } from './client.js';
import { Confirmer } from './confirm.js';
import { takeLock } from './lock.js';
import { dropTestSettings, hubAddress, hubControl, installedRoot, rootOf, type Root } from './paths.js';
import { activePlant } from './plant.js';
import { Devices } from './trusted.js';
import { startOf, type VfsSettings } from './wire.js';
import { copySynced, disk, syncPath, testVfs, writeSynced } from './vfs.js';

/** The folders a backup holds beside the record. */
const FOLDERS = ['evidence', 'wiki'] as const;

/** `deep backup <folder>`: through the running hub, into an empty folder. */
export async function backupCommand(args: readonly string[]): Promise<number> {
  // A flag where the folder goes is a usage error, never a folder named for it (#2200). The planted
  // dispatches-before-help (#1359) still hands its flag on, as the wrong program it plants.
  const flag = args[0]?.startsWith('-') && activePlant() !== 'dispatches-before-help';
  if (args.length !== 1 || !args[0] || flag) {
    process.stderr.write('Usage: deep backup <folder>\n');
    return 2;
  }
  const folder = resolve(args[0]);
  try {
    const { path: socket, token } = hubControl(null);
    const reply = await call(socket, token, 'record.backup', { folder });
    if ('error' in reply) {
      process.stderr.write(`deep backup: ${reply.error.remediation}\n`);
      return 1;
    }
  } catch (error) {
    return notAnswered(error, hubAddress(null).path);
  }
  process.stdout.write(`Backed up the record, its evidence and its wiki to ${folder}. deep restore ${folder} puts them back.\n`);
  return 0;
}

/** A time as the sentence names it, to the minute in UTC. */
const utc = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const events = (n: number): string => `${n} event${n === 1 ? '' : 's'}`;

/** What the restore would take away from the record there, as the sentence you confirm says it (#3459). */
function lossSaid(loss: RestoreLoss, keeps: boolean): string {
  if (loss.kind === 'none') return keeps ? ', whose record holds no events yet' : ', where there is no record yet';
  if (loss.kind === 'other') return `: the backup was not taken from this record, which holds ${events(loss.events)}`;
  if (!loss.events) return ', which holds no event past the backup\'s last';
  return `, which holds ${events(loss.events)} past the backup's last, the newest at ${utc(loss.newest ?? 0)}`;
}

/**
 * Where the replaced record goes, and the folder kept from an earlier restore that it replaces, by the day it was made:
 * deleted, or, where that folder is the one restored, put back in its place.
 */
function keptSaid(root: Root, folder: string): string {
  if (!existsSync(root.kept)) return `; the replaced record is kept in ${root.kept}`;
  const at = statSync(root.kept);
  const day = new Date(at.birthtimeMs || at.mtimeMs).toISOString().slice(0, 10);
  return `; the replaced record is kept in ${root.kept}, in place of the one kept there on ${day}, which ${folder === root.kept ? 'this restore puts back' : 'is deleted'}`;
}

/** `deep restore <folder>`: with the hub stopped and the OS confirming you, the backup in place of the record. */
export async function restoreCommand(args: readonly string[]): Promise<number> {
  if (args.length !== 1 || !args[0]) {
    process.stderr.write('Usage: deep restore <folder>\n');
    return 2;
  }
  const folder = resolve(args[0]);
  const from = join(folder, 'ledger.db');
  const root = rootOf(installedRoot());
  // A restore cut off midway finishes from what it readied beside the record, whatever its folder holds now. Its
  // marker names its folder, then `kept` where it keeps the record it replaces; one without that line keeps nothing.
  const marker = existsSync(root.restoring) ? readFileSync(root.restoring, 'utf8').split('\n') : undefined;
  const cut = marker?.[0]?.trim();
  if (cut !== undefined && cut !== folder) {
    process.stderr.write(`deep restore changed nothing: a restore from ${cut} didn't finish. Run deep restore ${cut} to finish it first.\n`);
    return 1;
  }
  // A backup writes ledger.db last, once its folders are copied: without it the folder holds no finished backup.
  if (cut === undefined && !existsSync(from)) {
    process.stderr.write(`deep restore changed nothing: ${folder} holds no finished backup (no ledger.db).\n`);
    return 2;
  }
  // Without the marker nothing was moved into the folder the replaced record moves into; one that holds files was
  // filled by hand, and stays as it is.
  if (cut === undefined && existsSync(root.keeping) && readdirSync(root.keeping).length) {
    process.stderr.write(`deep restore changed nothing: ${root.keeping} holds files no restore is moving. Move them out, then run deep restore again.\n`);
    return 1;
  }
  // Where there is no record there is nothing to keep, and the folder an earlier restore kept stays as it is.
  const keeps = cut === undefined ? existsSync(root.ledger) : marker?.[1]?.trim() === 'kept';
  mkdirSync(root.dir, { recursive: true, mode: 0o700 });
  const lock = takeLock(root.lock);
  if (!lock) {
    process.stderr.write('deep restore changed nothing: the hub is running. Stop it with deep hub stop, then run deep restore again.\n');
    return 1;
  }
  const staged = (name: string) => join(root.dir, `${name}.restoring`);
  // What the wiki last wrote, kept beside its folder (#356), goes with it, so no restored page reads as your edit.
  const written = { from: writtenOf(join(folder, 'wiki')), staged: writtenOf(staged('wiki')), to: writtenOf(root.wiki) };
  let prepared: PreparedRestore | undefined;
  try {
    dropTestSettings(root.dir);
    const durable = process.env.DEEP_HUB_TEST_VFS ? testVfs(JSON.parse(process.env.DEEP_HUB_TEST_VFS) as VfsSettings) : disk;
    const confirmer = new Confirmer({ devices: new Devices(root.devices), key: root.confirmKey, ...(process.env.DEEP_HUB_TEST_CONFIRM ? { stub: process.env.DEEP_HUB_TEST_CONFIRM } : {}), ...(process.env.DEEP_HUB_TEST_POLKIT ? { polkit: process.env.DEEP_HUB_TEST_POLKIT } : {}) });
    const self = { pid: process.pid, start: (await startOf(process.pid)) ?? '' };
    const sentence = cut === undefined
      ? `restore DeepBuild's record from ${folder}, replacing the one in ${root.dir}${lossSaid(restoreLoss(from, root.ledger), keeps)}${keeps ? keptSaid(root, folder) : ''}`
      : `finish restoring DeepBuild's record from ${folder} into ${root.dir}, a restore cut off midway${keeps ? `; the record it replaced is kept in ${root.kept}` : ''}`;
    const why = await withPrompt(() => confirmer.you(sentence, { handle: `restore:${folder}`, revision: root.dir, process: self }));
    if (why) {
      process.stderr.write(`deep restore changed nothing: the OS didn't confirm you (${why}). Run it again and confirm.\n`);
      return 3;
    }
    if (cut === undefined) {
      // Everything is readied beside its place, on disk, first, so a failure up to here leaves the record as it was.
      for (const name of FOLDERS) {
        rmSync(staged(name), { recursive: true, force: true });
        await copySynced(join(folder, name), staged(name));
      }
      rmSync(written.staged, { force: true });
      if (existsSync(written.from)) copyFileSync(written.from, written.staged);
      prepared = await prepareRestore(from, root.ledger);
      // The folder the replaced record moves into, made before the marker: with the marker, its being there means the
      // move aside hasn't finished; without it, nothing was moved into it.
      if (existsSync(root.keeping)) rmdirSync(root.keeping);
      if (keeps) mkdirSync(root.keeping, { mode: 0o700 });
      syncPath(root.dir);
      // From here the record and its folders change one by one; the marker stops a hub starting on a mix of the two.
      writeSynced(root.restoring, Buffer.from(`${folder}\n${keeps ? 'kept\n' : ''}`));
    } else {
      prepared = resumeRestore(root.ledger);
      // A marker written before restores kept anything (#572) staged no wiki file: the backup's, as that restore did.
      if (!keeps && !existsSync(written.staged) && existsSync(written.from)) copyFileSync(written.from, written.staged);
    }
    // The replaced record moves aside whole, by rename: nothing of it is copied or deleted (#3459).
    if (keeps && existsSync(root.keeping)) {
      const aside: [string, string][] = [[root.ledger, 'ledger.db'], [`${root.ledger}-wal`, 'ledger.db-wal'], [root.evidence, 'evidence'], [root.wiki, 'wiki'], [written.to, basename(writtenOf(join(root.keeping, 'wiki')))]];
      for (const [at, name] of aside) if (existsSync(at)) renameSync(at, join(root.keeping, name));
      rmSync(`${root.ledger}-shm`, { force: true });
      syncPath(root.keeping);
      // One kept folder: the one an earlier restore kept goes, as the sentence you confirmed said.
      rmSync(root.kept, { recursive: true, force: true });
      renameSync(root.keeping, root.kept);
      syncPath(root.dir);
    }
    durable.point('restore_aside');
    prepared.put();
    for (const name of FOLDERS) {
      // On a rerun, a folder with nothing staged was already put in place.
      if (!existsSync(staged(name)) && cut !== undefined) continue;
      rmSync(join(root.dir, name), { recursive: true, force: true });
      if (existsSync(staged(name))) renameSync(staged(name), join(root.dir, name));
    }
    if (existsSync(written.staged)) renameSync(written.staged, written.to);
    else if (!keeps) rmSync(written.to, { force: true });
    // How far the replaced record's hub read each transcript is ahead of the restored record: a session is read from
    // where the next hub meets it, as after a power cut.
    rmSync(root.transcripts, { force: true });
    syncPath(root.dir);
    rmSync(root.restoring);
    syncPath(root.dir);
    process.stdout.write(`Restored the record, its evidence and its wiki from ${folder}, at generation ${prepared.generation}. It counts as a record after a power cut: each claim open in it reads INVALID, cause events lost, once the hub starts. Start it with deep hub start.\n`);
    if (keeps) process.stdout.write(`The record it replaced, with its evidence and its wiki, is kept in ${root.kept}: deep restore ${root.kept} puts it back.\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`deep restore: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    // What was readied and not put in place is dropped; a cut-off swap keeps its marker, and a rerun finishes it.
    if (!existsSync(root.restoring)) {
      prepared?.discard();
      for (const name of FOLDERS) rmSync(staged(name), { recursive: true, force: true });
      rmSync(written.staged, { force: true });
      // Empty by then: without the marker nothing was moved into it. Should it not be, it stays, and the next restore names it.
      try { if (existsSync(root.keeping)) rmdirSync(root.keeping); } catch { /* named before the next restore asks */ }
    }
    lock.release();
  }
}
