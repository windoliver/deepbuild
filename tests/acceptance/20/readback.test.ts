// #20 AC8: each archived copy is read back and matched by size and SHA-256 against what the archive wrote after
// redaction, and the source's size and SHA-256 before redaction are on its transcript.archived event. The second test
// hands the archive a store whose writes land corrupted on disk (the store says stored; the file differs): an archive
// that reads its copy back finds the mismatch and links nothing to it.
import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC, allEvents, claudeTranscript, codexTranscript, dataOf, expectArchived, numbered, openArchiveOn, openWorld, redacted, removeTemps, sha256,
  sourceOf, storedFile, utf8, word, mulberry32, type Data,
} from './helpers.ts';

afterAll(removeTemps);

describe(`AC8 ${AC[8]} each archived copy is read back and matched by size and SHA-256, and the source's size and SHA-256 before redaction are on its event`, () => {
  it("AC8 three sessions, one with a key the redaction removes: each transcript.archived event carries its source's size and SHA-256 before redaction, and its copy reads back with the size and hash of the redacted text", async () => {
    const key = `ghp_${word(mulberry32(0x20_08), 36)}`;
    const w = await openWorld();
    try {
      const plain = claudeTranscript(w.env, numbered(1, 5, 'plain'));
      const keyed = claudeTranscript(w.env, [...numbered(1, 2, 'keyed'), { uuid: 'm3', role: 'user', text: `deploy with ${key} please` }], { cwd: '/tmp/dh20-work/api' });
      const codex = codexTranscript(w.env, ['codex: tidy the cart']);
      const archive = await openArchiveOn(w);
      await archive.pass();
      for (const t of [plain, keyed, codex]) {
        const event = await expectArchived(w, t, 'its copy');
        const data = dataOf(event);
        const source = utf8(sourceOf(t));
        const src = (data.source ?? {}) as Data;
        expect(src.size, `the event of ${t.agent} session ${t.id} records the source's size before redaction`).toBe(source.length);
        expect(src.sha256, `the event of ${t.agent} session ${t.id} records the source's SHA-256 before redaction`).toBe(sha256(source));
        const wrote = utf8(redacted(sourceOf(t)));
        const evidence = String(data.evidence);
        expect(evidence, 'the event names the copy by the SHA-256 of what the archive wrote after redaction').toBe(sha256(wrote));
        expect((await w.store.get(evidence))?.size, 'the store holds the copy at the size the archive wrote').toBe(wrote.length);
        const back = await w.store.read(evidence);
        expect([back.length, sha256(back)], 'the copy reads back with that size and hash').toEqual([wrote.length, evidence]);
      }
      const keyedEvent = (await allEvents(w.record, ['transcript.archived'])).find((e) => String(dataOf(e).session).endsWith(keyed.id.replace(/[^0-9A-Za-z]/g, '')))!;
      expect(((dataOf(keyedEvent).source ?? {}) as Data).sha256, "the redacted session's source hash is the bytes before redaction, not the copy's").not.toBe(dataOf(keyedEvent).evidence);
    } finally {
      await w.close();
    }
  }, 60_000);

  it('AC8 a copy that lands corrupted on disk (the store said stored) is read back, found not to match, and no transcript.archived event names it', async () => {
    const w = await openWorld();
    try {
      const corrupted: string[] = [];
      // After each write lands, one byte of the stored file flips: the store answered stored, the disk holds other bytes.
      w.bend = (sha) => {
        const file = storedFile(w.root, sha);
        if (!file) return;
        const bytes = readFileSync(file);
        const at = bytes.length >> 1;
        bytes[at] = bytes[at]! ^ 0x20;
        writeFileSync(file, bytes);
        corrupted.push(sha);
      };
      const t = claudeTranscript(w.env, numbered(1, 6, 'bent'));
      const archive = await openArchiveOn(w);
      await archive.pass().catch(() => undefined); // the archive may report the failed read back; it must not link the copy
      expect(corrupted.length, 'the archive wrote its copy, and the copy landed corrupted').toBeGreaterThan(0);
      for (const sha of corrupted) await expect(w.store.read(sha), `the store itself finds ${sha} corrupt`).rejects.toThrow();
      const linked = (await allEvents(w.record, ['transcript.archived'])).map((e) => String(dataOf(e).evidence));
      expect(linked.filter((sha) => corrupted.includes(sha)), `no transcript.archived event names a copy that didn't read back (session ${t.id})`).toEqual([]);
    } finally {
      await w.close();
    }
  }, 60_000);
});
