// The wrong programs the issue names, planted around the real ledger, asks core and record: each is the
// real program with one part done wrong, so a scenario that passes on the real one and fails on its plant
// fails for the reason its criterion names. plants.test.ts runs each criterion's scenario against them.

import type { RecordStore } from '../../../packages/record/src/index.ts';
import { askSources } from '../../../packages/asks/src/index.ts';
import { BudgetRefused } from '../../../packages/budget/src/index.ts';
import type { Ledger } from '../../../packages/budget/src/index.ts';
import { core, DAY, type Planting } from './helpers.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const withAppend = (record: RecordStore, around: RecordStore['append']): RecordStore => ({
  append: around,
  read: (q) => record.read(q),
  table: (name) => record.table(name),
  session: (id) => record.session(id),
  rebuild: () => record.rebuild(),
  raw: (sql) => record.raw(sql),
  close: () => record.close(),
});
const wrap = (ledger: Ledger, over: Partial<Ledger>): Ledger => ({ ...ledger, ...over });

/** #86.80a13633: a price nobody knows counted as free. */
export const unknownPriceFree: Planting = {
  price: (price) => async (request) => (await price(request)) ?? 0,
};

/** #86.80a13633: a ledger that releases a reservation when its run ends, before its cost reading lands. */
export const releasedAtRunEnd: Planting = {
  record: (record, world) => withAppend(record, async (connection, event) => {
    const appended = await record.append(connection, event);
    if (event.kind === 'run.finished' && isObj(event.data) && typeof event.data.run === 'string') await world.ledger.charge(core, event.data.run, 0);
    return appended;
  }),
};

/** #86.54597aa8: a ledger that asks you for each paid run, inside the budget or not. */
export const asksEachRun: Planting = {
  ledger: (ledger, world) => wrap(ledger, {
    request: async (connection, run) => {
      const outcome = await ledger.request(connection, run);
      if (outcome.status === 'started') {
        const fixture = structuredClone(askSources().find((r) => r.source === 'generation.paid')!.fixture.ask) as Obj;
        await world.asks.raise({ writer: 'core', actor: 'you', scope: 'you', ...(connection.session ? { session: connection.session } : {}) }, 'generation.paid', {
          ...fixture, question: `Start ${run.run} for its price?`, deadline: world.clock.now() + DAY,
        });
      }
      return outcome;
    },
  }),
};

/** #86.3dccb0b7: a ledger that never learns a run failed, so it runs the same inputs again. */
export const forgetsFailures: Planting = {
  record: (record) => withAppend(record, (connection, event) => {
    if (event.kind === 'run.finished' && isObj(event.data) && event.data.outcome === 'failed') return record.append(connection, { ...event, data: { ...event.data, outcome: 'passed' } });
    return record.append(connection, event);
  }),
};

/** #86.40d0717c: a ledger that covers a run by its issue's budget only, never its resource's. */
export const issueOnly: Planting = {
  ledger: (ledger) => wrap(ledger, {
    request: (connection, run) => {
      const { resource: _resource, ...rest } = run;
      return ledger.request(connection, rest);
    },
  }),
};

/** #86.020ce247: a core that checks only that the named budget exists, and applies the resolver's answer. */
export const existsOnly: Planting = {
  ledger: (ledger) => wrap(ledger, {
    resolve: async (connection, ask, answer) => {
      try {
        return await ledger.resolve(connection, ask, answer);
      } catch (error) {
        if (!(error instanceof BudgetRefused)) throw error;
        const view = await ledger.budget(answer.budget).catch(() => undefined);
        if (!view) throw error;
        return { run: error.run ?? '', status: 'started', reserved: [{ budget: answer.budget, usd: 0 }] };
      }
    },
  }),
};

/** #86.97e5a476: a ledger that takes any extension's charge, reserved or not. */
export const anyCharge: Planting = {
  ledger: (ledger) => wrap(ledger, {
    charge: async (connection, run, usd) => {
      try {
        await ledger.charge(connection, run, usd);
      } catch (error) {
        if (!(error instanceof BudgetRefused)) throw error;
      }
    },
  }),
};

/** #86.60e70718: a ledger that keeps the first reservation of a run another budget then turns away. */
export const keepsFirstReservation: Planting = {
  ledger: (ledger, world) => wrap(ledger, {
    request: async (connection, run) => {
      const outcome = await ledger.request(connection, run);
      if (outcome.status === 'BLOCKED' && outcome.cause === 'budget' && run.resource !== undefined) {
        // The issue's budget was reserved first; the GPU's then had no room, and nothing undid the first.
        const { resource: _resource, ...first } = run;
        world.hold(false);
        await ledger.request(connection, first);
      }
      return outcome;
    },
  }),
};
