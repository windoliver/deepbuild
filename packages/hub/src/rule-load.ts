// Rule lines an agent never gets by its own loading (#1514; design: Your written rules, enforced). Each agent's facts
// hold a rule-load entry per version (`ruleLoad`): the files it reads in each folder it walks, which wins when two sit
// together, its byte cap and how it is spent across files, its memory index's limits, what stops a load and the setting
// that changes it. From that entry alone this reads, for a repo, the first line of each file an agent loses and why:
// over budget, shadowed by another file, past the index limit, or the project not trusted. Nothing here branches on an
// agent's name: a new agent fills its entry. A load the agent reports itself (session.loaded) outranks all of it.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { factsFiles, readFacts } from '@deepbuild/adapters/unchecked';
import { isRecord as isObj } from '@deepbuild/contracts';
import { tomlValue } from './codex-settings.js';

export type Cause = 'over_budget' | 'shadowed' | 'past_index_limit' | 'untrusted';
interface FileSet { name: string; files: string[]; pick: 'all' | 'first'; moreKey?: string }
interface Mode { sets: string[]; shadows?: Record<string, string>; user: boolean }
/** One version range's entry, as adapter.facts@7 types it. */
export interface LoadEntry {
  versions: string[];
  source: string;
  home: { dir: string; env?: string };
  walk: { from: 'root' | 'project'; markers?: string[]; markersKey?: string };
  sets: FileSet[];
  user: FileSet;
  setting: { name: string; file: string; keys: string[]; default: string } | null;
  modes: Record<string, Mode>;
  cap: { maxBytes: number; per: 'file' | 'project'; past: 'cut' | 'skipped'; key?: string; file?: string } | null;
  memoryIndex: { file: string; maxLines: number; maxBytes: number } | null;
  stops: { cause: 'untrusted'; file: string; key: string; value: string }[];
  loadEvent: { hook: string; file: string; reason?: string; silent?: string[] } | null;
}
/** An agent with a rule-load entry: its name as its facts file has it, the name you read, its newest version and that version's entry. */
export interface Loader { agent: string; name: string; version: string; entry: LoadEntry }
/** A file an agent loses lines of: its first line lost, why, and the words that say so. */
export interface Lost { agent: string; name: string; version: string; path: string; line: number; text: string; cause: Cause; why: string; fix: string; by?: string }
/** The planted wrong programs a doctor runs (#1514): each file against the whole budget, and the memory index by its lines alone. */
export interface Plants { perFile?: boolean; linesOnly?: boolean }

const NAMES: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };
const n = (v: number): string => v.toLocaleString('en-US');
const read = (file: string): string | undefined => { try { return readFileSync(file, 'utf8'); } catch { return undefined; } };
const isFile = (file: string): boolean => { try { return statSync(file).isFile(); } catch { return false; } };

/**
 * Every agent whose facts carry a rule-load entry, with the entry for the newest version they cover. DEEP_HUB_TEST_FACTS
 * names a folder whose facts files are read instead (tests only), as the hub's adapters read them.
 */
export function loaders(): Loader[] {
  const folder = process.env.DEEP_HUB_TEST_FACTS;
  const files: [string, unknown][] = folder
    ? readdirSync(folder).filter((f) => f.endsWith('.facts.json')).sort().map((f) => [f, JSON.parse(readFileSync(join(folder, f), 'utf8')) as unknown])
    : factsFiles().map((f) => [f, readFacts(f)]);
  return files.flatMap(([file, facts]) => {
    if (!isObj(facts) || !isObj(facts.ruleLoad) || !Array.isArray(facts.ruleLoad.entries)) return [];
    const entries = facts.ruleLoad.entries as LoadEntry[];
    const version = Array.isArray(facts.versions) ? String(facts.versions.at(-1)) : '';
    const entry = entries.find((e) => e.versions.includes(version)) ?? entries.at(-1);
    const agent = file.slice(0, -'.facts.json'.length);
    return entry ? [{ agent, name: NAMES[agent] ?? agent, version, entry }] : [];
  });
}

/** A path the entry writes under the agent's home (`~/.codex/…`), under the folder its variable names when that is set. */
function expand(path: string, entry: LoadEntry): string {
  const moved = entry.home.env ? process.env[entry.home.env] : undefined;
  if (moved && (path === entry.home.dir || path.startsWith(`${entry.home.dir}/`))) return join(moved, path.slice(entry.home.dir.length));
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}
/** A setting's value: a dotted path into a JSON file, or a key's parts into a TOML file. */
function settingIn(file: string, parts: readonly string[]): unknown {
  if (file.endsWith('.toml')) {
    const raw = tomlValue(file, parts);
    if (raw === undefined) return undefined;
    try { return JSON.parse(raw) as unknown; } catch { return raw; }
  }
  let at: unknown;
  try { at = JSON.parse(readFileSync(file, 'utf8')) as unknown; } catch { return undefined; }
  for (const part of parts) at = isObj(at) ? at[part] : undefined;
  return at;
}
/** The mode the setting picks, the setting's own default when no file sets one. */
function modeOf(entry: LoadEntry): { name: string; mode: Mode } {
  const set = entry.setting;
  const value = set ? set.keys.map((k) => settingIn(expand(set.file, entry), k.split('.'))).find((v) => typeof v === 'string') : undefined;
  const name = typeof value === 'string' && entry.modes[value] ? value : set?.default ?? 'default';
  return { name, mode: entry.modes[name] ?? { sets: entry.sets.map((s) => s.name), user: true } };
}
/** A cap's bytes, as its setting sets them where it does. */
function capBytes(entry: LoadEntry): number | undefined {
  const cap = entry.cap;
  if (!cap) return undefined;
  const set = cap.key && cap.file ? settingIn(expand(cap.file, entry), [cap.key]) : undefined;
  return typeof set === 'number' && Number.isSafeInteger(set) && set >= 0 ? set : cap.maxBytes;
}

/** The folders a session started in `folder` reads, in the order it loads them. */
function walkOf(entry: LoadEntry, folder: string): string[] {
  const up: string[] = [];
  for (let dir = folder; ; dir = dirname(dir)) {
    up.push(dir);
    if (dirname(dir) === dir) break;
  }
  if (entry.walk.from === 'root') return up.reverse();
  const set = entry.walk.markersKey && entry.cap?.file ? settingIn(expand(entry.cap.file, entry), [entry.walk.markersKey]) : undefined;
  const markers = Array.isArray(set) ? set.map(String) : entry.walk.markers ?? ['.git'];
  const root = up.findIndex((dir) => markers.some((m) => existsSync(join(dir, m))));
  return root < 0 ? [folder] : up.slice(0, root + 1).reverse();
}
/** A set's files in one folder, in the order its names list them; a name may end in `*.<ext>`. */
function filesIn(folder: string, names: readonly string[]): string[] {
  return names.flatMap((name) => {
    if (!name.includes('*')) return isFile(join(folder, name)) ? [join(folder, name)] : [];
    const dir = join(folder, dirname(name));
    const [head, tail] = basename(name).split('*') as [string, string];
    try { return readdirSync(dir).filter((f) => f.startsWith(head) && f.endsWith(tail)).sort().map((f) => join(dir, f)).filter(isFile); } catch { return []; }
  });
}
/** The names a set reads: its own, then the ones its setting adds. */
function namesOf(entry: LoadEntry, set: FileSet): string[] {
  const more = set.moreKey && entry.cap?.file ? settingIn(expand(entry.cap.file, entry), [set.moreKey]) : undefined;
  return [...set.files, ...(Array.isArray(more) ? more.map(String).filter((m) => m && !m.includes('/')) : [])];
}

interface Seen { path: string; set: string }
/** What a session started in `folder` loads of the walked folders' files, and each file a winner shadows, by its winner. */
function launch(entry: LoadEntry, mode: Mode, folder: string): { loaded: Seen[]; shadowed: Map<string, string> } {
  const loaded: Seen[] = [];
  const shadowed = new Map<string, string>();
  for (const dir of walkOf(entry, folder)) {
    for (const set of entry.sets.filter((s) => mode.sets.includes(s.name))) {
      const found = filesIn(dir, namesOf(entry, set));
      if (set.pick === 'first' && found.length) {
        loaded.push({ path: found[0]!, set: set.name });
        for (const other of found.slice(1)) shadowed.set(other, found[0]!);
      } else loaded.push(...found.map((path) => ({ path, set: set.name })));
    }
  }
  for (const [lower, over] of Object.entries(mode.shadows ?? {})) {
    const winner = loaded.find((s) => s.set === over);
    if (!winner) continue;
    for (const s of loaded.filter((x) => x.set === lower)) shadowed.set(s.path, winner.path);
  }
  return { loaded: loaded.filter((s) => !shadowed.has(s.path)), shadowed };
}

/** The first line (from 1) not loaded whole, newline included, under a line limit and a byte limit; undefined when all are. */
export function firstLost(text: string, cap: { lines?: number; bytes?: number }): { line: number; by: 'lines' | 'bytes' } | undefined {
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  let end = 0;
  for (let i = 0; i < lines.length; i++) {
    end += Buffer.byteLength(lines[i]!) + (i < lines.length - 1 || text.endsWith('\n') ? 1 : 0);
    if (cap.lines !== undefined && i + 1 > cap.lines) return { line: i + 1, by: 'lines' };
    if (cap.bytes !== undefined && end > cap.bytes) return { line: i + 1, by: 'bytes' };
  }
  return undefined;
}
const lineAt = (text: string, line: number): string => (text.split('\n')[line - 1] ?? '').trim().slice(0, 160);

/** The project's trust stop, read for its root and then the folder itself: the stop when its config file holds its value. */
function stopped(entry: LoadEntry, folder: string): LoadEntry['stops'][number] | undefined {
  const root = walkOf(entry, folder)[0] ?? folder;
  return entry.stops.find((s) => {
    const at = (dir: string) => settingIn(expand(s.file, entry), s.key.split('.').map((p) => (p === '<root>' ? dir : p)));
    const value = at(root) ?? at(folder);
    return value === s.value;
  });
}

/** Claude Code's memory folder name for a repo: its path, each character but a letter or digit made `-`. */
export const projectSlug = (repo: string): string => repo.replace(/[^A-Za-z0-9]/g, '-');
/** The memory index an entry names for a repo, when the agent has one. */
export const indexFile = (l: Loader, repo: string): string | undefined =>
  l.entry.memoryIndex ? expand(l.entry.memoryIndex.file.replace('<project>', projectSlug(repo)), l.entry) : undefined;

/**
 * Each file of `repo` (its folders `folders`, the repo's own first) and of your user level that an agent loses lines of,
 * by its entry: for every folder a session reading that file starts in, the files it loads there in order, which win,
 * what the budget leaves and what stops the load; then the memory index's limits.
 */
export function lostIn(repo: string, folders: readonly string[], plants: Plants = {}, of: readonly Loader[] = loaders()): Lost[] {
  const out: Lost[] = [];
  for (const l of of) {
    const { entry } = l;
    const { name: modeName, mode } = modeOf(entry);
    const bytes = capBytes(entry);
    const rel = (p: string): string => (p.startsWith(`${repo}/`) ? relative(repo, p) : p.replace(homedir(), '~'));
    const add = (path: string, line: number, text: string, cause: Cause, why: string, fix: string, by?: string): void => {
      if (!out.some((o) => o.agent === l.agent && o.path === path)) out.push({ agent: l.agent, name: l.name, version: l.version, path, line, text, cause, why, fix, ...(by ? { by } : {}) });
    };
    const said = `as ${l.name}'s facts for ${l.version} say`;
    for (const folder of [...new Set([repo, ...folders])]) {
      const { loaded, shadowed } = launch(entry, mode, folder);
      // Only the files read from this folder itself, or a dot folder in it: one above it is judged where a session starts beside it.
      const here = (p: string): boolean => { const r = relative(folder, p); return !r.startsWith('..') && (!r.includes('/') || r.startsWith('.')); };
      const stop = stopped(entry, folder);
      if (stop) {
        for (const s of [...loaded, ...[...shadowed.keys()].map((path) => ({ path, set: '' }))].filter((s) => here(s.path))) {
          const text = read(s.path) ?? '';
          add(s.path, 1, lineAt(text, 1), 'untrusted', `${l.name} loads no rule file in ${repo}: ${stop.file} sets ${stop.key.replace('<root>', JSON.stringify(walkOf(entry, folder)[0] ?? folder))} to "${stop.value}", so line 1 of ${rel(s.path)} and every line after it never reach ${l.name} (${said}).`, `Trust the project in ${l.name} (${stop.file}) if its rule files should load.`);
        }
        continue;
      }
      for (const [path, by] of shadowed) {
        if (!here(path)) continue;
        const text = read(path) ?? '';
        add(path, 1, lineAt(text, 1), 'shadowed', `${l.name} reads ${rel(by)} instead of ${rel(path)}${entry.setting ? ` (${entry.setting.name} is ${modeName})` : ''}, so line 1 of ${rel(path)} and every line after it never reach ${l.name} (${said}).`, `Move ${rel(path)}'s rules into ${rel(by)}${entry.setting ? `, or set ${entry.setting.name} in ${entry.setting.file} so both load` : ''}.`, rel(by));
      }
      let left = bytes;
      for (const s of loaded) {
        const text = read(s.path) ?? '';
        // A blank file holds no rule and costs nothing.
        if (!text.trim()) continue;
        const size = Buffer.byteLength(text);
        const cap = entry.cap;
        if (cap && left !== undefined && bytes !== undefined) {
          if (cap.per === 'file') {
            if (size > bytes && here(s.path)) add(s.path, 1, lineAt(text, 1), 'over_budget', `${rel(s.path)} is ${n(size)} bytes, over ${l.name}'s ${n(bytes)}-byte cap on one file, so ${l.name} skips it whole: line 1 and every line after it never reach it (${said}).`, `Split ${rel(s.path)} into files under ${n(bytes)} bytes.`);
          } else {
            const budget = plants.perFile ? bytes : left;
            const lost = budget <= 0 ? { line: 1 } : firstLost(text, { bytes: budget });
            if (lost && here(s.path)) {
              const before = loaded.slice(0, loaded.indexOf(s)).map((x) => rel(x.path));
              add(s.path, lost.line, lineAt(text, lost.line), 'over_budget', `${l.name} reads ${before.length ? `${before.join(', ')} and then ` : ''}${rel(s.path)} in a session started in ${folder === repo ? "the repo's root" : rel(folder)}, all under one ${n(bytes)}-byte budget${cap.key ? ` (${cap.key})` : ''}, and loads only the first ${n(Math.max(budget, 0))} bytes of ${rel(s.path)}, so line ${lost.line} and every line after it never reach ${l.name}: "${lineAt(text, lost.line)}" (${said}).`, `Trim the files ${l.name} reads there under ${n(bytes)} bytes together, or move rules into a deeper file${cap.key ? `, or raise ${cap.key} in ${cap.file ?? 'its config'}` : ''}.`);
            }
            left -= Math.min(size, Math.max(left, 0));
          }
        }
      }
    }
    // Your user-level files: the first one an agent reads wins over the rest when it picks one.
    if (mode.user) {
      const user = entry.user.files.flatMap((f) => filesIn(dirname(expand(f, entry)), [f.slice(f.lastIndexOf('/') + 1)]));
      if (entry.user.pick === 'first') for (const path of user.slice(1)) add(path, 1, lineAt(read(path) ?? '', 1), 'shadowed', `${l.name} reads ${rel(user[0]!)} instead of ${rel(path)}, so line 1 of ${rel(path)} and every line after it never reach ${l.name} (${said}).`, `Move ${rel(path)}'s rules into ${rel(user[0]!)}.`, rel(user[0]!));
    }
    // The memory index: its first lines and bytes, whichever limit comes first.
    const index = indexFile(l, repo);
    const limits = entry.memoryIndex;
    const text = index ? read(index) : undefined;
    if (index && limits && text !== undefined) {
      const lost = firstLost(text, { lines: limits.maxLines, ...(plants.linesOnly ? {} : { bytes: limits.maxBytes }) });
      if (lost) {
        const cut = lost.by === 'lines' ? `it has more than ${n(limits.maxLines)} lines` : `line ${lost.line} ends past ${n(limits.maxBytes)} bytes`;
        add(index, lost.line, lineAt(text, lost.line), 'past_index_limit', `${l.name} loads only the first ${n(limits.maxLines)} lines or ${n(limits.maxBytes)} bytes of its memory index ${rel(index)}, whichever comes first, and ${cut}, so line ${lost.line} and every line after it never reach ${l.name}: "${lineAt(text, lost.line)}" (${said}).`, `Shorten ${rel(index)} to under ${n(limits.maxLines)} lines and ${n(limits.maxBytes)} bytes: one line per entry, the detail in topic files.`);
      }
    }
  }
  return out;
}

/** The files a session of agent `agent` started in `cwd` loads at its start, by its entry: undefined for an agent with none. */
export function loadedAtStart(agent: string, cwd: string, of: readonly Loader[] = loaders()): string[] | undefined {
  const l = of.find((x) => x.agent === agent);
  if (!l) return undefined;
  const { mode } = modeOf(l.entry);
  if (stopped(l.entry, cwd)) return [];
  const user = mode.user ? l.entry.user.files.flatMap((f) => filesIn(dirname(expand(f, l.entry)), [f.slice(f.lastIndexOf('/') + 1)])) : [];
  return [...(l.entry.user.pick === 'first' ? user.slice(0, 1) : user), ...launch(l.entry, mode, cwd).loaded.map((s) => s.path)];
}

/** Each line's marks on the rules page: the agents that won't load it and why, or the sessions whose record shows it loaded. */
export interface Marks { not_loaded?: { agent: string; cause: Cause; by?: string }[]; loaded?: { agent: string; session: string }[] }
/**
 * A rule's marks, from the files' losses and the loads sessions recorded (agent, path → session): a line at or past
 * its file's first lost line is marked for that agent, unless a recorded load of that agent shows the file loaded.
 */
export function marksOf(path: string, line: number, lost: readonly Lost[], recorded: ReadonlyMap<string, string>): Marks {
  const marks: Marks = {};
  for (const l of lost.filter((x) => x.path === path && line >= x.line)) {
    const session = recorded.get(`${l.agent}\u0000${path}`);
    if (session) (marks.loaded ??= []).push({ agent: l.agent, session });
    else (marks.not_loaded ??= []).push({ agent: l.agent, cause: l.cause, ...(l.by ? { by: l.by } : {}) });
  }
  return marks;
}
/** The line of a file that holds a rule's bullet, from 1; 0 when no line does. */
export function lineOf(text: string, rule: string): number {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /^\s*[-*+]\s+/.test(l) && l.replace(/^\s*[-*+]\s+/, '').trim() === rule);
  return i + 1;
}
/** The agent a recorded session ran, as its facts file names it. */
export const agentOf = (recorded: string | null | undefined): string => (recorded === 'claude' ? 'claude-code' : String(recorded ?? ''));
/** The paths a session.loaded event's data names. */
export const pathsOf = (data: unknown): string[] => (isObj(data) && Array.isArray(data.files) ? data.files.flatMap((f) => (isObj(f) && typeof f.path === 'string' ? [f.path] : [])) : []);
