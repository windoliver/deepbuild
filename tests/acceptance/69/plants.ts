// The wrong programs the issue names or implies, planted around the real asks core, record, ledger and buying
// module: each is the real program with one part done wrong, so a scenario that passes on the real one and fails
// on its plant fails for the reason its criterion names. plants.test.ts runs each criterion's scenario on them.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { askSources } from '../../../packages/asks/src/index.ts';
import type { Asks, PlanInput, PlanStep } from '../../../packages/asks/src/index.ts';
import type { RecordStore } from '../../../packages/record/src/index.ts';
import type { BuyingPlanting } from './buying.ts';
import { isObj, sha256, type Planting } from './helpers.ts';

/** The real record, with some of its methods replaced. */
const around = (record: RecordStore, over: Partial<RecordStore>): RecordStore => new Proxy(record, {
  get: (real, name) => {
    if (name in over) return over[name as keyof RecordStore];
    const value = Reflect.get(real, name) as unknown;
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});
const wrap = (asks: Asks, over: Partial<Asks>): Asks => ({ ...asks, ...over });
const isAuthority = (source: string): boolean => askSources().find((r) => r.source === source)?.kind === 'authority';

/** #69.9eb13dee: a core that drafts a placeholder plan for an authority ask raised without one. */
export const placeholderPlan: Planting = {
  asks: (asks) => wrap(asks, {
    raise: (connection, source, ask, plan) => {
      if (!isAuthority(source) || (plan && plan.steps.length)) return asks.raise(connection, source, ask, plan);
      const question = isObj(ask) ? String(ask.question) : 'go ahead';
      const placeholder = { does: question, changes: ['what the run touches'], undo: null, public: true, cost: 0 } as unknown as PlanStep;
      return asks.raise(connection, source, ask, { steps: [placeholder], diff: sha256('') });
    },
  }),
};

/** #69.f54debdc: a run held to your yes, not to the plan it approved: any step runs once the ask was approved. */
export const yesOnly: Planting = {
  asks: (asks) => wrap(asks, {
    beforeStep: async (ask, step) => {
      const check = await asks.beforeStep(ask, step);
      if (check.run) return check;
      const shown = (await asks.card(ask)).plan;
      return shown && (await asks.authorized(ask, shown.hash)) !== null ? { run: true } : check;
    },
  }),
};

/** #69.3f9c3f3d: a core that fills a missing undo with a placeholder instead of marking the step "can't undo". */
export const undoPlaceholder: Planting = {
  asks: (asks) => wrap(asks, {
    raise: (connection, source, ask, plan) => asks.raise(connection, source, ask, plan && {
      ...plan, steps: plan.steps.map((s) => ((s as { undo: string | null }).undo === null ? { ...s, undo: 'none' } : s)),
    } as PlanInput),
  }),
};

/** #69.3f9c3f3d: a core whose default approves: an authority ask past its deadline takes its option that allows. */
export const defaultsYes: Planting = {
  record: (record) => around(record, {
    append: async (connection, event) => {
      if (event.kind !== 'ask.defaulted' || !event.subject) return record.append(connection, event);
      const id = event.subject.replace(/^ask:/, '');
      const created = (await record.read({ after: 0, limit: 100_000 })).find((e) => e.kind === 'ask.created' && e.id === id);
      const data = isObj(created?.data) ? created.data : {};
      const allow = Array.isArray(data.options) ? data.options.find((o) => isObj(o) && o.decision === 'allow') : undefined;
      if (data.kind !== 'authority' || !isObj(allow)) return record.append(connection, event);
      return record.append(connection, { ...event, data: { ...(event.data as object), answer: String(allow.id), decision: 'allow' } });
    },
  }),
};

/** #69.275c8f18: a batch whose every step starts switched on, so approving it runs the steps that can't be undone. */
export const startsOn: Planting = {
  asks: (asks) => wrap(asks, {
    batch: async (batch) => {
      const shown = await asks.batch(batch);
      return { ...shown, steps: shown.steps.map((s) => ({ ...s, on: true })) };
    },
    approveBatch: async (connection, batch, input) => {
      const shown = await asks.batch(batch);
      return asks.approveBatch(connection, batch, { ...input, switches: shown.steps.map((s) => ({ ask: s.ask, step: s.step, on: true })) });
    },
  }),
};

/** #69.275c8f18: one switch per ask, not per step: turning on one step that can't be undone turns on all of its ask's. */
export const askSwitch: Planting = {
  asks: (asks) => wrap(asks, {
    approveBatch: async (connection, batch, input) => {
      const shown = await asks.batch(batch);
      const asked = new Set(input.switches.filter((s) => s.on).map((s) => s.ask));
      const switches = shown.steps.filter((s) => asked.has(s.ask)).map((s) => ({ ask: s.ask, step: s.step, on: true }));
      return asks.approveBatch(connection, batch, { ...input, switches });
    },
  }),
};

/** #69.06d40ef2: a processor adapter that logs what the processor answered, receipt and card number and all, under the state folder. */
export const logsProcessor: BuyingPlanting = {
  processor: (processor, world) => ({
    charge: async (request) => {
      const answer = await processor.charge(request);
      mkdirSync(join(world.dir, 'logs'), { recursive: true });
      appendFileSync(join(world.dir, 'logs', 'processor.log'), `${new Date(world.clock.now()).toISOString()} ${request.purchase}\n${new TextDecoder().decode(answer.receipt)}\n`);
      return answer;
    },
  }),
};

/** #69.d8443973: a check against charges alone: the budget is read without the reservations still waiting on a charge. */
export const chargesAlone: BuyingPlanting = {
  record: (record) => around(record, {
    read: async (query) => (await record.read(query)).filter((e) => !/\.reserved$/.test(e.kind)),
  }),
};

/** #69.eb8b7be8: a preview that takes 2.5 s to draft, as one that waits on a slow lookup would. */
export const slowPreview: Planting = {
  asks: (asks) => wrap(asks, {
    raise: async (connection, source, ask, plan) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return asks.raise(connection, source, ask, plan);
    },
  }),
};
