// Advice only: Asks still validates resolver answers and owns decisions.
import type { Judgment, Resolver, Tally } from '@deepbuild/asks';
import type { Ledger } from '@deepbuild/budget';
import type { RecordStore } from '@deepbuild/record';

export interface DecisionsProvider {
  resolver(options: { record: RecordStore; ledger?: Ledger }): Resolver;
  evidence(options: { record: RecordStore; now: number; window: number }): Promise<{ decision: string; rule: Tally; yours: Tally }[]>;
  judge(rule: Tally, yours: Tally, margin: number): Judgment;
}
