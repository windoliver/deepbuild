// deep_search (#26): read-only search of your wiki, past decisions and the project's spec, and, for a call bound to
// a session, that session's own open items and verdicts; every hit cites its source. A call bound to no session
// reads only what belongs to no session. The wiki is read through an index@1 fill, never as the source of truth.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface Hit { source: string; quote: string }
/** index@1's surface, as packages/conformance/src/slots/wiki-index.ts defines it. */
export interface IndexFill {
  slot: 'index@1';
  rebuild(claims: { id: string; page: string; source: string; text: string }[]): void;
  search(query: string): { claim: string; page: string; quote: string; source: string }[];
}
/** The most hits one search returns, newest first; `more` says how many it left out. */
const MAX_HITS = 20;
const QUOTE = 400;

/** The words a query asks for: every hit holds each of them as a word. */
export const words = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const holds = (text: string, wanted: readonly string[]): boolean => { const have = new Set(words(text)); return wanted.every((w) => have.has(w)); };

/** The wiki's index: the test's fill when DEEP_HUB_TEST_INDEX names one, else a keyword index of the wiki's pages, a claim per paragraph. */
export async function openIndex(wiki: string, module?: string): Promise<IndexFill> {
  const fill = module ? ((await import(pathToFileURL(module).href)) as { default: () => IndexFill }).default() : keywordIndex();
  const claims: { id: string; page: string; source: string; text: string }[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      const path = join(dir, name);
      if (name.endsWith('.md')) {
        const page = relative(wiki, path).slice(0, -3);
        readFileSync(path, 'utf8').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).forEach((text, i) => claims.push({ id: `c${i + 1}`, page, source: `wiki/${page}.md`, text }));
      } else if (!name.includes('.')) walk(path);
    }
  };
  walk(wiki);
  fill.rebuild(claims);
  return fill;
}
function keywordIndex(): IndexFill {
  let claims: { id: string; page: string; source: string; text: string }[] = [];
  return {
    slot: 'index@1',
    rebuild(next) { claims = [...next]; },
    search(query) { const wanted = words(query); return claims.filter((c) => holds(c.text, wanted)).map((c) => ({ claim: c.id, page: c.page, quote: c.text, source: c.source })); },
  };
}

export interface SearchIn {
  query: string;
  index: IndexFill;
  /** SQL over the record, read only. */
  raw(sql: string): Promise<unknown[]>;
  /** The worktree whose spec is the project's, if the call names one the hub knows. */
  worktree: string | undefined;
  /** The session the call is bound to; undefined reads only what belongs to no session. `everyone` reads every session's (a planted wrong program). */
  session: string | undefined | { everyone: true };
}

/** Every hit for the query, each citing its source: the wiki's and the spec's, then the session's own, then decisions, newest first. */
export async function search(input: SearchIn): Promise<{ hits: Hit[]; more: number }> {
  const wanted = words(input.query);
  if (!wanted.length) return { hits: [], more: 0 };
  // Each word is letters and digits only, so it goes into the SQL as it is.
  const like = (column: string) => wanted.map((w) => `${column} LIKE '%${w}%'`).join(' AND ');
  const hits: Hit[] = [];
  for (const h of input.index.search(input.query)) hits.push({ source: `wiki:${h.page}#${h.claim}`, quote: h.quote.slice(0, QUOTE) });

  const decisions = (await input.raw(`SELECT e.id AS id, a.question AS question, e.data AS data FROM events e JOIN asks a ON a.id = substr(json_extract(e.data, '$.ask'), 5)
    WHERE e.kind = 'decision.created' AND ${like('a.question')} ORDER BY e.log_pos DESC`)) as { id: string; question: string; data: string }[];
  const decided: Hit[] = [];
  for (const d of decisions) {
    if (!holds(d.question, wanted)) continue;
    const { answer, scope } = JSON.parse(d.data) as { answer: string; scope: string };
    decided.push({ source: `decision:${d.id}`, quote: `${d.question} → ${answer} (${scope})`.slice(0, QUOTE) });
  }

  const own = input.session;
  const record: Hit[] = [];
  if (own !== undefined) {
    const whose = typeof own === 'string' ? `AND session_id = '${own.replace(/'/g, "''")}'` : '';
    const rows = (await input.raw(`SELECT id, kind, data FROM events WHERE kind IN ('open_item.opened', 'verdict.made') ${whose} AND ${like('data')} ORDER BY log_pos DESC`)) as { id: string; kind: string; data: string }[];
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
  const all = [...hits, ...record, ...decided];
  return { hits: all.slice(0, MAX_HITS), more: Math.max(0, all.length - MAX_HITS) };
}
