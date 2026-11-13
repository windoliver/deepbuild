// Shared schedule values; no dependency on owners.
/** A run's verdict on its schedule's claim. */
export type Verdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'INCONCLUSIVE' | 'INVALID' | 'uncounted';
export type Cadence = { every: number } | { cron: string };
/** What a scheduled job may do: the sources it reads, the notice, store and send kinds it may make, and whether it may end with a no-op. */
interface Declares { readings: string[]; notices: string[]; stores: string[]; sends: string[]; noop: boolean }
/** `cadence` is null for a job that checks notices and runs only on the schedules notices give it (#262). */
export interface ScheduleDecl { name: string; plugin: string; cadence: Cadence | null; deadline: number; declares: Declares }

/** One run of a schedule, as the hub recorded it. */
export interface ScheduleRun {
  run: string;
  schedule: string;
  due: number;
  dispatched: number | null;
  ended: number | null;
  verdict: Verdict | null;
  cause: string | null;
  stopped: 'before dispatch' | null;
  /** Each send the run started, whether it went out. */
  sends: { key: string; outcome: 'sent' | 'not sent' | 'unknown' }[];
  /** Handles of what the hub recorded for it. */
  changes: string[];
}
/** One row of the schedules list. */
export interface ScheduleRow {
  name: string;
  extension: string;
  state: 'on' | 'paused';
  activity: 'idle' | 'queued' | 'running';
  words: string;
  next: number | null;
  last: { run: string; at: number; verdict: Verdict | null } | null;
  owner: string | null;
}
/** How a dispatched run ended, as the host judged it; `interrupted` when the hub stopped under it. */
export type Ended = { verdict: Verdict; cause: string | null; changes: string[] } | 'interrupted';
/** One schedule.run@1 event's data. */
export interface RunEvent {
  run: string; schedule: string; plugin: string; phase: 'queued' | 'dispatched' | 'ended'; due: number;
  resumed?: boolean; verdict?: Exclude<Verdict, 'uncounted'>; noop?: boolean; cause?: string | null; stopped?: boolean; changes?: string[];
}
/** A scheduled run under way (#365): what its job may do, and what the hub saw and recorded for it. */
export interface RunCtx { run: string; decl: ScheduleDecl; changes: string[]; blocked: string | null; held: string | null; ended: boolean }
