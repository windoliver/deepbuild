// The adapter contract's types (#312): the shapes an adapter gives and takes, shared by the registry and the
// shipped parts without either importing the other.
import type { JsonValue } from '@deepbuild/contracts';

export type JsonObject = { [key: string]: JsonValue };

/** deep-hook's request line, a hook.request@3 instance as it crosses the wire: seq is its decimal string. */
export interface HookRequestLine {
  v: 1; agent: string; event: string; seq: string; id: string; pid: number; ppid: number; matched: string[]; payload: JsonValue;
  late?: boolean; billing?: Record<string, boolean>; notes?: Record<string, string>;
}

/** One event an adapter mapped (adapter.event@1): rule is the JSON Pointer of the facts entry that decided it. */
export interface AdapterEvent { agent: string; kind: string; data: JsonObject; rule: string }
export interface Reading { code: string; field: string; version: string }
export interface Mapped { events: AdapterEvent[]; verified: boolean; readings: Reading[] }

/** adapter.caps@1: every flag present, each a boolean. */
export interface AdapterCaps {
  holdStop: boolean; wakeIdle: boolean; steer: boolean; followUp: boolean; answerPermission: boolean; nativeTools: boolean;
  mcp: boolean; rewrite: boolean; editInput: boolean; errorTurnHook: boolean; startTurn: boolean;
}
/** adapter.unsupported@1: per surface, the driven operations the adapter can't do there. */
export type Unsupported = { [surface: string]: string[] };

export interface DoctorItem { code: string; level: 'ok' | 'warn' | 'fail' | 'skip'; evidence: string; fix: string }

export type StopCause =
  | 'sign_in_required' | 'token_refresh_failed' | 'plan_window_spent' | 'rate_limited' | 'refusal' | 'max_turns'
  | 'context_overflow' | 'tool_schema_rejected' | 'agent_crashed' | 'timed_out' | 'unknown';
export interface StopReading { cause: StopCause; reset?: number }

/** The data of a turn.usage event. */
export interface TurnUsage {
  turn: string;
  model: string;
  covers: 'turn' | 'session';
  tokens: { input: number; cached: number; output: number; exact: boolean };
  cost: { basis: 'reported'; usd: number } | { basis: 'estimated'; usd: number; rate_card: string } | { basis: 'unpriced' };
  context?: { used: number; window: number };
}
export interface Skill { name: string; source: string }

export interface Adapter {
  facts: JsonValue;
  caps: AdapterCaps;
  unsupported: Unsupported;
  mapHook(request: HookRequestLine, version: string, transcript?: readonly JsonValue[]): Mapped;
  doctor(): DoctorItem[];
  readUsage?(transcript: readonly JsonValue[]): TurnUsage[];
  classifyStop?(payload: JsonValue, transcript?: readonly JsonValue[]): StopReading;
  skills?(home: string): Skill[];
}
/** The parts of an adapter that aren't data; everything else comes from its facts file. */
export interface AdapterParts {
  caps: AdapterCaps; unsupported: Unsupported; doctor(): DoctorItem[];
  readUsage?: Adapter['readUsage']; classifyStop?: Adapter['classifyStop']; skills?: Adapter['skills'];
}

export interface AdapterRegistry {
  register(name: string, adapter: Adapter): void;
  names(): string[];
  get(name: string): Adapter;
  mapHook(request: HookRequestLine, version: string, transcript?: readonly JsonValue[]): Mapped;
}

export interface Drift { field: string; reason: string }
