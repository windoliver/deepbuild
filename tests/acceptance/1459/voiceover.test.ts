// AC9: VoiceOver reads a row as its title, its state word and what it waits on, the same as before. "Before" is the base's
// reading, kept in fixtures/voiceover-before.json: each sidebar row's accessible name over fixtures/record.events.jsonl, which
// deep-live pairs with the AppKit title a screen reader speaks. Two surfaces: the replica's tree over that fixture (which can
// plant a wrong program), and the real app on #1172's world, read from outside its process as VoiceOver reads it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appBinary, makeWorld, useCleanup } from '../1172/helpers.ts';
import { driveBinary, FIXTURES, ID, label, RealApp, readingFailures, RECORD, requireMacos, see, sessionRow, sessionsOf, settled, type Before, type Plant } from './helpers.ts';

useCleanup();
const MIN = 60_000;
const BEFORE = (JSON.parse(readFileSync(join(FIXTURES, 'voiceover-before.json'), 'utf8')) as { rows: Before[] }).rows;

/** Each sidebar row the replica of `plant` (the shipped one when none) names unlike before. */
async function replicaFailures(plant?: Plant): Promise<string[]> {
  requireMacos();
  const snapshot = await see(await driveBinary(plant), RECORD);
  const titles = new Map(sessionsOf(RECORD).map((s) => [s.id, s.title]));
  return BEFORE.flatMap((before) => {
    const title = titles.get(before.session)!;
    const rows = sessionRow(snapshot, title);
    if (rows.length !== 1) return [`session "${title}" has ${rows.length} sidebar rows, not one`];
    return readingFailures(rows[0]!.name, before, `the row for "${title}"`);
  });
}

describe(`AC9 ${ID.voiceover} VoiceOver reads a row as its title, its state word and what it waits on, the same as before`, () => {
  it('AC9 in the replica\'s tree, each sidebar row still reads its title, then its state word and what it waits on, as before #1459', async () => {
    expect(await replicaFailures()).toEqual([]);
  }, 30 * MIN);

  it('AC9 wrong program: a row named by its title alone (plant-row-title-only) fails, naming the row', async () => {
    const failures = await replicaFailures('plant-row-title-only');
    expect(failures.join('\n'), 'a title-only row fails').toMatch(/the row for "Search index" reads .* which lacks "sent back 1 of 3"/);
  }, 30 * MIN);

  it('AC9 in the real app, what VoiceOver reads of each session\'s row is its title, then its state word, as before #1459', async () => {
    const world = await makeWorld();
    const app = await RealApp.launch(world.home, await appBinary());
    try {
      // Before #1459, a session with an open ask read "<glyph> <title> · needs you": the word is what it waits on, you.
      const failures = await settled(async () => {
        const nodes = await app.nodes();
        return world.sessions.flatMap((s) => {
          const rows = nodes.filter((n) => n.role === 'AXButton' && (label(n) ?? '').includes(s.task));
          if (rows.length !== 1) return [`the real window has ${rows.length} buttons labelled with "${s.task}", not one row`];
          return readingFailures(label(rows[0]!), { parts: [s.task, 'needs you'] }, `VoiceOver on "${s.task}"`);
        });
      });
      expect(failures).toEqual([]);
    } finally {
      await app.stop();
    }
  }, 20 * MIN);
});
