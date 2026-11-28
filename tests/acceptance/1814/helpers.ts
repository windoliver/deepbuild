import { spawnSync } from 'node:child_process';
import { constants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHECKOUT, CLI, NODE, SECOND, cleanup as cleanupWorlds, deep, needBuild, shown, world, type Ran } from '../1812/helpers.ts';

export { CHECKOUT, CLI, NODE, SECOND, deep, needBuild, shown, world, type Ran };

export const ID = {
  startHere: '#1814.45eb7060',
  confirmsOnce: '#1814.6dca6b93',
  undo: '#1814.93b182f5',
  guardEntries: '#1814.eb65b1b5',
  waiter: '#1814.df823cc0',
  count: '#1814.593c3f14',
  designRow: '#1814.e1bf7588',
} as const;

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const LINT = 'scripts/command-lint.mjs';
export const DESIGN = 'docs/technical-design.md';
export const PLANTED_WORD = 'sweep';

const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1814-'));
  made.push(dir);
  return dir;
}
export async function cleanup(): Promise<void> {
  await cleanupWorlds();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function help(cli?: string): Promise<Ran> {
  needBuild();
  return deep(world(), ['--help'], { ...(cli ? { cli } : {}), timeoutMs: 60 * SECOND });
}

export interface Group { title: string; lines: string[] }
const TITLE = /^([A-Z][^:]*):\s*$/;
const USAGE_LINE = /^\s+(?:\S{1,3}\s+)?(deep\s.*)$/;
export function groupsOf(text: string): Group[] {
  const out: Group[] = [];
  let current: Group | undefined;
  for (const line of text.split('\n')) {
    const title = TITLE.exec(line);
    if (title) {
      current = { title: title[1]!.trim(), lines: [] };
      out.push(current);
      continue;
    }
    if (!line.trim()) {
      current = undefined;
      continue;
    }
    const usage = USAGE_LINE.exec(line);
    if (current && usage) current.lines.push(usage[1]!.trim());
  }
  return out.filter((group) => group.lines.length > 0);
}

export const topWords = (line: string): string[] =>
  (/^deep\s+([a-z][a-z0-9-]*(?:\s*\\?\|\s*[a-z][a-z0-9-]*)*)/.exec(line)?.[1] ?? '').split(/\\?\|/).map((word) => word.trim()).filter(Boolean);

const BARE = String.raw`(?=\s+[[<-]|\s{2,}|\s*$)`;
const START: readonly (readonly [string, RegExp])[] = [
  ['deep status', new RegExp(`^deep status${BARE}`)],
  ['deep inbox', new RegExp(`^deep inbox${BARE}`)],
  ['deep doctor', new RegExp(`^deep doctor${BARE}`)],
  ['deep off | on', /^deep off\s*\|\s*on(?=\s|$)/],
  ['deep setup --undo', /^deep setup(?!\s+[a-z]).*--undo\b/],
];
export function startHereFailures(text: string): string[] {
  const [first] = groupsOf(text);
  if (!first) return ['deep --help lists no group of usage lines'];
  const out: string[] = [];
  if (first.title !== 'Start here') out.push(`the first group is titled "${first.title}", not "Start here"`);
  if (first.lines.length !== START.length) out.push(`the first group lists ${first.lines.length} lines, not ${START.length}`);
  const taken = new Set<string>();
  for (const line of first.lines) {
    const hit = START.find(([name, pattern]) => !taken.has(name) && pattern.test(line));
    if (hit) taken.add(hit[0]);
    else out.push(`the first group lists a line that is none of the five: ${line}`);
  }
  for (const [name] of START) if (!taken.has(name)) out.push(`the first group lists no line for ${name}`);
  return out;
}

export function helpWords(text: string, groups: number): string[] {
  return [...new Set(groupsOf(text).slice(0, groups).flatMap((group) => group.lines.flatMap(topWords)))].sort();
}

export function designRow(root: string): { line: number; words: string[] } {
  const lines = readFileSync(join(root, DESIGN), 'utf8').split('\n');
  const at = lines.findIndex((line) => /^\|\s*CLI\s*\|/.test(line));
  if (at < 0) return { line: 0, words: [] };
  const cell = lines[at]!.split(/(?<!\\)\|/)[2] ?? '';
  const words = cell.replace(/`/g, '').split(/·|,/).flatMap((item) => {
    const first = item.trim().replace(/^deep\s+/, '').split(/\s+/)[0] ?? '';
    return first.split(/\\?\|/).map((word) => word.trim()).filter((word) => /^[a-z][a-z0-9-]*$/.test(word));
  });
  return { line: at + 1, words: [...new Set(words)].sort() };
}

export function plantInDesignRow(root: string, word: string): void {
  const file = join(root, DESIGN);
  const lines = readFileSync(file, 'utf8').split('\n');
  const at = lines.findIndex((line) => /^\|\s*CLI\s*\|/.test(line));
  if (at < 0) throw Error(`BLOCKED: ${DESIGN} holds no command row (a table row starting "| CLI |") to plant ${word} in`);
  const cells = lines[at]!.split(/(?<!\\)\|/);
  const cell = cells[2] ?? '';
  const end = cell.trimEnd();
  const planted = end.endsWith('`') ? `${end.slice(0, -1)} · ${word}\`` : `${end} · ${word}`;
  cells[2] = `${planted}${cell.slice(end.length)}`;
  lines[at] = cells.join('|');
  writeFileSync(file, lines.join('\n'));
}

export interface Linted { status: number | null; output: string; fails: string[] }
export function lint(root: string = CHECKOUT): Linted {
  const script = join(root, LINT);
  if (!existsSync(script)) return { status: null, output: `${script} is missing`, fails: [] };
  const r = spawnSync(NODE, [script, '--root', root], { cwd: root, encoding: 'utf8', timeout: 600 * SECOND, maxBuffer: 64 * 1024 * 1024 });
  const output = `exit ${r.status}${r.error ? ` (${r.error.message})` : ''}, stdout ${JSON.stringify((r.stdout ?? '').slice(-4000))}, stderr ${JSON.stringify((r.stderr ?? '').slice(-2000))}`;
  const fails = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('FAIL'));
  return { status: r.status, output, fails };
}

export async function lintLaneRuns(script: string): Promise<boolean> {
  const { checks } = (await import(pathToFileURL(join(CHECKOUT, 'scripts/lanes.mjs')).href)) as { checks: { name: string; commands: unknown[][] }[] };
  const lane = checks.find(({ name }) => name === 'lint');
  return lane?.commands.some((command) => command.some((part) => String(part).replaceAll('\\', '/').endsWith(script))) ?? false;
}

const SKIP_TOP = new Set(['.git', 'node_modules', 'target', 'tests', 'crates', 'vendor', 'spikes', 'reports', 'benchmarks']);
const SKIP_DOCS = new Set(['evidence', 'images', 'spikes']);
export function scratchCheckout(): string {
  const dir = join(tempDir(), 'c');
  mkdirSync(dir);
  for (const name of readdirSync(CHECKOUT)) {
    if (SKIP_TOP.has(name)) continue;
    cpSync(join(CHECKOUT, name), join(dir, name), {
      recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
      filter: (source) => {
        const inside = source.slice(CHECKOUT.length).replaceAll('\\', '/');
        if (/\/(?:node_modules|target)(?:\/|$)/.test(inside)) return false;
        const docs = /^\/docs\/([^/]+)/.exec(inside);
        return !(docs && SKIP_DOCS.has(docs[1]!));
      },
    });
  }
  const link = (from: string, to: string) => {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) {
      const path = join(from, name);
      const s = lstatSync(path);
      if (s.isSymbolicLink() && !isAbsolute(readlinkSync(path))) symlinkSync(readlinkSync(path), join(to, name));
      else if (name.startsWith('@') && s.isDirectory()) link(path, join(to, name));
      else symlinkSync(path, join(to, name));
    }
  };
  link(join(CHECKOUT, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

export const USAGE_ANCHOR = "'deep backup <folder>";
export function plantUsageLine(root: string, word: string): string[] {
  const planted: string[] = [];
  const files = ['src', 'dist'].flatMap((part) => filesUnder(join(root, 'packages/cli', part))).filter((file) => /\.(?:ts|js|mjs)$/.test(file) && !file.endsWith('.d.ts'));
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    const at = lines.findIndex((line) => line.includes(USAGE_ANCHOR) && /',\s*$/.test(line));
    if (at < 0) continue;
    const indent = /^\s*/.exec(lines[at]!)![0];
    lines.splice(at + 1, 0, `${indent}'deep ${word}   tidies nothing, a top-level word planted by tests/acceptance/1814',`);
    writeFileSync(file, lines.join('\n'));
    planted.push(file.slice(root.length + 1));
  }
  return planted;
}

export const GUARD_FILE = 'packages/hub/src/guards.ts';
export function plantYourRules(root: string): void {
  const file = join(root, GUARD_FILE);
  if (!existsSync(file)) throw Error(`BLOCKED: ${GUARD_FILE}, the file that holds deep guard add, is missing from the copy`);
  const text = readFileSync(file, 'utf8').replace(/\n?$/, '\n');
  writeFileSync(file, `${text}export const dh1814Added = (names: readonly string[]): string => \`Added \${names.join(', ')} to your rules\`;\n`);
}

const RULES = /\brules?\b(?!\.[a-z])/i;
export function wordingFailures(command: string, r: Ran): string[] {
  const text = `${r.stdout}\n${r.stderr}`;
  const out: string[] = [];
  if (!/\bguard entr(?:y|ies)\b/i.test(text)) out.push(`${command} prints no "guard entries": ${shown(r)}`);
  for (const line of text.split('\n').filter((one) => RULES.test(one))) out.push(`${command} prints "rules" for them: ${JSON.stringify(line.trim())}`);
  return out;
}
