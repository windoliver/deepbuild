// A plug-in's model jobs (#366): `deep.runner.run` goes to the runner R1 built, on your own agent, headless on your
// plan. Here are the job's shape as the plug-in gives it, the prompt the agent reads and what its run answered. The
// host checks each handle against the plug-in's grant before any of this, and filters what the answer cites after.
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { ulid, type Event, type RecordStore } from '@deepbuild/record';
import type { JobRecord, Runner } from '@deepbuild/runner';
import type { Supervisor } from '@deepbuild/supervisor';
import type { Entry, Ext, Manifest } from './host-types.js';
import { CORE, HostFiles, message, within } from './host-shared.js';
import { NODE_HOME, NODE_LIBS } from './node-runtime.js';
import { buildOf, counterOf, encodedInputs, fixtureInputs, kindOf, paramsOf, toolOf, urlOf, type HeldJobs, type JobBytes, type JobCall, type JobCounter, type JobKind, type JobTool, type Weight } from './job-kinds.js';
const PAGE = 1000;
interface JobsOptions {
  record: RecordStore; now(): number; runner: Runner | undefined;
  access: {
    reaches(ext: Ext, kind: string): boolean;
    visible(ext: Ext, event: Event): unknown;
    refuse(ext: Ext, scope: string | undefined, clause: string, given: unknown): Promise<void>;
  };
}
/** Model job execution and its grant-filtered inputs and answers. */
export class Jobs {
  constructor(private readonly options: JobsOptions) {}
  /**
   * A model job for a plug-in, through the runner (#366). Every handle it names is checked against its grant before
   * any job is recorded; the agent gets each one's content, filtered as the plug-in would read it; the answer cites
   * only handles the grant reaches, is recorded as a reading and is as old as the oldest reading it cites.
   */
  async runJob(ext: Ext, given: unknown, scope: string | undefined): Promise<Answer> {
    const id = ext.entry.id;
    const job = jobRequest(given);
    const runner = this.options.runner;
    if (!runner) throw Error('deep.runner.run: this hub has no runner, so no model job runs');
    const inputs: { handle: string; content: unknown }[] = [];
    for (const handle of job.inputs) {
      const reached = await this.reach(ext, handle);
      if ('why' in reached) {
        await this.options.access.refuse(ext, scope, `inputs: ${handle.slice(0, handle.indexOf(':'))}`, given).catch(() => undefined);
        throw Error(`deep.runner.run: ${reached.why}; no job started`);
      }
      inputs.push({ handle, content: reached.content });
    }
    // An action call waits for its job, to the job's own deadline and a minute for the runner to end it.
    if (scope !== undefined) ext.deadlines.get(scope)?.(job.deadline + 60_000);
    const rec = await runner.run({ kind: 'read', agent: 'claude-code', prompt: jobPrompt(id, inputs, job.prompt), deadline_ms: job.deadline });
    const said = answered(rec, job.budget);
    const cites: string[] = [];
    let asOf: number | null = null;
    let staleAt: number | null = null;
    for (const handle of said.cites) {
      const reached = await this.reach(ext, handle);
      if ('why' in reached) continue;
      cites.push(handle);
      if (reached.as_of !== null) asOf = Math.min(asOf ?? reached.as_of, reached.as_of);
      if (reached.stale_at !== null) staleAt = Math.min(staleAt ?? reached.stale_at, reached.stale_at);
    }
    const now = this.options.now();
    const answer: Answer = { handle: `reading:${ulid(now)}`, value: said.value, cites, as_of: asOf ?? now, stale_at: staleAt };
    await this.options.record.append(CORE, {
      v: 1, id: ulid(now), kind: 'runner.answered', subject: answer.handle, ts: now,
      data: { reading: answer.handle, piece: id, job: rec.job, value: answer.value as JsonValue, cites, as_of: answer.as_of, stale_at: staleAt },
    });
    return answer;
  }

  /**
   * A handle as the plug-in's grant reaches it (#366): one of its own sources' readings or its own jobs' answers, with
   * its as-of time and when it goes stale; a session's events, filtered as deep.record.query gives them, only when the
   * grant names text, since a session handle is its transcript; nothing else.
   */
  async reach(ext: Ext, handle: string): Promise<{ content: unknown; as_of: number | null; stale_at: number | null } | { why: string }> {
    const id = ext.entry.id;
    const [type] = handle.split(':', 1);
    if (type === 'reading') {
      // A reading it read through one of its edges (#103): what crossed the edge, never the provider's store or grant.
      const crossed = ext.edgeReads.get(handle);
      if (crossed) return { content: { edge: crossed.edge, value: crossed.value, as_of: crossed.at }, as_of: crossed.at, stale_at: null };
      const [r] = (await this.options.record.raw('SELECT value, unit, as_of, source FROM readings WHERE reading = ?', [handle])) as { value: string; unit: string; as_of: number; source: string }[];
      const source = r ? ext.sources.get(r.source) : undefined;
      if (r && (source || ext.released)) {
        return { content: { source: r.source, value: Number(r.value), unit: r.unit, as_of: r.as_of }, as_of: r.as_of, stale_at: source?.variant === 'polled' ? r.as_of + source.freshFor : null };
      }
      const a = await this.answerOf(handle);
      if (a && (a.piece === id || ext.released)) return { content: { value: a.value, cites: a.cites, as_of: a.as_of }, as_of: a.as_of, stale_at: a.stale_at };
      return { why: `${handle} is outside ${id}'s grant: it is no reading of ${id}'s own sources or jobs` };
    }
    if (type === 'session') {
      const { text, projects } = ext.entry.grant;
      if (!text && !ext.released) return { why: `${handle} is outside ${id}'s grant: it was granted content-free fields only, no text, and a session handle is its transcript` };
      const session = handle.slice('session:'.length);
      const rows = (await this.options.record.raw('SELECT log_pos, kind FROM events WHERE session_id = ? ORDER BY log_pos', [session])) as { log_pos: number; kind: string }[];
      if (!rows.length) return { why: `${handle} is no session in your record` };
      // Only its own stretch of the log, and only the kinds the grant reaches, are read.
      const kinds = [...new Set(rows.map((r) => r.kind))].filter((k) => this.options.access.reaches(ext, k));
      const last = rows[rows.length - 1]!.log_pos;
      const events: unknown[] = [];
      for (let after = rows[0]!.log_pos - 1; kinds.length && after < last;) {
        const page = await this.options.record.read({ after, limit: PAGE, kinds });
        for (const e of page) {
          const seen = e.session === session && e.log_pos <= last ? this.options.access.visible(ext, e) : undefined;
          if (seen !== undefined) events.push(seen);
        }
        if (page.length < PAGE) break;
        after = page[page.length - 1]!.log_pos;
      }
      if (!events.length) return { why: `${handle} is outside ${id}'s grant: none of its events is of a kind${projects ? ' or project' : ''} the grant names` };
      return { content: events, as_of: null, stale_at: null };
    }
    return { why: `${handle} is outside ${id}'s grant: a job reads only the plug-in's own readings and answers, and, with text in its grant, a session` };
  }

  /** A job's answer the record holds, by its reading handle. */
  async answerOf(handle: string): Promise<{ piece: string; value: unknown; cites: string[]; as_of: number; stale_at: number | null } | undefined> {
    const [row] = (await this.options.record.raw("SELECT data FROM events WHERE kind = 'runner.answered' AND subject = ? LIMIT 1", [handle])) as { data: string }[];
    return row ? JSON.parse(row.data) : undefined;
  }
}

/** How long one run of a job tool may take (#1922), and the most it may write on stdout. */
const JOB_MS = 120_000;
const JOB_OUT = 64 * 1024 * 1024; // #154: a 60 s stereo 24-bit stem, as base64, passes 16 MiB
/** The longest stderr line read for a counter (#1925); a counter's line is far shorter. */
const COUNTER_LINE = 4096;
/** A tool's answer, `{outputs}` with each output's bytes in base64, as bytes by name. */
function outputsOf(tool: string, answer: unknown): Record<string, Uint8Array> {
  const outputs = (typeof answer === 'object' && answer !== null ? answer as { outputs?: unknown } : {}).outputs;
  if (typeof outputs !== 'object' || outputs === null || !Object.values(outputs).every((v) => typeof v === 'string')) throw Error(`${tool} wrote no {outputs}, each output's bytes in base64`);
  return Object.fromEntries(Object.entries(outputs as Record<string, string>).map(([n, b]) => [n, new Uint8Array(Buffer.from(b, 'base64'))]));
}
/** The target triple a tool's build is held for (#1922): this machine's CPU architecture and OS. */
const TRIPLE = `${process.arch}-${process.platform}`;
/** A job kind as an install holds it (#1922), with the tools that joined it. */
export interface JobListing { kind: string; plugin: string; descriptor: JobKind; tools: { tool: string; plugin: string; build: string | null; host?: string; descriptor: JobTool; provider?: string }[] }

interface JobToolsOptions {
  entries: Readonly<Record<string, Entry>>; supervisor: Supervisor; home: string; now(): number; files: HostFiles; plant: string | undefined;
}
/** Qualified tool builds and their bounded process/host calls. */
export class JobTools {
  private builds: Record<string, string>;
  constructor(private readonly options: JobToolsOptions) { this.builds = options.files.read('job-builds.json'); }
  keep(held: HeldJobs): void {
    this.builds = { ...this.builds, ...Object.fromEntries(held.tools.flatMap((t) => (t.build === null ? [] : [[`${t.tool} ${TRIPLE}`, t.build]]))) };
    this.options.files.save('job-builds.json', this.builds);
  }
  jobs(): JobListing[] {
    const entries = Object.values(this.options.entries);
    return entries.flatMap((e) => Object.entries(e.jobs?.kinds ?? {}).map(([kind, descriptor]) => ({
      kind, plugin: e.id, descriptor,
      tools: entries.flatMap((t) => (t.jobs?.tools ?? []).filter((x) => x.kind === kind).map((x) => ({ tool: x.tool, plugin: t.id, build: x.build, ...(x.host && { host: x.host }), descriptor: x.descriptor, ...(x.provider ? { provider: x.provider } : {}) }))),
    })));
  }

  jobParams(kind: string, value: unknown): Record<string, JsonValue> {
    const held = this.jobs().find((k) => k.kind === kind);
    if (!held) throw Error(`no installed package registers the job kind ${kind}`);
    return paramsOf(held.descriptor.schema.params, value);
  }

  async runJobTool(tool: string, kind: string, params: Record<string, JsonValue>, inputs: JobBytes, call?: Omit<JobCall, 'provider'>, stop?: AbortSignal, watch?: (counter: JobCounter) => void): Promise<Record<string, Uint8Array>> {
    const { folder, held } = this.jobTool(tool, kind);
    if (held.provider && !call) throw Error(`${tool} calls ${held.provider}, so its run needs its submission key and call journal`);
    return this.runTool(folder, held.descriptor, params, inputs, held.provider && call ? { provider: held.provider, ...call } : undefined, stop, watch);
  }

  async jobHostReport(tool: string, kind: string): Promise<{ weights: Weight[]; capabilities: string[] }> {
    const url = urlOf(this.jobTool(tool, kind).held.descriptor);
    if (!url) throw Error(`${tool} runs on this machine, so no host reports for it`);
    const report = await this.hostCall(tool, new URL('/report', url), 'GET');
    const r = (typeof report === 'object' && report !== null ? report : {}) as { weights?: unknown; capabilities?: unknown };
    const weights = Array.isArray(r.weights) ? r.weights.filter((w): w is Weight => typeof w?.name === 'string' && typeof w?.sha256 === 'string') : [];
    return { weights, capabilities: Array.isArray(r.capabilities) ? r.capabilities.filter((c): c is string => typeof c === 'string') : [] };
  }

  private jobTool(tool: string, kind: string): { folder: string; held: HeldJobs['tools'][number] } {
    const owner = Object.values(this.options.entries).find((e) => e.jobs?.tools.some((t) => t.kind === kind && t.tool === tool));
    const held = owner?.jobs!.tools.find((t) => t.kind === kind && t.tool === tool);
    if (!owner || !held) throw Error(`${tool} isn't a qualified tool of ${kind}`);
    return { folder: owner.folder, held };
  }

  /**
   * One call to a tool's host (#1924), made by the hub, never the package: to the URL its descriptor names on the host
   * its manifest names, with no redirect, bounded in time and size; its answer's JSON.
   */
  private async hostCall(tool: string, url: URL, method: 'GET' | 'POST', body?: string): Promise<unknown> {
    const answer = await globalThis.fetch(url, {
      method, ...(body !== undefined && { body, headers: { 'content-type': 'application/json' } }),
      redirect: 'manual', signal: AbortSignal.timeout(JOB_MS),
    });
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of answer.body ?? []) {
      size += chunk.byteLength;
      if (size > JOB_OUT) throw Error(`${tool}'s host answered more than ${JOB_OUT} bytes`);
      chunks.push(chunk);
    }
    if (answer.status !== 200) throw Error(`${tool}'s host answered ${method} ${url.pathname} with ${answer.status}`);
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Error(`${tool}'s host answered ${method} ${url.pathname} with no JSON`); }
  }

  /**
   * One run of a job tool (#1922): `node <its dir>/<its entry>` through the supervisor, in the platform sandbox with only
   * its own files and Node to read, given `{params, inputs}` (each input's bytes in base64) on stdin and writing
   * `{outputs}` the same way on stdout. It reads no path, name or time of an input: only the bytes it is given. A tool
   * that calls a provider is also given `call` (#1923), and may reach that one host and write its call journal's folder.
   * Its counters come as lines on stderr while it runs (`counterOf`), each handed to `watch` (#1925); its other text is its own.
   */
  private async runTool(folder: string, tool: JobTool, params: Record<string, JsonValue>, inputs: JobBytes, call?: JobCall, stop?: AbortSignal, watch?: (counter: JobCounter) => void): Promise<Record<string, Uint8Array>> {
    const input = Buffer.from(JSON.stringify({ params, inputs: encodedInputs(inputs), ...(call ? { call } : {}) }));
    // A tool off the machine (#1924): one POST of the same object to its URL, answered the same way.
    if ('url' in tool.run) return outputsOf(tool.tool, await this.hostCall(tool.tool, new URL(tool.run.url), 'POST', input.toString('utf8')));
    const { supervisor } = this.options;
    const dir = join(folder, tool.run.dir);
    const run = `run:${ulid(this.options.now())}`;
    const out: Buffer[] = [];
    let size = 0;
    const text = new StringDecoder('utf8');
    let line = '';
    const counters = (chunk: Buffer) => {
      const lines = (line + text.write(chunk)).split('\n');
      line = lines.pop()!;
      // A line longer than any counter's is the tool's own text, so it isn't kept to the end.
      if (line.length > COUNTER_LINE) line = '';
      for (const l of lines) {
        const counter = counterOf(l);
        if (counter) watch!(counter);
      }
    };
    if (call) mkdirSync(dirname(call.journal), { recursive: true });
    const started = await supervisor.start({
      run, argv: [process.execPath, join(dir, tool.run.entry)], cwd: dir, inherit: false, input,
      env: { PATH: '/usr/bin:/bin', HOME: dir, ...(NODE_LIBS.length ? { OPENSSL_CONF: '/dev/null' } : {}) },
      grant: { read: [NODE_HOME, ...NODE_LIBS, dir], ...(call ? { write: [dirname(call.journal)], hosts: [call.provider] } : {}) },
      output: { stdout: (chunk: Buffer) => { size += chunk.length; if (size <= JOB_OUT) out.push(chunk); }, stderr: watch ? counters : () => undefined },
    });
    if (started.status !== 'started') throw Error(`the sandbox held ${tool.tool}: BLOCKED on ${started.kind}`);
    const end = () => void supervisor.signal(run, 'SIGTERM').catch(() => undefined);
    if (stop?.aborted) end();
    stop?.addEventListener('abort', end, { once: true });
    try {
      const exit = await within(JOB_MS, `${tool.tool}'s run`, supervisor.wait(run));
      if (stop?.aborted) throw Error(`${tool.tool}'s run was stopped: every request for it was cancelled`);
      if (exit.code !== 0) throw Error(`${tool.tool} exited ${exit.code ?? exit.signal}`);
    } finally {
      stop?.removeEventListener('abort', end);
      await supervisor.cleanup(run).catch(() => undefined);
    }
    if (size > JOB_OUT) throw Error(`${tool.tool} wrote more than ${JOB_OUT} bytes`);
    let answer: unknown;
    try { answer = JSON.parse(Buffer.concat(out).toString('utf8')); } catch { answer = undefined; }
    return outputsOf(tool.tool, answer);
  }
  async qualify(entry: Entry, manifest: Manifest, ext: Ext): Promise<HeldJobs> {
    const refuse = (why: string): never => { throw Error(`${why}, so ${entry.id}@${entry.version} isn't installed`); };
    const kinds: HeldJobs['kinds'] = {};
    for (const kind of manifest.jobs ?? []) {
      if (!ext.jobKinds.has(kind)) refuse(`${entry.id}'s manifest declares the job kind ${kind}, which its code doesn't register`);
      try { kinds[kind] = kindOf(kind, ext.jobKinds.get(kind)); } catch (e) { refuse(message(e)); }
    }
    const tools: HeldJobs['tools'] = [];
    for (const { kind, tool, host, provider } of manifest.job_tools ?? []) {
      const raw = ext.jobTools.find((t) => t.kind === kind && (t.tool as { tool?: unknown } | null)?.tool === tool);
      if (!raw) return refuse(`${entry.id}'s manifest declares the tool ${tool} of ${kind}, which its code doesn't register`);
      let descriptor: JobTool;
      try { descriptor = toolOf(kind, raw.tool, entry.folder, host); } catch (e) { return refuse(message(e)); }
      const held = kinds[kind] ?? this.jobs().find((k) => k.kind === kind)?.descriptor;
      if (!held) return refuse(`${entry.id}'s tool ${tool} joins the job kind ${kind}, which no installed package registers`);
      // A tool off the machine has no files here, so no build: its weights, by hash, are its job key's (#1924).
      const build = 'dir' in descriptor.run ? buildOf(join(entry.folder, descriptor.run.dir), descriptor.run.entry, this.options.plant) : null;
      const before = this.builds[`${tool} ${TRIPLE}`];
      if (build !== null && before !== undefined && before !== build) refuse(`${entry.id}'s tool ${tool} qualified on ${TRIPLE} as build ${before}, and these files are build ${build}: one name@version is one build, so the changed tool takes a new version`);
      for (const f of held.qualification.fixtures) {
        let wrote: Record<string, Uint8Array>;
        // A tool that calls a provider calls it here too (#1923), with a journal of its own that outlives nothing.
        const scratch = provider ? join(this.options.home, 'jobs', 'qualify', ulid(this.options.now())) : undefined;
        try {
          const call = provider && scratch ? { provider, key: sha256Hex(canonicalize({ qualification: f.name, kind, tool })), journal: join(scratch, 'journal.jsonl') } : undefined;
          wrote = await this.runTool(entry.folder, descriptor, paramsOf(held.schema.params, f.params), fixtureInputs(held.schema.inputs, f.inputs), call);
        } catch (e) {
          return refuse(`${entry.id}'s tool ${tool} fails ${kind}'s qualification at the fixture ${f.name}: ${message(e)}`);
        } finally {
          if (scratch) rmSync(scratch, { recursive: true, force: true });
        }
        for (const [name, text] of Object.entries(f.expect)) {
          const got = wrote[name];
          if (!got || !Buffer.from(got).equals(Buffer.from(text, 'utf8'))) refuse(`${entry.id}'s tool ${tool} fails ${kind}'s qualification at the fixture ${f.name}: it wrote ${got ? JSON.stringify(Buffer.from(got).toString('utf8')) : 'nothing'} for ${name}, where the fixture expects ${JSON.stringify(text)}, and it doesn't join ${kind}`);
        }
      }
      tools.push({ kind, tool, build, ...(host && { host }), descriptor, ...(provider ? { provider } : {}) });
    }
    return { kinds, tools };
  }
}

/** What a plug-in asks for: its prompt, its inputs by handle, a budget in USD and a deadline in ms. */
interface JobRequest { prompt: string; inputs: string[]; budget: { usd: number }; deadline: number }
/** What the plug-in gets: a reading with its own handle, as old as the oldest reading it cites. */
export interface Answer { handle: string; value: unknown; cites: string[]; as_of: number; stale_at: number | null }

const HANDLE = /^[a-z]+:.+$/;

/** The plug-in's request, held to deep.runner.run's shape; a call that isn't refuses naming what is wrong. */
export function jobRequest(given: unknown): JobRequest {
  const r = (typeof given === 'object' && given !== null ? given : {}) as Record<string, unknown>;
  const refuse = (why: string): never => { throw Error(`deep.runner.run: ${why}`); };
  if (typeof r.prompt !== 'string' || !r.prompt) refuse('a job has a prompt');
  if (!Array.isArray(r.inputs) || !r.inputs.every((h) => typeof h === 'string' && HANDLE.test(h))) refuse('a job names its inputs as a list of handles, such as reading:<id>');
  const usd = (r.budget as { usd?: unknown } | undefined)?.usd;
  if (typeof usd !== 'number' || !(usd > 0)) refuse('a job has a budget in USD above 0, as { usd }');
  if (!Number.isSafeInteger(r.deadline) || (r.deadline as number) < 1) refuse('a job has a deadline in ms');
  return { prompt: r.prompt as string, inputs: [...new Set(r.inputs as string[])], budget: { usd: usd as number }, deadline: r.deadline as number };
}

/** What the agent reads: what DeepBuild asks of every job, each input's content by its handle, then the plug-in's prompt as given. */
export function jobPrompt(piece: string, inputs: { handle: string; content: unknown }[], prompt: string): string {
  return [
    `DeepBuild runs this job for the plug-in ${piece}. Use only the inputs below; read no file and call no tool.`,
    'Answer with one JSON object and nothing else: {"value": <your answer>, "cites": [<the handles below your answer rests on>]}.',
    '',
    'Inputs, by handle:',
    ...(inputs.length ? inputs.map((i) => `${i.handle}: ${JSON.stringify(i.content)}`) : ['(none)']),
    '',
    'The plug-in asks:',
    prompt,
  ].join('\n');
}

/** What a finished job answered: its value and the handles it cites. A job that didn't finish rejects with its stop cause, never with text. */
export function answered(rec: JobRecord, budget: { usd: number }): { value: unknown; cites: string[] } {
  if (rec.state !== 'finished' || rec.stop) {
    throw Error(`deep.runner.run: the job ${rec.job} failed: ${rec.stop?.cause ?? rec.refused ?? rec.state}`);
  }
  if ((rec.cost_usd ?? 0) > budget.usd) throw Error(`deep.runner.run: the job ${rec.job} cost $${rec.cost_usd}, over its budget of $${budget.usd}, so its answer is dropped`);
  const text = (rec.result ?? '').trim();
  // An agent may wrap the object it was asked for in a code fence or a sentence: the outermost braces are its answer.
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  let given: unknown;
  try {
    given = JSON.parse(from >= 0 && to > from ? text.slice(from, to + 1) : text);
  } catch {
    given = undefined;
  }
  const g = given as { value?: unknown; cites?: unknown } | undefined;
  if (typeof g !== 'object' || g === null || !('value' in g)) throw Error(`deep.runner.run: the job ${rec.job} finished without the JSON object {value, cites} it was asked for`);
  const cites = Array.isArray(g.cites) ? g.cites.filter((c): c is string => typeof c === 'string') : [];
  return { value: g.value, cites: [...new Set(cites)] };
}
