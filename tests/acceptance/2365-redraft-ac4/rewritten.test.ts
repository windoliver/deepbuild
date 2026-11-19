// #2365 AC4 (blind redraft): a transcript whose first megabyte was rewritten after its last copy is copied again from
// its start, and the session's handles resolve through the new parts. A planted archive that appends the rewritten
// file's tail to the old parts fails, naming the first line that differs (README).
import { afterAll, describe, expect, it } from 'vitest';
import { handle, openArchiveOn, openWorld, removeTemps } from '../20/helpers.ts';
import { AC4, copiedAgainFromStart, LINES, rewriteAfterCopy, said, TOTAL } from './helpers.ts';
import { tailAppendArchive } from './wrong.ts';

afterAll(removeTemps);

describe(`AC4 ${AC4} a transcript whose first megabyte was rewritten after its last copy is copied again from its start, and its handles resolve through the new parts`, () => {
  it('AC4 archived at 480 lines, first megabyte rewritten from line 3, 20 lines gained: the pass after reads as the rewritten file, every probed handle resolves to its new text, and the evidence it linked holds the file from its start', async () => {
    const w = await openWorld();
    try {
      copiedAgainFromStart(await rewriteAfterCopy(w, await openArchiveOn(w)));
    } finally {
      await w.close();
    }
  }, 120_000);

  it('AC4 (wrong program) an archive that appends the rewritten file\'s tail to the old parts fails, naming line 3, the first line that differs', async () => {
    const real = await openWorld();
    try {
      copiedAgainFromStart(await rewriteAfterCopy(real, await openArchiveOn(real)));
    } finally {
      await real.close();
    }
    const w = await openWorld();
    try {
      const r = await rewriteAfterCopy(w, tailAppendArchive(w));
      const session = handle(r.s.id);
      expect(r.passError, 'the twin\'s passes complete').toBeUndefined();
      // What the twin left: the old lines, draft from line 3 on, then the 20 gained lines.
      expect(r.reading?.length, 'the twin\'s archived transcript has as many lines as the rewritten file').toBe(TOTAL);
      expect(r.reading?.[2]?.text, 'the twin kept line 3 as it was before the rewrite').toBe(said(3, 'draft').text);
      expect(r.reading?.[TOTAL - 1]?.text, 'the twin appended the gained lines').toBe(said(TOTAL, 'final').text);
      expect(r.reading?.[LINES - 1]?.text, 'past the rewrite, the twin\'s old lines match the file').toBe(said(LINES, 'draft').text);
      expect(() => copiedAgainFromStart(r)).toThrow(new RegExp(`line 3 \\(${session}#m3\\) differs`));
    } finally {
      await w.close();
    }
  }, 180_000);
});
