// deep_search (#26): read-only search of your wiki, past decisions and the project's spec, and, for a call bound to
// a session, that session's own open items and verdicts; every hit cites its source. A call bound to no session
// reads only what belongs to no session. The wiki is never the index's to vouch for (#355): the default index is
// SQLite FTS5 over the claims in force, in the ledger; any other is an index@1 fill rebuilt from the pages' claim
// lines. Either way each hit's quote, marks and sources come from the claim's record, which also drops a claim out
// of the caller's scope, superseded or rolled back. Past sessions (#1515) come last: the archived messages of the
// calling session's own repo, found through the archive's index, each marked as history and never a check result.
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CAP } from '@deepbuild/reading';
import { holdsWords as holds, indexTerms, parseClaimLine, queryWords as words, spaceless, type FoundMessage } from '@deepbuild/record';

interface Hit {
  source: string; quote: string; outside?: boolean; known?: string; proof?: number; sources?: unknown[]; as_of?: number; reading?: unknown; status?: 'current' | 'STALE';
  /** A past session's message (#1515): history, never a check result; its agent, its session's last date, whose words it holds, and what moved on since. */
  history?: true; agent?: string | null; date?: string | null; from?: 'you' | 'agent' | 'outside'; task?: string; changed?: string[];
}
/** What the record and the branch head say of a past session (#1515). */
export interface PastSession { agent: string | null; date: number | null; changed: string[]; task?: string }

type Raw = (sql: string, params: readonly (string | number | bigint | null)[]) => Promise<unknown[]>;
const REVERTS = /This reverts commit ([0-9a-f]{7,40})/g;
/**
 * What the record and each worktree's branch head say of past sessions (#1515): the agent, when the session last
 * worked, its task withdrawn or reverted, and the files its reads and edits touched that a commit after it changed,
 * one `git log` per worktree. A task is reverted when a commit on the branch head reverts one of the session's own
 * commits, as `git revert` words it. A session's own commits never count as a change, and a worktree git can't read
 * tells nothing.
 */
export async function aboutSessions(raw: Raw, ids: readonly string[]): Promise<Map<string, PastSession>> {
  const out = new Map<string, PastSession>();
  if (!ids.length) return out;
  const marks = ids.map(() => '?').join(', ');
  const rows = (await raw(`SELECT s.id, s.agent, s.worktree, (SELECT max(ts) FROM events e WHERE e.session_id = s.id AND e.kind NOT IN ('transcript.archived', 'session.state', 'session.gone')) AS ended,
    EXISTS (SELECT 1 FROM attempts a JOIN tasks t ON t.task_ref = a.task_ref WHERE a.session_id = s.id AND t.state = 'withdrawn') AS withdrawn FROM sessions s WHERE s.id IN (${marks})`, ids)) as { id: string; agent: string | null; worktree: string | null; ended: number | null; withdrawn: number }[];
  const ownBy = new Map<string, string[]>();
  for (const r of (await raw(`SELECT session_id AS session, sha FROM commits WHERE session_id IN (${marks})`, ids)) as { session: string; sha: string }[]) ownBy.set(r.session, [...(ownBy.get(r.session) ?? []), r.sha]);
  const own = new Set([...ownBy.values()].flat());
  const files = new Map<string, Set<string>>();
  for (const t of (await raw(`SELECT DISTINCT e.session_id AS session, p.value AS path FROM events e JOIN json_each(e.data, '$.paths') p WHERE e.session_id IN (${marks})
    AND e.kind IN ('tool.before', 'tool.after') AND json_extract(e.data, '$.kind') IN ('read', 'edit', 'write')`, ids)) as { session: string; path: string }[]) files.set(t.session, (files.get(t.session) ?? new Set()).add(t.path));
  const byWorktree = new Map<string, typeof rows>();
  for (const r of rows) byWorktree.set(r.worktree ?? '', [...(byWorktree.get(r.worktree ?? '') ?? []), r]);
  for (const [worktree, group] of byWorktree) {
    const since = Math.min(...group.map((r) => r.ended ?? 0));
    const log = worktree ? await new Promise<string>((done) => execFile('git', ['-C', worktree, 'log', '--no-merges', '--relative', '--name-only', '--format=%x00%H %ct%x01%B%x01', `--since=@${Math.floor(since / 1000)}`, 'HEAD'], { timeout: 2000, maxBuffer: 16 * 1024 * 1024 }, (error, out) => done(error ? '' : String(out)))) : '';
    const commits = log.split('\0').slice(1).map((c) => {
      const [head, body, names] = c.split('\x01');
      const [sha, ct] = head!.split(' ');
      return { sha: sha!, at: Number(ct) * 1000, reverts: [...(body ?? '').matchAll(REVERTS)].map((m) => m[1]!), names: new Set((names ?? '').split('\n').filter(Boolean)) };
    });
    for (const r of group) {
      const changed: string[] = [];
      for (const path of files.get(r.id) ?? []) {
        const name = relative(worktree, path);
        const by = worktree && !name.startsWith('..') && !isAbsolute(name) ? commits.find((c) => c.at > (r.ended ?? Infinity) && !own.has(c.sha) && c.names.has(name)) : undefined;
        if (by) changed.push(`${name} changed at ${by.sha.slice(0, 12)}, after this session`);
      }
      const mine = ownBy.get(r.id) ?? [];
      const revert = commits.find((c) => c.reverts.some((p) => mine.some((sha) => sha.startsWith(p))));
      const task = [...(r.withdrawn ? ['withdrawn: you rejected its task'] : []), ...(revert ? [`reverted: ${revert.sha.slice(0, 12)} reverts its commit`] : [])].join('; ');
      out.set(r.id, { agent: r.agent, date: r.ended, changed, ...(task ? { task } : {}) });
    }
  }
  return out;
}
interface Claim { id: string; page: string; source: string; text: string }
interface IndexHit { claim: string; page: string; quote: string; source: string; [mark: string]: unknown }
/** index@1's surface, as packages/conformance/src/slots/wiki-index.ts defines it; a fill that runs elsewhere answers later. */
export interface IndexFill {
  slot: 'index@1';
  rebuild(claims: Claim[]): unknown;
  search(query: string): IndexHit[] | Promise<IndexHit[]>;
}
/** The most hits one search returns, newest first; `more` says how many it left out. */
const MAX_HITS = 20;
const QUOTE = 400;
/** Pages the wiki generates from other pages' claims, such as its standing questions: no index holds them twice. */
const VIEWS = 'questions/';

/** What a query with no word left says, so an empty reply is never mistaken for nothing found. */
const NO_WORDS = 'The query had no words to search for: a word is a run of letters or digits.';
/**
 * SQL that keeps the rows whose column might hold every word, for `holds` to settle: LIKE folds case for a to z only,
 * so a word with any other letter is left to `holds`.
 */
const mightHold = (column: string, wanted: readonly string[]): { sql: string; params: string[] } => {
  const ascii = wanted.filter((w) => /^[\x00-\x7f]+$/.test(w));
  return { sql: ascii.map(() => `${column} LIKE ?`).join(' AND ') || '1', params: ascii.map((w) => `%${w}%`) };
};

/** The claims on the wiki's pages, each by `<page>#<id>`, so one ID on two pages stays two claims. */
export function pageClaims(wiki: string): Claim[] {
  const claims: Claim[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      const path = join(dir, name);
      if (name.endsWith('.md')) {
        const page = relative(wiki, path).slice(0, -3);
        if (page.startsWith(VIEWS)) continue;
        for (const line of readFileSync(path, 'utf8').split('\n')) {
          const parsed = parseClaimLine(line);
          if (parsed && typeof parsed.record.id === 'string') claims.push({ id: `${page}#${parsed.record.id}`, page, source: `wiki/${page}.md`, text: parsed.text });
        }
      } else if (!name.includes('.')) walk(path);
    }
  };
  walk(wiki);
  return claims;
}

/** The test's index when DEEP_HUB_TEST_INDEX names one, rebuilt from the pages; undefined for the ledger's own. */
export async function openIndex(wiki: string, module?: string): Promise<IndexFill | undefined> {
  if (!module) return undefined;
  const fill = ((await import(pathToFileURL(module).href)) as { default: () => IndexFill }).default();
  await fill.rebuild(pageClaims(wiki));
  return fill;
}

/** One `?` per value, for an IN list whose values are bound. */
const marks = (values: readonly unknown[]): string => values.map(() => '?').join(', ');
/**
 * The ledger's index: every query word an FTS5 term, and each hit holding every word as a word, as the reference index
 * reads it. FTS5 keeps a spaceless run as one token, so a word in such a script is found by LIKE instead.
 */
async function ledgerSearch(input: SearchIn, wanted: readonly string[]): Promise<IndexHit[]> {
  const terms = wanted.filter((w) => !spaceless(w));
  const runs = wanted.filter(spaceless);
  const where = [...(terms.length ? ['wiki_text MATCH ?'] : []), ...runs.map(() => 'text LIKE ?')].join(' AND ');
  const params = [...(terms.length ? [terms.map((w) => `"${w}"`).join(' ')] : []), ...runs.map((w) => `%${w}%`)];
  const rows = (await input.raw(`SELECT handle, page, text FROM wiki_text WHERE ${where} ORDER BY rowid`, params)) as { handle: string; page: string; text: string }[];
  return rows.filter((r) => holds(r.text, wanted)).map((r) => ({ claim: r.handle.slice(r.handle.indexOf('#') + 1), page: r.page, quote: r.text, source: `wiki/${r.page}.md` }));
}

interface Recorded { handle: string; text: string; known: string; proof: number; scope: string; state: string }
/**
 * The index's hits as deep_search shows them, each read again from its claim's record (wiki_claims, wiki_sources):
 * shown while it is in force and its scope covers the caller. A claim the learned layer holds changes for but none
 * in force so is dropped. A hit with no record at all keeps the index's quote, marked as outside: nothing vouches
 * for it. `trustsIndex` (a planted wrong program) takes the index's marks and drops nothing.
 */
async function wikiHits(found: IndexHit[], input: SearchIn): Promise<Hit[]> {
  const handles = found.map((h) => `wiki:${h.page}#${h.claim.startsWith(`${h.page}#`) ? h.claim.slice(h.page.length + 1) : h.claim}`);
  if (!handles.length) return [];
  const claims = new Map(((await input.raw(`SELECT handle, text, known, proof, scope, state FROM wiki_claims WHERE handle IN (${marks(handles)})`, handles)) as Recorded[]).map((c) => [c.handle, c]));
  const sources = new Map<string, unknown[]>();
  for (const s of (await input.raw(`SELECT claim, at, repo, path, commit_sha, quote, role, hash FROM wiki_sources WHERE claim IN (${marks(handles)}) ORDER BY claim, n`, handles)) as Record<string, string | null>[]) {
    const { claim, commit_sha, ...rest } = s;
    const kept = Object.fromEntries(Object.entries({ ...rest, commit: commit_sha }).filter(([, v]) => v !== null));
    sources.set(claim!, [...(sources.get(claim!) ?? []), kept]);
  }
  const learned = new Set(((await input.raw(`SELECT DISTINCT target FROM learned_layer WHERE layer = 'learned' AND target IN (${marks(handles)})`, handles)) as { target: string }[]).map((r) => r.target));
  const hits: Hit[] = [];
  found.forEach((h, i) => {
    const source = handles[i]!;
    const claim = claims.get(source);
    const shown = claim && claim.state === 'in force' && input.covers(claim.scope) ? claim : undefined;
    const marks = shown ? { outside: shown.known === 'outside', known: shown.known, proof: shown.proof, sources: sources.get(source) ?? [] } : { outside: true, known: 'outside', proof: 0, sources: [] };
    if (input.trustsIndex) {
      const told = Object.fromEntries(Object.entries(h).filter(([k]) => k in marks));
      hits.push({ source, quote: h.quote.slice(0, QUOTE), ...marks, ...told });
      return;
    }
    if (learned.has(source) && !shown) return;
    hits.push({ source, quote: (shown?.text ?? h.quote).slice(0, QUOTE), ...marks });
  });
  return hits;
}

interface SearchIn {
  query: string;
  /** A swapped-in index; undefined reads the ledger's own. */
  index: IndexFill | undefined;
  /** SQL over the record, read only. */
  raw(sql: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  /** The worktree whose spec is the project's, if the call names one the hub knows. */
  worktree: string | undefined;
  /** The session the call is bound to; undefined reads only what belongs to no session. `everyone` reads every session's (a planted wrong program). */
  session: string | undefined | { everyone: true };
  /** Whether a claim's scope covers the caller: its session, its repo, or everywhere; a call bound to no session reads repo and all. */
  covers(scope: string): boolean;
  /** A planted wrong program: the index's marks stand, and nothing is dropped. */
  trustsIndex?: boolean;
  /**
   * Past sessions the call reads (#1515): its own repo's archived sessions, narrowed to those that touched the file
   * it names; `messages` finds theirs through the archive's index and `about` tells of each session on the reply.
   */
  past?: { sessions: readonly string[]; messages(terms: readonly (readonly string[])[], sessions: readonly string[]): Promise<FoundMessage[]>; about(sessions: readonly string[]): Promise<Map<string, PastSession>> };
  /** Where a reply cut at the cap continues: a `next` an earlier reply gave. */
  cursor?: string;
  /** The readings the query finds, each with its source and as-of time (#45). */
  readings(query: string): Promise<{ reading: { id: string; subject: string | null; value: unknown; unit: string }; source: string; as_of: number; status: 'current' | 'STALE' }[]>;
}

/** Whose words a message holds, read from the record: a tool's result is outside content when the record says so, and otherwise the agent's tool's. */
const whose = (m: FoundMessage): 'you' | 'agent' | 'outside' => (m.tool !== undefined ? (m.outside ? 'outside' : 'agent') : m.role === 'user' && !m.outside ? 'you' : 'agent');
/** The quote of a long message: around the first word it was found by. */
function around(text: string, wanted: readonly string[]): string {
  const lower = text.toLowerCase();
  const at = Math.max(0, Math.min(...wanted.map((w) => lower.indexOf(w)).filter((i) => i >= 0)));
  const start = at > QUOTE / 2 ? at - 80 : 0;
  return `${start ? '…' : ''}${text.slice(start, start + QUOTE)}`.slice(0, QUOTE);
}
/** The past sessions' messages holding every word, newest session first, each marked as history. */
async function pastHits(past: NonNullable<SearchIn['past']>, wanted: readonly string[]): Promise<(Hit & { session: string })[]> {
  if (!past.sessions.length) return [];
  const found = (await past.messages(indexTerms(wanted), past.sessions)).filter((m) => holds(m.text, wanted));
  const order = new Map(past.sessions.map((id, i) => [id, i]));
  return found.map((m, i) => ({ m, i })).sort((x, y) => order.get(x.m.session)! - order.get(y.m.session)! || x.i - y.i)
    .map(({ m }) => ({ session: m.session, source: `session:${m.session.replace(/[^0-9A-Za-z]/g, '')}#${m.id}`, quote: around(m.text, wanted), history: true, from: whose(m) }));
}

/** Every hit for the query, each citing its source: the wiki's and the spec's, then the session's own, then decisions, newest first, then past sessions. */
export async function search(input: SearchIn): Promise<{ hits: Hit[]; more: number; next?: string; note?: string }> {
  const wanted = words(input.query);
  if (!wanted.length) return { hits: [], more: 0, note: NO_WORDS };
  const hits: Hit[] = await wikiHits(input.index ? await input.index.search(input.query) : await ledgerSearch(input, wanted), input);

  const asked = mightHold('a.question', wanted);
  const decisions = (await input.raw(`SELECT e.id AS id, a.question AS question, e.data AS data FROM events e JOIN asks a ON a.id = substr(json_extract(e.data, '$.ask'), 5)
    WHERE e.kind = 'decision.created' AND ${asked.sql} ORDER BY e.log_pos DESC`, asked.params)) as { id: string; question: string; data: string }[];
  const decided: Hit[] = [];
  for (const d of decisions) {
    if (!holds(d.question, wanted)) continue;
    const { answer, scope } = JSON.parse(d.data) as { answer: string; scope: string };
    decided.push({ source: `decision:${d.id}`, quote: `${d.question} → ${answer} (${scope})`.slice(0, QUOTE) });
  }

  const own = input.session;
  const record: Hit[] = [];
  if (own !== undefined) {
    const whose = typeof own === 'string' ? 'AND session_id = ?' : '';
    const held = mightHold('data', wanted);
    const rows = (await input.raw(`SELECT id, kind, data FROM events WHERE kind IN ('open_item.opened', 'verdict.made') ${whose} AND ${held.sql} ORDER BY log_pos DESC`, [...(typeof own === 'string' ? [own] : []), ...held.params])) as { id: string; kind: string; data: string }[];
    for (const row of rows) {
      const d = JSON.parse(row.data) as { task_ref?: string; text?: string; verdict?: string; reasons?: string[]; smallest?: string };
      const text = row.kind === 'open_item.opened' ? String(d.text) : [...(d.reasons ?? []), d.smallest ?? ''].join(' ');
      if (holds(text, wanted)) record.push({ source: row.kind === 'open_item.opened' ? String(d.task_ref) : String(d.verdict), quote: text.slice(0, QUOTE) });
    }
  }

  if (input.worktree) {
    const file = join(input.worktree, '.deepbuild', 'done.yaml');
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch { /* a repo with no spec has nothing to find */ }
    text.split('\n').forEach((line, i) => { if (holds(line, wanted)) hits.push({ source: `${file}#L${i + 1}`, quote: line.trim().slice(0, QUOTE) }); });
  }
  const numbers: Hit[] = (await input.readings(input.query)).map(({ reading, source, as_of, status }) => ({ source, as_of, reading, status, quote: `${status === 'STALE' ? 'STALE ' : ''}${reading.id}${reading.subject ? ` ${reading.subject}` : ''}: ${reading.value === null ? 'unknown' : String(reading.value)} ${reading.unit}`.slice(0, QUOTE) }));
  const history = input.past ? await pastHits(input.past, wanted) : [];
  const all: Hit[] = [...hits, ...record, ...numbers, ...decided, ...history];
  const from = input.cursor === undefined ? 0 : Number(/^h(\d+)$/.exec(input.cursor)?.[1] ?? NaN);
  if (!Number.isSafeInteger(from) || from > all.length) return { hits: [], more: 0, note: `No reply continues at ${input.cursor}.` };
  const page = all.slice(from, from + MAX_HITS);
  // A past session's hit says what the record and its branch head tell of that session, read for this reply's hits only.
  const told = input.past ? await input.past.about([...new Set(page.flatMap((h) => ('session' in h ? [h.session as string] : [])))]) : new Map<string, PastSession>();
  const shown = page.map((h) => {
    if (!('session' in h)) return h;
    const { session, ...hit } = h as Hit & { session: string };
    const about = told.get(session);
    return { ...hit, agent: about?.agent ?? null, date: about?.date ? new Date(about.date).toISOString() : null, ...(about?.task ? { task: about.task } : {}), ...(about?.changed.length ? { changed: about.changed } : {}) };
  });
  // The reply reaches the agent as JSON, under #63's cap: what doesn't fit goes by cursor.
  let used = JSON.stringify({ hits: [], more: 0, next: `h${'9'.repeat(10)}` }).length;
  let n = 0;
  for (; n < shown.length; n++) {
    used += JSON.stringify(shown[n]).length + 1;
    if (used > CAP && n > 0) break;
  }
  const end = from + n;
  return { hits: shown.slice(0, n), more: Math.max(0, all.length - end), ...(end < all.length ? { next: `h${end}` } : {}) };
}
