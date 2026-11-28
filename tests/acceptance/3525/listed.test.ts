// AC1: `deep mcp` lists deep_kinds with readOnlyHint true and idempotentHint true, equal to the generated table
// (packages/hub/annotations.json, as scripts/skill.mjs generates it from HINTS). It stays open-world (Scope) and isn't
// destructive. On the merge base it lists readOnlyHint false, and this test fails naming the tool and the hint.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { REPO, generatedBesideTools } from '../2898/helpers.ts';
import { AC, TEST_MS, brief, deepMcp, hint, listed, plainHub, t26, type Line } from './helpers.ts';

afterAll(t26.cleanup, 60_000);

const WANT = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true } as const;

describe('deep_kinds is listed as a read', () => {
  it(`AC1 ${AC.listed} deep mcp lists deep_kinds with readOnlyHint true and idempotentHint true, equal to the generated table; on the merge base it lists readOnlyHint false and this test fails naming the tool and the hint`, async () => {
    const p = await plainHub();
    const server = await deepMcp('deep mcp', p.home, p.cwd);
    const tools = await server.tools();
    server.child.kill('SIGTERM');
    const kinds = listed(tools, 'deep_kinds');
    expect(kinds, `BLOCKED: deep mcp lists deep_kinds: ${tools.map((t) => t.name).join(', ')}`).toBeDefined();

    const wrong = Object.entries(WANT).filter(([h, v]) => hint(kinds, h) !== v)
      .map(([h, v]) => `deep mcp lists deep_kinds ${h} ${JSON.stringify(hint(kinds, h) ?? null)}, not ${v}`);
    expect(wrong, `deep_kinds' hints as deep mcp lists them: ${brief(kinds!.annotations)}`).toEqual([]);

    const table = (JSON.parse(readFileSync(join(REPO, 'packages/hub/annotations.json'), 'utf8')) as Record<string, Line>).deep_kinds;
    expect(kinds!.annotations, 'the listing equals the generated table\'s deep_kinds row (packages/hub/annotations.json)').toEqual(table);
    const generated = generatedBesideTools();
    expect(generated.written, `BLOCKED: scripts/skill.mjs writes the table beside tools.json (${generated.out})`).toContain('annotations.json');
    expect(generated.problems, `the checkout's table is the one scripts/skill.mjs generates (${generated.out})`).toEqual([]);
  }, TEST_MS);
});
