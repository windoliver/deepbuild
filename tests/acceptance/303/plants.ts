// The wrong programs the issue names, planted around the real kernel and the real record: each is the real program
// with one part done wrong, driven through the same surface, so a scenario that passes on the real one and fails
// on its plant fails for the reason its criterion names. plants.test.ts runs each criterion's scenario against them.

import { ulid } from '../../../packages/record/src/index.ts';
import type { Connection, Event, RecordStore } from '../../../packages/record/src/index.ts';
import type { Definition, DefinitionInput, Prompt, Prompted } from '../../../packages/tasks/src/index.ts';
import { handleOf, isObj, sha256, type Planting, type World } from './helpers.ts';

const everything = async (record: RecordStore): Promise<Event[]> => {
  const all: Event[] = [];
  for (let after = 0; ;) {
    const page = await record.read({ after, limit: 1000 });
    all.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1]!.log_pos;
  }
  return all;
};
/** The real record, with one change to what it appends; every other method is the record's own. */
const withAppend = (record: RecordStore, change: (kind: string, data: Record<string, unknown>) => void): RecordStore => new Proxy(record, {
  get(target, property, receiver) {
    if (property === 'append') {
      return (connection: Connection, event: Parameters<RecordStore['append']>[1]) => {
        const data = structuredClone(event.data);
        if (isObj(data)) change(event.kind, data);
        return target.append(connection, { ...event, data });
      };
    }
    const value = Reflect.get(target, property, receiver) as unknown;
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  },
});

/**
 * The hub's rule at the base (packages/hub/src/core.ts: `if (draft.kind === 'user.ask' && data.from === 'person') data.tasks = [...]`),
 * applied to the prompts `when` picks: the hook records the prompt with its message handle as its task and opens
 * the task, whatever the text asked. Every other prompt goes through the kernel.
 */
function opensTaskFor(when: (events: Event[], session: string) => boolean): Planting {
  return {
    tasks: (tasks, world) => ({
      ...tasks,
      prompt: async (connection: Connection, prompt: Prompt): Promise<Prompted> => {
        const session = connection.session!;
        if (prompt.from !== 'person' || !when(await everything(world.record), session)) return tasks.prompt(connection, prompt);
        const handle = handleOf(session, prompt.msg);
        const thread = String((await world.record.table('sessions')).rows.find((r) => r.id === session)?.thread_id ?? session);
        const ts = world.clock.now();
        const ask = ulid(ts);
        await world.record.append(connection, { v: 1, id: ask, kind: 'user.ask', ts, data: { msg: prompt.msg, text: prompt.text, tasks: [handle], from: prompt.from } });
        await world.record.append({ writer: 'core', actor: connection.actor, scope: connection.scope, session }, { v: 1, id: ulid(ts), kind: 'task.created', ts, data: { task_ref: handle, thread, owner: connection.actor, title: prompt.text } });
        return { ask, task: handle };
      },
    }),
  };
}
/** A rule that opens a task for every first prompt a person types in a session. */
export const opensEveryFirstPrompt: Planting = opensTaskFor((events, session) => !events.some((e) => e.session === session && e.kind === 'user.ask'));
/** A rule that opens a task for every message typed while the agent works: a prompt that lands in an open turn. */
export const opensEveryMidTurnMessage: Planting = opensTaskFor((events, session) => {
  const own = events.filter((e) => e.session === session);
  const lastAsk = own.findLast((e) => e.kind === 'user.ask');
  const lastStop = own.findLast((e) => e.kind === 'agent.stop');
  return lastAsk !== undefined && (lastStop === undefined || lastAsk.log_pos > lastStop.log_pos);
});

/** A lock whose hash is a function `over` of the definition instead of the kernel's: recorded in definition.locked, read back, recomputed at every claim. */
function hashesBy(over: (definition: DefinitionInput | Definition) => string): Planting {
  let pending: string | undefined;
  const rehash = <T extends Definition | undefined>(definition: T): T => (definition ? { ...definition, hash: over(definition) } : definition);
  return {
    record: (record) => withAppend(record, (kind, data) => { if (kind === 'definition.locked' && pending) data.hash = pending; }),
    tasks: (tasks) => ({
      ...tasks,
      lock: async (connection, input) => {
        pending = over(input);
        try {
          return rehash(await tasks.lock(connection, input));
        } finally {
          pending = undefined;
        }
      },
      definition: async (task_ref) => rehash(await tasks.definition(task_ref)),
      tasks: async (thread) => (await tasks.tasks(thread)).map((t) => ({ ...t, definition: rehash(t.definition ?? undefined) ?? null })),
      hashOf: (definition) => over(definition),
      claim: async (connection, task_ref) => {
        // The wrong lock sees no change where its hash reads none: the recomputed hash is the locked one.
        const real = await tasks.claim(connection, task_ref);
        const current = await tasks.definition(task_ref);
        const hash = current ? over(current) : real.hash;
        return { ...real, hash, locked: hash, changed: [], proposal: null };
      },
    }),
  };
}
/** A lock that hashes only the requirement IDs. */
export const hashesOnlyIds: Planting = hashesBy((d) => sha256(JSON.stringify(d.requirements.map((r) => r.id))));
/** A lock that hashes the requirement records with their check paths, but never the check files' bytes. */
export const hashesPathsNotBytes: Planting = hashesBy((d) => sha256(JSON.stringify({
  requirements: d.requirements.map((r) => ({ id: r.id, text: r.text, author: typeof r.author === 'string' ? r.author : r.author.handle, checks: r.checks.map((c) => (typeof c === 'string' ? c : c.path)) })),
  deliverables: d.deliverables, issue_rev: d.issue_rev, base_commit: d.base_commit,
})));

/** A lock that reads an author's role from the text it signed: "the repo owner" in a comment makes its author the owner. */
export const roleFromText: Planting = {
  tasks: (tasks) => ({
    ...tasks,
    lock: async (connection, input) => {
      const signedAsOwner = new Set(input.requirements.filter((r) => /\b(the )?repo owner\b/i.test(r.text)).map((r) => r.author));
      const authors = input.item.authors.map((a) => (signedAsOwner.has(a.handle) ? { ...a, role: 'owner' as const } : a));
      return tasks.lock(connection, { ...input, item: { ...input.item, authors } });
    },
  }),
};

/** A stop rule that reads every stop whose turn made a tool call as a claim, whatever started the turn or what the calls did. */
export const everyToolCallStopIsClaim: Planting = {
  tasks: (tasks, world: World) => ({
    ...tasks,
    stops: async (session) => {
      const readings = await tasks.stops(session);
      const view = await world.record.session(session);
      const events = await everything(world.record);
      const kinds = new Map(events.map((e) => [e.id, e.kind]));
      return readings.map((r) => {
        const turn = view?.turns.find((t) => t.events.includes(r.stop));
        const called = turn?.events.some((id) => kinds.get(id) === 'tool.before' || kinds.get(id) === 'tool.after') ?? false;
        return { ...r, claim: called, reason: called ? 'the turn made tool calls' : 'the turn made no tool call' };
      });
    },
  }),
};
