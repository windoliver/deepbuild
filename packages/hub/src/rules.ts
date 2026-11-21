// The rules page and the rules that reach every agent's sessions (#344; design: Your written rules, enforced). Every
// rule you wrote for agents is a bullet of a rule file (a repo's AGENTS.md and CLAUDE.md at its root and below it,
// Copilot's instructions with their `applyTo`, Cursor's rules with their `globs`, and your user-level files) or a rule
// you typed in a session (`rule: <text>.`). Each keeps its file, its scope (`all`, a nested file's folder, or the glob
// its file applies to), its size in tokens and what enforces it: a guard only while its planted call is denied and its
// twin allowed, otherwise text only. A rule line an agent's edit removed stays in force here, held, as a proposal to you.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { RubricRule } from '@deepbuild/checks-review';
import type { RecordStore } from '@deepbuild/record';
import { callAsYou } from './client.js';
import { indexFile, loaders, lostIn, marksOf, type Lost, type Marks } from './rule-load.js';
import { visible } from './visible.js';
import type { HookMeta, Scoped } from './wire.js';

type Raw = RecordStore['raw'];
type Enforcer = { kind: 'guard'; name: string } | { kind: 'text' };
export interface RuleFile {
  /** Repo-relative, or `~/.codex/AGENTS.md` for a user-level file. */
  file: string;
  path: string;
  /** `all`, a nested file's `<folder>/**`, or the glob its front matter applies it to, verbatim. */
  scope: string;
  tokens: number;
  rules: string[];
  /** Each rule's line in the file, from 1, in the order of `rules`. */
  lines?: number[];
  /** The agent that reads this file by itself, so its start slice doesn't repeat it. */
  native?: 'claude-code' | 'codex';
  /** The repo folder a repo file is in. */
  repo?: string;
  /** An agent's own memory index (#1514): its lines go to no other agent, and to its own only past the index limit. */
  index?: true;
}
export interface Rule {
  id: string; text: string; file: string; scope: string; known: 'you' | 'repo'; tokens: number; enforcer: Enforcer;
  /** The repo folder a repo file's rule is in. */
  repo?: string;
  /** A rule you typed: its base target in the record, `rule:typed<id>`. */
  target?: string;
  native?: 'claude-code' | 'codex';
  /** The proposal an agent's removal of its line became; the rule stays in force until you apply it. */
  held?: string;
  /** Its file's path and its line there (#1514), so the lines an agent never gets can be told. */
  path?: string;
  line?: number;
  index?: true;
}
export interface Held { id: string; text: string; file: string; scope: string; repo: string; proposal: string; ask: string }

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
/** Text as rules are compared: one space per whitespace run, no trailing period, case folded. */
export const sameRule = (text: string): string => text.replace(/\s+/g, ' ').trim().replace(/\.$/, '').toLowerCase();
export const ruleId = (file: string, text: string): string => sha256(`${file}\u0000${sameRule(text)}`).slice(0, 12);
export const handleOf = (rule: Pick<Rule, 'id'>): string => `wiki:rules#${rule.id}`;
/** A rule's size in tokens: each word piece of up to five letters, each number and each mark is one. */
export const tokensOf = (text: string): number =>
  (text.match(/[A-Za-z]+|\d+|[^\sA-Za-z\d]/g) ?? []).reduce((n, piece) => n + (/^[A-Za-z]+$/.test(piece) ? Math.ceil(piece.length / 5) : 1), 0);

/** A glob as rule files write one: `**` any folders, `*` within a name, `?` one character; several apart by commas. */
export function globMatches(glob: string, path: string): boolean {
  let res = GLOBS.get(glob);
  if (!res) {
    res = glob.split(',').map((g) => g.trim()).filter(Boolean).map((g) => {
      let re = '';
      for (let i = 0; i < g.length; i++) {
        const c = g[i]!;
        if (c === '*' && g[i + 1] === '*') {
          i++;
          if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
        } else if (c === '*') re += '[^/]*';
        else if (c === '?') re += '[^/]';
        else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      }
      return new RegExp(`^${re}$`);
    });
    if (GLOBS.size >= 1024) GLOBS.clear();
    GLOBS.set(glob, res);
  }
  const p = path.replace(/^\.\//, '');
  return res.some((re) => re.test(p));
}
/** Each glob's compiled forms, kept for the next call; emptied at 1,024 globs, so a stream of new ones can't grow it. */
const GLOBS = new Map<string, RegExp[]>();
/** Whether a rule's scope covers a repo-relative path. */
const covers = (scope: string, path: string): boolean => scope === 'all' || globMatches(scope, path);

/** The folder of the git repo `cwd` is in, or undefined. */
export function repoRoot(cwd: string | undefined): string | undefined {
  for (let dir = cwd ? resolve(cwd) : ''; dir; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
  return undefined;
}

/** A file's front matter fields and its body. */
function frontOf(text: string): { fields: Map<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const fields = new Map<string, string>();
  for (const line of (m?.[1] ?? '').split('\n')) {
    const f = /^([A-Za-z]+):\s*(.*)$/.exec(line.trim());
    if (f) fields.set(f[1]!, f[2]!.trim().replace(/^\[|\]$/g, '').split(',').map((v) => v.trim().replace(/^["']|["']$/g, '')).join(','));
  }
  return { fields, body: m ? text.slice(m[0].length) : text };
}
/** The bullets of a file's body, outside code fences: each one rule. */
function bulletsOf(body: string): string[] {
  return bulletLines(body).map((b) => b.text);
}
/** Each bullet of a body with its line in the body, from 1. */
function bulletLines(body: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let fenced = false;
  body.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return; }
    const m = fenced ? undefined : /^\s*[-*+]\s+(.+?)\s*$/.exec(line);
    if (m && !/^\[[ xX]\]\s*$/.test(m[1]!)) out.push({ text: m[1]!, line: i + 1 });
  });
  return out;
}

/** The rules a rule file holds now: the bullets of its body, past any front matter. */
export function rulesInFile(path: string): string[] {
  try { return bulletsOf(frontOf(readFileSync(path, 'utf8')).body); } catch { return []; }
}

const SKIP = new Set(['.git', 'node_modules', 'target', 'dist', 'build', 'vendor', '.venv']);
/** The rule files under a repo, repo-relative: AGENTS.md and CLAUDE.md at any depth, Copilot's and Cursor's. */
function repoFiles(repo: string): string[] {
  const out: string[] = [];
  let seen = 0;
  const walk = (dir: string): void => {
    let entries: import('node:fs').Dirent[];
    try { entries = readdirSync(join(repo, dir), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (++seen > 50_000) return;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith('.')) walk(rel); continue; }
      if (e.name === 'AGENTS.md' || e.name === 'CLAUDE.md') out.push(rel);
    }
  };
  walk('');
  const list = (dir: string, end: string): string[] => {
    try { return readdirSync(join(repo, dir)).filter((n) => n.endsWith(end)).sort().map((n) => `${dir}/${n}`); } catch { return []; }
  };
  if (existsSync(join(repo, '.github', 'copilot-instructions.md'))) out.push('.github/copilot-instructions.md');
  return [...out.sort(), ...list('.github/instructions', '.instructions.md'), ...list('.cursor/rules', '.mdc')];
}
function readFile(path: string, file: string, scopeOf: (fields: Map<string, string>) => string, native?: RuleFile['native'], repo?: string): RuleFile | undefined {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { return undefined; }
  return fileOf(text, path, file, scopeOf, native, repo);
}
function fileOf(text: string, path: string, file: string, scopeOf: (fields: Map<string, string>) => string, native?: RuleFile['native'], repo?: string): RuleFile {
  const { fields, body } = frontOf(text);
  // A rule's line counts the front matter's lines too; a rule written twice is at its first line.
  const before = text.slice(0, text.length - body.length).split('\n').length - 1;
  const at = new Map<string, number>();
  for (const b of bulletLines(body)) if (!at.has(b.text)) at.set(b.text, b.line + before);
  return { file, path, scope: scopeOf(fields), tokens: tokensOf(text), rules: [...at.keys()], lines: [...at.values()], ...(native ? { native } : {}), ...(repo ? { repo } : {}) };
}
/**
 * A repo's memory indexes (#1514): each agent's whose facts name one, as a rule file, its bullets the rules, so the
 * page can mark the lines past its limit. Read from the agent's own folder for the repo; none when it has no index.
 */
export function indexFiles(repo: string): RuleFile[] {
  return loaders().flatMap((l) => {
    const path = indexFile(l, repo);
    const read = path ? readFile(path, path.replace(homedir(), '~'), () => 'all', l.agent as RuleFile['native'], repo) : undefined;
    return read ? [{ ...read, index: true as const }] : [];
  });
}
/** A repo rule file's scope from its front matter, and the agent that reads it by itself. */
function repoScope(rel: string): { scopeOf: (fields: Map<string, string>) => string; native: RuleFile['native'] } {
  const name = basename(rel);
  const folder = dirname(rel);
  return {
    native: name === 'CLAUDE.md' ? 'claude-code' : name === 'AGENTS.md' ? 'codex' : undefined,
    scopeOf: (fields) => rel.startsWith('.github/instructions/') ? fields.get('applyTo') || 'all'
      : rel.startsWith('.cursor/rules/') ? (fields.get('alwaysApply') === 'true' ? 'all' : fields.get('globs') || 'all')
        : folder === '.' || rel.startsWith('.github/') ? 'all' : `${folder}/**`,
  };
}
/**
 * The rule files of `repo` as `commit` holds them (#1512), read through git in `dir`, never from the checkout a claim
 * could change: the files `repoFiles` finds, in its order.
 */
export function ruleFilesAt(dir: string, commit: string, repo: string): RuleFile[] {
  const git = (args: string[]): string => execFileSync('git', ['-C', dir, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 256 << 20 });
  const tracked = git(['ls-tree', '-r', '-z', '--name-only', commit]).split('\0').filter(Boolean);
  const walked = tracked.filter((p) => /(^|\/)(AGENTS|CLAUDE)\.md$/.test(p) && !p.split('/').slice(0, -1).some((d) => SKIP.has(d) || d.startsWith('.')));
  const under = (folder: string, end: string): string[] => tracked.filter((p) => dirname(p) === folder && p.endsWith(end)).sort();
  const listed = [...[...walked, ...tracked.filter((p) => p === '.github/copilot-instructions.md')].sort(), ...under('.github/instructions', '.instructions.md'), ...under('.cursor/rules', '.mdc')];
  return listed.map((rel) => {
    const { scopeOf, native } = repoScope(rel);
    return fileOf(git(['show', `${commit}:${rel}`]), join(repo, rel), rel, scopeOf, native, repo);
  });
}
/** One repo's rule files, and your user-level ones (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`) unless `home` is null. */
export function readRuleFiles(repo: string | undefined, home: string | null = homedir()): RuleFile[] {
  const out: RuleFile[] = [];
  for (const rel of repo ? repoFiles(repo) : []) {
    const { scopeOf, native } = repoScope(rel);
    const read = readFile(join(repo!, rel), rel, scopeOf, native, repo);
    if (read) out.push(read);
  }
  for (const [rel, native] of home === null ? [] : [['.claude/CLAUDE.md', 'claude-code'], ['.codex/AGENTS.md', 'codex']] as const) {
    const read = readFile(join(home!, rel), `~/${rel}`, () => 'all', native);
    if (read) out.push(read);
  }
  return out;
}

/** Every rule: each file's, the ones held after an agent removed their line, and the ones you typed; each with its enforcer. */
export function rulesOf(o: { files: readonly RuleFile[]; typed: readonly { target: string; text: string }[]; held: readonly Held[]; guards: readonly { name: string; rule: string }[] }): Rule[] {
  const enforcer = (text: string): Enforcer => {
    const g = o.guards.find((x) => sameRule(x.rule) === sameRule(text));
    return g ? { kind: 'guard', name: g.name } : { kind: 'text' };
  };
  const out: Rule[] = [];
  const at = new Set<string>();
  const repos = new Set(o.files.map((f) => f.repo).filter(Boolean));
  for (const f of o.files) {
    const repo = f.repo;
    f.rules.forEach((text, i) => {
      const id = ruleId(f.file, text);
      at.add(id);
      out.push({ id, text, file: f.file, scope: f.scope, known: 'repo', tokens: tokensOf(text), enforcer: enforcer(text), ...(repo ? { repo } : {}), ...(f.native ? { native: f.native } : {}), path: f.path, ...(f.lines?.[i] ? { line: f.lines[i] } : {}), ...(f.index ? { index: true as const } : {}) });
    });
  }
  for (const h of o.held) {
    if (at.has(h.id) || !repos.has(h.repo)) continue;
    at.add(h.id);
    const native = basename(h.file) === 'CLAUDE.md' ? 'claude-code' : basename(h.file) === 'AGENTS.md' ? 'codex' : undefined;
    out.push({ id: h.id, text: h.text, file: h.file, scope: h.scope, known: 'repo', tokens: tokensOf(h.text), enforcer: enforcer(h.text), ...(h.repo ? { repo: h.repo } : {}), held: h.proposal, ...(native ? { native } : {}) });
  }
  for (const t of o.typed) {
    const id = ruleId('you', t.text);
    if (at.has(id)) continue;
    at.add(id);
    out.push({ id, text: t.text, file: 'typed by you', scope: 'all', known: 'you', tokens: tokensOf(t.text), enforcer: enforcer(t.text), target: t.target });
  }
  return out;
}

/** The paths a diff from `from` to `to` touches in the git repo `dir`: each side of a rename, a deleted file's too. */
export const diffPaths = (dir: string, from: string, to: string): string[] =>
  execFileSync('git', ['-C', dir, '-c', 'core.quotePath=false', 'diff', '--no-renames', '--name-only', '-z', from, to], { encoding: 'utf8', maxBuffer: 256 << 20 }).split('\0').filter(Boolean);

/**
 * The rubric lines a review of a diff touching `paths` carries (#1512): each rule here that no guard enforces whose scope
 * covers one of the paths (a rule with no path scope covers every diff), once per wording, as `<id>: <text>` with its size.
 */
export function rubricLines(rules: readonly Rule[], paths: readonly string[]): RubricRule[] {
  const seen = new Set<string>();
  return rules.filter((r) => r.enforcer.kind === 'text' && paths.some((p) => covers(r.scope, p)) && !seen.has(sameRule(r.text)) && seen.add(sameRule(r.text)))
    .map((r) => ({ id: r.id, text: r.text, tokens: tokensOf(`- ${r.id}: ${r.text}`) }));
}

/**
 * The rules page's lines: each file's total, then its rules, each a claim line with its file, scope, enforcer and size,
 * and its marks (#1514): the agents that never get it and why, or the sessions whose record shows it loaded.
 */
export function pageLines(rules: readonly Rule[], files: readonly RuleFile[], marks: (r: Rule) => Marks = () => ({}), review: { read: ReadonlySet<string>; sent: ReadonlyMap<string, SentBack> } = { read: new Set(), sent: new Map() }): string[] {
  const out: string[] = [];
  const claim = (text: string, record: Record<string, unknown>): string => `- ${text} <!-- deep:claim ${JSON.stringify(record).replace(/>/g, '\\u003e')} -->`;
  const byFile = new Map<string, Rule[]>();
  for (const r of rules) byFile.set(`${r.repo ?? ''}\u0000${r.file}`, [...(byFile.get(`${r.repo ?? ''}\u0000${r.file}`) ?? []), r]);
  for (const [key, list] of byFile) {
    const [repo, file] = key.split('\u0000') as [string, string];
    const read = files.find((f) => f.file === file && (f.repo ?? '') === repo);
    // A held rule's line is gone from the file, so it counts on top of what the file holds.
    const tokens = (read?.tokens ?? 0) + list.filter((r) => r.held || !read).reduce((n, r) => n + r.tokens, 0);
    out.push(`- ${file} <!-- deep:rule-file ${JSON.stringify({ file, ...(repo ? { repo } : {}), tokens })} -->`);
    for (const r of list) {
      // A text-only rule a counted review read in the last 30 days reads review as its enforcer, and its line carries
      // the send-backs that named it in those days and how they ended (#1512): a reading only.
      const back = review.sent.get(r.id);
      const enforcer = r.enforcer.kind === 'text' && review.read.has(r.id) ? { kind: 'review', note: 'can send back, can\'t pass' } : r.enforcer;
      out.push(claim(r.text, {
        id: r.id, known: r.known, proof: 1, sources: [{ path: r.file, quote: r.text }], file: r.file, ...(r.repo ? { repo: r.repo } : {}),
        scope: r.scope, enforcer, tokens: r.tokens, ...(r.held ? { held: r.held } : {}), ...marks(r),
        ...(back ? { sent_back: back } : {}),
      }));
    }
  }
  return out;
}

/** A rule file's rules before an agent's edit of it, which the core compares with the file after the edit. */
export interface RuleFileBefore { file: string; scope: string; rules: string[] }
/** The tools whose call writes a file, so a rule file is read before and after. */
export const RULE_EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'apply_patch']);
/**
 * The rules scoped to paths that a call reaches for the first time since the session's start, compaction or resume:
 * each is heard once, at its first call inside its scope. Never one for every path (the start slice has those), and
 * never a file the session's own agent reads by itself. Marks each in `heard`.
 */
export function noticesFor(rules: readonly Rule[], paths: readonly string[], agent: string, heard: Set<string>, lost: readonly Lost[] = []): Rule[] {
  const own = agent === 'codex' ? 'codex' : 'claude-code';
  const out = rules.filter((r) => r.scope !== 'all' && reaches(r, own, lost) && !heard.has(r.id) && paths.some((p) => covers(r.scope, p)));
  for (const r of out) heard.add(r.id);
  return out;
}
/**
 * Whether DeepBuild's route gives a rule to a session of `own` (#344, #1514): one from another agent's file, and one from
 * its own agent's file that the rule-load entry says it never gets. A memory index's line goes only to its own agent,
 * and only past the index limit.
 */
export function reaches(r: Rule, own: string, lost: readonly Lost[]): boolean {
  const gone = (marksOf(r.path ?? '', r.line ?? 0, lost.filter((l) => l.agent === own), new Map()).not_loaded ?? []).length > 0;
  return r.index ? r.native === own && gone : r.native !== own || gone;
}
/** What each agent loses of a repo's files, read again at most every few seconds, so the hook path walks no folder each time. */
export function cachedLost(cache: Map<string, { at: number; lost: Lost[] }>, repo: string, files: readonly RuleFile[]): Lost[] {
  const hit = cache.get(repo);
  if (hit && Date.now() - hit.at < 3000) return hit.lost;
  const lost = lostIn(repo, files.filter((f) => f.repo === repo && !f.index).map((f) => dirname(f.path)));
  cache.set(repo, { at: Date.now(), lost });
  return lost;
}
export const noticeText = (rules: readonly Pick<Rule, 'scope' | 'file' | 'text'>[]): string => rules.map((r) => `DeepBuild: a rule you wrote for ${r.scope} (${r.file}): ${r.text}`).join('\n');

/** A repo's rule files, read again at most every few seconds, so a call's notice doesn't walk the tree each time. */
export function cachedRuleFiles(cache: Map<string, { at: number; files: RuleFile[] }>, repo: string): RuleFile[] {
  const hit = cache.get(repo);
  if (hit && Date.now() - hit.at < 3000) return hit.files;
  const files = [...readRuleFiles(repo, null), ...indexFiles(repo)];
  cache.set(repo, { at: Date.now(), files });
  return files;
}

// ---- What the hub keeps beside the pages: the page's lines (the wiki writes them with the page) and the held rules.
const pageFile = (dir: string): string => join(dir, 'rules-page.json');
const heldFile = (dir: string): string => join(dir, 'rules-held.json');
const readJson = <T>(file: string, empty: T): T => { try { return JSON.parse(readFileSync(file, 'utf8')) as T; } catch { return empty; } };
const writeJson = (file: string, value: unknown): void => { writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`); renameSync(`${file}.tmp`, file); };
export const savePage = (dir: string, lines: readonly string[]): void => writeJson(pageFile(dir), lines);
/** The wiki's appendix for the rules page: the lines the last sync wrote. */
export const rulesAppendix = (dir: string) => (page: string): string[] => (page === 'rules' ? readJson<string[]>(pageFile(dir), []) : []);
export const readHeld = (dir: string): Held[] => readJson<Held[]>(heldFile(dir), []);
export const saveHeld = (dir: string, held: readonly Held[]): void => writeJson(heldFile(dir), held);

const scopedFiles = new Map<string, { at: number; files: RuleFile[] }>();
const scopedLost = new Map<string, { at: number; lost: Lost[] }>();
/** The rules of a file list, built once for it and for the held file as it is: `saveHeld` renames a new file in. */
const scopedBuilt = new WeakMap<RuleFile[], { held: string; rules: Rule[] }>();
/**
 * What a PreToolUse's paths meet of your rules (#344), read on the parser's thread, so the event loop walks no folder
 * and builds no rule: the scoped rules that cover the paths, less the files the session's own agent reads by itself,
 * and an edited rule file's rules before the call runs. The event loop keeps which of them each session heard.
 */
export function scopedAt(meta: HookMeta, dir: string): Scoped | undefined {
  if (!meta.session || !['claude-code', 'claude', 'codex'].includes(meta.agent) || meta.event !== 'PreToolUse' || !meta.call) return undefined;
  const repo = repoRoot(meta.cwd);
  const paths = repo ? callPaths(meta.call.input, meta.cwd, repo) : [];
  if (!repo || !paths.length) return undefined;
  try {
    const files = cachedRuleFiles(scopedFiles, repo);
    const before = RULE_EDITS.has(meta.call.tool)
      ? paths.filter(isRuleFile).map((file) => ({ file, scope: files.find((f) => f.file === file)?.scope ?? 'all', rules: rulesInFile(join(repo, file)) }))
      : [];
    if (before.length) scopedFiles.delete(repo);
    let held = 'none';
    try { const s = statSync(heldFile(dir)); held = `${s.ino}:${s.size}:${s.mtimeMs}`; } catch { /* no rule is held */ }
    let built = scopedBuilt.get(files);
    if (!built || built.held !== held) scopedBuilt.set(files, built = { held, rules: rulesOf({ files, typed: [], held: readHeld(dir), guards: [] }) });
    const rules = noticesFor(built.rules, paths, meta.agent, new Set(), cachedLost(scopedLost, repo, files)).map(({ id, scope, file, text }) => ({ id, scope, file, text }));
    return rules.length || before.length ? { rules, before } : undefined;
  } catch (error) {
    process.stderr.write(`deep hub: rules at ${meta.session}'s call: ${error instanceof Error ? error.message : String(error)}\n`);
    return undefined;
  }
}

/** The repo-relative paths a tool call names: a file, a notebook or a folder, absolute or from the session's folder. */
export function callPaths(input: Record<string, unknown> | undefined, cwd: string, repo: string): string[] {
  const out: string[] = [];
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const v = input?.[key];
    if (typeof v !== 'string' || !v) continue;
    const rel = relative(repo, isAbsolute(v) ? v : resolve(cwd, v));
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) out.push(rel);
  }
  return out;
}
/** Whether a repo-relative path is a rule file this page reads. */
export const isRuleFile = (rel: string): boolean =>
  /(^|\/)(AGENTS|CLAUDE)\.md$/.test(rel) || rel === '.github/copilot-instructions.md' || /^\.github\/instructions\/[^/]+\.instructions\.md$/.test(rel) || /^\.cursor\/rules\/[^/]+\.mdc$/.test(rel);

// ---- What the record says about rules: the sessions a scope reached, the sessions a rule was given to, a session's set.
const DAY = 86_400_000;
/** The sessions of a repo with a tool call inside `scope` since `since`, newest first, each with its count of such calls. */
export async function reachOf(raw: Raw, repo: string, scope: string, since: number): Promise<{ sessions: { handle: string; tool_calls: number }[]; tool_calls: number }> {
  const rows = (await raw(`SELECT e.session_id AS session, e.ts AS ts, json_extract(e.data, '$.paths') AS paths FROM events e JOIN sessions s ON s.id = e.session_id
    WHERE e.kind = 'tool.before' AND e.ts >= ? AND (s.worktree = ? OR s.worktree LIKE ?) ORDER BY e.log_pos`, [since, repo, `${repo}/%`])) as { session: string; ts: number; paths: string | null }[];
  const per = new Map<string, { calls: number; last: number }>();
  for (const r of rows) {
    let paths: unknown;
    try { paths = JSON.parse(r.paths ?? '[]'); } catch { paths = []; }
    const inside = Array.isArray(paths) && paths.some((p) => typeof p === 'string' && covers(scope, relative(repo, p)) && !relative(repo, p).startsWith('..'));
    if (!inside) continue;
    const n = per.get(r.session) ?? { calls: 0, last: 0 };
    per.set(r.session, { calls: n.calls + 1, last: Math.max(n.last, r.ts) });
  }
  const sessions = [...per].sort((a, b) => b[1].last - a[1].last).map(([id, n]) => ({ handle: `session:${id}`, tool_calls: n.calls }));
  return { sessions, tool_calls: sessions.reduce((n, s) => n + s.tool_calls, 0) };
}
export const reachSince = (now: number, days: number): number => now - days * DAY;

/** The send-backs that named a rule (#1512): how many, and how many of them ended fixed and left; the rest are open. */
export interface SentBack { count: number; fixed: number; left: number }
/**
 * The send-backs that named each rule since `since`, by rule, as the review's records hold them (#87, #1862): each
 * item a counted round sent back (`review.read`), fixed or left once a claim on its pull request settled
 * (`review.settled`, the newest), open until then. A reading only: nothing here moves a verdict.
 */
export async function sentBackOf(raw: Raw, since: number): Promise<Map<string, SentBack>> {
  const rows = (await raw(`SELECT kind, data FROM events WHERE kind IN ('review.read', 'review.settled') AND ts >= ? ORDER BY log_pos`, [since])) as { kind: string; data: string }[];
  type Item = { rule: string; sites: unknown };
  const key = (pr: string, i: Item): string => `${pr}\u0000${i.rule}\u0000${JSON.stringify(i.sites)}`;
  const sent: { key: string; rule: string }[] = [];
  const ended = new Map<string, 'fixed' | 'left'>();
  for (const r of rows) {
    const d = JSON.parse(r.data) as { pr: string; sent?: Item[]; outcomes?: (Item & { ended: 'fixed' | 'left' })[] };
    if (r.kind === 'review.read') for (const i of d.sent ?? []) sent.push({ key: key(d.pr, i), rule: i.rule });
    else for (const o of d.outcomes ?? []) ended.set(key(d.pr, o), o.ended);
  }
  const out = new Map<string, SentBack>();
  for (const s of sent) {
    const n = out.get(s.rule) ?? { count: 0, fixed: 0, left: 0 };
    const how = ended.get(s.key);
    out.set(s.rule, { count: n.count + 1, fixed: n.fixed + (how === 'fixed' ? 1 : 0), left: n.left + (how === 'left' ? 1 : 0) });
  }
  return out;
}

/**
 * The rules a counted review's second model read since `since` (#1512), as each review run's output in the record
 * names them: the rules the page reads review as the enforcer of, one that can send back and can't pass.
 */
export async function reviewedOf(raw: Raw, since: number): Promise<Set<string>> {
  const { RULES_READ } = await import('@deepbuild/checks-review');
  const rows = (await raw(`SELECT f.value AS line FROM events e, json_each(e.data, '$.findings') f WHERE e.kind = 'run.finished' AND e.ts >= ?
    AND json_extract(e.data, '$.outcome') IN ('passed', 'failed') AND substr(f.value, 1, ?) = ?`, [since, RULES_READ.length, RULES_READ])) as { line: string }[];
  return new Set(rows.flatMap((r) => r.line.slice(RULES_READ.length).split(', ')));
}

/** The sessions whose record names a rule's delivery: the ones a judgment of that rule credits. */
export async function creditOf(raw: Raw, handle: string): Promise<string[]> {
  const rows = (await raw(`SELECT DISTINCT e.session_id AS session FROM events e, json_each(e.data, '$.rules') r WHERE e.kind = 'session.rules_delivered' AND r.value = ? ORDER BY e.log_pos`, [handle])) as { session: string }[];
  return rows.map((r) => `session:${r.session}`);
}

/** The newest set a session was given (at its start or at a prompt): its log position and what it held. */
export async function setOf(raw: Raw, session: string): Promise<{ pos: number; rules: string[] } | undefined> {
  const [row] = (await raw(`SELECT json_extract(data, '$.pos') AS pos, json_extract(data, '$.rules') AS rules FROM events WHERE kind = 'session.rules_delivered' AND session_id = ? AND json_extract(data, '$.via') IN ('start', 'prompt') ORDER BY log_pos DESC LIMIT 1`, [session])) as { pos: number; rules: string }[];
  return row ? { pos: Number(row.pos), rules: JSON.parse(row.rules) as string[] } : undefined;
}

const USAGE = 'Usage: deep rules sync\n       deep rules reach --repo <folder> --scope <glob> [--json]\n       deep rules credit <rule handle> [--json]\n       deep session rules <session> [--json]';
/** `deep rules ...` and `deep session rules ...`: exit 0 done, 1 refused, 2 a usage error, 3 not decided. */
export async function rulesCommand(args: readonly string[]): Promise<number> {
  const json = args.includes('--json');
  const rest = args.filter((a) => a !== '--json');
  const flag = (name: string): string | undefined => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  let method: string;
  let params: Record<string, unknown>;
  if (rest[0] === 'sync' && rest.length === 1) [method, params] = ['rules.sync', {}];
  else if (rest[0] === 'reach' && rest.length === 5 && flag('--repo') && flag('--scope')) [method, params] = ['rules.reach', { repo: resolve(flag('--repo')!), scope: flag('--scope') }];
  else if (rest[0] === 'credit' && rest.length === 2 && !rest[1]!.startsWith('-')) [method, params] = ['rules.credit', { rule: rest[1] }];
  else if (rest[0] === 'session' && rest.length === 2 && !rest[1]!.startsWith('-')) [method, params] = ['session.rules', { session: rest[1] }];
  else { process.stderr.write(`${USAGE}\n`); return 2; }
  const result = await callAsYou(method, params);
  if (typeof result === 'number') return result;
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else process.stdout.write(`${visible(said(method, params, result))}\n`);
  return 0;
}
/** What a rules call found, in words (#1812); `--json` prints the result itself. */
function said(method: string, params: Record<string, unknown>, r: Record<string, unknown>): string {
  if (method === 'rules.sync') return `The rules page lists ${String(r.rules)} rules from ${String(r.files)} files.`;
  if (method === 'rules.reach') {
    const sessions = r.sessions as { handle: string; tool_calls: number }[];
    return `${sessions.length} session${sessions.length === 1 ? '' : 's'} made ${String(r.tool_calls)} tool calls under ${String(params.scope)} in the last 30 days${sessions.length ? `: ${sessions.map((s) => `${s.handle} ${s.tool_calls}`).join(', ')}` : ''}.`;
  }
  if (method === 'rules.credit') {
    const sessions = r.sessions as string[];
    return sessions.length ? `${String(params.rule)} was given to ${sessions.length} session${sessions.length === 1 ? '' : 's'}: ${sessions.join(', ')}.` : `${String(params.rule)} was given to no session.`;
  }
  return `${String(r.session)} runs the ${String(r.runs)} set of rules, given at log position ${String(r.set)}, and a regression in it is credited to the set at ${String(r.credited_to)}.`;
}
