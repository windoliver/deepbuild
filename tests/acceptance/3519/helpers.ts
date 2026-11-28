// Test-side tools for the #3519 acceptance tests (README: Surfaces): the two skills as the checkout holds them and as
// their generators write them, their craft lines, the pinned tokenizer, craft.json's words, the guide a line names as
// `deep_kinds` serves it on `deep-show run` (#2697's helpers), the merge base, and a suite run in its own Vitest.
// Nothing here stands in for a skill, a generator, deep_kinds or a reply. Each `...Failures` function is a criterion's
// check: it returns sentences naming what failed, so a test runs it on the program and on the plant the criterion names.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from 'vitest';
import { baseChecks, candidateNames, guideFailures, guideText, kindsReplies, normalize, tokens } from '../2697/helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = realpathSync(join(HERE, '..', '..', '..'));
export const SKILL = 'skills/deepbuild/SKILL.md';
export const CANVAS = 'skills/deepbuild-canvas/SKILL.md';
/** The merge base's canvas skill, `skills/deepbuild-canvas/SKILL.md` at f0a816405, byte for byte. */
export const BASE_CANVAS = join(HERE, 'fixtures/base-canvas-SKILL.md');
export const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

export const AC = {
  words: 'AC1 #3519.a718f309',
  guide: 'AC2 #3519.a0dcc475',
  line: 'AC3 #3519.0b8cfc3f',
  drift: 'AC4 #3519.f27efbd8',
} as const;
/** "at most 16,700 tokens by the pinned tokenizer". */
export const CEILING = 16_700;
export const TIMEOUT = 3_600_000;

export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names every one of `names`. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  expect(failures.some((f) => names.every((n) => f.includes(n))), `${what}: a failure names ${names.join(' and ')}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
}
export function blocked(why: string): never { throw Error(`BLOCKED: ${why}`); }

// ---------------------------------------------------------------------------------------------------
// A skill's craft lines (README: Readings 1): the lines of its body (past the front matter and before the canvas
// skill's Kinds listing, which #1105 counts) that say "craft", headings left out.

export function craftLines(text: string): string[] {
  const lines = text.split('\n');
  const start = lines[0] === '---' ? lines.indexOf('---', 1) + 1 : 0;
  const kinds = lines.findIndex((l, i) => i >= start && /^## Kinds\b/.test(l));
  return lines.slice(start, kinds < 0 ? undefined : kinds).filter((l) => /craft/i.test(l) && !/^#/.test(l));
}

// ---------------------------------------------------------------------------------------------------
// AC1: the tokens, and no check's own words.

interface CraftCheck { name: string; description: string; threshold: string; fix: string }
/** craft@1's checks as the checks read them, from the checkout's crates/deep-canvas/src/craft.json. */
export function craftChecks(): CraftCheck[] {
  const table = JSON.parse(read('crates/deep-canvas/src/craft.json')) as { checks?: CraftCheck[] };
  const checks = table.checks ?? [];
  if (checks.length < 16) blocked(`crates/deep-canvas/src/craft.json lists ${checks.length} checks, not craft@1's sixteen`);
  return checks;
}

export function wordsFailures(text: string, what: string): string[] {
  const skill = normalize(text);
  const out: string[] = [];
  for (const c of craftChecks()) for (const part of ['description', 'threshold', 'fix'] as const) {
    if (skill.includes(normalize(c[part]))) out.push(`${what} holds ${c.name}'s ${part}: "${c[part].slice(0, 120)}"`);
  }
  const n = tokens(text);
  if (n > CEILING) out.push(`${what} is ${n} tokens by o200k_base (gpt-tokenizer 4.0.0), over the ceiling of ${CEILING}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// AC2: the guide the canvas skill's line names, as deep_kinds serves it.

const served = (r: Record<string, unknown> | undefined): boolean => !!r && r['error'] === undefined && typeof r['text'] === 'string' && r['text'] !== '';

/** The guide the craft line names (the first name it gives that deep_kinds reads text for), checked as #2697's AC2. */
export function guideOf(bin: string, text: string, what: string): { name?: string; failures: string[] } {
  const lines = craftLines(text);
  if (!lines.length) return { failures: [`${what} has no line for craft checks: no line of its body says "craft"`] };
  const names = candidateNames(lines.join('\n'));
  const replies = kindsReplies(bin, names.map((n) => ({ call: 'deep_kinds', op: 'read', guide: n })));
  const name = names[replies.findIndex(served)];
  if (name === undefined) return { failures: [`${what}'s craft line names no guide deep_kinds serves: none of ${names.join(', ')}; the line: ${lines.join(' | ').slice(0, 400)}`] };
  const guide = guideText(bin, name);
  if (guide.failure) return { name, failures: [`${what} names the guide ${name}: ${guide.failure}`] };
  return { name, failures: guideFailures(guide.text, baseChecks()).map((f) => `${what} names the guide ${name}, and ${f}`) };
}

/** The canvas skill with every line where `name` stands as a word removed. */
export const withoutGuide = (text: string, name: string): string =>
  text.split('\n').filter((l) => !new RegExp(`(?<![A-Za-z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`).test(l)).join('\n');

// ---------------------------------------------------------------------------------------------------
// AC3: the line in each skill, and the generators that write them.

export function lineFailures(skill: string, canvas: string, from: string): string[] {
  const [a, b] = [craftLines(skill), craftLines(canvas)];
  const out: string[] = [];
  if (a.length !== 1) out.push(`${SKILL} (${from}) has ${a.length} craft lines, not one: ${a.join(' | ').slice(0, 400)}`);
  if (b.length !== 1) out.push(`${CANVAS} (${from}) has ${b.length} craft lines, not one: ${b.join(' | ').slice(0, 400)}`);
  if (a.length === 1 && b.length === 1 && a[0] !== b[0]) out.push(`the craft line of ${SKILL} and of ${CANVAS} (${from}) differ: ${JSON.stringify(a[0])} beside ${JSON.stringify(b[0])}`);
  return out;
}

type Gen = Record<string, (...a: unknown[]) => unknown>;
const load = async (rel: string): Promise<Gen> => (await import(pathToFileURL(join(REPO, rel)).href)) as Gen;

/** What the two generators write now: scripts/skill.mjs's skill, and scripts/canvas-skill.mjs's from deep-show's dump. */
export async function generated(bin: string): Promise<{ skill: string; canvas: string }> {
  const { skill } = (await load('scripts/skill.mjs'))['generate']!() as { skill: string };
  const dir = mkdtempSync(join(tmpdir(), 'deep-3519-dump-'));
  try {
    const r = spawnSync(bin, ['kinds', '--dump', dir], { cwd: REPO, encoding: 'utf8' });
    const path = (JSON.parse(r.stdout || 'null') as { path?: string } | null)?.path;
    if (r.status !== 0 || !path) blocked(`deep-show kinds --dump exits ${r.status}: ${r.stderr.slice(-800)}`);
    const canvas = (await load('scripts/canvas-skill.mjs'))['canvasSkill']!(JSON.parse(readFileSync(path, 'utf8'))) as string;
    return { skill, canvas };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A text with its craft line worded differently: the plant AC3 names. */
export function reworded(text: string): string {
  const [line] = craftLines(text);
  if (line === undefined) blocked('no craft line to word differently');
  return text.replace(line, () => `${line} Read it first.`);
}

// ---------------------------------------------------------------------------------------------------
// AC4: git and Vitest.

export function git(...args: string[]): { status: number | null; out: string } {
  const r = spawnSync('/usr/bin/git', args, { cwd: REPO, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

interface Assertion { fullName: string; status: string; failureMessages?: string[] }
/** One suite's file run unchanged in its own Vitest, as its README runs it; every test it ran, with its status. */
export function suite(root: string, file: string): Assertion[] {
  const dir = mkdtempSync(join(tmpdir(), 'deep-3519-vitest-'));
  try {
    const out = join(dir, 'report.json');
    const args = [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--root', root, '--no-file-parallelism', '--cache=false', '--fsModuleCache=false', '--reporter=json', `--outputFile=${out}`, file];
    const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', timeout: 3_500_000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 });
    let report: { testResults: { assertionResults: Assertion[] }[] };
    try { report = JSON.parse(readFileSync(out, 'utf8')) as typeof report; } catch { throw Error(`INCONCLUSIVE: ${root}/${file} left no report (exit ${r.status}, ${r.signal ?? 'no signal'}): ${(r.stderr ?? '').slice(-1500)}`); }
    return report.testResults.flatMap((t) => t.assertionResults);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
