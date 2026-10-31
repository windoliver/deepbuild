// The wrong programs the Proof names, planted around the real asks core: each is the real program with one part
// done wrong, so a scenario that passes on the real one and fails on its plant fails for the reason its criterion
// names. plants.test.ts runs each scenario against its plant. A plant acts after the real core's tick, appending
// what the wrong rule would have appended (through the record, as the core writes).

import type { Event } from '../../../packages/record/src/index.ts';
import { chatTask, CONTINUE_WINDOW, core, isObj, sha256, ulid, UNBLOCK_SOURCE, YOU, type Planting, type World } from './helpers.ts';
import { dataOfEvent, isTask, isTransient } from './scenarios.ts';

type Guard = 'age' | 'newest' | 'typed' | 'once';
const sessionOf = (e: Event): string => String(e.subject ?? '').replace(/^session:/, '');

/** The continues a session already has, by the stop each continues from. */
async function continuedStops(world: World): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const c of await world.continued()) out.set(c.session, [...(out.get(c.session) ?? []), c.stop]);
  return out;
}

/** Appends an automatic continue from a stop, as the core records one. */
const appendContinue = (world: World, e: Event, because = 'transient'): Promise<unknown> =>
  world.record.append(core(sessionOf(e)), { v: 1, id: ulid(world.clock.now()), kind: 'session.continued', subject: e.subject!, ts: world.clock.now(), data: { stop: e.id, because, task: null } });

/**
 * A core whose automatic continue ignores some of the rule's guards: after each tick it continues every transient
 * stop that has none, holding only the guards not ignored (its age under 10 minutes by its stamp, being the
 * session's newest stop, nothing typed since, and one continue per turn you started).
 */
function continuesIgnoring(ignored: Guard[]): Planting {
  const skip = new Set(ignored);
  return {
    asks: (asks, world) => ({
      ...asks,
      tick: async () => {
        await asks.tick();
        const now = world.clock.now();
        const all = await world.events();
        const stops = all.filter((e) => e.kind === 'agent.stop');
        const typed = all.filter((e) => e.kind === 'user.ask' && dataOfEvent(e).from === 'person');
        const done = await continuedStops(world);
        for (const stop of stops) {
          const session = sessionOf(stop);
          const d = dataOfEvent(stop);
          if (!isTransient(d) || (done.get(session) ?? []).includes(stop.id)) continue;
          const after = (e: Event) => sessionOf(e) === session && e.ts > stop.ts;
          const lastTyped = typed.filter((e) => sessionOf(e) === session && e.ts <= stop.ts).map((e) => e.ts).reduce((a, b) => Math.max(a, b), -Infinity);
          const guards: Record<Guard, boolean> = {
            age: now - stop.ts < CONTINUE_WINDOW,
            newest: !stops.some(after),
            typed: !typed.some(after),
            once: !stops.some((e) => sessionOf(e) === session && e.ts > lastTyped && e.ts < stop.ts && (done.get(session) ?? []).includes(e.id)),
          };
          if ((Object.keys(guards) as Guard[]).every((g) => skip.has(g) || guards[g])) await appendContinue(world, stop);
        }
      },
    }),
  };
}

/** A rule keyed only on the cause: it continues any dropped connection, however old its stamp and whatever came after it (criterion 10). */
export const keyedOnCause: Planting = continuesIgnoring(['age', 'newest', 'typed', 'once']);
/** A core that continues a dropped connection though a prompt you typed reached the session since (criterion 11). */
export const continuesAfterTyped: Planting = continuesIgnoring(['typed']);
/** A core that continues twice: the continued turn's own drop gets another (criterion 2). */
export const continuesTwice: Planting = continuesIgnoring(['once']);

/** A core that continues after a refusal as it does after a dropped connection (criterion 4). */
export const continuesAfterRefusal: Planting = {
  asks: (asks, world) => ({
    ...asks,
    tick: async () => {
      await asks.tick();
      const done = await continuedStops(world);
      for (const stop of await world.events('agent.stop')) {
        if (dataOfEvent(stop).cause === 'refusal' && !(done.get(sessionOf(stop)) ?? []).includes(stop.id)) await appendContinue(world, stop);
      }
    },
  }),
};

/** A core that raises one task per stopped session instead of one per cause (criteria 1, 8 and 9). */
export const taskPerSession: Planting = {
  asks: (asks, world) => {
    const own = new Set<string>();
    return {
      ...asks,
      tick: async () => {
        await asks.tick();
        for (const stop of await world.events('agent.stop')) {
          const session = sessionOf(stop);
          const d = dataOfEvent(stop);
          if (!isTask(d) || own.has(session)) continue;
          own.add(session);
          const { thread: _thread, ...plain } = chatTask();
          await asks.raise(core(session), UNBLOCK_SOURCE, {
            ...plain,
            question: `Clear the block on session ${session}?`, key: sha256(`unblock:${String(d.cause)}:${session}`),
            steps: [`Clear ${String(d.cause)} for session ${session}`], where: 'your terminal', why: `session ${session} stopped`, unblocks: [`session:${session}`], proves: `block.${session}`,
          });
        }
      },
    };
  },
};

/** A core whose thread check closes the task on any bot reply, right or wrong (criterion 7). */
export const closesOnAnyReply: Planting = {
  asks: (asks, world) => ({
    ...asks,
    tick: async () => {
      await asks.tick();
      for (const row of await asks.inbox()) {
        if (row.kind !== 'unblock' || row.outcome !== 'unanswered') continue;
        const created = (await world.events('ask.created')).find((e) => `ask:${e.id}` === row.ask);
        const thread = created && isObj(created.data) && isObj(created.data.thread) ? created.data.thread : undefined;
        if (!thread || typeof thread.link !== 'string') continue;
        const messages = await world.threads.read(thread.link);
        const asked = messages.findIndex((m) => m.from === YOU);
        if (asked < 0 || !messages.slice(asked + 1).some((m) => m.from !== YOU)) continue;
        await world.record.append(core(row.session), { v: 1, id: ulid(world.clock.now()), kind: 'ask.moot', subject: row.ask, ts: world.clock.now(), data: { because: 'check_passed', verdict: `verdict:${ulid(world.clock.now())}` } });
      }
    },
  }),
};
