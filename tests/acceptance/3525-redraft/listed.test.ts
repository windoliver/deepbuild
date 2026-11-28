// AC1: `deep mcp` lists deep_kinds with readOnlyHint true and idempotentHint true, equal to the generated table; on
// the merge base it lists readOnlyHint false, and the test fails naming the tool and the hint (README).
import { afterAll, describe, expect, it } from 'vitest';
import { AC, CLI, NODE, Raw, TEST_MS, brief, cleanup, generatedAnnotations, lookupWorld, type Line } from './helpers.ts';

afterAll(cleanup, 60_000);

describe('deep_kinds is listed as a read', () => {
  it(`AC1 ${AC.listed} deep mcp lists deep_kinds with readOnlyHint true and idempotentHint true, equal to the generated table`, async () => {
    const w = await lookupWorld();
    const server = Raw.start('deep mcp', [NODE, CLI, 'mcp'], w.home, w.cwd);
    await server.initialize();
    const tools = await server.tools();
    const listed = tools.find((t) => t.name === 'deep_kinds')?.annotations as Line | undefined;
    expect(listed, `BLOCKED: deep mcp lists deep_kinds with annotations: ${brief(tools.map((t) => t.name))}`).toBeDefined();

    // The issue's row: read-only and idempotent; it stays open-world (assets searches a library past this machine).
    const issue: Line = { readOnlyHint: true, idempotentHint: true, openWorldHint: true };
    const wrong = Object.entries(issue).filter(([hint, want]) => listed![hint] !== want)
      .map(([hint, want]) => `deep mcp lists deep_kinds ${hint} ${listed![hint] === undefined ? 'absent' : JSON.stringify(listed![hint])}; the issue says ${String(want)}`);
    expect(wrong, `deep_kinds' listed hints (${brief(listed)})`).toEqual([]);

    const generated = generatedAnnotations();
    expect(generated.table?.deep_kinds, `BLOCKED: scripts/skill.mjs generates a row for deep_kinds in packages/hub/annotations.json (${generated.out})`).toBeDefined();
    expect(listed, 'deep mcp lists deep_kinds\' title and hints as the generated table has them').toEqual(generated.table!.deep_kinds);
  }, TEST_MS);
});
