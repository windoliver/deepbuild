// AC6: with a deep_wait held on a session's open ask, four deep_kinds lookups (list, field, read, word) sent together
// on the session's deep mcp each answer before the wait ends, with the bytes each gives when sent alone. A planted
// server that answers one lookup with another's reply (fixtures/plant.mjs `mix`) fails, naming both request IDs. On the
// merge base deep_kinds isn't listed read-only, so a client never sends its lookups side by side, and the test fails
// there.
import { afterAll, describe, expect, it } from 'vitest';
import { AC, TEST_MS, brief, formArgs, listed, t26, waitWorld, type Bound, type Line } from './helpers.ts';

afterAll(t26.cleanup, 60_000);

const LOOKUPS = ['list', 'field', 'read', 'word'] as const;

async function togetherFailures(s: { ask: string; server: Bound }): Promise<{ failures: string[]; seen: string[] }> {
  const kinds = listed(await s.server.tools(), 'deep_kinds');
  const args = Object.fromEntries(LOOKUPS.map((op) => [op, formArgs(kinds, op)!])) as Record<string, Line>;
  const bytes = (o: t26.Outcome) => JSON.stringify(o.reply.result ?? o.reply.error);
  const alone: Record<string, string> = {};
  for (const op of LOOKUPS) alone[op] = bytes(await s.server.call('deep_kinds', args[op]!));

  let waitEnded = Infinity;
  const wait = s.server.call('deep_wait', { ask: s.ask }).then((o) => { waitEnded = performance.now(); return o; });
  await t26.sleep(1500);
  expect(waitEnded, `BLOCKED: deep_wait on ${s.ask} is still held after 1.5 s`).toBe(Infinity);
  const ids = Object.fromEntries(LOOKUPS.map((op) => [op, t26.nextId(`together-${op}`)])) as Record<string, string>;
  const answered: Record<string, number> = {};
  const replies = await Promise.all(LOOKUPS.map((op) => s.server.call('deep_kinds', args[op]!, ids[op]).then((o) => { answered[op] = performance.now(); return o; })));
  const waited = await wait;
  const failures: string[] = [];
  for (const [i, op] of LOOKUPS.entries()) {
    const got = bytes(replies[i]!);
    if (replies[i]!.isError || replies[i]!.protocolError) failures.push(`request ${ids[op]} (deep_kinds ${op}) was refused: ${got.slice(0, 300)}`);
    if (!(answered[op]! < waitEnded)) failures.push(`request ${ids[op]} (deep_kinds ${op}) answered only after the wait ended`);
    if (got !== alone[op]) {
      const other = LOOKUPS.find((o) => o !== op && alone[o] === got);
      failures.push(other
        ? `request ${ids[op]} (deep_kinds ${op}) was answered with the reply of request ${ids[other]} (deep_kinds ${other})`
        : `request ${ids[op]} (deep_kinds ${op}) answered other bytes than alone: ${got.slice(0, 300)}, alone ${alone[op]!.slice(0, 300)}`);
    }
  }
  return { failures, seen: [`deep_wait ${brief(waited.value, 200)}`, ...LOOKUPS.map((op, i) => `${ids[op]} ${op}: ${bytes(replies[i]!).slice(0, 160)}`)] };
}

describe('lookups sent together answer as they would alone', () => {
  it(`AC6 ${AC.together} with a deep_wait held, four deep_kinds lookups sent together each answer before the wait ends, with the bytes each gives when sent alone; a planted server that answers one with another's reply fails, naming both request IDs`, async () => {
    const w = await waitWorld([{ label: 'agent' }, { label: 'mix', plant: { kind: 'mix' } }]);
    const agent = w.sessions.get('agent')!;
    const kinds = listed(await agent.server.tools(), 'deep_kinds');
    expect((kinds?.annotations as Line | undefined)?.readOnlyHint, `deep mcp lists deep_kinds read-only, so a client sends its lookups side by side: ${brief(kinds?.annotations)}`).toBe(true);

    const real = await togetherFailures(agent);
    expect(real.failures, `each lookup sent together answers before the wait ends, as it answers alone (${real.seen.join(' | ')})`).toEqual([]);

    const mixed = await togetherFailures(w.sessions.get('mix')!);
    expect(mixed.failures.filter((f) => /request \S+ \(deep_kinds \w+\) was answered with the reply of request \S+ \(deep_kinds \w+\)/.test(f)),
      `the same check fails the planted server that answers one lookup with another's reply, naming both request IDs: ${mixed.failures.join(' | ') || mixed.seen.join(' | ')}`).not.toEqual([]);
  }, TEST_MS);
});
