import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const MIN = 60_000;

export const ID = {
  base: '#3498.66862eb2',
  planted: '#3498.a9609187',
  print: '#3498.86739e65',
  table: '#3498.0760395f',
  shown: '#3498.826f8cd5',
} as const;

export const CHECK = 'scripts/row-sentence-lint.mjs';
export const SET = 'packages/hub/row-sentences.json';
export const RULES = 'packages/hub/src/status.ts';
export const WORDS = 'contracts/plain-words.json';
export const APP_TABLE = 'crates/deep-app/copy/en.json';
export const MERGE_BASE = '03b71e900700d1c6347731cb43cecd094a00097c';
export const SHOWN_ENV = 'DA3498_SHOWN';

export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
export const none = (failures: readonly string[], what: string): void => expect(failures.length, `${what}:\n${failures.join('\n')}\n`).toBe(0);
export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const made: string[] = [];
export function tempDir(): string {
  const dir = mkdtempSync(join('/tmp', 'da3498-'));
  made.push(dir);
  return dir;
}
export function cleanup(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
export function shownDir(): string {
  const kept = process.env[SHOWN_ENV];
  if (!kept) return tempDir();
  mkdirSync(kept, { recursive: true });
  return kept;
}

export function plainWords(root = REPO): Record<string, string> {
  const file = join(root, WORDS);
  if (!existsSync(file)) blocked(`${WORDS} is not there, so no word can be judged`);
  const list = (JSON.parse(readFileSync(file, 'utf8')) as { words?: Record<string, string> }).words;
  if (!list || !Object.keys(list).length) blocked(`${WORDS} holds no words object`);
  return list!;
}
const joins = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9]/.test(c);
export function holdsWord(text: string, word: string): boolean {
  const [low, w] = [text.toLowerCase(), word.toLowerCase()];
  for (let at = low.indexOf(w); at !== -1; at = low.indexOf(w, at + 1)) {
    const before = at === 0 ? undefined : low[at - 1];
    let rest = low.slice(at + w.length);
    if (rest.startsWith('es') && !joins(rest[2])) rest = rest.slice(2);
    else if (rest.startsWith('s') && !joins(rest[1])) rest = rest.slice(1);
    if (!joins(before) && !joins(rest[0])) return true;
  }
  return false;
}
export function listedIn(text: string, words: Record<string, string> = plainWords()): [string, string][] {
  return Object.entries(words).filter(([word]) => holdsWord(text, word)).sort((a, b) => b[0].length - a[0].length);
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }
export function run(command: string, args: readonly string[], o: { cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd: o.cwd ?? REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    // deadline: bounds the wait for the child's exit, and stops it by its PID
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, o.timeoutMs ?? 5 * MIN);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
}
export const shown = (r: Ran): string => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}, stdout ${JSON.stringify(r.stdout.slice(-3000))}, stderr ${JSON.stringify(r.stderr.slice(-1000))}`;

export function check(root?: string): Promise<Ran> {
  if (!existsSync(join(REPO, CHECK))) blocked(`${CHECK} is not there: the lint lane's check of the hub's row sentences (README, Pinned 1)`);
  return run(process.execPath, [join(REPO, CHECK), ...(root ? ['--root', root] : [])]);
}
export const fails = (r: Ran): string[] => r.stdout.split('\n').filter((line) => line.startsWith('FAIL'));
export const passes = (r: Ran): boolean => r.code === 0 && fails(r).length === 0;
export const placed = (line: string, file: string, at: number): boolean => new RegExp(`${escaped(file)}:${at}(?!\\d)`).test(line);
export const named = (line: string, name: string): boolean => new RegExp(`(?<![A-Za-z0-9_])${escaped(name)}(?![A-Za-z0-9_])`).test(line);

export async function lintLaneRuns(script: string): Promise<boolean> {
  const { checks } = (await import(pathToFileURL(join(REPO, 'scripts/lanes.mjs')).href)) as { checks: { name: string; commands: string[][] }[] };
  return checks.filter((lane) => lane.name === 'lint').some((lane) => lane.commands.some((c) => c[0] === process.execPath && c.length === 2 && c[1] === script));
}

const LEFT_OUT = /\/(node_modules|dist|target|\.git)(\/|$)/;
export function treeCopy(): string {
  const root = join(tempDir(), 'root');
  for (const part of ['contracts', 'crates/deep-app/copy']) cpSync(join(REPO, part), join(root, part), { recursive: true });
  for (const name of readdirSync(join(REPO, 'packages'))) {
    const from = join(REPO, 'packages', name);
    if (!statSync(from).isDirectory()) continue;
    mkdirSync(join(root, 'packages', name), { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (entry.isFile()) cpSync(join(from, entry.name), join(root, 'packages', name, entry.name));
      else if (entry.isDirectory() && entry.name === 'src') cpSync(join(from, 'src'), join(root, 'packages', name, 'src'), { recursive: true, filter: (src) => !LEFT_OUT.test(src) });
    }
  }
  return root;
}
export function mergeBaseTree(): string {
  try {
    execFileSync('git', ['cat-file', '-e', `${MERGE_BASE}^{commit}`], { cwd: REPO, stdio: 'ignore' });
  } catch {
    blocked(`this clone holds no commit ${MERGE_BASE}, the merge base whose files the check is run on`);
  }
  const root = join(tempDir(), 'merge-base');
  mkdirSync(root);
  const tar = execFileSync('git', ['archive', '--format=tar', MERGE_BASE, 'contracts', 'crates/deep-app/copy', 'packages'], { cwd: REPO, maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', root], { input: tar });
  return root;
}

export function templatesOf(root: string): Record<string, unknown> {
  const file = join(root, SET);
  if (!existsSync(file)) blocked(`${SET} is not there: the closed set of templates (README, Pinned 2)`);
  const set = (JSON.parse(readFileSync(file, 'utf8')) as { templates?: Record<string, unknown> }).templates;
  if (!set || typeof set !== 'object' || Array.isArray(set) || !Object.keys(set).length) blocked(`${SET} holds no templates object of names to texts (README, Pinned 2)`);
  return set!;
}
export function plantTemplate(root: string, name: string, text: string, entry: boolean): void {
  const file = join(root, SET);
  if (name in templatesOf(root)) blocked(`${SET} already holds a template named ${name}`);
  const set = JSON.parse(readFileSync(file, 'utf8')) as { templates: Record<string, unknown> };
  set.templates[name] = text;
  writeFileSync(file, `${JSON.stringify(set, null, 2)}\n`);
  if (!entry) return;
  const table = join(root, APP_TABLE);
  const source = JSON.parse(readFileSync(table, 'utf8')) as Record<string, unknown>;
  source[`hub.${name}`] = text;
  writeFileSync(table, `${JSON.stringify(Object.fromEntries(Object.entries(source).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), null, 2)}\n`);
}
export function plantLines(root: string, file: string, lines: readonly string[]): number {
  const path = join(root, file);
  if (!existsSync(path)) blocked(`${file} is not there to plant a line in`);
  const text = readFileSync(path, 'utf8');
  const body = text.endsWith('\n') ? text : `${text}\n`;
  writeFileSync(path, `${body}${lines.join('\n')}\n`);
  return body.split('\n').length;
}

export interface Sentence { reads: string; said: readonly string[]; source: string; listed: readonly string[] }
export const SEVEN: readonly Sentence[] = [
  { reads: 'BLOCKED', said: ['waits for you: its verdict names no evidence'], source: 'its verdict names no evidence', listed: ['verdict'] },
  { reads: 'flagged', said: ['its turn ended failed, with no claim'], source: 'its turn ended failed, with no claim', listed: ['claim'] },
  { reads: 'sent back', said: ['its checks sent its claim back, round 1 of 3'], source: 'its checks sent its claim back, round ', listed: ['claim'] },
  { reads: 'stale', said: ['its verdict is on a commit that has moved since'], source: 'its verdict is on a commit that has moved since', listed: ['verdict', 'commit'] },
  { reads: 'says done', said: ['it says done, and its checks have given no verdict yet'], source: 'it says done, and its checks have given no verdict yet', listed: ['verdict'] },
  { reads: 'PASS', said: ['its claim passed its checks'], source: 'its claim passed its checks', listed: ['claim'] },
  { reads: 'unpushed', said: ['2 commits on no remote branch', 'Push the branch, or say why it stays here.'], source: 'Push the branch, or say why it stays here.', listed: ['commit', 'branch'] },
];
export function sourceLine(root: string, file: string, text: string): number {
  const lines = readFileSync(join(root, file), 'utf8').split('\n');
  const at = lines.flatMap((line, i) => (line.includes(text) ? [i + 1] : []));
  if (at.length !== 1) blocked(`the merge base's ${file} holds ${JSON.stringify(text)} on ${at.length} lines, not one`);
  return at[0]!;
}
export function mergeBaseFailures(ran: Ran, lineOf: (s: Sentence) => number, words: Record<string, string>): string[] {
  const out: string[] = [];
  if (ran.code !== 1) out.push(`the check exits ${ran.code} on the merge base's files, not 1`);
  for (const s of SEVEN) {
    const at = lineOf(s);
    const lines = fails(ran).filter((line) => placed(line, RULES, at));
    if (!lines.length) {
      out.push(`no FAIL line names ${RULES}:${at}, where the merge base writes ${JSON.stringify(s.said.join(' '))}`);
      continue;
    }
    for (const word of s.listed) {
      const plain = words[word] ?? blocked(`${WORDS} lists no ${word}`);
      if (!lines.some((line) => holdsWord(line, word) && line.toLowerCase().includes(plain.toLowerCase()))) out.push(`no FAIL line naming ${RULES}:${at} (${JSON.stringify(s.said.join(' '))}) names its listed word ${JSON.stringify(word)} with the plain word ${JSON.stringify(plain)}: ${JSON.stringify(lines)}`);
    }
  }
  return out;
}

export interface Row { id: string; title: string; agent: string | null; word: string; why: string; waits_on: string | null; since: number | null; flag?: { code: string; text: string; fix?: string }; [key: string]: unknown }
export type Key = 'pass' | 'sentBack' | 'saysDone' | 'stale' | 'unpushed' | 'failed' | 'blocked';
export interface FixtureSession { key: Key; id: string; title: string; reads?: string; flag?: string; shownAs: string }
export const SESSIONS: Record<Key, FixtureSession> = {
  blocked: { key: 'blocked', id: '7c4d5e60-3498-4222-8333-444455550007', title: 'Order history', reads: 'BLOCKED', shownAs: 'BLOCKED' },
  failed: { key: 'failed', id: '7c4d5e60-3498-4222-8333-444455550006', title: 'Login form', reads: 'flagged', shownAs: 'flagged' },
  sentBack: { key: 'sentBack', id: '7c4d5e60-3498-4222-8333-444455550002', title: 'Checkout page', reads: 'sent back', shownAs: 'sent back' },
  stale: { key: 'stale', id: '7c4d5e60-3498-4222-8333-444455550004', title: 'Search box', reads: 'stale', shownAs: 'stale' },
  saysDone: { key: 'saysDone', id: '7c4d5e60-3498-4222-8333-444455550003', title: 'Release notes', reads: 'says done', shownAs: 'says done' },
  pass: { key: 'pass', id: '7c4d5e60-3498-4222-8333-444455550001', title: 'Cart totals', reads: 'PASS', shownAs: 'PASS' },
  unpushed: { key: 'unpushed', id: '7c4d5e60-3498-4222-8333-444455550005', title: 'Invoice schema', flag: 'unpushed', shownAs: 'unpushed' },
};
export const FIVE: readonly Key[] = ['pass', 'sentBack', 'saysDone', 'stale', 'unpushed'];
export const ALL_SEVEN: readonly Key[] = ['blocked', 'failed', 'sentBack', 'stale', 'saysDone', 'pass', 'unpushed'];

const T0 = Date.UTC(2026, 10, 2, 12, 0, 0);
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: number, length: number): string {
  let out = '';
  for (let n = value; out.length < length; n = Math.floor(n / 32)) out = CROCKFORD[n % 32] + out;
  return out;
}
type Data = Record<string, unknown>;
type Hub = {
  fixtures(name: string): unknown[];
  openRecord(o: { path: string; now: () => number }): Promise<{ append(who: Data, event: Data): Promise<unknown>; raw(sql: string): Promise<unknown[]>; close(): Promise<void> }>;
  sessionStates(query: (sql: string) => Promise<unknown[]>, now: number): Promise<unknown[]>;
  buildRows(query: (sql: string) => Promise<unknown[]>, readings: readonly unknown[], open: readonly string[]): Promise<Row[]>;
  orderOf(row: Row): string;
  listText(rows: readonly Row[], o: { now: number }): string;
};
async function part<T>(file: string, names: readonly string[]): Promise<T> {
  const path = join(REPO, file);
  if (!existsSync(path)) blocked(`${file} is not there`);
  let module: Record<string, unknown>;
  try {
    module = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  } catch (error) {
    return blocked(`${file} can't be loaded (${String((error as Error).message).split('\n')[0]}); build the workspaces first: npm run build --workspaces --if-present`);
  }
  for (const name of names) if (typeof module[name] !== 'function') blocked(`${file} exports no function ${name}`);
  return module as T;
}
async function hub(): Promise<Hub> {
  return {
    ...(await part<Pick<Hub, 'fixtures'>>('packages/contracts/src/index.ts', ['fixtures'])),
    ...(await part<Pick<Hub, 'openRecord'>>('packages/record/src/index.ts', ['openRecord'])),
    ...(await part<Pick<Hub, 'sessionStates'>>('packages/hub/src/status.ts', ['sessionStates'])),
    ...(await part<Pick<Hub, 'buildRows' | 'orderOf'>>('packages/hub/src/rows.ts', ['buildRows', 'orderOf'])),
    ...(await part<Pick<Hub, 'listText'>>('packages/hub/src/list.ts', ['listText'])),
  };
}

export interface Printed { rows: Row[]; now: number; print(rows?: readonly Row[]): string; rowOf(key: Key): Row }
export async function fixtureRecord(keys: readonly Key[]): Promise<Printed> {
  const h = await hub();
  const words = plainWords();
  for (const key of keys) if (listedIn(SESSIONS[key].title, words).length) blocked(`the fixture's title ${SESSIONS[key].title} holds a listed word`);
  const dir = tempDir();
  let at = T0;
  let count = 0;
  const ulid = (): string => `${base32(at, 10)}${base32(++count, 16)}`;
  const record = await h.openRecord({ path: join(dir, 'ledger.db'), now: () => at });
  const data = (name: string): Data => {
    const [first] = h.fixtures(name) as { data: Data }[];
    return structuredClone(first ?? blocked(`the contracts publish no fixture for ${name}`)).data;
  };
  const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
  const put = async (writer: 'hook' | 'core', session: string, kind: string, v: number, set: Data, subject?: string): Promise<string> => {
    at += 1000;
    const id = ulid();
    await record.append({ writer, actor: 'you', scope: 'you', session }, { v, id, kind, ts: at, ...(writer === 'hook' ? { seq: `${BigInt(at) * 1_000_000n}` } : {}), ...(subject ? { subject } : {}), data: set });
    return id;
  };
  try {
    for (const key of keys) {
      const s = SESSIONS[key];
      const subject = `session:${letters(s.id)}`;
      await put('hook', s.id, 'session.start', 1, data('session.start@1'));
      const task = `task:${ulid()}`;
      await put('core', s.id, 'task.created', 1, { ...data('task.created@1'), task_ref: task, thread: s.id, title: s.title });
      await put('hook', s.id, 'user.ask', 1, { msg: 1, text: `work on ${s.title.toLowerCase()}`, tasks: [], from: 'person' });
      const claimed = key !== 'unpushed' && key !== 'failed';
      if (key === 'failed') await put('hook', s.id, 'agent.stop', 5, { turn: 1, did_work: true, claim: false, cause: 'unknown', usage: null, outcome: 'failed' }, subject);
      else await put('hook', s.id, 'agent.stop', 1, data('agent.stop@1'), subject);
      if (key === 'unpushed') await put('core', s.id, 'commits.unpushed', 1, { ...data('commits.unpushed@1'), commits: 2, branch: null }, subject);
      if (!claimed) continue;
      const claim = await put('core', s.id, 'claim.made', 3, { ...data('claim.made@3'), task_ref: task });
      if (key === 'saysDone') continue;
      const outcome = key === 'sentBack' ? 'FAIL' : key === 'blocked' ? 'BLOCKED' : 'PASS';
      const handle = `verdict:${ulid()}`;
      const judged = { ...data('verdict.made@1'), claim: `claim:${claim}`, outcome, verdict: handle, ...(outcome === 'FAIL' ? {} : { reasons: [], requirements: [], smallest: null, points_to: null }) };
      await put('core', s.id, 'verdict.made', 1, judged);
      if (key === 'sentBack') await put('core', s.id, 'claim.sent_back', 1, { claim: `claim:${claim}`, verdict: handle, round: 1, to: subject }, `claim:${claim}`);
      if (key === 'stale') await put('core', s.id, 'verdict.stale', 1, { verdict: handle, because: 'commit moved' });
    }
    const now = at + 5 * MIN;
    const query = (sql: string): Promise<unknown[]> => record.raw(sql);
    const built = (await h.buildRows(query, await h.sessionStates(query, now), [])).filter((row) => row.id.startsWith('session:'));
    const rows = [...built].sort((a, b) => (h.orderOf(a) < h.orderOf(b) ? -1 : h.orderOf(a) > h.orderOf(b) ? 1 : 0));
    const rowOf = (key: Key): Row => rows.find((row) => row.id === `session:${SESSIONS[key].id}`) ?? blocked(`the hub built no row for the fixture's ${key} session`);
    for (const key of keys) {
      const [s, row] = [SESSIONS[key], rowOf(key)];
      if (s.reads && row.word !== s.reads) blocked(`the fixture's ${key} session reads ${row.word}, not ${s.reads}, so no sentence of its row is judged`);
      if (s.flag && row.flag?.code !== s.flag) blocked(`the fixture's ${key} session shows the flag ${row.flag?.code ?? 'none'}, not ${s.flag}, so no sentence of its row is judged`);
      if (row.title !== s.title) blocked(`the fixture's ${key} session is titled ${row.title}, not ${s.title}`);
    }
    return { rows, now, print: (other = rows) => h.listText(other, { now }), rowOf };
  } finally {
    await record.close();
  }
}

export interface Line { key: Key; id: string; title: string; word: string; line: string | undefined; said: string; own: string }
export function linesOf(print: string, rows: readonly Row[], keys: readonly Key[]): Line[] {
  return keys.map((key) => {
    const s = SESSIONS[key];
    const row = rows.find((r) => r.id === `session:${s.id}`) ?? blocked(`no row for the fixture's ${key} session`);
    const lead = `  ${row.title}  `;
    const line = print.split('\n').find((l) => l.startsWith(lead));
    const agent = `${row.agent ?? 'agent'}  `;
    const after = line === undefined ? '' : line.slice(lead.length);
    const said = (after.startsWith(agent) ? after.slice(agent.length) : after).replace(/, \d+ ?[A-Za-z]+$/, '');
    const parts = said.split(' · ');
    const at = parts.indexOf(row.word);
    return { key, id: row.id, title: row.title, word: row.word, line, said, own: at === -1 ? said : parts.slice(at + 1).join(' · ') };
  });
}
const who = (l: Pick<Line, 'id' | 'title' | 'word'>): string => `row ${l.id} (${l.title}), which reads ${l.word},`;
export function listedFailures(lines: readonly Line[], words: Record<string, string>): string[] {
  return lines.flatMap((l) => (l.line === undefined
    ? [`${who(l)} has no line in what deep prints`]
    : listedIn(l.said, words).map(([word, plain]) => `${who(l)} prints ${JSON.stringify(l.said)}, which holds the listed word ${JSON.stringify(word)} (its plain word: ${JSON.stringify(plain)})`)));
}
export const PARTIES = ['you', 'your', 'agent', 'it', 'its', 'check', 'checks', 'service'] as const;
export function namesSomebody(sentence: string, waitsOn: string | null): boolean {
  const words = [...PARTIES, ...(waitsOn && waitsOn.trim() ? [waitsOn.trim()] : [])];
  return words.some((word) => new RegExp(`(?<![A-Za-z0-9])${escaped(word)}(?![A-Za-z0-9])`, 'i').test(sentence));
}
export function waitsFailures(lines: readonly Line[], rows: readonly Row[]): string[] {
  return lines.filter((l) => l.word !== 'PASS').flatMap((l) => {
    const row = rows.find((r) => r.id === l.id)!;
    if (l.line === undefined) return [`${who(l)} has no line in what deep prints`];
    const out: string[] = [];
    if (typeof row.waits_on !== 'string' || !row.waits_on.trim()) out.push(`${who(l)} names nobody in its waits_on (${JSON.stringify(row.waits_on)})`);
    if (!namesSomebody(l.own, row.waits_on)) out.push(`${who(l)} prints ${JSON.stringify(l.own)} as its own sentence, which names nobody: none of ${PARTIES.join(', ')}, nor its waits_on`);
    return out;
  });
}
export const NOBODY = 'nothing has moved since';

export const shownText = (lines: readonly Line[]): string => `${lines.map((l) => `${SESSIONS[l.key].shownAs}  ${l.own}`).join('\n')}\n`;
export interface Taste { issue?: number; criterion?: string; verdict?: string | null; who?: string | null; when?: string | null; files?: Record<string, string>; note?: string }
const sorted = (files: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.entries(files).sort()));
export function tasteReading(taste: Taste, got: Record<string, string>): { inconclusive?: string; fails?: string } | null {
  if (taste.verdict === null || taste.verdict === undefined) return { inconclusive: 'no taste call is recorded for the seven sentences as deep prints them (TASTE.json holds none)' };
  if (!taste.who || !taste.when) return { inconclusive: 'the taste call names no one or no time' };
  if (sorted(taste.files ?? {}) !== sorted(got)) return { inconclusive: "the recorded taste call was made on another print than this run's" };
  if (taste.verdict !== 'reads_right') return { fails: `the recorded taste call says the sentences don't read right: ${taste.note ?? ''}` };
  return null;
}
