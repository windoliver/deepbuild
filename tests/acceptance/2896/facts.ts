// AC1's readers of the facts files (README: The facts entry). The issue names no key, so an agent's limits are found by what
// they hold, not by a name: an object of the facts that applies to a version (a `versions` list holding it, or the value under a
// key that is the version) and holds that agent's result figures. Its error limit is a key named like `error` under it, what it
// does past them is a word for a file or a cut, and each figure's source is a string under a key named like `source` on the
// figure's own object or one above it inside the entry, naming the client's own page or its own catalog command.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO, type Agent, type Line } from './helpers.ts';

const isObj = (v: unknown): v is Line => typeof v === 'object' && v !== null && !Array.isArray(v);
type Path = (string | number)[];
const at = (root: unknown, path: Path): unknown => path.reduce((v: any, k) => (v == null ? undefined : v[k]), root);
const show = (path: Path): string => path.map((k) => (typeof k === 'number' ? `[${k}]` : `.${k}`)).join('').replace(/^\./, '');

/** Every number under `v`, with its path from `v`. */
function numbers(v: unknown, path: Path = []): { n: number; path: Path }[] {
  if (typeof v === 'number') return [{ n: v, path }];
  if (Array.isArray(v)) return v.flatMap((x, i) => numbers(x, [...path, i]));
  if (isObj(v)) return Object.entries(v).flatMap(([k, x]) => numbers(x, [...path, k]));
  return [];
}
/** Every string under `v`. */
function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (isObj(v)) return Object.values(v).flatMap(strings);
  return [];
}
/** Every object of `facts` that applies to `version`, with its path: one whose `versions` list holds it, or the value under a key that is the version. */
function applying(facts: unknown, version: string, path: Path = [], out: { entry: Line; path: Path }[] = []): { entry: Line; path: Path }[] {
  if (Array.isArray(facts)) facts.forEach((x, i) => applying(x, version, [...path, i], out));
  else if (isObj(facts)) {
    if (Array.isArray(facts.versions) && facts.versions.includes(version) && path.length > 0) out.push({ entry: facts, path });
    for (const [k, x] of Object.entries(facts)) {
      if (k === version && isObj(x)) out.push({ entry: x, path: [...path, k] });
      applying(x, version, [...path, k], out);
    }
  }
  return out;
}

/** What each agent's limit entry must hold (the issue's figures). */
export const LIMITS: Record<Agent, { name: string; result: number[]; tokensWord: boolean; past: RegExp; source: RegExp; sourceSays: string }> = {
  // Claude Code's MCP page: a text result over 50,000 characters or 25,000 tokens goes to a file; an error is cut.
  'claude-code': { name: 'Claude Code', result: [50_000, 25_000], tokensWord: false, past: /file/i, source: /mcp/i, sourceSays: 'its MCP page' },
  // `codex debug models`: truncation_policy {mode: tokens, limit: 10000}, cut in the middle with a marker.
  codex: { name: 'Codex', result: [10_000], tokensWord: true, past: /cut|truncat|middle/i, source: /codex debug models/i, sourceSays: '`codex debug models`' },
};

/** The limit entry for `version`: the deepest object applying to it that holds the agent's result figures, or undefined. */
export function limitEntry(facts: Line, agent: Agent, version: string): { entry: Line; path: Path } | undefined {
  const want = LIMITS[agent];
  const holds = (e: Line): boolean => {
    const ns = new Set(numbers(e).map((x) => x.n));
    return want.result.every((n) => ns.has(n)) && (!want.tokensWord || strings(e).some((s) => /^tokens$/i.test(s)) || Object.keys(flatKeys(e)).some((k) => /token/i.test(k)));
  };
  const found = applying(facts, version).filter((x) => holds(x.entry));
  return found.sort((a, b) => b.path.length - a.path.length)[0];
}
function flatKeys(v: unknown, out: Record<string, true> = {}): Record<string, true> {
  if (Array.isArray(v)) v.forEach((x) => flatKeys(x, out));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) { out[k] = true; flatKeys(x, out); }
  return out;
}
/** A source string on `obj` itself: a string under a key named like source (never readBy, which names the rule that reads it). */
const sourceOn = (obj: unknown): string[] => (isObj(obj) ? Object.entries(obj).filter(([k]) => /source|readfrom|readat|from/i.test(k) && !/readby/i.test(k)).flatMap(([, v]) => strings(v)) : []);

/** Why `version`'s limits fall short in an agent's facts (AC1), each naming the version; empty when they're all there. */
export function limitProblems(facts: Line, agent: Agent, file: string): string[] {
  const want = LIMITS[agent];
  const versions = Array.isArray(facts.versions) ? (facts.versions as string[]) : [];
  if (!versions.length) return [`${file} lists no versions`];
  const problems: string[] = [];
  for (const version of versions) {
    const found = limitEntry(facts, agent, version);
    if (!found) { problems.push(`${file} holds no result limit for ${want.name} ${version}: no entry applying to ${version} holds ${want.result.map((n) => n.toLocaleString('en-US')).join(' and ')}${want.tokensWord ? ' in tokens' : ''}`); continue; }
    const { entry, path } = found;
    const where = `${file} ${show(path)} (${want.name} ${version})`;
    // The error limit: a key named like error under the entry, holding a number.
    const errorKeys = Object.keys(flatKeys(entry)).filter((k) => /error/i.test(k));
    const errorFigures = numbers(entry).filter((x) => x.path.some((k) => typeof k === 'string' && /error/i.test(k)));
    if (!errorKeys.length || !errorFigures.length) problems.push(`${where} holds no error limit: no key named like error with a figure under it`);
    // What it does past them: a file or a cut.
    if (!strings(entry).some((s) => want.past.test(s))) problems.push(`${where} doesn't say what ${want.name} does past its result limit (${want.past})`);
    // Each figure's source: on the figure's own object or one above it inside the entry, naming the client's own page or command.
    const figures = numbers(entry).filter((x) => want.result.includes(x.n) || x.path.some((k) => typeof k === 'string' && /error/i.test(k)));
    for (const f of figures) {
      const sources: string[] = [];
      for (let i = f.path.length - 1; i >= 0; i--) sources.push(...sourceOn(at(entry, f.path.slice(0, i))));
      if (!sources.some((s) => want.source.test(s))) problems.push(`${where}: the figure ${f.n} at ${show(f.path)} names no source that is ${want.sourceSays}`);
    }
  }
  return problems;
}

/** The agent's facts with `version`'s limit taken out: dropped from each limit entry's versions list, or its key under the entry deleted. */
export function withoutLimit(facts: Line, agent: Agent, version: string): { facts: Line; removed: boolean } {
  const copy = JSON.parse(JSON.stringify(facts)) as Line;
  let removed = false;
  for (let found = limitEntry(copy, agent, version); found; found = limitEntry(copy, agent, version)) {
    const parentPath = found.path.slice(0, -1);
    const last = found.path.at(-1)!;
    if (last === version) delete (at(copy, parentPath) as Line)[version];
    else found.entry.versions = (found.entry.versions as string[]).filter((v) => v !== version);
    removed = true;
  }
  return { facts: copy, removed };
}

/** A folder of the shipped facts files, one replaced by `facts`. */
export function factsFolder(made: string[], file?: string, facts?: Line): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dh2896f-')));
  made.push(dir);
  for (const f of readdirSync(join(REPO, 'adapters')).filter((n) => n.endsWith('.facts.json'))) copyFileSync(join(REPO, 'adapters', f), join(dir, f));
  if (file) writeFileSync(join(dir, file), `${JSON.stringify(facts, null, 2)}\n`);
  return dir;
}
/** The adapter-facts conformance cases as the preflight's corpus lane runs them (#1514's, #1296's): each FAIL line with its Fix line. */
export function check(dir: string): { code: number | null; fails: string[] } {
  const r = spawnSync(process.execPath, ['scripts/corpus.mjs', 'check', '--facts', dir], { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600_000 });
  const lines = `${r.stdout}\n${r.stderr}`.split('\n');
  const fails = lines.map((l, i) => (l.startsWith('FAIL') ? `${l} ${lines[i + 1]?.trim().startsWith('Fix:') ? lines[i + 1]!.trim() : ''}` : '')).filter(Boolean);
  // Each folder is its own temporary one: its name is the same folder to the comparison.
  return { code: r.status, fails: fails.map((l) => l.replace(/dh2896f-[A-Za-z0-9]+/g, 'dh2896f-<folder>')) };
}
