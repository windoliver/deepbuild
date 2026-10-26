// @deepbuild/wiki (#355): the wiki's claims and pages. Every line of a page is a claim that keeps its source: the
// exact quote, where it came from (a transcript message, a decision, a repo path at a commit), and how it was known:
// from you, from your decision, from a repo file at a commit in a project you trust, inferred by an agent, or from
// outside content. A claim whose quote isn't at its source is dropped, and one stating a key its quote doesn't hold
// is inferred. Each claim is a learned change (design: The learned layer), so the core checks its quotes, its scope
// and who applied it, and it rolls back like any other; pages are folded from the claims in force. A claim on a
// repo's page goes into that repo's start slice unless it rests only on outside content, which only your decision
// promotes. Links are kept without their query strings and never fetched. A page you edit is never written over:
// your edits are kept as decisions, through your connection. Standing questions, such as how a repo starts, are
// pages the wiki rewrites from the claims each time it writes.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { openTrust } from '@deepbuild/extension-host';
import { parseClaimLine, ulid, type Connection, type RecordStore } from '@deepbuild/record';

/** How a claim was known, strongest first. */
export type Known = 'you' | 'decision' | 'repo' | 'inferred' | 'outside';
const RANK: Known[] = ['you', 'decision', 'repo', 'inferred', 'outside'];
/** One thing a claim rests on: the exact quote, and where it is. */
export type Source = { at: string; quote: string } | { repo: string; path: string; commit: string; quote: string };
export interface Candidate {
  /** `repos/api` is `<folder>/repos/api.md`. */
  page: string;
  /** The claim's ID on its page; its handle is `wiki:<page>#<id>`. */
  id: string;
  text: string;
  sources: Source[];
  /** `session:<id>`, `repo:<project>` or `all`, as the learned layer's rules give it for the evidence. */
  scope: string;
  /** The handle of the claim this one replaces. */
  supersedes?: string;
}
export interface Learned { written: string[]; dropped: { claim: string; reason: string }[] }
export interface Wiki {
  /** Checks each candidate, records the ones that hold as claims, then rewrites the pages. */
  learn(candidates: Candidate[]): Promise<Learned>;
  /** Rewrites every page from the claims in force. */
  write(): Promise<void>;
  /** Promotes a claim on your answer, saved as a decision, from your connection only; resolves with `decision:<id>`. */
  promote(connection: Connection, claim: string): Promise<string>;
  /**
   * Keeps your edits to the pages as decisions, from your connection only: a claim line you changed or removed, and
   * a line you added. Resolves with the decisions, then rewrites the pages it read.
   */
  keepEdits(connection: Connection): Promise<string[]>;
}
export interface WikiOptions {
  record: RecordStore;
  folder: string;
  now: () => number;
  /** A planted wrong program: checks only that each quote is at its source, never the claim's keys. */
  plant?: 'quote-present-only';
}

/** The wiki writes as the core: the local-first rule within a session, the install rule at a repo or everywhere. */
const CORE: Connection = { writer: 'core', actor: 'deepbuild', scope: 'you' };
const YOURS = new Set(['app', 'cli']);
const PAGE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** What the wiki last wrote, page by page, by hash: a page that differs from it is yours until you keep it. */
const WRITTEN = '.written.json';
/** The standing questions the wiki keeps answered, one page for each repo page, from that page's claims in force. */
const STANDING = [{ slug: 'start', ask: (repo: string) => `How does ${repo} start?`, answers: /\bstart(s|ed|ing)?\b/i }];
const CLOSING = /^Of these \d+ claims, /;

/** A link's query string, which is never stored: it can carry a token. */
const QUERY = /(https?:\/\/[^\s?#"'`<>]+)\?[^\s#"'`<>]*/g;
export const withoutQueries = (text: string): string => text.replace(QUERY, '$1');
/** Text as quotes are compared: NFC, each whitespace run one space, links without their query strings. */
const norm = (text: string): string => withoutQueries(text.normalize('NFC').replace(/\s+/g, ' ')).trim();
/** A quote as the record keeps it: the pieces around each query string, each of which is at the source as it is. */
const pieces = (quote: string): string[] => quote.normalize('NFC').replace(QUERY, '$1\u0000').split('\u0000').map((p) => p.trim()).filter(Boolean);
const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
const sqlText = (text: string): string => `'${text.replace(/'/g, "''")}'`;

/**
 * The exact keys a claim states: a code span, and each word that is a path, a file name, a flag, a variable name, a
 * port or a version.
 */
function keysOf(text: string): string[] {
  const keys = new Set<string>();
  for (const m of text.matchAll(/`([^`]+)`/g)) keys.add(m[1]!.trim());
  for (const raw of text.replace(/`[^`]*`/g, ' ').split(/\s+/)) {
    const word = raw.replace(/^[("'[]+/, '').replace(/[)"'\],;:!?]+$/, '').replace(/\.$/, '');
    if (/\d/.test(word) || word.includes('/') || /^--?[A-Za-z]/.test(word) || /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(word) || /^[\w-]+\.[A-Za-z0-9]{1,5}$/.test(word)) keys.add(word);
  }
  return [...keys].filter(Boolean);
}
const holdsKey = (quote: string, key: string): boolean =>
  new RegExp(`(^|[^A-Za-z0-9_])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_])`).test(quote);

/** A source as a claim keeps it: its quote without query strings, a message's role, a file's hash. */
type Kept = Source & { role?: string; hash?: string };
interface Checked { known: Known; kept: Kept; evidence: { at: string; quote: string }[] }
/** A claim in force (wiki_claims), with the change that holds it. */
interface Row { id: string; target: string; page: string; scope: string; state: string; diff: string; handle: string; evidence: string }
const parseLine = (line: string): { text: string; record: Record<string, unknown> } | undefined => parseClaimLine(line);
const closingOf = (n: number, inferred: number, outside: number): string =>
  `Of these ${n} claims, ${inferred} were inferred by an agent, ${outside} rest on outside content and 0 are drifted; none of it is a check result.`;
const render = (text: string, record: Record<string, unknown>): string =>
  `- ${text} <!-- deep:claim ${JSON.stringify(record).replace(/>/g, '\\u003e')} -->`;

export async function openWiki(o: WikiOptions): Promise<Wiki> {
  const { record, folder, now } = o;
  const trust = await openTrust({ record, now });

  /** Whether the quote is at its source, how the source knew it, and what the record cites for it. */
  async function check(source: Source): Promise<Checked | string> {
    const quote = norm(source.quote);
    if (!quote) return 'a source with no quote';
    if ('at' in source) {
      const entry = await record.resolve(source.at);
      if (!entry) return `${source.at} names nothing the record can read`;
      if (!norm(entry.text).includes(quote)) return `the quote "${quote}" is not at ${source.at}`;
      // A tool's result is outside content when the tool brings it from outside, else an agent's own reading.
      const known: Known = source.at.startsWith('decision:') ? 'decision'
        : entry.tool !== undefined ? (entry.outside ? 'outside' : 'inferred')
          : entry.role === 'user' && !entry.outside ? 'you' : 'inferred';
      return { known, kept: { at: source.at, quote, ...(entry.role ? { role: entry.role } : {}) }, evidence: pieces(source.quote).map((q) => ({ at: source.at, quote: q })) };
    }
    let bytes: Buffer;
    try {
      bytes = execFileSync('git', ['-C', source.repo, 'show', `${source.commit}:${source.path}`], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });
    } catch {
      return `${source.path} at ${source.commit} in ${source.repo} can't be read`;
    }
    if (!norm(bytes.toString('utf8')).includes(quote)) return `the quote "${quote}" is not in ${source.path} at ${source.commit}`;
    // The file is kept for the repo whose sessions work in that folder, so the claim reaches that repo.
    const [owner] = (await record.raw(`SELECT project_id FROM sessions WHERE worktree = ${sqlText(source.repo)} AND project_id IS NOT NULL LIMIT 1`)) as { project_id: string }[];
    const ev = await record.keep({ ...CORE, ...(owner ? { project: owner.project_id } : {}) }, { bytes: new Uint8Array(bytes), kind: 'repo.file', source: `${source.path}@${source.commit}` });
    const known: Known = (await trust.trusted(source.repo)) ? 'repo' : 'outside';
    return { known, kept: { repo: source.repo, path: source.path, commit: source.commit, quote, hash: sha256(bytes) }, evidence: pieces(source.quote).map((q) => ({ at: ev, quote: q })) };
  }

  /** The claims in force, as the record projects them, each with the change that holds it, oldest first. */
  const inForce = async (where = ''): Promise<Row[]> => (await record.raw(`SELECT l.id AS id, c.handle AS target, c.page AS page, c.scope AS scope, c.state AS state,
    l.diff AS diff, l.handle AS handle, l.evidence AS evidence FROM wiki_claims c JOIN learned_layer l ON l.handle = c.change ${where} ORDER BY c.log_pos`)) as Row[];
  const newest = async (claim: string): Promise<Row | undefined> => (await inForce(`WHERE c.handle = ${sqlText(claim)}`))[0];
  /** Your decision, saved by the core from your connection, at a scope; resolves with its handle. */
  async function decide(connection: Connection, answer: string, scope: string, about: string): Promise<string> {
    const ts = now();
    const id = ulid(ts);
    await record.append({ writer: 'core', actor: connection.actor, scope: connection.scope }, {
      v: 1, id, kind: 'decision.created', ts, data: { key: sha256(`wiki ${about} ${answer}`), scope, answer, ask: `ask:${ulid(ts)}` },
    });
    return `decision:${id}`;
  }

  /** Appends a learned change; resolves with why the core didn't put it in force, or undefined when it did. */
  async function apply(connection: Connection, change: { target: string; diff: string; evidence: { at: string; quote: string }[]; scope: string; applied_by: string; supersedes: string | null }): Promise<{ id: string; refused?: string }> {
    const ts = now();
    const id = ulid(ts);
    await record.append(connection, { v: 1, id, kind: 'learn.applied', ts, data: { layer: 'learned', ...change, replay: null } });
    const [row] = (await record.raw(`SELECT state, reason FROM learned_layer WHERE id = ${sqlText(id)}`)) as { state: string; reason: string | null }[];
    return row?.state === 'applied' ? { id } : { id, refused: row?.reason ?? `the record kept ${change.target} out of force` };
  }

  async function learnOne(c: Candidate): Promise<string | undefined> {
    const claim = `wiki:${c.page}#${c.id}`;
    if (!PAGE.test(c.page) || !ID.test(c.id)) return `${claim} isn't a page and claim ID a handle can name`;
    if (!c.sources.length) return `${claim} names no source`;
    const checked: Checked[] = [];
    for (const source of c.sources) {
      const held = await check(source);
      if (typeof held === 'string') return held;
      checked.push(held);
    }
    const text = withoutQueries(c.text.replace(/\s+/g, ' ').trim());
    let known = checked.map((s) => s.known).sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0]!;
    // Each exact key the claim states is in one of its quotes, or the claim is inferred, whatever its sources.
    const missing = o.plant === 'quote-present-only' ? [] : keysOf(text).filter((key) => !checked.some((s) => holdsKey(s.kept.quote, key)));
    if (missing.length && RANK.indexOf(known) < RANK.indexOf('inferred')) known = 'inferred';
    const distinct = new Map(checked.map((s) => ['at' in s.kept ? s.kept.at : `${s.kept.repo}:${s.kept.path}@${s.kept.commit}`, s]));
    const line = render(text, { id: c.id, known, proof: distinct.size, sources: [...distinct.values()].map((s) => s.kept), seen: new Date(now()).toISOString() });
    const old = c.supersedes ? await newest(c.supersedes) : undefined;
    const evidence = [...distinct.values()].flatMap((s) => s.evidence);
    const applied_by = c.scope.startsWith('session:') ? 'rule:localfirst' : 'rule:install';
    const made = await apply(CORE, { target: claim, diff: `+ ${line}`, evidence, scope: c.scope, applied_by, supersedes: old?.handle ?? null });
    if (made.refused) return made.refused;
    // The repo's page goes into its start slice, but never a claim resting only on outside content.
    const repo = /^repos\/([0-9A-Za-z]+)$/.exec(c.page)?.[1];
    if (repo && known !== 'outside') {
      const was = old?.target.startsWith(`wiki:${c.page}#`) ? parseLine(old.diff.slice(2))?.text : undefined;
      await apply(CORE, { target: `slice:${c.page}`, diff: [...(was ? [`- ${was}`] : []), `+ ${text}`].join('\n'), evidence, scope: c.scope === 'all' ? `repo:${repo}` : c.scope, applied_by, supersedes: null });
    }
    return undefined;
  }

  const written = (): Record<string, string> => {
    try { return JSON.parse(readFileSync(join(folder, WRITTEN), 'utf8')) as Record<string, string>; } catch { return {}; }
  };
  /** The pages that differ from what the wiki last wrote, or that it never wrote: yours, until you keep them. */
  const edited = (): string[] => {
    if (!existsSync(folder)) return [];
    const last = written();
    return listPages(folder).filter((page) => !page.startsWith('questions/') && last[page] !== sha256(readFileSync(join(folder, `${page}.md`))));
  };

  async function write(): Promise<void> {
    const pages = new Map<string, string[]>();
    const counts = new Map<string, { inferred: number; outside: number }>();
    for (const row of await inForce()) {
      const parsed = parseLine(row.diff.slice(2));
      if (!parsed) continue;
      // A contradicted claim stays on its page, marked superseded, rather than deleted.
      pages.set(row.page, [...(pages.get(row.page) ?? []), row.state === 'superseded' ? render(parsed.text, { ...parsed.record, state: 'superseded' }) : row.diff.slice(2)]);
      const n = counts.get(row.page) ?? { inferred: 0, outside: 0 };
      if (parsed.record.known === 'inferred') n.inferred++;
      if (parsed.record.known === 'outside') n.outside++;
      counts.set(row.page, n);
    }
    // Each standing question, rewritten from its repo page's claims in force that answer it.
    for (const [page, lines] of [...pages]) {
      const repo = /^repos\/([^/]+)$/.exec(page)?.[1];
      if (!repo) continue;
      for (const q of STANDING) {
        const answers = lines.flatMap((line) => {
          const parsed = parseLine(line);
          return parsed && parsed.record.state !== 'superseded' && q.answers.test(parsed.text) ? [render(parsed.text, { ...parsed.record, claim: `wiki:${page}#${String(parsed.record.id)}` })] : [];
        });
        pages.set(`questions/${repo}/${q.slug}`, answers);
        counts.set(`questions/${repo}/${q.slug}`, { inferred: answers.filter((l) => parseLine(l)?.record.known === 'inferred').length, outside: answers.filter((l) => parseLine(l)?.record.known === 'outside').length });
      }
    }
    mkdirSync(folder, { recursive: true });
    const yours = new Set(edited());
    const last = written();
    const hashes: Record<string, string> = {};
    for (const page of listPages(folder)) if (!pages.has(page) && !yours.has(page)) rmSync(join(folder, `${page}.md`), { force: true });
    for (const [page, lines] of pages) {
      // Your edit stands until you keep it: the page isn't written over.
      if (yours.has(page)) continue;
      const n = counts.get(page)!;
      const title = page.startsWith('questions/') ? STANDING.find((q) => page.endsWith(`/${q.slug}`))!.ask(page.split('/')[1]!) : page;
      const text = `# ${title}\n\n${lines.length ? `${lines.join('\n')}\n\n` : ''}${closingOf(lines.length, n.inferred, n.outside)}\n`;
      const file = join(folder, `${page}.md`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, text);
      renameSync(`${file}.tmp`, file);
      hashes[page] = sha256(text);
    }
    for (const page of yours) if (last[page]) hashes[page] = last[page]!;
    writeFileSync(join(folder, WRITTEN), `${JSON.stringify(hashes, null, 2)}\n`);
  }

  /** Re-records a claim on your decision, superseding the change that holds it now. */
  async function onDecision(connection: Connection, row: Row, text: string, decision: string): Promise<void> {
    const parsed = parseLine(row.diff.slice(2))!;
    // Its earlier sources hold its earlier words, so a line you changed rests on your decision alone.
    const same = text === parsed.text;
    const sources = [...(same ? (parsed.record.sources as Kept[]) : []), { at: decision, quote: text }];
    const line = render(text, { ...parsed.record, known: 'decision', proof: same ? Number(parsed.record.proof) + 1 : 1, sources, seen: new Date(now()).toISOString() });
    const evidence = [...(same ? (JSON.parse(row.evidence) as { at: string; quote: string }[]) : []), { at: decision, quote: text }];
    const made = await apply(connection, { target: row.target, diff: `+ ${line}`, evidence, scope: row.scope, applied_by: 'you', supersedes: row.handle });
    if (made.refused) throw Error(`${row.target} was saved as ${decision}, but its claim wasn't updated: ${made.refused}`);
  }
  /** Takes a claim's start-slice entries out: your decision now says what the slice holds about it. */
  async function unslice(connection: Connection, page: string, text: string): Promise<void> {
    const rows = (await record.raw(`SELECT id, diff FROM learned_layer WHERE target = ${sqlText(`slice:${page}`)} AND layer = 'learned' AND state = 'applied' AND kind IN ('learn.applied', 'learn.widened')`)) as { id: string; diff: string }[];
    for (const row of rows) if (row.diff.split('\n').includes(`+ ${text}`)) await record.rollBack(connection, { change: row.id });
  }

  async function keepEdits(connection: Connection): Promise<string[]> {
    if (!YOURS.has(connection.writer)) throw Error(`only you keep edits to the wiki, through the app or the CLI, not ${connection.writer}`);
    const decisions: string[] = [];
    const rows = await inForce();
    for (const page of edited()) {
      const lines = readFileSync(join(folder, `${page}.md`), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !CLOSING.test(l));
      const onPage = new Map<string, string>();
      const added: string[] = [];
      for (const line of lines) {
        const parsed = parseLine(line);
        if (parsed && typeof parsed.record.id === 'string') onPage.set(parsed.record.id, parsed.text);
        else added.push(line.replace(/^[-*] /, '').trim());
      }
      for (const row of rows.filter((r) => r.page === page && r.state === 'in force')) {
        const was = parseLine(row.diff.slice(2))!.text;
        const is = onPage.get(row.target.slice(row.target.indexOf('#') + 1));
        if (is === was) continue;
        await unslice(connection, page, was);
        if (is === undefined) {
          // A line you removed: your decision says it isn't so, and the claim leaves the wiki.
          decisions.push(await decide(connection, `no: ${was}`, row.scope, row.target));
          await record.rollBack(connection, { change: row.id });
        } else {
          const decision = await decide(connection, is, row.scope, row.target);
          decisions.push(decision);
          await onDecision(connection, row, is, decision);
        }
      }
      const repo = /^repos\/([0-9A-Za-z]+)$/.exec(page)?.[1];
      const ids = new Set(rows.filter((r) => r.page === page).map((r) => r.target.slice(r.target.indexOf('#') + 1)));
      for (const text of added.map((t) => withoutQueries(t))) {
        // A line you added: a claim of its own, known from your decision.
        const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'line';
        let id = base;
        for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
        ids.add(id);
        const scope = repo ? `repo:${repo}` : 'all';
        const decision = await decide(connection, text, scope, `wiki:${page}#${id}`);
        decisions.push(decision);
        const line = render(text, { id, known: 'decision', proof: 1, sources: [{ at: decision, quote: text }], seen: new Date(now()).toISOString() });
        const made = await apply(connection, { target: `wiki:${page}#${id}`, diff: `+ ${line}`, evidence: [{ at: decision, quote: text }], scope, applied_by: 'you', supersedes: null });
        if (made.refused) throw Error(`your line on ${page} was saved as ${decision}, but no claim holds it: ${made.refused}`);
      }
    }
    // What you kept is written as the wiki writes it now.
    for (const page of edited()) rmSync(join(folder, `${page}.md`), { force: true });
    await write();
    return decisions;
  }

  return {
    async learn(candidates) {
      const out: Learned = { written: [], dropped: [] };
      for (const c of candidates) {
        const reason = await learnOne(c);
        const claim = `wiki:${c.page}#${c.id}`;
        if (reason === undefined) out.written.push(claim);
        else out.dropped.push({ claim, reason });
      }
      await write();
      return out;
    },
    write,
    async promote(connection, claim) {
      if (!YOURS.has(connection.writer)) throw Error(`only you promote ${claim}, through the app or the CLI, not ${connection.writer}`);
      const row = await newest(claim);
      const parsed = row && parseLine(row.diff.slice(2));
      if (!row || !parsed) throw Error(`${claim} is no claim in force`);
      // Your answer, saved as a decision at the claim's scope, by you: the start slice holds it from now on.
      const decision = await decide(connection, parsed.text, row.scope, `promote ${claim}`);
      await onDecision(connection, row, parsed.text, decision);
      await write();
      return decision;
    },
    keepEdits,
  };
}

/** The pages under the wiki's folder, by name; index.md and log.md at its top hold no claims. */
function listPages(folder: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.md')) out.push(relative(folder, path).slice(0, -3));
    }
  };
  walk(folder);
  return out.filter((page) => page !== 'index' && page !== 'log');
}
