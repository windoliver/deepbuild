// #20 AC3: stopping capture for a day raises the alert. On a test clock the archive runs once an hour. A Claude Code
// session is captured for three hours; then capture stops: the agent goes on working (its hooks keep landing in the
// record) but writes its transcript where the facts don't point, so nothing new reaches the archive. A day after the
// last capture, an archive.quiet event names the source and when it last captured; twenty hours in, none yet. The
// same day with capture going on raises nothing.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC, allEvents, appendClaude, archivedOf, claudeHome, claudeTranscript, dataOf, HOUR, hookIn, numbered, openArchiveOn, openWorld,
  removeTemps, T0, ulid, type Transcript, type World,
} from './helpers.ts';

afterAll(removeTemps);

/** An hour of the agent's work: a prompt its hook records, and, while capture runs, the lines its transcript gains. */
async function hourOfWork(w: World, t: Transcript, hour: number, captured: boolean): Promise<void> {
  const at = w.clock.set(T0 + hour * HOUR);
  await w.record.append(hookIn(t.id, 'claude'), { v: 1, id: ulid(at), kind: 'user.ask', ts: at, data: { msg: hour, text: `keep going, hour ${hour}`, tasks: [], from: 'person' } });
  const lines = numbered(hour * 10 + 1, hour * 10 + 3, `hour ${hour}`);
  if (captured) appendClaude(t, lines, at);
  else {
    // The agent writes this hour's lines to a folder its facts don't name: nothing the archive reads changes.
    const elsewhere = join(claudeHome(w.env), 'moved', `${t.id}.jsonl`);
    mkdirSync(join(claudeHome(w.env), 'moved'), { recursive: true });
    appendFileSync(elsewhere, lines.map((m) => `${JSON.stringify({ uuid: m.uuid, text: m.text })}\n`).join(''));
  }
}

describe(`AC3 ${AC[3]} stopping capture for a day raises the alert`, () => {
  it('AC3 capture stops after hour 3 while the agent keeps working: no alert 20 hours on, an archive.quiet event naming the source and its last capture by 25 hours on', async () => {
    const w = await openWorld();
    try {
      const t = claudeTranscript(w.env, numbered(1, 3, 'hour 0'), { at: T0 });
      const archive = await openArchiveOn(w);
      await archive.pass();
      for (let hour = 1; hour <= 3; hour++) {
        await hourOfWork(w, t, hour, true);
        await archive.pass();
      }
      const copies = await archivedOf(w.record, t.id);
      expect(copies.length, 'capture ran: the session was copied as it grew, hours 0 to 3').toBe(4);
      const last = copies[copies.length - 1]!.ts;
      expect(last, 'the last capture was the hour-3 pass').toBe(T0 + 3 * HOUR);

      const quiet = async () => (await allEvents(w.record, ['archive.quiet']));
      for (let hour = 4; hour <= 3 + 20; hour++) {
        await hourOfWork(w, t, hour, false);
        await archive.pass();
      }
      expect((await archivedOf(w.record, t.id)).length, 'capture stopped: no copy after hour 3').toBe(4);
      expect(await quiet(), 'twenty hours after the last capture, no alert yet').toEqual([]);

      for (let hour = 3 + 21; hour <= 3 + 25; hour++) {
        await hourOfWork(w, t, hour, false);
        await archive.pass();
      }
      const alerts = await quiet();
      expect(alerts.length, `a day after the last capture (at ${new Date(last).toISOString()}), the archive raised an archive.quiet alert`).toBeGreaterThan(0);
      const claude = alerts.filter((e) => dataOf(e).agent === 'claude');
      expect(claude.length, `the alert names the source that went quiet, the claude adapter's folders: ${JSON.stringify(alerts.map(dataOf))}`).toBeGreaterThan(0);
      expect(dataOf(claude[0]!).last, 'the alert says when that source last captured').toBe(last);
      expect(claude[0]!.ts, 'the alert came a day or more after the last capture').toBeGreaterThanOrEqual(last + 24 * HOUR);
    } finally {
      await w.close();
    }
  }, 120_000);

  it('AC3 the same 28 hours with capture going on every hour raise no alert', async () => {
    const w = await openWorld();
    try {
      const t = claudeTranscript(w.env, numbered(1, 3, 'hour 0'), { at: T0 });
      const archive = await openArchiveOn(w);
      await archive.pass();
      for (let hour = 1; hour <= 3 + 25; hour++) {
        await hourOfWork(w, t, hour, true);
        await archive.pass();
      }
      expect((await archivedOf(w.record, t.id)).length, 'capture ran every hour: a copy per pass').toBe(3 + 25 + 1);
      expect((await allEvents(w.record, ['archive.quiet'])).map(dataOf), 'capture never stopped, so no alert').toEqual([]);
    } finally {
      await w.close();
    }
  }, 120_000);
});
