// #2365 regression gaps: source races, raw-byte redaction labels, and concurrent on-demand/hourly copies.
import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { afterAll, expect, test } from 'vitest';
import {
  allEvents, appendClaude, archivedOf, claudeTranscript, dataOf, openArchiveOn, openWorld, redacted, removeTemps,
} from '../../../tests/acceptance/20/helpers.ts';

afterAll(removeTemps);

test('invalid UTF-8 is replaced as before, but neither its part nor its joined transcript claims complete redaction', async () => {
  const w = await openWorld();
  try {
    const t = claudeTranscript(w.env, [{ uuid: 'm1', role: 'user', text: 'first' }]);
    appendFileSync(t.path, Buffer.concat([Buffer.from('invalid '), Buffer.from([0xff]), Buffer.from('\n')]));
    const expected = redacted(readFileSync(t.path).toString('utf8'));
    const archive = await openArchiveOn(w);
    await archive.pass();
    const event = (await archivedOf(w.record, t.id)).at(-1)!;
    const root = String(dataOf(event).evidence);
    expect(Buffer.from(await w.store.read(root)).toString()).toBe(expected);
    expect((await w.store.get(root))?.redaction).toBe('incomplete');
    for (const sha of event.evidence) expect((await w.store.get(sha))?.redaction).toBe('incomplete');
  } finally { await w.close(); }
});

test('a replacement during readback commits no mixed generation; the next pass copies the replacement', async () => {
  const w = await openWorld();
  try {
    const t = claudeTranscript(w.env, [{ uuid: 'm1', role: 'user', text: 'old first message' }]);
    const archive = await openArchiveOn(w);
    await archive.pass();
    const before = await archivedOf(w.record, t.id);
    appendClaude(t, [{ uuid: 'm2', role: 'user', text: 'new second message' }]);
    const replacement = readFileSync(t.path, 'utf8').replace('old first message', 'new first message');
    w.bend = () => {
      w.bend = undefined;
      writeFileSync(`${t.path}.replacement`, replacement);
      renameSync(`${t.path}.replacement`, t.path);
    };
    await expect(archive.pass()).rejects.toThrow(/changed|replaced/);
    expect((await archivedOf(w.record, t.id)).map((e) => e.id)).toEqual(before.map((e) => e.id));
    await archive.pass();
    const latest = (await archivedOf(w.record, t.id)).at(-1)!;
    expect(Buffer.from(await w.store.read(String(dataOf(latest).evidence))).toString()).toBe(redacted(replacement));
  } finally { await w.close(); }
});

test('a scheduled pass and an on-demand copy serialize the same session and link it once', async () => {
  const w = await openWorld();
  try {
    const t = claudeTranscript(w.env, [{ uuid: 'm1', role: 'user', text: 'one copy, not two' }]);
    const archive = await openArchiveOn(w);
    await Promise.all([archive.pass(), archive.session(t.id)]);
    expect(await allEvents(w.record, ['transcript.archived'])).toHaveLength(1);
    expect((await w.record.resolve(`session:${t.id.replaceAll('-', '')}#m1`))?.text).toBe('one copy, not two');
  } finally { await w.close(); }
});
