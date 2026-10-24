// Shared tools for the #684 acceptance tests: the proof lane and its generator run as processes, scratch copies
// of this checkout to plant wrong models and engines in, the textual anchors those plants edit (README: Anchors),
// and reading and comparing the generator's vectors. None of them stands in for the engine, the model or the lane.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ClaimInput, Result } from '../../../packages/verdicts/src/index.ts';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
/** The proof lane's script, run with node from the root of a checkout (or a scratch copy of one). */
export const LANE_SCRIPT = 'scripts/verdict-proofs.mjs';
/** The lane's name in scripts/lanes.mjs `checks`. */
export const LANE_NAME = 'verdict proofs';
/** The model's root: every .lean file under it, outside .lake/, is the model. */
export const MODEL = 'packages/verdicts/model';
/** The engine's source. */
export const ENGINE_SRC = 'packages/verdicts/src';
/** The gitignored folder the pinned toolchain is installed in. */
export const TOOLCHAIN_DIR = '.lean';
/** The five property theorems, by full name. */
export const PROPERTY_THEOREMS = [
  'Verdicts.verdict_closed', 'Verdicts.verdict_highest', 'Verdicts.verdict_never_pass', 'Verdicts.verdict_set_only', 'Verdicts.verdict_rises',
] as const;
/** The separate theorem: a late run whose reads withdraw a carry marks that check stale with no counted run. */
export const STALE_THEOREM = 'Verdicts.late_read_stale';
export const STANDARD_AXIOMS: readonly string[] = ['propext', 'Quot.sound', 'Classical.choice'];
/** The precedence line, lowest first: PASS < pending < INCONCLUSIVE < BLOCKED < INVALID < FAIL. */
export const PRECEDENCE: readonly Result[] = ['PASS', 'pending', 'INCONCLUSIVE', 'BLOCKED', 'INVALID', 'FAIL'];
export const rankOf = (r: Result): number => PRECEDENCE.indexOf(r);

// ---- Processes.

export interface Ran { status: number | null; stdout: string; stderr: string; lines: string[] }
/** Runs node with `args` in `cwd` and waits; a lane run may build the model, so the limit is generous. */
export function runNode(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Ran {
  const r = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', maxBuffer: 2 ** 29, timeout: 45 * 60_000 });
  const stdout = r.stdout ?? '';
  const stderr = `${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`;
  return { status: r.status, stdout, stderr, lines: stdout.split('\n').map((l) => l.trimEnd()) };
}
/** The end of a run's output, for an assertion's message. */
export function shown(r: Ran): string {
  const tail = (s: string, n: number): string => s.split('\n').slice(-n).join('\n').slice(-6000);
  return `exit ${r.status}\n--- stdout (end)\n${tail(r.stdout, 40)}\n--- stderr (end)\n${tail(r.stderr, 15)}`;
}
/** The lane's line saying the pinned toolchain isn't installed, if it printed one. */
export const toolchainBlocked = (r: Ran): string | null => r.lines.find((l) => l.startsWith('BLOCKED toolchain:')) ?? null;
/** Lines that report a state other than a pass. */
export const problemLines = (r: Ran): string[] => r.lines.filter((l) => /^(FAIL|INVALID|BLOCKED|INCONCLUSIVE)\b/.test(l));
export const failLines = (r: Ran): string[] => r.lines.filter((l) => l.startsWith('FAIL'));
/** The axioms an `AXIOMS <theorem>: …` line lists, [] for `none`; null when there's no such line. */
export function axiomsOf(r: Ran, theorem: string): string[] | null {
  const found = r.lines.filter((l) => l.startsWith(`AXIOMS ${theorem}: `));
  if (found.length !== 1) return null;
  const list = found[0]!.slice(`AXIOMS ${theorem}: `.length).trim();
  return list === 'none' ? [] : list.split(',').map((a) => a.trim()).filter(Boolean);
}
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether `line` names `name` as a whole Lean identifier. */
export const mentions = (line: string, name: string): boolean => new RegExp(`(?<![\\w.'])${escape(name)}(?![\\w'])`).test(line);

// ---- Scratch copies. Nothing is written into this checkout; each folder is removed by removeScratches().

const scratches: string[] = [];
export function scratchDir(label: string): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `deep-684-${label}-`));
  scratches.push(dir);
  return dir;
}
export function removeScratches(): void {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true });
}
/** The checkout's tracked files and the new ones git doesn't ignore (read-only git). */
function listedFiles(): string[] {
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 2 ** 28 });
  if (r.status !== 0) throw new Error(`git ls-files failed in the checkout: ${r.stderr}`);
  return r.stdout.split('\0').filter(Boolean);
}
/**
 * A scratch copy of the files the lane may read (README: Scratch copies): root-level files, scripts/,
 * packages/verdicts/ and this suite, with node_modules linked to the checkout's. With `toolchain`, the checkout's
 * toolchain folder is linked in and the model's .lake/ build is copied, so only what a plant changes rebuilds.
 * With `engine: false`, the engine's source is left out.
 */
export function scratchCopy(label: string, { toolchain, engine = true }: { toolchain: boolean; engine?: boolean }): string {
  const dir = scratchDir(label);
  for (const path of listedFiles()) {
    const kept = !path.includes('/') || path.startsWith('scripts/') || path.startsWith('packages/verdicts/') || path.startsWith('tests/acceptance/684/');
    if (!kept || /(^|\/)(\.vite|node_modules|\.lake)\//.test(path)) continue;
    if (!engine && path.startsWith(`${ENGINE_SRC}/`)) continue;
    const from = join(ROOT, path);
    try {
      if (!lstatSync(from).isFile()) continue;
    } catch {
      continue; // tracked, but deleted from the working tree
    }
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    cpSync(from, join(dir, path));
  }
  if (existsSync(join(ROOT, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  if (toolchain) {
    if (existsSync(join(ROOT, TOOLCHAIN_DIR))) symlinkSync(join(ROOT, TOOLCHAIN_DIR), join(dir, TOOLCHAIN_DIR));
    const lake = join(ROOT, MODEL, '.lake');
    if (existsSync(lake)) cpSync(lake, join(dir, MODEL, '.lake'), { recursive: true, verbatimSymlinks: true });
  }
  return dir;
}

// ---- The model's source, read as text.

function filesUnder(dir: string, ext: string, skip: RegExp): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skip.test(entry.name)) out.push(...filesUnder(path, ext, skip));
    } else if (entry.isFile() && entry.name.endsWith(ext)) out.push(path);
  }
  return out.sort();
}
export const leanFiles = (root: string): string[] => filesUnder(join(root, MODEL), '.lean', /^\.lake$/);

/** A line at column 0 that still belongs to the declaration above it (README: Anchors). */
const CONTINUES = /^(?:\||where\b|termination_by\b|decreasing_by\b|deriving\b)/;
/** The index of the first line after `from` that ends the declaration starting at `from`, or lines.length. */
function declarationEnd(lines: readonly string[], from: number): number {
  for (let i = from + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\S/.test(line) && !CONTINUES.test(line)) return i;
  }
  return lines.length;
}
const MODIFIERS = String.raw`(?:@\[[^\]\n]*\]\s*)?(?:(?:private|protected|noncomputable|partial|nonrec)\s+)*`;
export interface Anchor {
  /** The name as declared (`rank` inside `namespace Verdicts`, or `Verdicts.rank`): the planted declaration takes it. */
  declared: string;
  /** The original's full name after the plant renames it: `Verdicts.<name>_684orig`. */
  orig: string;
  /** `Verdicts.` when the anchor spells the namespace out, else empty: a new top-level name takes it too. */
  prefix: string;
}
/**
 * Plants a wrong model in the scratch copy `root`: the one column-0 declaration `<keyword> <name>` in the model is
 * renamed `<name>_684orig`, and `text(anchor)` is inserted right after that declaration ends, so every later use of
 * `<name>` reads the planted one. Throws, naming the anchor, unless the model declares it exactly once.
 */
export function plant(root: string, keyword: 'def' | 'theorem', name: string, text: (a: Anchor) => string): string {
  const kw = keyword === 'def' ? '(?:def|abbrev)' : 'theorem';
  const re = new RegExp(`^(${MODIFIERS}${kw}\\s+)((?:Verdicts\\.)?${escape(name)})(?=[\\s:({\\[]|$)`, 'gm');
  const hits = leanFiles(root).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(re)].map((m) => ({ file, m })));
  if (hits.length !== 1) {
    throw new Error(`${MODEL} must declare \`${keyword} ${name}\` exactly once, at column 0 (README: Anchors); found ${hits.length}`);
  }
  const { file, m } = hits[0]!;
  const source = readFileSync(file, 'utf8');
  const declared = m[2]!;
  const prefix = declared.startsWith('Verdicts.') ? 'Verdicts.' : '';
  const cut = m.index + m[1]!.length + declared.length;
  const lines = `${source.slice(0, cut)}_684orig${source.slice(cut)}`.split('\n');
  const at = source.slice(0, m.index).split('\n').length - 1;
  const end = declarationEnd(lines, at);
  const anchor: Anchor = { declared, orig: `Verdicts.${declared.slice(prefix.length)}_684orig`, prefix };
  lines.splice(end, 0, '', `-- Planted by tests/acceptance/684 (a wrong model; never kept).`, text(anchor), '');
  writeFileSync(file, lines.join('\n'));
  return file;
}
/** Every theorem (or lemma) the model at `root` declares, by the name it is declared with. */
export function declaredTheorems(root: string): string[] {
  const re = new RegExp(`^${MODIFIERS}(?:theorem|lemma)\\s+([^\\s:({\\[]+)`, 'gm');
  return leanFiles(root).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(re)].map((m) => m[1]!));
}
/** Whether a FAIL line names a theorem or lemma of the model at `root` (not one the plant renamed). */
export function namesTheorem(line: string, root: string): boolean {
  return declaredTheorems(root).filter((t) => !t.endsWith('_684orig'))
    .some((t) => mentions(line, t) || mentions(line, t.split('.').at(-1)!));
}
/** The constructors of the model's `inductive Row`, the rows of its rules table. */
export function modelRows(root: string): string[] {
  const rows: string[] = [];
  let found = 0;
  for (const file of leanFiles(root)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/^inductive\s+(?:Verdicts\.)?Row\b/.test(lines[i]!)) continue;
      found++;
      const end = declarationEnd(lines, i);
      for (let j = i; j < end; j++) {
        const line = lines[j]!.replace(/--.*$/, '');
        if (/^\s*deriving\b/.test(line)) continue;
        for (const c of line.matchAll(/\|\s*([A-Za-z_][A-Za-z0-9_']*)/g)) rows.push(c[1]!);
      }
    }
  }
  if (found !== 1) throw new Error(`${MODEL} must declare \`inductive Row\` exactly once, at column 0 (README: Anchors); found ${found}`);
  return rows;
}

// ---- The generator's vectors.

export interface Outcomes {
  verdict: Result;
  checks: { check: string; outcome: Result }[];
  requirements: { req: string; outcome: Result }[];
}
export interface Vector extends Outcomes { claim: ClaimInput; rows: string[] }
export interface Header { seed: number; count: number; rows: string[] }
export interface Vectors { header: Header; vectors: Vector[] }
/** Runs the generator: `node scripts/verdict-proofs.mjs vectors --seed <seed> --count <count>` in `cwd`. */
export const generate = (cwd: string, seed: number, count: number): Ran =>
  runNode([LANE_SCRIPT, 'vectors', '--seed', String(seed), '--count', String(count)], cwd);
/** The generator's output, read strictly: a header line, then `count` vectors (README: The vectors). */
export function readVectors(r: Ran, seed: number, count: number): Vectors {
  if (r.status !== 0) throw new Error(`the generator didn't print vectors for seed ${seed}:\n${shown(r)}`);
  const lines = r.stdout.split('\n').filter((l) => l.trim() !== '');
  const parse = (line: string, i: number): unknown => {
    try {
      return JSON.parse(line);
    } catch (e) {
      throw new Error(`line ${i + 1} of the generator's stdout isn't JSON (${(e as Error).message}): ${line.slice(0, 200)}`);
    }
  };
  const header = parse(lines[0] ?? '', 0) as Header;
  if (header?.seed !== seed || header.count !== count || !Array.isArray(header.rows)) {
    throw new Error(`the header must be {"seed": ${seed}, "count": ${count}, "rows": [...]}; got ${(lines[0] ?? '').slice(0, 300)}`);
  }
  const vectors = lines.slice(1).map((line, i) => {
    const v = parse(line, i + 1) as Vector;
    if (!v || typeof v.claim !== 'object' || typeof v.verdict !== 'string' || !Array.isArray(v.checks) || !Array.isArray(v.requirements) || !Array.isArray(v.rows)) {
      throw new Error(`vector ${i} lacks claim, verdict, checks, requirements or rows: ${line.slice(0, 300)}`);
    }
    return v;
  });
  if (vectors.length !== count) throw new Error(`the generator printed ${vectors.length} vectors for --count ${count}`);
  return { header, vectors };
}

/** What the agreement reads from a verdict: its outcome and each check's and requirement's. */
export interface Judged {
  outcome: Result;
  checks: readonly { check: string; outcome: Result }[];
  requirements: readonly { req: string; outcome: Result }[];
}
export type Engine = (claim: ClaimInput) => Judged;
/** How the engine's verdict on a vector's claim differs from the model's, or null when they're equal. */
export function difference(want: Vector, engine: Engine): string | null {
  let got: Judged;
  try {
    got = engine(want.claim);
  } catch (e) {
    return `the engine threw ${(e as Error).message}`;
  }
  if (got.outcome !== want.verdict) return `verdict ${got.outcome}, the model ${want.verdict}`;
  for (const [what, mine, theirs] of [
    ['check', want.checks.map((c) => [c.check, c.outcome] as const), got.checks.map((c) => [c.check, c.outcome] as const)],
    ['requirement', want.requirements.map((q) => [q.req, q.outcome] as const), got.requirements.map((q) => [q.req, q.outcome] as const)],
  ] as const) {
    const engineSide = new Map(theirs);
    for (const [id, outcome] of mine) {
      if (!engineSide.has(id)) return `the engine has no outcome for ${what} ${id}`;
      if (engineSide.get(id) !== outcome) return `${what} ${id} ${engineSide.get(id)}, the model ${outcome}`;
    }
    const modelSide = new Set(mine.map(([id]) => id));
    const extra = theirs.find(([id]) => !modelSide.has(id));
    if (extra) return `the model has no outcome for ${what} ${extra[0]}`;
  }
  return null;
}
/** The agreement test: the first vector where `engine` differs from the model, named by seed and index; null if none. */
export function agreement(seed: number, vectors: readonly Vector[], engine: Engine): string | null {
  for (let i = 0; i < vectors.length; i++) {
    const diff = difference(vectors[i]!, engine);
    if (diff) return `seed ${seed}, vector ${i} (${vectors[i]!.claim.claim}): ${diff}`;
  }
  return null;
}
/** How many vectors each of the model's rows applied in. */
export function rowCounts(rows: readonly string[], vectors: readonly Vector[]): Map<string, number> {
  const counts = new Map(rows.map((r) => [r, 0]));
  for (const v of vectors) for (const r of new Set(v.rows)) counts.set(r, (counts.get(r) ?? 0) + 1);
  return counts;
}
/** The agreement test's row check: each of the model's rows that applies in no vector, named with the seed. */
export function rowGaps(seed: number, rows: readonly string[], vectors: readonly Vector[]): string[] {
  return [...rowCounts(rows, vectors)].filter(([, n]) => n === 0).map(([row]) => `row ${row} applies in no vector of seed ${seed}`);
}

const HEX64 = /^[0-9a-f]{64}$/;
/**
 * Claims the vectors must hold: the five rows the reference of #28 misses (Why, item 4) and the two the engine
 * fixes (items 1 and 2), each recognized from the claim alone.
 */
export const SHAPES: readonly (readonly [string, (c: ClaimInput) => boolean])[] = [
  ['a fix check with no run on the merge base', (c) => c.checks.some((k) => k.state !== 'never_started' && !k.base
    && k.covers.some((q) => c.requirements.find((r) => r.req === q)?.on_base === 'fails'))],
  ['a contract check whose run has no contract report', (c) => c.checks.some((k) => k.contract !== undefined
    && c.runs.some((r) => r.check === k.check && (r.outcome === 'passed' || r.outcome === 'failed') && r.contract === undefined))],
  ['a state digest that isn\'t a sha256', (c) => (c.state ?? []).some((d) => !HEX64.test(d))],
  ['captured evidence with no digest', (c) => c.runs.some((r) => r.evidence.some((s) => s.state === 'captured' && !(s.sha256 && HEX64.test(s.sha256))))],
  ['a claim with no requirements and only the agent\'s own checks', (c) => c.requirements.length === 0 && c.checks.length > 0 && c.checks.every((k) => k.source === 'own')],
  ['two records with one run ID and different outcomes', (c) => c.runs.some((r, i) => c.runs.some((s, j) => j > i && s.run === r.run && s.outcome !== r.outcome))],
  ['a contract report INVALID with empty reasons', (c) => c.runs.some((r) => r.contract?.outcome === 'INVALID' && r.contract.reasons.length === 0)],
];

// ---- Copies of the engine.

/** The precedence as the engine writes it (README: Anchors): one object literal in its source. */
const RANK_LITERAL = /\{\s*PASS:\s*0\s*,\s*pending:\s*1\s*,\s*INCONCLUSIVE:\s*2\s*,\s*BLOCKED:\s*3\s*,\s*INVALID:\s*4\s*,\s*FAIL:\s*5\s*,?\s*\}/g;
/**
 * A copy of the engine whose precedence swaps PRECEDENCE[low] and PRECEDENCE[low + 1], imported through the copy's
 * public entry. Throws, naming the anchor, unless the engine's source holds the rank literal exactly once.
 */
export async function engineWithSwap(low: number): Promise<Engine> {
  const dir = scratchDir(`swap${low}`);
  cpSync(join(ROOT, ENGINE_SRC), join(dir, ENGINE_SRC), { recursive: true });
  if (existsSync(join(ROOT, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  const files = filesUnder(join(dir, ENGINE_SRC), '.ts', /^$/);
  const hits = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(RANK_LITERAL)].map(() => file));
  if (hits.length !== 1) throw new Error(`${ENGINE_SRC} must hold the precedence literal { PASS: 0, pending: 1, INCONCLUSIVE: 2, BLOCKED: 3, INVALID: 4, FAIL: 5 } exactly once (README: Anchors); found ${hits.length}`);
  const order = [...PRECEDENCE];
  [order[low], order[low + 1]] = [order[low + 1]!, order[low]!];
  const swapped = `{ ${PRECEDENCE.map((r) => `${r}: ${order.indexOf(r)}`).join(', ')} }`;
  const file = hits[0]!;
  writeFileSync(file, readFileSync(file, 'utf8').replace(RANK_LITERAL, swapped));
  const mod = (await import(pathToFileURL(join(dir, ENGINE_SRC, 'index.ts')).href)) as { verdict: Engine };
  return mod.verdict;
}
