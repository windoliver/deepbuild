// The ledger's caller-priced reserve against every covering budget (#509: a paid job's call, which its own authority ask
// lets run): reserved against each budget that covers the run in one append, against none when none covers it with no
// ask raised, and BLOCKED on a covering budget without room with that budget's raise ask, whose yes holds room for that
// run alone.
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openAsks, type Asks } from '@deepbuild/asks';
import { openRecord, type Connection, type RecordStore } from '@deepbuild/record';
import { openLedger, type Ledger, type RunRequest } from '../src/index.js';

const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const DAY = 86_400_000;
const who = { actor: 'you', scope: 'you' };
const core: Connection = { writer: 'core', ...who };
const card: Connection = { writer: 'app', ...who };
const ISSUE = 'windoliver/deepbuild#509';
const TOOL = 'azure-speech@1.0.0';
const PRICE = 0.015;
const step = { does: `Run the paid tool ${TOOL} once for speech, at $${PRICE}`, changes: [], undo: null, public: false, cost: PRICE };

let n = 0;
const runId = (): string => `run:01K74G0000${String(++n).padStart(16, '0')}`;
const job = (issue = ISSUE, resource: string | null = TOOL): RunRequest => ({
  run: runId(), check: `speech on ${TOOL}`, inputs: createHash('sha256').update(`key ${n}`).digest('hex'), issue, ...(resource ? { resource } : {}),
});

let dir: string;
let record: RecordStore;
let asks: Asks;
let ledger: Ledger;
const now = (): number => T0;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'deep-budget-covering-'));
  record = await openRecord({ path: join(dir, 'record.db'), now });
  asks = await openAsks({ record, now, deliver: () => undefined });
  ledger = await openLedger({ record, asks, now, price: async () => null });
});
afterEach(async () => {
  await record.close();
  rmSync(dir, { recursive: true, force: true });
});

const approve = (kind: 'issue' | 'resource', ref: string, cap: number): Promise<string> => ledger.approve(card, { scope: { kind, ref }, cap_usd: cap, ends: T0 + 30 * DAY });
const asksRaised = async (): Promise<string[]> => (await record.read({ after: 0, limit: 1000 })).filter((e) => e.kind === 'ask.created').map((e) => `ask:${e.id}`);
const yes = async (ask: string): Promise<void> => asks.answer(card, ask, { option: 'approve', plan_hash: (await asks.card(ask)).plan!.hash, token: `click-${ask}` });

it('reserves the caller\'s price against every budget that covers the run, and against none, asking nothing, when none does', async () => {
  const issue = await approve('issue', ISSUE, 10);
  const tool = await approve('resource', TOOL, 10);
  const covered = job();
  expect(await ledger.reserveCovering(core, covered, PRICE, step)).toEqual({ run: covered.run, status: 'started', reserved: [{ budget: issue, usd: PRICE }, { budget: tool, usd: PRICE }] });
  await ledger.charge(core, covered.run, PRICE);
  expect([await ledger.budget(issue), await ledger.budget(tool)].map((b) => [b.spent_usd, b.reserved_usd])).toEqual([[PRICE, 0], [PRICE, 0]]);

  const alone = job('windoliver/deepbuild#77', null);
  expect(await ledger.reserveCovering(core, alone, PRICE, step)).toEqual({ run: alone.run, status: 'started', reserved: [] });
  expect(await asksRaised(), 'a run no budget covers raises no ask of the ledger\'s').toEqual([]);
  expect([await ledger.budget(issue), await ledger.budget(tool)].map((b) => b.left_usd), 'and takes nothing from a budget that doesn\'t cover it').toEqual([10 - PRICE, 10 - PRICE]);
});

it('a covering budget without room holds the run BLOCKED with its raise ask, and your yes holds room for that run alone', async () => {
  const issue = await approve('issue', ISSUE, 0.01);
  const tool = await approve('resource', TOOL, 10);
  const short = job();
  const blocked = await ledger.reserveCovering(core, short, PRICE, step);
  expect(blocked).toMatchObject({ run: short.run, status: 'BLOCKED', cause: 'budget', owner: 'you', budget: issue });
  const ask = (blocked as { ask: string }).ask;
  expect(await asksRaised(), 'one ask, the raise').toEqual([ask]);
  expect((await asks.card(ask)).plan!.steps.map((s) => s.cost), 'the raise shows the run at its price').toEqual([PRICE]);
  expect([(await ledger.budget(issue)).reserved_usd, (await ledger.budget(tool)).reserved_usd], 'nothing reserved while it waits').toEqual([0, 0]);

  await yes(ask);
  expect(await ledger.reserveCovering(core, job(), PRICE, step), 'another run takes none of the room your yes holds').toMatchObject({ status: 'BLOCKED', cause: 'budget', budget: issue });
  expect(await ledger.reserveCovering(core, short, PRICE, step)).toEqual({ run: short.run, status: 'started', reserved: [{ budget: issue, usd: PRICE }, { budget: tool, usd: PRICE }] });
});
