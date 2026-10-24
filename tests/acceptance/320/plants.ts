// The wrong programs the Proof names, planted around the real asks core and the real schemas: each is the real
// program with one part done wrong, so a scenario that passes on the real one and fails on its plant fails for the
// reason its criterion names. plants.test.ts runs each scenario against its plant.

import { getSchema, registry, type JsonValue } from '../../../packages/contracts/src/index.ts';
import type { Card, InboxRow } from '../../../packages/asks/src/index.ts';
import type { Planting } from './helpers.ts';
import type { Validate } from './scenarios.ts';

/** A hub whose inbox lists every ask in the record, as #319's did, whoever owns it: the block reaches you. */
export const listsEveryAsk: Planting = {
  asks: (asks, world) => ({
    ...asks,
    inbox: async () => {
      const rows = await asks.inbox();
      const listed = new Set(rows.map((r) => r.ask));
      const now = world.clock.now();
      const unlisted: InboxRow[] = (await world.events('ask.created')).filter((e) => !listed.has(`ask:${e.id}`)).map((e) => {
        const data = e.data as { kind: InboxRow['kind']; owner: string };
        return { ask: `ask:${e.id}`, kind: data.kind, session: e.session ?? '', status: 'queued', outcome: 'unanswered', owner: data.owner, age: now - e.ts, request: null };
      });
      return [...rows, ...unlisted];
    },
  }),
};

/** A hub that keeps a block owned by someone else away from you, and drafts no request for its owner. */
export const draftsNoRequest: Planting = {
  asks: (asks) => {
    const requests = async () => new Set((await asks.inbox()).filter((r) => r.request !== null).map((r) => r.ask));
    return {
      ...asks,
      inbox: async () => (await asks.inbox()).filter((r) => r.request === null),
      needsYou: async () => {
        const drafted = await requests();
        return (await asks.needsYou()).filter((c) => !drafted.has(c.ask));
      },
    };
  },
};

/** A hub that shows a drafted request as it stood when drafted: its card is made once, when it reaches your inbox, and never re-checked. */
export const showsAsDrafted: Planting = {
  asks: (asks) => {
    const drafted = new Map<string, Card>();
    const draft = async () => {
      for (const row of await asks.inbox()) if (row.request !== null && !drafted.has(row.ask)) drafted.set(row.ask, await asks.card(row.ask));
    };
    return {
      ...asks,
      raise: async (...args) => {
        const handle = await asks.raise(...args);
        await draft();
        return handle;
      },
      needsYou: async () => {
        await draft();
        return (await asks.needsYou()).map((c) => drafted.get(c.ask) ?? c);
      },
    };
  },
};

/** A task schema in which a list may be empty: the real one with every minItems taken out, as the base had steps and unblocks. */
export const listsMayBeEmpty: Validate = (name, value) => {
  const strip = (node: JsonValue): JsonValue => {
    if (Array.isArray(node)) return node.map(strip);
    if (node === null || typeof node !== 'object') return node;
    return Object.fromEntries(Object.entries(node).filter(([key]) => key !== 'minItems').map(([key, v]) => [key, strip(v)]));
  };
  const schema = strip(getSchema(name) as JsonValue) as ReturnType<typeof getSchema>;
  return registry([{ name, schema }]).validate(name, value);
};
