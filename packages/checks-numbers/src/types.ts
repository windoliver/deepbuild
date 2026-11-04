// The shapes of the numbers check (#87): each number a claim states with the query behind it, the terms a change
// adds with the sample they run on, and a stated speed with the timing check behind it.
import type { CheckContext, CheckResult, CheckRunnerFill, CheckSpec, KindBudget } from '@deepbuild/conformance';
import type { TimingReport } from '@deepbuild/verdicts';

/** A query: a SQLite file in the checkout, opened read-only, and SQL whose one row's first column is the number. */
export interface Query { database: string; sql: string }
/** One number a claim states, as written (`4,500`), the query behind it, and an independent recount where one exists. */
export interface StatedNumber { where: string; stated: string; query: Query; recount?: Query }
/** A term the change adds: the query with it and without it, both run on a read-only sample of real data. */
export interface AddedTerm { kind: 'scoring term' | 'filter' | 'input' | 'data source'; term: string; with: string; without: string; sample: string }
export interface NumbersSpec extends CheckSpec { kind: 'numbers'; runner: 'sqlite'; numbers: StatedNumber[]; added: AddedTerm[] }

/** The numbers kind as the check.kind@1 fill deep.registerCheck registers, with its declared budget. */
export interface NumbersFill extends CheckRunnerFill {
  kind: 'numbers';
  budget: KindBudget;
  run(spec: NumbersSpec, ctx: CheckContext): CheckResult | Promise<CheckResult>;
}

/** A toolchain by version. */
export interface Toolchain { compiler: string; driver: string; runtime: string }
/** The timing check behind a stated speed: its baseline (a commit, the merge base by default, or a library at a
 *  pinned release), the toolchain each side runs with, the machine by its fingerprint, and repeats a side. */
export interface TimingCheck {
  baseline: { commit: string } | { library: string; release?: string };
  toolchain: { baseline: Toolchain; change: Toolchain };
  machine: string;
  /** Declared only by a check that can time warm caches alone. */
  warm?: true;
  repeats: number;
}
export interface SpeedClaim { stated: string; timing: TimingCheck }
/** One side's work as the platform runs it, a boundary the check doesn't own. */
export interface Side {
  /** Only compiles and loads. */
  warmUp(): void | Promise<void>;
  /** Flushes the data caches; says whether it could. */
  flush(): boolean | Promise<boolean>;
  /** One timed repeat, timed by the check's own clock. */
  work(): void | Promise<void>;
  toolchain(): Toolchain;
  machine(): string;
}
export interface SpeedResult extends CheckResult { timing: TimingReport; repeats: { baseline: number[]; change: number[] } }
/** Planted wrong programs; tests only. */
export type SpeedPlant = 'library-baseline' | 'any-toolchain';
