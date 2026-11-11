// The archive's text index (#1515): every message of each session's newest archived transcript, in SQLite FTS5 in the
// ledger, rebuilt from the evidence and never a source of truth. It's contentless: the ledger keeps the trigrams and
// where each message sits, never its text, so no value a transcript holds lands in the ledger; a hit's text is read
// from the evidence copy, which also checks the match. It's the record's own table, not a projection (a
// projection reads no evidence bytes) and not a fill of index@1, which takes wiki claims. A session the index doesn't
// hold at its newest copy, or a ledger with no index at all, is read from its transcript as before, so a hit never
// depends on the index being there; the index only spares reading every transcript on every call.
import type { Db } from './storage.js';
import type { Message } from './learned.js';

/** A message an index search found: its session, its ID in that session's transcript, and what the transcript says of it. */
export interface FoundMessage extends Message { session: string }

/**
 * A character lowercased for matching, as `deep find` matches: a final sigma is a sigma. The index holds each
 * message's text folded so, a character at a time, so a substring of the folded text is exactly a match.
 */
export const foldText = (text: string): string => [...text].map((ch) => ch.toLowerCase().replace(/ς/g, 'σ')).join('');

/** #884's word rule: the words a query asks for are runs of letters and digits in any script, lowercased. */
export const queryWords = (text: string): string[] => text.normalize('NFC').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
/** A word in a script written without spaces has no boundaries to split on, so a text holds it anywhere. */
export const spaceless = (word: string): boolean => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(word);
/** Whether `text` holds every one of `wanted` as a word (#884). */
export const holdsWords = (text: string, wanted: readonly string[]): boolean => {
  const have = new Set(queryWords(text));
  const lower = text.normalize('NFC').toLowerCase();
  return wanted.every((w) => (spaceless(w) ? lower.includes(w) : have.has(w)));
};
/** Each word as the index folds text, composed or not, so every message holding it is among what the index gives. */
export const indexTerms = (wanted: readonly string[]): string[][] => wanted.map((w) => [...new Set([foldText(w), foldText(w.normalize('NFD'))])]);

const DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS archive_text USING fts5(folded, content = '', contentless_delete = 1, tokenize = 'trigram case_sensitive 1');
CREATE TABLE IF NOT EXISTS archive_messages (id INTEGER PRIMARY KEY, session TEXT NOT NULL, n INTEGER NOT NULL) STRICT;
CREATE INDEX IF NOT EXISTS archive_messages_session ON archive_messages (session);
CREATE TABLE IF NOT EXISTS archive_sessions (session TEXT PRIMARY KEY, transcript TEXT NOT NULL) STRICT;
`;
/** The tables are there, so a read-only reader can tell an index from none. */
const indexed = (db: Db): boolean => db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name IN ('archive_text', 'archive_messages', 'archive_sessions')").pluck().get() === 3;

/**
 * Brings the index up to each session's newest transcript copy: a session whose copy changed is indexed again, one
 * no copy links any more is dropped. `read` gives a copy's messages; `commit` writes one session's rows at a time,
 * so the log's own writes go between them; `stopped` ends it early, as at a close.
 */
export async function refreshIndex(db: Db, read: (sha: string) => Promise<Message[] | undefined>, commit: (work: () => void) => void, stopped: () => boolean): Promise<void> {
  commit(() => db.exec(DDL));
  const gone = db.prepare('SELECT a.session FROM archive_sessions a LEFT JOIN sessions s ON s.id = a.session WHERE s.transcript IS NULL').pluck().all() as string[];
  const stale = db.prepare('SELECT s.id, s.transcript FROM sessions s LEFT JOIN archive_sessions a ON a.session = s.id WHERE s.transcript IS NOT NULL AND a.transcript IS NOT s.transcript ORDER BY s.id').all() as { id: string; transcript: string }[];
  const drop = (session: string) => {
    db.prepare('DELETE FROM archive_text WHERE rowid IN (SELECT id FROM archive_messages WHERE session = ?)').run(session);
    db.prepare('DELETE FROM archive_messages WHERE session = ?').run(session);
    db.prepare('DELETE FROM archive_sessions WHERE session = ?').run(session);
  };
  if (gone.length) commit(() => { for (const session of gone) drop(session); });
  const place = db.prepare('INSERT INTO archive_messages (session, n) VALUES (?, ?)');
  const put = db.prepare('INSERT INTO archive_text (rowid, folded) VALUES (?, ?)');
  for (const { id, transcript } of stale) {
    if (stopped()) return;
    const messages = await read(transcript);
    // A copy the store can't give is read again next time; the session is searched from its transcript meanwhile.
    if (!messages || stopped()) continue;
    commit(() => {
      drop(id);
      messages.forEach((m, n) => put.run(place.run(id, n).lastInsertRowid, foldText(m.text)));
      db.prepare('INSERT INTO archive_sessions (session, transcript) VALUES (?, ?)').run(id, transcript);
    });
  }
}

/**
 * The messages of the archived sessions (`sessions`, default every one) whose folded text holds every term, each term
 * a list of forms any one of which will do; every message, with no terms. In order of session ID, then of each
 * transcript. `scan` reads a session the index doesn't hold at its newest copy from its transcript.
 */
export async function findMessages(db: Db, terms: readonly (readonly string[])[], sessions: readonly string[] | undefined, scan: (session: string) => Promise<Message[] | undefined>): Promise<FoundMessage[]> {
  const ready = indexed(db);
  const rows = db.prepare(`SELECT s.id, ${ready ? 'a.transcript IS s.transcript' : '0'} AS fresh FROM sessions s ${ready ? 'LEFT JOIN archive_sessions a ON a.session = s.id' : ''} WHERE s.transcript IS NOT NULL ORDER BY s.id`).all() as { id: string; fresh: number }[];
  const wanted = sessions && new Set(sessions);
  const asked = rows.filter((r) => !wanted || wanted.has(r.id));
  const holds = (folded: string) => terms.every((forms) => forms.some((f) => folded.includes(f)));
  const found: FoundMessage[] = [];
  // A term of three characters or more narrows by the trigram index; a shorter one, or none, can't, so every message
  // is read. A narrowed session is read from its transcript too, for the text the ledger doesn't keep.
  const long = terms.filter((forms) => forms.every((f) => [...f].length >= 3));
  const narrowed = new Map<string, number[]>();
  if (long.length) {
    const fresh = new Set(asked.filter((r) => r.fresh).map((r) => r.id));
    const match = long.map((forms) => `(${forms.map((f) => `"${f.replace(/"/g, '""')}"`).join(' OR ')})`).join(' AND ');
    const hits = fresh.size ? db.prepare('SELECT m.session, m.n FROM archive_text JOIN archive_messages m ON m.id = archive_text.rowid WHERE archive_text MATCH ? ORDER BY m.session, m.n').all(match) as { session: string; n: number }[] : [];
    for (const id of fresh) narrowed.set(id, []);
    for (const h of hits) if (fresh.has(h.session)) narrowed.get(h.session)!.push(h.n);
  }
  for (const r of asked) {
    const at = narrowed.get(r.id);
    if (at && !at.length) continue;
    const messages = (await scan(r.id)) ?? [];
    for (const m of at ? at.map((n) => messages[n]).filter((m) => m !== undefined) : messages) if (holds(foldText(m.text))) found.push({ session: r.id, ...m });
  }
  // Index hits and scanned ones together, as one scan in order would give them: in the order `sessions` names them.
  const place = new Map((sessions ?? asked.map((r) => r.id)).map((id, i) => [id, i] as const).reverse());
  return found.map((m, i) => ({ m, i })).sort((x, y) => place.get(x.m.session)! - place.get(y.m.session)! || x.i - y.i).map(({ m }) => m);
}

/**
 * The sessions whose recorded reads and edits touched `file`, by the record's tool events, each with the path it
 * touched: an absolute path as it is, a relative one inside each session's worktree or under `cwd`.
 */
export function touched(db: Db, file: string, cwd?: string): { session: string; path: string }[] {
  const relative = file.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  const absolute = file.startsWith('/');
  return db.prepare(`SELECT DISTINCT e.session_id AS session, p.value AS path FROM events e JOIN json_each(e.data, '$.paths') p JOIN sessions s ON s.id = e.session_id
    WHERE e.kind IN ('tool.before', 'tool.after') AND json_extract(e.data, '$.kind') IN ('read', 'edit', 'write')
    AND (${absolute ? 'p.value = ?' : "p.value = rtrim(s.worktree, '/') || '/' || ? OR p.value = ?"}) ORDER BY e.session_id, p.value`)
    .all(...(absolute ? [file] : [relative, cwd ? `${cwd.replace(/\/+$/, '')}/${relative}` : null])) as { session: string; path: string }[];
}
