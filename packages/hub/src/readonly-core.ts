// A record a newer version wrote (#41): a log holding an event kind at a schema version newer than this build knows
// is opened read-only. The hub still starts and answers health and status, every gate is watch-only, nothing is
// appended, and the backup the installer took before the newer version's first write is offered by its path.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { listSchemas } from '@deepbuild/contracts';
import { fit, type Part } from './context-fit.js';
import { rootOf } from './paths.js';
import type { CoreOptions } from './wire.js';

type Obj = Record<string, unknown>;
interface Unreadable { newer: { kind: string; v: number }[]; backup: string | null; reason: string }

/** The kinds this build knows, each with the newest version it can read. */
function newestKnown(): Map<string, number> {
  const known = new Map<string, number>();
  for (const { name } of listSchemas()) {
    const at = /^(.+)@(\d+)$/.exec(name);
    if (at) known.set(at[1]!, Math.max(known.get(at[1]!) ?? 0, Number(at[2])));
  }
  return known;
}

/** The newest finished backup under `<root>/backups/`: one holding ledger.db, names sorting in the order taken. */
function newestBackup(dir: string): string | null {
  const folder = join(dir, 'backups');
  if (!existsSync(folder)) return null;
  const done = readdirSync(folder).filter((name) => existsSync(join(folder, name, 'ledger.db'))).sort();
  return done.length ? join(folder, done[done.length - 1]!) : null;
}

/**
 * The kinds the ledger holds at a version newer than this build reads, read through a read-only connection so the
 * check itself writes nothing; null when there are none or no ledger yet. A kind this build doesn't know at all is
 * an extension's and isn't judged here.
 */
export function unreadable(options: CoreOptions): Unreadable | null {
  const root = rootOf(options.root);
  if (options.plant === 'append-unknown-kind' || !existsSync(root.ledger)) return null;
  const db = new Database(root.ledger, { readonly: true, fileMustExist: true });
  let rows: { kind: string; v: number }[];
  try {
    db.pragma('cache_size = -2000');
    const has = db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'events'").get();
    rows = has ? (db.prepare('SELECT kind, max(v) AS v FROM events GROUP BY kind').all() as { kind: string; v: number }[]) : [];
  } finally {
    db.close();
  }
  const known = newestKnown();
  const newer = rows.filter(({ kind, v }) => known.has(kind) && v > known.get(kind)!);
  if (!newer.length) return null;
  const backup = newestBackup(root.dir);
  const named = newer.map(({ kind, v }) => `${kind} v${v}`).join(', ');
  const offer = backup ? `restore the backup taken before that version's first write, ${backup}, with deep restore` : 'no backup from before that version was found under backups/';
  return { newer, backup, reason: `BLOCKED: read-only: the record holds ${named}, newer than this version reads; every gate is watch-only and nothing is appended. Go back to the newer version, or ${offer}.` };
}

/** The core's stand-in while the record is read-only: every gate watch-only, every reply empty, nothing appended. */
export class ReadOnlyCore {
  constructor(private readonly why: Unreadable) {}
  started(): Promise<void> { return Promise.resolve(); }
  hooks(): string[] { return []; }
  health(): Promise<Obj> {
    return Promise.resolve({ gates: { watch_only: true, reason: this.why.reason }, record: { read_only: true, newer: this.why.newer, backup: this.why.backup } });
  }
  call(method: string): Promise<unknown> {
    if (method === 'hub.health' || method === 'health') return this.health();
    return Promise.reject(Error(this.why.reason));
  }
  mcpHello(): Promise<string | null> { return Promise.resolve(null); }
  extensionHook(): Promise<null> { return Promise.resolve(null); }
  hookReply(): Promise<Obj> { return Promise.resolve({}); }
  /** No record to keep the rest in: the parts joined as they came (#1296). */
  fitContext(_meta: unknown, parts: Part[], join: string): Promise<string> { return Promise.resolve(fit(parts, Infinity, join).inline); }
  toolGate(): Promise<Obj> { return Promise.resolve({}); }
  permission(): Promise<{ decision: 'none' }> { return Promise.resolve({ decision: 'none' }); }
  paseoOwner(): Promise<string | null> { return Promise.resolve(null); }
  paseoAppAnswer(): Promise<Obj> { return Promise.resolve({}); }
  subscribe(): Promise<{ head?: number; snapshot?: true }> { return Promise.resolve({}); }
  waitsState(): Promise<{ history: [string, number][]; sessions: never[] }> { return Promise.resolve({ history: [], sessions: [] }); }
  lockLost(): void {}
  stop(): Promise<void> { return Promise.resolve(); }
  hook(): Promise<void> { return Promise.resolve(); }
  replayed(): Promise<void> { return Promise.resolve(); }
  waiterGone(): void {}
  notifierGone(): void {}
  callGone(): void {}
  hookGone(): void {}
  overrun(): Promise<void> { return Promise.resolve(); }
  later(): void {}
  line(): Promise<void> { return Promise.resolve(); }
  unsubscribe(): void {}
  denied(): void {}
}
