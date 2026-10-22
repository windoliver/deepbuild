// The wrong programs the issue names, planted around the real asks core and the real record: each is the
// real program with one part done wrong, so a scenario that passes on the real one and fails on its plant
// fails for the reason its criterion names. plants.test.ts runs each scenario against its plant.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RecordStore } from '../../../packages/record/src/index.ts';
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
export const escalatesWithNobody: Planting = {
  record: (record): RecordStore => ({
    append: (connection, event) => record.append(connection, event.kind === 'ask.defaulted' ? { ...event, kind: 'ask.escalated' } : event),
    read: (q) => record.read(q),
    table: (name) => record.table(name),
    session: (id) => record.session(id),
    rebuild: () => record.rebuild(),
    raw: (sql) => record.raw(sql),
    close: () => record.close(),
  }),
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
