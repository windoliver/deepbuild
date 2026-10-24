// The hub's durable writes, numbered. On a real disk a durable write point is just a write; under the design's
// test VFS (DEEP_HUB_TEST_VFS) each point is appended to a points file as it is made, the process can be cut
// right after any one of them as by kill -9, every sync can be held, and every write can be refused, as on a
// full disk. The ledger then lives in memory, and only what a FULL commit made durable reaches ledger.db, so a
// cut loses exactly what a power cut would: every NORMAL commit after the last FULL one.
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import type { Backend } from '@deepbuild/record';
import type { VfsSettings } from './wire.js';

export type PointKind = 'commit' | 'log_pos_block' | 'spool_read' | 'spool_removal' | 'evidence_rename' | 'rules_rewrite';

export interface Durable {
  /** Marks a durable write point just made. */
  point(kind: PointKind, detail?: { mode?: 'full' | 'normal'; ids?: string[] }): void;
  /** One sync's worth of waiting, as a WAL checkpoint costs. */
  sync(): void;
  /** True when a write can be made durable in `dir` now. */
  probe(dir: string): boolean;
  /** The record's storage, or undefined for its own file storage. */
  backend(): Backend | undefined;
}

/** A real disk: points are plain writes, and the probe writes and syncs a small file. */
export const disk: Durable = {
  point() {},
  sync() {},
  probe(dir) {
    const file = join(dir, '.write-probe');
    try {
      const fd = openSync(file, 'w', 0o600);
      try {
        writeSync(fd, 'probe');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      rmSync(file, { force: true });
      return true;
    } catch {
      return false;
    }
  },
  backend: () => undefined,
};

type Db = Database.Database;

/** Writes `bytes` to `path` whole and synced: a temp file, fsync, then a rename. */
export function writeSynced(path: string, bytes: Uint8Array): void {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  // The rename lasts only once its folder is synced too.
  const dir = openSync(dirname(path), 'r');
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}

export function testVfs(settings: VfsSettings): Durable {
  let n = 0;
  const held = new Int32Array(new SharedArrayBuffer(4));
  // Held open: a file open can cost milliseconds on a watched disk, and every commit is a point.
  const points = settings.points ? openSync(settings.points, 'a') : undefined;
  const refusing = () => settings.refuse !== undefined && existsSync(settings.refuse);
  const vfs: Durable = {
    point(kind, detail = {}) {
      n++;
      if (points !== undefined) writeSync(points, `${JSON.stringify({ n, kind, ...detail })}\n`);
      // Right after point n the process ends as by kill -9: nothing after it, and nothing unsynced, survives.
      if (settings.cutAfter === n) {
        process.kill(process.pid, 'SIGKILL');
        // The signal lands a moment later: this thread makes no further write meanwhile.
        Atomics.wait(held, 0, 0);
      }
    },
    sync() {
      if (settings.syncDelayMs) Atomics.wait(held, 0, 0, settings.syncDelayMs);
    },
    probe: () => !refusing(),
    backend() {
      let file: string | undefined;
      const scalar = (db: Db, sql: string): unknown => {
        try {
          return db.prepare(sql).pluck().get();
        } catch {
          return undefined;
        }
      };
      return {
        name: 'test-vfs',
        open(path) {
          file = path;
          // What a FULL commit last wrote is what the disk holds.
          const db = existsSync(path) && statSync(path).size > 0 ? new Database(readFileSync(path)) : new Database(':memory:');
          db.pragma('synchronous = NORMAL');
          return db;
        },
        commit(db, mode, work) {
          const before = Number(scalar(db, 'SELECT coalesce(max(log_pos), 0) FROM events') ?? 0);
          const block = scalar(db, "SELECT value FROM meta WHERE key = 'log_block_end'");
          db.transaction(() => {
            work();
            // A refused write fails at the commit, after the body ran, as a disk's does.
            if (refusing()) throw Error('SQLITE_IOERR: the test VFS refuses writes');
          })();
          const ids = db.prepare('SELECT id FROM events WHERE log_pos > ? ORDER BY log_pos').pluck().all(before) as string[];
          if (mode === 'full') {
            vfs.sync();
            // The image reaches ledger.db at once only when a cut is set up, the one way this process ends
            // without its close; otherwise the close writes it, so a sync costs its delay, not the ledger's size.
            if (settings.cutAfter !== undefined) writeSynced(file!, db.serialize());
          }
          vfs.point(!ids.length && scalar(db, "SELECT value FROM meta WHERE key = 'log_block_end'") !== block ? 'log_pos_block' : 'commit', { mode, ids });
        },
        close(db) {
          // A clean close is a sync: the record commits FULL before it closes, so this writes nothing new.
          if (file && db.open) writeSynced(file, db.serialize());
          db.close();
        },
      };
    },
  };
  return vfs;
}
