// #2365: a pending multiline secret stays in the source, never in an immutable evidence part.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, expect, test } from 'vitest';
import { allEvents, archivedOf, claudeTranscript, dataOf, openArchiveOn, openWorld, redacted, removeTemps } from '../../../tests/acceptance/20/helpers.ts';

afterAll(removeTemps);
const keyMarker = (edge: string) => `-----${edge} OPENSSH ${'PRIVATE'} KEY-----`;
test('a multiline key split across passes waits from its opening line, then is scrubbed whole', async () => {
  const w = await openWorld();
  try {
    const t = claudeTranscript(w.env, [{ uuid: 'm1', role: 'user', text: 'public first line' }]);
    const before = readFileSync(t.path, 'utf8');
    const body = 'synthetickeybody'.repeat(7);
    appendFileSync(t.path, `${keyMarker('BEGIN')}\n${body}\n`);
    const archive = await openArchiveOn(w);
    await archive.pass();
    const first = (await archivedOf(w.record, t.id)).at(-1)!;
    expect(Buffer.from(await w.store.read(String(dataOf(first).evidence))).toString()).toBe(redacted(before));
    appendFileSync(t.path, `${keyMarker('END')}\nfinished\n`);
    await archive.pass();
    const latest = (await archivedOf(w.record, t.id)).at(-1)!;
    expect(Buffer.from(await w.store.read(String(dataOf(latest).evidence))).toString()).toBe(redacted(readFileSync(t.path, 'utf8')));
    for (const e of await allEvents(w.record, ['transcript.archived'])) for (const sha of e.evidence) expect(Buffer.from(await w.store.read(sha)).toString()).not.toContain(body);
  } finally { await w.close(); }
}, 120_000);

test('a held value divided at a newline between passes is never kept as separate raw halves', async () => {
  const w = await openWorld();
  try {
    const t = claudeTranscript(w.env, []);
    const held = ['upper-half-of-held-value\nlower-half-of-held-value'];
    writeFileSync(t.path, 'public\nupper-half-of-held-value\n');
    const archive = await openArchiveOn(w, { held });
    await archive.pass();
    const first = (await archivedOf(w.record, t.id)).at(-1)!;
    expect(Buffer.from(await w.store.read(String(dataOf(first).evidence))).toString()).toBe('public\n');
    appendFileSync(t.path, 'lower-half-of-held-value\nlast\n');
    await archive.pass();
    const last = (await archivedOf(w.record, t.id)).at(-1)!;
    expect(Buffer.from(await w.store.read(String(dataOf(last).evidence))).toString()).toBe(redacted(readFileSync(t.path, 'utf8'), held));
  } finally { await w.close(); }
}, 120_000);
