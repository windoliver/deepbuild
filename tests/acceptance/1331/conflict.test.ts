// AC3: a change that now conflicts goes back to its own attempt within 60 s with the files named, and raises no ask.
import { describe, expect, it } from 'vitest';
import { AC, checkFile, draftFor, requirement, World } from './helpers.ts';

describe(`${AC[3]} a change that now conflicts goes back to its own attempt within 60 s with the files named, and raises no ask`, () => {
  it('sends #2 back with src/x1.ts named, in under 60 s, with no ask', async () => {
    const w = await World.open({ drafts: [draftFor(100, [requirement('R1', 'x1 works', checkFile('own1'))]), draftFor(101, [requirement('R1', 'x2 works', checkFile('own2'))])] });
    await w.change('first', { 'src/x1.ts': "export const v = 'first';\n" });
    await w.judge();
    // The second change edits the same line of src/x1.ts, and its own file too: it merges cleanly today and conflicts once #1 lands.
    const second = await w.change('second', { 'src/x1.ts': "export const v = 'second';\n", 'src/x2.ts': "export const v = 'two';\n" });
    await w.judge();
    const asks = (await w.asks()).length;
    const round = await w.land();
    expect(round.code, `deep land exited ${round.code}: ${round.stderr.slice(0, 600)}`).toBe(0);
    expect((await w.landings()).length, 'only the first change lands; the conflicting one does not').toBe(1);
    expect(round.ms, `the conflicting change went back after ${round.ms} ms, past 60 s`).toBeLessThanOrEqual(60_000);
    const back = (round.json?.sent_back as { issue: number; files: string[] }[] | undefined)?.find((b) => b.issue === second.issue);
    expect(back, `the conflict on issue #${second.issue} (PR #${second.pr}) must go back to that issue's attempt as a send-back; the round reports ${JSON.stringify(round.json)}`).toBeDefined();
    expect(back!.files, `the send-back for issue #${second.issue} must name the conflicting file`).toContain('src/x1.ts');
    expect(back!.files, 'the send-back names only the files that conflict').not.toContain('src/x2.ts');
    expect((await w.asks()).length, 'a conflict reaches no person: it raised an ask').toBe(asks);
    expect(w.forge.pulls.get(second.pr)!.closed, 'DeepBuild never closes a pull request').toBe(false);
  }, 20 * 60_000);
});
