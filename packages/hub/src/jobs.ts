// The job API's hub side (#1922): deep_job lists the job kinds installed packages hold, each with the tools that passed
// its qualification and their builds, and runs a kind on a pinned tool as one runner job outside the hub's process.
// The job reads its inputs' bytes, never their paths, names or times; it changes no document, and its result is a
// reading with a receipt, never a verdict.
//
// A run is keyed by hash(tool@version, params, input hashes): the params canonical (keys sorted, every default written
// out, −0 as +0) and each input by its bytes' hash, so a rerun with the same key is a cache hit that reads the stored
// outputs and starts no process. On a miss the tool runs once, and its outputs reach the store, the cache and so an
// item only once every output check of the kind passes; a failed check returns that failure, naming the check, and
// keeps nothing. A paid tool's call waits for one authority ask, whose yes covers that call, or your standing rule for
// that tool up to a price per run; the list names each tool's price (#509). After that gate the run reserves its price
// against every budget that covers it, its tool's budget among them, and is charged once its call starts; a covering
// budget without room holds it BLOCKED with that budget's raise ask. A run its tool's host holds, such as a word an
// engine can't say, is BLOCKED with the host's cause and no ask: you change its inputs, not the host.
//
// A tool that runs off the machine (#1924) takes files only by hash from the evidence store, never by path, under each
// file's origin rule: one an agent put there waits for one ask naming its hash and the tool's host, asked once for that
// pair, and the receipt lists every file sent, by hash and host. One that runs an open model declares its weight files
// by hash and the capabilities its call needs; before each call its host reports both, a mismatch is BLOCKED with an
// unblock ask naming the file or the capability and nothing is sent, and the weight hashes are part of the key.
//
// A tool that calls a provider is never run twice for one key (#1923). It appends its submission key to the key's call
// journal before its request leaves and the provider's task ID when it answers; the hub reads that journal and never
// writes it. A key whose journal holds a call and whose outputs aren't kept made a call the hub can't know the fate
// of: a retry makes no call and is BLOCKED with one unblock ask naming the provider and the key. While a job runs, a
// second request with its key joins it, starting nothing, and a request that is cancelled leaves it; the job stops
// only once no request waits on it. A request whose session closed leaves it too, but the job runs on (#1925).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { PlanInput, PlanStep } from '@deepbuild/asks';
import type { BudgetInput, Outcome, RunRequest } from '@deepbuild/budget';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import type { SendBoundary, SendRequest, Receipt } from '@deepbuild/evidence';
import type { ExtensionHost } from '@deepbuild/extension-host';
import { ulid } from '@deepbuild/record';
import type { RunningJob } from './rows.js';

type Obj = Record<string, unknown>;
type Host = Pick<ExtensionHost, 'jobs' | 'jobParams' | 'runJobTool' | 'jobHostReport' | 'runCheck'>;
type CheckSpec = Parameters<Host['runCheck']>[1];
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
/** Each input's hash by name, a list input's as a list in its order (#154). */
const hashes = (bytes: Record<string, Uint8Array | Uint8Array[]>): Record<string, string | string[]> =>
  Object.fromEntries(Object.entries(bytes).map(([n, b]) => [n, Array.isArray(b) ? b.map(sha256) : sha256(b)]));
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** A tool pinned by name@version: no range, tag or bare name. */
const PINNED = /^[a-z0-9][a-z0-9_-]*@\d+\.\d+\.\d+$/;
const HASH = /^[0-9a-f]{64}$/;
const DAY = 86_400_000;
/** How long the kind's output checks may take, each. */
const CHECK_MS = 60_000;
/** The planted hub job-speech-tools-enum's list of speech's tools in code (#509): the three first-party names, no other. */
const SPEECH_ENUM = ['kokoro@0.9.4', 'platform-say@1.0.0', 'azure-speech@1.0.0'];

export interface JobDeps {
  /** The hub's folder: jobs.json keeps the cache, by key, and your standing rules. */
  root: string;
  now(): number;
  host(): Host | undefined;
  /** Puts an output's bytes in the evidence store as a DeepBuild job's, recorded: their hash. */
  keep(bytes: Uint8Array, source: string): Promise<string>;
  /** Whether the evidence store still holds a hash. */
  has(sha: string): Promise<boolean>;
  /** A file's bytes from the evidence store, by hash, checked against it. */
  read(sha: string): Promise<Uint8Array>;
  /** Records in the evidence store, as an agent's, a file it holds with no record: its origin is unknown. */
  adopt(bytes: Uint8Array): Promise<void>;
  /** The evidence store's send: files by hash only, each under its origin rule, its yes kept per file and destination. */
  send(request: SendRequest, boundary: SendBoundary): Promise<Receipt>;
  /** Raises an ask from one of the job API's sources: its handle. */
  raise(source: 'job.paid' | 'job.send' | 'job.unblock', ask: Obj, plan?: PlanInput): Promise<string>;
  /** Shows a running job's row as it now reads (#1925), or takes it off the list once its tool's run has ended. */
  row(job: RunningJob, running: boolean): void;
  /** The ledger's reserve of a paid run's price against every budget that covers it (#509), none when none does. */
  reserve(run: RunRequest, usd: number, step: PlanStep): Promise<Outcome>;
  /** The ledger's charge of a reserved run's price, once its call starts. */
  charge(run: string, usd: number): Promise<void>;
  /** Your yes to a paid run's ask, approving a budget of that run's price for its tool (#509). */
  approve(ask: string, budget: BudgetInput): Promise<unknown>;
  plant?: string | undefined;
}
interface Cached { outputs: Record<string, string>; build: string | null }
/** A job running for its key (#1923): what it will answer, the requests waiting on it, and its stop. */
interface Running { result: Promise<Obj>; callers: Set<string>; stop: AbortController }
interface Saved { cache: Record<string, Cached>; rules: Record<string, number> }

export class Jobs {
  private saved: Saved;
  /** The authority ask each paid call waits on, by the call's key, and the key each ask is for. */
  private readonly asked = new Map<string, string>();
  private readonly held = new Map<string, string>();
  /** The keys your yes allows, each once. */
  private readonly allowed = new Set<string>();
  /** The ask each file waits on to leave for a tool's host, by its file and destination, and the pair each ask is for. */
  private readonly sendAsks = new Map<string, string>();
  private readonly sendHeld = new Map<string, string>();
  /** The pairs your yes or no answered, until the store keeps the yes or the job is refused on the no. */
  private readonly sendYes = new Set<string>();
  private readonly sendNo = new Set<string>();
  /** The unblock ask each cause raised, so one cause asks once. */
  private readonly unblocks = new Map<string, string>();
  /** The jobs running, by key: a second request with a running job's key joins it and starts nothing (#1923). */
  private readonly running = new Map<string, Running>();
  /** How each waiting request leaves its job when its caller cancels. */
  private readonly leaving = new Map<string, () => void>();
  /**
   * A paid run's ledger run by its key until its call starts, so the room your yes to a raise holds is its own, and the
   * raise ask it waits on until you answer it, so a retry asks nothing again.
   */
  private readonly spending = new Map<string, { run: string; ask?: string; budget?: string }>();
  /** Each paid ask's tool and price, and the budget your yes to it is approving, by key, until the run reserves. */
  private readonly paidAsks = new Map<string, { tool: string; usd: number }>();
  private readonly approving = new Map<string, Promise<unknown>>();
  private anonymous = 0;

  constructor(private readonly d: JobDeps) {
    const file = join(d.root, 'jobs.json');
    this.saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Saved : { cache: {}, rules: {} };
  }
  private save(): void {
    const file = join(this.d.root, 'jobs.json');
    writeFileSync(`${file}.tmp`, `${JSON.stringify(this.saved, null, 2)}\n`);
    renameSync(`${file}.tmp`, file);
  }

  /** deep_job's list: each kind, the package that holds it, and its tools, each with its package, build and price per run (#509), 0 when free. */
  list(): Obj {
    return { kinds: this.kinds().map((k) => ({ kind: k.kind, plugin: k.plugin, tools: k.tools.map((t) => ({ tool: t.tool, plugin: t.plugin, build: t.build, cost: { usd: t.descriptor.cost?.usd ?? 0 } })) })) };
  }
  /** The kinds installed packages hold, with their qualified tools; the planted hub keeps speech's as a list in code. */
  private kinds(): ReturnType<Host['jobs']> {
    const all = this.d.host()?.jobs() ?? [];
    return this.d.plant === 'job-speech-tools-enum' ? all.map((k) => (k.kind === 'speech' ? { ...k, tools: k.tools.filter((t) => SPEECH_ENUM.includes(t.tool)) } : k)) : all;
  }
  /** `job.rule`: your standing rule for a paid tool, the most a run of it may cost with no ask. */
  rule(tool: string, usd: number): Obj {
    this.saved.rules[tool] = usd;
    this.save();
    return { tool, usd };
  }
  /** Your answer to a paid call's authority ask: true when it was one. A yes lets that call run once. */
  answered(ask: string, decision: string): boolean {
    const pair = this.sendHeld.get(ask);
    if (pair !== undefined) {
      this.sendHeld.delete(ask);
      this.sendAsks.delete(pair);
      (decision === 'allow' ? this.sendYes : this.sendNo).add(pair);
      return true;
    }
    // A raise a paid run waits on: the ledger reads your answer from the record, and the run's retry reserves again.
    const raised = [...this.spending.values()].find((s) => s.ask === ask);
    if (raised) {
      delete raised.ask;
      return true;
    }
    const key = this.held.get(ask);
    if (key === undefined) return false;
    this.held.delete(ask);
    this.asked.delete(key);
    if (decision === 'allow') this.allowed.add(key);
    // #509: your yes to a paid run approves a budget of its price for its tool, one run, which its reserve then holds.
    const paid = this.paidAsks.get(ask);
    this.paidAsks.delete(ask);
    if (paid && decision === 'allow') {
      this.approving.set(key, this.d.approve(ask, { scope: { kind: 'resource', ref: paid.tool }, runs: 1, cap_usd: paid.usd, ends: this.d.now() + DAY }).catch(() => undefined));
    }
    return true;
  }

  /**
   * A request's caller gone (#1923): it leaves the job it waits on. A cancelled request's job stops only once no
   * request waits on it, so a joiner's cancel never stops the job for the request that started it. A request whose
   * connection `closed`, its session gone, stops nothing: the job runs on and its row keeps counting (#1925).
   */
  gone(caller: string, closed = false): void {
    this.leaving.get(caller)?.();
    for (const job of this.running.values()) {
      if (!job.callers.delete(caller) || closed) continue;
      if (job.callers.size === 0 || this.d.plant === 'job-joiner-cancels-job') job.stop.abort();
    }
  }

  /** deep_job's run: done with its outputs by hash and a receipt, held on an ask, refused, BLOCKED, or failed naming why. */
  async run(args: Obj, caller: string = `anonymous#${++this.anonymous}`): Promise<Obj> {
    const host = this.d.host();
    const refused = (reason: string): Obj => ({ status: 'refused', reason });
    if (!host) return refused('the hub has no extension host yet; try again once it is ready');
    const { kind, tool, params: text, inputs } = args;
    const held = this.kinds().find((k) => k.kind === kind);
    if (typeof kind !== 'string' || !held) return refused(`no installed package registers the job kind ${String(kind)}`);
    const pinned = held.tools.find((t) => t.tool === tool);
    if (typeof tool !== 'string' || !PINNED.test(tool) || !pinned) {
      return refused(`deep_job runs only a tool of ${kind} pinned by name@version as its list names one (${held.tools.map((t) => t.tool).join(', ') || 'none qualified'}); ${JSON.stringify(tool)} isn't one, and nothing ran`);
    }
    let params: Record<string, JsonValue>;
    try {
      params = host.jobParams(kind, text === null || text === undefined ? {} : JSON.parse(String(text)));
    } catch (e) {
      return refused(`${kind}'s params: ${message(e)}`);
    }
    const declared = Object.keys(held.descriptor.schema.inputs);
    // An input declared `many` (#154) takes its name once per file, in order, and none at all for an empty list.
    const many = (name: string): boolean => held.descriptor.schema.inputs[name]?.many === true;
    const given = Array.isArray(inputs) ? inputs.filter(isObj) : [];
    const url = 'url' in pinned.descriptor.run ? pinned.descriptor.run.url : undefined;
    const where = pinned.host ?? '';
    // Off the machine a file goes only by hash: an input naming a path is refused before any file is read.
    if (url && given.some((i) => i.path !== undefined && i.path !== null)) return refused(`${tool} runs off the machine on ${where}, so it takes files only by hash from the evidence store, as inputs [{name, sha256}], never by path; nothing was read or sent`);
    const bytes: Record<string, Uint8Array | Uint8Array[]> = Object.fromEntries(declared.filter(many).map((n) => [n, []]));
    for (const i of given) {
      const name = String(i.name);
      if (!declared.includes(name) || (bytes[name] && !many(name))) return refused(`${kind} takes the inputs ${declared.join(', ')}, each once; ${JSON.stringify(i.name)} isn't one of them, or comes twice`);
      let file: Uint8Array;
      if (typeof i.sha256 === 'string') {
        if (!HASH.test(i.sha256)) return refused(`the input ${name} names a file by its SHA-256, 64 hex digits`);
        try { file = await this.d.read(i.sha256); } catch (e) { return refused(`the input ${name}: ${message(e)}`); }
        // A file in the store's folder with no record of who put it there, such as the PCM a bake keeps (#1819), is of
        // unknown origin, so the store takes it as an agent's: off the machine it goes only after your yes.
        if (url && !(await this.d.has(i.sha256))) await this.d.adopt(file);
      } else {
        if (typeof i.path !== 'string' || !isAbsolute(i.path)) return refused(`the input ${name} is a file, by its SHA-256 in the evidence store or its absolute path`);
        try { file = new Uint8Array(await readFile(i.path)); } catch (e) { return refused(`the input ${name} can't be read: ${message(e)}`); }
      }
      if (many(name)) (bytes[name] as Uint8Array[]).push(file);
      else bytes[name] = file;
    }
    const missing = declared.filter((n) => !bytes[n]);
    if (missing.length) return refused(`${kind} takes the inputs ${declared.join(', ')}; give ${missing.join(', ')}`);
    const weights = pinned.descriptor.weights;
    const key = this.keyOf(kind, tool, String(text ?? ''), params, bytes, weights);
    let sent: { sha256: string; host: string }[] = [];
    const receipt = (build: string | null, cache: 'hit' | 'miss'): Obj => ({
      kind, tool, key, build, cache, inputs: hashes(bytes),
      ...(url && { sent: cache === 'hit' ? [] : sent }), ...(weights && { weights }),
    });
    const done = (outputs: Record<string, string>, build: string | null, cache: 'hit' | 'miss'): Obj => ({ status: 'done', outputs: Object.fromEntries(Object.entries(outputs).map(([n, sha]) => [n, { sha256: sha }])), receipt: receipt(build, cache) });

    const cached = this.saved.cache[key];
    if (cached && (await Promise.all(Object.values(cached.outputs).map((sha) => this.d.has(sha)))).every(Boolean)) return done(cached.outputs, cached.build, 'hit');

    // A running job with this key: this request joins it, passes no gate, sends nothing and starts nothing. The
    // planted runner job-second-call runs the tool again.
    const running = this.running.get(key);
    if (running && this.d.plant !== 'job-second-call') return this.wait(running, caller, true);
    // A call made for this key, with no job running it and no outputs kept: its answer was lost, and it isn't made again.
    const made = pinned.provider && !running ? this.called(key) : undefined;
    if (made) {
      const journal = this.journal(key);
      return this.blocked(`lost ${key}`, {
        cause: `${tool} sent a paid call for ${kind} to ${made.provider} under the submission key ${key}, and ${made.task ? `${made.provider} answered it as task ${made.task}, but no output of it was kept` : 'its answer never reached DeepBuild'}, so it isn't made again`,
        question: `${tool} sent a paid call for ${kind} to ${made.provider} under the submission key ${key}, and its outputs never reached DeepBuild, so it isn't made again. Find that call at ${made.provider}?`,
        steps: [`Find the call at ${made.provider} by its submission key ${key}, which it was sent with as its Idempotency-Key`, `To pay for it again instead, delete the call journal ${journal} and run the job again`],
        where: `${made.provider}, and this machine's ${journal}`, why: 'a paid call is never made twice, and this one may have run', proves: `the call journal for ${key} deleted`,
      });
    }

    if (url) {
      // The planted hub sends the files before any answer of yours.
      if (this.d.plant === 'job-host-sends-early') await host.runJobTool(tool, kind, params, bytes).catch(() => undefined);
      const gate = await this.gate([...new Set(Object.values(bytes).flat().map(sha256))], where, tool, kind, key);
      if ('reply' in gate) return gate.reply;
      sent = gate.sent;
    }

    const needs = pinned.descriptor.needs ?? [];
    if (url && (weights?.length || needs.length) && this.d.plant !== 'job-weights-call-anyway') {
      let report: Awaited<ReturnType<Host['jobHostReport']>>;
      try {
        report = await host.jobHostReport(tool, kind);
      } catch (e) {
        // A host that can't be reached can't start the job (#1819): BLOCKED, naming the tool, never a result. The
        // planted runner calls it done, each output an empty record.
        if (this.d.plant === 'job-host-down-done') {
          const kept: Record<string, string> = {};
          for (const n of Object.keys(held.descriptor.outputs)) kept[n] = await this.d.keep(new TextEncoder().encode('{}'), `job:${kind}/${tool}#${n}`);
          return done(kept, pinned.build, 'miss');
        }
        return this.blocked(`report ${tool} ${where}`, {
          cause: `${tool} can't start: its host ${where} gave no report of its weights and capabilities (${message(e)})`,
          question: `${tool} can't start for ${kind}: its host ${where} doesn't answer. Start the host?`,
          steps: [`Start ${tool}'s host on ${where}`, `Run the job on ${tool} again`],
          where, why: `${tool} runs only on its host, after the host reports its weights`, proves: `${where} answering /report`,
        });
      }
      const wrong = (weights ?? []).find((w) => !report.weights.some((r) => r.name === w.name && r.sha256 === w.sha256));
      if (wrong) {
        const has = report.weights.find((r) => r.name === wrong.name)?.sha256;
        return this.blocked(`weight ${tool} ${where} ${wrong.name} ${has ?? 'none'}`, {
          cause: `${tool}'s host ${where} ${has ? `holds ${wrong.name} as ${has}` : `holds no ${wrong.name}`}, where ${tool} declares ${wrong.sha256}`,
          question: `${tool} can't run on ${where}: its weight file ${wrong.name} there ${has ? `is ${has}` : 'is missing'}, and ${tool} declares ${wrong.sha256}. Put that file on the host?`,
          steps: [`Put ${wrong.name} with SHA-256 ${wrong.sha256} on ${where}`, `Run the job on ${tool} again`],
          where: where, why: `${tool} runs only the weights it declares, by hash`, proves: `${wrong.name} ${wrong.sha256} on ${where}`,
        });
      }
      const lack = needs.find((n) => !report.capabilities.includes(n));
      if (lack) {
        return this.blocked(`capability ${tool} ${where} ${lack}`, {
          cause: `${tool}'s host ${where} doesn't report the capability ${lack}, which its call needs`,
          question: `${tool} can't run on ${where}: its call needs the capability ${lack}, which the host doesn't report. Give the host ${lack}?`,
          steps: [`Give ${where} the capability ${lack}`, `Run the job on ${tool} again`],
          where: where, why: `${tool}'s call needs ${lack}`, proves: `${lack} on ${where}`,
        });
      }
    }

    // The paid gate comes after the host's report, so your yes isn't spent on a call that can't start; it is spent
    // only once the call does, after its price is reserved.
    const usd = pinned.descriptor.cost?.usd ?? 0;
    let spend: { run: string; usd: number } | undefined;
    if (usd > 0) {
      const ruled = (this.saved.rules[tool] ?? -1) >= usd;
      if (!ruled && !this.allowed.has(key)) return { status: 'held', ask: this.asked.get(key) ?? (await this.ask(kind, tool, usd, key)) };
      await this.approving.get(key);
      this.approving.delete(key);
      const reserved = await this.reserve(kind, tool, usd, key);
      if ('reply' in reserved) return reserved.reply;
      if (!ruled) this.allowed.delete(key);
      // A run no budget covers has nothing reserved, so nothing to charge.
      if (reserved.reserved) spend = { run: reserved.run, usd };
    }

    const stop = new AbortController();
    const job: Running = { callers: new Set(), stop, result: this.call(host, held, pinned, key, params, bytes, receipt, done, stop.signal, spend) };
    this.running.set(key, job);
    void job.result.finally(() => { if (this.running.get(key) === job) this.running.delete(key); });
    return this.wait(job, caller, false);
  }
  /** A request waiting on its job: the job's answer, its receipt saying so when it joined, or `cancelled` once its caller is gone. */
  private wait(job: Running, caller: string, joined: boolean): Promise<Obj> {
    job.callers.add(caller);
    const left = new Promise<Obj>((resolve) => this.leaving.set(caller, () => resolve({ status: 'cancelled', reason: 'the request was cancelled; the job runs on for any other request waiting on it' })));
    const answer = joined ? job.result.then((r) => (isObj(r.receipt) ? { ...r, receipt: { ...r.receipt, joined: true } } : r)) : job.result;
    return Promise.race([answer, left]).finally(() => { this.leaving.delete(caller); job.callers.delete(caller); });
  }
  /** The key's call journal, which its tool appends to and the hub only reads. */
  private journal(key: string): string {
    return join(this.dir(), 'calls', key, 'journal.jsonl');
  }
  /** The call the key's journal says went out, if one did: its provider, and the provider's task ID once it answered. */
  private called(key: string): { provider: string; task?: string } | undefined {
    let text: string;
    try { text = readFileSync(this.journal(key), 'utf8'); } catch { return undefined; }
    let made: { provider: string; task?: string } | undefined;
    for (const line of text.split('\n')) {
      let v: unknown;
      try { v = JSON.parse(line); } catch { continue; }
      if (!isObj(v) || v.key !== key || typeof v.provider !== 'string') continue;
      made = typeof v.task === 'string' ? { provider: v.provider, task: v.task } : made ?? { provider: v.provider };
    }
    return made;
  }
  /**
   * A paid run's price reserved by the ledger against every budget that covers it (#509): a run names its tool as its
   * resource, so a budget for that tool covers it, and it keeps one ledger run for its key until its call starts. A
   * covering budget without room holds it BLOCKED with that budget's raise ask, asked once.
   */
  private async reserve(kind: string, tool: string, usd: number, key: string): Promise<{ run: string; reserved: boolean } | { reply: Obj }> {
    const spend = this.spending.get(key) ?? { run: `run:${ulid(this.d.now())}` };
    this.spending.set(key, spend);
    const short = (budget: string | undefined, ask: string): Obj => ({ status: 'BLOCKED', cause: `${tool}'s price, $${usd} a run, doesn't fit what's left of the budget ${budget ?? 'that covers it'}, counting what's reserved and not yet charged; nothing was sent`, budget: budget ?? null, ask });
    if (spend.ask) return { reply: short(spend.budget, spend.ask) };
    let out: Outcome;
    try {
      out = await this.d.reserve({ run: spend.run, check: `${kind} on ${tool}`, inputs: key, issue: `deep_job ${kind}`, resource: tool }, usd, { does: `Run the paid tool ${tool} once for ${kind}, at $${usd}`, changes: [], undo: null, public: false, cost: usd });
    } catch (e) {
      return { reply: { status: 'refused', reason: `${tool}'s price couldn't be reserved: ${message(e)}; nothing ran` } };
    }
    if (out.status === 'started') {
      this.spending.delete(key);
      return { run: spend.run, reserved: out.reserved.length > 0 };
    }
    if (out.status === 'BLOCKED' && out.cause === 'budget') {
      Object.assign(spend, { ask: out.ask, budget: out.budget });
      return { reply: short(out.budget, out.ask) };
    }
    return { reply: { status: 'BLOCKED', cause: `${tool}'s price wasn't reserved: ${JSON.stringify(out)}; nothing was sent`, ...('ask' in out ? { ask: out.ask } : {}) } };
  }
  /** The tool's one run for a key, its outputs held until the kind's output checks pass, then kept and cached. */
  private async call(host: Host, held: ReturnType<Host['jobs']>[number], pinned: ReturnType<Host['jobs']>[number]['tools'][number], key: string, params: Record<string, JsonValue>, bytes: Record<string, Uint8Array | Uint8Array[]>, receipt: (build: string | null, cache: 'hit' | 'miss') => Obj, done: (outputs: Record<string, string>, build: string | null, cache: 'hit' | 'miss') => Obj, stop: AbortSignal, spend?: { run: string; usd: number }): Promise<Obj> {
    const { kind } = held;
    const { tool } = pinned;
    // While its tool runs, the job has a row that counts from the tool's own counters (#1925). Nothing here waits on
    // the caller, so the job runs on when the app or the session that asked for it closes.
    const job: RunningJob = { key, kind, tool, started: this.d.now() };
    this.d.row(job, true);
    let wrote: Record<string, Uint8Array>;
    try {
      // A paid call is charged its price as it starts: from here it may be spent, whatever it answers.
      if (spend) await this.d.charge(spend.run, spend.usd);
      wrote = await host.runJobTool(tool, kind, params, bytes, pinned.provider ? { key, journal: this.journal(key) } : undefined, stop, (counter) => {
        job.counter = counter;
        job.at = this.d.now();
        this.d.row(job, true);
      });
    } catch (e) {
      // The host holds the run on its inputs (#509), such as a word its engine can't say: BLOCKED with its cause, no ask.
      const blocked = e instanceof Error && e.name === 'JobBlocked' ? (e as { blocked?: unknown }).blocked : undefined;
      if (isObj(blocked)) return { status: 'BLOCKED', cause: blocked, receipt: receipt(pinned.build, 'miss') };
      // An input the tool refuses, such as an unknown voice: refused, naming it.
      if (e instanceof Error && e.name === 'JobRefused') return { status: 'refused', reason: e.message, receipt: receipt(pinned.build, 'miss') };
      return { status: 'failed', reason: `${tool} failed: ${message(e)}; nothing was kept`, receipt: receipt(pinned.build, 'miss') };
    } finally {
      this.d.row(job, false);
    }
    const outputs = Object.keys(held.descriptor.outputs);
    const absent = outputs.filter((n) => !wrote[n]);
    if (absent.length) return { status: 'failed', reason: `${tool} wrote no ${absent.join(', ')}, which ${kind} declares; nothing was kept`, receipt: receipt(pinned.build, 'miss') };
    // Its outputs are held here until every output check passes: before that, no store, no cache, nothing an item can name.
    const encoded = Object.fromEntries(outputs.map((n) => [n, Buffer.from(wrote[n]!).toString('base64')]));
    for (const check of held.descriptor.output_checks) {
      const spec = { kind: check, runner: tool, inputs: [], depth: 'job', oracle: 'code', contract: null, outputs: encoded } as CheckSpec;
      const ran = await host.runCheck(check, spec, { checkout: this.dir(), deadline: CHECK_MS });
      if (ran.outcome !== 'passed') {
        const why = ran.failures.map((f) => f.message).join('; ');
        return { status: 'failed', check, outcome: ran.outcome, reason: `${tool}'s output fails ${kind}'s output check ${check} (${ran.outcome}${why ? `: ${why}` : ''}); nothing was kept, so no item can name it`, receipt: receipt(pinned.build, 'miss') };
      }
    }
    const kept: Record<string, string> = {};
    for (const n of outputs) kept[n] = await this.d.keep(wrote[n]!, `job:${kind}/${tool}#${n}`);
    this.saved.cache[key] = { outputs: kept, build: pinned.build };
    this.save();
    return done(kept, pinned.build, 'miss');
  }
  /**
   * The key: the tool's name@version, the canonical params and each input's hash, and an open model's weight files by
   * hash, so new weights under the same name and version never hit an earlier result; the planted keys break one part each.
   */
  private keyOf(kind: string, tool: string, text: string, params: Record<string, JsonValue>, bytes: Record<string, Uint8Array | Uint8Array[]>, weights?: { name: string; sha256: string }[]): string {
    const key = {
      kind,
      tool: this.d.plant === 'job-key-no-version' ? tool.slice(0, tool.indexOf('@')) : tool,
      params: this.d.plant === 'job-key-params-text' ? text : params,
      inputs: hashes(bytes),
      ...(weights && this.d.plant !== 'job-weights-not-keyed' && { weights: Object.fromEntries(weights.map((w) => [w.name, w.sha256])) }),
    };
    return sha256Hex(canonicalize(key as JsonValue));
  }
  /**
   * The files of a job off the machine through the evidence store's send, each under its origin rule: one an agent put
   * there waits on one ask naming its hash and the host, and your yes is the store's to keep for that pair. Nothing goes
   * here: the files are only collected, and sent by the call once every one may go. The planted hub keeps a yes for one
   * job only, as if each job were its own destination.
   */
  private async gate(files: string[], where: string, tool: string, kind: string, key: string): Promise<{ sent: { sha256: string; host: string }[] } | { reply: Obj }> {
    const destination = this.d.plant === 'job-host-asks-again' ? `${where} ${key}` : where;
    let ask: string | undefined;
    let no: string | undefined;
    const sent: { sha256: string; host: string }[] = [];
    const receipt = await this.d.send({ files, via: 'job', destination }, {
      ask: async (q) => {
        const pair = `${q.sha256} ${destination}`;
        if (this.sendYes.delete(pair)) return true;
        if (this.sendNo.has(pair)) no ??= q.sha256;
        else ask ??= this.sendAsks.get(pair) ?? (await this.askSend(q.sha256, where, tool, kind, pair));
        return false;
      },
      deliver: async (file) => { sent.push({ sha256: file.sha256, host: where }); },
    });
    if (no) return { reply: { status: 'refused', reason: `you declined sending ${no} to ${where}, where ${tool} runs; nothing was sent` } };
    if (ask) return { reply: { status: 'held', ask } };
    if (receipt.withheld.length) return { reply: { status: 'refused', reason: `${receipt.withheld.map((w) => `${w.sha256}: ${w.reason}`).join('; ')}; nothing was sent` } };
    return { sent };
  }
  private async askSend(sha: string, where: string, tool: string, kind: string, pair: string): Promise<string> {
    const ref = sha256Hex(new TextEncoder().encode(pair));
    const ask = await this.d.raise('job.send', {
      kind: 'authority', question: `Send the file ${sha}, which an agent put in the evidence store, to ${where} for ${tool} (${kind})?`,
      options: [{ id: 'send', label: 'Send it', decision: 'allow' }, { id: 'decline', label: "Don't send it", decision: 'deny' }],
      recommended: null, deadline: this.d.now() + DAY, fallback: 'you', default: 'decline', provisional: false, owner: 'you', key: ref, pinned_to: { kind: 'evidence', ref: sha },
    }, { steps: [{ does: `Send the file ${sha}, which an agent put in the evidence store, to ${where}, where ${tool} runs, for this and every later job there`, changes: [], undo: null, public: false, cost: 0 }], diff: ref });
    this.sendAsks.set(pair, ask);
    this.sendHeld.set(ask, pair);
    return ask;
  }
  /** BLOCKED, with one unblock ask for its cause: nothing was sent, and no call made. */
  private async blocked(id: string, a: { cause: string; question: string; steps: string[]; where: string; why: string; proves: string }): Promise<Obj> {
    let ask = this.unblocks.get(id);
    if (!ask) {
      const ref = sha256Hex(new TextEncoder().encode(id));
      ask = await this.d.raise('job.unblock', {
        kind: 'unblock', question: a.question, options: [{ id: 'done', label: 'I did it', decision: 'none' }], recommended: 'done', default: 'done', deadline: this.d.now() + DAY,
        steps: a.steps, where: a.where, why: a.why, unblocks: [`req:${ref.slice(0, 16)}`], proves: a.proves,
        fallback: 'you', provisional: false, owner: 'you', key: ref, pinned_to: { kind: 'evidence', ref },
      });
      this.unblocks.set(id, ask);
    }
    return { status: 'BLOCKED', cause: `${a.cause}; nothing was sent`, ask };
  }
  private async ask(kind: string, tool: string, usd: number, key: string): Promise<string> {
    const ask = await this.d.raise('job.paid', {
      kind: 'authority', question: `Run ${tool} for ${kind} once, at $${usd} a run?`,
      options: [{ id: 'run', label: 'Run it once', decision: 'allow' }, { id: 'decline', label: "Don't run it", decision: 'deny' }],
      recommended: null, deadline: this.d.now() + DAY, fallback: 'you', default: 'decline', provisional: false, owner: 'you', key, pinned_to: { kind: 'evidence', ref: key },
    }, { steps: [{ does: `Run the paid tool ${tool} once for ${kind}, at $${usd}`, changes: [], undo: null, public: false, cost: usd }], diff: key });
    this.asked.set(key, ask);
    this.held.set(ask, key);
    this.paidAsks.set(ask, { tool, usd });
    return ask;
  }
  /** The folder a job's output checks run in: the hub's jobs folder, which holds none of the outputs' bytes. */
  private dir(): string {
    const dir = join(this.d.root, 'jobs');
    mkdirSync(dir, { recursive: true });
    return dir;
  }
}
