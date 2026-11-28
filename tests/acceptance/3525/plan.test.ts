// AC5: a stand-in client that holds every call not listed read-only, as the facts say Claude Code's plan mode does
// (adapters/claude-code.facts.json, mods.holdsWhen, case plan), sends deep_kinds' list, field, read and word: all four
// answer. On the merge base deep_kinds isn't listed read-only, so all four are held, and the test fails naming the
// first.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { REPO } from '../2898/helpers.ts';
import { AC, TEST_MS, brief, deepMcp, formArgs, listed, plainHub, t26, type Line, type Raw } from './helpers.ts';

afterAll(t26.cleanup, 60_000);

const LOOKUPS = ['list', 'field', 'read', 'word'] as const;

/** The stand-in plan-mode client: it sends a call only when the tool's listing says readOnlyHint true, else holds it. */
class PlanMode {
  readonly held: string[] = [];
  constructor(private readonly server: Raw, private readonly tools: readonly Line[]) {}
  async call(tool: string, args: Line): Promise<t26.Outcome | 'held'> {
    if ((listed(this.tools, tool)?.annotations as Line | undefined)?.readOnlyHint !== true) { this.held.push(`${tool} ${JSON.stringify(args)}`); return 'held'; }
    return this.server.call(tool, args);
  }
}

describe('a session in plan mode can look up what the canvas draws', () => {
  it(`AC5 ${AC.plan} a stand-in client that holds every call not listed read-only, as the facts say Claude Code's plan mode does, sends list, field, read and word: all four answer; on the merge base all four are held and the test fails naming the first`, async () => {
    const facts = JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as Line;
    const plan = JSON.stringify(facts).match(/"case":"plan","text":"([^"]*)"/)?.[1];
    expect(plan, 'BLOCKED: the facts say Claude Code\'s plan mode holds a call that isn\'t read-only').toMatch(/plan mode and the call isn't read-only/);

    const p = await plainHub();
    const server = await deepMcp('deep mcp', p.home, p.cwd);
    const tools = await server.tools();
    const kinds = listed(tools, 'deep_kinds');
    const client = new PlanMode(server, tools);
    const replies: { op: string; got: t26.Outcome | 'held' }[] = [];
    for (const op of LOOKUPS) replies.push({ op, got: await client.call('deep_kinds', formArgs(kinds, op)!) });

    expect(client.held, `the stand-in plan-mode client holds no lookup; the first it held: ${client.held[0] ?? 'none'}`).toEqual([]);
    const unanswered = replies.filter((r) => r.got === 'held' || r.got.isError || r.got.protocolError)
      .map((r) => `deep_kinds ${r.op}: ${r.got === 'held' ? 'held' : brief(r.got.value ?? r.got.reply, 400)}`);
    expect(unanswered, 'each of the four lookups answers').toEqual([]);
    server.child.kill('SIGTERM');
  }, TEST_MS);
});
