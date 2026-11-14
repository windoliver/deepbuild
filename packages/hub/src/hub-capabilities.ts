import type { Connection, EventInput } from '@deepbuild/record';
import type { Obj } from './hub-shared.js';

/** The record's writer identity and ordered appends, shared by hub domains. */
export interface HubEvents {
  appendSession(session: string, agent: string, kind: string, data: Obj): Promise<void>;
  appendReading(session: string, agent: string, reading: string, hook?: string): Promise<void>;
  connection(writer: string, extra?: Partial<Connection>): Connection;
  append(connection: Connection, input: EventInput, backfill?: boolean): Promise<void>;
  appendCore(kind: string, data: Obj, extra?: { subject?: string; evidence?: string[]; v?: number }): Promise<void>;
}

/** Read-only process state; domains cannot change the hub's lifecycle. */
export interface HubRuntime {
  readonly stopping: boolean;
  readonly ready: Promise<void>;
  readonly blocked: string | undefined;
  readonly jobs: Map<string, { failures: number; since: number; at: number; error: string } | null>;
  config(): { loginPath: string; reservePct: number; rules: { margin: number; windowMs: number }; acceptance: { slots: number; gateKey: string | null } };
  readonly overrides: Map<string, { call: string; label: string; ts: number }[]>;
}

/** Scheduling on the hook queue and waking a held hook, never domain decisions. */
export interface HookSchedule {
queue<T>(work: () => Promise<T>, starting?: boolean): Promise<T>;
  askingSoon(): void;
  askingNow(): Promise<void>;
  readonly abandoned: Set<string>;
  wakeable(waits: Map<string, Set<() => void>>, key: string, ms: number): { woken: Promise<void>; cancel: () => void };
  replayLate(kept?: boolean): void;
  readonly replaying: Promise<unknown> | undefined;
  testClock(params: Obj): Obj;
}
