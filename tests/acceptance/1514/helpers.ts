// What #1514's tests share (README): the criterion tags; the issue's fixtures (a repo whose root and nested AGENTS.md
// total 40 KiB, a 307-line memory index, a 150-line memory index of 300 bytes a line) and their arithmetic; the fixture
// facts (the shipped facts files with only the limit a criterion fixes changed); the rules page read back and the marks
// on its lines; the doctor's rules.not_loaded items; and a native load event recorded in a Codex session's record. Each
// test file reaches DeepBuild through an earlier suite's world (19/doctor's, 344's), imported there, never copied here.
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { openRecord, ulid, type Connection } from '../../../packages/record/src/index.ts';
import type { DoctorItem, Doctored } from '../19/doctor/helpers.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

// ---- Criterion tags: `#1514.<first 8 hex of the SHA-256 of the criterion's text>`, trimmed with white space collapsed,
// as scripts/proof-change.mjs's criterionId computes them (README, Criteria to tests).
export const AC1 = 'AC1 #1514.63e8c235';
export const AC2 = 'AC2 #1514.1c915faf';
export const AC3 = 'AC3 #1514.cf1be8d6';
export const AC4 = 'AC4 #1514.d19a73eb';
export const AC5 = 'AC5 #1514.57ce9222';
export const AC6 = 'AC6 #1514.26da020e';
export const AC7 = 'AC7 #1514.a1d1911e';

// ---- The planted wrong programs (README: Wrong programs the implementer adds), read by the doctor's process.
export const SUMS_PER_FILE = 'doctor-sums-per-file';
export const COUNTS_LINES_ONLY = 'doctor-counts-lines-only';

// ---- The limits the criteria fix.
export const KIB = 1024;
/** Codex's facts budget in AC1, AC2 and AC6: 32 KiB, shared by every AGENTS.md it reads. */
export const CODEX_BUDGET = 32 * KIB;
/** Claude Code's facts limits on its memory index in AC4 and AC7. */
export const INDEX_LINES = 200;
export const INDEX_BYTES = 25_000;

// ---- How a mark or an item names an agent and a cause (README: The surface under test).
export const CLAUDE = /claude/i;
export const CODEX = /codex/i;
export const OVER_BUDGET = /budget/i;
export const SHADOWED = /shadow/i;
export const PAST_INDEX = /index/i;
export const UNTRUSTED = /untrust|not[ _-]?trust|n't trust/i;

// ---- Fixture text.
const pad3 = (n: number): string => String(n).padStart(3, '0');
/** `count` lines of exactly `width` bytes each, the newline included: `words(n)` (ASCII) padded with dots. */
function fixedLines(count: number, width: number, words: (n: number) => string): string {
  let out = '';
  for (let n = 1; n <= count; n++) {
    const w = words(n);
    if (w.length > width - 1) throw Error(`fixture line ${n} is longer than ${width - 1} characters: ${w}`);
    out += `${w.padEnd(width - 1, '.')}\n`;
  }
  return out;
}
export interface Rule { file: string; line: number; text: string }
/** A file's bullet lines, each a rule as the rules page lists it: the text after `- `. */
function rulesOf(file: string, text: string): Rule[] {
  return text.split('\n').flatMap((l, i) => (l.startsWith('- ') ? [{ file, line: i + 1, text: l.slice(2) }] : []));
}
export const linesOf = (text: string): number => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
export const bytesOf = (text: string): number => Buffer.byteLength(text);
/** The first line (from 1) not loaded whole under a line cap and a byte cap, newlines counted, after `spent` bytes. */
export function firstLost(text: string, cap: { lines?: number; bytes?: number }, spent = 0): number | undefined {
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  let end = spent;
  for (let i = 0; i < lines.length; i++) {
    end += bytesOf(`${lines[i]}\n`);
    if ((cap.lines !== undefined && i + 1 > cap.lines) || (cap.bytes !== undefined && end > cap.bytes)) return i + 1;
  }
  return undefined;
}
const git = (args: string[]): void => { execFileSync('git', args, { stdio: 'ignore' }); };

// ---- AC1, AC2, AC6: a repo whose root and nested AGENTS.md total 40 KiB.
export const NESTED = 'packages/core/AGENTS.md';
export interface BudgetRepo {
  repo: string;
  /** The nested file's folder, where a Codex session reads both files. */
  core: string;
  rootText: string;
  coreText: string;
  /** Every rule of both files (a bullet every 32 lines, from line 1). */
  rules: Rule[];
  /** The nested file's first line past Codex's budget, after the root file spent its share. */
  firstLost: number | undefined;
}
/**
 * The issue's repo: a root AGENTS.md and packages/core/AGENTS.md of 320 lines of 64 bytes each (20 KiB apiece, 40 KiB
 * together, each under 32 KiB alone), a rule every 32 lines from line 1 and notes between. `tag` keeps one repo's rule
 * texts apart from another's on the same rules page. A git repo with nothing committed.
 */
export function budgetRepo(repo: string, tag: string): BudgetRepo {
  const file = (label: string): string => fixedLines(320, 64, (n) => ((n - 1) % 32 === 0
    ? `- ${label} rule ${pad3(n)} [${tag}]: keep the ${label.toLowerCase()} build reproducible`
    : `${label} notes, line ${pad3(n)} [${tag}]: why this file is laid out so`));
  const rootText = file('Root');
  const coreText = file('Core');
  const core = join(repo, 'packages', 'core');
  mkdirSync(join(core, 'src'), { recursive: true });
  writeFileSync(join(repo, 'AGENTS.md'), rootText);
  writeFileSync(join(core, 'AGENTS.md'), coreText);
  writeFileSync(join(core, 'src', 'index.ts'), 'export const core = 1;\n');
  git(['init', '-q', repo]);
  return { repo, core, rootText, coreText, rules: [...rulesOf('AGENTS.md', rootText), ...rulesOf(NESTED, coreText)], firstLost: firstLost(coreText, { bytes: CODEX_BUDGET }, bytesOf(rootText)) };
}
/** Codex's trust for the repo and its nested folder: `[projects."<path>"]` with `trust_level` in `<home>/.codex/config.toml`. */
export function trustInCodex(home: string, repo: string, level: 'trusted' | 'untrusted'): void {
  const file = join(home, '.codex', 'config.toml');
  mkdirSync(dirname(file), { recursive: true });
  const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const tables = [repo, join(repo, 'packages', 'core')].map((p) => `[projects.${JSON.stringify(p)}]\ntrust_level = "${level}"\n`).join('\n');
  appendFileSync(file, `${before && !before.endsWith('\n') ? '\n' : ''}${before ? '\n' : ''}${tables}`);
}

// ---- AC4, AC7: Claude Code's memory index for a repo.
/** Claude Code's memory folder for a repo: `~/.claude/projects/<the repo's path, each non-alphanumeric as ->/memory`. */
export const memoryFolder = (home: string, repo: string): string => join(home, '.claude', 'projects', repo.replace(/[^A-Za-z0-9]/g, '-'), 'memory');
/** AC4's index: 307 lines of 48 bytes, each a bullet. */
export const index307 = (tag: string): string => fixedLines(307, 48, (n) => `- Memory note ${pad3(n)} [${tag}]: keep notes short`);
/** AC7's index: 150 lines of 300 bytes, newlines included, each a bullet. */
export const index150 = (tag: string): string => fixedLines(150, 300, (n) => `- Index entry ${pad3(n)} [${tag}]: read the deploy notes before a release`);
export interface IndexRepo { repo: string; index: string; text: string; rules: Rule[]; firstLost: number | undefined }
/** A git repo and its memory index, MEMORY.md in the repo's memory folder under `home`. */
export function indexRepo(repo: string, home: string, text: string): IndexRepo {
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'README.md'), '# notes\n');
  git(['init', '-q', repo]);
  const index = join(memoryFolder(home, repo), 'MEMORY.md');
  mkdirSync(dirname(index), { recursive: true });
  writeFileSync(index, text);
  return { repo, index, text, rules: rulesOf(index, text), firstLost: firstLost(text, { lines: INDEX_LINES, bytes: INDEX_BYTES }) };
}

// ---- The fixture facts: every shipped adapters/*.facts.json, copied, with only the limit a criterion fixes changed.
const RULE_LOAD = /^rule[-_]?loads?$/i;
const MEMORY_INDEX = /^memory[-_]?index$/i;
const BYTE_CAP = /^(cap|max|budget|limit)[-_]?bytes$/i;
const LINE_CAP = /^(cap|max|limit)[-_]?lines$/i;
const isObject = (v: unknown): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** The path to an agent's rule-load entry: the first key named like `ruleLoad`, depth first. */
export function entryPath(value: Json, at: string[] = []): string[] | undefined {
  if (!isObject(value)) return undefined;
  for (const key of Object.keys(value)) if (RULE_LOAD.test(key)) return [...at, key];
  for (const [key, child] of Object.entries(value)) {
    const found = entryPath(child, [...at, key]);
    if (found) return found;
  }
  return undefined;
}
/** Sets every number at a key matching `key` under `value`, outside keys matching `skip`; how many it set. */
function setAll(value: Json, key: RegExp, to: number, skip?: RegExp): number {
  let n = 0;
  if (Array.isArray(value)) for (const v of value) n += setAll(v, key, to, skip);
  else if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (skip?.test(k)) continue;
      if (key.test(k) && typeof v === 'number') { value[k] = to; n++; } else n += setAll(v, key, to, skip);
    }
  }
  return n;
}
/** Every value at a key matching `key` under `value`. */
function under(value: Json, key: RegExp): Json[] {
  if (Array.isArray(value)) return value.flatMap((v) => under(v, key));
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([k, v]) => (key.test(k) ? [v] : under(v, key)));
}
export interface FactsChange {
  /** Codex's byte budget: every byte cap of its rule-load entry outside a memory index. */
  codexBudget?: number;
  /** Claude Code's memory index limits: every line cap and byte cap under its rule-load entry's memory index. */
  memoryIndex?: { lines: number; bytes: number };
}
/** Writes the fixture facts into `dir`; returns what the shipped facts lacked, so the change couldn't be made. */
export function fixtureFacts(dir: string, change: FactsChange): string[] {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(join(REPO, 'adapters')).filter((n) => n.endsWith('.facts.json'))) copyFileSync(join(REPO, 'adapters', f), join(dir, f));
  const missing: string[] = [];
  const edit = (file: string, apply: (entry: Json) => string[]): void => {
    const facts = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Json;
    const path = entryPath(facts);
    if (!path) { missing.push(`adapters/${file} has no rule-load entry (ruleLoad)`); return; }
    missing.push(...apply(path.reduce((v: Json, k) => v[k], facts)));
    writeFileSync(join(dir, file), `${JSON.stringify(facts, null, 2)}\n`);
  };
  const { codexBudget, memoryIndex } = change;
  if (codexBudget !== undefined) {
    edit('codex.facts.json', (entry) => (setAll(entry, BYTE_CAP, codexBudget, MEMORY_INDEX) ? [] : ['the rule-load entry of adapters/codex.facts.json holds no byte cap (capBytes)']));
  }
  if (memoryIndex) {
    edit('claude-code.facts.json', (entry) => {
      const indexes = under(entry, MEMORY_INDEX);
      const lines = indexes.reduce((n: number, i) => n + setAll(i, LINE_CAP, memoryIndex.lines), 0);
      const bytes = indexes.reduce((n: number, i) => n + setAll(i, BYTE_CAP, memoryIndex.bytes), 0);
      return [
        ...(lines ? [] : ['the rule-load entry of adapters/claude-code.facts.json holds no memory index line cap (memoryIndex.capLines)']),
        ...(bytes ? [] : ['the rule-load entry of adapters/claude-code.facts.json holds no memory index byte cap (memoryIndex.capBytes)']),
      ];
    });
  }
  return missing;
}

// ---- The rules page, `<root>/wiki/rules.md`: #344's claim lines, `- <text> <!-- deep:claim {...} -->`.
export interface PageLine { text: string; line: number; json: Json }
const CLAIM = /^- (.*?) <!-- deep:claim (\{.*\}) -->$/;
export function readPage(root: string): PageLine[] {
  const file = join(root, 'wiki', 'rules.md');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap((l, i) => {
    const m = CLAIM.exec(l);
    if (!m) return [];
    try { return [{ text: m[1]!, line: i + 1, json: JSON.parse(m[2]!) as Json }]; } catch { return []; }
  });
}
/** The page's line for a rule, by its text. */
export const onPage = (page: readonly PageLine[], text: string): PageLine | undefined => page.find((p) => p.text === text);

// ---- The marks on a rule's line (README: chosen): `not_loaded`, a list of {agent, cause}; `loaded`, a list of {agent, session}.
const listAt = (json: Json, key: RegExp): Record<string, Json>[] =>
  Object.entries(isObject(json) ? json : {}).filter(([k]) => key.test(k)).flatMap(([, v]) => (Array.isArray(v) ? v : [v])).filter(isObject);
const said = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v ?? ''));
/** The `not_loaded` marks on a line that name the agent. */
export const marksFor = (p: { json: Json }, agent: RegExp): Record<string, Json>[] => listAt(p.json, /^not[-_]?loaded$/i).filter((m) => agent.test(said(m.agent)));
/** Whether the line is marked as not reaching the agent, for the cause. */
export const markedAs = (p: { json: Json }, agent: RegExp, cause: RegExp): boolean => marksFor(p, agent).some((m) => cause.test(said(m.cause)));
/** Whether the line says a recorded load in the session shows the agent loaded it. */
export const loadedIn = (p: { json: Json }, agent: RegExp, session: string): boolean =>
  listAt(p.json, /^loaded$/i).some((l) => agent.test(said(l.agent)) && said(l.session).includes(session));
/** A line as a failure message shows it: its text and its claim JSON but the quote it cites. */
export const shownLine = (p: PageLine | { text: string; json: Json } | undefined): string => {
  if (!p) return 'not on the page';
  const { sources: _sources, ...rest } = isObject(p.json) ? p.json : {};
  return `"${p.text.slice(0, 80)}" ${JSON.stringify(rest).slice(0, 700)}`;
};
export const pageShown = (page: readonly PageLine[]): string => `${page.length} claim lines on the page, the first: ${page.slice(0, 3).map(shownLine).join(' | ') || 'none'}`;

// ---- The doctor's rules.not_loaded items.
/** `rules.not_loaded` as the item, or as the code (README: chosen readings). */
export const isNotLoaded = (i: DoctorItem): boolean => i.item === 'rules.not_loaded' || /^(rules[._])?not_loaded$/.test(i.code ?? '');
export const itemWords = (i: DoctorItem): string => `${i.evidence ?? ''} ${i.fix ?? ''}`;
/** The not-OK rules.not_loaded items that name the agent, in their `agent` or their words. */
export const lostFor = (d: Doctored, agent: RegExp): DoctorItem[] =>
  d.items.filter(isNotLoaded).filter((i) => i.level !== 'ok').filter((i) => agent.test(i.agent ?? '') || agent.test(itemWords(i)));
/** Words that name line `n`: `line <n>`, `lines <n>…` or `<file>:<n>`. */
export const namesLine = (text: string, n: number): boolean => new RegExp(`(?:\\blines?\\s+|:)${n}(?![0-9])`, 'i').test(text);
/** Words that name a number of bytes, with or without thousands commas. */
export const namesBytes = (text: string, n: number): boolean => new RegExp(`(?<![0-9,])(?:${n}|${n.toLocaleString('en-US')})(?![0-9])`).test(text);
export const itemsShownShort = (items: readonly DoctorItem[]): string => items.map((i) => JSON.stringify(i).slice(0, 600)).join('\n') || 'none';

/**
 * A memory index's doctor item (AC4, AC7): a not-OK rules.not_loaded item for Claude Code naming MEMORY.md and the first
 * line lost, and with `bytes` the byte limit too. Throws the criterion's message at the first thing missing.
 */
export function judgeIndexDoctor(tag: string, d: Doctored, r: IndexRepo, bytes?: number): void {
  const where = `deep doctor run in ${r.repo}`;
  const index = lostFor(d, CLAUDE).filter((i) => itemWords(i).includes('MEMORY.md'));
  if (!index.length) expect.fail(`${tag.split(' ')[0]} ${where} must report rules.not_loaded for Claude Code naming its memory index ${r.index}; its rules items: ${itemsShownShort(d.items.filter(isNotLoaded))}; all items: ${d.items.map((i) => `${i.item}:${i.level}`).join(', ')}`);
  const at = index.filter((i) => namesLine(itemWords(i), r.firstLost!));
  if (!at.length) expect.fail(`${tag.split(' ')[0]} ${where} must name line ${String(r.firstLost)} of ${r.index} as the first line lost: ${itemsShownShort(index)}`);
  if (bytes !== undefined && !at.some((i) => namesBytes(itemWords(i), bytes))) expect.fail(`${tag.split(' ')[0]} ${where} must name the byte limit, ${bytes} bytes, that loses line ${String(r.firstLost)}: ${itemsShownShort(at)}`);
}
/**
 * A memory index on the rules page (AC4, AC7): each line from the first line lost on listed and marked as not reaching
 * Claude Code, past the index limit; no line before it marked as not reaching Claude Code.
 */
export function judgeIndexPage(tag: string, page: readonly PageLine[], r: IndexRepo): void {
  const ac = tag.split(' ')[0];
  for (const rule of r.rules) {
    const p = onPage(page, rule.text);
    if (rule.line >= r.firstLost!) {
      if (!p) expect.fail(`${ac} the rules page must list line ${rule.line} of the memory index ${r.index} ("${rule.text.slice(0, 60)}") to mark it; ${pageShown(page)}`);
      if (!markedAs(p, CLAUDE, PAST_INDEX)) expect.fail(`${ac} line ${rule.line} of the memory index must be marked as not reaching Claude Code, past the index limit: ${shownLine(p)}`);
    } else if (p && marksFor(p, CLAUDE).length) {
      expect.fail(`${ac} line ${rule.line} of the memory index, inside its limits, must not be marked as not reaching Claude Code: ${shownLine(p)}`);
    }
  }
}

// ---- A native load event in a session's record (README: chosen): `session.loaded`, written while no hub runs.
/**
 * Appends, through the record's public entry, a Codex session in `worktree` (`session.start`) and the native load
 * event its record holds: `session.loaded` v1, subject `session:<id>`, data `{files: [{path}]}`, each file one the agent
 * reports it loaded, whole. Written as the hook writer (an adapter maps its agent's own report), or as the core where
 * the record takes it only from the core. Resolves with the record's refusal, or undefined when it holds the event.
 */
export async function recordNativeLoad(root: string, o: { session: string; worktree: string; files: string[] }): Promise<string | undefined> {
  const record = await openRecord({ path: join(root, 'ledger.db'), now: () => Date.now() });
  try {
    const ts = Date.now();
    const hook: Connection = { writer: 'hook', actor: 'you', scope: 'you', session: o.session, agent: 'codex' };
    await record.append(hook, { v: 1, id: ulid(ts), kind: 'session.start', ts, data: { agent: 'codex', worktree: o.worktree, branch: 'main', thread: o.session } });
    const event = (id: string) => ({ v: 1, id, kind: 'session.loaded', ts: ts + 1, subject: `session:${o.session}`, data: { files: o.files.map((path) => ({ path })) } });
    try {
      await record.append(hook, event(ulid(ts + 1)));
      return undefined;
    } catch (asHook) {
      try {
        await record.append({ ...hook, writer: 'core' }, event(ulid(ts + 2)));
        return undefined;
      } catch (asCore) {
        return `as the hook: ${asHook instanceof Error ? asHook.message : String(asHook)}; as the core: ${asCore instanceof Error ? asCore.message : String(asCore)}`;
      }
    }
  } finally {
    await record.close();
  }
}
