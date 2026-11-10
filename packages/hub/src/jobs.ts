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
// that tool up to a price per run.
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
// only once no request waits on it.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { PlanInput } from '@deepbuild/asks';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import type { SendBoundary, SendRequest, Receipt } from '@deepbuild/evidence';
import type { ExtensionHost } from '@deepbuild/extension-host';

type Obj = Record<string, unknown>;
type Host = Pick<ExtensionHost, 'jobs' | 'jobParams' | 'runJobTool' | 'jobHostReport' | 'runCheck'>;
type CheckSpec = Parameters<Host['runCheck']>[1];
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** A tool pinned by name@version: no range, tag or bare name. */
const PINNED = /^[a-z0-9][a-z0-9_-]*@\d+\.\d+\.\d+$/;
const HASH = /^[0-9a-f]{64}$/;
const DAY = 86_400_000;
/** How long the kind's output checks may take, each. */
const CHECK_MS = 60_000;

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
  /** The evidence store's send: files by hash only, each under its origin rule, its yes kept per file and destination. */
  send(request: SendRequest, boundary: SendBoundary): Promise<Receipt>;
  /** Raises an ask from one of the job API's sources: its handle. */
  raise(source: 'job.paid' | 'job.send' | 'job.unblock', ask: Obj, plan?: PlanInput): Promise<string>;
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

  /** deep_job's list: each kind, the package that holds it, and its tools, each with its package and build. */
  list(): Obj {
    return { kinds: (this.d.host()?.jobs() ?? []).map((k) => ({ kind: k.kind, plugin: k.plugin, tools: k.tools.map((t) => ({ tool: t.tool, plugin: t.plugin, build: t.build })) })) };
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
    const key = this.held.get(ask);
    if (key === undefined) return false;
    this.held.delete(ask);
    this.asked.delete(key);
    if (decision === 'allow') this.allowed.add(key);
    return true;
  }

  /**
   * A request's caller gone (#1923): it leaves the job it waits on. The job stops only once no request waits on it, so
   * a joiner's cancel never stops the job for the request that started it.
   */
  gone(caller: string): void {
    this.leaving.get(caller)?.();
    for (const job of this.running.values()) {
      if (!job.callers.delete(caller)) continue;
      if (job.callers.size === 0 || this.d.plant === 'job-joiner-cancels-job') job.stop.abort();
    }
  }

  /** deep_job's run: done with its outputs by hash and a receipt, held on an ask, refused, BLOCKED, or failed naming why. */
  async run(args: Obj, caller: string = `anonymous#${++this.anonymous}`): Promise<Obj> {
    const host = this.d.host();
    const refused = (reason: string): Obj => ({ status: 'refused', reason });
    if (!host) return refused('the hub has no extension host yet; try again once it is ready');
    const { kind, tool, params: text, inputs } = args;
    const held = host.jobs().find((k) => k.kind === kind);
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
    const given = Array.isArray(inputs) ? inputs.filter(isObj) : [];
    const url = 'url' in pinned.descriptor.run ? pinned.descriptor.run.url : undefined;
    const where = pinned.host ?? '';
    // Off the machine a file goes only by hash: an input naming a path is refused before any file is read.
    if (url && given.some((i) => i.path !== undefined && i.path !== null)) return refused(`${tool} runs off the machine on ${where}, so it takes files only by hash from the evidence store, as inputs [{name, sha256}], never by path; nothing was read or sent`);
    const bytes: Record<string, Uint8Array> = {};
    for (const i of given) {
      const name = String(i.name);
      if (!declared.includes(name) || bytes[name]) return refused(`${kind} takes the inputs ${declared.join(', ')}, each once; ${JSON.stringify(i.name)} isn't one of them, or comes twice`);
      if (typeof i.sha256 === 'string') {
        if (!HASH.test(i.sha256)) return refused(`the input ${name} names a file by its SHA-256, 64 hex digits`);
        try { bytes[name] = await this.d.read(i.sha256); } catch (e) { return refused(`the input ${name}: ${message(e)}`); }
        continue;
      }
      if (typeof i.path !== 'string' || !isAbsolute(i.path)) return refused(`the input ${name} is a file, by its SHA-256 in the evidence store or its absolute path`);
      try { bytes[name] = new Uint8Array(await readFile(i.path)); } catch (e) { return refused(`the input ${name} can't be read: ${message(e)}`); }
    }
    const missing = declared.filter((n) => !bytes[n]);
    if (missing.length || given.length !== declared.length) return refused(`${kind} takes the inputs ${declared.join(', ')}; give ${missing.join(', ') || 'each once'}`);
    const weights = pinned.descriptor.weights;
    const key = this.keyOf(kind, tool, String(text ?? ''), params, bytes, weights);
    let sent: { sha256: string; host: string }[] = [];
    const receipt = (build: string | null, cache: 'hit' | 'miss'): Obj => ({
      kind, tool, key, build, cache, inputs: Object.fromEntries(Object.entries(bytes).map(([n, b]) => [n, sha256(b)])),
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
      const gate = await this.gate([...new Set(Object.values(bytes).map(sha256))], where, tool, kind, key);
      if ('reply' in gate) return gate.reply;
      sent = gate.sent;
    }

    const usd = pinned.descriptor.cost?.usd ?? 0;
    if (usd > 0 && !((this.saved.rules[tool] ?? -1) >= usd)) {
      if (!this.allowed.delete(key)) return { status: 'held', ask: this.asked.get(key) ?? (await this.ask(kind, tool, usd, key)) };
    }

    const needs = pinned.descriptor.needs ?? [];
    if (url && (weights?.length || needs.length) && this.d.plant !== 'job-weights-call-anyway') {
      let report: Awaited<ReturnType<Host['jobHostReport']>>;
      try {
        report = await host.jobHostReport(tool, kind);
      } catch (e) {
        return { status: 'failed', reason: `${tool}'s host ${where} gave no report of its weights and capabilities: ${message(e)}; nothing was sent` };
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

    const stop = new AbortController();
    const job: Running = { callers: new Set(), stop, result: this.call(host, held, pinned, key, params, bytes, receipt, done, stop.signal) };
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
  /** The tool's one run for a key, its outputs held until the kind's output checks pass, then kept and cached. */
  private async call(host: Host, held: ReturnType<Host['jobs']>[number], pinned: ReturnType<Host['jobs']>[number]['tools'][number], key: string, params: Record<string, JsonValue>, bytes: Record<string, Uint8Array>, receipt: (build: string | null, cache: 'hit' | 'miss') => Obj, done: (outputs: Record<string, string>, build: string | null, cache: 'hit' | 'miss') => Obj, stop: AbortSignal): Promise<Obj> {
    const { kind } = held;
    const { tool } = pinned;
    let wrote: Record<string, Uint8Array>;
    try {
      wrote = await host.runJobTool(tool, kind, params, bytes, pinned.provider ? { key, journal: this.journal(key) } : undefined, stop);
    } catch (e) {
      return { status: 'failed', reason: `${tool} failed: ${message(e)}; nothing was kept`, receipt: receipt(pinned.build, 'miss') };
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
  private keyOf(kind: string, tool: string, text: string, params: Record<string, JsonValue>, bytes: Record<string, Uint8Array>, weights?: { name: string; sha256: string }[]): string {
    const key = {
      kind,
      tool: this.d.plant === 'job-key-no-version' ? tool.slice(0, tool.indexOf('@')) : tool,
      params: this.d.plant === 'job-key-params-text' ? text : params,
      inputs: Object.fromEntries(Object.entries(bytes).map(([n, b]) => [n, sha256(b)])),
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
    return ask;
  }
  /** The folder a job's output checks run in: the hub's jobs folder, which holds none of the outputs' bytes. */
  private dir(): string {
    const dir = join(this.d.root, 'jobs');
    mkdirSync(dir, { recursive: true });
    return dir;
  }
}
