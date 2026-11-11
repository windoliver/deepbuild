// The `./meta` entry: a record's writer generation, read through a read-only connection, and the record's error. The
// hub's event loop reads the generation for its hello without loading the store, its projections or the schemas.
import { existsSync } from 'node:fs';
import { openReadOnly } from './storage.js';

export type RecordErrorCode = 'schema' | 'forged' | 'writer' | 'conflict' | 'storage' | 'closed';

export class RecordError extends Error {
  readonly code: RecordErrorCode;
  readonly path?: string;
  readonly kind?: string;
  readonly id?: string;
  constructor(code: RecordErrorCode, message: string, named: { path?: string; kind?: string; id?: string } = {}) {
    super(message);
    this.name = 'RecordError';
    this.code = code;
    if (named.path !== undefined) this.path = named.path;
    if (named.kind !== undefined) this.kind = named.kind;
    if (named.id !== undefined) this.id = named.id;
  }
}

/**
 * What a record's meta says (#572): its writer generation, 1 for a record no restore raised, and the first log
 * position it may hand out next. A record whose meta can't be read is an error, never generation 1.
 */
export function metaOf(path: string): { generation: number; next: number } {
  const db = openReadOnly(path);
  try {
    const has = (table: string) => db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table) !== undefined;
    const value = (key: string) => (has('meta') ? (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value : undefined);
    const positive = (key: string) => {
      const said = value(key);
      const n = said === undefined ? 1 : Number(said);
      if (!Number.isSafeInteger(n) || n < 1) throw new RecordError('storage', `${path} names ${key} ${said}, not a positive integer`);
      return n;
    };
    const last = has('events') ? Number((db.prepare('SELECT coalesce(max(log_pos), 0) AS last FROM events').get() as { last: number }).last) : 0;
    return { generation: positive('generation'), next: Math.max(positive('log_block_end'), last + 1) };
  } finally {
    db.close();
  }
}

/** The writer generation the record at `path` names (#572): 1 for one that doesn't exist or never named one. */
export function writerGeneration(path: string): number {
  return existsSync(path) ? metaOf(path).generation : 1;
}
