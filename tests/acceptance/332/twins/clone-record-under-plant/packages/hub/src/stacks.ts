// A worktree's stack (#331, #332): `deep env up` and `down`, deep_env, and the stack a check run needs, through
// env-local, every process through the host. The per-session keys a stack leases through the kernel's table stay
// with the session that leased them and end once every process recorded for the run is gone; a stack goes down with
// the session that started it or whose keys it holds, once that session ends (#342), and with the hub.
import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { scrubText } from '@deepbuild/evidence';
import type { LeaseTable } from '@deepbuild/leases';
import type { Keys, Serving, upStack, Stack, Take, Up, WarmStack } from '@deepbuild/env-local';
import { attributeStack, environmentFindings, type RunFacts, type StackRecords } from '@deepbuild/gate';
import { alive, type Supervisor } from '@deepbuild/supervisor';
import { downLeaving } from './leftover.js';
import { refusal, Refused, type Plant } from './wire.js';

type Obj = Record<string, unknown>;
type Rows = (query: string, params?: readonly (string | number | bigint | null)[]) => Promise<unknown[]>;
/** Where a refusal points for the caller's surface, and what starts a stack there. */
interface At { path: string; remedy: string }

/** The runtime stack lifecycle supplied by the composition root; stack policy never selects a concrete provider. */
interface StackEnvironment {
  newRun(at: number): string;
  up(options: Parameters<typeof upStack>[1]): Promise<Up>;
  down(run: string): Promise<void>;
  healthy(stack: Stack): Promise<boolean>;
  /** A warm stack for a check, whose per-session keys its `take` leases (#580). */
  warm(o: { take: Take; scrub: (values: string[]) => void }): WarmStack;
  /** Whether the folder's done.yaml has an environment block, so a journey there needs a stack. */
  wanted(folder: string): boolean;
  keys(folder: string): Promise<Keys>;
}

interface StacksOptions {
  raw: Rows;
  now: () => number;
  plant: Plant | undefined;
  /** The values the hub scrubs by: what env-local loaded into a stack joins them. */
  held: string[];
  scrub: (values: string[]) => void;
  appendCore(kind: string, data: Obj, extra: { subject?: string }): Promise<void>;
  supervisor: () => Supervisor;
  environment: StackEnvironment;
  leases: () => LeaseTable;
  stopping: () => boolean;
  /** An agent session: whether it ended, and whether a kill or a crash did that, which leaves it interrupted (#342). */
  session(id: string): { ended?: boolean; interrupted?: boolean } | undefined;
  /** Whether a claim in the worktree still has a journey to run or running (#580). */
  pending(worktree: string): boolean;
  /** Whether the session is idle: no turn of it is running. */
  idle(session: string): boolean;
  /** The planted pool's question: which stack to stop. */
  plantedAsk(session: string, question: string): Promise<void>;
}

/** What a check needs of its stack (#580): whose worktree it is, and what the run is on. */
export interface StackWant { session: string; worktree: string; on_base: 'fails' | 'passes'; /** A base run, on the head run's install. */ base?: boolean; /** A run after an uncounted one: nothing kept is reused. */ fresh?: boolean }
interface Warm { stack: WarmStack; worktree: string; session: string; used: number; slot: string; /** The run on it now and when it is expected to end. */ running?: { run: string; ends: number }; earlier: RunFacts[]; folders: string[]; dirty: boolean; ending: boolean }
interface Going { warm: Warm; serving: Serving; findings: string[]; trees: { checkout: string; worktree: string } }
const median = (list: number[]): number => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? 0;

/** A per-session key's holder, as a person reads it. */
const owned = (holder: string): string => (holder === 'core' ? 'your own terminal\'s deep env up' : `session ${holder.slice('mcp:'.length)}`);
/** The PIDs that listen on the TCP port, as lsof shows them; a failed lsof rejects, since it proves nothing. */
const listening = (port: number): Promise<number[]> => new Promise((done, fail) => {
  // Where the system keeps it: Debian and Ubuntu have no /usr/sbin/lsof.
  execFile(process.platform === 'darwin' ? '/usr/sbin/lsof' : '/usr/bin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { env: { ...process.env, LC_ALL: 'C' } }, (error, stdout, stderr) => {
    // lsof exits 1 with no output when nothing listens.
    if (error && !((error as { code?: unknown }).code === 1 && stdout.trim() === '' && stderr.trim() === '')) return fail(Error(`lsof can't list port ${port}'s listeners: ${stderr.trim() || error.message}`));
    done([...new Set(String(stdout ?? '').split('\n').filter((l) => l.startsWith('p')).map((l) => Number(l.slice(1))))]);
  });
});

export class Stacks {
  /** The stack `deep env up` started in each worktree, by the worktree's real path. */
  private readonly stacks = new Map<string, Stack>();
  /** Each worktree's env up and down, one after another. */
  private readonly turns = new Map<string, Promise<unknown>>();
  /** Every stack run started and not yet cleaned up, a run's or a worktree's, so the hub's stop takes each down. */
  private readonly runs = new Set<string>();
  /** The per-session keys each stack run leased through the table (#332), by lease ID, ended once its processes are gone. */
  private readonly taken = new Map<string, string[]>();
  /** Who leased each stack run's per-session keys: its session's deep mcp, or the core. */
  private readonly owners = new Map<string, string>();
  /** The session each stack run was started for through `deep env up` or deep_env (#342): it reaps the stack at its end, whoever else uses it. */
  private readonly starters = new Map<string, string>();
  /** Each worktree's stack run while it waits for its health route, so a down can end it rather than wait. */
  private readonly rising = new Map<string, string>();

  /** Each worktree's warm stack (#580), keeping its images, its database service, its templates and its leases between runs. */
  private readonly warm = new Map<string, Warm>();
  /** Each worktree's stack serves one run at a time: the rest wait here, the checks of on_base: fails requirements first. */
  private readonly lines = new Map<string, { on_base: string; go: () => void }[]>();
  private readonly busy = new Set<string>();
  private readonly going = new Map<string, Going>();
  /** What waits for a stack.slot, woken when a stack ends or a run does. */
  private woken: (() => void)[] = [];

  constructor(private readonly o: StacksOptions) {}

  // ---- Warm stacks (#580).

  /** Whether a journey in the folder needs a stack. */
  wanted(folder: string): boolean { return this.o.environment.wanted(folder); }

  private wake(): void { for (const go of this.woken.splice(0)) go(); }
  private async turnOf(worktree: string, on_base: string): Promise<void> {
    if (!this.busy.has(worktree)) { this.busy.add(worktree); return; }
    await new Promise<void>((go) => {
      const line = this.lines.get(worktree) ?? [];
      line.splice(on_base === 'fails' ? line.findIndex((w) => w.on_base !== 'fails') >>> 0 : line.length, 0, { on_base, go });
      this.lines.set(worktree, line);
    });
  }
  private nextTurn(worktree: string): void {
    const next = this.lines.get(worktree)?.shift();
    if (next) next.go();
    else this.busy.delete(worktree);
    this.wake();
  }
  /** A warm stack the pool may reclaim, an idle session's first and then the one used least recently; never one with a run or a pending claim. */
  private reclaimable(): Warm | undefined {
    const all = [...this.warm.values()];
    // The planted wrong program takes a stack whose journey runs.
    const running = this.o.plant === 'pool-reclaims-running' ? all.find((w) => w.running) : undefined;
    return running ?? all.filter((w) => !w.running && !this.busy.has(w.worktree) && !this.o.pending(w.worktree))
      .sort((a, b) => Number(this.o.idle(b.session)) - Number(this.o.idle(a.session)) || a.used - b.used)[0];
  }
  /** How long until a running stack is expected to come free. */
  private waitMs(): number {
    const ends = [...this.warm.values()].flatMap((w) => (w.running ? [w.running.ends - this.o.now()] : []));
    return Math.max(1, Math.min(...ends, 60_000));
  }
  /** A `stack.slot`: a free one, a reclaimed stack's, or the next to free; no agent is asked which stack to stop. */
  private async slot(r: { claim: string; check: string; expected_ms: number | null }): Promise<string | { cause: string }> {
    let told = false;
    for (;;) {
      if (this.o.stopping()) return { cause: 'the hub is stopping' };
      const got = await this.o.leases().lease({ holder: 'core' }, { host: 'local', kind: 'stack.slot', key: 'stack' }, 'exclusive');
      if (got.status === 'granted') return got.lease.id;
      if (got.status === 'BLOCKED') return { cause: got.message };
      const victim = this.reclaimable();
      if (victim) {
        if (this.o.plant === 'pool-asks-which-stack') await this.o.plantedAsk(victim.session, `The stack pool is full. Which stack should stop, ${victim.worktree}'s?`);
        await this.tear(victim);
        continue;
      }
      if (!told) {
        told = true;
        const wait_ms = this.waitMs();
        await this.o.appendCore('stack.waiting', { claim: r.claim, check: r.check, wait_ms, expected_ms: (r.expected_ms ?? 0) + wait_ms }, { subject: r.claim });
      }
      await new Promise<void>((go) => { this.woken.push(go); setTimeout(go, 500); });
    }
  }
  /** The whole stack down by its token through the supervisor; its leases end once its processes and containers are proven gone. */
  private async tear(w: Warm): Promise<void> {
    this.warm.delete(w.worktree);
    await this.takeDown(w.stack.id).catch(() => undefined);
    await this.o.leases().release(w.slot, []).catch(() => undefined);
    this.wake();
  }
  /**
   * The stack a claim's check runs on, started from the run's checkout: the worktree's warm stack while its services'
   * key holds, else a new one on a `stack.slot`. Resolves once it is ready, with what the run is handed, or why it can't be.
   */
  async serve(r: StackWant & { run: string; claim: string; check: string; folder: string; expected_ms: number | null }): Promise<Serving | { cause: string }> {
    const began = this.o.now();
    await this.turnOf(r.worktree, r.on_base);
    let w: Warm | undefined;
    try {
      const keys = await this.o.environment.keys(r.folder);
      w = this.warm.get(r.worktree);
      // One whose run cleanup didn't finish is never reused, and a changed services key is a new stack.
      if (w && (w.dirty || w.stack.servicesKey !== keys.services || r.fresh)) { await this.tear(w); w = undefined; }
      if (!w) {
        const slot = await this.slot(r);
        if (typeof slot !== 'string') { this.nextTurn(r.worktree); return slot; }
        let take: Take | undefined;
        const stack: WarmStack = this.o.environment.warm({ take: (kind, list) => (take ??= this.take('core', stack.id))(kind, list), scrub: (v) => this.scrubValues(v) });
        w = { stack, worktree: r.worktree, session: r.session, used: this.o.now(), slot, earlier: [], folders: [], dirty: false, ending: false };
        this.runs.add(stack.id);
        this.warm.set(r.worktree, w);
        const why = await stack.open(r.folder);
        if (why) { await this.tear(w); this.nextTurn(r.worktree); return { cause: why }; }
      }
      w.session = r.session;
      w.used = this.o.now();
      w.running = { run: r.run, ends: this.o.now() + (r.expected_ms ?? 0) };
      const serving = await w.stack.serve({ run: r.run, folder: r.folder, worktree: r.worktree, began, ...(r.fresh ? { fresh: true } : {}), ...(r.base ? { base: true } : {}) });
      if ('cause' in serving) { await this.tear(w); this.nextTurn(r.worktree); return serving; }
      const findings = r.base ? [] : environmentFindings(serving.facts, w.earlier);
      w.earlier.push(serving.facts);
      await this.o.appendCore('stack.served', { run: r.run, ...serving.served }, { subject: r.run });
      if (serving.seed) await this.cloned(r.run, { run: w.stack.id, seed: serving.seed } as Stack);
      this.going.set(r.run, { warm: w, serving, findings, trees: { checkout: serving.served.checkout, worktree: r.worktree } });
      return serving;
    } catch (error) {
      if (w) await this.tear(w);
      this.nextTurn(r.worktree);
      return { cause: (error as Error).message };
    }
  }
  /**
   * A run's end on its warm stack: the core reads the tree the stack served, from the supervisor's and Docker's records,
   * then only what is the run's own goes. A run on another tree, or an environment that broke its slot's rules, comes
   * back as what leaves the run uncounted; a stack whose cleanup didn't finish is never reused.
   */
  async finish(run: string): Promise<{ uncounted?: string }> {
    const on = this.going.get(run);
    if (!on) return {};
    const { warm: w, serving, findings, trees } = on;
    this.going.delete(run);
    const named = [...findings];
    try {
      const { containers } = await w.stack.containers();
      const processes: StackRecords['processes'] = [];
      if (serving.app) {
        const rows = await this.o.raw(`SELECT kind, json_extract(data, '$.pid') AS pid, json_extract(data, '$.cwd') AS cwd FROM events WHERE kind IN ('process.starting', 'process.tracked') AND json_extract(data, '$.run') = ?`, [serving.app]) as { kind: string; pid: number | null; cwd: string | null }[];
        processes.push({ name: 'app', pid: rows.find((x) => x.pid)?.pid ?? 0, cwd: rows.find((x) => x.cwd)?.cwd ?? trees.checkout, reads: [] });
      }
      const served = attributeStack({ processes, containers }, { ...trees, others: w.folders, digests: serving.digests });
      if (served.served !== 'checkout') named.push(served.named);
      if (this.o.plant === 'env-kills-by-port') for (const port of serving.appPorts) for (const pid of await listening(port)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
      const { left } = serving.app
        ? await downLeaving(serving.appPorts, { listen: listening, leases: async () => (await this.o.leases().leases()).map((v) => v.lease) }, async () => { await this.o.environment.down(serving.app!); return this.o.supervisor().cleanup(serving.app!); })
        : { left: [] };
      const why = await w.stack.end(run);
      if (left.length || why) w.dirty = true;
    } catch {
      w.dirty = true;
    } finally {
      w.folders.push(trees.checkout);
      delete w.running;
      w.used = this.o.now();
      if (w.ending || this.o.stopping()) await this.tear(w).catch(() => undefined);
      this.nextTurn(w.worktree);
    }
    return named.length ? { uncounted: named.join('; ') } : {};
  }
  /** The start a check's stack needs now, for the lanes: the median of each start step that will run, the per-run part, and the wait for a free stack. */
  async expectedStart(folder: string, worktree: string): Promise<number> {
    if (!this.wanted(folder)) return 0;
    const rows = await this.o.raw(`SELECT json_extract(data, '$.steps') AS steps FROM events WHERE kind = 'stack.served' ORDER BY log_pos DESC LIMIT 20`) as { steps: string }[];
    const ran = rows.flatMap((r) => JSON.parse(r.steps) as { step: string; status: string; ms: number }[]).filter((s) => s.status === 'ran');
    const of = (step: string): number => median(ran.filter((s) => s.step === step).map((s) => s.ms));
    const w = this.warm.get(worktree);
    const keys = await this.o.environment.keys(folder).catch(() => undefined);
    const last = w?.stack.last;
    const steps = (['services', 'install', 'migrate', 'seed'] as const).filter((s) => !keys || !last || keys[s] !== last[s]);
    const pool = (await this.o.leases().kinds()).find((k) => k.name === 'stack.slot')?.match ?? '';
    const free = w !== undefined || this.warm.size < Number(/\d+/.exec(pool)?.[0] ?? 0) || this.reclaimable() !== undefined;
    return steps.reduce((n, s) => n + of(s), 0) + of('clone') + of('app') + (free ? 0 : this.waitMs());
  }

  /** Sessions retained by the core until their stack's keys have been released. */
  holders(): ReadonlySet<string> { return new Set([...this.owners.values(), ...this.starters.values()]); }

  /** A worktree named by its absolute path, as its real path. */
  worktreeOf(params: Obj): string {
    const { worktree } = params;
    if (typeof worktree !== 'string' || !isAbsolute(worktree) || !existsSync(worktree)) throw new Refused(refusal('type', '/params/worktree', 'Name the worktree by its absolute path.', worktree));
    return realpathSync(worktree);
  }

  /** The keys a stack leased per session before this start (#332): each ends once the record proves its processes gone. */
  async adopt(run: string, lease: string): Promise<void> {
    this.taken.set(run, [...(this.taken.get(run) ?? []), lease]);
    await this.giveBack(run).catch(() => undefined);
  }

  /** `deep env up` for its caller's session (`mcp:<id>`), or for your own terminal with none. */
  up(worktree: string, holder?: string): Promise<Obj> {
    return this.inTurn(worktree, () => this.riseIn(worktree, holder));
  }

  /** `caller` is the agent session's deep mcp asking; a stack whose keys another session leased stays up for it (#332). */
  async down(worktree: string, at: At, caller?: string): Promise<Obj> {
    // A stack still coming up is signalled down now: its up ends BLOCKED, and this down's turn follows it.
    const rising = this.rising.get(worktree);
    const owner = rising ? this.ownerOf(rising) : undefined;
    if (rising && caller && owner && owner !== caller) throw (new Refused(refusal('role', at.path, `The stack coming up in ${worktree} runs on keys ${owned(owner!)} leased, so only they, or you from your own terminal, take it down.`, worktree)));
    if (rising) void this.o.environment.down(rising);
    return this.inTurn(worktree, () => this.downIn(worktree, at, rising, caller));
  }

  /** A session that ended takes the stacks it started or its keys back down with it, volumes and all, so nothing outlives it (#332, #342). */
  endFor(session: string): void {
    if (this.o.plant === 'reap-session-volumes') void this.reapCommands(session);
    for (const w of [...this.warm.values()]) {
      if (w.session !== session) continue;
      if (w.running) w.ending = true;
      else void this.tear(w);
    }
    for (const [worktree, stack] of this.stacks) {
      if (this.owners.get(stack.run) === `mcp:${session}` || this.starters.get(stack.run) === `mcp:${session}`) void this.down(worktree, { path: '/params/worktree', remedy: 'deep env up' }).catch(() => undefined);
    }
  }
  /** The planted reaper: every volume the session's own commands made, which no record proves the supervisor started. */
  private async reapCommands(session: string): Promise<void> {
    const rows = await this.o.raw(`SELECT json_extract(data, '$.command') AS command FROM events WHERE kind = 'tool.before' AND session_id = ?`, [session]) as { command: string | null }[];
    for (const { command } of rows) for (const [, volume] of (command ?? '').matchAll(/docker volume create (\S+)/g)) execFile('docker', ['volume', 'rm', '-f', volume!], () => undefined);
  }

  /**
   * The stack a check run needs, brought up from the run's own checkout; BLOCKED when it isn't ready. The values it
   * loaded are scrubbed, and handed to `held` for the run's own output.
   */
  forRun(folder: string, held?: string[]): { run: string; up: Promise<Up> } {
    const run = this.o.environment.newRun(this.o.now());
    this.runs.add(run);
    const up = this.o.environment.up({ run, folder, sharedProject: this.o.plant === 'compose-default-project', byValue: this.o.plant === 'env-loads-by-value', take: this.take('core', run), scrub: (v) => { held?.push(...v); this.scrubValues(v); } })
      .catch((error: Error) => ({ status: 'BLOCKED' as const, run, cause: error.message }));
    return { run, up };
  }

  /**
   * Signals a stack run down through the host, then the supervisor stops what's left of it and releases its leases;
   * the keys its session leased through the table (#332) end once every process recorded for it is gone, citing those ends.
   */
  async takeDown(run: string): Promise<{ stopped: number[]; left: string[] }> {
    try {
      await this.o.environment.down(run);
      return await this.o.supervisor().cleanup(run);
    } finally {
      this.runs.delete(run);
      this.starters.delete(run);
      await this.giveBack(run).catch(() => undefined);
    }
  }

  /** Every stack run still up goes down, through the supervisor, within five seconds. */
  async close(): Promise<void> {
    await Promise.race([Promise.allSettled([...this.runs].map((run) => this.takeDown(run))), new Promise((done) => setTimeout(done, 5000))]);
  }

  /** A run's database clone, kept in the record: the template's seed record, the template's digest and when it was cloned (#332). */
  async cloned(run: string, stack: Stack): Promise<void> {
    // The planted wrong program copies the database and drops its record.
    if (!stack.seed) return; // Twin: the plant is ignored, so the clone's record is written all the same.
    const held = { held: this.o.held };
    const { source, copied_at, migration, template } = stack.seed;
    await this.o.appendCore('seed.cloned', { run, stack: stack.run, source: scrubText(source, held), copied_at: scrubText(copied_at, held), migration: scrubText(migration, held), template, cloned_at: this.o.now() }, { subject: run });
  }

  /** Runs the worktree's env call once every earlier one for it has finished: a second up waits and finds the first's stack, an up during a down starts after it. */
  private inTurn(worktree: string, call: () => Promise<Obj>): Promise<Obj> {
    const turn = (this.turns.get(worktree) ?? Promise.resolve()).catch(() => undefined).then(call);
    this.turns.set(worktree, turn);
    void turn.catch(() => undefined).then(() => { if (this.turns.get(worktree) === turn) this.turns.delete(worktree); });
    return turn;
  }
  /**
   * Ends the per-session keys a stack run leased once every process recorded for it has its process.ended, citing
   * those; while one runs, or for a run whose start nothing recorded, the record decides, never a guess.
   */
  private async giveBack(run: string): Promise<void> {
    const ids = this.taken.get(run) ?? [];
    if (!ids.length) return;
    const rows = await this.o.raw(`SELECT kind, id, json_extract(data, '$.pid') AS pid FROM events WHERE kind IN ('process.tracked', 'process.ended') AND json_extract(data, '$.run') = ?`, [run]) as { kind: string; id: string; pid: number }[];
    const ended = rows.filter((r) => r.kind === 'process.ended');
    if (rows.some((r) => r.kind === 'process.tracked' && !ended.some((e) => e.pid === r.pid))) return;
    this.taken.delete(run);
    this.owners.delete(run);
    for (const id of ids) await this.o.leases().release(id, ended.map((r) => r.id));
  }
  /**
   * env-local's Take for one stack run (#332): one of the keys, leased to the holder for the run through the kernel's
   * table, or BLOCKED naming each lease that holds them, so a session never starts on a key another one holds.
   */
  private take(holder: string, run: string): Take {
    // Two variables leased from one pool get two keys: a key this stack already holds isn't leased to it again.
    const mine = new Set<string>();
    return async (kind, keys) => {
      // Keys of a stack already taken down, whose cleanup left a process the supervisor has since seen end, go back.
      for (const other of [...this.taken.keys()]) if (!this.runs.has(other)) await this.giveBack(other).catch(() => undefined);
      // A worktree's stack whose process ended on its own is cleaned up first, which records its ends and gives its keys back.
      for (const [worktree, stack] of [...this.stacks]) {
        if (!this.taken.has(stack.run)) continue;
        // A stack whose session ended without taking it down goes now, so its keys don't outlive it.
        if (this.owners.has(stack.run) && this.ownerOf(stack.run) === undefined) {
          if (this.stacks.get(worktree) === stack) this.stacks.delete(worktree);
          await this.takeDown(stack.run).catch(() => undefined);
          continue;
        }
        if (!(await this.gone(stack.run))) continue;
        if (this.stacks.get(worktree) === stack) this.stacks.delete(worktree);
        await this.takeDown(stack.run).catch(() => undefined);
      }
      const held: string[] = [];
      for (const key of keys) {
        if (mine.has(`${kind}:${key}`)) continue;
        const got = await this.o.leases().lease({ holder, run }, { host: 'local', kind, key }, 'exclusive');
        if (got.status === 'granted') {
          mine.add(`${kind}:${key}`);
          this.taken.set(run, [...(this.taken.get(run) ?? []), got.lease.id]);
          this.owners.set(run, holder);
          return { key };
        }
        held.push(got.message);
      }
      return { cause: `no ${kind} of ${keys.join(', ')} is free to lease: ${held.join('; ')}` };
    };
  }
  /** Whether a stack run ended on its own: its first process exited, and none recorded for it still runs in the background. */
  private async gone(run: string): Promise<boolean> {
    if ((await this.o.supervisor().status(run).catch(() => undefined))?.state !== 'exited') return false;
    return !(await this.recorded(run)).some(alive);
  }
  /** Every PID the record tracked for a run. */
  private async recorded(run: string): Promise<number[]> {
    return (await this.o.raw(`SELECT DISTINCT json_extract(data, '$.pid') AS pid FROM events WHERE kind = 'process.tracked' AND json_extract(data, '$.run') = ?`, [run]) as { pid: number }[]).map((r) => r.pid);
  }
  /**
   * Whether a holder is a session that has ended. A session ends by its SessionEnd, Archive or your Remove; one a signal,
   * a crash or a shutdown ended is interrupted, can be resumed, and keeps what it holds until it ends (#342).
   */
  private over(holder: string | undefined): boolean {
    const session = holder?.startsWith('mcp:') ? this.o.session(holder.slice('mcp:'.length)) : undefined;
    return session?.ended === true && !session.interrupted;
  }
  /** Who a stack run's per-session keys stay with: its owner, unless that is a session that has ended, which owns nothing. */
  private ownerOf(run: string): string | undefined {
    const owner = this.owners.get(run);
    return this.over(owner) ? undefined : owner;
  }
  /** Values env-local loaded into a stack: scrubbed by value from hook text and evidence from now on (#332). */
  private scrubValues(values: string[]): void {
    const fresh = [...new Set(values)].filter((value) => !this.o.held.includes(value));
    if (!fresh.length) return;
    this.o.held.push(...fresh);
    this.o.scrub(fresh);
  }
  private async riseIn(worktree: string, holder?: string): Promise<Obj> {
    let running = this.stacks.get(worktree);
    // A stack that ended on its own is no one's: it is cleaned up, which gives its keys back, and a new one starts.
    if (running && (await this.gone(running.run))) {
      this.stacks.delete(worktree);
      await this.takeDown(running.run).catch(() => undefined);
      running = undefined;
    }
    // A stack is reused only while its process runs and its health route still answers 200, and by an agent session
    // only when no other session leased its keys: they stay that session's (#332).
    const owner = running ? this.ownerOf(running.run) : undefined;
    if (running && holder && owner && owner !== holder) return { status: 'BLOCKED', worktree, cause: `the stack in ${worktree} runs on leases ${(this.taken.get(running.run) ?? []).join(', ')} held by ${owned(owner)}, so it stays theirs; their deep env down, or yours from your own terminal, ends it` };
    // A stack whose keys an ended session leased starts again under its new holder, so no key outlives its session's use.
    const orphaned = running !== undefined && this.owners.has(running.run) && owner === undefined && this.owners.get(running.run) !== (holder ?? 'core');
    if (running && !orphaned && (await this.o.supervisor().status(running.run)).state === 'running' && (await this.o.environment.healthy(running))) {
      return { status: 'ready', run: running.run, worktree, ports: running.ports, ...(running.project ? { project: running.project } : {}) };
    }
    // Any other is taken down, and a new one started.
    if (running) {
      this.stacks.delete(worktree);
      await this.takeDown(running.run).catch(() => undefined);
    }
    if (this.o.stopping()) return { status: 'BLOCKED', worktree, cause: 'the hub is stopping' };
    const run = this.o.environment.newRun(this.o.now());
    this.runs.add(run);
    if (holder) this.starters.set(run, holder);
    this.rising.set(worktree, run);
    const up = await this.o.environment.up({ run, folder: worktree, sharedProject: this.o.plant === 'compose-default-project', byValue: this.o.plant === 'env-loads-by-value', take: this.take(holder ?? 'core', run), scrub: (v) => this.scrubValues(v), ...(holder ? { holder } : {}) })
      .catch((error: Error) => ({ status: 'BLOCKED' as const, run, cause: error.message }))
      .finally(() => this.rising.delete(worktree));
    if (up.status === 'BLOCKED') {
      // What it started is stopped and its leases released; a stack that never started has nothing to clean.
      await this.takeDown(run).catch(() => undefined);
      return { status: 'BLOCKED', worktree, cause: up.cause };
    }
    // A session that ended while its stack came up leaves no key behind: the stack goes down with it.
    if (holder && this.over(holder)) {
      await this.takeDown(run).catch(() => undefined);
      return { status: 'BLOCKED', worktree, cause: `${owned(holder)} ended while its stack came up` };
    }
    const unrecorded = await this.cloned(run, up.stack).then(() => undefined, (error: Error) => error.message);
    if (unrecorded) {
      await this.takeDown(run).catch(() => undefined);
      return { status: 'BLOCKED', worktree, cause: `its database's clone record couldn't be kept: ${unrecorded}` };
    }
    this.stacks.set(worktree, up.stack);
    return { status: 'ready', run, worktree, ports: up.stack.ports, ...(up.stack.project ? { project: up.stack.project } : {}) };
  }
  /**
   * Takes the worktree's stack down: signalled through the host, then the supervisor's cleanup stops what it can
   * prove is the run's and ends its leases once every recorded process is gone. A process it can't prove, or one
   * that was never recorded and still listens on a leased port, is reported with its PID and the port, never stopped.
   */
  private async downIn(worktree: string, at: At, interrupted?: string, caller?: string): Promise<Obj> {
    const stack = this.stacks.get(worktree);
    // The up it interrupted took its own stack down and cleaned it up.
    if (!stack && interrupted) return { run: interrupted, stopped: [], left: [] };
    if (!stack) throw new Refused(refusal('not_found', at.path, `No stack runs for ${worktree}; start one with ${at.remedy}.`, worktree));
    const owner = this.ownerOf(stack.run);
    if (caller && owner && owner !== caller) throw new Refused(refusal('role', at.path, `The stack in ${worktree} runs on keys ${owned(owner)} leased, so only they, or you from your own terminal, take it down.`, worktree));
    const ports = Object.values(stack.ports);
    const before = (await this.recorded(stack.run)).filter(alive);
    this.stacks.delete(worktree);
    const { result: cleaned, left } = await downLeaving(ports, { listen: listening, leases: async () => (await this.o.leases().leases()).map((v) => v.lease) }, async () => {
      // The planted wrong program stops whatever listens on the leased ports, the run's or not.
      if (this.o.plant === 'env-kills-by-port') for (const port of ports) for (const pid of await listening(port)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
      return this.takeDown(stack.run);
    });
    const stopped = [...new Set([...before.filter((pid) => !alive(pid)), ...cleaned.stopped])];
    return { run: stack.run, stopped, left };
  }
}
