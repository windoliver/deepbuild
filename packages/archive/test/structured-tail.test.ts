// #2365: pretty-printed secret objects can span physical transcript lines and multiple passes.
import { appendFileSync, readFileSync } from 'node:fs';
import { afterAll, expect, test } from 'vitest';
import { allEvents, archivedOf, claudeTranscript, dataOf, openArchiveOn, openWorld, redacted, removeTemps } from '../../../tests/acceptance/20/helpers.ts';

afterAll(removeTemps);

test('an unfinished structured secret waits from its opening line instead of storing its next members unmasked', async () => {
  const w = await openWorld();
  try {
    const t = claudeTranscript(w.env, [{ uuid: 'm1', role: 'user', text: 'public context' }]);
    const prefix = readFileSync(t.path, 'utf8');
    appendFileSync(t.path, '"password": {\n "first": "synthetic-first-value",\n');
    const archive = await openArchiveOn(w);
    await archive.pass();
    let newest = (await archivedOf(w.record, t.id)).at(-1)!;
    expect(Buffer.from(await w.store.read(String(dataOf(newest).evidence))).toString()).toBe(redacted(prefix));
    appendFileSync(t.path, ' "nested": {\n "second": "synthetic-second-value"\n');
    await archive.pass();
    newest = (await archivedOf(w.record, t.id)).at(-1)!;
    expect(Buffer.from(await w.store.read(String(dataOf(newest).evidence))).toString()).toBe(redacted(prefix));
    appendFileSync(t.path, ' }\n}\npublic end\n');
    await archive.pass();
    newest = (await archivedOf(w.record, t.id)).at(-1)!;
    expect(Buffer.from(await w.store.read(String(dataOf(newest).evidence))).toString()).toBe(redacted(readFileSync(t.path, 'utf8')));
    for (const event of await allEvents(w.record, ['transcript.archived'])) for (const sha of event.evidence) {
      const text = Buffer.from(await w.store.read(sha)).toString();
      expect(text).not.toContain('synthetic-first-value');
      expect(text).not.toContain('synthetic-second-value');
    }
  } finally { await w.close(); }
}, 120_000);
