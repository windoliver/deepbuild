// One session's transcript copied on demand (#1156): a held push is placed from what the session has read so far, so
// its copy can't wait for the next pass.
import { afterAll, describe, expect, it } from 'vitest';
import { allEvents, claudeTranscript, dataOf, openArchiveOn, openWorld, removeTemps } from '../../../tests/acceptance/20/helpers.ts';

afterAll(removeTemps);

describe('Archive.session', () => {
  it("copies that session's transcript, and no other", async () => {
    const w = await openWorld();
    try {
      const wanted = claudeTranscript(w.env, [{ uuid: 'm1', role: 'user', text: 'the one asked about' }]);
      claudeTranscript(w.env, [{ uuid: 'm2', role: 'user', text: 'another session' }]);
      const archive = await openArchiveOn(w);
      await archive.session(wanted.id);
      const copied = (await allEvents(w.record, ['transcript.archived'])).map((e) => dataOf(e).session);
      expect(copied).toEqual([`session:${wanted.id.replace(/[^0-9A-Za-z]/g, '')}`]);
    } finally {
      await w.close();
    }
  }, 60_000);
});
