// The storage the record writes through: better-sqlite3 behind a small interface, so the hub core takes
// its storage by injection (design: Fault injection). The record's own storage is the OS file system in
// WAL mode; the test storage is the design's test VFS, which keeps every write in memory until a sync
// and drops the rest at a power cut.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;
export type Durability = 'full' | 'normal';

/** The storage the record writes through. Opaque to its callers; the record's own is the default. */
export interface Storage { readonly name: string }
export interface SyncCall { file: string; mode: 'full' | 'plain' }
/** The design's test VFS: keeps each file's writes in memory until that file's sync, and drops the rest at a cut. */
export interface TestStorage extends Storage {
  cutPower(): void;
  syncs(): SyncCall[];
  refuseWrites: boolean;
}

/** What a Storage is to the record: it opens a database, commits with a durability, and closes it. */
export interface Backend extends Storage {
  open(path: string): Db;
  /** Runs `work` in one transaction that commits with the durability asked for. Throws on an I/O error. */
  commit(db: Db, mode: Durability, work: () => void): void;
  close(db: Db): void;
}

export const isBackend = (storage: Storage): storage is Backend =>
  typeof (storage as Backend).open === 'function' && typeof (storage as Backend).commit === 'function';

/** The record's settings on any database it opens: WAL, NORMAL between syncs, and F_FULLFSYNC on macOS. */
function settle(db: Db): void {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  // A plain fsync on macOS leaves the write in the drive's cache; every sync here is F_FULLFSYNC.
  if (process.platform === 'darwin') db.pragma('fullfsync = ON');
  // SQLite's own 2 MB page cache, not better-sqlite3's 16 MB: the hub holds this connection open all day, and the
  // OS file cache already keeps the record's hot pages.
  db.pragma('cache_size = -2000');
}
/** One transaction at the durability asked for: synchronous=FULL around a FULL commit, NORMAL otherwise. */
function transact(db: Db, mode: Durability, work: () => void): void {
  if (mode === 'full') db.pragma('synchronous = FULL');
  try {
    db.transaction(work)();
  } finally {
    if (mode === 'full') db.pragma('synchronous = NORMAL');
  }
}
/** Whether a commit made now would sync as the design asks: synchronous=FULL, and F_FULLFSYNC on macOS. */
const fullSync = (db: Db): boolean =>
  db.pragma('synchronous', { simple: true }) === 2 && (process.platform !== 'darwin' || db.pragma('fullfsync', { simple: true }) === 1);

/** The record's own storage: a file in WAL mode. A FULL commit syncs the WAL, with fullfsync on macOS. */
export function fileStorage(): Backend {
  return {
    name: 'file',
    open(path) {
      // The record's folder may not exist yet on a first start.
      mkdirSync(dirname(path), { recursive: true });
      const db = new Database(path);
      settle(db);
      return db;
    },
    commit: transact,
    close(db) {
      db.close();
    },
  };
}

/** A read-only connection to a record file that exists: it reads the WAL a writer keeps, and writes nothing. */
export function openReadOnly(path: string): Db {
  return new Database(path, { readonly: true, fileMustExist: true });
}

/**
 * The test VFS. The live database is in memory, through the same settings and commit path as a file; a
 * FULL commit copies it to the durable image, and a power cut throws the live one away, so a NORMAL
 * commit after the last FULL one is lost, as on a disk. Each FULL commit is recorded as the sync it
 * would have made: `full` when the pragmas at commit time ask for one, `plain` when they don't.
 */
export function testStorage(): TestStorage {
  let durable: Buffer | undefined;
  let live: { path: string; db: Db } | undefined;
  const calls: SyncCall[] = [];
  const storage: TestStorage & Backend = {
    name: 'test',
    refuseWrites: false,
    cutPower() {
      if (live) {
        try { live.db.close(); } catch { /* already closed */ }
        live = undefined;
      }
    },
    syncs: () => [...calls],
    open(path) {
      // A reopen with no cut is a restart: what the live copy held is what the disk holds.
      if (live) {
        durable = live.db.serialize();
        try { live.db.close(); } catch { /* already closed */ }
      }
      const db = durable ? new Database(durable) : new Database(':memory:');
      settle(db);
      live = { path, db };
      return db;
    },
    commit(db, mode, work) {
      if (!live || live.db !== db) throw Error('SQLITE_IOERR: the power was cut');
      let synced = false;
      // A refused write fails at the commit, after the transaction's body ran, as a disk's does.
      transact(db, mode, () => {
        work();
        synced = fullSync(db);
        if (storage.refuseWrites) throw Error('SQLITE_IOERR: the storage refuses writes');
      });
      if (mode === 'full') {
        calls.push({ file: live.path, mode: synced ? 'full' : 'plain' });
        durable = db.serialize();
      }
    },
    close(db) {
      if (live && live.db === db) {
        durable = db.serialize();
        live = undefined;
      }
      try { db.close(); } catch { /* already closed */ }
    },
  };
  return storage;
}
