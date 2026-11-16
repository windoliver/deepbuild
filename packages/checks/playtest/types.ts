// The playtest's shapes (canvas primitives: Check input: playtest; Check input: plug-in reads).

/** A policy: data, like a tour. Keys set controls at their times; each pick sets its control every `every` seconds to a value drawn by hash(the run's seed, the control, the step). */
export interface Policy { keys?: Record<string, [number, number][]>; pick?: Record<string, { from: number[]; every?: number }> }
/** A logic bot: a logic item the replica adds to its own copy of the piece; each `plays` array holds a value and a serial. */
export interface LogicBot { program: string; reads?: string[]; plays: Record<string, string>; budget?: { fuel?: number } }
/** What a replica's play runs: a policy or a logic bot. */
export type Lowered = { policy: Policy } | { logic: LogicBot };
/**
 * A bot as the check's input names it: a policy, a logic bot, or a registered first-party bot by name with its
 * params; `by: "agent"` when the working agent wrote it rather than the brief or definition.
 */
export type Bot = (Lowered | { bot: string; params?: Record<string, unknown> }) & { by?: 'agent' };

export interface Goal { name: string; when: string; each?: boolean }
/** Seconds, or a count of the piece's steps. */
export type Span = number | { steps: number };

/** Check input: playtest, as the spec's `play` holds it. */
export interface PlaytestInput {
  piece: string;
  bots: Bot[];
  runs?: number;
  seed: number;
  span?: Span;
  stuck?: { measure: string; by?: number; within?: Span };
  goals?: Goal[];
  frames?: { every?: number };
  piece_seed?: 'own' | 'run';
}

/** What `deep.canvas.play` answers (Check input: plug-in reads). */
export interface PlayAnswer {
  steps: number;
  /** One step's length, in flicks. */
  step: number;
  track: string;
  entries: Record<string, unknown>[];
  values: Record<string, unknown[]>;
  trap: Record<string, unknown> | null;
  bot_trap: Record<string, unknown> | null;
  step_times: number[];
  fuel: Record<string, number[]>;
  ceilings: Record<string, number>;
  checkpoints: { step: number; hash: string }[];
  final: string;
  frames: { step: number; sha256: string }[];
}
/** `deep.canvas.play`'s run. */
export interface PlayRun { seed: number; piece_seed?: 'own' | 'run'; span?: Span; bot?: Lowered; track?: Record<string, unknown>[]; values: string[]; frames: number[] }
export type Play = (piece: string, run: PlayRun) => Promise<PlayAnswer>;

export type Outcome =
  | { kind: 'reached'; step: number }
  | { kind: 'ended'; step: number }
  | { kind: 'stuck'; step: number; from_step: number; measure: string }
  | { kind: 'trap'; step: number; trap: Record<string, unknown> }
  | { kind: 'over_budget'; step: number; item: string; fuel: number; ceiling: number }
  | { kind: 'invalid'; step: number; why: string };
