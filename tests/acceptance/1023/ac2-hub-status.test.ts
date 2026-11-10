// AC2 #1023.6b9c173d, its first half: a session Codex ended without a SessionEnd (run 1 of fixtures/ctrl-c-ends.json)
// shows closed in `deep hub status` within one minute of its process ending, and not before.
import { afterEach, describe, expect, it } from 'vitest';
import { AC2, cleanup, endRun, hubStatus, hubWithSetup, judgeClosed, listed, makeHome, replayTurn, shownClosed, statusShown, WITHIN_MS } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(AC2, () => {
  it(`${AC2}: run 1 replayed: deep hub status doesn't show the session closed while its process runs, and shows it closed within 60 s of Ctrl-C ending it`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const rp = await replayTurn(h, 1);
    const id = rp.t.id;
    const live = await hubStatus(h);
    expect(live.ran.code, `${AC2}: deep hub status must answer while session ${id} runs: ${statusShown(live)}`).toBe(0);
    expect(shownClosed(live.line, id), `${AC2}: session ${id} must not show closed while its process (pid ${rp.cli.pid}) runs: it shows ${JSON.stringify(listed(live.line, id))}`).toBe(false);
    const at = await endRun(hub, rp);
    const judged = await judgeClosed(hub, id, at, { status: true });
    const closing = judged.problems.filter((p) => p.includes('deep hub status'));
    expect(closing, `${AC2}: session ${id}, ended by Ctrl-C with no SessionEnd:\n${closing.join('\n')}`).toEqual([]);
    expect(judged.closedMs, `${AC2}: session ${id} must show closed within ${WITHIN_MS} ms of its process ending`).toBeLessThanOrEqual(WITHIN_MS);
  }, 180_000);
});
