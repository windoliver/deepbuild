// One hub per root, held by a lock the OS holds and releases when the process dies, never a PID file: an
// exclusive SQLite transaction on the root's lock file, which takes an fcntl lock the kernel drops with the
// process, however it ends.
import { statSync } from 'node:fs';
import Database from 'better-sqlite3';

export interface Lock {
  release(): void;
  /** Whether the file at the lock's path is still the one this lock holds (same device and inode). */
  held(): boolean;
}

/** How long a start keeps trying: two starts at one instant can each refuse the other once. */
const TRY_MS = 300;

/** Takes the lock, or returns undefined when another process holds it. */
export function takeLock(path: string): Lock | undefined {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  const until = Date.now() + TRY_MS;
  for (;;) {
    const db = new Database(path, { timeout: 0 });
    try {
      db.pragma('locking_mode = EXCLUSIVE');
      db.exec('BEGIN EXCLUSIVE');
      const { dev, ino } = statSync(path);
      return {
        held() {
          try {
            const now = statSync(path);
            return now.dev === dev && now.ino === ino;
          } catch {
            return false;
          }
        },
        release() {
          try {
            db.exec('ROLLBACK');
          } finally {
            db.close();
          }
        },
      };
    } catch (error) {
      db.close();
      if ((error as { code?: string }).code !== 'SQLITE_BUSY') throw Error(`can't take the hub's lock at ${path}: ${error instanceof Error ? error.message : String(error)}`);
      // A hub holding it refuses every try; a tie between two starts clears after a random pause.
      if (Date.now() >= until) return undefined;
      Atomics.wait(pause, 0, 0, 5 + Math.floor(Math.random() * 20));
    }
  }
}
