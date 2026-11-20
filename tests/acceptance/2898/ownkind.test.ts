// AC6: a planted server that lists deep_show read-only changes nothing the hub holds: the kind the hub gives each of
// its own tools comes from the adapters' facts as on the merge base, so a turn whose only call is a deep_show patch is
// still not an answer; a hub that reads its own hint fails, naming the call (README).
import { afterAll, describe, expect, it } from 'vitest';
import { AC, OWN_TOOLS, TEST_MS, base, brief, callsWorld, cleanup, forms, kindsOf, t26, turn } from './helpers.ts';

afterAll(cleanup, 60_000);

const QUESTION = 'what does the red box sit on?';

describe('the hub never reads the hint it sent', () => {
  it(`AC6 ${AC.ownKind} with a planted deep mcp that lists deep_show read-only, the kind the hub gives each of its own tools is the merge base's, from the adapters' facts, and a turn begun by your typed question whose only call is a deep_show patch is still no answer; a hub that reads its own hint fails, naming the call`, async () => {
    const w = await callsWorld([{ label: 'agent' }, { label: 'planted', plant: { kind: 'hint', tool: 'deep_show', hint: 'readOnlyHint', value: true } }]);
    const shown = (await w.sessions.get('agent')!.server.tools()).find((t) => t.name === 'deep_show');
    expect(shown?.annotations?.readOnlyHint, `deep mcp states deep_show's readOnlyHint, false, which the planted server states true (${brief(shown?.annotations)})`).toBe(false);
    const s = w.sessions.get('planted')!;
    const planted = (await s.server.tools()).find((t) => t.name === 'deep_show');
    expect(planted?.annotations?.readOnlyHint, 'BLOCKED: the planted server lists deep_show read-only').toBe(true);

    // A turn whose only call is a read the facts name (deep_query): an answer, so the stop rule is read as the issue says.
    const read = await turn(w.hub, s, QUESTION, 'deep_query', forms('deep_query', { doc: w.doc, ask: s.ask, revision: w.revision })[2]!.args);
    expect(read.stop?.data.claim, `BLOCKED: a turn begun by your typed question whose only call is deep_query (${read.call}) is an answer: its agent.stop ${brief(read.stop)}`).toBe(false);

    const rev = Number((await t26.events(w.hub)).filter((e) => e.kind === 'doc.patched').at(-1)?.data.rev ?? 1);
    const patch = { patch: t26.ulid(), doc: w.doc, base: rev, reason: 'move the red box', ops: [{ op: 'set', id: 'red-box', path: 'items/red-box/at/pos', value: [0.5, 0.25, 0.4] }] };
    const show = await turn(w.hub, s, QUESTION, 'deep_show', { doc: w.doc, patch: JSON.stringify(patch) });
    expect(show.stop, `BLOCKED: the turn of the deep_show patch (${show.call}) ends in an agent.stop`).toBeDefined();
    expect(show.stop!.data.claim, `the turn begun by your typed question whose only call is the deep_show patch ${show.call} is no answer, though the planted server lists deep_show read-only (its agent.stop ${brief(show.stop)}, the call ${brief(show.outcome.value, 300)})`).toBe(true);

    const b = base();
    expect(await kindsOf(w.hub, s, OWN_TOOLS(b)), 'the kind the hub gives each of its own tools is the merge base\'s, from the adapters\' facts, not from the hint the planted server lists').toEqual(b.kinds);
    await w.close();
  }, TEST_MS);
});
