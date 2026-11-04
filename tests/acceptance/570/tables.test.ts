// #570 AC1: "Each of the eight objects has its table in the schemas with its states, moves, guards and final
// states, and a planted record object with a lifecycle and no table fails the contract test, naming it".
// The tables are read as files; the contract test's check is @deepbuild/contracts' lifecycleGaps (README: The
// surface), given the planted object. The planted wrong program is the object with no table, planted here.
import { describe, expect, it } from 'vitest';
import * as contracts from '../../../packages/contracts/src/index.ts';
import { ID, OBJECTS, readTable, type Table } from './helpers.ts';

type Gaps = (objects: readonly string[], tables: readonly Table[]) => string[];
/** The contract test's surface, asserted present (README): a missing export fails here, at an assertion. */
function surface(): { gaps: Gaps; machines: () => Table[]; objects: readonly string[] } {
  const c = contracts as unknown as Record<string, unknown>;
  expect(typeof c.lifecycleGaps, '@deepbuild/contracts exports lifecycleGaps(objects, tables)').toBe('function');
  expect(typeof c.machines, '@deepbuild/contracts exports machines(), every lifecycle table in its schemas').toBe('function');
  expect(Array.isArray(c.LIFECYCLE_OBJECTS), '@deepbuild/contracts exports LIFECYCLE_OBJECTS, the record objects with a lifecycle').toBe(true);
  return { gaps: c.lifecycleGaps as Gaps, machines: c.machines as () => Table[], objects: c.LIFECYCLE_OBJECTS as readonly string[] };
}

describe(`${ID.tables} each of the eight objects has its table in the schemas with its states, moves, guards and final states`, () => {
  it.each(OBJECTS)(`${ID.tables} %s has its table, <object>.machine@1, with states, an initial state, final states and moves between them`, (object) => {
    const t = readTable(object);
    const at = `${object}.machine@1.json`;
    expect(t.id, `${at}: its id`).toBe(`${object}.machine@1`);
    expect(Array.isArray(t.states) && t.states.length > 1 && t.states.every((s) => typeof s === 'string' && s.length > 0), `${at}: states lists its states`).toBe(true);
    expect(new Set(t.states).size, `${at}: each state once`).toBe(t.states.length);
    expect(t.states, `${at}: its initial state is one of its states`).toContain(t.initial);
    expect(Array.isArray(t.final) && t.final.length > 0, `${at}: it names its final states`).toBe(true);
    for (const f of t.final) expect(t.states, `${at}: final state ${f} is one of its states`).toContain(f);
    expect(Array.isArray(t.moves) && t.moves.length > 0, `${at}: it lists its moves`).toBe(true);
    for (const m of t.moves) {
      const row = JSON.stringify(m);
      expect(t.states, `${at}: move ${row} starts at one of its states`).toContain(m.from);
      expect(t.states, `${at}: move ${row} ends at one of its states`).toContain(m.to);
      expect(typeof m.event === 'string' && m.event.length > 0, `${at}: move ${row} names the event that makes it`).toBe(true);
      if ('guard' in m) expect(typeof m.guard === 'string' && m.guard.length > 0, `${at}: move ${row}'s guard is a name`).toBe(true);
    }
    // Every final state is reached: a final state no move enters (and not the initial one) is no state of its life.
    for (const f of t.final) expect(f === t.initial || t.moves.some((m) => m.to === f), `${at}: a move reaches final state ${f}`).toBe(true);
  });

  it(`${ID.tables} ask.machine@1 and lease.machine@1 are among them, with the states the criteria name: an ask defaulted or answered, a lease held, a claim pending first`, () => {
    const ask = readTable('ask');
    for (const s of ['defaulted', 'answered']) expect(ask.states, `ask.machine@1 has state ${s}`).toContain(s);
    expect(ask.moves.some((m) => m.to === 'defaulted' && m.event === 'ask.defaulted'), 'ask.machine@1: ask.defaulted (its deadline) moves an ask to defaulted').toBe(true);
    expect(ask.moves.some((m) => m.to === 'answered' && m.event === 'ask.answered'), 'ask.machine@1: ask.answered moves an ask to answered').toBe(true);
    const lease = readTable('lease');
    expect(lease.states, 'lease.machine@1 has state held').toContain('held');
    expect(lease.moves.some((m) => m.to === 'held'), 'lease.machine@1: a move reaches held').toBe(true);
    expect(lease.moves.some((m) => m.from === 'held' && typeof m.guard === 'string'), 'lease.machine@1: a move out of held has its guard (its holder has ended)').toBe(true);
    const claim = readTable('claim');
    expect(claim.initial, 'claim.machine@1 starts at pending').toBe('pending');
  });

  it(`${ID.tables} the contract test finds a table for every record object with a lifecycle: the eight, and machines() reads each table as its file holds it`, () => {
    const { gaps, machines, objects } = surface();
    for (const object of OBJECTS) expect(objects, `LIFECYCLE_OBJECTS names ${object}`).toContain(object);
    const tables = machines();
    for (const object of OBJECTS) {
      const t = tables.find((m) => m.id === `${object}.machine@1`);
      expect(t, `machines() holds ${object}.machine@1`).toBeDefined();
      expect(t, `machines() reads ${object}.machine@1 as its file holds it`).toEqual(readTable(object));
    }
    expect(gaps(objects, tables), 'the contract test finds no record object with a lifecycle and no table').toEqual([]);
  });

  it(`${ID.tables} a planted record object with a lifecycle and no table fails the contract test, naming it`, () => {
    const { gaps, machines, objects } = surface();
    const planted = 'planted_widget';
    const found = gaps([...objects, planted], machines());
    expect(found, 'one problem: the planted object').toHaveLength(1);
    expect(found[0], 'the problem names the planted object').toContain(planted);
    // An object whose table was taken away is named the same way.
    const without = gaps(objects, machines().filter((m) => m.id !== 'lease.machine@1'));
    expect(without, 'lease, its table taken away, is named').toHaveLength(1);
    expect(without[0]).toMatch(/\blease\b/);
  });
});
