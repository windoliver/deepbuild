// A ledger world for the budget criteria: the core's budgets (#86) on a real record in a temporary folder, with
// the real asks core and a virtual clock, reached only through the public entries of @deepbuild/record,
// @deepbuild/asks and @deepbuild/budget. Adapted from tests/acceptance/86/helpers.ts (same repo, same license).
// Prices come from a table by check; nothing here decides anything the ledger decides.
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAsks } from '../../../packages/asks/src/index.ts';
import type { Asks } from '../../../packages/asks/src/index.ts';
import { openLedger } from '../../../packages/budget/src/index.ts';
import type { BudgetInput, Ledger, RunRequest } from '../../../packages/budget/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection, Event, RecordStore } from '../../../packages/record/src/index.ts';

export const DAY = 86_400_000;
/** 2026-10-29 12:00 UTC: the clock's start. Every budget ends 30 days later. */
export const T0 = Date.UTC(2026, 9, 29, 12, 0, 0);
export const ENDS = T0 + 30 * DAY;

const who = { actor: 'you', scope: 'you' };
/** DeepBuild's own code: the runner asking to start a paid run, and reporting its cost reading. */
export const core: Connection = { writer: 'core', ...who };
/** The question card in the app: the trusted path, where you approve a budget. */
export const card: Connection = { writer: 'app', ...who };

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
function ulid(ms: number): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let n = ++minted, i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = CROCKFORD[n % 32] + tail;
  return time + tail;
}
export const runId = (): string => `run:${ulid(T0)}`;

export interface World {
  record: RecordStore;
  asks: Asks;
  ledger: Ledger;
  /** The price of each check, as the price lookup answers it. */
  prices: Map<string, number>;
  /** You approve a budget on the card: its scope, its runs and its dollar cap (the design's Budget shape). */
  approve(scope: BudgetInput['scope'], runs: number, cap_usd: number): Promise<string>;
  /** A paid run asks to start, for the issue and (when given) on the resource. */
  request(check: string, issue: string, resource?: string): Promise<{ run: string; outcome: Awaited<ReturnType<Ledger['request']>> }>;
  events(kind?: string): Promise<Event[]>;
  close(): Promise<void>;
}

export async function openWorld(): Promise<World> {
  const dir = mkdtempSync(join(tmpdir(), 'dh332-ledger-'));
  const now = () => T0;
  const record = await openRecord({ path: join(dir, 'record.db'), now });
  const asks = await openAsks({ record, now, deliver: () => undefined });
  const prices = new Map<string, number>();
  const ledger = await openLedger({ record, asks, now, price: async (r: RunRequest) => prices.get(r.check) ?? null });
  const events = async (kind?: string): Promise<Event[]> => {
    const all: Event[] = [];
    for (let after = 0; ;) {
      const page = await record.read({ after, limit: 1000 });
      all.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.log_pos;
    }
    return kind ? all.filter((e) => e.kind === kind) : all;
  };
  return {
    record, asks, ledger, prices, events,
    // `runs` is the design's Budget field this issue gives a rule (README, AC3); the input at the base has none.
    approve: (scope, runs, cap_usd) => ledger.approve(card, { scope, runs, cap_usd, ends: ENDS } as BudgetInput),
    request: async (check, issue, resource) => {
      const run = runId();
      const req: RunRequest = { run, check, inputs: createHash('sha256').update(`inputs of ${run}`).digest('hex'), issue, ...(resource ? { resource } : {}) };
      return { run, outcome: await ledger.request(core, req) };
    },
    close: async () => { await record.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}
