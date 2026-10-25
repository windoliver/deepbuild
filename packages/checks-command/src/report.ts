// A run's own record, read back: the evidence files its processes wrote (the read trace, the children they started,
// the tools' reports), each checked whole by its trailers, turned into the tests that ran, every attempt of each,
// and where each failed test failed. Places and counts come only from the reports, never from printed output.
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Failure } from '@deepbuild/conformance';
import type { Left, Listed, Seen } from './listing.js';

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
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  const lines: string[] = [];
  const counted: number[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    if (!isTrailer(line)) lines.push(line);
    else try { counted.push(Number((JSON.parse(line) as { lines: unknown }).lines)); } catch { counted.push(NaN); }
  }
  const written = counted.reduce((a, b) => a + b, 0);
  if (!counted.length) return { lines, altered: 'no trailer' };
  if (!counted.every((n) => Number.isSafeInteger(n) && n >= 0)) return { lines, altered: 'a trailer that counts no lines' };
  return { lines, altered: lines.length < written || (exact && lines.length > written) ? `${lines.length} lines, ${written} written` : null };
}
const parsed = <T>(lines: string[]): T[] => lines.flatMap((l) => { try { return [JSON.parse(l) as T]; } catch { return []; } });

/** A `.`, `..` or empty segment, or a trailing separator (either kind, where the platform takes both): what `resolve` would change in a path. */
const SEPARATOR = sep === '/' ? '\\/' : '[\\\\/]';
const PLAIN_SEGMENTS = new RegExp(`(^|${SEPARATOR})\\.{0,2}(${SEPARATOR}|$)`);
/** A path relative to the checkout, or null outside it. */
export function under(checkout: string, path: string): string | null {
  if (isAbsolute(path)) {
    // Most of a run's reads are its tools' own files, outside the checkout: an absolute path not under it is decided at once.
    if (!path.startsWith(checkout + sep)) return null;
    // And one below it whose segments are all plain names is relative to it as it is, with nothing to resolve (a
    // first segment that starts with `..` goes the long way, which places it as it always has).
    const below = path.slice(checkout.length + 1);
    if (!PLAIN_SEGMENTS.test(below) && !below.startsWith('..')) return below;
  }
  const rel = relative(checkout, resolve(checkout, path));
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : null;
}
/** The repo's test, fixture and script folders. */
export const OWN_FOLDERS = /(^|\/)(tests?|spec|__tests__|fixtures?|scripts?)\//;
/** A check's own files: its tests, and what lies in the repo's test, fixture and script folders (its setup). */
export const ownFile = (path: string): boolean => OWN_FOLDERS.test(path) || /(\.test\.|\.spec\.|_test\.|(^|\/)test_)/.test(path);
// `testing` is Go's: a test's own t.Errorf or t.Fatalf.
const ASSERTIONS = new Set(['AssertionError', 'AssertionError [ERR_ASSERTION]', 'JestAssertionError', 'testing']);

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

interface NodeLine { type: string; name: string | null; file: string | null; line?: unknown; suite?: boolean; skip?: boolean; todo?: boolean; error?: { message: string; stack: string | null; code: string | null; name: string | null; failureType: string | null }; message?: string }
/**
 * node:test's report, as check.kind@1's reporter writes it (#314): a skipped test that passed, or a todo test, didn't
 * run. With each file a test of it came from and every test the report names at its call's line, but a todo test's
 * failure, which the run doesn't count (`seen`), so the runner can find those of a file's tests it never reported.
 */
export function nodeTest(lines: string[], checkout: string, stderr: string): Reported & { files: string[]; seen: Seen[] } {
  const read = parsed<NodeLine>(lines);
  const all = read.filter((l) => typeof l === 'object' && l !== null && (l.file === null || typeof l.file === 'string') && (l.name === null || typeof l.name === 'string')
    && (l.error === undefined || (typeof l.error === 'object' && l.error !== null)));
  const fileEntry = (l: NodeLine): boolean => l.file !== null && l.name !== null && resolve(checkout, l.name) === l.file;
  // A test a hook skips still runs: its failure counts, as the tool counts it.
  const counted = (l: NodeLine): boolean => (l.type === 'test:fail' || (l.type === 'test:pass' && l.skip !== true)) && !l.suite && l.todo !== true;
  const ran = all.filter((l) => counted(l) && !fileEntry(l))
    .map((l) => ({ test: l.name ?? '', file: l.file && under(checkout, l.file), attempts: [l.type === 'test:pass' ? 'passed' : 'failed'] as Attempt[], meta: {} }));
  // A hook's skip still runs the test's body: it was no test left out.
  const seen = all.filter((l) => (l.type === 'test:pass' || (l.type === 'test:fail' && l.todo !== true)) && !l.suite && !fileEntry(l) && Number.isSafeInteger(l.line))
    .map((l) => ({ test: l.name ?? '', file: l.file && under(checkout, l.file), line: l.line as number }));
  const files = [...new Set(all.flatMap((l) => (l.file && l.type.startsWith('test:') ? [under(checkout, l.file)] : [])))]
    .filter((f): f is string => f !== null && !f.startsWith('node_modules/'));
  const printed = all.filter((l) => l.type === 'test:stderr').map((l) => l.message ?? '').join('') || stderr;
  const failures = all.filter((l) => counted(l) && l.type === 'test:fail' && l.error?.failureType !== 'subtestsFailed').map((l) => {
    const e = l.error ?? { message: '(no error in the report)', stack: null, code: null, name: null, failureType: null };
    const file = l.file && under(checkout, l.file);
    // A crash outside any test has no cause of its own in the report; the tool wrote the error to stderr.
    const caught = e.code === null && e.name === null && printed.trim() ? printed.trim() : null;
    const name = caught ? (/\b(\w*Error)\b/.exec(caught)?.[1] ?? null) : e.name;
    const message = caught ? (caught.split('\n').find((t) => /\b\w*Error\b/.test(t)) ?? e.message) : e.message;
    return failure(checkout, l.name ?? file ?? '.', file, { name, message, stack: caught ?? e.stack, code: e.code });
  });
  return { ran, failures, malformed: lines.length - all.length, files, seen };
}

interface VitestLine { type: string; name?: string; file: string | null; retries?: number; errors: Caught[]; meta?: Record<string, unknown>; filter?: unknown; tool?: unknown; line?: unknown }
/** What a Vitest-format report says besides its tests: each Vitest or Jest file it ran, and pytest's listing and the tests it left out. */
export interface Listing { files: { file: string; tool: 'vitest' | 'jest' }[]; listed: Listed[]; left: Left[] }
/**
 * Vitest's report, as the command check kind's reporter writes it (runtime/vitest-reporter.mjs), and Jest's and
 * pytest's in the same format. A run error that names a filter is no failure when `named` (the check's command) holds it.
 */
export function vitest(lines: string[], checkout: string, lastAttemptOnly = false, named: (filter: string) => boolean = () => false): Reported & Listing {
  const all = parsed<VitestLine>(lines);
  const ran: Ran[] = [];
  const failures: Failure[] = [];
  const listing: Listing = { files: [], listed: [], left: [] };
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
    } else if (l.type === 'file:ran' || l.type === 'test:listed' || l.type === 'test:left') {
      // A file outside the checkout isn't the check's: nothing of it is listed.
      if (!file) continue;
      if (l.type === 'file:ran' && (l.tool === 'vitest' || l.tool === 'jest')) listing.files.push({ file, tool: l.tool });
      else if (l.type === 'test:listed' && typeof l.name === 'string' && Number.isSafeInteger(l.line)) listing.listed.push({ test: l.name, file, line: l.line as number, tagged: false });
      else if (l.type === 'test:left' && typeof l.name === 'string' && typeof l.filter === 'string') listing.left.push({ test: l.name, file, filter: l.filter });
      else malformed += 1;
    } else if (!(l.type === 'run:error' && typeof l.filter === 'string' && named(l.filter))) {
      for (const e of l.errors) failures.push(failure(checkout, file ?? '(run)', file, e));
    }
  }
  return { ran, failures, malformed, ...listing };
}

interface GoEvent { Action?: unknown; Package?: unknown; Test?: unknown; Output?: unknown }
/** A Go package's folder: `_/abs/dir` outside GOPATH, or the module's path below the checkout's go.mod. */
function packageDir(checkout: string, pkg: string): string | null {
  if (pkg.startsWith('_/')) return pkg.slice(1);
  let module: string | undefined;
  try { module = /^module\s+(\S+)/m.exec(readFileSync(resolve(checkout, 'go.mod'), 'utf8'))?.[1]; } catch { return null; }
  if (!module || (pkg !== module && !pkg.startsWith(`${module}/`))) return null;
  return resolve(checkout, pkg.slice(module.length + 1));
}
/**
 * `go test -json`'s report (the runner sets GOFLAGS=-json), from the run's stdout: every test and subtest that
 * passed or failed, a subtest's parent left out; a failure placed at the first `file.go:N:` line the test logged
 * (t.Errorf and t.Fatalf, Go's own failure report, which t.Log's lines look like), or, for a panic, at the
 * innermost frame of its trace, which is no assertion failure.
 */
export function goTest(stdout: string, checkout: string): Reported {
  const events = parsed<GoEvent>(stdout.split('\n').filter((l) => l.startsWith('{')))
    .filter((e) => typeof e === 'object' && e !== null && typeof e.Action === 'string' && typeof e.Package === 'string');
  const key = (e: GoEvent): string => `${e.Package as string}\0${e.Test as string}`;
  const output = new Map<string, string>();
  const ended = new Map<string, GoEvent>();
  for (const e of events) {
    if (typeof e.Test !== 'string') continue;
    if (e.Action === 'output' && typeof e.Output === 'string') output.set(key(e), (output.get(key(e)) ?? '') + e.Output);
    if (e.Action === 'pass' || e.Action === 'fail') ended.set(key(e), e);
  }
  const names = [...ended.values()].map((e) => key(e));
  const leaves = [...ended.values()].filter((e) => !names.some((n) => n.startsWith(`${key(e)}/`)));
  const ran: Ran[] = [];
  const failures: Failure[] = [];
  for (const e of leaves) {
    const test = e.Test as string;
    const dir = packageDir(checkout, e.Package as string);
    const text = output.get(key(e)) ?? '';
    const logged = /^\s+([\w.-]+\.go):(\d+): (.*)$/m.exec(text);
    const file = logged && dir ? under(checkout, resolve(dir, logged[1]!)) : null;
    ran.push({ test, file, attempts: [e.Action === 'pass' ? 'passed' : 'failed'], meta: {} });
    if (e.Action !== 'fail') continue;
    const panicked = /^panic: /m.test(text);
    const frames = panicked ? [...text.matchAll(/^\s+(\/\S+\.go):(\d+)/gm)].map((m) => ({ file: m[1]!, line: Number(m[2]) }))
      : logged && dir ? [{ file: resolve(dir, logged[1]!), line: Number(logged[2]) }] : [];
    const message = panicked ? (/^panic: .*$/m.exec(text)?.[0] ?? text.trim()) : (logged?.[3] ?? text.trim());
    failures.push(failure(checkout, test, file, { name: panicked ? 'panic' : 'testing', message, stack: text, frames }));
  }
  // A package that failed with no test failing in it didn't build or set up: its own failure, unplaced.
  for (const e of events) {
    if (typeof e.Test === 'string' || e.Action !== 'fail' || leaves.some((t) => t.Package === e.Package && t.Action === 'fail')) continue;
    failures.push(failure(checkout, e.Package as string, null, { name: null, message: `package ${e.Package as string} failed`, stack: null }));
  }
  return { ran, failures, malformed: 0 };
}
