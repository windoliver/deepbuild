// The wrong programs the issue names, planted around the real asks core and the real record: each is the
// real program with one part done wrong, so a scenario that passes on the real one and fails on its plant
// fails for the reason its criterion names. plants.test.ts runs each scenario against its plant.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Connection, EventInput, RecordStore } from '../../../packages/record/src/index.ts';
import { nextBatch, type Planting } from './helpers.ts';
import { EVERY_8H } from './scenarios.ts';

/** A hub that, once started, shows nothing new until its next batch: it never checks the open asks at its start. */
export const waitsForNextBatch: Planting = {
  asks: (asks, world) => {
    const firstBatch = nextBatch(world.clock.now(), EVERY_8H);
    return { ...asks, needsYou: async () => (world.clock.now() < firstBatch ? [] : asks.needsYou()) };
  },
};

/** A hub that, for one person, records an authority ask past its deadline as escalated, though nobody is there to take it. */
// The real record is a class instance, so a spread would lose its methods: every function found on the record
// and its prototype chain is copied, bound to the record, then `append` is replaced. A method the interface
// gains later is copied the same way, so the stand-in is the real record in all but the one event kind.
export const escalatesWithNobody: Planting = {
  record: (record): RecordStore => {
    const standIn: Record<string, unknown> = {};
    for (let o: object | null = record; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
      for (const name of Object.getOwnPropertyNames(o)) {
        if (name === 'constructor' || name in standIn) continue;
        const value = (record as unknown as Record<string, unknown>)[name];
        if (typeof value === 'function') standIn[name] = value.bind(record);
      }
    }
    standIn.append = (connection: Connection, event: EventInput) =>
      record.append(connection, event.kind === 'ask.defaulted' ? { ...event, kind: 'ask.escalated' } : event);
    return standIn as unknown as RecordStore;
  },
};

/** A hub that takes a repo's done.yaml asks block in place of your settings, not over them key by key. */
export const repoBlockWhole: Planting = {
  home: (world) => {
    const home = join(world.dir, 'repo-block-only');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'config.json'), `${JSON.stringify({ asks: { deadline: { taste: '5d', authority: '12h' } } }, null, 2)}\n`);
    return home;
  },
};
