// What the hub gives its gate runner, and what a run's key and a check's surface are (#29, #1018, #874): moved out of
// gate-runner.ts whole (#3562), which re-exports each, so that file stays within its size.
import type { Checkouts } from '@deepbuild/gate';
import type { Connection, EventInput } from '@deepbuild/record';
import type { Admission } from './admission.js';
import type { Plant } from './plant.js';
import type { StackWant } from './stacks.js';
import type { Spent, Variant } from './variants.js';

/** The surface a drafted check declares it enters through (#874): #31's shape, its check the requirement's own. */
export type Surface = { kind: string } & Record<string, unknown>;
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
  start(r: { claim: string; check: string; approved: string | null; command: string; commit: string; cwd: string; lane: 'fast' | 'slow'; expected_ms: number | null; deadline_ms: number | null; env?: Record<string, string>; hosts?: string[]; standIns?: string[]; references?: { path: string; sha256: string }[]; overlay?: Record<string, string>; variant?: Variant; key?: RunKey; stack?: StackWant; memory?: Admission; /** The host the run is on, in `cwd` there (#999). */ host?: string }): Promise<string>;
  /** The call that spent a task's held-out variant, by its files (#3229); a runner without it knows of none. */
  spent?(task: string, files: Record<string, string>): Spent | undefined;
  /** The start a check's stack needs now, added to its expected time (#580). */
  stackStart?(folder: string, worktree: string): Promise<number>;
  /** The planted wrong program's start of a stack at a claim, whatever its lane. */
  startsAtClaim?(folder: string, session: string, worktree: string): Promise<void>;
  /** Whether a checkout's done.yaml has an environment, so a journey there runs on its warm stack (#580). */
  stacked?(folder: string): boolean;
  /** Each program a check's command names, with its reading (#2060); a runner without it reads none. */
  programs?(command: string, checkout: string, read: Map<string, string>): Promise<[string, string][]>;
  /** Resolves with the run's outcome once it has finished. */
  ended(run: string): Promise<string>;
  /**
   * CPU slots free now, and how many of the pool's slots slow runs may hold at once, the lease table's rule (#907): the
   * slow lane takes no queued place while its checks hold them all (#3562). A host that gives none has no such rule.
   */
  slots(): { free: number; slow?: number };
  budget_ms: number;
  hold_ms: number;
  /** Background work held a session's slow checks for 30 minutes and they start now, the work still running (#907). */
  capped?(session: string, checks: string[]): void;
  /** A run of the claim ended: its verdict as it now stands is read and, once made, recorded (#30). */
  judged?(claim: string): Promise<void>;
  /** The base-commit service (#31): every checkout a claim's checks run in comes from it. */
  checkouts(): Checkouts;
  /** The runner let go of a claim (#1866): what the core keeps of it goes too. */
  settled?(claim: string): void;
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
