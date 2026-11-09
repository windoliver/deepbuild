// AC2 #1023.6b9c173d, its second half: an answer waiting for a session Codex ended without a SessionEnd goes by its task,
// not by a resume. Run 3 of fixtures/ctrl-c-ends.json, with two `deep_ask`s in its turn before its Stop: one answered while
// the session sits idle after its stop (an answer waiting for its next message), one answered after its process ended.
// Both must be recorded as waiting on its task (`delivery.outcome` via `on_task`, as an ended Codex session's answer is,
// #39), and neither delivered: no resume comes.
import { afterEach, describe, expect, it } from 'vitest';
import { AC2, allEvents, answer, askIn, asksOf, choice, cleanup, endRun, hubWithSetup, makeHome, ofSession, onTask, outcomesOf, replay, sendThrough, sleep, tag, waitFor, WITHIN_MS } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(AC2, () => {
  it(`${AC2}: run 3 with two asks open: the one answered while it sat idle and the one answered after Ctrl-C ended its process both go by its task, neither by a resume`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const rp = replay(h, 3);
    const id = rp.t.id;
    await sendThrough(rp, 'PostToolUse');
    await rp.cli.init();
    const idle = `Which header for ${tag()}?`;
    const after = `Which footer for ${tag()}?`;
    await askIn(rp, choice(idle));
    await askIn(rp, choice(after));
    const [a, b] = await waitFor(async () => { const e = await allEvents(hub); const x = asksOf(e, idle)[0]; const y = asksOf(e, after)[0]; return x && y ? [x, y] as const : undefined; }, 30_000, `both asks of session ${id}`);
    // Its Stop, held while the asks are open, up to Codex's hold; then the session is idle.
    await sendThrough(rp, 'Stop');
    await answer(h, `ask:${a.id}`, 'green');
    await sleep(1000);
    const at = await endRun(hub, rp);
    // The hub has had the minute AC2 gives it to close the session, then the second answer comes.
    const closeBy = at.endedAt + WITHIN_MS;
    while (!ofSession(await allEvents(hub), id, 'session.end').length && Date.now() < closeBy) await sleep(1000);
    await answer(h, `ask:${b.id}`, 'green');
    const settle = Date.now() + 15_000;
    let events = await allEvents(hub);
    while (!(outcomesOf(events, a.id).some(onTask) && outcomesOf(events, b.id).some(onTask)) && Date.now() < settle) { await sleep(500); events = await allEvents(hub); }
    for (const [ask, when] of [[a, 'while it sat idle after its stop'], [b, 'after its process ended']] as const) {
      const outcomes = outcomesOf(events, ask.id);
      const what = `${AC2}: session ${id}, ended by Ctrl-C with no SessionEnd: the answer to ask:${ask.id}, given ${when}, has delivery outcomes ${JSON.stringify(outcomes)}`;
      expect(outcomes.some(onTask), `${what}; it must wait on its task (via on_task, waiting), not on a resume`).toBe(true);
      expect(outcomes.filter((o) => o.outcome === 'delivered'), `${what}; nothing is delivered, since no resume comes`).toEqual([]);
    }
  }, 300_000);
});
