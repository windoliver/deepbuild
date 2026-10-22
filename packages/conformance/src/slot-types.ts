// The slot kits' shapes (#314): a fill for a hub slot other than adapter@1 is plain data whose methods are own
// closures; a kit is plain data too (rules, fixtures, planted wrong fills), so a test derives a variant by
// spreading either. The check runner's spec, context and result are here as well, since check.kind@1 is the
// one slot whose fill's answer has a published shape of its own (a closed run outcome, never a verdict).
import type { JsonValue } from '@deepbuild/contracts';
import type { Random } from './generator.js';
import type { Verdict } from './types.js';

/** What a check run came to, run.finished@1's closed list; the core, never the runner, matches it to a verdict. */
export type RunOutcome = 'passed' | 'failed' | 'ran_nothing' | 'missing' | 'overran' | 'stopped' | 'uncounted';
export const RUN_OUTCOMES: readonly RunOutcome[] = ['passed', 'failed', 'ran_nothing', 'missing', 'overran', 'stopped', 'uncounted'];

/** A fill for a hub slot other than adapter@1: its slot, the kit revision it declares, a variant where the slot names several, and its methods. */
export interface SlotFill { slot: string; revision: number; variant?: string; [member: string]: unknown }

/** check@1's spec: the kind, the command, the declared input paths, the depth, the oracle and the contract it holds to. */
export interface CheckSpec { kind: string; runner: string; inputs: string[]; depth: string; oracle: 'code' | 'model' | 'person'; contract: string | null }
/** What a check run gets: the folder it runs in, the ms it may take, and the clock. */
export interface CheckContext { checkout: string; deadline: number; now(): number }
/** One failed test, from the tool's own report: where it failed and whether as the framework's assertion failure. */
export interface Failure { test: string; file: string; line: number; stack: string | null; assertion: boolean; message: string }
/** What a check runner returns: a closed run outcome, never a verdict; the files the run read, relative to the checkout; the mask it found in the command, or null. */
export interface CheckResult { outcome: RunOutcome; testsRun: number; failures: Failure[]; evidence: string[]; read: string[]; mask: string | null }
export interface CheckRunnerFill extends SlotFill { slot: 'check.kind@1'; kind: string; run(spec: CheckSpec, ctx: CheckContext): CheckResult | Promise<CheckResult> }

export interface SlotRule { id: string; rule: string }
/** A shipped fixture of a kit's fixed part: its input and the answer expected. check.kind@1's input is {spec, checkout, deadline}. */
export interface Fixture { id: string; input: JsonValue; expected: JsonValue }
/** A planted wrong fill: it breaks the one rule `breaks` names, fails with `message`, raises `codes`. */
export interface PlantedFill<F extends SlotFill = SlotFill> { name: string; message: string; codes: string[]; breaks: string; fill: F }
/** A kit: plain data, so a test may derive a variant by spreading it. */
export interface SlotKit<F extends SlotFill = SlotFill> { slot: string; fills: 'one' | 'many'; revision: number; rules: SlotRule[]; fixtures: Fixture[]; planted: PlantedFill<F>[] }
export interface SeededCase { id: string; input: JsonValue }

export interface SlotCaseResult { id: string; part: 'fixed' | 'seeded'; outcome: Verdict; message: string; codes: string[]; input: JsonValue | null }
export interface SlotReport { verdict: Verdict; slot: string; revision: number; seed: number; cases: SlotCaseResult[] }
/** No seed: the runner draws one and records it; no parts: both. */
export interface SlotRunOptions { seed?: number; parts?: ('fixed' | 'seeded')[] }

// ---- The kits' side, not exported by the package -------------------------------------------------

/** One case the judge runs: a fixture (fixed) or a generated one (seeded), with the answer it expects. */
export interface SlotCase { id: string; part: 'fixed' | 'seeded'; input: JsonValue; expected: JsonValue }
/**
 * A call into the fill, yielded by a judge and made by the runner: the runner feeds the answer back, awaited
 * when the fill answered with a promise. So one judge runs synchronously for the preflight's kit check and
 * asynchronously for runKit.
 */
export type Step = () => unknown;
export type Judge<F extends SlotFill> = (fill: F, c: SlotCase) => Generator<Step, void, unknown>;

/** Ends a case: a finding (FAIL) or a probe the runner can't make (BLOCKED). */
export class Finding extends Error {
  constructor(readonly outcome: 'FAIL' | 'BLOCKED', message: string, readonly codes: string[]) { super(message); }
}
/** A case's finding under one of the kit's rules: `${message}: ${detail}`, so a planted fill's message leads it. */
export const fail = (message: string, codes: string[], detail?: string): Finding => new Finding('FAIL', detail ? `${message}: ${detail}` : message, codes);

/** A shipped kit with what the runner needs beside the public data: its reference fills, its generator and its judge. */
export interface SlotKitImpl<F extends SlotFill = SlotFill> extends SlotKit<F> {
  /** Fresh reference fills, one per variant the slot names. */
  clean(): F[];
  /** The seeded part's cases from one draw; pure, writing nothing. */
  generate(random: Random): SlotCase[];
  judge: Judge<F>;
}
export const isSlotKit = (kit: unknown): kit is SlotKit => typeof kit === 'object' && kit !== null && 'slot' in kit;
