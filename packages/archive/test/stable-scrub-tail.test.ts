// #2365: a stable but unfinished scrub unit must be replaced, not extended from its provisional mask.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, expect, test } from 'vitest';
import { archivedOf, claudeTranscript, dataOf, openArchiveOn, openWorld, redacted, removeTemps } from '../../../tests/acceptance/20/helpers.ts';

afterAll(removeTemps);
test('a structured tail copied on its stable pass is rebuilt when the remaining members arrive', async () => {
  const w = await openWorld();
  try {
    const t = claudeTranscript(w.env, []);
    const initial = 'public\n"password": {\n "first": "synthetic-first-value",\n';
    writeFileSync(t.path, initial);
    const archive = await openArchiveOn(w);
    await archive.pass();
    await archive.pass();
    let newest = (await archivedOf(w.record, t.id)).at(-1)!;
    expect(Buffer.from(await w.store.read(String(dataOf(newest).evidence))).toString()).toBe(redacted(initial));
    appendFileSync(t.path, ' "second": "synthetic-second-value"\n}\npublic end\n');
    await archive.pass();
    newest = (await archivedOf(w.record, t.id)).at(-1)!;
    const whole = Buffer.from(await w.store.read(String(dataOf(newest).evidence))).toString();
    expect(whole).not.toContain('synthetic-second-value');
    expect(whole).toBe(redacted(readFileSync(t.path, 'utf8')));
  } finally { await w.close(); }
}, 120_000);
