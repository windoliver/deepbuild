// #319: "With the hub stopped across a batch time, each open ask whose deadline comes before the next batch shows
// in Needs you within 5 s of the hub's start; a hub that waits for the next batch fails this test, naming the ask."
//
// Batches and deadlines move on a virtual clock, at the batch times setup drafts (every 8 h, at most 20 asks a day).
// The 5 s is real time, from the moment the hub starts opening its record to the ask's card in Needs you.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { askSources, draftAskSettings, duration } from '@deepbuild/asks';
import type { Connection } from '@deepbuild/record';
import { clock, startHub, type Clock, type Hub, type Variant } from './hub.ts';

const H = 3_600_000;
const DAY0 = Date.UTC(2030, 2, 4);
const at = (hours: number, minutes = 0): number => DAY0 + hours * H + minutes * 60_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const WITHIN_MS = 5_000;
/** Which hub starts after the stop: the hub, or (DEEP_319_PLANT=waits-for-next-batch) the plant, for BASE-FAILURE.txt. */
const UNDER_TEST = (process.env.DEEP_319_PLANT ?? 'hub') as Variant;

const agent = (session: string): Connection => ({ writer: 'mcp:claude-code', actor: 'you', scope: 'you', session });

/** A source's own fixture ask, with its question made unique and its deadline set, or left to your settings. */
const fixtureAsk = (source: string, question: string, deadline: number | 'drafted'): Record<string, unknown> => {
  const row = askSources().find((r) => r.source === source);
  if (!row) throw new Error(`no ${source} row in ask.sources@1`);
  const ask: Record<string, unknown> = { ...(row.fixture.ask as Record<string, unknown>), question };
  if (deadline === 'drafted') delete ask.deadline;
  else ask.deadline = deadline;
  return ask;
};

const homes: string[] = [];
const running: Hub[] = [];
afterEach(async () => {
  for (const hub of running.splice(0)) await hub.stop().catch(() => undefined);
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

interface Due { ask: string; deadline: number }
interface World { home: string; time: Clock; due: Due[] }

/**
 * Up to the stop: setup drafts your settings, the hub runs, and at 12:30 UTC two asks are filed whose deadlines fall
 * after the 16:00 batch, so each waits for that batch: an early question about done (definition, its drafted 4 h,
 * so 16:30) and a taste call raised with a 22:00 deadline. The hub stops at 12:35. With `capReached`, 20 asks had
 * shown in the 08:00 batch, the day's drafted cap, so the 16:00 batch has no room left for either.
 */
async function beforeTheStop(capReached: boolean): Promise<World> {
  const home = mkdtempSync(join(tmpdir(), 'deep-319-restart-'));
  homes.push(home);
  await draftAskSettings(home);
  const time = clock(capReached ? at(0, 30) : at(12, 30));
  const hub = await startHub(home, time);
  running.push(hub);
  if (capReached) {
    for (let i = 0; i < 20; i++) await hub.raise(agent(`ses-early-${i}`), 'deep_ask.taste', fixtureAsk('deep_ask.taste', `Which header colour, take ${i}?`, 'drafted'));
    time.set(at(8, 1));
    await hub.tick();
    expect((await hub.needsYou()).length, 'the 08:00 batch shows the 20 early asks, the day\'s cap').toBe(20);
    time.set(at(12, 30));
  }
  const definition = await hub.raise(agent('ses-a'), 'definition.draft', fixtureAsk('definition.draft', 'Should done include the offline mode?', 'drafted'));
  const taste = await hub.raise(agent('ses-b'), 'deep_ask.taste', fixtureAsk('deep_ask.taste', 'Which footer spacing?', at(22)));
  const drafted = duration('4h')!;
  const due: Due[] = [{ ask: definition, deadline: at(12, 30) + drafted }, { ask: taste, deadline: at(22) }];
  // Each waits for the 16:00 batch when the hub stops: queued, not in Needs you.
  const rows = await hub.inbox();
  for (const d of due) expect(rows.find((r) => r.ask === d.ask)?.status, `${d.ask} waits for the 16:00 batch before the stop`).toBe('queued');
  const shown = await hub.needsYou();
  for (const d of due) expect(shown, `${d.ask} isn't in Needs you before the stop`).not.toContain(d.ask);
  time.set(at(12, 35));
  await hub.stop();
  running.splice(running.indexOf(hub), 1);
  return { home, time, due };
}

/**
 * Down across the 16:00 batch, the hub starts at 16:10, when the next batch is 00:00. Returns, for each due ask not
 * in Needs you within 5 s of the start, a line naming it; and how long each that showed took.
 */
async function startAcrossTheBatch(world: World, variant: Variant): Promise<{ missing: string[]; took: Record<string, number> }> {
  world.time.set(at(16, 10));
  const nextBatch = at(24);
  for (const d of world.due) expect(d.deadline, 'test data: the deadline comes before the next batch').toBeLessThan(nextBatch);
  const started = performance.now();
  const hub = await startHub(world.home, world.time, variant);
  running.push(hub);
  const took: Record<string, number> = {};
  while (performance.now() - started < WITHIN_MS) {
    const shown = new Set(await hub.needsYou());
    for (const d of world.due) if (shown.has(d.ask) && took[d.ask] === undefined) took[d.ask] = Math.round(performance.now() - started);
    if (world.due.every((d) => took[d.ask] !== undefined)) break;
    await new Promise((done) => setTimeout(done, 50));
  }
  const missing = world.due.filter((d) => took[d.ask] === undefined).map((d) =>
    `${d.ask} (deadline ${iso(d.deadline)}, before the next batch at ${iso(nextBatch)}) is not in Needs you ${WITHIN_MS / 1000} s after the hub's start at ${iso(at(16, 10))}`);
  return { missing, took };
}

describe('#319: the hub stopped across a batch time', () => {
  for (const capReached of [false, true]) {
    const label = capReached ? 'with the day\'s cap reached' : 'with room in the day\'s cap';
    it(`each open ask whose deadline comes before the next batch shows in Needs you within 5 s of the hub's start, ${label}`, async () => {
      const world = await beforeTheStop(capReached);
      const { missing, took } = await startAcrossTheBatch(world, UNDER_TEST);
      expect(missing, missing.join('\n')).toEqual([]);
      for (const d of world.due) expect(took[d.ask]!).toBeLessThan(WITHIN_MS);
    }, 30_000);

    it(`a hub that waits for the next batch fails, naming each such ask, ${label}`, async () => {
      const world = await beforeTheStop(capReached);
      const { missing } = await startAcrossTheBatch(world, 'waits-for-next-batch');
      expect(missing).toHaveLength(world.due.length);
      for (const d of world.due) expect(missing.some((line) => line.startsWith(d.ask))).toBe(true);
    }, 30_000);
  }
});
