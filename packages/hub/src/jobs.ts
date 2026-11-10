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
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { PlanInput } from '@deepbuild/asks';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import type { ExtensionHost } from '@deepbuild/extension-host';
import type { RunningJob } from './rows.js';

type Obj = Record<string, unknown>;
type Host = Pick<ExtensionHost, 'jobs' | 'jobParams' | 'runJobTool' | 'runCheck'>;
type CheckSpec = Parameters<Host['runCheck']>[1];
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** A tool pinned by name@version: no range, tag or bare name. */
const PINNED = /^[a-z0-9][a-z0-9_-]*@\d+\.\d+\.\d+$/;
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
  /** Raises the authority ask for one paid call: its handle. */
  raise(ask: Obj, plan: PlanInput): Promise<string>;
  /** Shows a running job's row as it now reads (#1925), or takes it off the list once its tool's run has ended. */
  row(job: RunningJob, running: boolean): void;
  plant?: string | undefined;
}
interface Cached { outputs: Record<string, string>; build: string }
interface Saved { cache: Record<string, Cached>; rules: Record<string, number> }

export class Jobs {
  private saved: Saved;
  /** The authority ask each paid call waits on, by the call's key, and the key each ask is for. */
  private readonly asked = new Map<string, string>();
  private readonly held = new Map<string, string>();
  /** The keys your yes allows, each once. */
  private readonly allowed = new Set<string>();

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
    const key = this.held.get(ask);
    if (key === undefined) return false;
    this.held.delete(ask);
    this.asked.delete(key);
    if (decision === 'allow') this.allowed.add(key);
    return true;
  }

  /** deep_job's run: done with its outputs by hash and a receipt, held on an ask, refused, or failed naming why. */
  async run(args: Obj): Promise<Obj> {
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
    const bytes: Record<string, Uint8Array> = {};
    for (const i of given) {
      const name = String(i.name);
      if (!declared.includes(name) || bytes[name]) return refused(`${kind} takes the inputs ${declared.join(', ')}, each once; ${JSON.stringify(i.name)} isn't one of them, or comes twice`);
      if (typeof i.path !== 'string' || !isAbsolute(i.path)) return refused(`the input ${name} is a file, by its absolute path`);
      try { bytes[name] = new Uint8Array(await readFile(i.path)); } catch (e) { return refused(`the input ${name} can't be read: ${message(e)}`); }
    }
    const missing = declared.filter((n) => !bytes[n]);
    if (missing.length || given.length !== declared.length) return refused(`${kind} takes the inputs ${declared.join(', ')}; give ${missing.join(', ') || 'each once'}`);
    const key = this.keyOf(kind, tool, String(text ?? ''), params, bytes);
    const receipt = (build: string, cache: 'hit' | 'miss'): Obj => ({ kind, tool, key, build, cache, inputs: Object.fromEntries(Object.entries(bytes).map(([n, b]) => [n, sha256(b)])) });
    const done = (outputs: Record<string, string>, build: string, cache: 'hit' | 'miss'): Obj => ({ status: 'done', outputs: Object.fromEntries(Object.entries(outputs).map(([n, sha]) => [n, { sha256: sha }])), receipt: receipt(build, cache) });

    const cached = this.saved.cache[key];
    if (cached && (await Promise.all(Object.values(cached.outputs).map((sha) => this.d.has(sha)))).every(Boolean)) return done(cached.outputs, cached.build, 'hit');

    const usd = pinned.descriptor.cost?.usd ?? 0;
    if (usd > 0 && !((this.saved.rules[tool] ?? -1) >= usd)) {
      if (!this.allowed.delete(key)) return { status: 'held', ask: this.asked.get(key) ?? (await this.ask(kind, tool, usd, key)) };
    }

    // While its tool runs, the job has a row that counts from the tool's own counters (#1925). Nothing here waits on
    // the caller, so the job runs on when the app or the session that asked for it closes.
    const job: RunningJob = { key, kind, tool, started: this.d.now() };
    this.d.row(job, true);
    let wrote: Record<string, Uint8Array>;
    try {
      wrote = await host.runJobTool(tool, kind, params, bytes, (counter) => {
        job.counter = counter;
        job.at = this.d.now();
        this.d.row(job, true);
      });
    } catch (e) {
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
  /** The key: the tool's name@version, the canonical params and each input's hash; the planted keys break one part each. */
  private keyOf(kind: string, tool: string, text: string, params: Record<string, JsonValue>, bytes: Record<string, Uint8Array>): string {
    const key = {
      kind,
      tool: this.d.plant === 'job-key-no-version' ? tool.slice(0, tool.indexOf('@')) : tool,
      params: this.d.plant === 'job-key-params-text' ? text : params,
      inputs: Object.fromEntries(Object.entries(bytes).map(([n, b]) => [n, sha256(b)])),
    };
    return sha256Hex(canonicalize(key as JsonValue));
  }
  private async ask(kind: string, tool: string, usd: number, key: string): Promise<string> {
    const ask = await this.d.raise({
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
