// The supervisor's runs (#27, #29, #30): run.start and deep_run's runs, each started through the host with the hub's
// run token, under a `cpu.slot` lease, its output kept as scrubbed evidence; a claim's check through the command check
// kind, or the kind a package installed in its place; a run that needs its folder's stack brings it up first. A
// journal keeps each run until its finish is durable, so a start after a cut finishes or reruns it.
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, relative } from 'node:path';
import { runCommandCheck, type CommandRun } from '@deepbuild/checks-command';
import { sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { scrubText, type Evidence, type EvidenceStore, type PutResult } from '@deepbuild/evidence';
import type { CheckResult } from '@deepbuild/conformance';
import type { ExtensionHost } from '@deepbuild/extension-host';
import { slot } from '@deepbuild/gate';
import type { LeaseTable } from '@deepbuild/leases';
import { after, type Grant, type Host, type Started, type Supervisor } from '@deepbuild/supervisor';
import type { Up } from '@deepbuild/env-local';
import { words } from './claude-settings.js';
import type { RunKey } from './gate-runner.js';
import { FINDINGS, findingOf, type KeyFacts } from './shared-runs.js';
import type { StackWant, Stacks } from './stacks.js';
import { keepAside, writeSynced } from './vfs.js';
import { refusal, Refused, ulid, type Plant } from './wire.js';

type Obj = Record<string, unknown>;
/** A run the supervisor started, as the journal keeps it until its finish is durable; `environment`: it needs its folder's stack running. */
export interface Run { run: string; check: string; claim: string; commit: string; argv: string[]; env: Record<string, string>; cwd: string; grant: Grant; environment?: boolean; /** A claim's check that needs the app: it runs on the worktree's warm stack (#580). */ stack?: StackWant; lane?: 'fast' | 'slow'; expected_ms?: number | null; deadline?: number;
  /** A claim's check (#30): the command line the command check kind runs in `cwd`, hermetically through host@1; `argv` is what it would be as a shell line. */
  command?: string;
  /** Named command stand-ins in base runs (#874). */
  stand_ins?: string[];
  /** What its key is made of (#1018): a gate run's, kept with its finish so any claim with an equal key reads it. */
  key?: RunKey;
  /** Recovered runs with withheld environment values cannot run again unchanged (#996). */
  withheld?: string[];
  /** A claim's check of a kind other than command (#1537): check@1's spec, run through the kinds the hub holds. */
  spec?: Obj }
/**
 * How long a claim's check runs when its definition names no deadline: a day, so a run no tool ends is still stopped and
 * recorded overran. Spec-draft sets a check's own deadline from the time it took when drafted (#30); until it does, this stands.
 */
const CHECK_DEADLINE_MS = 24 * 3_600_000;
/** What a run gets when run.start names no grant: your files and programs, as you, in the sandbox all the same (Access: run-as-you). */
export const RUN_AS_YOU: Grant = { run_as_you: true };
const GRANT_LISTS = ['read', 'write', 'hosts', 'sockets'] as const;
/** How long a run stopped at its deadline gets to end on SIGTERM before SIGKILL. */
const RUN_KILL_GRACE_MS = 10_000;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const sql = (text: string): string => text.replace(/'/g, "''");
const letters = (session: string): string => session.replace(/[^0-9A-Za-z]/g, '');
const isUnder = (path: string, dir: string) => {
  const rel = relative(dir, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

export interface RunsOptions {
  /** The journal file: each run started and not yet durably finished. */
  journalFile: string;
  point(): void;
  /** The folder the base-commit service keeps its checkouts in; a run there isn't rerun after a cut. */
  checkouts: string;
  now: () => number;
  plant: Plant | undefined;
  held: string[];
  raw(query: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  sync(): Promise<void>;
  appendAsCore(input: { v: number; id: string; kind: string; ts: number; subject?: string; data: Obj }): Promise<void>;
  appendCore(kind: string, data: Obj, extra?: { subject?: string; v?: number }): Promise<void>;
  stored(put: PutResult, what: string): Promise<Evidence>;
  invalid(claim: string, commit: string, reason: string, outcome?: 'INVALID' | 'INCONCLUSIVE'): Promise<void>;
  /** The gate runner keeps a claim's check run's closed record for its verdict. */
  recorded(run: string, record: CommandRun): CommandRun;
  /** The gate runner keys a run once it has ended (#1018): what run.finished keeps of its key. */
  keyed(key: RunKey, run: string, record: CommandRun): Promise<KeyFacts>;
  stopping: () => boolean;
  stacks: Stacks;
  store: () => EvidenceStore;
  host: () => Host;
  supervisor: () => Supervisor;
  leases: () => LeaseTable;
  extensions: () => ExtensionHost | undefined;
  /** One run of a held kind's check (#1537): its result as check.kind@1's, for the run's claim, ended by `stop`. */
  kind(run: Run, checkout: string, deadline: number, stop: AbortSignal): Promise<CheckResult>;
}

/**
 * What the record keeps of a run's spec in its run.started@3 (#996): each text as the evidence store would scrub it and
 * within the read cap, each list within its bound. What that changed is named in `withheld` ($NAME for a variable), and
 * a run rebuilt from the record with any of it withheld can't run again as it was.
 */
function recordable(run: Run, held: string[]): { spec: Obj; withheld: string[] } {
  const CAP = 8192;
  const MANY = 65536;
  const withheld: string[] = [];
  const clean = (v: string): string => scrubText(v, { env: run.env, held }).slice(0, CAP);
  const list = (name: string, values: string[], max: number, empty = true): string[] => {
    const kept = values.slice(0, max).map(clean).filter((v) => empty || v);
    if (kept.length !== values.length || kept.some((v, i) => v !== values[i])) withheld.push(name);
    return kept;
  };
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(run.env)) {
    if (/^[^=]+$/.test(k) && k.length <= CAP && clean(v) === v) env[k] = v;
    else withheld.push(`${k.slice(0, CAP - 1)}`);
  }
  const argv = list('argv', run.argv, MANY);
  const cwd = clean(run.cwd);
  if (cwd !== run.cwd) withheld.push('cwd');
  const grant = Object.fromEntries(Object.entries(run.grant).map(([k, v]) => [k, Array.isArray(v) ? list(`grant.${k}`, v, MANY) : v]));
  const command = run.command === undefined ? undefined : clean(run.command);
  if (run.command !== undefined && command !== run.command) withheld.push('command');
  const stand_ins = run.stand_ins && list('stand_ins', run.stand_ins, 1024, false);
  const deadline = run.deadline !== undefined && Number.isFinite(run.deadline) && run.deadline >= 0 ? run.deadline : null;
  if (run.deadline !== undefined && deadline === null) withheld.push('deadline');
  return {
    spec: {
      argv: argv.length ? argv : ['-'], cwd: cwd || '/', env, grant: grant as JsonValue, deadline_ms: deadline,
      ...(command ? { command } : {}), ...(stand_ins ? { stand_ins } : {}),
    },
    withheld: [...new Set(withheld)].slice(0, MANY),
  };
}


export class Runs {
  /** The journal read at start, updated and durably written as a whole. */
  private journal: Record<string, Run> = {};
  /** Each run in flight, by its handle: what it is, its end, and how to stop it. */
  private readonly live = new Map<string, { run: Run; done: Promise<void>; stop(): void }>();
  /** The held-out variants' runs still to finish (#1018), whose findings their finish withholds, keyed or not. */
  private readonly heldOut = new Set<string>();
  constructor(private readonly o: RunsOptions) {}

  /** How many runs are in flight. */
  get size(): number { return this.live.size; }
  /** Resolves once the run has finished and its finish is recorded; at once for a run not in flight. */
  async ended(run: string): Promise<void> { await this.live.get(run)?.done.catch(() => undefined); }
  /** Asks every run in flight to stop. */
  stopAll(): void {
    for (const { stop } of this.live.values()) stop();
  }
  /** Waits up to five seconds for every run in flight to record its finish. */
  async settled(): Promise<void> {
    await Promise.race([Promise.allSettled([...this.live.values()].map((r) => r.done)), new Promise((done) => setTimeout(done, 5000))]);
  }

  /**
   * The journal as this start finds it (#996). One it can't read is kept aside under a name with its time, never read
   * as empty: its runs in flight are rebuilt from their run.started, and one reading names the file.
   */
  async open(): Promise<void> {
    let bytes: Buffer;
    try {
      bytes = readFileSync(this.o.journalFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    try {
      const runs = JSON.parse(bytes.toString('utf8')) as unknown;
      if (isObj(runs)) {
        this.journal = runs as Record<string, Run>;
        return;
      }
    } catch {
      // Damaged: kept aside below.
    }
    const aside = keepAside(this.o.journalFile, bytes, this.o.now());
    // The core's run.started@3 carries what a run runs; an earlier one can't be run again from the record, and no
    // other writer's start or finish counts.
    const rows = (await this.o.raw(`SELECT s.data FROM events s WHERE s.kind = 'run.started' AND s.writer = 'core' AND s.v >= 3 AND NOT EXISTS
      (SELECT 1 FROM events f WHERE f.kind = 'run.finished' AND f.writer = 'core' AND json_extract(f.data, '$.run') = json_extract(s.data, '$.run')) ORDER BY s.log_pos`)) as { data: string }[];
    // The reading first, then the journal written again: a cut in between finds it damaged and rebuilds it again.
    const now = this.o.now();
    await this.o.appendCore('reading.recorded', {
      reading: `reading:${ulid(now)}`, value: rows.length, unit: 'runs rebuilt from the record', as_of: now,
      source: `${basename(this.o.journalFile)} couldn't be read, so it was kept aside as ${basename(aside)}`, n: 1, outside: false,
    });
    this.writeJournal((runs) => {
      for (const row of rows) {
        const d = JSON.parse(row.data) as Obj;
        const needs = (isObj(d.needs) ? d.needs : {}) as Obj;
        runs[String(d.run)] = {
          run: String(d.run), check: String(d.check), claim: String(d.claim), commit: String(d.commit), argv: d.argv as string[], env: d.env as Record<string, string>,
          cwd: String(d.cwd), grant: d.grant as Grant, lane: d.lane === 'fast' ? 'fast' : 'slow', expected_ms: typeof needs.expected_ms === 'number' ? needs.expected_ms : null,
          ...(typeof d.deadline_ms === 'number' ? { deadline: d.deadline_ms } : {}), ...(d.environment === true ? { environment: true } : {}),
          ...(typeof d.command === 'string' ? { command: d.command } : {}), ...(Array.isArray(d.stand_ins) ? { stand_ins: d.stand_ins as string[] } : {}),
          ...(Array.isArray(d.withheld) && d.withheld.length ? { withheld: d.withheld as string[] } : {}),
        };
      }
    });
  }
  /** Changes the journal and writes it whole: a temp file, synced, renamed and its folder synced, one numbered point. */
  private writeJournal(update: (runs: Record<string, Run>) => void): void {
    update(this.journal);
    writeSynced(this.o.journalFile, Buffer.from(JSON.stringify(this.journal)));
    this.o.point();
  }

  /** run.start, and deep_run's runs with the deadline their spec gives, in ms; a gate run's with its key, and whether it's a held-out variant's (#1018); a claim's check that needs the app with its stack (#580). */
  async start(params: Obj, deadline?: number, id?: string, key?: RunKey, heldOut = false, stack?: StackWant): Promise<Obj> {
    const { check, claim, commit, argv, env = {}, cwd = process.cwd(), grant = RUN_AS_YOU, environment = false, lane, expected_ms, deadline_ms, command, stand_ins, spec } = params;
    const limit = deadline ?? (typeof deadline_ms === 'number' ? deadline_ms : undefined);
    if (typeof check !== 'string' || !check) throw new Refused(refusal('required', '/params/check', 'Name the check the run is for.', check));
    if (typeof claim !== 'string' || !/^claim:[0-9A-Za-z]+$/.test(claim)) throw new Refused(refusal('pattern', '/params/claim', 'Name the claim as claim:<id>.', claim));
    if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) throw new Refused(refusal('pattern', '/params/commit', 'Name the commit by its 40-character SHA.', commit));
    if (!Array.isArray(argv) || !argv.length || argv.some((a) => typeof a !== 'string')) throw new Refused(refusal('type', '/params/argv', 'Give the run its program and arguments as strings.', argv));
    if (!isObj(env) || Object.values(env).some((v) => typeof v !== 'string')) throw new Refused(refusal('type', '/params/env', 'Give env as names to string values.', env));
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Refused(refusal('type', '/params/cwd', 'Give the run its folder as an absolute path.', cwd));
    if (!isObj(grant) || Object.keys(grant).some((k) => k !== 'run_as_you' && !(GRANT_LISTS as readonly string[]).includes(k))) {
      throw new Refused(refusal('type', '/params/grant', 'Give the grant as read, write, hosts and sockets lists, or run_as_you.', grant));
    }
    for (const k of GRANT_LISTS) {
      const list = grant[k];
      if (list !== undefined && (!Array.isArray(list) || list.some((v) => typeof v !== 'string' || (k !== 'hosts' && !isAbsolute(v))))) {
        throw new Refused(refusal('type', `/params/grant/${k}`, k === 'hosts' ? 'List hosts as host:port strings.' : 'List absolute paths.', list));
      }
    }
    if (grant.run_as_you !== undefined && typeof grant.run_as_you !== 'boolean') throw new Refused(refusal('type', '/params/grant/run_as_you', 'Give run_as_you as true or false.', grant.run_as_you));
    if (typeof environment !== 'boolean') throw new Refused(refusal('type', '/params/environment', 'Give environment as true when the run needs its folder\'s stack running.', environment));
    const handle = id ?? `run:${ulid(this.o.now())}`;
    if (heldOut) this.heldOut.add(handle);
    const run = await this.launch({
      run: handle, check, claim, commit, argv: argv as string[], env: env as Record<string, string>, cwd, grant: grant as Grant, ...(environment || stack ? { environment: true } : {}), ...(stack ? { stack } : {}),
      ...(lane === 'fast' || lane === 'slow' ? { lane } : {}), ...(typeof expected_ms === 'number' ? { expected_ms } : {}),
      ...(limit ? { deadline: limit } : {}), ...(typeof command === 'string' ? { command } : {}),
      ...(Array.isArray(stand_ins) && stand_ins.every((n) => typeof n === 'string') ? { stand_ins: stand_ins as string[] } : {}),
      ...(key ? { key } : {}), ...(isObj(spec) && typeof command === 'string' ? { spec } : {}),
    }).catch((error: unknown) => { this.heldOut.delete(handle); throw error; });
    return { run };
  }

  /** The session a claim was made in, as a lease holder; the core's own for a claim the record doesn't hold. */
  private async claimSession(claim: string): Promise<string> {
    const [row] = (await this.o.raw(`SELECT session_id FROM events WHERE kind = 'claim.made' AND id = ? LIMIT 1`, [claim.slice(6)])) as { session_id: string | null }[];
    return row?.session_id ? `session:${letters(row.session_id)}` : 'core';
  }
  /** Starts a run through the host, sandboxed, with the hub's run token injected; its output becomes scrubbed evidence. */
  private async launch(run: Run): Promise<string> {
    this.writeJournal((runs) => { runs[run.run] = run; });
    // Every check run takes a `cpu.slot` from the kernel's lease table first, held for the claim's session (#29):
    // at most half the cores run checks, and the slot shows in the lease table under that session. A fast-lane run
    // may take the slot the pool keeps for a held stop's quick checks (#907).
    const holder = await this.claimSession(run.claim);
    const lease = await slot(this.o.leases(), holder, run.run, run.lane === 'fast' ? 'fast' : 'slow');
    // Where it runs and what it needs (#29), so a later placement can pick any host from the same record.
    const ts = this.o.now();
    const { spec, withheld } = recordable(run, this.o.held);
    await this.o.appendAsCore({
      v: 3, id: ulid(ts), kind: 'run.started', ts, subject: run.run,
      data: {
        run: run.run, check: run.check, claim: run.claim, commit: run.commit, host: 'local', needs: { cores: 1, memory_mb: 0, stack_slot: run.environment ? 1 : 0, gpus: 0, expected_ms: run.expected_ms ?? null }, lane: run.lane ?? 'slow',
        // What it runs (#996): a journal that can't be read is rebuilt from it.
        ...spec, withheld, ...(run.environment ? { environment: true } : {}),
      },
    }).catch(async (error: unknown) => {
      // A start the record refused never ran: it leaves neither its slot nor the journal, and the refusal is what's thrown.
      await this.o.leases().release(lease.id, []).catch(() => undefined);
      try { this.writeJournal((runs) => { delete runs[run.run]; }); } catch { /* the restart's recovery finds no start for it */ }
      throw error;
    });
    const token = randomBytes(24).toString('base64url');
    const env = { ...run.env, DEEP_RUN_TOKEN: token };
    const values = this.o.plant === 'no-run-values' ? undefined : { env, held: [token, ...this.o.held] };
    const writer = this.o.store().connect({ role: 'deepbuild', via: 'job' });
    const label = { source: run.run, redaction: 'complete' as const, license: { name: 'local', allows: [] }, ...(values ? { run: values } : {}) };
    const sinks = [writer.text({ kind: 'run.stdout', ...label }), writer.text({ kind: 'run.stderr', ...label })];
    let writes = Promise.resolve();
    const output = {
      stdout: (chunk: Buffer) => { writes = writes.then(() => sinks[0]!.write(chunk)); },
      stderr: (chunk: Buffer) => { writes = writes.then(() => sinks[1]!.write(chunk)); },
    };
    let stop: () => void;
    let ended: Promise<{ code: number | null; failed?: string; missing?: string; record?: CommandRun }>;
    if (run.command !== undefined) {
      // A claim's check runs through the command check kind (#30): hermetic, through host@1, with its deadline and the
      // hub going down stopping it; its output, counts, failures, attempts and stand-ins come back as one closed record.
      // A kind a loaded package installed in place of the shipped one (`replaces`, #349) runs it instead, through the
      // extension host, which hands it host@1: its result is check.kind@1's, with no exit, output, attempts or stand-ins.
      const spec = { kind: 'command', runner: run.command, inputs: [run.check], depth: 'unit', oracle: 'code' as const, contract: null };
      const deadline = run.deadline ?? CHECK_DEADLINE_MS;
      const controller = new AbortController();
      stop = () => controller.abort();
      const empty = { stdout: '', stderr: '', sha256: { stdout: sha256Hex(new Uint8Array()), stderr: sha256Hex(new Uint8Array()) } };
      const replaced = async (): Promise<boolean> => (await this.o.extensions()?.checks().catch(() => []) ?? []).some((c) => c.kind === 'command');
      // A check of another kind runs through the table of kinds the hub holds (#1537), within its deadline: its result
      // is check.kind@1's, with no exit, output, attempts or stand-ins, as a replacing package's is.
      if (run.spec) {
        ended = this.o.kind(run, run.cwd, deadline, controller.signal)
          .then((result) => ({ code: null, record: { run: run.run, ...result, exit: null, output: empty, env: [], attempts: [], retries: null, seeded: [], contract: null, timing: null, clock: 0 } as CommandRun }))
          .catch((error: Error) => ({ code: null, failed: error.message }));
      } else ended = replaced().then(async (byPackage): Promise<{ code: number | null; record: CommandRun } | { code: null; missing: string }> => {
        if (!byPackage) {
          // #669's planted runner judges the run by its exit code alone, whatever masks it.
          // #33's planted gate reads every command check's result from its exit status alone.
          const exitOnly = this.o.plant === 'runner-passes-masked-exit' || this.o.plant === 'verdict-from-exit-status' ? { plant: 'exit-code-only' as const } : {};
          // A check that needs the app runs on its stack, started from its checkout once the run may start (#580). What
          // it served is read while it lasts, so a run on another tree, or on an environment that broke its rules, is uncounted.
          const serving = run.stack ? await this.o.stacks.serve({ ...run.stack, run: run.run, claim: run.claim, check: run.check, folder: run.cwd, expected_ms: run.expected_ms ?? null }) : undefined;
          // A stack that never came up is a missing run the gate reads, naming why, so the check is BLOCKED (#33), never left
          // with no run; one the hub's stop cut short is stopped.
          if (serving && 'cause' in serving) {
            const failures = [{ test: '(stack)', file: '.', line: 1, stack: null, assertion: false, message: `its stack never came up: ${serving.cause}` }];
            return { code: null, record: { run: run.run, outcome: this.o.stopping() ? 'stopped' : 'missing', testsRun: 0, failures, evidence: [], read: [], mask: null, exit: null, output: empty, env: [], attempts: [], retries: null, seeded: [], contract: null, timing: null, clock: 0 } as CommandRun };
          }
          const hosts = [...(run.grant.hosts ?? []), ...(serving?.hosts ?? [])];
          let record: CommandRun;
          try {
            record = await runCommandCheck({ host: this.o.host(), run: run.run, spec, checkout: run.cwd, deadline, env: { ...env, ...serving?.env }, ...(hosts.length ? { hosts } : {}), ...(run.stand_ins ? { standIns: run.stand_ins } : {}), stop: controller.signal, ...exitOnly });
          } catch (error) {
            await this.o.stacks.finish(run.run);
            throw error;
          }
          const { uncounted } = await this.o.stacks.finish(run.run);
          // Its retry had no kept product, so a stack that served another tree again leaves the run missing.
          if (uncounted && !this.o.stopping()) record = run.stack?.fresh ? { ...record, outcome: 'missing', mask: `its stack served another tree again: ${uncounted}` } : { ...record, outcome: 'uncounted', mask: uncounted };
          return { code: record.exit?.code ?? null, record };
        }
        const result = await this.o.extensions()!.runCheck('command', spec, { checkout: run.cwd, deadline });
        return { code: null, record: { run: run.run, ...result, exit: null, output: empty, env: [], attempts: [], retries: null, seeded: [], contract: null, timing: null, clock: 0 } };
      }).catch((error: Error) => ({ code: null, failed: error.message }));
    } else if (this.o.plant === 'run-spawns-itself') {
      // The planted wrong program: the hub spawns the run itself, past the host and its sandbox.
      const child = spawn(run.argv[0]!, run.argv.slice(1), { cwd: run.cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout!.on('data', output.stdout);
      child.stderr!.on('data', output.stderr);
      ended = new Promise((done) => {
        child.on('error', (error) => done({ code: null, failed: error.message }));
        child.on('close', (code) => done({ code }));
      });
      stop = () => { try { process.kill(-child.pid!, 'SIGTERM'); } catch { /* gone */ } };
    } else {
      // A run that needs the app has its stack brought up from its own folder first, its check's checkout; a stack
      // that isn't ready makes the run missing, and its own process never starts.
      const forRun = run.environment ? this.o.stacks.forRun(run.cwd, values?.held) : undefined;
      const stackRun = forRun?.run;
      const stack: Promise<Up | undefined> = forRun ? forRun.up : Promise.resolve(undefined);
      const started = stack.then<Started | { run: string; status: 'missing'; cause: string }>(async (up) => {
        if (up?.status === 'BLOCKED') return { run: run.run, status: 'missing', cause: up.cause };
        if (up) {
          // Its database's clone is recorded (#332).
          await this.o.stacks.cloned(run.run, up.stack);
        }
        const ports = Object.entries(up?.stack.ports ?? {});
        const hosts = ports.map(([, port]) => `127.0.0.1:${port}`);
        return this.o.host().start({
          run: run.run, argv: run.argv, cwd: run.cwd, env: { ...env, ...Object.fromEntries(ports.map(([name, port]) => [name, String(port)])) },
          grant: hosts.length ? { ...run.grant, hosts: [...(run.grant.hosts ?? []), ...hosts] } : run.grant, output,
        });
      });
      ended = started.then(async (s) => {
        if (s.status === 'missing') return { code: null, missing: s.cause };
        if (s.status === 'BLOCKED') return { code: null, failed: `BLOCKED: no ${s.kind} free` };
        const exit = await this.o.host().wait(run.run);
        return { code: exit.code };
      }, (error: Error) => ({ code: null, failed: error.message }));
      // The stack goes down once the run has ended, its leases released by its cleanup.
      if (stackRun) ended = ended.then(async (end) => { await this.o.stacks.takeDown(stackRun).catch(() => undefined); return end; });
      stop = () => {
        void started.then(() => this.o.host().signal(run.run, 'SIGTERM')).catch(() => undefined);
        // A run still held on a resource never starts: given up on, its start resolves BLOCKED.
        void this.o.supervisor().status(run.run).then((s) => (s.state === 'held' ? this.o.supervisor().cleanup(run.run) : undefined)).catch(() => undefined);
      };
    }
    // A run still going at its spec's deadline is stopped and ends overran (#27), never passed or failed; the command
    // check kind holds its own runs to theirs.
    let overran = false;
    const disarm = run.deadline && run.command === undefined ? after(run.deadline, () => { overran = true; stop(); setTimeout(() => void this.o.host().signal(run.run, 'SIGKILL').catch(() => undefined), RUN_KILL_GRACE_MS).unref(); }) : undefined;
    const done = ended.then(async ({ code, failed, missing, record }) => {
      disarm?.();
      // What the run left behind is stopped and its leases released before its finish is recorded.
      if (this.o.plant !== 'run-spawns-itself') await this.o.supervisor().cleanup(run.run).catch(() => undefined);
      // The kind's record holds the run's output, scrubbed by value: it goes to the store as the sinks' would.
      if (record) { output.stdout(Buffer.from(record.output.stdout)); output.stderr(Buffer.from(record.output.stderr)); }
      await writes;
      const evidence: string[] = [];
      for (const sink of sinks) {
        const put = await sink.close();
        if (put.status === 'stored') evidence.push((await this.o.stored(put, `${run.run}'s output`)).sha256);
      }
      if (record) {
        // The output's digests are the store's, the same text scrubbed once more by what the hub holds, so the verdict's
        // evidence names what run.finished names.
        const [stdout, stderr] = evidence;
        if (stdout !== undefined && stderr !== undefined) record = { ...record, output: { ...record.output, sha256: { stdout, stderr } } };
        record = this.o.recorded(run.run, record);
        // Its key (#1018), once it has ended: kept with its finish, so any claim with an equal key reads it, after a restart too.
        const key = run.key ? await this.o.keyed(run.key, run.run, record) : undefined;
        const outcome = record.outcome;
        const findings = outcome === 'stopped' ? ['hub stopped'] : record.mask !== null ? [`uncounted: ${record.mask}`] : record.failures.slice(0, FINDINGS).map(findingOf);
        // What the kind's result names as its evidence beyond the output (a replacing kind's content keys) is kept with the findings.
        findings.push(...record.evidence.filter((e) => !/^(stdout|stderr) [0-9a-f]{64}$/.test(e)).slice(0, 20));
        const first = record.failures[0];
        // A held-out variant's run keeps its outcome and counts in the record, never what it failed on: its fixture is unseen.
        const hidden = this.heldOut.delete(run.run) || key?.withheld === true;
        await this.finish(run, outcome, hidden ? (record.failures.length ? ['failed on a held-out variant of its fixtures'] : []) : findings, evidence, {
          tests_run: record.testsRun, passed: Math.max(0, record.testsRun - new Set(record.failures.map((f) => f.test)).size),
          assertion: first?.assertion && !hidden ? first.test : null, points_to: first && !hidden ? `${first.file}:${first.line}` : null,
        }, key);
        return;
      }
      const hidden = this.heldOut.delete(run.run);
      const outcome = this.o.stopping() ? 'stopped' : overran ? 'overran' : missing ? 'missing' : code === 0 ? 'passed' : 'failed';
      const findings = this.o.stopping() ? ['hub stopped'] : overran ? [`still running at its deadline of ${words(run.deadline!)}, so it was stopped`] : missing ? [`its stack never came up: ${missing}`] : failed ? [hidden ? 'failed on a held-out variant of its fixtures' : failed] : [];
      await this.finish(run, outcome, findings, evidence);
    });
    this.live.set(run.run, { run, done, stop });
    void done.finally(() => this.o.leases().release(lease.id, []).catch(() => undefined)).finally(() => this.live.delete(run.run));
    return run.run;
  }
  private async finish(run: Run, outcome: string, findings: string[], evidence: string[], counts: { tests_run: number; passed: number; assertion: string | null; points_to: string | null } = { tests_run: 0, passed: 0, assertion: null, points_to: null }, key?: KeyFacts): Promise<void> {
    await this.o.appendCore('run.finished', {
      run: run.run, outcome, tests_run: counts.tests_run, passed: counts.passed, runs: 1, evidence, check: run.check, assertion: counts.assertion, expected: null, actual: null, step: null,
      points_to: counts.points_to, findings, environment: `${process.platform}-${process.arch}`, ...(key ? { key: { ...key } } : {}),
    }, { subject: run.run, v: 2 });
    // The journal keeps the run until its finish is durable, so a cut before then reruns it.
    await this.o.sync();
    this.writeJournal((runs) => { delete runs[run.run]; });
  }
  /** After a start with runs still in the journal: each was in flight when the hub stopped without a clean stop. */
  async recover(): Promise<void> {
    const recorded = async (kind: string, run: string) => (await this.o.raw(`SELECT 1 FROM events WHERE kind = ? AND json_extract(data, '$.run') = ? LIMIT 1`, [kind, run.replace(/'/g, "''")])).length > 0;
    for (const run of Object.values({ ...this.journal })) {
      if (await recorded('run.finished', run.run)) {
        this.writeJournal((runs) => { delete runs[run.run]; });
        continue;
      }
      // Its processes were reaped when the supervisor opened.
      if (await recorded('run.started', run.run)) await this.finish(run, 'stopped', ['hub restarted'], []);
      else this.writeJournal((runs) => { delete runs[run.run]; });
      // Its checkout went as the service opened, so it isn't run again where nothing is left: what it would have shown stays unknown.
      // One rebuilt without values its environment had can't run again as it was either (#996).
      if (run.withheld?.length || (run.cwd && isUnder(run.cwd, realpathSync(this.o.checkouts)))) {
        const [claim] = (await this.o.raw(`SELECT commit_sha, verdict_id FROM claims WHERE id = '${sql(run.claim.slice(6))}'`)) as { commit_sha: string | null; verdict_id: string | null }[];
        // A verdict it already has stands.
        if (!claim?.verdict_id) await this.o.invalid(run.claim, claim?.commit_sha ?? run.commit, `${run.check} was cut short by a hub restart${run.withheld?.length ? `, and the record doesn't keep its ${run.withheld.join(', ')}` : ''}`, 'INCONCLUSIVE');
        continue;
      }
      // Its claim's check runs again.
      await this.launch({ ...run, run: `run:${ulid(this.o.now())}`, cwd: run.cwd ?? process.cwd(), grant: run.grant ?? RUN_AS_YOU });
    }
  }
}
