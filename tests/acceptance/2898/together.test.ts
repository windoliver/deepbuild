// AC5: with a deep_wait held, deep_status, deep_search and deep_query sent together each answer before the wait ends,
// with the bytes each gives alone; a planted server that answers one call with another's reply fails, naming both
// request IDs (README).
import { afterAll, describe, expect, it } from 'vitest';
import { AC, TEST_MS, brief, callsWorld, cleanup, forms, listedAs, t26, type Calls, type Line, type Session } from './helpers.ts';

afterAll(cleanup, 60_000);

const READS = ['deep_status', 'deep_search', 'deep_query'] as const;

/** The three reads sent together on the session's deep mcp while its deep_wait is held, held to their bytes alone. */
async function togetherFailures(w: Calls, s: Session): Promise<{ failures: string[]; seen: string[] }> {
  const args = Object.fromEntries(READS.map((tool) => [tool, forms(tool, { doc: w.doc, ask: s.ask, revision: w.revision })[0]!.args])) as Record<string, Line>;
  const bytes = (o: t26.Outcome) => JSON.stringify(o.reply.result ?? o.reply.error);
  const alone: Record<string, string> = {};
  for (const tool of READS) alone[tool] = bytes(await s.server.call(tool, args[tool]!));

  let waitEnded = Infinity;
  const wait = s.server.call('deep_wait', { ask: s.ask }).then((o) => { waitEnded = performance.now(); return o; });
  await t26.sleep(1500);
  expect(waitEnded, `BLOCKED: deep_wait on ${s.ask} is still held after 1.5 s`).toBe(Infinity);
  const ids = Object.fromEntries(READS.map((tool) => [tool, t26.nextId(`together-${tool}`)])) as Record<string, string>;
  const answered: Record<string, number> = {};
  const replies = await Promise.all(READS.map((tool) => s.server.call(tool, args[tool]!, ids[tool]).then((o) => { answered[tool] = performance.now(); return o; })));
  const waited = await wait;
  const failures: string[] = [];
  for (const [i, tool] of READS.entries()) {
    const got = bytes(replies[i]!);
    if (!(answered[tool]! < waitEnded)) failures.push(`${tool} (request ${ids[tool]}) answered only after the wait ended`);
    if (got !== alone[tool]) {
      const other = READS.find((t) => t !== tool && alone[t] === got);
      failures.push(other
        ? `request ${ids[tool]} (${tool}) was answered with the reply of request ${ids[other]} (${other})`
        : `request ${ids[tool]} (${tool}) answered other bytes than alone: ${got.slice(0, 300)}, alone ${alone[tool]!.slice(0, 300)}`);
    }
  }
  return { failures, seen: [`deep_wait ${brief(waited.value, 200)}`, ...READS.map((t, i) => `${ids[t]} ${t}: ${bytes(replies[i]!).slice(0, 160)}`)] };
}

describe('reads sent together answer as they would alone', () => {
  it(`AC5 ${AC.together} with a deep_wait held, deep_status, deep_search and deep_query, listed read-only so a client runs them side by side, are sent together and each answers before the wait ends with the bytes it gives alone; a planted server that answers one call with another's reply fails, naming both request IDs`, async () => {
    const w = await callsWorld([{ label: 'agent' }, { label: 'mix', plant: { kind: 'mix', tools: ['deep_status', 'deep_search'] } }]);
    const agent = w.sessions.get('agent')!;
    const listed = listedAs(await agent.server.tools(), 'readOnlyHint');
    expect(READS.filter((t) => !listed.includes(t)), 'deep mcp lists deep_status, deep_search and deep_query read-only, the calls a client sends side by side').toEqual([]);

    const real = await togetherFailures(w, agent);
    expect(real.failures, `each read sent together answers before the wait ends, as it answers alone (${real.seen.join(' | ')})`).toEqual([]);

    const mixed = await togetherFailures(w, w.sessions.get('mix')!);
    expect(mixed.failures.filter((f) => /request \S+ \(deep_status\) was answered with the reply of request \S+ \(deep_search\)/.test(f) || /request \S+ \(deep_search\) was answered with the reply of request \S+ \(deep_status\)/.test(f)), `the same check fails the planted server that answers one call with another's reply, naming both request IDs: ${mixed.failures.join(' | ') || mixed.seen.join(' | ')}`).not.toEqual([]);
    await w.close();
  }, TEST_MS);
});
