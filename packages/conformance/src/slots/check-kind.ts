// The check.kind@1 kit (#314): the reference runner for the `command` kind runs a check's command in its
// checkout, hermetically (a cleared environment with allowlisted variables, a home of its own, DO_NOT_TRACK=1)
// in a process group of its own under the deadline, and reports a closed run outcome, never a verdict, with
// testsRun and each failure's place taken from the tool's own report (a node:test reporter loaded into the
// run's Node processes), the files those processes read (a tracer loaded the same way) and the mask it found in
// the command. The kit's fixtures are small suites, the known outcomes and the ways a suite or its command can
// hide a run; its seeded part generates suites at run time from the seed; its planted runners are the check
// catalog's four faults, a runner that ignores a mask, one that records only the declared paths and one that
// hands the command the host's environment.
//
// The trust boundary: the tracer and the reporter run inside the suite's own processes, so the record they
// write is tamper-evident (its names leave the suite's environment, and each file closes with a count a
// truncation can't match), not tamper-proof: a suite that hunts down the record and rewrites it whole, trailers
// and all, with the same user's rights, is not caught here. A check kind that must hold against that runs the
// suite under a tracer it can't write to (another user, a container, OS tracing); that is an extension's runner,
// not this reference.
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JsonValue } from '@deepbuild/contracts';
import type { Random } from '../generator.js';
import { fail, Finding, RUN_OUTCOMES } from '../slot-types.js';
import type { CheckContext, CheckResult, CheckRunnerFill, CheckSpec, Failure, Fixture, PlantedFill, RunOutcome, SlotCase, SlotKitImpl, SlotRule } from '../slot-types.js';
import { list, object, text, word } from './shared.js';

export const CHECK_KIND = 'check.kind@1';
/** The kind the reference runner serves: a shell command run in the checkout. */
const KIND = 'command';
const RUNTIME = fileURLToPath(new URL('../../runtime/check-kind/', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../../fixtures/check-kind/', import.meta.url));
const RUNNER = 'node --test --test-isolation=none spec/*.test.mjs';
const LONG = 60_000;
/** The past-deadline suite waits 250 ms; its deadline is well under that, and the rule's grace well over the kill. */
const SHORT = 60;

interface CheckInput { spec: CheckSpec; checkout: string; deadline: number }
/** What a fixture or generated suite expects of the result; a member left out is not held. */
interface Expected { outcome: RunOutcome; testsRun?: number; failures?: number; assertion?: 'all' | 'none'; mask?: string | null; reads?: string[]; crash?: boolean; hermetic?: boolean }
interface Suite { tests: number; failing: number; nonce: string; names: string[] }

// ---- The rules and the messages their findings lead with ------------------------------------------

const RULES = {
  counts: { id: 'counts-from-report', rule: 'The outcome and testsRun are the tool\'s own report\'s: a suite that crashes before its first assertion is failed with nothing counted, never passed.', message: 'reported a run other than the tool\'s own report' },
  deadline: { id: 'deadline-holds', rule: 'A run still going at its deadline is overran; a result that arrives after the deadline is never passed or failed.', message: 'reported a result after the deadline instead of overran' },
  output: { id: 'output-kept', rule: 'Every failure the tool reported is in the result, with its test, file, line, message and the caught error\'s stack.', message: 'dropped failures the tool reported' },
  assertion: { id: 'assertion-from-report', rule: 'A failure is the framework\'s assertion failure only when the tool\'s report says so; an error outside any assertion is not one.', message: 'marked an error outside any assertion as the framework\'s assertion failure' },
  mask: { id: 'mask-named', rule: 'A command whose exit is masked, whose reads the runner can\'t see (a program other than Node), that starts a process the deadline can\'t reach (a detached child) or that alters the runner\'s record of the run is uncounted, and the result names what hides the run.', message: 'ran a command whose exit is masked without naming the mask' },
  reads: { id: 'read-set', rule: 'The read set holds every file the run\'s processes read or loaded, relative to the checkout, declared or not.', message: 'left files the run read out of the read set' },
  hermetic: { id: 'hermetic-run', rule: 'A run gets a cleared environment with only allowlisted variables, a home of its own and DO_NOT_TRACK=1, so a pass can\'t depend on the machine\'s state.', message: 'ran the command in the host\'s environment instead of a cleared one' },
};
/** The host variables a run keeps: where programs are, the locale, the zone and the temp folder. */
const ALLOWED = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TMPDIR'];
/** The sentinel the kit plants in the host environment around a run; a hermetic run never sees it. */
const SENTINEL = 'DEEP_CHECK_SENTINEL';
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));

// ---- The reference runner ---------------------------------------------------------------------------

/**
 * The ways a command masks its tool's exit, each with the text named as the mask: a failure branch (`|| …`), a
 * pipe (the pipeline's exit is the last command's), an `exit N` anywhere, `set +e`, a `!` negation, and any
 * command after the tool (`…; true`, `…; echo done`): the tool's exit reaches the runner only when the tool is the
 * last command of a plain `&&` chain.
 */
const MASKS: RegExp[] = [/\|\|\s*\S+/, /(?<![|&])\|(?![|&])\s*\S+/, /\bexit\s+\d+/, /\bset\s+\+e\b/, /(?:^|[;&|(]\s*)(!)(?=\s)/];
function maskIn(command: string): string | null {
  for (const m of MASKS) { const hit = m.exec(command); if (hit) return (hit[1] ?? hit[0]).trim(); }
  const segments = command.split(/&&|;|\n/).map((s) => s.trim()).filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  const program = last.split(/\s+/).find((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) ?? '';
  if (segments.length > 1 && program !== 'node' && !program.endsWith('/node')) return `; ${program}`;
  return null;
}

interface ReportLine { type: string; name: string | null; file: string | null; line: number | null; suite?: boolean; error?: { message: string; stack: string | null; code: string | null; name: string | null; failureType: string | null }; message?: string }

const under = (checkout: string, path: string): string | null => {
  const rel = relative(checkout, resolve(checkout, path));
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : null;
};
const readLines = (path: string): string[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []);
/** A trailer the tracer or the reporter wrote at its end: how many lines that process wrote before it. */
const isTrailer = (line: string): boolean => line.startsWith('{"deep":"end"');
/**
 * An evidence file's lines without its trailers, and why it isn't the run's whole record when it isn't: no process
 * closed it with a trailer, or the lines fall short of what the trailers count, as after a suite truncated it.
 */
function evidence(path: string): { lines: string[]; altered: string | null } {
  const all = readLines(path);
  const counted = all.filter(isTrailer).flatMap((l) => { try { return [Number((JSON.parse(l) as { lines: unknown }).lines)]; } catch { return []; } });
  const lines = all.filter((l) => !isTrailer(l));
  const written = counted.reduce((a, b) => a + b, 0);
  return { lines, altered: !counted.length ? 'no trailer' : lines.length !== written ? `${lines.length} lines, ${written} written` : null };
}

/** Shell words that run no program of their own and read no file. */
const BUILTINS = new Set(['cd', 'true', 'false', 'echo', 'exit', 'export', 'test', '[', ':']);
/** Where a program on PATH lives, or the path as given; null when nothing is found. */
function programPath(name: string, cwd: string, env: NodeJS.ProcessEnv): string | null {
  if (name.includes('/')) { const p = resolve(cwd, name); return existsSync(p) ? p : null; }
  for (const dir of (env.PATH ?? '').split(':').filter(Boolean)) { const p = join(dir, name); if (existsSync(p)) return p; }
  return null;
}
/**
 * The first program in the command the tracer can't see into: anything but Node itself or a script Node runs
 * (a `#!…node` shebang), since only a Node process loads the tracer. Such a program's reads would never reach the
 * read set, so the run is uncounted rather than claimed complete.
 */
function untraced(command: string, cwd: string, env: NodeJS.ProcessEnv): string | null {
  // The shell itself reads a file for an input redirection, a here-document or a substitution.
  if (/(^|[^<>])<(?![<>&])/.test(command) || /<<</.test(command) || /<<(?![<])/.test(command)) return 'shell input <';
  if (/\$\(|`/.test(command)) return 'shell substitution $(';
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/).filter((w) => w && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
    const program = words[0];
    if (!program || BUILTINS.has(program) || program === 'node' || program.endsWith('/node')) continue;
    const path = programPath(program, cwd, env);
    if (!path) return `program ${program}`;
    let head = '';
    try { head = readFileSync(path, { encoding: 'utf8', flag: 'r' }).slice(0, 200); } catch { return `program ${program}`; }
    if (!(head.startsWith('#!') && /node/.test(head.split('\n')[0] ?? ''))) return `program ${program}`;
  }
  return null;
}

interface Spawned { file: string; args: string[]; shell: boolean; detached?: boolean }
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);
/**
 * What hides a child a Node process of the run started, named as the mask: `detached <program>` for a child in a
 * process group of its own, which the deadline's kill of the run's group never reaches; the exit mask in a shell
 * command it ran (a package script's `|| true` hides the tool's exit as well as the command's own would);
 * `untraced …` for a program the tracer can't see into; null for a Node child in the run's group.
 */
function hiddenChild(spawned: Spawned, cwd: string, env: NodeJS.ProcessEnv): string | null {
  const program = spawned.file.split('/').pop() ?? spawned.file;
  if (spawned.detached) return `detached ${program}`;
  if (spawned.file === process.execPath || program === 'node') return null;
  const untracedAs = (what: string | null): string | null => (what === null ? null : `untraced ${what}`);
  let command: string | null = null;
  if (spawned.shell) command = [spawned.file, ...spawned.args].join(' ');
  else if (SHELLS.has(program)) { const at = spawned.args.indexOf('-c'); if (at < 0) return `untraced program ${program}`; command = spawned.args[at + 1] ?? ''; }
  if (command === null) return untracedAs(untraced(spawned.file, cwd, env));
  return maskIn(command) ?? untracedAs(untraced(command, cwd, env));
}

interface Ended { status: number | null; signal: string | null; timedOut: boolean; error: string | null }
/** A planted fault in the reference runner; the reference has none. */
type Fault = 'none' | 'ignores-mask' | 'host-env';

/** Runs the command as the reference runner does, or with one planted fault. */
function runCommand(spec: CheckSpec, given: CheckContext, fault: Fault = 'none'): CheckResult {
  const result = (outcome: RunOutcome, rest: Partial<CheckResult> = {}): CheckResult => ({ outcome, testsRun: 0, failures: [], evidence: [], read: [], mask: null, ...rest });
  const mask = fault === 'ignores-mask' ? null : maskIn(spec.runner);
  if (mask !== null) return result('uncounted', { mask });
  if (!existsSync(given.checkout)) return result('missing');
  // The tracer and the test reporter name files by their real paths; a checkout reached through a link (macOS's
  // temp folder, say) is compared by its real path too, or nothing the run read would count as under it.
  const ctx: CheckContext = { ...given, checkout: realpathSync(given.checkout) };
  // A cleared environment: the allowlisted host variables, a home of its own, DO_NOT_TRACK, and the runner's own.
  const kept = Object.fromEntries(ALLOWED.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]!]));
  const hidden = untraced(spec.runner, ctx.checkout, kept);
  if (hidden !== null) return result('uncounted', { mask: `untraced ${hidden}` });
  const work = mkdtempSync(join(tmpdir(), 'deep-check-run-'));
  const reportFile = join(work, 'report.jsonl');
  const readsFile = join(work, 'reads.txt');
  const spawnsFile = join(work, 'spawns.jsonl');
  const stderrFile = join(work, 'stderr.txt');
  const home = join(work, 'home');
  mkdirSync(home);
  try {
    const options = `--import=${join(RUNTIME, 'tracer.mjs')} --test-reporter=${join(RUNTIME, 'reporter.mjs')} --test-reporter-destination=${reportFile}`;
    const base: NodeJS.ProcessEnv = fault === 'host-env' ? { ...process.env } : { ...kept, HOME: home, DO_NOT_TRACK: '1' };
    // The command runs in a shell that leads a process group of its own, with no pipe back here (its stderr goes to
    // a file), so the deadline falls on the shell alone and the whole group is killed after it: a tool that forks
    // or backgrounds work can't outlive its run, and nothing it left behind can hold the runner.
    // Node's types leave `detached` out of the synchronous spawn's options; the runtime honours it.
    const group: SpawnSyncOptionsWithStringEncoding & { detached: boolean } = {
      cwd: ctx.checkout, encoding: 'utf8', stdio: 'ignore', detached: true, timeout: Math.max(1, ctx.deadline), killSignal: 'SIGKILL',
      env: { ...base, DEEP_CHECK_READS: readsFile, DEEP_CHECK_SPAWNS: spawnsFile, NODE_OPTIONS: options },
    };
    const child = spawnSync('sh', ['-c', `exec 2>'${stderrFile}'\n${spec.runner}`], group);
    if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* the group is gone */ } }
    const reads = evidence(readsFile);
    const spawns = evidence(spawnsFile);
    const report = evidence(reportFile);
    // A program started by the run that the tracer can't see into leaves the run uncounted, as a mask would.
    for (const line of spawns.lines) {
      let spawned: Spawned | undefined;
      try { spawned = JSON.parse(line) as Spawned; } catch { continue; }
      if (typeof spawned.file !== 'string') continue;
      const hidden = hiddenChild(spawned, ctx.checkout, kept);
      if (hidden !== null) return result('uncounted', { mask: hidden, evidence: [`a child of the run: ${[spawned.file, ...spawned.args].join(' ')}`] });
    }
    const code = (child.error as NodeJS.ErrnoException | undefined)?.code;
    const ended: Ended = { status: child.status, signal: child.signal, timedOut: code === 'ETIMEDOUT', error: child.error && code !== 'ETIMEDOUT' ? String(child.error) : null };
    const lines = report.lines.flatMap((line) => { try { return [JSON.parse(line) as ReportLine]; } catch { return []; } });
    const fileEntry = (l: ReportLine): boolean => l.file !== null && l.name !== null && resolve(ctx.checkout, l.name) === l.file;
    const tests = lines.filter((l) => (l.type === 'test:pass' || l.type === 'test:fail') && !l.suite && !fileEntry(l));
    const stderr = lines.filter((l) => l.type === 'test:stderr').map((l) => l.message ?? '').join('') || (existsSync(stderrFile) ? readFileSync(stderrFile, 'utf8') : '');
    const failures: Failure[] = lines.filter((l) => l.type === 'test:fail' && !l.suite && l.error?.failureType !== 'subtestsFailed').map((l) => {
      const error = l.error!;
      // A crash outside any test has no cause of its own in the report; the tool wrote the error to stderr.
      const caught = error.code === null && error.name === null && stderr.trim() ? stderr.trim() : null;
      const file = (l.file !== null && under(ctx.checkout, l.file)) || l.file || spec.inputs[0] || '.';
      return { test: l.name ?? file, file, line: l.line !== null && l.line >= 1 ? l.line : 1, stack: caught ?? error.stack, assertion: error.code === 'ERR_ASSERTION' || error.name === 'AssertionError', message: caught ? (caught.split('\n').find((t) => /\b\w*Error\b/.test(t)) ?? error.message) : error.message };
    });
    const read = new Set<string>();
    for (const path of reads.lines) { const rel = under(ctx.checkout, path); if (rel) read.add(rel); }
    for (const l of lines) if (l.file) { const rel = under(ctx.checkout, l.file); if (rel) read.add(rel); }
    const rest = { testsRun: tests.length, failures, read: [...read].sort() };
    if (ended.timedOut) return result('overran', rest);
    if (ended.error !== null || ended.status === 127) return result('missing', rest);
    if (ended.signal !== null) return result('stopped', rest);
    // A run that ended on its own left every evidence file whole, or the suite got at the runner's record: uncounted.
    for (const [name, file] of [['reads', reads], ['spawns', spawns], ['report', report]] as const) {
      if (file.altered !== null) return result('uncounted', { ...rest, mask: `evidence altered ${name}`, evidence: [`${name}: ${file.altered}`] });
    }
    if (failures.length) return result('failed', rest);
    if (ended.status !== 0) return result('failed', { ...rest, failures: [{ test: '(run)', file: spec.inputs[0] ?? '.', line: 1, stack: stderr.trim() || null, assertion: false, message: `the command exited ${ended.status}` }] });
    return result(tests.length ? 'passed' : 'ran_nothing', rest);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

type Run = (spec: CheckSpec, ctx: CheckContext, fault?: Fault) => CheckResult;
/** The checkout's tree as the run sees it: every path with its kind and bytes (a link, its target), in one digest. */
function snapshot(checkout: string): string {
  const hash = createHash('sha256');
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      hash.update(`\0${relative(checkout, path)}\0`);
      if (entry.isSymbolicLink()) hash.update(`link ${readlinkSync(path)}`);
      else if (entry.isDirectory()) { hash.update('dir'); walk(path); }
      else if (entry.isFile()) { hash.update('file '); hash.update(readFileSync(path)); }
      else hash.update('other');
    }
  };
  walk(checkout);
  return hash.digest('hex');
}

/**
 * One kit's runs, remembered: the planted runners are the reference's result with one fault applied after the
 * run, so a case the reference already ran is answered from that run rather than run again. A run stands for
 * the same spec and fault on a checkout whose every byte is the same, under a deadline it would end the same
 * under (a run that ended within its deadline ends the same under a longer one; a run that overran its deadline
 * overruns a shorter one); anything else is another run. Each caller gets its own copy to bend.
 */
function remembered(): Run {
  const runs = new Map<string, { deadline: number; result: CheckResult }>();
  return (spec, ctx, fault = 'none') => {
    const key = `${fault}\n${ctx.checkout}\n${snapshot(ctx.checkout)}\n${JSON.stringify(spec)}`;
    const had = runs.get(key);
    const stands = had !== undefined && (had.result.outcome === 'overran' ? ctx.deadline <= had.deadline : ctx.deadline >= had.deadline);
    if (had !== undefined && stands) return structuredClone(had.result);
    const result = runCommand(spec, ctx, fault);
    runs.set(key, { deadline: ctx.deadline, result: structuredClone(result) });
    return result;
  };
}

const reference = (run: Run): CheckRunnerFill => ({ slot: CHECK_KIND, revision: 1, kind: KIND, run: (spec, ctx) => run(spec, ctx) });

// ---- The planted runners ------------------------------------------------------------------------------

const plant = (name: string, breaks: keyof typeof RULES, codes: string[], fill: CheckRunnerFill): PlantedFill<CheckRunnerFill> =>
  ({ name, message: RULES[breaks].message, codes, breaks: RULES[breaks].id, fill });
const plantedFills = (run: Run): PlantedFill<CheckRunnerFill>[] => {
  const derived = (bent: (spec: CheckSpec, ctx: CheckContext) => CheckResult): CheckRunnerFill => ({ ...reference(run), run: bent });
  return [
    plant('crashed-suite', 'counts', ['crashed_before_first_assertion'], derived((spec, ctx) => {
      const r = run(spec, ctx);
      // The issue's words: a suite that crashed before its first assertion, reported passed with 12 tests.
      return r.testsRun === 0 && r.failures.some((f) => !f.assertion) ? { ...r, outcome: 'passed', testsRun: 12, failures: [] } : r;
    })),
    plant('past-deadline', 'deadline', ['reported_after_deadline'], derived((spec, ctx) => run(spec, { ...ctx, deadline: 3_600_000 }))),
    plant('dropped-output', 'output', ['output_dropped'], derived((spec, ctx) => ({ ...run(spec, ctx), failures: [] }))),
    plant('type-error-as-assertion', 'assertion', ['type_error_as_assertion'], derived((spec, ctx) => { const r = run(spec, ctx); return { ...r, failures: r.failures.map((f) => ({ ...f, assertion: true })) }; })),
    plant('ignores-mask', 'mask', ['exit_masked'], derived((spec, ctx) => run(spec, ctx, 'ignores-mask'))),
    plant('declared-paths-only', 'reads', ['read_set_incomplete'], derived((spec, ctx) => ({ ...run(spec, ctx), read: [...spec.inputs] }))),
    plant('inherits-host-env', 'hermetic', ['host_env_leaked'], derived((spec, ctx) => run(spec, ctx, 'host-env'))),
  ];
};

// ---- The fixtures and the seeded suites ---------------------------------------------------------------

const spec = (runner: string): CheckSpec => ({ kind: KIND, runner, inputs: ['src/cart.mjs', 'spec/cart.test.mjs'], depth: 'unit', oracle: 'code', contract: null });
const fixture = (id: string, deadline: number, runner: string, expected: Expected, suite = id): Fixture => {
  const input: CheckInput = { spec: spec(runner), checkout: join(FIXTURES, suite), deadline };
  return { id, input: input as unknown as JsonValue, expected: expected as unknown as JsonValue };
};
// In the order the preflight's check meets them, so each planted runner is refused at its first case.
const fixtures: Fixture[] = [
  fixture('hermetic-env', LONG, RUNNER, { outcome: 'passed', testsRun: 2, failures: 0, mask: null, hermetic: true }),
  fixture('fail-elsewhere', LONG, RUNNER, { outcome: 'failed', testsRun: 0, failures: 1, assertion: 'none', mask: null, crash: true }),
  fixture('known-pass', LONG, RUNNER, { outcome: 'passed', testsRun: 2, failures: 0, assertion: 'none', mask: null, reads: ['data/expected.json', 'spec/cart.test.mjs', 'src/cart.mjs'] }),
  fixture('masked-exit', LONG, `${RUNNER} || true`, { outcome: 'uncounted', testsRun: 0, failures: 0, mask: '|| true' }),
  fixture('forced-exit', LONG, `${RUNNER}; false; exit 0`, { outcome: 'uncounted', testsRun: 0, failures: 0, mask: 'exit 0' }, 'known-pass'),
  fixture('piped-exit', LONG, `${RUNNER} | tee /dev/null`, { outcome: 'uncounted', testsRun: 0, failures: 0, mask: '| tee' }, 'known-pass'),
  fixture('untraced-reader', LONG, `cat data/expected.json > /dev/null && ${RUNNER}`, { outcome: 'uncounted', testsRun: 0, failures: 0, mask: 'untraced program cat' }, 'known-pass'),
  fixture('nested-reader', LONG, RUNNER, { outcome: 'uncounted', testsRun: 0, failures: 0, mask: 'untraced program cat' }),
  fixture('detached-child', LONG, RUNNER, { outcome: 'uncounted', testsRun: 0, failures: 0, mask: 'detached node' }),
  fixture('erases-evidence', LONG, RUNNER, { outcome: 'uncounted', mask: 'evidence altered reads' }),
  fixture('copied-reader', LONG, RUNNER, { outcome: 'passed', testsRun: 2, failures: 0, mask: null, reads: ['data/expected.json', 'spec/cart.test.mjs', 'src/cart.mjs'] }),
  fixture('chdir-reader', LONG, RUNNER, { outcome: 'passed', testsRun: 2, failures: 0, mask: null, reads: ['data/expected.json', 'spec/cart.test.mjs', 'src/cart.mjs'] }),
  fixture('symlink-reader', LONG, RUNNER, { outcome: 'passed', testsRun: 2, failures: 0, mask: null, reads: ['data/current.json', 'data/expected.json', 'spec/cart.test.mjs', 'src/cart.mjs'] }),
  fixture('delegated-mask', LONG, 'node run.mjs', { outcome: 'uncounted', testsRun: 0, failures: 0, mask: '|| true' }),
  fixture('redirected-input', LONG, `${RUNNER} < data/expected.json`, { outcome: 'uncounted', testsRun: 0, failures: 0, mask: 'untraced shell input <' }, 'known-pass'),
  fixture('past-deadline', SHORT, RUNNER, { outcome: 'overran' }),
  fixture('known-fail', LONG, RUNNER, { outcome: 'failed', testsRun: 2, failures: 1, assertion: 'all', mask: null }),
  fixture('ran-nothing', LONG, RUNNER, { outcome: 'ran_nothing', testsRun: 0, failures: 0, mask: null }),
];

/** Three suites from the draw, the first with a failing test, each asking a count the fixtures don't. */
function generate(random: Random): SlotCase[] {
  return [0, 1, 2].map((i) => {
    const tests = random.int(1, 4);
    const failing = i === 0 ? random.int(1, tests) : random.int(0, tests);
    const suite: Suite = { tests, failing, nonce: word(random, 8), names: Array.from({ length: tests }, () => word(random, 6)) };
    const expected: Expected = { outcome: failing ? 'failed' : 'passed', testsRun: tests, failures: failing, assertion: failing ? 'all' : 'none', mask: null };
    return { id: `seeded-${i + 1}`, part: 'seeded', input: suite as unknown as JsonValue, expected: expected as unknown as JsonValue };
  });
}

/** Writes a generated suite to a fresh folder: a module, and one test per name, the first `failing` asserting wrong. */
function materialize(suite: Suite): { input: CheckInput; cleanup(): void } {
  const checkout = mkdtempSync(join(tmpdir(), 'deep-check-seeded-'));
  mkdirSync(join(checkout, 'src'));
  mkdirSync(join(checkout, 'spec'));
  writeFileSync(join(checkout, 'src', 'sum.mjs'), `// ${suite.nonce}\nexport const sum = (a, b) => a + b;\n`);
  const tests = suite.names.map((name, i) => `test('${name} ${suite.nonce}', () => {\n  assert.equal(sum(${i}, 1), ${i < suite.failing ? i + 2 : i + 1});\n});\n`).join('\n');
  writeFileSync(join(checkout, 'spec', 'sum.test.mjs'), `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { sum } from '../src/sum.mjs';\n\n${tests}`);
  const input: CheckInput = { spec: { kind: KIND, runner: RUNNER, inputs: ['src/sum.mjs', 'spec/sum.test.mjs'], depth: 'unit', oracle: 'code', contract: null }, checkout, deadline: LONG };
  return { input, cleanup: () => rmSync(checkout, { recursive: true, force: true }) };
}

// ---- The judge -----------------------------------------------------------------------------------------

/** The grace past the deadline before a result is late: the kill and the report take a moment. */
const grace = (deadline: number): number => Math.max(100, deadline);

function hold(answer: unknown, expected: Expected, deadline: number, elapsed: number): void {
  const r = object('the result', answer);
  if ('verdict' in r) throw new Finding('FAIL', 'the result carries a verdict; a runner reports a run outcome and the core matches the place', ['unlisted_field']);
  if (!RUN_OUTCOMES.includes(r.outcome as RunOutcome)) throw new Finding('FAIL', `outcome ${JSON.stringify(r.outcome)} is not one of the run outcomes`, ['enum']);
  const outcome = r.outcome as RunOutcome;
  if (!Number.isInteger(r.testsRun) || (r.testsRun as number) < 0) throw new Finding('FAIL', `testsRun ${JSON.stringify(r.testsRun)} is not a count`, ['type']);
  const failures = list('failures', r.failures).map((f, i) => {
    const o = object(`failures/${i}`, f);
    if (!text(`failures/${i}/file`, o.file)) throw new Finding('FAIL', `failures/${i}/file is empty`, ['type']);
    if (!Number.isInteger(o.line) || (o.line as number) < 1) throw new Finding('FAIL', `failures/${i}/line ${JSON.stringify(o.line)} is not a line`, ['type']);
    if (o.stack !== null && typeof o.stack !== 'string') throw new Finding('FAIL', `failures/${i}/stack is neither a stack nor null`, ['type']);
    if (typeof o.assertion !== 'boolean') throw new Finding('FAIL', `failures/${i}/assertion is not a boolean`, ['type']);
    text(`failures/${i}/test`, o.test);
    text(`failures/${i}/message`, o.message);
    return o as unknown as Failure;
  });
  const read = list('read', r.read).map((p, i) => text(`read/${i}`, p));
  if (read.some((p) => isAbsolute(p) || p.startsWith('..'))) throw new Finding('FAIL', 'read holds a path outside the checkout', ['type']);
  list('evidence', r.evidence);
  if (r.mask !== null && (typeof r.mask !== 'string' || !r.mask)) throw new Finding('FAIL', 'mask is neither null nor the mask named', ['type']);
  // The rules, each in its turn.
  if (elapsed > deadline + grace(deadline) && outcome !== 'overran') throw fail(RULES.deadline.message, ['reported_after_deadline'], `reported ${outcome} ${elapsed} ms in, past the ${deadline} ms deadline`);
  if (expected.mask !== undefined && (expected.mask === null ? r.mask !== null : typeof r.mask !== 'string')) {
    throw fail(RULES.mask.message, ['exit_masked'], expected.mask === null ? `named the mask ${JSON.stringify(r.mask)} in a command with none` : `the command masks its exit with ${expected.mask}`);
  }
  if (outcome !== expected.outcome && expected.hermetic) throw fail(RULES.hermetic.message, ['host_env_leaked'], `the suite that passes only in a cleared environment ${outcome}`);
  if (outcome !== expected.outcome) throw fail(RULES.counts.message, [expected.crash && outcome === 'passed' ? 'crashed_before_first_assertion' : 'run_outcome'], `reported ${outcome}; the run's outcome is ${expected.outcome}`);
  if (expected.testsRun !== undefined && r.testsRun !== expected.testsRun) throw fail(RULES.counts.message, ['tests_run'], `counted ${r.testsRun} tests; the tool ran ${expected.testsRun}`);
  if (expected.failures !== undefined && failures.length !== expected.failures) throw fail(RULES.output.message, ['output_dropped'], `${failures.length} failures in the result; the tool reported ${expected.failures}`);
  if (expected.assertion === 'all' && failures.some((f) => !f.assertion)) throw fail(RULES.assertion.message, ['assertion_from_report'], 'the tool reported assertion failures, the result marks some as other errors');
  if (expected.assertion === 'none' && failures.some((f) => f.assertion)) throw fail(RULES.assertion.message, ['type_error_as_assertion'], `${failures.filter((f) => f.assertion).map((f) => f.test).join(', ')} failed outside any assertion`);
  if (expected.assertion === 'none' && failures.some((f) => typeof f.stack !== 'string')) throw fail(RULES.output.message, ['output_dropped'], 'a caught error lost its stack');
  if (expected.reads) {
    const missing = expected.reads.filter((p) => !read.includes(p));
    if (missing.length) throw fail(RULES.reads.message, ['read_set_incomplete'], `the suite read ${missing.join(', ')}`);
  }
}

function* judge(fill: CheckRunnerFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const made = c.part === 'seeded' ? materialize(c.input as unknown as Suite) : { input: c.input as unknown as CheckInput, cleanup: () => {} };
  const hadSentinel = process.env[SENTINEL];
  process.env[SENTINEL] = 'planted by the kit';
  try {
    const { spec: s, checkout, deadline } = made.input;
    const started = Date.now();
    const answer = yield () => fill.run(s, { checkout, deadline, now: () => Date.now() });
    hold(answer, c.expected as unknown as Expected, deadline, Date.now() - started);
  } finally {
    if (hadSentinel === undefined) delete process.env[SENTINEL]; else process.env[SENTINEL] = hadSentinel;
    made.cleanup();
  }
}

export const checkKindKit = (): SlotKitImpl<CheckRunnerFill> => {
  const run = remembered();
  return { slot: CHECK_KIND, fills: 'one', revision: 1, rules, fixtures, planted: plantedFills(run), clean: () => [reference(run)], generate, judge };
};
