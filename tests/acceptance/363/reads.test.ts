// AC2: a sandboxed plug-in granted only content-free fields gets no transcript text from deep.record.query.
// AC3: a sandboxed plug-in granted the record for every event kind queries another test plug-in's store kind
// ext.stocks.alert with deep.record.query and gets a refusal naming the kind, its plug-in and the use to declare, with
// no rows; a hub that filters only by the grant's words returns the rows and fails this test, naming the kind.
//
// The reader plug-in (fixtures/reader) runs in the sandbox and returns exactly what crossed into it. Transcript text
// is the text the record keeps of a prompt (user.ask's text) and of a command (tool.before's command), seeded as the
// hook appends them (README, Readings).
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { judgeForeignQuery, type QueryOutput } from './judges.ts';
import { ALERT, call, done, installAndLoad, openHost, openWorld, pkg, seedTask, seedTranscript, STOCKS, ulid, type World } from './helpers.ts';

const READER = 'test/reader';
const query = (h: ExtensionHost, kinds: string[]): Promise<QueryOutput> => done(call(h, 'ext.reader.query', { kinds }, { id: READER }), `the reader's query of ${kinds.join(', ')}`);
/** Words the scrub leaves alone, unique to this run. */
const words = (): string => `zebra-marmalade-${[...randomBytes(6)].map((b) => String.fromCharCode(97 + (b % 26))).join('')}`;

async function readerWorld(text: string, grant: { record: string[]; text?: boolean }): Promise<{ w: World; h: ExtensionHost }> {
  const w = await openWorld();
  await seedTranscript(w, ulid(), text);
  const h = await openHost(w);
  await installAndLoad(h, await pkg('reader'), grant);
  expect((await h.loaded()).find((l) => l.id === READER)?.place, 'the reader runs in the sandbox').toBe('sandbox');
  return { w, h };
}

describe('AC2 #363.2d03fd41 A sandboxed plug-in granted only content-free fields gets no transcript text from `deep.record.query`', () => {
  it('AC2 granted user.ask and tool.before with no text, the reader gets both events and none of their text; granted text, it gets it', async () => {
    const planted = words();
    const kinds = ['user.ask', 'tool.before'];
    const free = await readerWorld(planted, { record: kinds });
    const out = await query(free.h, kinds);
    expect(out.refusal, 'a query of granted kinds is not refused').toBeNull();
    const rows = JSON.parse(out.rows ?? '[]') as { kind: string }[];
    expect(rows.map((r) => r.kind).sort(), 'the content-free fields still come: each granted event, without its text').toEqual(['tool.before', 'user.ask']);
    expect(out.rows, 'no transcript text crossed into the sandbox').not.toContain(planted);

    // The control: the same events, granted with text, carry it, so the text was there to leak.
    const texted = await readerWorld(planted, { record: kinds, text: true });
    const withText = await query(texted.h, kinds);
    expect(withText.rows, 'granted text, the reader gets the transcript text').toContain(planted);
  }, 120_000);
});

/** The world of AC3: a core event, the stocks plug-in holding the alert NVDA at 200, and the reader granted every kind. */
async function foreignQuery(plant?: 'record-by-grant-words'): Promise<{ out: QueryOutput; control: QueryOutput }> {
  const w = await openWorld();
  await seedTask(w, 'a core task the reader may read');
  const h = await openHost(w, plant ? { plant } : {});
  await installAndLoad(h, await pkg('stocks'));
  await done(call(h, 'ext.stocks.set_alert', { symbol: 'NVDA', above: 200 }), 'set-alert NVDA at 200 from a panel');
  expect((await w.events(ALERT)).length, `the stocks plug-in's store holds the alert in the record as ${ALERT}`).toBeGreaterThan(0);
  await installAndLoad(h, await pkg('reader'), { record: ['*'] });
  const control = await query(h, ['task.created']);
  const out = await query(h, [ALERT]);
  return { out, control };
}

describe('AC3 #363.41b82a9b A sandboxed plug-in granted the record for every event kind queries another test plug-in\'s store kind `ext.stocks.alert` with `deep.record.query` and gets a refusal naming the kind, its plug-in and the use to declare, with no rows; a hub that filters only by the grant\'s words returns the rows and fails this test, naming the kind', () => {
  it('AC3 the reader, granted every kind, reads a core kind but is refused ext.stocks.alert, naming the kind, test/stocks and the use to declare, with no rows', async () => {
    const { out, control } = await foreignQuery();
    expect(control.refusal, 'a core kind is the reader\'s to read under its grant').toBeNull();
    expect(control.count, 'the core event reaches the reader').toBeGreaterThan(0);
    expect(judgeForeignQuery(out, ALERT, STOCKS, 'NVDA')).toEqual([]);
  }, 120_000);

  it('AC3 (wrong program) a hub that filters only by the grant\'s words returns the rows and fails this test, naming the kind', async () => {
    const { out } = await foreignQuery('record-by-grant-words');
    expect(out.count, `the twin hands the reader ${ALERT}'s rows`).toBeGreaterThan(0);
    const problems = judgeForeignQuery(out, ALERT, STOCKS, 'NVDA');
    expect(problems.length, 'the twin fails the criterion').toBeGreaterThan(0);
    expect(problems.join('\n'), 'its failure names the kind').toContain(ALERT);
  }, 120_000);
});
