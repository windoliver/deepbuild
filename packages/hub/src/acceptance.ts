// The blind acceptance job (#1328; design: Dogfooding, What done means): the hub starts it before an issue's first
// attempt, on the runner, with its inputs by handle on the record. It reads only the issue's body at that moment, the
// design documents and a checkout of the base, and writes only tests/acceptance/<issue>/. Nothing it says is evidence:
// the hub reads what it did from its own stream and folder, runs each test on the base itself, and commits the folder
// as the attempt's first commit only when every new-behavior test fails there at an assertion in the folder. A dispute
// starts a fresh run with the same inputs and the criterion, never the work or the dispute; two drafts that agree on
// the work decide, and a person is asked only when no draft meets the base rule or no gate identity can sign the swap.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import type { Asks, Delivery } from '@deepbuild/asks';
import { runCommandCheck, type CommandRun } from '@deepbuild/checks-command';
import { baseProof, gitEnv, type Checkouts } from '@deepbuild/gate';
import { SLOW_SLOT } from '@deepbuild/leases';
import { readSince, ulid, type Connection, type RecordStore } from '@deepbuild/record';
import type { JobInput, JobRecord, Runner } from '@deepbuild/runner';
import type { Host, Supervisor } from '@deepbuild/supervisor';
import { criteriaOf, ISSUE_LINK, type Reading } from './github-source.js';

const MODEL = 'opus';
const JOB_MS = 30 * 60_000;
const RUN_MS = 10 * 60_000;
const CPU = { kind: 'cpu.slot', key: SLOW_SLOT };
const IDENTITY = { GIT_AUTHOR_NAME: 'DeepBuild', GIT_AUTHOR_EMAIL: 'hub@deepbuild.invalid', GIT_COMMITTER_NAME: 'DeepBuild', GIT_COMMITTER_EMAIL: 'hub@deepbuild.invalid' };
const READS = new Set(['Read', 'Grep', 'Glob']);
const WRITES = new Set(['Write', 'Edit']);
const TEST_FILE = /(?:^|\/)(?:test_[^/]+|[^/]+[._](?:test|spec)\.[^/]+)$/;
const NO_CHANGE = /^unchanged:/i;

interface Criterion { text: string; tag: string }
interface Draft { job: string; on_work: 'passes' | 'fails' | 'broken'; /** Why it misses the base rule, or null when it meets it. */ misses: string | null; why: string }
interface Dispute {
  test: string; work: string; why: string; criterion: string; jobs: string[]; drafts: Draft[];
  outcome: 'stands' | 'swapped' | 'asked' | null; commit: string | null; refused: { job: string; test: string; why: string }[]; ask?: string;
}
interface BaseRun { test: string; criterion: string; outcome: 'failed'; at: string | null }
interface Entry {
  issue: string; n: number; repo: string; base: string; design: string[]; command: string; agent: string;
  body: string; inputs: JobInput[]; jobs: string[]; result: 'ready' | 'INVALID' | 'refused' | null; why: string | null;
  branch: string | null; commit: string | null; runs: BaseRun[]; disputes: Dispute[];
  /** Waiting for a slot, and holding one: an issue with an ask open does neither. */
  queued: boolean; slot: boolean;
}
export interface AcceptanceOptions {
  record: RecordStore;
  runner(): Runner;
  supervisor(): Supervisor;
  checkouts(): Checkouts;
  asks(): Asks;
  core: Connection;
  /** The issue as its forge holds it now, or undefined. */
  read(owner: string, name: string, n: number): Promise<Reading | undefined>;
  append(kind: string, data: Record<string, unknown>): Promise<void>;
  now(): number;
  slots: number;
  /** The gate identity's SSH key (#1325), or null: with none, a swap goes to you. */
  gateKey: string | null;
}

const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const quoted = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;
function git(cwd: string, args: string[], o: { input?: Uint8Array | string; env?: NodeJS.ProcessEnv; raw?: true } = {}): Promise<string> {
  return new Promise((done, failed) => {
    const child = execFile('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 256 << 20, env: { ...gitEnv(), ...IDENTITY, ...o.env } }, (error, stdout, stderr) => {
      if (error) failed(Error(`git ${args[0]}: ${stderr.trim() || error.message}`));
      else done(o.raw ? stdout : stdout.trim());
    });
    child.stdin?.end(o.input);
  });
}
/** What the job's own stream shows it did past its reach: a read outside its folder, a write outside its issue's, or any other tool. */
export function pastReach(stdout: string, folder: string, writes: string): string | undefined {
  const inside = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);
  for (const line of stdout.split('\n')) {
    let event: { type?: string; message?: { content?: { type?: string; name?: string; input?: Record<string, unknown> }[] } };
    try { event = JSON.parse(line) as typeof event; } catch { continue; }
    for (const part of event.type === 'assistant' ? event.message?.content ?? [] : []) {
      if (part.type !== 'tool_use') continue;
      const name = String(part.name);
      const given = part.input?.file_path ?? part.input?.path;
      const at = typeof given === 'string' ? resolve(folder, given) : folder;
      if (READS.has(name)) { if (!inside(at, folder)) return `it read ${at}, which isn't one of its inputs`; }
      else if (!WRITES.has(name)) return `it used ${name}, which no blind job has`;
      else if (!inside(at, join(folder, writes))) return `it wrote ${relative(folder, at)}, outside ${writes}`;
    }
  }
  return undefined;
}
/** What it left in its folder: every regular file under its issue's, by path from the checkout. A link is no test. */
function filesIn(folder: string, writes: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (at: string): void => {
    for (const name of readdirSync(join(folder, at))) {
      const path = `${at}/${name}`;
      const st = lstatSync(join(folder, path));
      if (st.isDirectory()) walk(path);
      else if (st.isFile()) files.set(path, readFileSync(join(folder, path)));
      else throw Error(`it left ${path}, which is no file`);
    }
  };
  walk(writes);
  return files;
}
interface Ran { file: string; name: string; tag: string | undefined; run: Pick<CommandRun, 'outcome' | 'testsRun' | 'failures'> }
/** Each test of one file's run, with its own outcome and failures. */
function testsIn(run: CommandRun, file: string, n: number): Ran[] {
  const tag = new RegExp(`#${n}\\.[0-9a-f]{8}`);
  return [...new Map(run.attempts.map((a) => [a.test, a.outcome])).entries()].map(([name, outcome]) => ({
    file, name, tag: tag.exec(name)?.[0],
    run: { outcome: outcome === 'passed' ? 'passed' : run.outcome === 'passed' ? 'failed' : run.outcome, testsRun: 1, failures: run.failures.filter((f) => f.test === name) },
  }));
}

export class Acceptance {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly o: AcceptanceOptions) {}

  /** What the record holds: a job a stopped hub left is judged when it ends, and what waited for a slot still waits. */
  async open(): Promise<void> {
    await readSince(this.o.record, 0, ['acceptance.state'], (event) => {
      const d = event.data as unknown as { issue: string; entry: Entry };
      this.entries.set(d.issue, d.entry);
    });
    for (const e of this.entries.values()) {
      if (e.jobs.length && !e.result) this.judging(e);
      for (const d of e.disputes) if (!d.outcome) this.settling(e, d);
    }
    await this.pump();
  }

  // ---- The control methods.

  async start(p: Record<string, unknown>): Promise<{ job: string | null; state: 'running' | 'queued' }> {
    const issue = String(p.issue);
    const link = ISSUE_LINK.exec(issue);
    const { repo, base, design, command, agent } = p;
    if (!link || link[0] !== issue) throw Error(`acceptance.start names an issue by its link, not ${issue}`);
    if (typeof repo !== 'string' || !repo.startsWith('/') || typeof base !== 'string' || !/^[0-9a-f]{40}$/.test(base)) throw Error('acceptance.start names the repo by its absolute path and the base by its SHA');
    if (!Array.isArray(design) || !design.every((d) => typeof d === 'string') || typeof command !== 'string' || !command || typeof agent !== 'string') throw Error('acceptance.start names the design documents, the test command and the agent');
    const have = this.entries.get(issue);
    if (have && have.result !== 'INVALID' && have.result !== 'refused') return { job: have.jobs[0] ?? null, state: have.jobs.length ? 'running' : 'queued' };
    const e: Entry = {
      issue, n: Number(link[3]), repo, base, design: design as string[], command, agent, body: '', inputs: [], jobs: [], result: null, why: null,
      branch: null, commit: null, runs: [], disputes: [], queued: true, slot: false,
    };
    this.entries.delete(issue);
    this.entries.set(issue, e);
    await this.save(e);
    await this.pump();
    return e.jobs.length ? { job: e.jobs[0]!, state: 'running' } : { job: null, state: 'queued' };
  }

  status(p: Record<string, unknown>): unknown {
    const e = this.of(p);
    return {
      state: !e.jobs.length && !e.result ? 'queued' : e.result ? 'done' : 'running', result: e.result, why: e.why, jobs: e.jobs, branch: e.branch, commit: e.commit, base: e.runs,
      disputes: e.disputes.map(({ test, outcome, jobs, commit, refused }) => ({ test, outcome, jobs, commit, refused })),
    };
  }

  async dispute(p: Record<string, unknown>): Promise<{ job: string | null; settled?: true }> {
    const e = this.of(p);
    const [test, work] = [String(p.test), String(p.work)];
    if (e.result !== 'ready' || !e.branch) throw Error(`${e.issue} has no attempt to dispute`);
    if (!/^[0-9a-f]{40}$/.test(work)) throw Error('acceptance.dispute names the work by its SHA');
    const known = e.disputes.find((d) => d.test === test);
    if (known) return known.outcome ? { job: null, settled: true } : { job: known.jobs.at(-1) ?? null };
    const criterion = this.criteria(e).find((c) => test.includes(`${c.tag} `) || test.endsWith(c.tag));
    if (!criterion) throw Error(`${test} names no criterion of ${e.issue}`);
    const d: Dispute = { test, work, why: String(p.why), criterion: criterion.tag, jobs: [], drafts: [], outcome: null, commit: null, refused: [] };
    e.disputes.push(d);
    await this.redraft(e, d);
    this.settling(e, d);
    return { job: d.jobs[0]! };
  }

  /** The attempt ended: its issue's slot is free. */
  async ended(p: Record<string, unknown>): Promise<void> {
    const e = this.of(p);
    e.slot = e.queued = false;
    await this.save(e);
    await this.pump();
  }

  /** Your answer to a dispute's ask: a draft you took goes in, signed by you, and the issue takes the next free slot unless you held it. */
  answered(delivery: Delivery): void {
    for (const e of this.entries.values()) {
      const d = e.disputes.find((x) => x.ask === delivery.ask);
      if (!d) continue;
      void (async () => {
        const taken = d.drafts.find((x) => x.job === delivery.option);
        if (taken) d.commit = await this.swap(e, d, taken, false);
        e.queued = delivery.option !== 'hold';
        await this.save(e);
        await this.pump();
      })().catch((error: unknown) => { e.why = String(error); });
    }
  }

  // ---- Slots.

  private of(p: Record<string, unknown>): Entry {
    const e = this.entries.get(String(p.issue));
    if (!e) throw Error(`no blind job for ${String(p.issue)}`);
    return e;
  }
  private save(e: Entry): Promise<void> {
    return this.o.append('acceptance.state', { issue: e.issue, entry: e });
  }
  /** Gives each free slot to the next that waits, in the order they came. */
  private async pump(): Promise<void> {
    for (const e of this.entries.values()) {
      if (!e.queued) continue;
      if ([...this.entries.values()].filter((x) => x.slot).length >= this.o.slots) return;
      e.queued = false;
      e.slot = true;
      if (!e.jobs.length) await this.first(e);
    }
  }
  /** The result of the issue's first job. Only a ready one keeps its slot. */
  private async end(e: Entry, result: 'ready' | 'INVALID' | 'refused', why: string | null): Promise<void> {
    e.result = result;
    e.why = why;
    if (result !== 'ready') e.slot = false;
    await this.save(e);
    await this.pump();
  }

  // ---- The job.

  private folder(e: Entry): string { return `tests/acceptance/${e.n}`; }
  private criteria(e: Entry): Criterion[] {
    return criteriaOf(e.body).map((text) => ({ text, tag: `#${e.n}.${sha256(text.replace(/\s+/g, ' ')).slice(0, 8)}` }));
  }
  private prompt(e: Entry, redraft?: { file: string; criterion: Criterion }): string {
    const folder = this.folder(e);
    const rules = redraft
      ? [`Write exactly one file, ${redraft.file}, holding one test of this criterion, with ${redraft.criterion.tag} in the test's name:`, '', redraft.criterion.text]
      : [`Write one test per criterion, each in a file of its own under ${folder}/, plus any plants the issue names. Each test's name carries its criterion's tag:`, '', ...this.criteria(e).map((c) => `${c.tag} ${c.text}`)];
    return [
      `You are DeepBuild's blind acceptance job for ${e.issue}. Your working folder is a checkout of the base commit ${e.base}. You read only this issue, that checkout and the design documents in it: ${e.design.join(', ')}. You never see the work.`,
      `You write only under ${folder}/. A test enters through a surface the issue or the design names and asserts the issue's expected values with the test framework's own assertions, so that a new-behavior test loads on the base and fails there at an assertion in its file. A criterion that begins "Unchanged:" is no new behavior. The hub runs each test file on its own as \`${e.command} <file>\`, with no network.`,
      '', ...rules, '', '## The issue', '', e.body,
    ].join('\n');
  }
  private async first(e: Entry): Promise<void> {
    const failed = (why: string): Promise<void> => this.end(e, 'refused', why);
    const [owner, name] = ISSUE_LINK.exec(e.issue)!.slice(1);
    const read = await this.o.read(owner!, name!, e.n).catch(() => undefined);
    if (!read) return failed(`${e.issue} can't be read`);
    e.body = read.body;
    const design: JobInput[] = [];
    for (const path of e.design) {
      const text = await git(e.repo, ['cat-file', 'blob', `${e.base}:${path}`], { raw: true }).catch(() => undefined);
      if (text === undefined) return failed(`the base has no design document ${path}`);
      design.push({ kind: 'design', ref: path, sha256: sha256(text) });
    }
    e.inputs = [{ kind: 'issue', ref: e.issue, sha256: sha256(e.body) }, ...design, { kind: 'base', ref: e.base }];
    const rec = await this.submit(e, this.prompt(e), e.inputs).catch((error: unknown) => String(error));
    if (typeof rec === 'string') return failed(rec);
    e.jobs.push(rec.job);
    await this.save(e);
    this.judging(e);
  }
  /** In the background; whatever stops its judging is its result, never a job left judged by no one. */
  private judging(e: Entry): void {
    void this.judge(e).catch((error: unknown) => this.end(e, 'refused', `its judging failed: ${error instanceof Error ? error.message : String(error)}`));
  }
  private settling(e: Entry, d: Dispute): void {
    void this.settle(e, d).catch((error: unknown) => this.ask(e, d, `its judging failed: ${error instanceof Error ? error.message : String(error)}`)).catch(() => undefined);
  }
  private submit(e: Entry, prompt: string, inputs: JobInput[]): Promise<JobRecord> {
    return this.o.runner().submit({
      kind: 'acceptance', agent: e.agent as JobRecord['agent'], model: MODEL, prompt, issue: e.issue, checkout: { repo: e.repo, commit: e.base }, inputs, writes: this.folder(e), leases: [CPU], deadline_ms: JOB_MS,
    });
  }
  /** Why a job that ended left nothing to use, from its end, its own stream and its folder; or its files. */
  private async left(rec: JobRecord, e: Entry): Promise<string | Map<string, Buffer>> {
    const folder = this.folder(e);
    const past = pastReach(await this.o.runner().output(rec.job), rec.folder, folder);
    if (past) return past;
    if (rec.state !== 'finished' || rec.stop) return rec.refused ?? `it ended ${rec.state}${rec.stop ? `: ${rec.stop.cause}` : ''}`;
    const changed = (await git(rec.folder, ['status', '--porcelain', '-z', '--untracked-files=all', '--ignored=matching'])).split('\0').filter(Boolean).map((row) => row.slice(3));
    const outside = changed.find((path) => !path.startsWith(`${folder}/`));
    if (outside) return `it wrote ${outside}, outside ${folder}`;
    try { return filesIn(rec.folder, folder); } catch (error) { return (error as Error).message; }
  }
  /** One test file on `commit` with `files` over it, in a fresh checkout, by the hub, under a slot. */
  private async run(e: Entry, commit: string, files: Map<string, Buffer>, file: string): Promise<CommandRun> {
    const run = `run:${ulid(this.o.now())}`;
    const host = this.o.supervisor();
    // Under a slow cpu.slot, which the supervisor gives back once the run is cleaned up.
    const leased: Host = { name: host.name, start: (s) => host.start({ ...s, leases: [CPU] }), signal: (r, s) => host.signal(r, s), wait: (r) => host.wait(r), facts: () => host.facts() };
    const c = await this.o.checkouts().checkout({ worktree: e.repo, commit, dependencies: ['node_modules', '.venv'], runs: [run] });
    try {
      for (const [path, bytes] of files) {
        mkdirSync(dirname(join(c.dir, path)), { recursive: true });
        writeFileSync(join(c.dir, path), bytes);
      }
      const spec = { kind: 'command', runner: `${e.command} ${quoted(file)}`, inputs: [file], depth: 'unit', oracle: 'code' } as Parameters<typeof runCommandCheck>[0]['spec'];
      return await runCommandCheck({ host: leased, run, spec, checkout: c.dir, deadline: RUN_MS });
    } finally {
      await host.cleanup(run).catch(() => undefined);
      await this.o.checkouts().ended(c, run).catch(() => undefined);
    }
  }
  /** The first job's result. The job's word on its base failures counts for nothing: the hub runs every test on the base. */
  private async judge(e: Entry): Promise<void> {
    const rec = await this.o.runner().wait(e.jobs[0]!);
    const files = await this.left(rec, e);
    if (typeof files === 'string') return this.end(e, 'refused', files);
    const criteria = this.criteria(e);
    if (!criteria.length) return this.end(e, 'INVALID', `${e.issue} names no acceptance criteria`);
    const ran: Ran[] = [];
    const notes: string[] = [];
    for (const file of [...files.keys()].filter((path) => TEST_FILE.test(path))) {
      const run = await this.run(e, e.base, files, file);
      ran.push(...testsIn(run, file, e.n));
      if (!run.attempts.length) notes.push(`${file} ran no test on the base: ${run.outcome}${run.mask ? ` ${run.mask}` : ''}`);
    }
    for (const c of criteria) {
      const tests = ran.filter((t) => t.tag === c.tag);
      if (!tests.length) return this.end(e, 'INVALID', `${c.tag} "${c.text}" has no test that ran on the base${notes.length ? `: ${notes.join('; ')}` : ''}`);
      if (NO_CHANGE.test(c.text)) continue;
      for (const t of tests) {
        const proof = baseProof(t.run, { own: [this.folder(e)] });
        if (!proof.on_assertion) return this.end(e, 'INVALID', `${c.tag} "${c.text}": ${t.file} › ${t.name} ${proof.why}`);
        const at = t.run.failures.find((f) => f.assertion);
        e.runs.push({ test: `${t.file} › ${t.name}`, criterion: c.tag, outcome: 'failed', at: at ? `${at.file}:${at.line}` : null });
      }
    }
    await this.commitFolder(e, files).then(() => this.end(e, 'ready', null), (error: unknown) => this.end(e, 'refused', String(error)));
  }
  /** One commit over `parent` with `files` in its tree, made through a temporary index, so the repo's own checkout never moves. */
  private async commit(e: Entry, parent: string, files: Map<string, Buffer>, message: string): Promise<string> {
    const temp = mkdtempSync(join(tmpdir(), 'deep-acceptance-'));
    const env = { GIT_INDEX_FILE: join(temp, 'index') };
    try {
      await git(e.repo, ['read-tree', parent], { env });
      for (const [path, bytes] of files) {
        const blob = await git(e.repo, ['hash-object', '-w', '--stdin'], { input: bytes });
        await git(e.repo, ['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], { env });
      }
      const tree = await git(e.repo, ['write-tree'], { env });
      return await git(e.repo, ['commit-tree', tree, '-p', parent, '-m', message]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
  private async commitFolder(e: Entry, files: Map<string, Buffer>): Promise<void> {
    const branch = `deep/attempt/${e.n}`;
    const commit = await this.commit(e, e.base, files, `Acceptance tests for #${e.n}, written blind\n\nPart of #${e.n}`);
    // Only where no such branch is: an attempt's first commit is never put over anything.
    await git(e.repo, ['update-ref', `refs/heads/${branch}`, commit, '0'.repeat(40)]);
    e.branch = branch;
    e.commit = commit;
    await this.o.append('attempt.started', { issue: e.issue, branch, commit, base: e.base });
  }

  // ---- Disputes.

  private async redraft(e: Entry, d: Dispute): Promise<void> {
    const criterion = this.criteria(e).find((c) => c.tag === d.criterion)!;
    const file = d.test.split(' › ')[0]!;
    const rec = await this.submit(e, this.prompt(e, { file, criterion }), [...e.inputs, { kind: 'criterion', ref: criterion.tag, sha256: sha256(criterion.text) }]);
    d.jobs.push(rec.job);
    e.jobs.push(rec.job);
    await this.save(e);
  }
  /** A redraft's standing: how it does on the work and on the base, as the hub runs them. */
  private async draft(e: Entry, d: Dispute, job: string): Promise<Draft> {
    const broken = (why: string): Draft => ({ job, on_work: 'broken', misses: why, why });
    const file = d.test.split(' › ')[0]!;
    const left = await this.left(await this.o.runner().wait(job), e);
    if (typeof left === 'string') return broken(left);
    const bytes = left.get(file);
    if (!bytes || left.size > 1) return broken(`it wrote ${[...left.keys()].join(', ') || 'nothing'}, not ${file} alone`);
    const tags = (text: string): string[] => [...text.matchAll(new RegExp(`#${e.n}\\.[0-9a-f]{8}`, 'g'))].map(([tag]) => tag);
    const held = await git(e.repo, ['cat-file', 'blob', `${d.work}:${file}`]).catch(() => '');
    const lost = tags(held).find((tag) => !tags(bytes.toString('utf8')).includes(tag));
    if (lost) return broken(`it drops ${lost}, which ${file} holds`);
    const work = await this.run(e, d.work, left, file);
    const on_work = work.outcome === 'passed' && work.testsRun > 0 ? 'passes' : work.outcome === 'failed' ? 'fails' : 'broken';
    const base = await this.run(e, e.base, left, file);
    const proof = baseProof(base, { own: [this.folder(e)] });
    const unchanged = NO_CHANGE.test(this.criteria(e).find((c) => c.tag === d.criterion)!.text);
    return { job, on_work, misses: unchanged || proof.on_assertion ? null : proof.why, why: work.failures[0]?.message.slice(0, 300) ?? work.outcome };
  }
  /** Draft by draft to an outcome: a redraft that fails on the work sides with the test; two that pass decide against it. */
  private async settle(e: Entry, d: Dispute): Promise<void> {
    const file = d.test.split(' › ')[0]!;
    while (d.drafts.length < d.jobs.length) {
      const draft = await this.draft(e, d, d.jobs.at(-1)!);
      d.drafts.push(draft);
      await this.save(e);
      if (draft.on_work === 'broken') return this.ask(e, d, `draft ${draft.job} is no draft: ${draft.misses ?? draft.why}`);
      if (d.drafts.length === 1 && draft.on_work === 'passes') await this.redraft(e, d);
    }
    const passing = d.drafts.filter((x) => x.on_work === 'passes');
    if (passing.length < 2) return this.settled(e, d, 'stands');
    d.refused = passing.filter((x) => x.misses).map((x) => ({ job: x.job, test: d.test, why: x.misses! }));
    const kept = passing.find((x) => !x.misses);
    if (!kept) return this.ask(e, d, `no draft of ${file} meets the base rule`);
    if (!this.o.gateKey) return this.ask(e, d, 'two drafts agree against the test, and no gate identity can sign the swap');
    d.commit = await this.swap(e, d, kept, true);
    return this.settled(e, d, 'swapped');
  }
  private async settled(e: Entry, d: Dispute, outcome: 'stands' | 'swapped' | 'asked'): Promise<void> {
    d.outcome = outcome;
    await this.save(e);
  }
  /** The kept draft in place of the test, on top of the branch; `signed`, with the gate identity's tag, which the guard takes for this folder alone. */
  private async swap(e: Entry, d: Dispute, draft: Draft, signed: boolean): Promise<string> {
    const file = d.test.split(' › ')[0]!;
    const rec = await this.o.runner().status(draft.job);
    const head = await git(e.repo, ['rev-parse', `refs/heads/${e.branch!}`]);
    const commit = await this.commit(e, head, new Map([[file, readFileSync(join(rec.folder, file))]]), `Swap the disputed test of #${e.n} for its blind redraft\n\nTwo drafts agreed on the work against ${d.criterion}.\n\nPart of #${e.n}`);
    await git(e.repo, ['update-ref', `refs/heads/${e.branch!}`, commit, head]);
    if (signed) await git(e.repo, ['-c', 'gpg.format=ssh', '-c', 'gpg.ssh.program=ssh-keygen', '-c', `user.signingkey=${this.o.gateKey!}`, 'tag', '-s', '-m', `Approves: ${file}`, `deep/gate/${e.n}/${commit.slice(0, 12)}`, commit]);
    return commit;
  }
  /** The one ask a dispute can raise, carrying every draft. The issue gives up its slot while it waits, and the next ready issue runs in it. */
  private async ask(e: Entry, d: Dispute, why: string): Promise<void> {
    const drafts = d.drafts.map((x) => `${x.job} ${x.on_work} on the work${x.misses ? `, ${x.misses}` : ''}`).join('; ');
    const question = `The dispute on ${d.test} in ${e.issue} can't settle by itself: ${why}. The first draft is ${e.jobs[0]!}. Redrafts: ${drafts}. Keep the test as it stands?`.slice(0, 8000);
    const takeable = d.drafts.filter((x) => x.on_work === 'passes' && !x.misses);
    const options = [
      { id: 'keep', label: 'Keep the test as it stands', decision: 'none' },
      ...takeable.map((x) => ({ id: x.job, label: `Take draft ${x.job}; you sign the swap`, decision: 'none' })),
      { id: 'hold', label: 'Hold the issue out of its slot', decision: 'none' },
    ];
    d.ask = await this.o.asks().raise(this.o.core, 'acceptance.dispute', {
      kind: 'exception', question, options, recommended: 'keep', default: 'keep', deadline: this.o.now() + 2 * 86_400_000, fallback: 'you', provisional: false, owner: 'you',
      key: sha256(`acceptance.dispute ${e.issue} ${d.test}`), pinned_to: { kind: 'commit', ref: d.work },
    });
    e.slot = false;
    await this.settled(e, d, 'asked');
    await this.pump();
  }
}
