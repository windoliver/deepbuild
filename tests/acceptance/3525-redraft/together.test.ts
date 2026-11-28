// AC6: with a deep_wait held, four deep_kinds lookups sent together each answer before the wait ends, with the bytes
// each gives when sent alone; a planted server that answers one with another's reply fails, naming both request IDs
// (README).
import { afterAll, describe, expect, it } from 'vitest';
import { AC, Client, FOUR, TEST_MS, argsFor, brief, bytesOf, cleanup, lookupWorld, schemaOf, t26, type Line, type Session } from './helpers.ts';

afterAll(cleanup, 60_000);

/** The four lookups sent together by the stand-in client while the session's deep_wait is held, held to their bytes alone. */
async function togetherFailures(s: Session): Promise<{ failures: string[]; seen: string[] }> {
  const tools = await s.server.tools();
  const schema = schemaOf(tools, 'deep_kinds');
  const args = FOUR.map(({ op, given }) => argsFor(schema, { op, ...given }));
  const alone: string[] = [];
  for (const a of args) alone.push(bytesOf(await s.server.call('deep_kinds', a)));
  expect(new Set(alone).size, `BLOCKED: the four lookups give four different replies alone (${alone.map((b) => b.slice(0, 80)).join(' | ')})`).toBe(4);

  const client = new Client(s.server, tools);
  let waitEnded = Infinity;
  const wait = client.send('deep_wait', argsFor(schemaOf(tools, 'deep_wait'), { ask: s.ask })).then((r) => { waitEnded = performance.now(); return r; });
  await t26.sleep(1500);
  expect(waitEnded, `BLOCKED: deep_wait on ${s.ask} is still held after 1.5 s (deep_wait is listed ${client.hint('deep_wait')})`).toBe(Infinity);
  const ids = FOUR.map(({ op }) => t26.nextId(`together-kinds-${op}`));
  const replies = await Promise.all(args.map((a, i) => client.send('deep_kinds', a, ids[i])));
  const waited = await wait;

  const failures: string[] = [];
  for (const [i, { op }] of FOUR.entries()) {
    const r = replies[i]!;
    if (r.held) { failures.push(`request ${ids[i]} (deep_kinds ${op}) was held: ${r.why}`); continue; }
    if (!(r.answeredAt < waitEnded)) failures.push(`request ${ids[i]} (deep_kinds ${op}) answered only after the wait ended (deep_kinds is listed ${client.hint('deep_kinds')})`);
    const got = bytesOf(r.outcome);
    if (got !== alone[i]) {
      const other = alone.findIndex((b, j) => j !== i && b === got);
      failures.push(other >= 0
        ? `request ${ids[i]} (deep_kinds ${op}) was answered with the reply of request ${ids[other]} (deep_kinds ${FOUR[other]!.op})`
        : `request ${ids[i]} (deep_kinds ${op}) answered other bytes than alone: ${got.slice(0, 300)}, alone ${alone[i]!.slice(0, 300)}`);
    }
  }
  const seen = [`deep_wait ${waited.held ? 'held' : brief(waited.outcome.value, 160)}`, ...replies.map((r, i) => `${ids[i]} ${FOUR[i]!.op}: ${r.held ? 'held' : bytesOf(r.outcome).slice(0, 120)}`)];
  return { failures, seen };
}

describe('lookups sent together answer as they would alone', () => {
  it(`AC6 ${AC.together} with a deep_wait held, four deep_kinds lookups sent together each answer before the wait ends, with the bytes each gives when sent alone; a planted server that answers one with another's reply fails, naming both request IDs`, async () => {
    const w = await lookupWorld([{ label: 'agent' }, { label: 'mix', plant: { kind: 'mix', tool: 'deep_kinds', holdMs: 10_000 } as Line }]);
    const real = await togetherFailures(w.sessions.get('agent')!);
    expect(real.failures, `each lookup sent together answers before the wait ends, as it answers alone (${real.seen.join(' | ')})`).toEqual([]);

    const mixed = await togetherFailures(w.sessions.get('mix')!);
    expect(mixed.failures.filter((f) => /^request \S+ \(deep_kinds \w+\) was answered with the reply of request \S+ \(deep_kinds \w+\)$/.test(f)), `the same check fails the planted server that answers one lookup with another's reply, naming both request IDs: ${mixed.failures.join(' | ') || mixed.seen.join(' | ')}`).not.toEqual([]);
  }, TEST_MS);
});
