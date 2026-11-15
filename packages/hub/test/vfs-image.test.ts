// #2121's crash tests enter the VFS from a real, closed WAL ledger. Opening its image must not flush it or
// change the FULL/NORMAL durability boundary: use real SQLite transactions, discard only the memory connection.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { testVfs } from '../src/vfs.js';

it('the VFS opens a closed WAL image, preserving FULL commits and losing later NORMAL commits at a cut', () => {
  const dir = mkdtempSync('/tmp/vfs-image-'), path = join(dir, 'ledger.db');
  let memory: Database.Database | undefined;
  try {
    const disk = new Database(path);
    disk.pragma('journal_mode = WAL');
    disk.exec("CREATE TABLE events (log_pos INTEGER PRIMARY KEY, id TEXT); CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); INSERT INTO events VALUES (1, 'before')");
    disk.close();
    const before = readFileSync(path);
    expect([before[18], before[19]]).toEqual([2, 2]);
    const backend = testVfs({ cutAfter: Number.MAX_SAFE_INTEGER }).backend()!;
    expect(() => { memory = backend.open(path); }, 'a WAL image must be usable by the in-memory crash backend').not.toThrow();
    expect(memory!.prepare('SELECT id FROM events ORDER BY log_pos').pluck().all()).toEqual(['before']);
    expect(readFileSync(path), 'opening an image is not a write to the real ledger').toEqual(before);
    backend.commit(memory!, 'full', () => memory!.prepare('INSERT INTO events VALUES (?, ?)').run(2, 'full'));
    backend.commit(memory!, 'normal', () => memory!.prepare('INSERT INTO events VALUES (?, ?)').run(3, 'normal'));
    expect(memory!.prepare('SELECT id FROM events ORDER BY log_pos').pluck().all()).toEqual(['before', 'full', 'normal']);
    // No backend.close: that is a clean flush, whereas a cut loses the in-memory connection alone.
    memory!.close();
    memory = testVfs({}).backend()!.open(path);
    expect(memory.prepare('SELECT id FROM events ORDER BY log_pos').pluck().all()).toEqual(['before', 'full']);
  } finally {
    if (memory?.open) memory.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
