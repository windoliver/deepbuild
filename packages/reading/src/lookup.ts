// ⌘K's and `deep open`'s lookup (#2024): what a person pastes, read as a reference the record ties to a session or an
// ask, and words found across what you and your agents did: your prompts, the agents' messages and the commands of
// their tool calls in archived transcripts, the paths their calls touched, wiki claims and decisions, by #884's word
// rule. A message is read from the archive's scrubbed copy, never from an agent's own files. The hits are for you, read
// by the app; nothing here reaches an agent.
import { holdsWords, indexTerms, queryWords, type FoundMessage } from '@deepbuild/record';

/** One hit: what it names by handle, the address it opens, and what a row shows of it. */
export interface LookupHit {
  handle: string;
  /** Where a click opens it: `session/<id>[/<message>]` or `ask/<id>`; null for what has no page. */
  address: string | null;
  /** A pasted reference the record ties to it, or words it holds. */
  by: 'reference' | 'words';
  /** One line: what ties it, or the words around the match. */
  context: string;
  session?: string;
  title?: string | null;
  agent?: string | null;
  repo?: string | null;
  /** The session's state word (design: States people see). */
  word?: string | null;
  /** The session has ended, so the app offers to continue it (#1010). */
  ended?: boolean;
}
export interface Lookup { hits: LookupHit[]; none?: string }

/** The record as the lookup reads it: the hub's own, or a read-only reader over a hub's root. */
export interface LookupRecord {
  raw(sql: string, params?: readonly (string | number | null)[]): Promise<unknown[]>;
  findMessages(terms: readonly (readonly string[])[], sessions?: readonly string[]): Promise<FoundMessage[]>;
}

/** The kinds a reference may be, in the words ⌘K and `deep open` say them. */
export const KINDS = 'a PR or issue URL, #n, a commit SHA of 7 or more characters, a branch, a session ID, an agent app link or an ask handle';
/** What a query nothing names says. */
export const nothingNames = (query: string): string => `Nothing names "${query.trim().slice(0, 80)}". Paste ${KINDS}, or type words from your sessions, the wiki or your decisions.`;

const PR = /^https?:\/\/[^/\s]+\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)(?:[/?#]\S*)?$/;
const ISSUE = /^https?:\/\/[^/\s]+\/([^/\s]+\/[^/\s]+)\/issues\/(\d+)(?:[/?#]\S*)?$/;
const NUMBER = /^#(\d+)$/;
const SHA = /^[0-9a-f]{7,40}$/i;
const ASK = /^(?:ask:)?([0-7][0-9A-HJKMNP-TV-Z]{25})$/;
/** An agent app's link to a session: the Codex app's thread, the Claude app's `session=` (design: view). */
const LINKS = [/^codex:\/\/threads\/([A-Za-z0-9-]+)/, /^claude:\/\/\S*[?&]session=([A-Za-z0-9-]+)/];
/** The most word hits one lookup lists, and how many sessions' messages it asks the archive for at a time. */
const MOST = 50;
const BATCH = 200;
const LINE = 160;

const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
const marks = (values: readonly unknown[]): string => values.map(() => '?').join(', ');
/** SQL keeping the rows whose column might hold every ASCII word, for `holdsWords` to settle. */
const mightHold = (column: string, wanted: readonly string[]): { sql: string; params: string[] } => {
  const ascii = wanted.filter((w) => /^[\x00-\x7f]+$/.test(w));
  return { sql: ascii.map(() => `${column} LIKE ?`).join(' AND ') || '1', params: ascii.map((w) => `%${w}%`) };
};
/** One line of a text around its first match. */
function around(text: string, wanted: readonly string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  const at = Math.max(0, Math.min(...wanted.map((w) => lower.indexOf(w)).filter((i) => i >= 0), flat.length));
  const start = at > LINE / 2 ? at - 60 : 0;
  return `${start ? '…' : ''}${flat.slice(start, start + LINE)}`;
}

interface SessionRow { id: string; agent: string | null; project_id: string | null; last_seen: number | null; ended: number; row: string | null }
/**
 * The sessions `where` picks, newest first, with what a hit shows of each. The archive files a transcript under the
 * session's letters and digits (`transcript.archived` names `session:<letters>`), a row of its own beside the one the
 * session's hooks made under its ID: each session is that one row, the hooks' when there is one.
 */
async function sessionsWhere(r: LookupRecord, where: string, params: readonly (string | number | null)[]): Promise<SessionRow[]> {
  const keys = [...new Set(((await r.raw(`SELECT s.id FROM sessions s WHERE ${where}`, params)) as { id: string }[]).map((s) => letters(s.id)))];
  if (!keys.length) return [];
  const rows = (await r.raw(`SELECT s.id, s.agent, s.project_id, s.last_seen, EXISTS (SELECT 1 FROM events e WHERE e.session_id = s.id AND e.kind = 'session.end') AS ended,
    (SELECT row FROM rows WHERE id = 'session:' || s.id) AS row FROM sessions s WHERE replace(s.id, '-', '') IN (${marks(keys)}) ORDER BY s.agent IS NULL, s.id`, keys)) as SessionRow[];
  const one = new Map<string, SessionRow>();
  for (const row of rows) if (!one.has(letters(row.id))) one.set(letters(row.id), { ...row, last_seen: Math.max(...rows.filter((o) => letters(o.id) === letters(row.id)).map((o) => o.last_seen ?? 0)) });
  return [...one.values()].sort((a, b) => (b.last_seen ?? 0) - (a.last_seen ?? 0) || (a.id < b.id ? -1 : 1));
}
function about(s: SessionRow): Pick<LookupHit, 'session' | 'title' | 'agent' | 'repo' | 'word' | 'ended'> {
  let row: { title?: string; word?: string } = {};
  try { row = s.row ? (JSON.parse(s.row) as typeof row) : {}; } catch { /* a row the record can't read shows no title */ }
  return { session: s.id, title: row.title ?? null, agent: s.agent, repo: s.project_id, word: row.word ?? null, ended: s.ended === 1 };
}

/** The sessions and asks a pasted reference names, newest first; undefined when the query isn't one token. */
async function references(r: LookupRecord, query: string): Promise<LookupHit[] | undefined> {
  const q = query.trim();
  if (!q || /\s/.test(q)) return undefined;
  const sessions = (rows: SessionRow[], context: string): LookupHit[] => rows.map((s) => ({ handle: `session:${letters(s.id)}`, address: `session/${s.id}`, by: 'reference', context, ...about(s) }));
  const ask = ASK.exec(q);
  if (ask) {
    const asked = (await r.raw('SELECT id, question FROM asks WHERE id = ?', [ask[1]!])) as { id: string; question: string | null }[];
    return asked.map((a) => ({ handle: `ask:${a.id}`, address: `ask/${a.id}`, by: 'reference', context: a.question ?? '' }));
  }
  // A pull request: the one a session opened (#83), or the one landing kept as a claim's thread.
  const pr = PR.exec(q) ?? (NUMBER.exec(q) ? [q, undefined, NUMBER.exec(q)![1]] : null);
  const issue = ISSUE.exec(q) ?? (NUMBER.exec(q) ? [q, undefined, NUMBER.exec(q)![1]] : null);
  const found: LookupHit[] = [];
  if (pr) {
    const url = pr[1] ? `%/${pr[1]}/pull/${pr[2]}` : `%/pull/${pr[2]}`;
    found.push(...sessions(await sessionsWhere(r, `s.id IN (SELECT session_id FROM session_readings WHERE reading LIKE 'Opened pull request ' || ?)
      OR s.id IN (SELECT c.session_id FROM events e JOIN claims c ON 'claim:' || c.id = json_extract(e.data, '$.claim') WHERE e.kind = 'landing.made' AND json_extract(e.data, '$.pr') = ?${pr[1] ? " AND json_extract(e.data, '$.repo') = ?" : ''})`,
    [url, Number(pr[2]), ...(pr[1] ? [pr[1]] : [])]), pr[1] ? `opened ${q}` : `pull request ${q}`));
  }
  if (issue) {
    found.push(...sessions(await sessionsWhere(r, `s.id IN (SELECT c.session_id FROM events e JOIN claims c ON 'claim:' || c.id = json_extract(e.data, '$.claim') WHERE e.kind = 'landing.made' AND json_extract(e.data, '$.issue') = ?${issue[1] ? " AND json_extract(e.data, '$.repo') = ?" : ''})`,
      [Number(issue[2]), ...(issue[1] ? [issue[1]] : [])]), `issue ${q}`));
  }
  if (pr || issue) return found.filter((h, i) => found.findIndex((o) => o.handle === h.handle) === i);
  const link = LINKS.map((re) => re.exec(q)).find(Boolean);
  if (link) return sessions(await sessionsWhere(r, 's.id = ? OR s.thread_id = ?', [link[1]!, link[1]!]), `linked ${q}`);
  if (SHA.test(q)) found.push(...sessions(await sessionsWhere(r, 's.id IN (SELECT session_id FROM commits WHERE sha LIKE ?)', [`${q.toLowerCase()}%`]), `made commit ${q.toLowerCase()}`));
  // A session ID, whole, shortened to 8 or more, or in letters and digits as a handle writes it; and a branch.
  const id = q.replace(/^session[:/]/, '');
  found.push(...sessions(await sessionsWhere(r, `s.id = ? OR s.thread_id = ? OR (length(?) >= 8 AND (s.id LIKE ? || '%' OR replace(s.id, '-', '') LIKE ? || '%'))`, [id, id, id, id, letters(id)]), `session ${id}`));
  found.push(...sessions(await sessionsWhere(r, 's.branch = ?', [q]), `on branch ${q}`));
  return found.filter((h, i) => found.findIndex((o) => o.handle === h.handle) === i);
}

/** The words of `query` across archived messages, the paths calls touched, wiki claims and decisions. */
async function words(r: LookupRecord, query: string, messages: LookupRecord['findMessages']): Promise<LookupHit[]> {
  const wanted = queryWords(query);
  if (!wanted.length) return [];
  // Your prompts, the agents' messages and their calls' commands, a tool's result being neither, newest sessions first,
  // a batch at a time until enough are found: a common word reads no more transcripts than its first hits need. Only a
  // word of three characters or more narrows by the archive's index, so a query with none reads no transcript.
  const terms = indexTerms(wanted);
  const found: FoundMessage[] = [];
  if (terms.some((forms) => forms.every((f) => [...f].length >= 3))) {
    // Newest first by the session's hooks' row, which the archive's row of it lacks.
    const archived = ((await r.raw(`SELECT a.id FROM sessions a LEFT JOIN (SELECT replace(id, '-', '') AS k, max(last_seen) AS seen FROM sessions GROUP BY k) b
      ON b.k = replace(a.id, '-', '') WHERE a.transcript IS NOT NULL ORDER BY b.seen DESC, a.id`)) as { id: string }[]).map((s) => s.id);
    for (let at = 0; at < archived.length && found.length < MOST; at += BATCH) {
      found.push(...(await messages(terms, archived.slice(at, at + BATCH))).filter((m) => m.tool === undefined && holdsWords(m.text, wanted)));
    }
  }
  const ids = [...new Set(found.map((m) => m.session))];
  const byId = new Map((await sessionsWhere(r, `s.id IN (${marks(ids)})`, ids)).map((s) => [letters(s.id), s]));
  const hits: LookupHit[] = found.slice(0, MOST).map((m) => {
    const s = byId.get(letters(m.session));
    return { handle: `session:${letters(m.session)}#${m.id}`, address: `session/${s?.id ?? m.session}/${m.id}`, by: 'words', context: around(m.text, wanted), ...(s ? about(s) : { session: m.session }) };
  });
  const path = mightHold('f.path', wanted);
  for (const f of (await r.raw(`SELECT f.session, f.path FROM session_files f WHERE ${path.sql} ORDER BY f.last DESC LIMIT ${MOST}`, path.params)) as { session: string; path: string }[]) {
    if (!holdsWords(f.path, wanted)) continue;
    const [s] = await sessionsWhere(r, 's.id = ?', [f.session]);
    hits.push({ handle: `session:${letters(f.session)}`, address: `session/${f.session}`, by: 'words', context: `touched ${f.path}`, ...(s ? about(s) : { session: f.session }) });
  }
  const claim = mightHold('text', wanted);
  for (const c of (await r.raw(`SELECT handle, text FROM wiki_claims WHERE state = 'in force' AND ${claim.sql} ORDER BY log_pos DESC LIMIT ${MOST}`, claim.params)) as { handle: string; text: string }[]) {
    if (holdsWords(c.text, wanted)) hits.push({ handle: c.handle, address: await claimAddress(r, c.handle), by: 'words', context: around(c.text, wanted) });
  }
  for (const d of (await r.raw(`SELECT d.id, d.answer, d.ask_id, a.question FROM decisions d LEFT JOIN asks a ON a.id = d.ask_id WHERE d.state = 'active' ORDER BY d.created DESC`)) as { id: string; answer: string | null; ask_id: string | null; question: string | null }[]) {
    let answer = '';
    try { answer = String(JSON.parse(d.answer ?? '""')); } catch { answer = d.answer ?? ''; }
    const text = [d.question, answer].filter(Boolean).join(' → ');
    if (holdsWords(text, wanted)) hits.push({ handle: `decision:${d.id}`, address: d.question && d.ask_id ? `ask/${d.ask_id}` : null, by: 'words', context: around(text, wanted) });
  }
  return hits;
}
/** Where a wiki claim opens: the session message or the decision's ask its first source cites. */
async function claimAddress(r: LookupRecord, handle: string): Promise<string | null> {
  const [source] = (await r.raw('SELECT at FROM wiki_sources WHERE claim = ? AND at IS NOT NULL ORDER BY n LIMIT 1', [handle])) as { at: string }[];
  const message = /^session:([0-9A-Za-z]+)(?:#(.+))?$/.exec(source?.at ?? '');
  if (message) {
    const [s] = (await r.raw("SELECT id FROM sessions WHERE replace(id, '-', '') = ? LIMIT 1", [message[1]!])) as { id: string }[];
    return s ? `session/${s.id}${message[2] ? `/${message[2]}` : ''}` : null;
  }
  const decision = /^decision:(.+)$/.exec(source?.at ?? '');
  const [d] = decision ? (await r.raw('SELECT d.ask_id FROM decisions d JOIN asks a ON a.id = d.ask_id WHERE d.id = ?', [decision[1]!])) as { ask_id: string }[] : [];
  return d ? `ask/${d.ask_id}` : null;
}

/**
 * What ⌘K lists for `query`: what a pasted reference names, newest first, then the words it finds; `none` when nothing
 * does. `references` alone is what `deep open` takes. `messages` stands in for the archive only in a planted program.
 */
export async function lookup(r: LookupRecord, query: string, o: { references?: true; messages?: LookupRecord['findMessages'] } = {}): Promise<Lookup> {
  const named = (await references(r, query)) ?? [];
  const found = o.references ? [] : await words(r, query, o.messages ?? ((terms, sessions) => r.findMessages(terms, sessions)));
  const hits = [...named, ...found.filter((h) => !named.some((n) => n.handle === h.handle))];
  return hits.length ? { hits } : { hits, none: nothingNames(query) };
}
