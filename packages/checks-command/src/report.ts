// A run's own record, read back: the evidence files its processes wrote (the read trace, the children they started,
// the tools' reports), each checked whole by its trailers, turned into the tests that ran, every attempt of each,
// and where each failed test failed. Places and counts come only from the reports, never from printed output.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Failure } from '@deepbuild/conformance';

/** A file's lines without its trailers, and why it isn't the run's whole record when it isn't. */
export interface Evidence { lines: string[]; altered: string | null }
const isTrailer = (line: string): boolean => line.startsWith('{"deep":"end"');
/**
 * Null when no process wrote the file. Altered when no process closed it with a trailer, a trailer isn't one, or its
 * lines fall short of what the trailers count, as after a suite truncated it. A process its tool killed before it
 * closed (a Vitest worker) leaves more lines than counted, which is no truncation; for a file only processes that
 * close it write (`exact`, the Vitest report), a line no trailer counts is one the runner's reporter never wrote.
 */
export function evidence(path: string, exact = false): Evidence | null {
  if (!existsSync(path)) return null;
  const all = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const counted = all.filter(isTrailer).map((l) => { try { return Number((JSON.parse(l) as { lines: unknown }).lines); } catch { return NaN; } });
  const lines = all.filter((l) => !isTrailer(l));
  const written = counted.reduce((a, b) => a + b, 0);
  if (!counted.length) return { lines, altered: 'no trailer' };
  if (!counted.every((n) => Number.isSafeInteger(n) && n >= 0)) return { lines, altered: 'a trailer that counts no lines' };
  return { lines, altered: lines.length < written || (exact && lines.length > written) ? `${lines.length} lines, ${written} written` : null };
}
const parsed = <T>(lines: string[]): T[] => lines.flatMap((l) => { try { return [JSON.parse(l) as T]; } catch { return []; } });

/** A path relative to the checkout, or null outside it. */
export function under(checkout: string, path: string): string | null {
  // Most of a run's reads are its tools' own files, outside the checkout: an absolute path not under it is decided at once.
  if (isAbsolute(path) && !path.startsWith(checkout + sep)) return null;
  const rel = relative(checkout, resolve(checkout, path));
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : null;
}
/** The repo's test, fixture and script folders. */
export const OWN_FOLDERS = /(^|\/)(tests?|spec|__tests__|fixtures?|scripts?)\//;
/** A check's own files: its tests, and what lies in the repo's test, fixture and script folders (its setup). */
export const ownFile = (path: string): boolean => OWN_FOLDERS.test(path) || /(\.test\.|\.spec\.|_test\.|(^|\/)test_)/.test(path);
const ASSERTIONS = new Set(['AssertionError', 'AssertionError [ERR_ASSERTION]', 'JestAssertionError']);

interface Frame { file: string; line: number }
/** The frames of a stack's text, innermost first. */
const framesOf = (stack: string | null): Frame[] =>
  [...(stack ?? '').matchAll(/(?:file:\/\/)?(\/[^\s():]+):(\d+):\d+/g)].map((m) => ({ file: m[1]!, line: Number(m[2]) }));

interface Caught { name: string | null; message: string; stack: string | null; code?: string | null; frames?: Frame[] }
/**
 * One failure as the report places it: the innermost frame in the check's own files (its test file, or a file in
 * its test, fixture or script folders), else the innermost in the checkout outside its dependencies; an assertion
 * failure only when the report names the framework's own and places it. A failure the report can't place is
 * unplaced, never an assertion failure.
 */
function failure(checkout: string, test: string, testFile: string | null, error: Caught): Failure {
  const frames = [...(error.frames ?? []), ...framesOf(error.stack)]
    .map((f) => ({ file: under(checkout, f.file), line: f.line }))
    .filter((f): f is Frame => f.file !== null && !f.file.startsWith('node_modules/') && f.line >= 1);
  const own = frames.find((f) => f.file === testFile || ownFile(f.file));
  const at = own ?? frames[0];
  const named = ASSERTIONS.has(error.name ?? '') || error.code === 'ERR_ASSERTION';
  if (!at) return { test, file: testFile ?? '.', line: 1, stack: error.stack, assertion: false, message: `unplaced: ${error.message}` };
  return { test, file: at.file, line: at.line, stack: error.stack, assertion: named, message: error.message };
}

export type Attempt = 'passed' | 'failed';
export interface Ran { test: string; file: string | null; attempts: Attempt[]; meta: Record<string, unknown> }
/** `malformed`: lines the tool's reporter can't have written, which leave the run uncounted. */
export interface Reported { ran: Ran[]; failures: Failure[]; malformed: number }

interface NodeLine { type: string; name: string | null; file: string | null; suite?: boolean; error?: { message: string; stack: string | null; code: string | null; name: string | null; failureType: string | null }; message?: string }
/** node:test's report, as check.kind@1's reporter writes it (#314). */
export function nodeTest(lines: string[], checkout: string, stderr: string): Reported {
  const read = parsed<NodeLine>(lines);
  const all = read.filter((l) => typeof l === 'object' && l !== null && (l.file === null || typeof l.file === 'string') && (l.name === null || typeof l.name === 'string')
    && (l.error === undefined || (typeof l.error === 'object' && l.error !== null)));
  const fileEntry = (l: NodeLine): boolean => l.file !== null && l.name !== null && resolve(checkout, l.name) === l.file;
  const ran = all.filter((l) => (l.type === 'test:pass' || l.type === 'test:fail') && !l.suite && !fileEntry(l))
    .map((l) => ({ test: l.name ?? '', file: l.file && under(checkout, l.file), attempts: [l.type === 'test:pass' ? 'passed' : 'failed'] as Attempt[], meta: {} }));
  const printed = all.filter((l) => l.type === 'test:stderr').map((l) => l.message ?? '').join('') || stderr;
  const failures = all.filter((l) => l.type === 'test:fail' && !l.suite && l.error?.failureType !== 'subtestsFailed').map((l) => {
    const e = l.error ?? { message: '(no error in the report)', stack: null, code: null, name: null, failureType: null };
    const file = l.file && under(checkout, l.file);
    // A crash outside any test has no cause of its own in the report; the tool wrote the error to stderr.
    const caught = e.code === null && e.name === null && printed.trim() ? printed.trim() : null;
    const name = caught ? (/\b(\w*Error)\b/.exec(caught)?.[1] ?? null) : e.name;
    const message = caught ? (caught.split('\n').find((t) => /\b\w*Error\b/.test(t)) ?? e.message) : e.message;
    return failure(checkout, l.name ?? file ?? '.', file, { name, message, stack: caught ?? e.stack, code: e.code });
  });
  return { ran, failures, malformed: lines.length - all.length };
}

interface VitestLine { type: string; name?: string; file: string | null; retries?: number; errors: Caught[]; meta?: Record<string, unknown> }
/** Vitest's report, as the command check kind's reporter writes it (runtime/vitest-reporter.mjs). */
export function vitest(lines: string[], checkout: string, lastAttemptOnly = false): Reported {
  const all = parsed<VitestLine>(lines);
  const ran: Ran[] = [];
  const failures: Failure[] = [];
  let malformed = lines.length - all.length;
  // Every test of a file names it: each is placed once.
  const placed = new Map<string, string | null>();
  const inCheckout = (file: string): string | null => { if (!placed.has(file)) placed.set(file, under(checkout, file)); return placed.get(file)!; };
  for (const l of all) {
    const retries = l.retries ?? 0;
    const shaped = typeof l === 'object' && l !== null && (l.file === null || typeof l.file === 'string') && (l.name === undefined || typeof l.name === 'string')
      && Array.isArray(l.errors) && l.errors.every((e) => typeof e === 'object' && e !== null) && Number.isSafeInteger(retries) && retries >= 0 && retries <= 1000;
    if (!shaped) { malformed += 1; continue; }
    const file = l.file && inCheckout(l.file);
    if (l.type === 'test:pass' || l.type === 'test:fail') {
      const final: Attempt = l.type === 'test:pass' ? 'passed' : 'failed';
      const before = lastAttemptOnly ? 0 : retries;
      ran.push({ test: l.name ?? '', file, attempts: [...Array<Attempt>(before).fill('failed'), final], meta: l.meta ?? {} });
      if (lastAttemptOnly && final === 'passed') continue;
      for (const e of l.errors) failures.push(failure(checkout, l.name ?? '', file, e));
    } else {
      for (const e of l.errors) failures.push(failure(checkout, file ?? '(run)', file, e));
    }
  }
  return { ran, failures, malformed };
}
