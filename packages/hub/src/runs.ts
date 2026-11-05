// The supervisor's runs (#27, #29, #30): run.start and deep_run's runs, each started through the host with the hub's
// run token, under a `cpu.slot` lease, its output kept as scrubbed evidence; a claim's check through the command check
// kind, or the kind a package installed in its place; a run that needs its folder's stack brings it up first. A
// journal keeps each run until its finish is durable, so a start after a cut finishes or reruns it.
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { runCommandCheck, type CommandRun } from '@deepbuild/checks-command';
import { sha256Hex } from '@deepbuild/contracts';
import type { Evidence, EvidenceStore, PutResult } from '@deepbuild/evidence';
import type { ExtensionHost } from '@deepbuild/extension-host';
import { slot } from '@deepbuild/gate';
import type { LeaseTable } from '@deepbuild/leases';
import { after, type Grant, type Host, type Started, type Supervisor } from '@deepbuild/supervisor';
import type { Up } from '@deepbuild/env-local';
import { words } from './claude-settings.js';
import type { Stacks } from './stacks.js';
import { refusal, Refused, ulid, type Plant } from './wire.js';

type Obj = Record<string, unknown>;
/** A run the supervisor started, as the journal keeps it until its finish is durable; `environment`: it needs its folder's stack running. */
export interface Run { run: string; check: string; claim: string; commit: string; argv: string[]; env: Record<string, string>; cwd: string; grant: Grant; environment?: boolean; lane?: 'fast' | 'slow'; expected_ms?: number | null; deadline?: number;
  /** A claim's check (#30): the command line the command check kind runs in `cwd`, hermetically through host@1; `argv` is what it would be as a shell line. */
  command?: string }
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
  /** The folder the base-commit service keeps its checkouts in; a run there isn't rerun after a cut. */
  checkouts: string;
  now: () => number;
  plant: Plant | undefined;
  held: string[];
  raw(query: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  sync(): Promise<void>;
  appendAsCore(input: { v: number; id: string; kind: string; ts: number; subject?: string; data: Obj }): Promise<void>;
  appendCore(kind: string, data: Obj, extra?: { subject?: string }): Promise<void>;
  stored(put: PutResult, what: string): Promise<Evidence>;
  invalid(claim: string, commit: string, reason: string, outcome?: 'INVALID' | 'INCONCLUSIVE'): Promise<void>;
  /** The gate runner keeps a claim's check run's closed record for its verdict. */
  recorded(run: string, record: CommandRun): void;
  stopping: () => boolean;
  stacks: Stacks;
  store: () => EvidenceStore;
  host: () => Host;
  supervisor: () => Supervisor;
  leases: () => LeaseTable;
  extensions: () => ExtensionHost | undefined;
}

export class Runs {
  /** Each run in flight, by its handle: what it is, its end, and how to stop it. */
  private readonly live = new Map<string, { run: Run; done: Promise<void>; stop(): void }>();
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

  private journal(): Record<string, Run> {
    try {
      return JSON.parse(readFileSync(this.o.journalFile, 'utf8')) as Record<string, Run>;
    } catch {
      return {};
    }
  }
  private writeJournal(update: (runs: Record<string, Run>) => void): void {
    const runs = this.journal();
    update(runs);
    writeFileSync(`${this.o.journalFile}.tmp`, JSON.stringify(runs), { mode: 0o600 });
    renameSync(`${this.o.journalFile}.tmp`, this.o.journalFile);
  }

  /** run.start, and deep_run's runs with the deadline their spec gives, in ms. */
  async start(params: Obj, deadline?: number): Promise<Obj> {
    const { check, claim, commit, argv, env = {}, cwd = process.cwd(), grant = RUN_AS_YOU, environment = false, lane, expected_ms, deadline_ms, command } = params;
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
    const run = await this.launch({
      run: `run:${ulid(this.o.now())}`, check, claim, commit, argv: argv as string[], env: env as Record<string, string>, cwd, grant: grant as Grant, ...(environment ? { environment } : {}),
      ...(lane === 'fast' || lane === 'slow' ? { lane } : {}), ...(typeof expected_ms === 'number' ? { expected_ms } : {}),
      ...(limit ? { deadline: limit } : {}), ...(typeof command === 'string' ? { command } : {}),
    });
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
    await this.o.appendAsCore({
      v: 2, id: ulid(ts), kind: 'run.started', ts, subject: run.run,
      data: { run: run.run, check: run.check, claim: run.claim, commit: run.commit, host: 'local', needs: { cores: 1, memory_mb: 0, stack_slot: run.environment ? 1 : 0, gpus: 0, expected_ms: run.expected_ms ?? null }, lane: run.lane ?? 'slow' },
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
      ended = replaced().then(async (byPackage): Promise<{ code: number | null; record: CommandRun }> => {
        if (!byPackage) {
          const record = await runCommandCheck({ host: this.o.host(), run: run.run, spec, checkout: run.cwd, deadline, env, stop: controller.signal });
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
        this.o.recorded(run.run, record);
        const outcome = record.outcome;
        const findings = outcome === 'stopped' ? ['hub stopped'] : record.mask !== null ? [`uncounted: ${record.mask}`] : record.failures.slice(0, 20).map((f) => `${f.test} (${f.file}:${f.line}): ${f.message}`);
        // What the kind's result names as its evidence beyond the output (a replacing kind's content keys) is kept with the findings.
        findings.push(...record.evidence.filter((e) => !/^(stdout|stderr) [0-9a-f]{64}$/.test(e)).slice(0, 20));
        const first = record.failures[0];
        await this.finish(run, outcome, findings, evidence, {
          tests_run: record.testsRun, passed: Math.max(0, record.testsRun - new Set(record.failures.map((f) => f.test)).size),
          assertion: first?.assertion ? first.test : null, points_to: first ? `${first.file}:${first.line}` : null,
        });
        return;
      }
      const outcome = this.o.stopping() ? 'stopped' : overran ? 'overran' : missing ? 'missing' : code === 0 ? 'passed' : 'failed';
      const findings = this.o.stopping() ? ['hub stopped'] : overran ? [`still running at its deadline of ${words(run.deadline!)}, so it was stopped`] : missing ? [`its stack never came up: ${missing}`] : failed ? [failed] : [];
      await this.finish(run, outcome, findings, evidence);
    });
    this.live.set(run.run, { run, done, stop });
    void done.finally(() => this.o.leases().release(lease.id, []).catch(() => undefined)).finally(() => this.live.delete(run.run));
    return run.run;
  }
  private async finish(run: Run, outcome: string, findings: string[], evidence: string[], counts: { tests_run: number; passed: number; assertion: string | null; points_to: string | null } = { tests_run: 0, passed: 0, assertion: null, points_to: null }): Promise<void> {
    await this.o.appendCore('run.finished', {
      run: run.run, outcome, tests_run: counts.tests_run, passed: counts.passed, runs: 1, evidence, check: run.check, assertion: counts.assertion, expected: null, actual: null, step: null,
      points_to: counts.points_to, findings, environment: `${process.platform}-${process.arch}`,
    }, { subject: run.run });
    // The journal keeps the run until its finish is durable, so a cut before then reruns it.
    await this.o.sync();
    this.writeJournal((runs) => { delete runs[run.run]; });
  }
  /** After a start with runs still in the journal: each was in flight when the hub stopped without a clean stop. */
  async recover(): Promise<void> {
    const recorded = async (kind: string, run: string) => (await this.o.raw(`SELECT 1 FROM events WHERE kind = ? AND json_extract(data, '$.run') = ? LIMIT 1`, [kind, run.replace(/'/g, "''")])).length > 0;
    for (const run of Object.values(this.journal())) {
      if (await recorded('run.finished', run.run)) {
        this.writeJournal((runs) => { delete runs[run.run]; });
        continue;
      }
      // Its processes were reaped when the supervisor opened.
      if (await recorded('run.started', run.run)) await this.finish(run, 'stopped', ['hub restarted'], []);
      else this.writeJournal((runs) => { delete runs[run.run]; });
      // Its checkout went as the service opened, so it isn't run again where nothing is left: what it would have shown stays unknown.
      if (run.cwd && isUnder(run.cwd, realpathSync(this.o.checkouts))) {
        const [claim] = (await this.o.raw(`SELECT commit_sha, verdict_id FROM claims WHERE id = '${sql(run.claim.slice(6))}'`)) as { commit_sha: string | null; verdict_id: string | null }[];
        // A verdict it already has stands.
        if (!claim?.verdict_id) await this.o.invalid(run.claim, claim?.commit_sha ?? run.commit, `${run.check} was cut short by a hub restart`, 'INCONCLUSIVE');
        continue;
      }
      // Its claim's check runs again.
      await this.launch({ ...run, run: `run:${ulid(this.o.now())}`, cwd: run.cwd ?? process.cwd(), grant: run.grant ?? RUN_AS_YOU });
    }
  }
}
