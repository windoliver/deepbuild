// deep_search (#26): read-only search of your wiki, past decisions and the project's spec, and, for a call bound to
// a session, that session's own open items and verdicts; every hit cites its source. A call bound to no session
// reads only what belongs to no session. The wiki is never the index's to vouch for (#355): the default index is
// SQLite FTS5 over the claims in force, in the ledger; any other is an index@1 fill rebuilt from the pages' claim
// lines. Either way each hit's quote, marks and sources come from the claim's record, which also drops a claim out
// of the caller's scope, superseded or rolled back.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseClaimLine } from '@deepbuild/record';

export interface Hit { source: string; quote: string; outside?: boolean; known?: string; proof?: number; sources?: unknown[]; as_of?: number; reading?: unknown; status?: 'current' | 'STALE' }
export interface Claim { id: string; page: string; source: string; text: string }
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

/** The words a query asks for, runs of letters and digits in any script: every hit holds each of them as a word. */
export const words = (text: string): string[] => text.normalize('NFC').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
/** A word in a script written without spaces has no boundaries to split on, so a hit holds it anywhere in its text. */
const spaceless = (word: string): boolean => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(word);
const holds = (text: string, wanted: readonly string[]): boolean => {
  const have = new Set(words(text));
  const lower = text.normalize('NFC').toLowerCase();
  return wanted.every((w) => (spaceless(w) ? lower.includes(w) : have.has(w)));
};
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

export interface SearchIn {
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
  /** The readings the query finds, each with its source and as-of time (#45). */
  readings(query: string): Promise<{ reading: { id: string; subject: string | null; value: unknown; unit: string }; source: string; as_of: number; status: 'current' | 'STALE' }[]>;
}

/** Every hit for the query, each citing its source: the wiki's and the spec's, then the session's own, then decisions, newest first. */
export async function search(input: SearchIn): Promise<{ hits: Hit[]; more: number; note?: string }> {
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
  const all = [...hits, ...record, ...numbers, ...decided];
  return { hits: all.slice(0, MAX_HITS), more: Math.max(0, all.length - MAX_HITS) };
}
