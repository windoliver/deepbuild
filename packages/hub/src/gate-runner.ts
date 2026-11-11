// The gate runner in the hub (#29; design: An agent says it's done): a claim's checks run on its snapshot, in a
// temporary checkout of its own, never the live worktree; each is admitted to the fast lane when it fits the stop's
// budget, counted from the stop with the snapshot and checkout, the wait for a CPU slot behind the checks already
// admitted, and its expected time, `on_base: fails` checks first and then the rest, shortest first; the rest wait in
// the slow lane. The stop's hold replies once, when every admitted check has ended or the hold ends; slow checks join
// the queue only once the fast lane is green and the reply ends the turn, and the newest snapshot wins the queue. Each
// check's verdict is made from its recorded runs by the verdict engine (claimVerdict, #30), and every stop's held time is recorded
// with its split. A looping session's slow checks are held in their places until the loop pauses for them, a claim or
// your words start them (#965; design: A loop's turn end isn't a hand-back), and background work the session still runs
// holds them until it ends, at most 30 minutes from the stop (#907); each held place is recorded as `check.held`. The
// snapshot, every checkout and a fix check's run on the merge base come from the base-commit service (#31). A slow run a
// newer claim outdates is recorded stale only when that claim's snapshot changed its check's inputs, by tree (#45). Pure
// rules live in @deepbuild/gate; this module drives them with the hub's runs and record.
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { baseProof, claimVerdict, ownChanges, ownRead, OverBudget, runnerConfig, type Checkouts, type ClaimRequirement, type DeclaredSurface, type JudgeFault, type RecordedRun, type StandIn, type TempCheckout } from '@deepbuild/gate';
import { sha256Hex } from '@deepbuild/contracts';
import { ulid, type Connection, type EventInput } from '@deepbuild/record';
import type { BaseResult, Result, Verdict } from '@deepbuild/verdicts';
import type { Plant } from './plant.js';
import { contents, EMPTY, installsOf, keptRecord, keyId, keyPaths, namesOf, plain, repoOf, SharedRuns, stemOf, withheld, type KeyFacts, type Source } from './shared-runs.js';
import type { StackWant } from './stacks.js';

/** The surface a drafted check declares it enters through (#874): #31's shape, its check the requirement's own. */
export type Surface = { kind: string } & Record<string, unknown>;
/**
 * A check of a claim, as the definition locks it: its approved bytes, the command its run is, the requirements it
 * covers, its lane facts and the assertions it names; with them the requirement it judges and the surface it declares, for a stand-in on a base
 * with nothing to start (#874).
 */
export interface ClaimCheck {
  check: string;
  /** The approved bytes its run is written from, by digest; null for a check that is a command alone, as the repo's spec checks are. */
  approved: string | null;
  command: string; covers: string[]; depth: 'unit' | 'integration' | 'journey' | 'live'; on_base: 'fails' | 'passes'; asserts: string[]; expected_ms?: number; deadline_ms?: number; req?: string; surface?: Surface | null;
  /** Whose check it is (#322): the repo's spec, the task's definition, or the agent's own, as a command its final message told you to run (#323). */
  source?: 'spec' | 'definition' | 'own';
  /** The expected outputs it references, each written from its approved bytes beside the check (#322). */
  references?: { path: string; sha256: string }[];
  /** False for a result that is never a send-back: the definition still to lock, or held by a cause outside the code. */
  holds?: boolean;
  /**
   * The commit it runs on instead of the claim's snapshot (#325): a release check's, the PR's head merged with main.
   * It runs in the slow lane, once per commit: a later claim on the same commit reuses its run.
   */
  commit?: string;
  /** The clean runs it needs (#1018), one when absent; its held-out variants, each file by its digest in the store. */
  runs?: number; held_out?: { files: Record<string, string> }[];
  /** A timing check (#352): a run that fails while the machine's load is past its core count is rerun alone once. */
  timing?: boolean;
  /** A document check's deliverable, by doc ID (#1723): the merge base holds no revision of it, so it never runs there. */
  document?: string;
}
/**
 * What a workspace claim's checks read (#67): the digests its verdict pins, the reading each check's checkout holds
 * now, and the reading pinned at the definition's lock, which a run on the base commit reads, so a check of state can
 * be proven: at the base it sees what held when the definition was fixed. Files by their path in the checkout.
 */
export interface StatePin { digests: string[]; files: Record<string, string>; pinned: Record<string, string> }
/** How a claim's definition stands when its checks start (#322): locked; waiting for a lock on its way, which the hold waits for; pending with none; or held by a cause outside the code. */
export type DefinitionState = 'locked' | 'waiting' | 'pending' | { blocked: string };
/**
 * What a run's key is made of, handed with its start (#1018): its stem, the claim's checkout its files are read in, the
 * claim and session it runs for, whether it's a base run or a held-out variant's, and the key when it's known before the
 * run (a base run's, a variant's); a head run's key holds the files it reads, known once it ends.
 */
export interface RunKey { check: string; stem: string; dir: string; claim: string; session: string; base: boolean; withheld: boolean; id?: string; paths?: string[] }
export interface GateOptions {
  raw(query: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  now: () => number;
  append(connection: Connection, input: EventInput): Promise<void>;
  core: Connection;
  /** Starts one run of a claim's check in `cwd`, in its lane with its expected time; resolves with its run handle. */
  start(r: { claim: string; check: string; approved: string | null; command: string; commit: string; cwd: string; lane: 'fast' | 'slow'; expected_ms: number | null; deadline_ms: number | null; env?: Record<string, string>; hosts?: string[]; standIns?: string[]; references?: { path: string; sha256: string }[]; overlay?: Record<string, string>; key?: RunKey; stack?: StackWant }): Promise<string>;
  /** The start a check's stack needs now, added to its expected time (#580). */
  stackStart?(folder: string, worktree: string): Promise<number>;
  /** The planted wrong program's start of a stack at a claim, whatever its lane. */
  startsAtClaim?(folder: string, session: string, worktree: string): Promise<void>;
  /** Whether a checkout's done.yaml has an environment, so a journey there runs on its warm stack (#580). */
  stacked?(folder: string): boolean;
  /** Resolves with the run's outcome once it has finished. */
  ended(run: string): Promise<string>;
  /** CPU slots free now. */
  slots(): { free: number };
  budget_ms: number;
  hold_ms: number;
  /** Background work held a session's slow checks for 30 minutes and they start now, the work still running (#907). */
  capped?(session: string, checks: string[]): void;
  /** A run of the claim ended: its verdict as it now stands is read and, once made, recorded (#30). */
  judged?(claim: string): Promise<void>;
  /** The base-commit service (#31): every checkout a claim's checks run in comes from it. */
  checkouts(): Checkouts;
  /** Records the INCONCLUSIVE verdict of a claim whose snapshot went over its budget (#31). */
  invalid(claim: string, commit: string, reason: string, outcome?: 'INVALID' | 'INCONCLUSIVE'): Promise<void>;
  /** Whether the hub is stopping: what that cuts short says nothing about the claim. */
  stopping(): boolean;
  /** Records the stand-in a requirement's check was proven on (#874): the surface it enters through and the stand-in's hash. */
  stoodIn(r: { task: string; req: string; surface: Surface; hash: string }): Promise<void>;
  /** Whether the store still keeps every piece of evidence named: a run whose evidence is pruned never carries (#1018). */
  kept?(evidence: string[]): Promise<boolean>;
  /** The machine's 1-minute load and the cores it is read against, for a timing check's failed run (#352); a runner without it reruns nothing. */
  load?(): { load: number; cores: number };
  plant?: Plant | undefined;
}
/**
 * A green stop's loop reading beside its background work (#965): its session, the origin of the prompt that opened its
 * turn, the soonest wake-up or cron job due, and what starts its checks whatever the loop does: a claim the agent made
 * in the turn, or your words since the last turn end. With none, the turn isn't a loop's.
 */
interface LoopReading { session: string; origin: string | undefined; due: { at: number; what: 'wake-up' | 'cron' } | null; starter: 'claim' | 'words' | 'answer' | null }
/** What started a held place, as the record names it (#965). */
type StartedBy = 'loop_paused' | 'cap' | 'claim' | 'words' | 'answer';
/** A held place as the record has it (`check.held`), the scheduler's HeldRecord. */
interface HeldRecord { session: string; claim: string; check: string; snapshot: string; held_at: number; reason: string; started_at: number | null; started_by: StartedBy | null; replaced_by: string | null }
/** The longest background work holds a stop's slow checks, from that stop (#907). */
const BACKGROUND_MS = 30 * 60_000;
/** A prompt no fact foresees counts as coming within this long of the stop's reply (design: a proposal until the dogfood week). */
const GRACE_MS = 60_000;
/** The origins that make a session loop: a prompt nobody typed. */
const AUTOMATIC = new Set(['continuation', 'scheduled', 'subagent', 'session', 'unknown']);
/** Those whose next prompt no fact foresees; a Codex goal's continuation too, until the hub reads its goal (#39). */
const UNFORESEEN = new Set(['continuation', 'session', 'unknown']);
/** Ignored dependency folders a checkout gets cloned copy-on-write, so a check starts as it would in the worktree. */
const DEPENDENCIES = ['node_modules', '.venv'];
/** What a journey asks of its stack, which the core gives it when the checkout's done.yaml has an environment (#580). */
const stackOf = (c: Pick<Claim, 'session' | 'cwd'>, check: ClaimCheck, more: Partial<Pick<StackWant, 'base' | 'fresh'>> = {}): { stack?: StackWant } => (check.depth === 'journey' ? { stack: { session: c.session, worktree: c.cwd, on_base: check.on_base, ...more } } : {});
/** The entry that stands for a claim's definition while it hasn't locked (#322): pending, or BLOCKED by a cause outside the code. */
const DEFINITION = 'definition';
const EMPTY_SHA = sha256Hex(new Uint8Array());
/** The fault the kit gate@1 plays on every verdict this hub makes (#33): DEEP_HUB_TEST_JUDGE_FAULT, which only the kit sets; the server refuses a name it doesn't know. */
const JUDGE_FAULT = process.env.DEEP_HUB_TEST_JUDGE_FAULT as JudgeFault | undefined || undefined;
/** The record of a run that never started for a cause outside the code: BLOCKED, naming the cause, yours to clear. */
const missingRun = (run: string, cause: string): RecordedRun => ({
  run, outcome: 'missing', testsRun: 0, failures: [{ test: DEFINITION, file: '', line: 0, stack: null, assertion: false, message: cause }], evidence: [], read: [], mask: null, exit: null,
  output: { stdout: '', stderr: '', sha256: { stdout: EMPTY_SHA, stderr: EMPTY_SHA } }, attempts: [], seeded: [], contract: null,
});

/**
 * A claim's check on one snapshot: its runs, its run on the merge base and the stand-in that run had, its lane, and whether a newer claim outdated it;
 * the key its result is read from (#1018), the base run's source when another claim's, its held-out variants' runs, and whether it waits on another
 * session's run of its key.
 */
interface Entry {
  check: ClaimCheck; claim: string; commit: string; lane: 'fast' | 'slow'; runs: string[]; base: string | null; standIn?: StandIn; outcome: string | null; running: boolean; stale: boolean; ends?: number;
  group?: string; baseFrom?: Source; variants?: string[]; waiting?: boolean; newer?: string;
  /** The readings its carry records (#1018), written after its verdict so the verdict never waits on them. */
  readings?: Promise<void>;
  /** A timing check's run that failed under load (#352): it counts as nothing, and its rerun alone decides. */
  loaded?: { run: string; load: number; cores: number };
}
/** How often a timing check's rerun reads the load again while it waits for the machine to come back under its cores. */
const LOAD_POLL_MS = 1_000;
/** How long that rerun waits at most: past it the check is left short of a counted run, INCONCLUSIVE, never passed. */
const LOAD_WAIT_MS = 30 * 60_000;
/** A slow check held in its place: what holds it (background work, a due wake-up or cron job, or a prompt within the grace window) and its record. */
interface Held { entry: Entry; why: 'background' | 'due' | 'grace'; record: HeldRecord }
interface Claim { claim: string; session: string; task: string; cwd: string; base: string; snapshot: string; tree: string | undefined; checkout: Promise<TempCheckout> | null; requirements: ClaimRequirement[]; entries: Map<string, Entry>; repo: Promise<string>; installs: Promise<string>; names: Promise<string>; state?: StatePin | undefined; changes?: Changes }
/** What a claim's worktree changed against its merge base when its snapshot was taken, and the test runners' configs it held, each with its text (#33). */
interface Changes { changed: string[]; configs: Map<string, string>; scripts: boolean }
async function changesOf(cwd: string, base: string): Promise<Changes> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const git = (args: string[]): Promise<string[]> => new Promise((done) => execFile('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, env, maxBuffer: 64 << 20 }, (error, out) => done(error ? [] : out.split('\n').filter(Boolean))));
  const [diff, others, tracked] = await Promise.all([git(['diff', '--name-only', '--no-renames', base]), git(['ls-files', '--others', '--exclude-standard']), git(['ls-files'])]);
  const configs = new Map<string, string>();
  for (const path of new Set([...tracked, ...others].filter(runnerConfig))) {
    const text = await readFile(join(cwd, path), 'utf8').catch(() => undefined);
    if (text !== undefined) configs.set(path, text);
  }
  // Whether package.json's scripts changed: the script a check runs is its own.
  const scriptsOf = (text: string | undefined): string => { try { return JSON.stringify((JSON.parse(text ?? '{}') as { scripts?: unknown }).scripts ?? null); } catch { return 'unreadable'; } };
  const scripts = diff.includes('package.json') && scriptsOf((await git(['show', `${base}:package.json`])).join('\n')) !== scriptsOf(await readFile(join(cwd, 'package.json'), 'utf8').catch(() => undefined));
  return { changed: [...new Set([...diff, ...others])].sort(), configs, scripts };
}
/** Run outcomes a key keeps: a result. Missing, stopped and uncounted runs say nothing of the key, so they never carry. */
const KEPT = new Set(['passed', 'failed', 'overran', 'ran_nothing']);
/** A base run that ended as a run: what a fix is proven by, on its key as on its claim. */
const ON_BASE = new Set(['passed', 'failed', 'overran']);
const sessionOf = (session: string): string => `session:${session.replace(/[^0-9A-Za-z]/g, '')}`;
/** Writes a state reading into a checkout, where a check reads it. */
async function hold(dir: string, files: Record<string, string>): Promise<void> {
  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), body);
  }
}

export class GateRunner {
  /** Each session's claims, oldest first. */
  private readonly claims = new Map<string, Claim[]>();
  /** The slow lane's queue: at most one place per session and check, the newest snapshot's. */
  private readonly queue = new Map<string, Entry>();
  /** The held places, at most one per session and check; and the place each newest record stands for, until it starts. */
  private readonly holding = new Map<string, Held>();
  /** Each session's timers on the hub's clock: background work's 30 minutes from the stop, and the grace window from its reply. */
  private readonly caps = new Map<string, number>();
  private readonly graces = new Map<string, number>();
  /** Each run's record as the command check kind closed it (#30), by run handle: what the claim's verdict is made from. */
  private readonly records = new Map<string, RecordedRun>();
  /** Every claim's results by key, across sessions (#1018); and each kept run's key. */
  private readonly shared = new SharedRuns();
  private readonly keyOf = new Map<string, string>();
  /** The keys a restart can't read whole: one of their kept runs lost in the record what makes its verdict, so none carries. */
  private readonly unread = new Set<string>();
  /** The runs going on a key, by the key (a base run's) or by stem and snapshot (a head run's): a run on an equal key waits for it. */
  private readonly going = new Map<string, { done: Promise<void>; session: string }>();
  /** Each worktree's repo, git's common folder, read once: it never changes under a worktree. */
  private readonly repos = new Map<string, Promise<string>>();
  /** Each claim whose definition is still to lock (#322): ends its hold's wait once the lock lands, or a fast check fails. */
  private readonly lockWaits = new Map<string, () => void>();
  /** Each check pinned to a commit that ran, by commit and check: its run and outcome, which a later claim on the same commit reuses (#325). */
  private readonly pinned = new Map<string, { run: string; outcome: string }>();
  constructor(private readonly o: GateOptions) {}

  /** A run's closed record, kept for the verdicts of the claim it ran for. */
  recorded<R extends RecordedRun>(run: string, record: R): R {
    // #669's planted runner reads a masked run by its exit alone: the claim's own run as a clean pass, its report's
    // failures dropped, and a base run by its report, so a check that can't fail proves its fix and passes.
    if (this.o.plant === 'runner-passes-masked-exit' && record.mask !== null) {
      const base = [...this.claims.values()].some((list) => list.some((c) => [...c.entries.values()].some((e) => e.base === run)));
      record = { ...record, mask: null, ...(base ? { outcome: record.failures.length ? 'failed' : 'passed' } : { outcome: 'passed', failures: [] }) };
    }
    this.records.set(run, record);
    return record;
  }
  /**
   * A run's key once it has ended (#1018): a head run's holds the contents of the files it read, in its claim's checkout;
   * a base run's and a variant's were known before it ran. A run that ended as a result joins its key's group, where
   * every claim with an equal key reads it. Returns what run.finished keeps of the key.
   */
  async keyed(key: RunKey, run: string, record: RecordedRun): Promise<KeyFacts> {
    const paths = key.paths ?? (this.o.plant === 'key-leaves-out-reads' ? [] : keyPaths(record.read));
    const id = key.id ?? keyId(key.stem, paths, await contents(key.dir, paths));
    const facts: KeyFacts = { id, stem: key.stem, paths, claim: key.claim, session: key.session, base: key.base, withheld: key.withheld, plain: plain(record) };
    // A head run that read nothing but its check's own files (its script among them) saw none of the code under test, as
    // a program the tracers can't see into reads nothing they record: its key can't tell a change to that code, so it never carries.
    const blind = key.paths === undefined && this.o.plant !== 'key-leaves-out-reads' && !paths.some((p) => p !== key.check && !ownRead(p));
    if (KEPT.has(record.outcome) && !blind) this.keyOf.set(run, this.shared.add(key.check, facts, run).id);
    return facts;
  }
  /** The keys the record keeps, from each run.finished that names one, oldest first: a restarted hub reads them again. */
  kept(rows: { run: string; check: string; outcome: string; tests_run: number; findings: string[]; evidence: string[]; key: KeyFacts }[]): void {
    // A key with a run that isn't whole in the record is read again for none of its runs: those left would decide alone.
    for (const r of rows) if (KEPT.has(r.outcome) && !r.key.plain) this.unread.add(`${r.check}\0${r.key.id}`);
    for (const r of rows) {
      if (!KEPT.has(r.outcome) || this.unread.has(`${r.check}\0${r.key.id}`)) continue;
      if (!this.records.has(r.run)) this.records.set(r.run, keptRecord(r.run, r));
      this.keyOf.set(r.run, this.shared.add(r.check, r.key, r.run).id);
    }
  }
  private repoOf(cwd: string): Promise<string> {
    let repo = this.repos.get(cwd);
    if (!repo) this.repos.set(cwd, repo = repoOf(cwd));
    return repo;
  }
  /** The stem of a check's key on a claim: on the merge base when `base` names it (#1018). */
  private async stemOf(c: Claim, e: Entry, base: string | null): Promise<string> {
    // A base run's tree is the merge base's with the check's own files, so the snapshot's names say nothing of it. A
    // workspace's check reads its state (#67): a base run the reading pinned at the lock, a head run the one now.
    const state = base === null ? c.state?.files : c.state?.pinned;
    return stemOf({
      repo: await c.repo, check: e.check.check, approved: e.check.approved, command: e.check.command, deadline_ms: e.check.deadline_ms ?? null, held_out: e.check.held_out ?? null, references: e.check.references ?? null,
      installs: await c.installs, names: base === null ? await c.names : null, base, ...(state ? { state } : {}),
      ...(this.o.plant === 'keys-runs-by-session' ? { session: c.session } : {}),
    });
  }
  /** A key's runs as a claim reads them: every claim's, or, in the planted store, the newest alone. */
  private runsOn(id: string): Source[] {
    const runs = this.shared.group(id)?.runs ?? [];
    return this.o.plant === 'keeps-latest-result-per-key' ? runs.slice(-1) : runs;
  }
  /**
   * Whether a key's result is known for a check: its held-out variants have each run on it, and it holds a failure, a
   * run that ran nothing, or the clean runs it needs. A key whose variants are still to run, or never ran, isn't.
   */
  private decided(e: Entry, id: string): boolean {
    const runs = this.runsOn(id);
    // A claim runs its check and then each variant once, so a key is whole when one claim's check run and all its variants
    // are on it: other claims' runs of a variant never stand in for another, and variants never stand in for the check.
    const variants = e.check.held_out?.length ?? 0;
    if (!runs.some((s) => !s.withheld && runs.filter((x) => x.withheld && x.claim === s.claim).length >= variants)) return false;
    const outcomes = runs.map((s) => this.records.get(s.run)?.outcome);
    return outcomes.some((o) => o === 'failed' || o === 'overran' || o === 'ran_nothing') || outcomes.filter((o) => o === 'passed').length >= (e.check.runs ?? 1);
  }
  /**
   * The check's result read from its key (#1018): a group under its stem whose files hold in the claim's checkout what
   * they held for it, with its result known, is read as carried and no run starts. Otherwise the run going on an equal
   * key, by stem and snapshot, is what the check waits for; null when there is none and the check runs on its own.
   */
  private async carry(c: Claim, e: Entry, dir: string): Promise<'carried' | { wait: Promise<void> } | null> {
    // #33's planted gate reads no result it had for a head whose inputs didn't change: each claim's runs stand alone.
    if (this.onStack(e, dir) || this.o.plant === 'empty-commit-run-alone') return null;
    const stem = await this.stemOf(c, e, null);
    for (const g of await this.shared.find(e.check.check, stem, dir)) {
      if (this.unread.has(g.id)) continue;
      await this.prune(g.id);
      // Results are shared across sessions: a later claim of the session that ran a key runs its own, as it did before.
      if (!this.runsOn(g.id).some((s) => s.session !== sessionOf(c.session))) continue;
      if (!this.decided(e, g.id)) continue;
      e.group = g.id;
      e.outcome = this.runsOn(g.id).every((x) => this.records.get(x.run)?.outcome === 'passed') ? 'passed' : 'carried';
      e.readings = this.saved(c, this.runsOn(g.id));
      return 'carried';
    }
    const going = this.going.get(`${stem}\0${c.snapshot}`);
    return going && going.session !== sessionOf(c.session) ? { wait: this.waited(c, going) } : null;
  }
  /**
   * Takes off a key each run whose output is no longer kept, which then counts for its own claim alone: a result is
   * pruned with its evidence (#1018, under #31's retention).
   */
  private async prune(id: string): Promise<void> {
    for (const s of [...this.shared.group(id)?.runs ?? []]) {
      if (await this.keptAll([s])) continue;
      this.shared.drop(id, s.run);
      this.keyOf.delete(s.run);
    }
  }
  /** Whether every run's output is still kept: a result is pruned with its evidence (#1018, under #31's retention). */
  private async keptAll(runs: Source[]): Promise<boolean> {
    if (!this.o.kept) return true;
    const evidence = runs.flatMap((s) => { const o = this.records.get(s.run)?.output.sha256; return o ? [o.stdout, o.stderr].filter((x) => x !== EMPTY) : []; });
    return this.o.kept(evidence);
  }
  /**
   * The readings sharing makes, per repo (#1018): a check read as carried from another session's runs saves a run, and
   * the slot time its first such run took; a check that waits on another session's run counts, with how long it waited.
   */
  private async reading(c: Claim, what: string, value: number, unit: string): Promise<void> {
    const ts = this.o.now();
    const id = ulid(ts);
    await this.o.append(this.o.core, { v: 1, id, kind: 'reading.recorded', ts, data: { reading: `reading:${id}`, value, unit, as_of: ts, source: `${what} · ${await c.repo}`, n: 1, outside: false } }).catch(() => undefined);
  }
  private async saved(c: Claim, runs: Source[]): Promise<void> {
    const other = runs.find((s) => s.session !== sessionOf(c.session));
    if (!other) return;
    const [row] = (await this.o.raw(`SELECT ended - started AS ms FROM runs WHERE id = ? AND ended IS NOT NULL`, [other.run.slice(4)]).catch(() => [])) as { ms: number }[];
    await this.reading(c, 'runs saved by carrying across sessions', 1, 'runs');
    await this.reading(c, 'slot time saved by carrying across sessions', Math.max(0, Number(row?.ms ?? 0)), 'ms');
  }
  /** The wait on another session's run going on an equal key, recorded as a reading once it ends. */
  private waited(c: Claim, going: { done: Promise<void>; session: string }): Promise<void> {
    const from = this.o.now();
    return going.done.then(async () => {
      await this.reading(c, "runs that waited on another session's run", 1, 'runs');
      await this.reading(c, "time waited on another session's run", Math.max(0, this.o.now() - from), 'ms');
    });
  }
  /**
   * Whether the check's runs in `dir` are a journey's on its warm stack (#580): what the app it serves reads is no file
   * of the run's, so they have no key (#1018), never carry and are never waited for.
   */
  private onStack(e: Entry, dir: string): boolean {
    return e.check.depth === 'journey' && (this.o.stacked?.(dir) ?? false);
  }
  /** Marks a run going on `key` until `done` settles: runs on an equal key wait for it. */
  private goingOn(key: string, session: string, done: Promise<unknown>): void {
    const going = { done: done.then(() => undefined, () => undefined), session };
    this.going.set(key, going);
    void going.done.then(() => { if (this.going.get(key) === going) this.going.delete(key); });
  }
  /**
   * A check's own run on its snapshot, keyed by the files it reads (#1018), and then its held-out variants, each in a
   * checkout of its own with its files written over the snapshot's; each variant's run counts as a run of its check, on
   * its key, and is never shown to the agent. Every other claim reading the key is judged again.
   */
  private async runOwn(c: Claim, e: Entry, dir: string, lane: 'fast' | 'slow', expected: number | null, ran?: (run: string) => void): Promise<void> {
    const stem = await this.stemOf(c, e, null);
    const key: RunKey = { check: e.check.check, stem, dir, claim: c.claim, session: sessionOf(c.session), base: false, withheld: false };
    // A timing check's result is the machine's load's as much as its files', so its runs land on no key and never carry (#352).
    const shared = !this.onStack(e, dir) && !e.check.timing;
    const own = (async () => {
      const start = () => this.o.start({ claim: e.claim, check: e.check.check, approved: e.check.approved, command: e.check.command, commit: e.commit, cwd: dir, lane, expected_ms: expected, deadline_ms: e.check.deadline_ms ?? null, ...(e.check.references ? { references: e.check.references } : {}), ...stackOf(c, e.check), ...(shared ? { key } : {}) });
      const run = await start();
      e.runs.push(run);
      ran?.(run);
      // A journey's uncounted run gets its one more (#580); a timing check's failure under load, its run alone (#352).
      const ended = await this.retried(c, e, dir, await this.o.ended(run));
      e.outcome = await this.alone(e, e.runs.at(-1)!, ended, start);
      const id = this.keyOf.get(e.runs.at(-1)!);
      if (id) e.group = id;
      if (KEPT.has(e.outcome)) await this.variants(c, e, id, lane);
    })();
    if (shared) this.goingOn(`${stem}\0${c.snapshot}`, key.session, own);
    await own;
    if (e.group) await this.rejudge(e.group, c.claim);
  }
  /** The held-out variants of a check whose run ended: each a run of its own, on the key `id` when it landed on one, its output withheld. */
  private async variants(c: Claim, e: Entry, id: string | undefined, lane: 'fast' | 'slow'): Promise<void> {
    const g = id ? this.shared.group(id) : undefined;
    for (const [i, v] of (e.check.held_out ?? []).entries()) {
      const token = `${e.claim} ${e.check.check} variant ${i + 1}`;
      // A variant that can't be checked out or started is a missing run of its check, never one left out.
      const t = await this.o.checkouts().checkout({ worktree: c.cwd, commit: c.snapshot, dependencies: DEPENDENCIES, runs: [token] }).catch((error: unknown) => this.unrun(e, error));
      if (!t) continue;
      try {
        if (c.state) await hold(t.dir, c.state.files);
        const go = async (fresh: boolean): Promise<string> => {
          const run = await this.o.start({
            claim: e.claim, check: e.check.check, approved: e.check.approved, command: e.check.command, commit: e.commit, cwd: t.dir, lane, expected_ms: null, deadline_ms: e.check.deadline_ms ?? null,
            ...(e.check.references ? { references: e.check.references } : {}), ...stackOf(c, e.check, fresh ? { fresh } : {}), overlay: v.files, ...(g ? { key: { check: e.check.check, stem: g.stem, dir: t.dir, claim: c.claim, session: sessionOf(c.session), base: false, withheld: true, id: g.key, paths: g.paths } } : {}),
          });
          (e.variants ??= []).push(run);
          const outcome = await this.o.ended(run);
          return outcome === 'uncounted' ? this.records.get(run)?.mask ?? outcome : '';
        };
        // A journey's variant whose stack served another tree runs once more on a fresh stack, as its check's run does
        // (#580); one that still didn't count is missing, so its check never passes without it.
        let uncounted = await go(false);
        if (uncounted && e.check.depth === 'journey' && !e.stale) uncounted = await go(true);
        if (uncounted) this.unrun(e, Error(`its run didn't count: ${uncounted}`));
      } catch (error) {
        this.unrun(e, error);
      } finally {
        await this.o.checkouts().ended(t, token);
      }
    }
  }
  /** A held-out variant's run that never started: recorded missing on its check, so the check never passes without it. */
  private unrun(e: Entry, error: unknown): undefined {
    const ts = this.o.now();
    const run = `run:${ulid(ts)}`;
    const message = `a held-out variant never ran: ${error instanceof Error ? error.message : String(error)}`;
    this.records.set(run, { run, outcome: 'missing', testsRun: 0, failures: [{ test: 'held-out variant', file: '.', line: 1, stack: null, assertion: false, message }], evidence: [], read: [], mask: null, exit: null, output: { stdout: '', stderr: '', sha256: { stdout: EMPTY, stderr: EMPTY } }, attempts: [], seeded: [], contract: null });
    (e.variants ??= []).push(run);
    return undefined;
  }
  /** Runs landed on a key: every other claim whose check reads it is judged again. */
  private async rejudge(id: string, from: string): Promise<void> {
    for (const c of [...this.claims.values()].flat()) {
      if (c.claim !== from && [...c.entries.values()].some((e) => e.group === id)) await this.o.judged?.(c.claim);
    }
  }
  /** A check's last run on the snapshot; for a carried result, its key's first run of the check itself, never a held-out variant's (#1018). */
  private headOf(e: Entry): RecordedRun | undefined {
    const last = e.runs.length ? e.runs[e.runs.length - 1] : e.group ? this.runsOn(e.group).find((s) => !s.withheld)?.run : undefined;
    return last ? this.records.get(last) : undefined;
  }
  /** The files the claim changed that are the check's own, by what its last run on the snapshot read (#33). */
  private ownChanged(c: Claim, e: Entry): string[] {
    if (!c.changes || e.check.check === DEFINITION) return [];
    const plant = this.o.plant === 'edited-check-approved' || this.o.plant === 'own-files-test-folders-only' ? this.o.plant : undefined;
    return ownChanges(c.changes, this.headOf(e)?.read ?? [], plant);
  }
  /** The files a check's last run on the snapshot read under the test, fixture and script folders: its own (#875). */
  private ownOf(e: Entry): string[] {
    return this.headOf(e)?.read.filter(ownRead) ?? [];
  }
  /**
   * The files the claim's checks read on its snapshot (#324): what a check reaches, from each one's last run there, or
   * for a carried result its key's first run (#1018). Undefined while any of them has no recorded run yet, since a file one would reach can't be told from one it won't;
   * none for a claim with no check.
   */
  reached(claim: string): string[] | undefined {
    const c = this.claimOf(claim);
    if (!c) return undefined;
    const read = new Set<string>();
    for (const e of c.entries.values()) {
      const last = this.headOf(e);
      if (!last) return undefined;
      for (const path of last.read) read.add(path);
    }
    return [...read].sort();
  }
  /**
   * How a fix check ran on the merge base (#31), from that run's record, and why a failure there proves nothing: it
   * proves the fix only by failing at an assertion its check names (#875), never before its tests ran or elsewhere. A
   * base run that never ended as a run (missing, stopped, uncounted) is no run on the base.
   */
  private baseOf(e: Entry): { base: BaseResult; why: string | null } | undefined {
    const r = e.base === null ? undefined : this.records.get(e.base);
    if (!r || (r.outcome !== 'passed' && r.outcome !== 'failed' && r.outcome !== 'overran')) return undefined;
    if (e.standIn && r.outcome === 'passed' && this.o.plant === 'stand-in-pass-proves') return { base: { outcome: 'failed', on_assertion: true, failed_tests: [] }, why: null };
    const outcome = r.outcome === 'passed' ? 'passed' : 'failed';
    const proof = baseProof(r, { own: this.ownOf(e), asserts: e.check.asserts }, this.o.plant === 'any-nonzero-base-exit' ? this.o.plant : undefined);
    return { base: { outcome, on_assertion: proof.on_assertion, failed_tests: [...new Set(r.failures.map((f) => f.test))] }, why: outcome === 'failed' ? proof.why : null };
  }
  /**
   * The claim's verdict as it stands: its checks' recorded runs judged by the verdict engine through the gate's
   * claimVerdict (#30), each check ended once no run of it is going or queued; undefined for a claim this runner
   * never saw. Pending while runs are still to come.
   */
  verdictOf(claim: string): Verdict | undefined {
    const c = this.claimOf(claim);
    if (!c) return undefined;
    const queued = new Set(this.queue.values());
    // What a base run failed to prove, by name: the engine says only that it failed off its named assertions.
    const whys: string[] = [];
    // What the claim read as carried from another claim's runs (#1018), naming each run, its claim and its session.
    const carried: string[] = [];
    // Each approved check whose own files the claim changed counts as the agent's own, naming them (#33; design: Whose checks count).
    const owns: string[] = [];
    const v = claimVerdict({
      claim: c.claim, agent: sessionOf(c.session), repo: c.cwd, task: c.task, commit: c.snapshot, requirements: c.requirements, now: this.o.now(), ...(c.state ? { state: c.state.digests } : {}),
      checks: [...c.entries.values()].map((e) => {
        const { base, why } = this.baseOf(e) ?? {};
        if (why) whys.push(`${e.check.check} ${why}`);
        const mine = e.check.source === 'own' ? [] : this.ownChanged(c, e);
        if (mine.length) owns.push(`${e.check.check} counts as the agent's own: the claim changed ${mine.join(', ')}, which it loads`);
        return {
          check: e.check.check, command: e.check.command, source: mine.length ? 'own' as const : e.check.source ?? 'definition' as const, covers: [...e.check.covers], depth: e.check.depth,
          ...(e.check.runs !== undefined ? { needed: e.check.runs } : {}),
          runs: this.runsOf(c, e, carried),
          ...(base ? { base } : {}),
          // Running while going, queued or waiting on another session's run; ended once runs exist or its key's result is read, and none goes; never
          // started once a newer claim took its place.
          ...(e.running || e.waiting || queued.has(e) ? { state: 'running' as const } : e.runs.length || e.group ? { state: 'ended' as const } : e.stale ? { state: 'never_started' as const, never_started: 'newer_claim' as const } : {}),
        };
      }),
    }, { ...(JUDGE_FAULT ? { fault: JUDGE_FAULT } : {}), ...(this.o.plant === 'verdict-from-exit-status' ? { plant: 'exit-code-only' as const } : {}) });
    for (const e of c.entries.values()) {
      if (e.base && e.baseFrom && e.baseFrom.claim !== c.claim) carried.push(`${e.check.check} carried its base run ${e.baseFrom.run} from ${e.baseFrom.claim} in ${e.baseFrom.session}`);
    }
    // The run under load stays attached to the verdict, with its reading (#352).
    const loaded = [...c.entries.values()].flatMap((e) => (e.loaded ? [`${e.check.check}'s ${e.loaded.run} failed at a load of ${e.loaded.load} on ${e.loaded.cores} cores and counts as neither a pass nor a failure; its rerun alone decides`] : []));
    const reasons = [...(v.outcome === 'INVALID' ? whys : []), ...v.reasons, ...owns, ...carried, ...loaded];
    return reasons.length === v.reasons.length ? v : { ...v, reasons };
  }
  /**
   * A check's runs as the claim reads them: every run on its key, from any claim and session, each counted once, and its
   * own runs that ended as no result; a held-out variant's run as its outcome and counts alone. Each run of another
   * claim's is named in `carried`.
   */
  private runsOf(c: Claim, e: Entry, carried: string[]): RecordedRun[] {
    const on = e.group ? this.runsOn(e.group).filter((s) => this.o.plant !== 'empty-commit-run-alone' || s.claim === c.claim) : [];
    const loose = [...e.runs, ...e.variants ?? []].filter((run) => !this.keyOf.has(run)).map((run) => ({ run, claim: c.claim, session: sessionOf(c.session), withheld: (e.variants ?? []).includes(run) }));
    // The planted counter counts a shared run once for each claim that reads it.
    const readers = this.o.plant === 'counts-shared-run-per-claim' && e.group ? [...this.claims.values()].flat().filter((x) => [...x.entries.values()].some((y) => y.group === e.group)).length : 1;
    const runs: RecordedRun[] = [];
    for (const s of [...on, ...loose]) {
      const recorded = this.records.get(s.run);
      if (!recorded) continue;
      // A timing check's run under load counts as neither a pass nor a failure (#352).
      const r = e.loaded?.run === s.run ? { ...recorded, outcome: 'uncounted' as const } : recorded;
      if (s.claim !== c.claim) carried.push(`${e.check.check} carried ${s.withheld ? "a held-out variant's verdict, " : ''}${s.run} from ${s.claim} in ${s.session}`);
      const shown = s.withheld && !(this.o.plant === 'carry-copies-evidence' && s.claim !== c.claim) ? withheld(r) : r;
      for (let i = 0; i < (on.includes(s) ? readers : 1); i++) runs.push(i ? { ...shown, run: `${shown.run}x${i}` } : shown);
    }
    return runs;
  }
  /** A check whose run couldn't start, its snapshot's checkout or its start refused: one missing run, naming why (#31). */
  private cantStart(e: Entry, error: unknown): void {
    const run = `run:${ulid(this.o.now())}`;
    this.records.set(run, missingRun(run, `${e.check.check} couldn't start: ${error instanceof Error ? error.message : String(error)}`));
    e.runs.push(run);
  }
  /** The commit a claim's checks run on: its snapshot, once taken (#1537: what its review reads the diff to). */
  snapshotOf(claim: string): string | undefined { return this.claimOf(claim)?.snapshot; }
  private claimOf(claim: string): Claim | undefined {
    for (const list of this.claims.values()) { const c = list.find((x) => x.claim === claim); if (c) return c; }
    return undefined;
  }

  /** The median of a check's last clean runs on this machine, from the record, leaving out each run's stack start (#580); null before it has run clean. */
  private async expectedMs(check: string): Promise<number | null> {
    const rows = (await this.o.raw(`SELECT id, ended - started AS ms FROM runs WHERE check_id = ? AND outcome = 'passed' AND ended IS NOT NULL ORDER BY ended DESC LIMIT 5`, [check])) as { id: string; ms: number }[];
    if (!rows.length) return null;
    const started = (await this.o.raw(`SELECT json_extract(data, '$.run') AS run, json_extract(data, '$.ready_ms') AS ms FROM events WHERE kind = 'stack.served' AND json_extract(data, '$.run') IN (${rows.map(() => '?').join(', ')})`, rows.map((r) => r.id))) as { run: string; ms: number }[];
    const sorted = rows.map((r) => Number(r.ms) - (started.find((s) => s.run === r.id)?.ms ?? 0)).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  }

  /**
   * A claim made at a stop: its snapshot and checkout, its checks taken in turn for the fast lane, the rest left to
   * the slow lane. Resolves once the fast lane has ended or the hold has, with the claim's checks as they stand.
   */
  async stop(r: { session: string; claim: string; task: string; cwd: string; base: string; requirements: ClaimRequirement[]; checks: ClaimCheck[]; stopAt: number; definition?: DefinitionState; joins?: boolean; same?: boolean; state?: StatePin }): Promise<{ fast: string[]; slow: string[]; snapshot: string; readyAt: number; budgetCost: string[]; changed: boolean }> {
    // The snapshot and the checkout share one budget (#31): past it the claim is INCONCLUSIVE, naming the reason and
    // the count of untracked files, and none of its checks runs, in the live worktree or anywhere.
    const budget = this.o.checkouts().budget();
    // What its keys' stems name (#1018), read beside the snapshot and checkout where it can be: its repo, once per
    // worktree; the installs its checkouts clone from the worktree; and the names of the files its checkout holds.
    const repo = this.repoOf(r.cwd);
    let installs: Promise<string> | undefined;
    // Read beside the snapshot, from the same worktree: whose checks count turns on what the claim changed (#33).
    const changes = changesOf(r.cwd, r.base);
    let snapshot = r.base;
    // Compared by tree: a snapshot of a dirty folder is a new commit even when its files are the last one's.
    let tree: string | undefined;
    let checkout: string | null = null;
    // A session that changed nothing since its last claim (`same`: no call but reads), whose every check ended there,
    // takes that claim's snapshot and no checkout: its results carry, and nothing runs (#82).
    const prior = (this.claims.get(r.session) ?? []).filter((c) => c.claim !== r.claim).at(-1);
    const ended = (e: Entry | undefined) => e !== undefined && !e.running && e.outcome !== null && e.runs.length > 0;
    // What a workspace's checks read is one of their inputs: another reading on the same tree is new work (#67).
    const stated = (t: string | undefined): string | undefined => (t !== undefined && r.state?.digests.length ? sha256Hex(new TextEncoder().encode(`${t}\n${r.state.digests.join('\n')}`)) : t);
    if (r.same && !r.joins && prior?.tree !== undefined && r.checks.length && prior.state?.digests.join() === r.state?.digests.join() && r.checks.every((c) => ended(prior.entries.get(c.check)))) ({ snapshot, tree } = prior);
    // A claim with no check to run yet, its definition still to come, takes no snapshot: nothing would run on it.
    else if (r.checks.length || r.joins) {
      try {
        installs = installsOf(r.cwd);
        ({ commit: snapshot, tree } = await this.o.checkouts().snapshot(r.cwd, budget));
        tree = stated(tree);
        checkout = (await this.o.checkouts().checkout({ worktree: r.cwd, commit: snapshot, dependencies: DEPENDENCIES, runs: [r.claim], budget })).dir;
        if (r.state) await hold(checkout, r.state.files);
      } catch (error) {
        if (!(error instanceof OverBudget)) throw error;
        await this.o.invalid(r.claim, snapshot, error.message, 'INCONCLUSIVE');
        return { fast: [], slow: [], snapshot, readyAt: this.o.now(), budgetCost: [], changed: false };
      }
    }
    const readyAt = this.o.now();
    if (checkout && r.checks.some((c) => c.depth === 'journey')) await this.o.startsAtClaim?.(checkout, r.session, r.cwd);
    const older = (this.claims.get(r.session) ?? []).filter((c) => c.claim !== r.claim);
    // At the lock, the definition's checks join the claim's early run (#322): the claim is the one the spec's checks ran for.
    const joined = r.joins ? this.claimOf(r.claim) : undefined;
    const held = checkout === null ? null : Promise.resolve({ dir: checkout, commit: snapshot });
    const facts = installs && checkout !== null ? { installs, names: namesOf(checkout) } : null;
    const claim: Claim = joined ?? { claim: r.claim, session: r.session, task: r.task, cwd: r.cwd, base: r.base, snapshot, tree, checkout: held, requirements: r.requirements, entries: new Map(),
      repo, installs: facts?.installs ?? Promise.resolve(''), names: facts?.names ?? Promise.resolve(''), state: r.state, changes: await changes };
    const last = older.at(-1)?.tree;
    const changed = r.checks.length > 0 && (tree === undefined || last === undefined || tree !== last);
    if (joined) {
      joined.requirements = r.requirements;
      joined.entries.delete(DEFINITION);
      joined.snapshot = snapshot;
      joined.tree = tree;
      joined.checkout = held ?? joined.checkout;
      if (facts) Object.assign(joined, facts);
      joined.state = r.state;
      joined.changes = await changes;
      this.lockWaits.get(r.claim)?.();
    }
    this.claims.set(r.session, [...older, claim]);
    // A definition still to lock stands as a pending check, so the claim never passes on the spec alone; one held by a
    // cause outside the code, such as the plan window at your reserve, as a check missing it, so the claim is BLOCKED.
    const definition = r.definition ?? 'locked';
    if (definition !== 'locked') {
      const check: ClaimCheck = { check: DEFINITION, approved: null, command: DEFINITION, covers: [], depth: 'unit', on_base: 'passes', asserts: [], holds: false };
      if (definition === 'pending' || definition === 'waiting') claim.entries.set(DEFINITION, { check, claim: r.claim, commit: snapshot, lane: 'fast', runs: [], base: null, outcome: null, running: true, stale: false });
      else {
        const run = `run:${DEFINITION}:${r.claim.replace(/^claim:/, '')}`;
        this.records.set(run, missingRun(run, definition.blocked));
        claim.entries.set(DEFINITION, { check, claim: r.claim, commit: snapshot, lane: 'fast', runs: [run], base: null, outcome: 'missing', running: false, stale: false });
      }
    }
    // Older claims' queued places for the same check give way to this one: the newest snapshot wins the queue. A stop
    // claims once per open task, each reaching here when its own snapshot is done, so an older claim arriving after a
    // newer one gives way to it, never the other way round.
    const superseded = new Set(older.filter((o) => o.claim > r.claim).flatMap((o) => [...o.entries.keys()]));
    for (const c of r.checks) {
      if (superseded.has(c.check)) continue;
      const key = `${r.session}\0${c.check}`;
      const queued = this.queue.get(key);
      if (queued) {
        queued.stale = true;
        this.queue.delete(key);
        const owner = older.find((o) => o.claim === queued.claim);
        if (owner) this.cleanup(owner);
      }
      // Outdated only by a snapshot that changed the inputs: the same tree carries the run (#45).
      for (const o of older.filter((x) => x.claim < r.claim)) { const e = o.entries.get(c.check); if (e) { e.stale = true; if (changed) e.newer ??= r.claim; } }
    }
    // A snapshot that changed no check's inputs reuses results and runs nothing (#82; design: Held time is counted):
    // each check that ended on the last claim of the same tree carries its result to this one.
    const same = changed || tree === undefined || this.o.plant === 'empty-commit-run-alone' ? [] : older.filter((o) => o.tree === tree).reverse();
    const toRun = r.checks.filter((c) => {
      const carried = same.map((o) => o.entries.get(c.check)).find(ended);
      if (!carried) return true;
      const { newer: _newer, ...kept } = carried;
      claim.entries.set(c.check, { ...kept, check: c, claim: r.claim, runs: [...carried.runs], stale: false });
      return false;
    });
    // The fast lane: on_base fails first, then the rest, each group shortest first, ties in the definition's order.
    const timed = await Promise.all(toRun.map(async (c, i) => ({ c, i, ms: (c.expected_ms ?? (await this.expectedMs(c.check)) ?? 0) + (checkout && c.depth === 'journey' ? (await this.o.stackStart?.(checkout, r.cwd)) ?? 0 : 0) })));
    timed.sort((a, b) => (a.c.on_base === 'fails' ? 0 : 1) - (b.c.on_base === 'fails' ? 0 : 1) || a.ms - b.ms || a.i - b.i);
    const free = Array.from({ length: Math.max(0, this.o.slots().free) }, () => readyAt);
    const budgetEnd = r.stopAt + this.o.budget_ms;
    const fast: { c: ClaimCheck; ms: number }[] = [];
    const slow: ClaimCheck[] = [];
    // The checks the budget left to the slow lane that the hold alone would have run: known only once a check has a time.
    const budgetCost: string[] = [];
    const holdFree = [...free];
    for (const t of timed) {
      // A check pinned to a commit of its own runs in the slow lane, and only once per commit (#325).
      if (t.c.commit) {
        const ran = this.pinned.get(`${t.c.commit}\0${t.c.check}`);
        if (ran) claim.entries.set(t.c.check, { check: t.c, claim: r.claim, commit: t.c.commit, lane: 'slow', runs: [ran.run], base: null, outcome: ran.outcome, running: false, stale: false });
        else slow.push(t.c);
        continue;
      }
      free.sort((a, b) => a - b);
      holdFree.sort((a, b) => a - b);
      const start = free[0] ?? Infinity;
      const inHold = (holdFree[0] ?? Infinity) + t.ms <= r.stopAt + this.o.hold_ms;
      if (inHold) holdFree[0]! += t.ms;
      if (start + t.ms <= budgetEnd) { free[0] = start + t.ms; fast.push(t); } else {
        slow.push(t.c);
        if (inHold) budgetCost.push(t.c.check);
      }
    }
    // A claim whose definition is still to lock waits for the lock within the hold (#322; design: Timing and cost), and
    // no longer once a fast check has failed, since the FAIL goes back at once.
    let unlocked: (() => void) | undefined;
    const lockWait = definition === 'waiting' ? new Promise<void>((done) => { unlocked = done; this.lockWaits.set(r.claim, done); }) : undefined;
    const runs = fast.map(async ({ c, ms }) => {
      const e: Entry = { check: c, claim: r.claim, commit: snapshot, lane: 'fast', runs: [], base: null, outcome: null, running: true, stale: false, ends: this.o.now() + ms };
      claim.entries.set(c.check, e);
      try {
        // A key whose result is known is read as carried (#1018); one another session's run is going on is waited for.
        for (let read = await this.carry(claim, e, checkout!); read !== 'carried'; read = await this.carry(claim, e, checkout!)) {
          if (read === null) {
            await this.runOwn(claim, e, checkout!, 'fast', ms || null);
            break;
          }
          await read.wait;
        }
        await this.onBase(claim, e);
      } catch (error) {
        e.outcome = 'missing';
        // A run that never started is missing, named, so the check is BLOCKED, never pending with no run to come.
        if (!e.runs.length) this.cantStart(e, error);
      } finally {
        e.running = false;
      }
      // A result carried from another session's failed run fails as the check's own would.
      const failed = (o: string | null | undefined) => o === 'failed' || o === 'overran';
      if (failed(e.outcome) || (e.outcome === 'carried' && e.group && this.runsOn(e.group).some((s) => failed(this.records.get(s.run)?.outcome)))) unlocked?.();
      await this.o.judged?.(r.claim);
      await e.readings;
    });
    for (const c of slow) claim.entries.set(c.check, { check: c, claim: r.claim, commit: c.commit ?? snapshot, lane: 'slow', runs: [], base: null, outcome: null, running: false, stale: superseded.has(c.check) });
    // The hold replies once: when every admitted check has ended, and the lock has landed or a check failed, or when the hold ends.
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.allSettled([...runs, ...(lockWait ? [lockWait] : [])]), new Promise<void>((done) => { timer = setTimeout(done, Math.max(0, r.stopAt + this.o.hold_ms - this.o.now())); })]).finally(() => clearTimeout(timer));
    if (lockWait) void lockWait.then(() => { if (this.lockWaits.get(r.claim) === unlocked) this.lockWaits.delete(r.claim); });
    void Promise.allSettled(runs).then(() => this.cleanup(claim));
    return { fast: fast.map((f) => f.c.check), slow: slow.map((c) => c.check), snapshot, readyAt, budgetCost, changed };
  }

  /**
   * A journey's uncounted run has one more on the same snapshot, on a stack started with no kept product (#580): when
   * that one serves another tree too, the run is missing, so its check is BLOCKED.
   */
  private async retried(c: Claim, e: Entry, cwd: string, outcome: string): Promise<string> {
    if (outcome !== 'uncounted' || e.stale || e.check.depth !== 'journey') return outcome;
    const run = await this.o.start({ claim: e.claim, check: e.check.check, approved: e.check.approved, command: e.check.command, commit: e.commit, cwd, lane: e.lane, expected_ms: null, deadline_ms: e.check.deadline_ms ?? null, ...stackOf(c, e.check, { fresh: true }) });
    e.runs.push(run);
    return this.o.ended(run);
  }
  /** Whether a claim in the worktree has a journey still to end: its warm stack isn't the pool's to reclaim (#580). */
  pendingIn(worktree: string): boolean {
    return [...this.claims.values()].flat().some((c) => c.cwd === worktree && [...c.entries.values()].some((e) => e.check.depth === 'journey' && !e.stale && (e.outcome === null || e.running)));
  }
  /** The claim's checkout: the one it holds, or a new one of its snapshot once the last has gone. */
  private checkoutOf(c: Claim): Promise<TempCheckout> {
    c.checkout ??= this.o.checkouts().checkout({ worktree: c.cwd, commit: c.snapshot, dependencies: DEPENDENCIES, runs: [c.claim] })
      .then(async (t) => { if (c.state) await hold(t.dir, c.state.files); return t; });
    return c.checkout;
  }
  /**
   * A fix check that passed on the snapshot runs on the merge base, in a temporary checkout from the service (#31), and so
   * does a spec check that failed there (#33: an inherited failure),
   * through the same command check kind, with the files its run read under the test, fixture and script folders taken
   * from the snapshot (#875); its record is what the verdict engine judges the fix by: passing there, or failing off
   * the assertions it names, makes the claim INVALID. A base run that can't be made is no run on the base, which
   * the engine names the same way; what the hub's stopping cuts short says nothing.
   *
   * On a base with nothing to start, the surface the check declares gets the service's stand-in (#874), a program that
   * does nothing: a service or page the run reaches at DEEP_SURFACE_URL, a command on its PATH by name, a module in the
   * checkout. Passing there is INVALID as passing on the base is; failing there records the stand-in's hash in the
   * requirement's `stand_in`.
   */
  private async onBase(c: Claim, e: Entry): Promise<void> {
    // A fix check runs there once it passed, to prove the fix; a spec check once it failed, so a failure the merge base
    // shares reads as inherited, BLOCKED, never as the claim's own FAIL (design: How runs become one of five verdicts).
    if (e.outcome !== (e.check.on_base === 'fails' ? 'passed' : e.check.source === 'spec' ? 'failed' : null) || e.check.document !== undefined) return;
    const check = e.check.check;
    const token = `${e.claim} ${check} base`;
    const surface = this.o.plant === 'stand-in-surface-dropped' ? null : e.check.surface ?? null;
    // The base run's key (#1018): the merge base and the check's own files, as the claim's snapshot holds them. A base
    // run on an equal key that ended as a run is read as carried; one going is waited for, and if it ends as no run
    // this check's base runs on its own.
    let key: RunKey;
    let shared: boolean;
    try {
      const { dir } = await this.checkoutOf(c);
      shared = !this.onStack(e, dir);
      const stem = await this.stemOf(c, e, c.base);
      const paths = [...new Set(this.ownOf(e))].sort();
      key = { check, stem, dir, claim: c.claim, session: sessionOf(c.session), base: true, withheld: false, id: keyId(stem, paths, await contents(dir, paths)), paths };
    } catch {
      return;
    }
    while (shared) {
      const from = this.runsOn(`${check}\0${key.id!}`).find((x) => x.session !== key.session && ON_BASE.has(this.records.get(x.run)?.outcome ?? ''));
      if (from && await this.keptAll([from])) {
        e.base = from.run;
        e.baseFrom = from;
        e.readings = Promise.all([e.readings, this.saved(c, [from])]).then(() => undefined);
        return;
      }
      const going = this.going.get(key.id!);
      if (!going || going.session === key.session) break;
      await this.waited(c, going);
    }
    let ran = (): void => undefined;
    if (shared) this.goingOn(key.id!, key.session, new Promise<void>((done) => { ran = done; }));
    try {
      const surfaces = surface ? [{ ...surface, check } as DeclaredSurface] : [];
      const base = await this.o.checkouts().baseCheckout({ worktree: c.cwd, onto: c.base, claim: c.snapshot, own: this.ownOf(e), dependencies: DEPENDENCIES, surfaces, runs: [token] });
      try {
        if (c.state) await hold(base.dir, c.state.pinned);
        const standIn = base.standIns.find((s) => s.check === check);
        const reach = standIn?.port ? { env: { DEEP_SURFACE_URL: `http://127.0.0.1:${standIn.port}` }, hosts: [`127.0.0.1:${standIn.port}`] }
          : standIn?.bin ? { standIns: [basename(standIn.bin)] } : {};
        const run = await this.o.start({ claim: e.claim, check, approved: e.check.approved, command: e.check.command, commit: base.commit, cwd: base.dir, lane: e.lane, expected_ms: null, deadline_ms: e.check.deadline_ms ?? null, ...reach, ...stackOf(c, e.check, { base: true }), ...(shared && !this.onStack(e, base.dir) ? { key } : {}) });
        e.base = run;
        e.baseFrom = { run, claim: c.claim, session: key.session, withheld: false };
        if (standIn) e.standIn = standIn;
        const outcome = await this.o.ended(run);
        if (standIn && surface && e.check.req && (outcome === 'failed' || outcome === 'overran') && this.o.plant !== 'stand-in-unrecorded') {
          await this.o.stoodIn({ task: c.task, req: e.check.req, surface, hash: standIn.hash });
        }
      } finally {
        await this.o.checkouts().ended(base, token);
      }
    } catch {
      if (this.o.stopping()) e.outcome = 'stopped';
    } finally {
      ran();
    }
  }

  /**
   * A workspace's drift (#67): these checks of a claim run again on its commit, on the readings now, and the others
   * keep their results; the claim's verdict is made again from them. False for a claim this runner no longer holds,
   * as after a restart, or a check it doesn't.
   */
  rerun(claim: string, checks: readonly string[], state: StatePin): boolean {
    const c = this.claimOf(claim);
    const entries = checks.flatMap((check) => { const e = c?.entries.get(check); return e ? [e] : []; });
    if (!c || entries.length !== checks.length) return false;
    c.state = state;
    // A run on the new reading is no run of the old one's key (#1018): its runs no longer count for the check.
    // A timing check's run under load on the old reading was set aside for that reading; the new one gets its own (#352).
    for (const e of entries) { e.runs = []; e.outcome = null; e.running = true; delete e.group; delete e.variants; delete e.loaded; }
    void (async () => {
      await Promise.all(entries.map(async (e) => {
        try {
          const { dir } = await this.checkoutOf(c);
          await hold(dir, state.files);
          const start = () => this.o.start({ claim: c.claim, check: e.check.check, approved: e.check.approved, command: e.check.command, commit: e.commit, cwd: dir, lane: 'slow', expected_ms: null, deadline_ms: e.check.deadline_ms ?? null, ...(e.check.references ? { references: e.check.references } : {}), ...stackOf(c, e.check) });
          const run = await start();
          e.runs.push(run);
          const ended = await this.retried(c, e, dir, await this.o.ended(run));
          e.outcome = await this.alone(e, e.runs.at(-1)!, ended, start);
          // Its held-out variants run again on the new reading too.
          if (KEPT.has(e.outcome)) await this.variants(c, e, undefined, 'slow');
        } catch {
          e.outcome = 'missing';
        } finally {
          e.running = false;
        }
      }));
      await this.o.judged?.(c.claim);
      this.cleanup(c);
    })();
    return true;
  }

  /** What a check's newest run of the claim printed, its error output first, cut to its last 2,000 characters. */
  outputOf(claim: string, check: string): string {
    const run = this.claimOf(claim)?.entries.get(check)?.runs.at(-1);
    const r = run ? this.records.get(run) : undefined;
    return r ? [r.output.stderr, r.output.stdout].filter((t) => t.trim()).join('\n').slice(-2000) : '';
  }
  /** The claim's checks as they stand: each check's result as the verdict engine judges its runs, whether it can send the claim back, and the slow checks still to start. */
  standing(claim: string): { check: string; lane: 'fast' | 'slow'; result: Result; stale: boolean; holds: boolean; covers: string[] }[] {
    const c = this.claimOf(claim);
    if (!c) return [];
    const v = this.verdictOf(claim);
    return [...c.entries.values()].map((e) => ({ check: e.check.check, lane: e.lane, result: v?.checks.find((x) => x.check === e.check.check)?.outcome ?? 'pending', stale: e.stale, holds: e.check.holds !== false, covers: [...e.check.covers] }));
  }

  /**
   * A stop's reply let the turn end, with its claim's fast lane green (or no claim to judge): its slow checks take
   * their queued places, each the place an older snapshot's held for the same check; a reply that keeps the agent
   * working starts none of them. A looping session's are held there instead (#965) until the loop pauses for them:
   * its next automatic prompt can't come before a check would end, counting its queue wait and expected time, by the
   * wake-up's or cron job's due time, or the grace window for a prompt no fact foresees. Background work holds them
   * until it ends, at most 30 minutes from this stop (#907). A stop that isn't looping, or one after a claim in its turn
   * or your words, starts them and the session's held ones. Resolves once the held places are recorded.
   */
  async turnEnded(claim: string | null, background: string[] = [], stopAt = this.o.now(), reading?: LoopReading): Promise<void> {
    const plant = this.o.plant;
    const c = claim ? this.claimOf(claim) : undefined;
    const session = reading?.session ?? c?.session;
    if (!session) return;
    const loop = { origin: reading?.origin, due: reading?.due ?? null, background, starter: reading?.starter ?? null };
    const slow = c ? [...c.entries.values()].filter((e) => e.lane === 'slow' && !e.runs.length && !e.running && !e.waiting && !e.group && !e.stale) : [];
    const looping = AUTOMATIC.has(loop.origin ?? '') && plant !== 'starts-on-every-green-stop';
    const starter = loop.starter === 'claim' && plant === 'holds-claim-stop-for-loop' ? null : loop.starter;
    const writes: Promise<void>[] = [];
    if ((!looping && !loop.background.length) || starter) {
      const by: StartedBy = starter ?? (loop.origin === 'person' || loop.origin === 'app' ? 'words' : 'loop_paused');
      for (const e of slow) this.place(session, e, by, writes);
      this.release(session, () => true, by, writes);
    } else if (loop.background.length) {
      for (const e of slow) this.hold(session, e, 'background', `${loop.background.join(', ')} in the background`, writes);
      // A newer stop that takes the place gets 30 minutes of its own; the planted wrong programs keep the first stop's, or none.
      if (plant !== 'holds-background-without-limit' && !(plant === 'caps-from-first-stop' && this.caps.has(session))) this.caps.set(session, stopAt + BACKGROUND_MS);
    } else {
      const now = this.o.now();
      const unforeseen = !loop.due && UNFORESEEN.has(loop.origin ?? '');
      const next = loop.due ? loop.due.at : unforeseen ? now + GRACE_MS : Infinity;
      const free = await this.slotTimes(now);
      for (const e of slow) {
        const ms = e.check.expected_ms ?? (await this.expectedMs(e.check.check)) ?? 0;
        free.sort((a, b) => a - b);
        const start = free[0] ?? Infinity;
        if (start + ms <= next && plant !== 'holds-every-loop-check') {
          free[0] = start + ms;
          this.place(session, e, 'loop_paused', writes);
        } else this.hold(session, e, unforeseen ? 'grace' : 'due', loop.due?.what ?? 'no prompt foreseen', writes);
      }
      if (unforeseen && plant !== 'no-grace-window' && [...this.heldOf(session)].some((h) => h.why === 'grace')) this.graces.set(session, now + GRACE_MS);
    }
    const pumped = this.pump();
    await Promise.all(writes);
    await pumped;
  }
  /** A claim's slow checks as they were declared, each with the deadline a hold is measured by; null when it has none. */
  slowDeadlines(claim: string): { check: string; deadline_ms: number | null }[] {
    const c = this.claimOf(claim);
    return c ? [...c.entries.values()].filter((e) => e.lane === 'slow' && !e.stale).map((e) => ({ check: e.check.check, deadline_ms: e.check.deadline_ms ?? e.check.expected_ms ?? null })) : [];
  }
  /** A claim's slow checks not started yet, for want of a CPU slot. */
  slowUnstarted(claim: string): string[] {
    const c = this.claimOf(claim);
    return c ? [...c.entries.values()].filter((e) => e.lane === 'slow' && !e.stale && !e.running && !e.waiting && !e.group && !e.runs.length).map((e) => e.check.check) : [];
  }
  /** A claim's slow checks as they stand: whether any is still to end, and each that failed. One a newer claim outdated counts for neither. */
  slowStanding(claim: string): { pending: boolean; failed: string[] } {
    const slow = this.standing(claim).filter((c) => c.lane === 'slow' && !c.stale);
    return { pending: slow.some((c) => c.result === 'pending'), failed: slow.filter((c) => c.result === 'FAIL' || c.result === 'BLOCKED').map((c) => `${c.check} ${c.result}`) };
  }
  /** Resolves once none of a claim's slow checks is running or queued. */
  async slowEnded(claim: string, until: number): Promise<void> {
    while (Date.now() < until) {
      const c = this.claimOf(claim);
      if (!c || ![...c.entries.values()].some((e) => e.lane === 'slow' && !e.stale && e.outcome === null)) return;
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  /** When each CPU slot is expected to free, from now: the free ones now, then the runs going, then the queue's checks in turn. */
  private async slotTimes(now: number): Promise<number[]> {
    const going = [...this.claims.values()].flat().flatMap((c) => [...c.entries.values()]).filter((e) => e.running && e.ends !== undefined).map((e) => Math.max(now, e.ends!));
    const free = [...Array.from({ length: Math.max(0, this.o.slots().free) }, () => now), ...going];
    for (const e of this.queue.values()) {
      free.sort((a, b) => a - b);
      if (free.length) free[0]! += e.check.expected_ms ?? (await this.expectedMs(e.check.check)) ?? 0;
    }
    return free;
  }
  private *heldOf(session: string): Iterable<Held> {
    for (const [key, h] of this.holding) if (key.startsWith(`${session}\0`)) yield h;
  }
  /** A slow check takes its queued place; the held place an older snapshot had for it starts now, by `by`. */
  private place(session: string, e: Entry, by: StartedBy, writes: Promise<void>[]): void {
    const key = `${session}\0${e.check.check}`;
    const older = this.holding.get(key);
    if (older) {
      this.holding.delete(key);
      writes.push(this.record({ ...older.record, started_at: this.o.now(), started_by: by }, older));
    }
    this.queue.set(key, e);
  }
  /** A slow check held in its place, taking the one an older snapshot held for it, and recorded. */
  private hold(session: string, e: Entry, why: Held['why'], reason: string, writes: Promise<void>[]): void {
    const key = `${session}\0${e.check.check}`;
    const older = this.holding.get(key);
    if (older && older.record.started_at === null && older.record.replaced_by === null) writes.push(this.record({ ...older.record, replaced_by: e.commit }, older));
    const h: Held = { entry: e, why, record: { session: sessionOf(session), claim: e.claim, check: e.check.check, snapshot: e.commit, held_at: this.o.now(), reason, started_at: null, started_by: null, replaced_by: null } };
    this.holding.set(key, h);
    writes.push(this.record(h.record, h));
  }
  /** The session's held places that `which` picks start, by `by`, each taking its queued place. Returns their checks. */
  private release(session: string, which: (h: Held) => boolean, by: StartedBy, writes: Promise<void>[] = []): string[] {
    const started: string[] = [];
    for (const h of [...this.heldOf(session)]) {
      if (!which(h)) continue;
      const key = `${session}\0${h.entry.check.check}`;
      this.holding.delete(key);
      writes.push(this.record({ ...h.record, started_at: this.o.now(), started_by: by }, h));
      if (h.entry.stale || h.entry.runs.length) continue;
      this.queue.set(key, h.entry);
      started.push(h.entry.check.check);
    }
    if (![...this.heldOf(session)].some((h) => h.why === 'background')) this.caps.delete(session);
    void this.pump();
    return started;
  }
  /** Appends a held place's record as it now stands: the newest for its check and snapshot stands. */
  private record(record: HeldRecord, h: Held): Promise<void> {
    h.record = record;
    const ts = this.o.now();
    return this.o.append(this.o.core, { v: 1, id: ulid(ts), kind: 'check.held', ts, subject: record.claim, data: { ...record } });
  }
  /** A prompt came: the grace window's loop didn't pause. */
  prompted(session: string): void {
    this.graces.delete(session);
  }
  /**
   * The session is idle and its facts have emptied (#965): no background work and no cron job left, so what they held
   * starts now. A wake-up's hold waits for its prompt.
   */
  idle(session: string, facts: { background: number; crons: number }): void {
    if (facts.background || facts.crons) return;
    this.backgroundEnded(session);
    if (this.o.plant !== 'holds-every-loop-check') this.release(session, (h) => h.record.reason === 'cron', 'loop_paused');
  }
  /** The session ended, and its wake-ups and cron jobs with it: no prompt comes, so everything it held starts. */
  ended(session: string): void {
    this.graces.delete(session);
    this.release(session, () => true, 'loop_paused');
  }
  /** The session's background work has ended: the checks it held take their queued places (#907). Returns them. */
  backgroundEnded(session: string): string[] {
    return this.release(session, (h) => h.why === 'background', 'loop_paused');
  }
  /** Fires what came due on the hub's clock: background work's 30 minutes, and each grace window with no prompt in it. */
  tick(): void {
    const now = this.o.now();
    for (const [session, at] of [...this.caps]) {
      if (now < at) continue;
      this.caps.delete(session);
      const started = this.release(session, (h) => h.why === 'background', 'cap');
      if (started.length) this.o.capped?.(session, started);
    }
    for (const [session, at] of [...this.graces]) {
      if (now < at) continue;
      this.graces.delete(session);
      this.release(session, (h) => h.why === 'grace', 'loop_paused');
    }
  }
  /** Starts queued slow checks while CPU slots are free; a run going is never stopped for a newer snapshot. */
  private async pump(): Promise<void> {
    for (const [key, e] of [...this.queue]) {
      if (this.o.slots().free <= 0) return;
      // Another pump took it, or a newer snapshot did, while this one waited on a checkout.
      if (this.queue.get(key) !== e) continue;
      this.queue.delete(key);
      const c = this.claimOf(e.claim)!;
      e.running = true;
      try {
        // The slow run gets its own checkout of the snapshot: the fast lane's may be gone by now. A snapshot that can't
        // be checked out any more leaves the check missing, never passed. A check pinned to a commit gets a checkout of that
        // commit and runs once per commit (#325), never read from a key.
        const token = `${e.claim} ${e.check.check} ${e.commit}`;
        const pinned = e.check.commit ? await this.o.checkouts().checkout({ worktree: c.cwd, commit: e.check.commit, dependencies: DEPENDENCIES, runs: [token] }) : undefined;
        const { dir: cwd } = pinned ?? await this.checkoutOf(c);
        // A key whose result is known is read as carried (#1018); one another session's run is going on is waited for,
        // out of the queue, and the check takes its place again once that run has ended.
        const read = pinned ? null : await this.carry(c, e, cwd);
        if (read !== null) {
          e.running = false;
          if (read === 'carried') {
            // A fix check's base is read from its key too, or run, out of the queue's way.
            e.running = true;
            void this.onBase(c, e).finally(async () => {
              e.running = false;
              await this.o.judged?.(e.claim);
              await e.readings;
              this.cleanup(c);
            });
            continue;
          }
          e.waiting = true;
          void read.wait.then(() => {
            e.waiting = false;
            if (!e.stale && !this.queue.has(key)) this.queue.set(key, e);
            else this.cleanup(c);
            void this.pump();
          });
          continue;
        }
        const expected = e.check.expected_ms ?? await this.expectedMs(e.check.check);
        e.ends = this.o.now() + (expected ?? 0);
        let started!: () => void;
        const begun = new Promise<void>((done) => { started = done; });
        const own = pinned ? (async () => {
          try {
            const start = () => this.o.start({ claim: e.claim, check: e.check.check, approved: e.check.approved, command: e.check.command, commit: e.commit, cwd, lane: 'slow', expected_ms: expected, deadline_ms: e.check.deadline_ms ?? null, ...stackOf(c, e.check) });
            const id = await start();
            e.runs.push(id);
            started();
            const ended = await this.retried(c, e, cwd, await this.o.ended(id));
            e.outcome = await this.alone(e, e.runs.at(-1)!, ended, start);
            // A later claim on that commit gets the run that decided: the rerun alone, when the first ran under load (#352).
            if (e.outcome === 'passed' || e.outcome === 'failed') this.pinned.set(`${e.commit}\0${e.check.check}`, { run: e.runs.at(-1)!, outcome: e.outcome });
          } finally {
            await this.o.checkouts().ended(pinned, token).catch(() => undefined);
          }
        })() : this.runOwn(c, e, cwd, 'slow', expected, () => started());
        // The pump goes on once the run has started, as it does for any slow run; a run that never starts goes on too.
        await Promise.race([begun, own.catch(() => undefined)]);
        void own.catch((error: unknown) => {
          e.outcome = 'missing';
          if (!e.runs.length) this.cantStart(e, error);
        }).then(async () => {
          await this.onBase(c, e);
          e.running = false;
          // Its result still reports, as that snapshot's; the readings count what outdated it (#45).
          const run = e.runs.at(-1);
          if (e.newer && run) await this.staleRun(c.session, run, e).catch(() => undefined);
          await this.o.judged?.(e.claim);
          await e.readings;
          void this.pump();
          this.cleanup(c);
        });
      } catch (error) {
        e.outcome = 'missing';
        e.running = false;
        if (!e.runs.length) this.cantStart(e, error);
        await this.o.judged?.(e.claim);
        this.cleanup(c);
      }
    }
  }
  /**
   * A timing check's run that failed while the machine's load was past its core count (#352, as runTiming keeps it):
   * recorded with the load, counted as nothing, and rerun alone once the load is back under the cores; that run's
   * outcome decides; one the load never let run in 30 minutes leaves the check uncounted. Only its first such run is
   * set aside. Any other outcome is the run's own.
   */
  private async alone(e: Entry, run: string, outcome: string, again: () => Promise<string>): Promise<string> {
    const machine = this.o.load;
    if (!e.check.timing || outcome !== 'failed' || e.loaded || !machine) return outcome;
    const { load, cores } = machine();
    if (!(load > cores)) return outcome;
    e.loaded = { run, load, cores };
    const ts = this.o.now();
    await this.o.append(this.o.core, { v: 1, id: ulid(ts), kind: 'run.under_load', ts, subject: run, data: { run, check: e.check.check, claim: e.claim, under_load: true, load, cores } });
    for (const until = this.o.now() + LOAD_WAIT_MS; machine().load > cores;) {
      if (this.o.stopping()) return 'stopped';
      if (this.o.now() >= until) return 'uncounted';
      await new Promise((done) => setTimeout(done, LOAD_POLL_MS));
    }
    const rerun = await again();
    e.runs.push(rerun);
    return this.o.ended(rerun);
  }
  private async staleRun(session: string, run: string, e: Entry): Promise<void> {
    const ts = this.o.now();
    await this.o.append(this.o.core, { v: 1, id: ulid(ts), kind: 'run.stale', ts, data: { session: sessionOf(session), run, check: e.check.check, claim: e.claim, newer_claim: e.newer! } });
  }
  /** A claim's checkout is given back to the service once no run on it is running or queued. */
  private cleanup(c: Claim): void {
    const queued = new Set(this.queue.values());
    const busy = [...c.entries.values()].some((e) => e.running || e.waiting || queued.has(e));
    if (busy || !c.checkout) return;
    const held = c.checkout;
    c.checkout = null;
    void held.then((t) => this.o.checkouts().ended(t, c.claim)).catch(() => undefined);
  }

  /**
   * Records a stop's held time and its split: each moment goes to the first reason that applies. No stop here is held
   * for its slow checks (#965: a loop's stop is held for its quick checks alone), so the fast lane runs to the reply,
   * reading its results included, and the split counts no slow hold. A question's wait comes first.
   */
  async held(r: { session: string; stop: string; claim: string | null; stopAt: number; readyAt: number; replyAt: number; questionMs: number; codeChanging: boolean; budgetCost: string[] }): Promise<void> {
    const total = Math.max(0, r.replyAt - r.stopAt);
    const question = Math.min(r.questionMs, total);
    const ready = Math.min(r.replyAt - question, r.readyAt);
    const split = { question, slow: 0, fast: Math.max(0, r.replyAt - question - ready), snapshot_start: Math.max(0, ready - r.stopAt), queue_wait: 0 };
    // Stamped at the reply: a lane that outran its hold records this later, past whatever came after the reply.
    const ts = r.replyAt;
    await this.o.append(this.o.core, {
      v: 1, id: ulid(this.o.now()), kind: 'stop.held', ts,
      data: { session: sessionOf(r.session), stop: r.stop, claim: r.claim, total, ...split, code_changing: r.codeChanging, budget_cost: r.budgetCost },
    });
  }
}
