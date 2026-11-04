// Size and scope's asks hold no send-back (#324 beside #325): a size taste call is DeepBuild's reading, not a question
// the agent left, so a check that fails while it's open is still sent back. On the real hub, deep-hook and record,
// through #324's acceptance helpers: the change is ten times the usual size, so stop 1 is sent back for size and
// stop 2 raises the taste call; the agent then undoes the fix the drafted check needs, and stop 3 must be sent back
// for that check.
import { afterEach, describe, expect, it } from 'vitest';
import {
  BEHAVIOR, BEHAVIOR_DRAFT, FIX, FLAG, cleanup, decision, jsLines, lastPos, lockedTask, makeWorld, plan, replyText, Session, settle, sizeSendBack, startHub, tasteCalls, trustRepo,
} from '../../../tests/acceptance/324/helpers.ts';

afterEach(cleanup, 60_000);

describe('#324 a size taste call holds no send-back', () => {
  it('a drafted check that fails while the size taste call is open still sends the stop back', async () => {
    const rules = Array.from({ length: 11 }, (_, i) => `src/rules/r${String(i + 1).padStart(2, '0')}.js`);
    const w = makeWorld({ drafts: [BEHAVIOR_DRAFT(plan({ files: ['src/auth.js', ...rules] }))] });
    await trustRepo(w);
    const hub = await startHub(w);
    const s = new Session(w);
    await s.start();
    await s.typed(BEHAVIOR);
    await s.read('src/auth.js');
    await lockedTask(hub, s, BEHAVIOR, 'size-scope');
    const since = await lastPos(hub);
    await s.edit(FIX.file, FIX.from, FIX.to);
    await s.edit(FLAG.file, FLAG.from, FLAG.to);
    for (const [i, file] of rules.entries()) await s.write(file, jsLines(`rule${i + 1}`, 17));
    expect(sizeSendBack(await s.stop('Done.'))).toBe(true);
    await s.read('src/auth.js');
    await s.stop('Each rule module is needed.');
    expect(tasteCalls(await settle(hub, (all) => tasteCalls(all, since).length > 0, 30_000), since)).toHaveLength(1);
    // The fix the drafted check needs is undone: its check fails at the next stop, with the size call still open.
    await s.edit(FLAG.file, FLAG.to, FLAG.from);
    const stop3 = await s.stop('Done again.');
    expect(decision(stop3)).toBe('deny');
    expect(replyText(stop3)).toMatch(/R1 \("An expired token is rejected with 401"\) is unproven/);
  }, 300_000);
});
