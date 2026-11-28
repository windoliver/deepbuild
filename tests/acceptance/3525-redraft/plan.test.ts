// AC5: a stand-in client that holds every call not listed read-only, as the facts say Claude Code's plan mode does,
// sends list, field, read and word: all four answer; on the merge base all four are held, and the test fails naming
// the first (README).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC, Client, FOUR, REPO, TEST_MS, argsFor, brief, cleanup, lookupWorld, schemaOf, type Line } from './helpers.ts';

afterAll(cleanup, 60_000);

describe('a session in plan mode can look up what the canvas draws', () => {
  it(`AC5 ${AC.plan} a stand-in client that holds every call not listed read-only sends deep_kinds list, field, read and word, and all four answer`, async () => {
    // The stand-in's rule is the facts' own: Claude Code holds a call in plan mode when it isn't read-only.
    const facts = JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as Line;
    const plan = JSON.stringify(facts).match(/"case":"plan","text":"([^"]+)"/)?.[1];
    expect(plan, 'BLOCKED: adapters/claude-code.facts.json states when plan mode holds a call').toMatch(/plan mode and the call isn't read-only/);

    const w = await lookupWorld();
    const agent = w.sessions.get('agent')!;
    const tools = await agent.server.tools();
    const client = new Client(agent.server, tools, true);
    const schema = schemaOf(tools, 'deep_kinds');
    const sent: { op: string; reply: Awaited<ReturnType<Client['send']>> }[] = [];
    for (const { op, given } of FOUR) sent.push({ op, reply: await client.send('deep_kinds', argsFor(schema, { op, ...given })) });

    const held = sent.filter((s) => s.reply.held).map((s) => `deep_kinds ${s.op} was held (${s.reply.held ? s.reply.why : ''})`);
    expect(held, `in plan mode the four lookups reach deep mcp; the first held: ${held[0] ?? 'none'}`).toEqual([]);
    const unanswered = sent.filter((s) => !s.reply.held && (s.reply.outcome.isError || typeof s.reply.outcome.value !== 'object' || s.reply.outcome.value === null))
      .map((s) => `deep_kinds ${s.op}: ${s.reply.held ? '' : brief(s.reply.outcome.reply, 400)}`);
    expect(unanswered, 'each of the four answers its lookup').toEqual([]);
  }, TEST_MS);
});
