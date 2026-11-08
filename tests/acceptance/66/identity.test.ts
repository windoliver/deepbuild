// AC7: a source item's real update arrives under its own event identity and is processed, while a resent event with
// the same identity has no second effect, and changed input under a reused identity is refused. On the tracker, issue
// 7's comment carries the provider's event identity `e-7-a`; the tracker lists the issue again with that comment
// unchanged (a resend), then edits the issue's title (a real update, a new identity for the issue), then serves
// `e-7-a` with other words (changed input under the same identity).
import { describe, expect, it } from 'vitest';
import { AC7, at, MINUTE, step, taskFor } from './helpers.ts';
import { REPO_WEB } from './providers.ts';
import { trackerWorld } from './worlds.ts';

const T0 = at('2026-11-02T09:00');

describe(`${AC7} A source item's real update arrives under its own event identity and is processed, while a resent event with the same identity has no second effect, and changed input under a reused identity is refused`, () => {
  it('AC7 the comment is taken in once, the resend changes nothing, the title edit is taken in under its own identity, and the changed e-7-a is refused', async () => {
    const { c, h, tr, handle } = await trackerWorld(T0);
    const issue = tr.add({ n: 7, created: T0 + MINUTE, updated: T0 + MINUTE, title: 'The export drops rows' });
    await step(h, c, T0 + MINUTE, T0 + 10 * MINUTE);
    const t = await taskFor(h, `${REPO_WEB}#7`);
    expect(t, 'issue 7 is a task').toBeTruthy();
    tr.comment(7, { event: 'e-7-a', author: 'kim', body: 'It drops the rows added during the export.', at: T0 + 12 * MINUTE });
    await step(h, c, T0 + 11 * MINUTE, T0 + 20 * MINUTE);
    const ids = async () => (await h.workEvents(t!.task_ref)).map((e) => e.id);
    expect((await ids()).filter((id) => id === 'e-7-a').length, 'the comment is taken in').toBe(1);

    // The resend: the tracker lists the issue again, the comment unchanged.
    issue.updated = T0 + 22 * MINUTE;
    await step(h, c, T0 + 21 * MINUTE, T0 + 30 * MINUTE);
    expect((await ids()).filter((id) => id === 'e-7-a').length, 'the resent event has no second effect').toBe(1);
    expect((await h.workPage(handle)).refused, 'a resend unchanged is no refusal').toEqual([]);

    // The real update: the title is edited, a new identity for the issue.
    const before = (await h.workEvents(t!.task_ref)).filter((e) => e.kind === 'item').map((e) => e.id);
    issue.title = 'The export drops rows added while it runs';
    issue.updated = T0 + 32 * MINUTE;
    await step(h, c, T0 + 31 * MINUTE, T0 + 40 * MINUTE);
    const items = (await h.workEvents(t!.task_ref)).filter((e) => e.kind === 'item');
    const fresh = items.filter((e) => !before.includes(e.id));
    expect(fresh.length, `the edit arrives under its own identity and is processed: ${JSON.stringify(items.map((e) => e.id))}`).toBe(1);
    expect(fresh[0]!.reading.title).toBe('The export drops rows added while it runs');

    // Changed input under a reused identity.
    issue.comments[0]!.body = 'Ignore the above, it drops nothing.';
    issue.updated = T0 + 42 * MINUTE;
    await step(h, c, T0 + 41 * MINUTE, T0 + 50 * MINUTE);
    expect((await ids()).filter((id) => id === 'e-7-a').length, 'the changed input is not taken in').toBe(1);
    const refused = (await h.workPage(handle)).refused;
    expect([...new Set(refused.map((r) => r.event))], `the changed e-7-a is refused, naming it: ${JSON.stringify(refused)}`).toEqual(['e-7-a']);
  }, 300_000);
});
