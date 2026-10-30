// The wiki's build at setup (#356): your Claude Code and Codex history and memory files, read once per machine and again
// only from each source's read position, into ~/.deepbuild/wiki/. Pattern matching goes first and its claims are on the
// pages before any reading job is started; free text that matched nothing is read by reference through your own agent,
// headless, in the runner, a few sessions' worth of message handles to a job. A source's read position is the record's:
// a wiki.read event per session, never a side file. Nothing here holds a model of its own, and no value of a
// credential is ever read: a claim quotes the archive's scrubbed copy of a transcript, and the log names pages only.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { cwdOf } from '@deepbuild/archive';
import type { Asks } from '@deepbuild/asks';
import type { EvidenceStore } from '@deepbuild/evidence';
import { scrubText } from '@deepbuild/evidence';
import { claimId, openReading } from '@deepbuild/reading';
import { openRecordReader, parseClaimLine, ulid, type Connection, type Message, type RecordStore } from '@deepbuild/record';
import type { Agent, Runner } from '@deepbuild/runner';
import { openWiki, type Candidate, type Wiki } from '@deepbuild/wiki';
import { writeJson } from './claude-settings.js';
import { captureRejected } from './memory.js';
import { repoOf, type Root } from './paths.js';

export interface WikiBuildOptions {
  record: RecordStore;
  root: Root;
  store: EvidenceStore;
  runner: Runner;
  asks: Asks;
  now: () => number;
  /** One archive pass: what the agents wrote is copied into the record before it is read. */
  archive: () => Promise<void>;
  /** The core's connection and yours (the CLI's): the core writes claims and positions, you keep your edits. */
  core: Connection;
  cli: Connection;
  plant?: string | undefined;
  /** The secret values the hub holds: a memory file holding one never reaches a page. */
  held?: readonly string[] | undefined;
}
export interface WikiBuilt {
  /** The pages whose bytes changed, relative to the wiki, `index.md` and `log.md` never among them. */
  changed: string[];
  /** Reading jobs started, and whether one is waiting on the plan reserve (the build then ends; the job goes on). */
  reading: { jobs: number; waiting: boolean };
}

/** The pages that always exist: about you, the setup, and your rules. */
const STANDING = ['you', 'setup', 'rules'];
const REMEMBER = /remember:[ \t]*([^\n]*?)\.(?=\s|$)/g;
/** A cheap "worth keeping?" before a message goes to the agent: it states something to keep, in your words. */
const WORTH = /\b(remember|always|never|must|prefer|needs?|requires?|uses?)\b/i;
const MESSAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** Handles to a reading job, as few as keep a job's context small. */
const JOB = 30;
/** A command that starts a stack, and a check that passes against it: a health request or a test run. */
const START = /^(?:(?:npm|pnpm|yarn|bun)(?: run)? (?:dev|start|serve)|docker[ -]compose up|make (?:serve|dev|run|up|start)|cargo run|uvicorn|flask run|rails s(?:erver)?|python3? manage\.py runserver)(?=\s|$)/;
const CHECK = /^curl\b.*\/(?:health|healthz|ready|status|ping)(?=[\s"'?]|$)|^(?:(?:npm|pnpm|yarn|bun)(?: run)? test|npx vitest|vitest|jest|pytest|cargo test|go test|make test)(?=\s|$)/;
/** A variable that holds a credential, by its name. */
const CREDENTIAL = /^(?:[A-Z][A-Z0-9]*_)+(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|CREDENTIALS?|URL)$/;
const ENV_FILE = /(?:^|[\s=])(\.env(?:\.[\w-]+)*)(?=$|[\s;&|)])/;
const AGENTS = ['claude-code', 'codex'] as const;
/** Where pi and Cursor keep their transcripts (#111); Claude Code's and Codex's come from their adapters' facts. A Cursor line names no folder, but its project folder's name does. */
export const MEMORY_TRANSCRIPTS = [
  { agent: 'pi', transcripts: { home: ['~/.pi/agent'], path: 'sessions/{folder}/{stamp}_{session}.jsonl' } },
  { agent: 'cursor', transcripts: { home: ['~/.cursor'], path: 'projects/{folder}/agent-transcripts/{session}.jsonl' }, folderNames: -3 },
];
/** The memory and instruction files you keep for every repo, one per agent: Claude Code's, Codex's, pi's and Cursor's rules. */
function userMemory(home: string): string[] {
  const rules = join('.cursor', 'rules');
  const cursor = existsSync(join(home, rules)) ? readdirSync(join(home, rules)).filter((n) => n.endsWith('.mdc') || n.endsWith('.md')).sort().map((n) => join(rules, n)) : [];
  return [join('.claude', 'CLAUDE.md'), join('.codex', 'AGENTS.md'), join('.pi', 'agent', 'AGENTS.md'), ...cursor];
}
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const sqlText = (text: string): string => `'${text.replace(/'/g, "''")}'`;
const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');

/**
 * The repo a session worked in, as its folder says: the repo's own ID, or, for a folder that is gone, the ID its name and
 * its path give. A folder that is neither is no repo's. The planted wrong programs merge by name, or by nothing but agent.
 */
export function projectOf(cwd: string, agent: string, plant?: string): string | undefined {
  let id = repoOf(cwd);
  if (!id && !existsSync(cwd)) id = `${letters(basename(cwd))}${sha256(cwd).slice(0, 8)}`;
  if (!id) return undefined;
  if (plant === 'merge-by-name') id = id.slice(0, -8);
  if (plant === 'never-merge') id += letters(agent).toLowerCase();
  return id;
}

/** The page and scope a session's claims go to: its repo's, or the setup's when it worked in none. */
const placeOf = (project: string | null): { page: string; scope: string } => project ? { page: `repos/${project.toLowerCase()}`, scope: `repo:${project}` } : { page: 'setup', scope: 'all' };
/** The first line of a result that holds no mark a value travels with: short, with no `=`, `@` or URL. */
const plainLine = (text: string): string | undefined => text.split('\n').map((l) => l.trim()).find((l) => l && l.length <= 120 && !/[=@]|:\/\//.test(l));
/** The commands of a shell line, each without a leading `NAME=value` or a trailing `&`: every one a piece of the line. */
const segments = (command: string): string[] => command.split(/\s*(?:&&|;|\|\|)\s*/).map((x) => x.replace(/\s*&$/, '').replace(/^(?:[A-Za-z_]\w*=\S+\s+)+/, '').trim()).filter(Boolean);
/**
 * The credentials a command names, by variable name and where each is loaded from, and the exact words of the command
 * that say so. Never a value: the quote is the name and its source, and a command that carries a value elsewhere is
 * quoted only as far as the name.
 */
export function credentialsOf(command: string): { text: string; quote: string }[] {
  const out = new Map<string, { text: string; quote: string }>();
  const add = (name: string, text: string, quote: string): void => { if (CREDENTIAL.test(name)) out.set(text, { text, quote }); };
  for (const m of command.matchAll(/\b([A-Z][A-Z0-9_]*)=\$\(([^()]{1,60})\)/g)) {
    const source = m[2]!.trim();
    if (/^[A-Za-z][\w .\/:-]*$/.test(source)) add(m[1]!, `\`${m[1]}\` is loaded from \`${source}\`.`, m[0]);
  }
  for (const m of command.matchAll(/(^|[\s;&|])([A-Z][A-Z0-9_]*)=(?!\$\()/g)) {
    const name = m[2]!;
    if (command.slice(0, m.index + m[1]!.length).trimEnd().endsWith('export')) add(name, `\`${name}\` is exported: \`export ${name}\`.`, `export ${name}`);
    else add(name, `\`${name}\` is set on the command line.`, name);
  }
  // A command that loads an env file and names variables: only when it carries no value of its own.
  const file = ENV_FILE.exec(command)?.[1];
  if (file && !/\w=\S|:\/\/|@/.test(command.replace(/--[\w-]+=\S+/g, ''))) {
    for (const name of new Set(command.match(/\b[A-Z][A-Z0-9_]*\b/g) ?? [])) add(name, `\`${name}\` is loaded from \`${file}\`.`, command.trim());
  }
  return [...out.values()];
}

interface Position { count: number; last: string | null }
interface Unread { session: string; project: string | null; messages: Message[]; from: number }
interface Row { id: string; project: string | null; transcript: string; agent: string | null }
/** Two folders of one name, one of them gone, and the ask whose key names the pair. */
interface Pair { gone: string; live: string; key: string }

export function openWikiBuild(o: WikiBuildOptions): { build(): Promise<WikiBuilt>; forget(claim: string): Promise<string> } {
  const { record, root, now } = o;
  const folder = root.wiki;
  /** The sessions a reading job still has, so a build run while one waits doesn't hand them to another. */
  const reading = new Set<string>();
  let building: Promise<WikiBuilt> | undefined;

  const pagesOf = (): Map<string, string> => {
    const out = new Map<string, string>();
    const walk = (dir: string): void => {
      for (const e of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
        if (e.isDirectory()) walk(join(dir, e.name));
        else if (e.name.endsWith('.md')) out.set(relative(folder, join(dir, e.name)), readFileSync(join(dir, e.name), 'utf8'));
      }
    };
    walk(folder);
    return out;
  };
  const changedSince = (before: Map<string, string>): string[] => {
    const after = pagesOf();
    return [...after].filter(([name, text]) => name !== 'index.md' && name !== 'log.md' && before.get(name) !== text).map(([name]) => name).sort();
  };
  /** index.md lists the pages; log.md grows at its end by a line for each page a step changed. Neither holds a claim. */
  function bookkeeping(changed: string[]): void {
    mkdirSync(folder, { recursive: true });
    const names = [...pagesOf().keys()].filter((n) => n !== 'index.md' && n !== 'log.md').sort();
    const index = `# DeepBuild wiki\n\n${names.map((n) => `- [${n.slice(0, -3)}](${n})`).join('\n')}\n${o.plant === 'rewrites' ? `\nBuilt ${new Date(now()).toISOString()}\n` : ''}`;
    const file = join(folder, 'index.md');
    if (!existsSync(file) || readFileSync(file, 'utf8') !== index) writeFileSync(file, index);
    if (!changed.length) return;
    const log = join(folder, 'log.md');
    const at = new Date(now()).toISOString();
    appendFileSync(log, `${existsSync(log) ? '' : '# Log\n\n'}${changed.map((n) => `- ${at} updated ${n}\n`).join('')}`);
  }

  async function positions(): Promise<Map<string, Position>> {
    const rows = (await record.raw("SELECT json_extract(data, '$.source') AS source, json_extract(data, '$.count') AS count, json_extract(data, '$.last') AS last FROM events WHERE kind = 'wiki.read' ORDER BY log_pos")) as { source: string; count: number; last: string | null }[];
    return new Map(rows.map((r) => [r.source, { count: r.count, last: r.last }]));
  }
  async function advance(u: Unread): Promise<void> {
    const ts = now();
    const count = u.messages.length;
    await record.append(o.core, { v: 1, id: ulid(ts), kind: 'wiki.read', ts, data: { source: `session:${u.session}`, count, last: u.messages[count - 1]?.id ?? null } });
  }

  /** The claims a user's own messages state outright, `remember: <fact>.`, each cited at its message. */
  function patterns(unread: Unread[]): Candidate[] {
    const found = new Map<string, Candidate>();
    for (const u of unread) {
      const page = u.project ? `repos/${u.project.toLowerCase()}` : 'you';
      for (const m of u.messages.slice(u.from)) {
        if (m.role !== 'user' || m.outside || m.tool !== undefined || !MESSAGE_ID.test(m.id)) continue;
        for (const hit of m.text.matchAll(REMEMBER)) {
          const text = hit[1]!.replace(/\s+/g, ' ').trim();
          if (!text) continue;
          const key = `${page}\n${text}`;
          const source = { at: `session:${u.session}#${m.id}`, quote: text };
          const same = found.get(key);
          if (same) same.sources.push(source);
          else found.set(key, { page, id: claimId(text), text, sources: [source], scope: u.project ? `repo:${u.project}` : 'all' });
        }
      }
    }
    return [...found.values()];
  }
  /**
   * How stacks were started when checks passed, and which credential each step needed: read from the tool calls of the
   * unread messages. A start command is followed, in the same session, by a check that passed (a health request or a
   * test run, whose result is no error). The claim cites the start command and the check's command, which are the agent's
   * own turns (outside content, so never alone first-hand), and the check's result, a tool's own and so first-hand: a
   * start-slice claim needs that one. Each step's credential cites its command and its result.
   */
  function setup(unread: Unread[]): Candidate[] {
    const found = new Map<string, Candidate>();
    const add = (u: Unread, text: string, sources: Candidate['sources']): void => {
      const { page, scope } = placeOf(u.project);
      const same = found.get(`${page}\n${text}`);
      if (same) same.sources.push(...sources);
      else found.set(`${page}\n${text}`, { page, id: claimId(text), text, sources, scope });
    };
    for (const u of unread) {
      const byId = new Map(u.messages.map((m) => [m.id, m]));
      const run = u.messages.slice(u.from).flatMap((result) => {
        const call = result.of === undefined ? undefined : byId.get(result.of);
        return call && result.error !== undefined && MESSAGE_ID.test(call.id) && MESSAGE_ID.test(result.id) ? [{ call, command: call.text, result }] : [];
      });
      const at = (m: Message): string => `session:${u.session}#${m.id}`;
      const proof = (step: (typeof run)[number]): Candidate['sources'] => { const line = plainLine(step.result.text); return line ? [{ at: at(step.result), quote: line }] : []; };
      for (const [i, step] of run.entries()) {
        if (step.result.error) continue;
        for (const c of credentialsOf(step.command)) add(u, c.text, [{ at: at(step.call), quote: c.quote }, ...proof(step)]);
        const start = segments(step.command).find((x) => START.test(x));
        if (!start || start.includes('`') || start.length > 200) continue;
        for (const later of run.slice(i + 1)) {
          const check = later.result.error ? undefined : segments(later.command).find((x) => CHECK.test(x));
          const shown = proof(later);
          if (!check || check.includes('`') || check.length > 200 || !shown.length) continue;
          add(u, `starts with \`${start}\`; a check passed after it: \`${check}\`.`, [{ at: at(step.call), quote: start }, { at: at(later.call), quote: check }, ...shown]);
          break;
        }
      }
    }
    return [...found.values()];
  }
  /**
   * A claim a repo's own CLAUDE.md or AGENTS.md states too cites that line, at the file and the commit, so trust decides
   * whether the claim rests on a repo file or on outside content. The file is read from the repo, not copied: none of its
   * lines becomes a claim of its own.
   */
  function citeRepoFiles(candidates: Candidate[], worktrees: Map<string, string>, cache: Map<string, { commit: string; lines: { path: string; line: string }[] } | null>): void {
    for (const c of candidates) {
      const keys = [...c.text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
      const cwd = worktrees.get(c.page);
      if (!keys.length || !cwd) continue;
      let held = cache.get(cwd);
      if (held === undefined) {
        try {
          const git = (...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 4 * 1024 * 1024 });
          const commit = git('rev-parse', 'HEAD').trim();
          const lines = ['CLAUDE.md', 'AGENTS.md'].flatMap((path) => {
            try { return git('show', `${commit}:${path}`).split('\n').map((l) => l.replace(/^\s*[-*]\s+/, '').trim()).filter((l) => l && l.length <= 300).map((line) => ({ path, line })); } catch { return []; }
          });
          held = { commit, lines };
        } catch { held = null; }
        cache.set(cwd, held);
      }
      for (const { path, line } of held?.lines ?? []) {
        if (keys.every((k) => line.includes(k)) && !c.sources.some((x) => 'path' in x && x.path === path)) c.sources.push({ repo: cwd, path, commit: held!.commit, quote: line });
      }
    }
  }
  /** Each candidate as the page should hold it now: nothing for one it already holds, its new sources added to one it has. */
  async function fresh(candidates: Candidate[]): Promise<Candidate[]> {
    const out: Candidate[] = [];
    for (const c of candidates) {
      const handle = `wiki:${c.page}#${c.id}`;
      const [row] = (await record.raw(`SELECT state FROM wiki_claims WHERE handle = ${sqlText(handle)}`)) as { state: string }[];
      const held = row ? ((await record.raw(`SELECT at, quote FROM wiki_sources WHERE claim = ${sqlText(handle)} AND at IS NOT NULL ORDER BY n`)) as { at: string; quote: string }[]) : [];
      const news = c.sources.filter((s) => 'at' in s && !held.some((h) => h.at === s.at && h.quote === s.quote));
      if (o.plant !== 'rewrites' && row && (!news.length || row.state !== 'in force')) continue;
      out.push(row && o.plant !== 'rewrites' ? { ...c, sources: [...news, ...held].slice(0, Math.max(5, news.length)), supersedes: handle } : row ? { ...c, supersedes: handle } : c);
    }
    return out;
  }
  /** What a claim says is no longer so: "…, not `X`" replaces the claim on its page that says `X`. */
  async function contradicts(c: Candidate): Promise<string | undefined> {
    const old = /\bnot `([^`]+)`/.exec(c.text)?.[1];
    if (!old) return undefined;
    const [row] = (await record.raw(`SELECT handle FROM wiki_claims WHERE page = ${sqlText(c.page)} AND state = 'in force' AND instr(text, ${sqlText(`\`${old}\``)}) > 0 AND instr(text, ${sqlText(`not \`${old}\``)}) = 0 AND handle != ${sqlText(`wiki:${c.page}#${c.id}`)} ORDER BY log_pos`)) as { handle: string }[];
    return row?.handle;
  }

  /** A memory file's text scrubbed, and of a URL's password too: the scrub reads one only under a secret-looking user name. */
  const scrubMemory = (text: string): string => scrubText(text, { held: [...(o.held ?? [])] }).replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi, '$1[REDACTED]@');
  /** A memory file's lines as claims on a page: the ones the page doesn't hold yet, each cited at the file's kept bytes. */
  async function remember(wiki: Wiki, path: string, page: string, scope: string, linesOf: (text: string) => string[], project?: string): Promise<void> {
    const raw = readFileSync(path, 'utf8');
    const bytes = Buffer.from(scrubMemory(raw));
    const missing: { text: string; id: string }[] = [];
    for (const text of new Set(linesOf(raw).filter((t) => t.length <= 300 && scrubMemory(t) === t))) {
      const id = claimId(text);
      if (!((await record.raw(`SELECT 1 FROM wiki_claims WHERE handle = ${sqlText(`wiki:${page}#${id}`)}`)) as unknown[]).length) missing.push({ text, id });
    }
    if (!missing.length) return;
    const at = await record.keep({ ...o.core, ...(project ? { project } : {}) }, { bytes: new Uint8Array(bytes), kind: 'repo.file', source: path });
    await wiki.learn(missing.map(({ text, id }) => ({ page, id, text, sources: [{ at, quote: text }], scope })));
  }
  const bullets = (text: string): string[] => text.split('\n').flatMap((l) => { const t = /^\s*[-*]\s+(.+?)\s*$/.exec(l)?.[1]; return t ? [t] : []; });
  /** A memory file's body, past its front matter: each line that says something. */
  const body = (text: string): string[] => text.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n').map((l) => l.replace(/^\s*[-*]\s+/, '').trim()).filter((l) => l && !l.startsWith('#'));
  /**
   * The memory files you keep for agents: each agent's user-level file as the rules, a rule the files repeat word for word
   * being one claim with each file as a source, and Claude Code's memory for each project (its `memory/` folder, `MEMORY.md`
   * too) as that repo's lines. A repo's own CLAUDE.md and AGENTS.md are not here: what a repo file says is read from the
   * file, so it is cited by the claims that state it (`citeRepoFiles`). A line holding a credential is never read.
   */
  async function rules(wiki: Wiki, projects: Map<string, string>): Promise<void> {
    const holders = new Map<string, { file: string; at: string; bytes: Buffer }[]>();
    for (const rel of userMemory(homedir())) {
      const path = join(homedir(), rel);
      if (!existsSync(path)) continue;
      const raw = readFileSync(path, 'utf8');
      const clean = scrubMemory(raw);
      const held = { file: `~/${rel}`, at: `ev:${sha256(clean)}`, bytes: Buffer.from(clean) };
      for (const text of new Set(bullets(raw.replace(/^---\n[\s\S]*?\n---\n/, '')))) {
        if (text.length <= 300 && scrubMemory(text) === text) holders.set(text, [...(holders.get(text) ?? []), held]);
      }
    }
    const shared: Candidate[] = [];
    const keep = new Map<string, Buffer>();
    for (const [text, files] of holders) {
      const id = claimId(text);
      const handle = `wiki:rules#${id}`;
      const [row] = (await record.raw(`SELECT c.state AS state, l.diff AS diff FROM wiki_claims c JOIN learned_layer l ON l.handle = c.change WHERE c.handle = ${sqlText(handle)}`)) as { state: string; diff: string }[];
      if (row && row.state !== 'in force') continue;
      const line = row ? parseClaimLine(row.diff.slice(2)) : undefined;
      const had = (Array.isArray(line?.record.sources) ? line.record.sources : []) as { at?: string; file?: string }[];
      if (had.length === files.length && files.every((f) => had.some((s) => s.at === f.at && s.file === f.file))) continue;
      for (const f of files) keep.set(f.at, f.bytes);
      shared.push({ page: 'rules', id, text, sources: files.map((f) => ({ at: f.at, quote: text, file: f.file })), scope: 'all', ...(row ? { supersedes: handle } : {}) });
    }
    for (const [at, bytes] of keep) {
      if (await record.keep(o.core, { bytes: new Uint8Array(bytes), kind: 'user.memory', source: at }) !== at) throw Error(`the evidence store kept a memory file under another hash than ${at}`);
    }
    if (shared.length) await wiki.learn(shared);
    for (const [project, cwd] of projects) {
      const dir = join(homedir(), '.claude', 'projects', cwd.replace(/[^0-9A-Za-z]/g, '-'), 'memory');
      for (const name of existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.md')).sort() : []) {
        await remember(wiki, join(dir, name), `repos/${project.toLowerCase()}`, `repo:${project}`, name === 'MEMORY.md' ? bullets : body, project);
      }
    }
  }

  /**
   * Two folders of one name, one of them gone: the pages stay apart and you are asked once, naming both paths. Resolves with
   * each such pair; one you answered "Same repo" is merged by `merged`.
   */
  async function unclear(sessions: Row[]): Promise<Pair[]> {
    const pairs: Pair[] = [];
    const cwds = new Map<string, { cwd: string; sha: string }>();
    const byName = new Map<string, Set<string>>();
    for (const s of sessions) if (s.project) byName.set(s.project.slice(0, -8), (byName.get(s.project.slice(0, -8)) ?? new Set()).add(s.project));
    for (const projects of byName.values()) {
      if (projects.size < 2) continue;
      for (const p of projects) {
        const s = sessions.find((x) => x.project === p)!;
        const sha = s.transcript.replace(/^ev:/, '');
        const cwd = cwdOf(Buffer.from(await o.store.read(sha)).toString('utf8'));
        if (cwd) cwds.set(p, { cwd, sha });
      }
      for (const gone of projects) {
        const g = cwds.get(gone);
        if (!g || existsSync(g.cwd)) continue;
        for (const other of projects) {
          const x = cwds.get(other);
          if (!x || other === gone) continue;
          const key = sha256(`wiki.merge:${[g.cwd, x.cwd].sort().join('\n')}`);
          pairs.push({ gone, live: other, key });
          if (((await record.raw(`SELECT 1 FROM events WHERE kind = 'ask.created' AND json_extract(data, '$.key') = ${sqlText(key)} LIMIT 1`)) as unknown[]).length) continue;
          const ts = now();
          await o.asks.raise(o.core, 'wiki.merge', {
            kind: 'exception',
            question: `Setup found two folders named ${basename(g.cwd)}: ${g.cwd}, which is no longer on disk, and ${x.cwd}. Are they one repo? Until you say, their pages stay apart.`,
            options: [{ id: 'apart', label: 'Keep them apart', decision: 'none' }, { id: 'same', label: 'Same repo', decision: 'none' }, { id: 'later', label: 'Not now', decision: 'none' }],
            recommended: 'apart', deadline: ts + 2 * 86_400_000, fallback: 'you', default: 'later', provisional: false, owner: o.core.actor,
            key, pinned_to: { kind: 'evidence', ref: g.sha },
          });
        }
      }
    }
    return pairs;
  }
  /**
   * The pairs you answered "Same repo": the answer is kept as a decision (the asks core saves it), and the gone folder's
   * sessions count as the live repo's. Resolves with the live project's ID and the decision, by the gone project's.
   */
  async function merged(pairs: Pair[]): Promise<Map<string, { live: string; decision: string }>> {
    const alias = new Map<string, { live: string; decision: string }>();
    for (const { gone, live, key } of pairs) {
      const [asked] = (await record.raw(`SELECT id FROM asks WHERE key = ${sqlText(key)} AND outcome = 'answered' AND answer = '"same"' ORDER BY created DESC LIMIT 1`)) as { id: string }[];
      if (!asked) continue;
      const held = async (): Promise<string | undefined> => ((await record.raw(`SELECT id FROM decisions WHERE key = ${sqlText(key)} AND state = 'active' AND answer = '"same"' ORDER BY created DESC LIMIT 1`)) as { id: string }[])[0]?.id;
      const decision = (await held()) ?? (await o.asks.saveDecision(o.cli, `ask:${asked.id}`, 'all')).replace(/^decision:/, '');
      alias.set(gone, { live, decision: `decision:${decision}` });
    }
    return alias;
  }
  /**
   * A gone folder's claims on the live repo's page: each replaces its own, which stays in the record as superseded. Each
   * cites your decision beside its own sources, which is what lets the record put it on a repo its sessions weren't in; a
   * claim that rests on outside content only stays where it is, since a merge is no promotion of it.
   */
  async function move(wiki: Wiki, alias: Map<string, { live: string; decision: string }>): Promise<void> {
    for (const [gone, { live, decision }] of alias) {
      const from = `repos/${gone.toLowerCase()}`;
      const to = `repos/${live.toLowerCase()}`;
      const held = (await record.raw(`SELECT handle, text FROM wiki_claims WHERE page = ${sqlText(from)} AND state = 'in force' AND known != 'outside' ORDER BY log_pos`)) as { handle: string; text: string }[];
      const moving: Candidate[] = [];
      for (const { handle, text } of held) {
        if (((await record.raw(`SELECT 1 FROM wiki_claims WHERE handle = ${sqlText(`wiki:${to}#${handle.slice(handle.indexOf('#') + 1)}`)} AND state = 'in force'`)) as unknown[]).length) continue;
        const sources = (await record.raw(`SELECT at, repo, path, commit_sha, quote FROM wiki_sources WHERE claim = ${sqlText(handle)} ORDER BY n`)) as { at: string | null; repo: string | null; path: string | null; commit_sha: string | null; quote: string }[];
        moving.push({ page: to, id: handle.slice(handle.indexOf('#') + 1), text, sources: [...sources.map((x) => x.at ? { at: x.at, quote: x.quote } : { repo: x.repo!, path: x.path!, commit: x.commit_sha!, quote: x.quote }), { at: decision, quote: 'same' }], scope: `repo:${live}`, supersedes: handle });
      }
      if (moving.length) await wiki.learn(moving);
    }
  }

  /**
   * The choices setup drafts once, into config.json, each only when it isn't there: the share of a plan window kept for
   * you, the agent that does DeepBuild's own reading (a signed-in one, Claude Code first), and each agent's account with
   * the repos its sessions worked in. A value you set is never written over, and a file that doesn't parse is left as it
   * is. The test resources live journeys may use have no reader yet, so none is drafted. Resolves with the reading agent.
   */
  function choose(repos: Map<Agent, string[]>): Agent {
    const file = join(root.dir, 'config.json');
    let config: Record<string, unknown> = {};
    try { config = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { if (existsSync(file)) return 'claude-code'; }
    const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {});
    const home = homedir();
    const signedIn = (a: Agent): boolean => a === 'claude-code' ? existsSync(join(home, '.claude.json')) || existsSync(join(home, '.claude', '.credentials.json')) : existsSync(join(home, '.codex', 'auth.json'));
    const plan = obj(config.plan);
    const reading = obj(config.reading);
    const accounts = obj(config.accounts);
    let changed = false;
    if (typeof plan.reserve_pct !== 'number') { config.plan = { ...plan, reserve_pct: 10 }; changed = true; }
    if (reading.agent === undefined) { config.reading = { ...reading, agent: AGENTS.find(signedIn) ?? 'claude-code' }; changed = true; }
    for (const agent of AGENTS) {
      const seen = repos.get(agent);
      if (accounts[agent] === undefined && seen?.length) { accounts[agent] = { repos: seen }; config.accounts = accounts; changed = true; }
    }
    if (changed) writeJson(file, config);
    const chosen = obj(config.reading).agent;
    return AGENTS.find((a) => a === chosen) ?? 'claude-code';
  }

  async function run(): Promise<WikiBuilt> {
    await o.archive();
    await record.sync();
    const before = pagesOf();
    const wiki = await openWiki({ record, folder, now, pages: STANDING });
    // A line you deleted stays deleted: your edits are kept, as your decisions, before anything is learned again. The
    // planted wrong program forgets them and writes every page from the claims in force.
    if (o.plant === 'resurrects') {
      for (const name of pagesOf().keys()) if (!/^(index|log)\.md$/.test(name)) rmSync(join(folder, name));
      await wiki.write();
    } else await wiki.keepEdits(o.cli);
    const reader = openRecordReader({ path: root.ledger, evidence: o.store });
    try {
      const rows = (await record.raw("SELECT s.id AS id, s.project_id AS project, s.transcript AS transcript, (SELECT agent FROM events WHERE kind = 'transcript.archived' AND replace(replace(json_extract(data, '$.session'), 'session:', ''), '-', '') = s.id ORDER BY log_pos DESC LIMIT 1) AS agent FROM sessions s WHERE s.transcript IS NOT NULL ORDER BY s.id")) as Row[];
      // The folder each repo's sessions worked in, by agent, read from the first of its transcripts.
      const folders = new Map<string, string>();
      const homes = new Map<Agent, string[]>();
      for (const r of rows) {
        if (!r.project) continue;
        const agent = r.agent === 'codex' || r.agent === 'pi' || r.agent === 'cursor' ? r.agent : 'claude-code';
        const key = `${agent}\n${r.project}`;
        if (folders.has(key)) continue;
        const cwd = cwdOf(Buffer.from(await o.store.read(r.transcript.replace(/^ev:/, ''))).toString('utf8'));
        if (!cwd) continue;
        folders.set(key, cwd);
        // Only the agents DeepBuild can run for its own reading have accounts to choose.
        if (agent === 'codex' || agent === 'claude-code') homes.set(agent, [...(homes.get(agent) ?? []), cwd].sort());
      }
      const readingAgent = choose(homes);
      // A gone folder you said is the live repo's: its sessions count as the live repo's, and what it holds moves there.
      const alias = await merged(await unclear(rows));
      await move(wiki, alias);
      for (const r of rows) r.project = (r.project && alias.get(r.project)?.live) ?? r.project;
      const projects = new Map([...folders].map(([key, cwd]) => [key.slice(key.indexOf('\n') + 1), cwd] as const));
      const read = await positions();
      const unread: Unread[] = [];
      for (const s of rows) {
        const messages = (await reader.transcript(s.id)) ?? [];
        const at = read.get(`session:${s.id}`);
        const from = o.plant === 'rereads-all' || !at || messages[at.count - 1]?.id !== at.last ? 0 : at.count;
        if (from < messages.length && !reading.has(s.id)) unread.push({ session: s.id, project: s.project, messages, from });
      }
      await rules(wiki, projects);
      // Not pi's or Cursor's: their files come with no adapter's facts, so what they say you said no hook ever saw.
      const adapted = new Set(rows.filter((r) => r.agent !== 'pi' && r.agent !== 'cursor').map((r) => r.id));
      await captureRejected(record, o.cli, now, unread.filter((u) => adapted.has(u.session)));
      // Pattern matching, claims that contradict an earlier one after the rest, so the older is on its page to be replaced.
      const found = [...patterns(unread), ...setup(unread)];
      citeRepoFiles(found, new Map([...projects].map(([project, cwd]) => [`repos/${project.toLowerCase()}`, cwd])), new Map());
      const plain: Candidate[] = [];
      const against: Candidate[] = [];
      for (const c of await fresh(found)) (/\bnot `[^`]+`/.test(c.text) ? against : plain).push(c);
      if (plain.length) await wiki.learn(plain);
      if (against.length) {
        const replacing: Candidate[] = [];
        for (const c of against) {
          const old = await contradicts(c);
          replacing.push(old && !c.supersedes ? { ...c, supersedes: old } : c);
        }
        await wiki.learn(replacing);
        if (o.plant === 'deletes-contradicted') for (const c of replacing) if (c.supersedes) for (const id of (await record.raw(`SELECT id FROM learned_layer WHERE target = ${sqlText(c.supersedes)} AND layer = 'learned' AND state = 'applied' AND kind IN ('learn.applied', 'learn.widened') ORDER BY log_pos DESC`)) as { id: string }[]) await record.rollBack(o.core, { change: id.id });
        if (o.plant === 'deletes-contradicted') await wiki.write();
      }
      if (o.plant === 'copies-values') {
        const seen = new Set<string>();
        for (const s of rows) {
          const cwd = cwdOf(Buffer.from(await o.store.read(s.transcript.replace(/^ev:/, ''))).toString('utf8'));
          const env = cwd && join(cwd, '.env.local');
          if (env && !seen.has(env) && existsSync(env)) { seen.add(env); appendFileSync(join(folder, 'log.md'), `${readFileSync(env, 'utf8')}`); }
        }
      }
      bookkeeping(changedSince(before));
      let seen = pagesOf();

      // The reading: what the patterns left in the user's own words, by message handle, a few sessions to a job.
      const batches: Unread[][] = [];
      const own = new Map<string, string[]>();
      for (const u of unread) {
        const handles = u.messages.slice(u.from).filter((m) => m.role === 'user' && !m.outside && m.tool === undefined && MESSAGE_ID.test(m.id) && WORTH.test(m.text)).map((m) => `session:${u.session}#${m.id}`);
        if (!handles.length) { await advance(u); continue; }
        own.set(u.session, handles);
        const last = batches[batches.length - 1];
        if (last && last.reduce((n, x) => n + own.get(x.session)!.length, 0) + handles.length <= JOB) last.push(u);
        else batches.push([u]);
      }
      const built: WikiBuilt = { changed: [], reading: { jobs: 0, waiting: false } };
      if (batches.length) {
        const agent = await openReading({ record, runner: o.runner, root: root.dir, wiki, now });
        const chain = (async () => {
          for (const batch of batches) {
            for (const u of batch) reading.add(u.session);
            try {
              built.reading.jobs++;
              const result = await agent.run({ kind: 'install', agent: readingAgent, handles: batch.flatMap((u) => own.get(u.session)!) });
              const ended = result.runs.length ? (await o.runner.status(result.runs[0]!)).state : undefined;
              if (ended === 'finished') for (const u of batch) await advance(u);
            } catch (error) {
              process.stderr.write(`deep hub: wiki reading: ${error instanceof Error ? error.message : String(error)}\n`);
              return;
            } finally {
              for (const u of batch) reading.delete(u.session);
              const changed = changedSince(seen);
              bookkeeping(changed);
              seen = pagesOf();
            }
          }
        })();
        // Done is each job finished or waiting on the plan reserve: a job that waits goes on in the background.
        let settled = false;
        void chain.finally(() => { settled = true; });
        while (!settled) {
          if ((await o.runner.list()).some((j) => j.kind === 'read' && j.state === 'waiting' && j.blocked)) { built.reading.waiting = true; break; }
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      built.changed = o.plant === 'rewrites' ? [...pagesOf().keys()].filter((n) => !/^(index|log)\.md$/.test(n)).sort() : changedSince(before);
      return built;
    } finally {
      reader.close();
    }
  }
  return {
    build: () => (building ??= run().finally(() => { building = undefined; })),
    /** Your removal of a claim (#111), once any build has finished: the pages and their index and log follow. */
    async forget(claim) {
      await building?.catch(() => undefined);
      const before = pagesOf();
      const decision = await (await openWiki({ record, folder, now, pages: STANDING })).forget(o.cli, claim);
      bookkeeping(changedSince(before));
      return decision;
    },
  };
}
