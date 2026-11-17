// The playtest's shapes (canvas primitives: Check input: playtest; Check input: plug-in reads).
import type { PlayIface } from './iface.ts';

/** A policy: data, like a tour. Keys set controls at their times; each pick sets its control every `every` seconds to a value drawn by hash(the run's seed, the control, the step). A value may name a play interface's action on that control (#555). */
export interface Policy { keys?: Record<string, [number, number | string][]>; pick?: Record<string, { from: (number | string)[]; every?: number }> }
/** A logic bot: a logic item the replica adds to its own copy of the piece; each `plays` array holds a value and a serial. */
export interface LogicBot { program: string; reads?: string[]; plays: Record<string, string>; budget?: { fuel?: number } }
/**
 * The first-party bots that play a play interface's grid (#555): the legal bot, seeded or greedy on `legal.score`;
 * the explorer; and the descender, which takes `action` at the nearest exit. Each acts at most once every `every` steps.
 */
export type FirstParty = { legal: { pick?: 'seeded' | 'greedy'; every?: number } } | { explorer: { every?: number } } | { descender: { action: string; every?: number } };
/** A model bot (#1048): a model reached through the plug-in's source picks a listed row every `every` steps (15 or more), within its budget. */
export type ModelBot = { model: { provider: string; every?: number; budget?: { calls?: number; tokens?: number } } };
/** What a replica's play runs: a policy, a logic bot or a first-party bot. */
export type Lowered = { policy: Policy } | { logic: LogicBot } | FirstParty | ModelBot;
/**
 * A bot as the check's input names it, `by: "agent"` when the working agent wrote it rather than the brief or
 * definition; `share` holds the share of its runs that reach each goal it names inside a band, and `expect: miss` a
 * goal none of its runs may reach.
 */
export type Bot = Lowered & { by?: 'agent'; share?: Record<string, [number, number]>; expect?: Record<string, 'miss'> };

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
  /** The play interface `game.play@1`, locked in the brief. */
  play?: PlayIface;
  /** #1048: one long run of a bot as `bots` spells one, read every `every` steps against the brief's limits. */
  soak?: { bot: Bot; steps: number; every?: number; limits: { memory?: number; save?: number; step?: number } };
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
  /** #1048: a soak's logic memories, the bytes of their pages holding a nonzero byte, at each window's last step. */
  memory?: { step: number; bytes: number }[];
}
/** `deep.canvas.play`'s run. */
export interface PlayRun {
  seed: number; piece_seed?: 'own' | 'run'; span?: Span; bot?: Lowered; track?: Record<string, unknown>[]; values: string[]; frames: number[]; play?: PlayIface;
  /** #1048: the run's track played once and, at each step, each test's entries put in a throwaway copy (rules.legal, logic.edges). */
  probe?: { at: { step: number; tests: ({ row: number[] } | { entries: { control: string; value: unknown }[] })[] }[]; settle?: number; ranges?: Record<string, [number, number]> };
  /** #1048: a soak's readings every `every` steps. */
  soak?: { every: number };
  /** #1048: a model bot's replies so far, `[step, action, a, b]`, each played when the piece lists it at that step. */
  rows?: number[][];
}
export type Play = (piece: string, run: PlayRun) => Promise<PlayAnswer>;

export type Outcome =
  | { kind: 'reached'; step: number }
  | { kind: 'ended'; step: number }
  | { kind: 'stuck'; step: number; from_step: number; measure: string }
  | { kind: 'trap'; step: number; trap: Record<string, unknown> }
  | { kind: 'over_budget'; step: number; item: string; fuel: number; ceiling: number }
  | { kind: 'invalid'; step: number; why: string };
