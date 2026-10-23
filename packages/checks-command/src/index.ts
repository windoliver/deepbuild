// @deepbuild/checks-command: the first-party command check kind (#30). It runs a check's shell command in its
// checkout, hermetically: a cleared environment with allowlisted variables and those the check is given, a home of
// its own, DO_NOT_TRACK=1, and one process per check. It starts, signals and waits for that process only through
// host@1 (#236), whose supervisor sandboxes it, so it builds no sandbox of its own and never learns where it ran.
// It reports a closed run outcome, never a verdict: the exit, the output scrubbed by value before its digest, the
// variables allowed through by name, and from the tools' own reports (Vitest's, Jest's, node:test's, pytest's and
// go test's) the tests that ran,
// every attempt of each, where each failed test failed, the files the run read and a numeric contract's counts.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_RUNTIME, type CheckResult, type CheckRunnerFill, type CheckSpec, type RunOutcome } from '@deepbuild/conformance';
import { scrubValues } from '@deepbuild/evidence';
import type { Exit, Host } from '@deepbuild/supervisor';
import { evidence, goTest, nodeTest, under, vitest, type Ran, type Reported } from './report.js';
import { seededBy, type Seeded } from './seeded.js';
import { filtersIn, GO_TEST, hiddenChild, maskIn, programsIn, untraced, type Spawned } from './shell.js';

export type { Seeded } from './seeded.js';

/** Planted twins the criteria name, selected per check; tests only. */
export type Plant = 'exit-code-only' | 'last-attempt-only' | 'no-do-not-track';
export interface CommandCheck {
  /** Where every start, signal and wait goes. */
  host: Host;
  run: string;
  /** Kind `command`: `runner` is the command line, `inputs` the declared paths. */
  spec: CheckSpec;
  checkout: string;
  /** Ms from the start; past it the run is stopped and ends overran. */
  deadline: number;
  /** Variables passed in for this run, such as NODE_ENV or a leased PORT. */
  env?: Record<string, string>;
  /** Credentials env-local loaded for this check: passed in, and scrubbed from the output by value. */
  secrets?: Record<string, string>;
  /** Hosts the run's grant names, "127.0.0.1:<port>". */
  hosts?: string[];
  /** A numeric contract (#28, the verdict engine's NumericContract): the outputs whose counts the report gives. */
  contract?: { tolerances: { output: string; size: number }[] };
  /** The hub going down: the run is stopped and ends stopped. */
  stop?: AbortSignal;
  plant?: Plant;
}
export interface Attempt { test: string; outcome: 'passed' | 'failed' }
export interface ContractCount { output: string; size: number; compared: number | null; largest_error: number | null }
export interface CommandRun extends CheckResult {
  run: string;
  exit: { code: number | null; signal: NodeJS.Signals | null; cause: 'exit' | 'deadline' | 'stop' } | null;
  /** Scrubbed by value, then digested. */
  output: { stdout: string; stderr: string; sha256: { stdout: string; stderr: string } };
  /** The name of every variable the run's process got, never a value. */
  env: string[];
  /** Every attempt the tool's report lists. */
  attempts: Attempt[];
  /** The flag that turned the tool's own retries off, for a tool whose report can't list attempts; null when it can. */
  retries: string | null;
  seeded: Seeded[];
  /** Per output of the contract, from the tool's report; null without a contract. */
  contract: ContractCount[] | null;
  /** Ms the run's clock was moved ahead. */
  clock: number;
}

const RUNTIME = fileURLToPath(new URL('../runtime/', import.meta.url));
/**
 * The locale and zone every run gets, whatever the host's: a pass can't lean on your machine's. CI, so a tool never
 * writes an expected value it lacks (a missing snapshot) from what the program gives and passes on it.
 */
const FIXED = { LANG: 'en_US.UTF-8', TZ: 'UTC', CI: 'true' };
/** The Node the hub runs on, and its package managers: a run's own bin folder links these, never the folder's other programs. */
const NODE_BIN = dirname(process.execPath);
const TOOLS = ['node', 'npm', 'npx'];
/** Where a run's programs are: its own bin folder, then the system's. */
const SYSTEM = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];
const pathOf = (bin: string): string => [bin, ...SYSTEM].join(':');
/** What marks a folder as one program's own install: a package, a Go tree, a conda base, a venv, Python's library. */
const INSTALLS = (name: string): string[] => ['package.json', 'pkg/tool', 'conda-meta', 'pyvenv.cfg', `lib/${name}`];
/**
 * What the run may read to run a program whose real file is `real`: the folder it's installed in, where that folder is
 * the program's own install, else the program alone: a shared
 * `bin` folder's parent holds other things. Never `/`, the home folder or one above it.
 */
const broad = (root: string): boolean => root === '/' || [homedir(), userInfo().homedir].some((home) => `${home}/`.startsWith(`${root}/`));
function installOf(real: string): string {
  const root = dirname(dirname(real));
  const own = !broad(root) && INSTALLS(basename(real)).some((m) => existsSync(join(root, m)));
  return own ? root : real;
}
const PYTHON_FILE = /^python\d+(\.\d+)*$/;
/** A `#!` script's interpreter, by its absolute path, or null. */
function interpreterOf(path: string): string | null {
  try {
    const head = readFileSync(path, 'latin1').slice(0, 200).split('\n')[0] ?? '';
    const first = head.startsWith('#!') ? head.slice(2).trim().split(/\s+/)[0] : undefined;
    return first?.startsWith('/') && existsSync(first) ? first : null;
  } catch { return null; }
}
/**
 * The programs the command itself names that the hub has outside the system's folders (python3, pnpm, go), linked by
 * their real paths into the run's bin folder, with what the run may read to run them (`installOf`); and for a
 * program named by its path (a venv's python in the checkout, a script it installed), the install of the Python it
 * runs on. A program the hub finds
 * in a venv isn't linked: by its real file it would run without the venv. It's named in `refused`.
 */
function linkPrograms(runner: string, checkout: string, bin: string): { roots: string[]; refused: string[] } {
  const roots: string[] = [];
  const refused: string[] = [];
  for (const name of programsIn(runner)) {
    if (name.includes('/')) {
      // A link or a `#!` line in the checkout can point anywhere: only a Python it comes to gets its install.
      const at = resolve(checkout, name);
      if (!existsSync(at)) continue;
      for (const p of [at, interpreterOf(at)]) {
        const real = p && realpathSync(p);
        if (real && PYTHON_FILE.test(basename(real)) && statSync(real).isFile()) roots.push(installOf(real));
      }
      continue;
    }
    if (existsSync(join(bin, name))) continue;
    const dir = (process.env.PATH ?? '').split(':').find((d) => d && !SYSTEM.includes(d) && existsSync(join(d, name)));
    if (!dir) continue;
    if (existsSync(join(dir, '..', 'pyvenv.cfg'))) { refused.push(name); continue; }
    const real = realpathSync(join(dir, name));
    if (!statSync(real).isFile()) continue;
    symlinkSync(real, join(bin, name));
    roots.push(installOf(real));
  }
  return { roots, refused };
}
/** The pytest reporter and Python's read tracer. */
const PYTHON_RUNTIME = join(RUNTIME, 'python');
const MONTH = 30 * 86_400_000;
/** How long a stopped run's tool gets to hand its last results to its report before its group is killed: Vitest sends them every 100 ms. */
const SETTLE_MS = 500;

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A run handle, `run:<ULID>`. */
function runHandle(): string {
  let id = '';
  for (let t = BigInt(Date.now()), i = 0; i < 10; i++, t >>= 5n) id = CROCKFORD[Number(t & 31n)] + id;
  for (const byte of randomBytes(16)) id += CROCKFORD[byte & 31];
  return `run:${id}`;
}

/** Runs one command check. */
export async function runCommandCheck(check: CommandCheck): Promise<CommandRun> {
  return (await runOnce(check, 0)).run;
}

/** Five runs of the full suite on today's clock, then one with the clock a month ahead; a run in which any of `tests` ran no test ran nothing for it. */
export async function runAddedTests(check: CommandCheck, tests: string[]): Promise<CommandRun[]> {
  const runs: CommandRun[] = [];
  for (const [i, clock] of [0, 0, 0, 0, 0, MONTH].entries()) {
    const { run, ran } = await runOnce({ ...check, run: i === 0 ? check.run : runHandle() }, clock);
    const missed = tests.filter((file) => !ran.some((t) => t.file === file));
    // A run that didn't pass keeps its own outcome; a pass that never ran an added file ran nothing for it.
    runs.push(missed.length && run.outcome === 'passed' ? { ...run, outcome: 'ran_nothing', evidence: [...run.evidence, ...missed.map((file) => `no test ran in ${file}`)] } : run);
  }
  return runs;
}

/** The check.kind@1 fill (#13, kit from #314) for the kind `command`, on `host`. */
export function commandCheckKind(host: Host): CheckRunnerFill {
  return {
    slot: 'check.kind@1', revision: 1, kind: 'command',
    run: async (spec, ctx) => {
      const r = await runCommandCheck({ host, run: runHandle(), spec, checkout: ctx.checkout, deadline: ctx.deadline });
      return { outcome: r.outcome, testsRun: r.testsRun, failures: r.failures, evidence: r.evidence, read: r.read, mask: r.mask };
    },
  };
}

async function runOnce(check: CommandCheck, clock: number): Promise<{ run: CommandRun; ran: Ran[] }> {
  const { host, run, spec, plant } = check;
  const secrets = check.secrets ?? {};
  const empty = { stdout: '', stderr: '', sha256: { stdout: sha256(''), stderr: sha256('') } };
  const result = (outcome: RunOutcome, rest: Partial<CommandRun> = {}): CommandRun => ({
    run, outcome, testsRun: 0, failures: [], evidence: [], read: [], mask: null, exit: null, output: empty, env: [], attempts: [], retries: null, seeded: [],
    contract: check.contract ? check.contract.tolerances.map((t) => ({ output: t.output, size: t.size, compared: null, largest_error: null })) : null, clock, ...rest,
  });
  const mask = maskIn(spec.runner);
  if (mask !== null && plant !== 'exit-code-only') return { run: result('uncounted', { mask }), ran: [] };
  if (!existsSync(check.checkout)) return { run: result('missing'), ran: [] };
  // The tracer and the reporters name files by their real paths; a checkout reached through a link is compared by its real path too.
  const checkout = realpathSync(check.checkout);

  // The run's own folder, its temp folder: its home, its programs, and the evidence files its processes write (where
  // check.kind@1's erases-evidence case looks for them: a suite that alters them is found out by their trailers).
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'deep-check-')));
  let kill: NodeJS.Timeout | undefined;
  try {
    const bin = join(temp, 'bin');
    mkdirSync(bin);
    for (const tool of TOOLS) if (existsSync(join(NODE_BIN, tool))) symlinkSync(realpathSync(join(NODE_BIN, tool)), join(bin, tool));
    const { roots, refused } = linkPrograms(spec.runner, checkout, bin);
    const PATH = pathOf(bin);
    const go = GO_TEST.test(spec.runner);
    const filters = filtersIn(spec.runner);
    // Vitest reports its pattern's source, in which a `/` the command gave is escaped.
    const named = (filter: string): boolean => [...filters].some((v) => v === filter || v.replaceAll('/', '\\/') === filter);
    if (refused.length) return { run: result('uncounted', { mask: `venv ${refused[0]}: name the venv's program by its path` }), ran: [] };
    const hidden = plant === 'exit-code-only' ? null : untraced(spec.runner, checkout, PATH, { writable: [checkout, temp] });
    if (hidden !== null) return { run: result('uncounted', { mask: `untraced ${hidden}` }), ran: [] };
    const work = mkdtempSync(join(temp, 'deep-check-run-'));
    const files = { reads: join(work, 'reads.txt'), spawns: join(work, 'spawns.jsonl'), node: join(work, 'report.jsonl'), vitest: join(work, 'vitest.jsonl') };
    mkdirSync(join(temp, 'home'));
    const token = randomBytes(24).toString('base64url');
    const env: Record<string, string> = {
      // What the check is given first: none of it can take the place of what makes the run hermetic.
      ...check.env, ...secrets, ...FIXED,
      // Plain text output, so a stored line reads as the tool wrote it, whatever the tool guesses about its terminal.
      PATH, HOME: join(temp, 'home'), TMPDIR: temp, NO_COLOR: '1', ...(plant === 'no-do-not-track' ? {} : { DO_NOT_TRACK: '1' }),
      DEEP_CHECK_READS: files.reads, DEEP_CHECK_SPAWNS: files.spawns, DEEP_CHECK_REPORT: files.vitest, DEEP_CHECK_CLOCK_MS: String(clock),
      // The preload first, so it takes the report's name before the tracer hides the runner's variables from the run.
      NODE_OPTIONS: `--import=${join(RUNTIME, 'preload.mjs')} --import=${join(CHECK_RUNTIME, 'tracer.mjs')} --test-reporter=spec --test-reporter-destination=stdout --test-reporter=${join(CHECK_RUNTIME, 'reporter.mjs')} --test-reporter-destination=${files.node}`,
      // Python loads the runner's read tracer and pytest its reporter; the check's own entries follow.
      PYTHONPATH: [PYTHON_RUNTIME, check.env?.PYTHONPATH].filter(Boolean).join(':'),
      PYTEST_PLUGINS: ['deep_check_pytest', check.env?.PYTEST_PLUGINS].filter(Boolean).join(','),
      // Python's compiled files go to the run's own folder: one the checkout holds, never checked against its source, isn't run.
      PYTHONPYCACHEPREFIX: join(temp, 'pycache'),
      ...(go ? { GOFLAGS: ['-json', check.env?.GOFLAGS].filter(Boolean).join(' ') } : {}),
      DEEP_RUN_TOKEN: token,
    };
    const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    let cause = 'exit' as 'exit' | 'deadline' | 'stop';
    const started = host.start({
      run, argv: ['/bin/sh', '-c', spec.runner], cwd: checkout, env, inherit: false,
      // Its checkout and its temp folder are its own; it reads the Node it runs on, the programs it names and the runner's loaders.
      grant: { read: [dirname(NODE_BIN), CHECK_RUNTIME, RUNTIME, ...roots], write: [checkout, temp], ...(check.hosts?.length ? { hosts: check.hosts } : {}) },
      output: { stdout: (c) => chunks.stdout.push(c), stderr: (c) => chunks.stderr.push(c) },
    });
    // The deadline, or the hub going down, stops the run's process group through host@1, once its tool has had a
    // moment to report the tests that ended.
    const halt = (why: 'deadline' | 'stop'): void => {
      if (cause !== 'exit') return;
      cause = why;
      kill = setTimeout(() => void started.then((s) => (s.status === 'started' ? host.signal(run, 'SIGKILL') : undefined)).catch(() => undefined), SETTLE_MS);
    };
    let timer: NodeJS.Timeout | undefined;
    const onStop = (): void => halt('stop');
    if (check.stop?.aborted) halt('stop');
    check.stop?.addEventListener('abort', onStop);
    let exit: Exit | null = null;
    let failed: string | null = null;
    try {
      const s = await started;
      if (s.status === 'started') {
        // The deadline counts from the process's start, not from the wait for its sandbox or a lease.
        timer = setTimeout(() => halt('deadline'), Math.max(1, check.deadline));
        exit = await host.wait(run);
        // Nothing the run started outlives it: what it left running is stopped through host@1 too.
        await host.signal(run, 'SIGKILL').catch(() => undefined);
      } else failed = `BLOCKED: no ${s.kind} free`;
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
      check.stop?.removeEventListener('abort', onStop);
    }

    // Everything kept of the run, scrubbed by value of everything it was given that marks a secret, the output before its digest.
    const scrub = (text: string): string => scrubValues(String(text), { env: { ...check.env, ...secrets }, held: [...Object.values(secrets), token] });
    const scrubbed = (r: CommandRun): CommandRun => ({
      ...r, mask: r.mask === null ? null : scrub(r.mask), evidence: r.evidence.map(scrub), attempts: r.attempts.map((a) => ({ ...a, test: scrub(a.test) })),
      failures: r.failures.map((f) => ({ ...f, test: scrub(f.test), message: scrub(f.message), stack: f.stack === null ? null : scrub(f.stack) })),
    });
    const done = (outcome: RunOutcome, rest: Partial<CommandRun>, ran: Ran[]): { run: CommandRun; ran: Ran[] } => ({ run: scrubbed(result(outcome, rest)), ran });
    const stdout = scrub(Buffer.concat(chunks.stdout).toString('utf8'));
    const stderr = scrub(Buffer.concat(chunks.stderr).toString('utf8'));
    const output = { stdout, stderr, sha256: { stdout: sha256(stdout), stderr: sha256(stderr) } };
    const ended = { output, env: Object.keys(env).sort(), exit: exit ? { code: exit.code, signal: exit.signal, cause } : null, evidence: [`stdout ${output.sha256.stdout}`, `stderr ${output.sha256.stderr}`] };
    if (failed !== null) return done('missing', { ...ended, failures: [{ test: '(run)', file: spec.inputs[0] ?? '.', line: 1, stack: null, assertion: false, message: failed }] }, []);

    // The evidence files are the runner's, but the run could write them: a line no reporter wrote that breaks a
    // reading leaves the run uncounted, as a stray line does, never ended without a record.
    try {
      const reads = evidence(files.reads);
      const spawns = evidence(files.spawns);
      const nodeReport = evidence(files.node);
      const vitestReport = evidence(files.vitest, true);
      const reported: Reported[] = [
        ...(nodeReport ? [nodeTest(nodeReport.lines, checkout, stderr)] : []),
        ...(vitestReport ? [vitest(vitestReport.lines, checkout, plant === 'last-attempt-only', named)] : []),
        ...(go ? [goTest(stdout, checkout)] : []),
      ];
      const malformed = reported.reduce((n, r) => n + r.malformed, 0);
      const ran = reported.flatMap((r) => r.ran);
      const failures = reported.flatMap((r) => r.failures);
      const read = new Set<string>();
      for (const path of new Set(reads?.lines ?? [])) { const rel = under(checkout, path); if (rel) read.add(rel); }
      for (const t of ran) if (t.file) read.add(t.file);
      const readSet = [...read].sort();
      const counts = (output: string): { compared: number | null; largest_error: number | null } => {
        const given = ran.map((t) => (t.meta.contract as Record<string, { compared?: unknown; largest_error?: unknown }> | undefined)?.[output]).filter((c) => c !== undefined);
        const numbers = (key: 'compared' | 'largest_error') => given.map((c) => c[key]).filter((v): v is number => typeof v === 'number');
        const compared = numbers('compared');
        const largest = numbers('largest_error');
        return { compared: compared.length ? compared.reduce((a, b) => a + b, 0) : null, largest_error: largest.length ? Math.max(...largest) : null };
      };
      const rest: Partial<CommandRun> = {
        ...ended, testsRun: ran.length, failures, read: readSet, seeded: seededBy(checkout, readSet),
        attempts: ran.flatMap((t) => t.attempts.map((outcome) => ({ test: t.test, outcome }))),
        contract: check.contract ? check.contract.tolerances.map((t) => ({ output: t.output, size: t.size, ...counts(t.output) })) : null,
      };
      const code = exit!.code;
      if (cause === 'deadline') return done('overran', rest, ran);
      if (cause === 'stop') return done('stopped', rest, ran);
      if (plant === 'exit-code-only') return done(code === 0 ? 'passed' : 'failed', { ...rest, mask }, ran);
      // A program the run started that the tracer can't see into, or a child outside its group, leaves it uncounted.
      for (const spawned of spawns?.lines ?? []) {
        let child: Spawned;
        try { child = JSON.parse(spawned) as Spawned; } catch { continue; }
        if (typeof child.file !== 'string') continue;
        const why = hiddenChild(child, checkout, `${join(checkout, 'node_modules/.bin')}:${PATH}`, process.execPath, [checkout, temp]);
        // Uncounted, it counts no test either way.
        if (why !== null) return done('uncounted', { ...ended, mask: why, evidence: [...ended.evidence, `a child of the run: ${[child.file, ...child.args].join(' ')}`] }, []);
      }
      if (code === 127) return done('missing', rest, ran);
      // A run that ended on its own left every evidence file whole, or the suite got at the runner's record. A go
      // test run may start no traced process, so leave no trace: it can't pass anyway.
      const absent = go ? null : { altered: 'no trailer' };
      for (const [name, file] of [['reads', reads ?? absent], ['spawns', spawns ?? absent], ['report', nodeReport], ['vitest report', vitestReport]] as const) {
        if (file?.altered) return done('uncounted', { ...rest, mask: `evidence altered ${name}`, evidence: [...ended.evidence, `${name}: ${file.altered}`] }, ran);
      }
      if (malformed) return done('uncounted', { ...rest, mask: 'evidence altered report', evidence: [...ended.evidence, `report: ${malformed} lines its reporter didn't write`] }, ran);
      if (failures.length) return done('failed', rest, ran);
      // A crash of what the check runs, or any other failing exit: a failed run.
      if (code !== 0 || exit!.signal !== null) {
        const message = exit!.signal !== null ? `the command was killed by ${exit!.signal}` : `the command exited ${code}`;
        return done('failed', { ...rest, failures: [{ test: '(run)', file: spec.inputs[0] ?? '.', line: 1, stack: stderr.trim() || null, assertion: false, message }] }, ran);
      }
      // go test's reads reach no read set: its run can fail, never pass.
      if (go && ran.length) return done('uncounted', { ...rest, mask: 'untraced program go' }, ran);
      return done(ran.length ? 'passed' : 'ran_nothing', rest, ran);
    } catch (error) {
      const why = `evidence unreadable: ${error instanceof Error ? error.message : String(error)}`;
      if (cause !== 'exit') return done(cause === 'deadline' ? 'overran' : 'stopped', { ...ended, evidence: [...ended.evidence, why] }, []);
      return done('uncounted', { ...ended, mask: 'evidence altered report', evidence: [...ended.evidence, why] }, []);
    }
  } finally {
    clearTimeout(kill);
    rmSync(temp, { recursive: true, force: true });
  }
}
