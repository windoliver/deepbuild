// One session's copy from the path its agent named (#2316): a held push hands `archive.session` the hook's
// `transcript_path`, so the copy needn't list every transcript folder. A named path is only a hint: the archive reads
// it only where its facts would have found that session's transcript, never a file elsewhere or through a link.
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { allEvents, claudeTranscript, dataOf, expectArchived, openArchiveOn, openWorld, removeTemps } from '../../../tests/acceptance/20/helpers.ts';

afterAll(removeTemps);

const handleOf = (id: string): string => `session:${id.replace(/[^0-9A-Za-z]/g, '')}`;
const copied = async (w: Awaited<ReturnType<typeof openWorld>>): Promise<unknown[]> =>
  (await allEvents(w.record, ['transcript.archived'])).map((e) => dataOf(e).session);

describe('Archive.session with the path its agent named', () => {
  it('never reads a named file outside the transcript folders, and finds the session where the facts put it', async () => {
    const w = await openWorld();
    try {
      const wanted = claudeTranscript(w.env, [{ uuid: 'm1', role: 'user', text: 'the real transcript' }]);
      const outside = join(w.dir, 'elsewhere', `${wanted.id}.jsonl`);
      mkdirSync(dirname(outside), { recursive: true });
      writeFileSync(outside, `${JSON.stringify({ type: 'user', sessionId: wanted.id, message: { role: 'user', content: 'not a transcript the facts name' } })}\n`);
      const archive = await openArchiveOn(w);
      await archive.session(wanted.id, outside);
      expect(await copied(w)).toEqual([handleOf(wanted.id)]);
      await expectArchived(w, wanted, 'the copy is of the transcript the facts name, not of the named file');
    } finally {
      await w.close();
    }
  }, 60_000);

  it('never follows a named link, as the walk follows none', async () => {
    const w = await openWorld();
    try {
      const other = claudeTranscript(w.env, [{ uuid: 'm1', role: 'user', text: 'beside the link' }]);
      const target = join(w.dir, 'elsewhere', 'linked.jsonl');
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'reached through a link' } })}\n`);
      const id = '0b5e2a1c-1111-4222-8333-944455556666';
      const link = join(dirname(other.path), `${id}.jsonl`);
      symlinkSync(target, link);
      const archive = await openArchiveOn(w);
      await archive.session(id, link);
      expect(await copied(w)).toEqual([]);
    } finally {
      await w.close();
    }
  }, 60_000);

  it("never copies another session's transcript from a path named for this one", async () => {
    const w = await openWorld();
    try {
      const wanted = claudeTranscript(w.env, [{ uuid: 'm1', role: 'user', text: 'the one asked about' }]);
      const other = claudeTranscript(w.env, [{ uuid: 'm2', role: 'user', text: 'another session' }]);
      const archive = await openArchiveOn(w);
      await archive.session(wanted.id, other.path);
      expect(await copied(w)).toEqual([handleOf(wanted.id)]);
      await expectArchived(w, wanted, "the other session's path names another session");
    } finally {
      await w.close();
    }
  }, 60_000);
});
