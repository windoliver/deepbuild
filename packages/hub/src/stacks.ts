// A worktree's stack (#331, #332): `deep env up` and `down`, deep_env, and the stack a check run needs, through
// env-local, every process through the host. The per-session keys a stack leases through the kernel's table stay
// with the session that leased them and end once every process recorded for the run is gone; a stack goes down with
// the session whose keys it holds, and with the hub.
import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { scrubText } from '@deepbuild/evidence';
import type { LeaseTable } from '@deepbuild/leases';
import type { upStack, Stack, Take, Up } from '@deepbuild/env-local';
import { alive, type Supervisor } from '@deepbuild/supervisor';
import { downLeaving } from './leftover.js';
import { refusal, Refused, type Plant } from './wire.js';

type Obj = Record<string, unknown>;
type Rows = (query: string, params?: readonly (string | number | bigint | null)[]) => Promise<unknown[]>;
/** Where a refusal points for the caller's surface, and what starts a stack there. */
export interface At { path: string; remedy: string }

/** The runtime stack lifecycle supplied by the composition root; stack policy never selects a concrete provider. */
export interface StackEnvironment {
  newRun(at: number): string;
  up(options: Parameters<typeof upStack>[1]): Promise<Up>;
  down(run: string): Promise<void>;
  healthy(stack: Stack): Promise<boolean>;
}

export interface StacksOptions {
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
  /** An agent session's process: whether it ended, its PID and the start time it had. */
  session(id: string): { ended?: boolean; pid: number; start: string } | undefined;
  /** A process's start time now, undefined when it can't be read. */
  startOf(pid: number): Promise<string | undefined>;
}

/** A per-session key's holder, as a person reads it. */
const owned = (holder: string): string => (holder === 'core' ? 'your own terminal\'s deep env up' : `session ${holder.slice('mcp:'.length)}`);
/** The PIDs that listen on the TCP port, as lsof shows them; a failed lsof rejects, since it proves nothing. */
const listening = (port: number): Promise<number[]> => new Promise((done, fail) => {
  execFile('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { env: { ...process.env, LC_ALL: 'C' } }, (error, stdout, stderr) => {
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
  /** Each worktree's stack run while it waits for its health route, so a down can end it rather than wait. */
  private readonly rising = new Map<string, string>();

  constructor(private readonly o: StacksOptions) {}

  /** Sessions retained by the core until their stack's keys have been released. */
  holders(): ReadonlySet<string> { return new Set(this.owners.values()); }

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
    const owner = rising ? await this.ownerOf(rising) : undefined;
    if (rising && caller && owner && owner !== caller) throw (new Refused(refusal('role', at.path, `The stack coming up in ${worktree} runs on keys ${owned(owner!)} leased, so only they, or you from your own terminal, take it down.`, worktree)));
    if (rising) void this.o.environment.down(rising);
    return this.inTurn(worktree, () => this.downIn(worktree, at, rising, caller));
  }

  /** A session that ended takes the stacks its keys back down with it, so no key outlives its session (#332). */
  endFor(session: string): void {
    for (const [worktree, stack] of this.stacks) {
      if (this.owners.get(stack.run) === `mcp:${session}`) void this.down(worktree, { path: '/params/worktree', remedy: 'deep env up' }).catch(() => undefined);
    }
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
    if (!stack.seed || this.o.plant === 'env-clone-without-record') return;
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
        // A stack whose session is gone without a SessionEnd goes down with it, so its keys don't outlive it.
        if (this.owners.has(stack.run) && (await this.ownerOf(stack.run)) === undefined) {
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
   * Who a stack run's per-session keys stay with: its owner, unless that is a session that has ended, which owns
   * nothing; one that ended without a SessionEnd (its agent killed) is ended once its agent's process is gone. A start
   * that can't be read (ps failing under load) proves nothing, so the session keeps its stack while its process runs.
   */
  private async ownerOf(run: string): Promise<string | undefined> {
    const owner = this.owners.get(run);
    const session = owner?.startsWith('mcp:') ? this.o.session(owner.slice('mcp:'.length)) : undefined;
    if (!session) return owner;
    if (session.ended) return undefined;
    const start = await this.o.startOf(session.pid);
    return (start === undefined ? alive(session.pid) : start === session.start) ? owner : undefined;
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
    const owner = running ? await this.ownerOf(running.run) : undefined;
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
    const ended = this.owners.get(run);
    if (ended && (await this.ownerOf(run)) === undefined) {
      await this.takeDown(run).catch(() => undefined);
      return { status: 'BLOCKED', worktree, cause: `${owned(ended)} ended while its stack came up` };
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
    const owner = await this.ownerOf(stack.run);
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
