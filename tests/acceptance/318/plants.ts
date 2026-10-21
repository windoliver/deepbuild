// The wrong programs the issue names, planted around the real asks core and the real record: each is the
// real program with one part done wrong, so a test that passes on the real one and fails on its plant
// fails for the reason its criterion names. plants.test.ts runs each criterion's scenario against them.

import { listSchemas } from '../../../packages/contracts/src/index.ts';
import type { JsonValue, SchemaEntry } from '../../../packages/contracts/src/index.ts';
import type { RecordStore } from '../../../packages/record/src/index.ts';
import { AskRefused } from '../../../packages/asks/src/index.ts';
import type { AskSource, Asks } from '../../../packages/asks/src/index.ts';
import { isObj, ulid, type Obj, type Planting } from './helpers.ts';

const withAppend = (record: RecordStore, change: (kind: string, data: Obj, session: string | undefined) => void): RecordStore => ({
  append: (connection, event) => {
    const data = structuredClone(event.data);
    if (isObj(data)) change(event.kind, data, connection.session);
    return record.append(connection, { ...event, data });
  },
  read: (q) => record.read(q),
  table: (name) => record.table(name),
  session: (id) => record.session(id),
  rebuild: () => record.rebuild(),
  raw: (sql) => record.raw(sql),
  close: () => record.close(),
});
/** The option of the ask's card that declares this decision, with the plan digest the card shows. */
const optionWith = async (asks: Asks, handle: string, decision: string): Promise<Obj | undefined> => {
  const shown = await asks.card(handle);
  const option = shown.options.find((o) => o.decision === decision)?.id;
  return option === undefined ? undefined : { option, ...(shown.plan ? { plan_hash: shown.plan.hash } : {}) };
};

/** An answer path that reads "yes" in your words as choosing the allow option. */
export const infersYes: Planting = {
  asks: (asks) => ({
    ...asks,
    answer: async (connection, handle, input) => {
      if (isObj(input) && typeof input.words === 'string' && /\byes\b/i.test(input.words) && input.option === undefined) {
        const allow = await optionWith(asks, handle, 'allow');
        if (allow) return asks.answer(connection, handle, { ...input, ...allow, token: 'inferred' });
      }
      return asks.answer(connection, handle, input);
    },
  }),
};

/** An answer path that copies `decision` from the request instead of refusing it. */
export const copiesDecision: Planting = {
  asks: (asks) => ({
    ...asks,
    answer: async (connection, handle, input) => {
      if (isObj(input) && 'decision' in input) {
        const { decision, ...rest } = input;
        const chosen = typeof decision === 'string' ? await optionWith(asks, handle, decision) : undefined;
        return asks.answer(connection, handle, { ...rest, ...chosen });
      }
      return asks.answer(connection, handle, input);
    },
  }),
};

/** A catalogue whose ask.created leaves `fallback` to the live table: the log never holds it. */
export const fallbackInLiveTable: Planting = {
  // The record lays these over the published schemas, so only the planted entry is passed.
  schemas: listSchemas().filter((entry) => entry.name === 'ask.created@1').map((entry): SchemaEntry => {
    const schema = structuredClone(entry.schema) as Obj;
    const data = (schema.properties as Obj).data as Obj;
    for (const branch of (data.oneOf ?? [data]) as Obj[]) branch.required = (branch.required as string[]).filter((f) => f !== 'fallback');
    return { name: entry.name, schema: schema as SchemaEntry['schema'] };
  }),
  record: (record) => withAppend(record, (kind, data) => { if (kind === 'ask.created') delete data.fallback; }),
};

/** A hub that keys supersede and the fold on the session ID: a rotated ID is a new thread to it. */
export const keyedOnSession: Planting = {
  record: (record) => withAppend(record, (kind, data, session) => { if (kind === 'session.start' && session) data.thread = session; }),
};

/** A hub that records a late allow as answered and delivers it, instead of refusing it. */
export const lateAllowAnswered: Planting = {
  asks: (asks, world) => ({
    ...asks,
    answer: async (connection, handle, input) => {
      try {
        return await asks.answer(connection, handle, input);
      } catch (error) {
        if (!(error instanceof AskRefused) || !isObj(input) || typeof input.option !== 'string') throw error;
        world.deliveries.push({ ask: handle, session: '', option: input.option, decision: 'allow', words: null, provisional: false, undoes: null });
        await world.record.append({ writer: 'core', actor: 'you', scope: 'you' }, {
          v: 1, id: ulid(world.clock.now()), kind: 'ask.answered', subject: handle, ts: world.clock.now(),
          data: { answer: input.option, plan_hash: null, decision: 'allow' } as JsonValue,
        }).catch(() => undefined);
      }
    },
  }),
};

/** A sources table that files the paid generation as a choice whose default approves. */
export function paidGenerationAsChoice(rows: AskSource[]): AskSource[] {
  return rows.map((row) => {
    if (row.source !== 'generation.paid') return row;
    const fixture = structuredClone(row.fixture);
    const data = fixture.ask as Obj;
    data.kind = 'choice';
    data.options = [{ id: 'generate', label: 'Generate it', decision: 'allow' }, { id: 'skip', label: 'Skip it', decision: 'none' }];
    data.recommended = 'generate';
    data.default = 'generate';
    return { ...row, kind: 'choice', fixture: { ask: data, at_deadline: { decision: 'allow' } } };
  });
}
