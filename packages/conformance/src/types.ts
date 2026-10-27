// The conformance package's shapes (#313): what a kit holds, what a fill gives the runner, what the runner
// hands a case, and what it reports. Fills and kits are plain data whose functions are closures, so a test
// can derive a variant by spreading one.
import type { JsonValue } from '@deepbuild/contracts';
import type { Adapter, AdapterCaps, AdapterEvent, HookRequestLine, Mapped, PermissionAnswer } from '@deepbuild/adapters';

export type Verdict = 'PASS' | 'FAIL' | 'INVALID' | 'BLOCKED' | 'INCONCLUSIVE';
export type Flag = keyof AdapterCaps;
export type Operation = 'startTurn' | 'steer' | 'followUp' | 'interrupt' | 'respond' | 'history';
export const OPERATIONS: readonly Operation[] = ['startTurn', 'steer', 'followUp', 'interrupt', 'respond', 'history'];
/** The flag behind a driven operation, for the three the caps list. */
export const FLAG_OF: Partial<Record<Operation, Flag>> = { startTurn: 'startTurn', steer: 'steer', followUp: 'followUp' };

/** A driven operation's typed outcome: ok with the events it made, or unsupported naming the operation and surface. */
export type Driven = { outcome: 'ok'; events: AdapterEvent[] } | { outcome: 'unsupported'; operation: Operation; surface: string };
/**
 * Where an answer went and the transcript's sign of its delivery, null for none. The kit reads a sign as
 * `delivered:<decision>:<session>`: the decision the transcript shows applied and the session it landed in, so
 * a fill writes what its agent's transcript records in that form.
 */
export interface Delivery { session: string; sign: string | null }

/** What a kit runs: an adapter plus the driven surface. */
export interface Fill {
  adapter: Adapter;
  /** The agent version its facts cover, passed to mapHook. */
  version: string;
  /** The kit revision it declares. */
  revision: number;
  /** The surface it serves, a key of adapter.unsupported. */
  surface: string;
  drive(operation: Operation, input: JsonValue, session: string): Driven;
  deliver(answer: JsonValue, session: string): Delivery;
}

export interface Declared { flags: Flag[]; operations: Operation[]; kinds: string[] }
export interface Rect { x: number; y: number; w: number; h: number }

/** What a case may do; every probe records what the case reached. */
export interface Harness {
  /** Through the fill's adapter; reaches the kinds it maps. */
  hook(line: HookRequestLine): Mapped;
  /** Reaches the operation and the flag behind it. */
  drive(operation: Operation, input: JsonValue, session: string): Driven;
  /** A permission request answered through the fill; reaches answerPermission. */
  permission(request: JsonValue, session: string): Delivery;
  /** The fill's adapter's reply to a permission request answered with `answer`; BLOCKED when it gives none. */
  reply(answer: PermissionAnswer, request: HookRequestLine): JsonValue;
  /** Geometry; a headless harness can't make it, so the case is BLOCKED naming `bounds`. */
  bounds(panel: string): Rect;
  /** The case's own finding. */
  fail(message: string, codes?: string[]): never;
  /** The fill's facts, for a case that holds a fact a core rule reads. */
  readonly facts: JsonValue;
}

export interface Case { id: string; revision: number; declares: Declared; run(h: Harness): void }

/** A broken fake: a fill that mishandles exactly one item, the message it must fail with, the codes it must raise. */
export interface Fake {
  name: string;
  message: string;
  codes: string[];
  breaks: { rule?: string; flag?: Flag; operation?: Operation; kind?: string };
  fill: Fill;
}

export type FamilyName = 'verdict' | 'run' | 'refusal' | 'check' | 'doctor' | 'exit';
export const FAMILIES: readonly FamilyName[] = ['verdict', 'run', 'refusal', 'check', 'doctor', 'exit'];

/** One planted entry: an input that raises exactly `code` when replayed, its clean twin that raises nothing, and the fix. */
export interface PlantedEntry { family: FamilyName; code: string; codes: string[]; entry: JsonValue; twin: { value: JsonValue; codes: string[] }; fix: string }

export interface Kit { name: string; revision: number; cases: Case[]; fakes: Fake[]; planted: PlantedEntry[] }

export interface CaseResult {
  id: string;
  outcome: Verdict;
  message: string;
  codes: string[];
  declared: Declared;
  reached: Declared;
  /** The probes the harness couldn't make. */
  probes: string[];
  /** The fakes of its declared items the case failed, and those it passed. */
  killed: string[];
  survived: string[];
}
export interface Report { verdict: Verdict; revision: number; cases: CaseResult[] }
export interface FakeProof { raised: string[]; extra: string[]; missing: string[]; killed: boolean }
export interface Problem { check: string; name: string; reason: string }

export interface CodeFamily { family: FamilyName; schema: string; pointer: string; codes: string[] }
export interface Judgement { family: FamilyName; code: string; listed: boolean; verdict: Verdict; message: string }
export interface CodesPage { uri: string; code: string; family: FamilyName; schema: string; entry: PlantedEntry; markdown: string }

/** The closure beside a listed set (x-closure), as the schemas carry it. */
export type Closure = 'open' | { registry: string } | { closed: string; reopens: string; mark: 'exhaustive' | 'extensible' };
export interface Change { schema: string; path: string; reason: string }

export type MutationKind = 'required_removed' | 'enum_off_list' | 'number_past_range' | 'unknown_field';
/** `code` is the refusal the mutation must draw: required, enum, range or unlisted_field. */
export interface Mutation { kind: MutationKind; path: string; code: string; value: JsonValue }
export interface Drawn { valid: JsonValue; mutations: Mutation[] }

export type JsonObject = { [key: string]: JsonValue };
export const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
