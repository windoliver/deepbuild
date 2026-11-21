// #2365: verifying each leaf is not enough; a manifest corrupted after put must never be linked.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { allEvents, claudeTranscript, evidenceOf, openArchiveOn, openWorld, removeTemps } from '../../../tests/acceptance/20/helpers.ts';

afterAll(removeTemps);
test('a corrupt parts manifest is refused before transcript.archived is appended', async () => {
  const w = await openWorld();
  try {
    claudeTranscript(w.env, Array.from({ length: 40 }, (_, n) => ({ uuid: `m${n}`, role: 'user' as const, text: `message ${n} ${'safe text '.repeat(6000)}` })));
    let corrupted = false;
    w.bend = (sha) => {
      const path = join(evidenceOf(w.root), sha.slice(0, 2), `${sha.slice(2)}.parts`);
      if (!existsSync(path)) return;
      const parts = JSON.parse(readFileSync(path, 'utf8')) as string[];
      if (parts.length < 2) return;
      writeFileSync(path, JSON.stringify(parts.reverse()));
      corrupted = true;
    };
    const archive = await openArchiveOn(w);
    await expect(archive.pass()).rejects.toThrow(/corrupt|parts|match/);
    expect(corrupted, 'the fault hit a joined copy, not one leaf').toBe(true);
    expect(await allEvents(w.record, ['transcript.archived'])).toEqual([]);
  } finally { await w.close(); }
}, 120_000);
