// AC2: the listing equals the table, both forms of deep mcp actions list the same bytes, and a planted tools.ts that
// states a hint the table doesn't fails the drift check, naming the tool and the hint (README).
import { afterAll, describe, expect, it } from 'vitest';
import { AC, CLI, NODE, PLANT, Raw, TEST_MS, cleanup, drift, generatedBesideTools, listings, plainHub } from './helpers.ts';

afterAll(cleanup, 60_000);

/** The planted tools.ts: the change's deep mcp, its listing stating deep_status destructive, which the table doesn't. */
const PLANTED = { kind: 'hint', tool: 'deep_status', hint: 'destructiveHint', value: true };

describe('the listing comes from one generated table', () => {
  it(`AC2 ${AC.table} every server's listing states the issue's final table, both forms of deep mcp actions list the same bytes, scripts/skill.mjs generates a table beside packages/hub/tools.json that this checkout holds as it generates it, and a planted tools.ts that states deep_status destructive fails the drift check, naming the tool and the hint`, async () => {
    const p = await plainHub();
    const lists = await listings(p);
    expect(lists.flatMap((l) => drift(l.server, l.tools)), 'each server\'s tools list the hints the issue\'s table gives them').toEqual([]);

    const node = lists.find((l) => l.server === 'deep mcp actions')!;
    const hook = lists.find((l) => l.server === 'deep-hook mcp actions')!;
    expect(hook.raw, 'deep-hook mcp actions answers the same tools/list request with the same bytes as deep mcp actions').toBe(node.raw);

    const generated = generatedBesideTools();
    expect(generated.written.filter((f) => f !== 'tools.json'), `scripts/skill.mjs generates a table beside packages/hub/tools.json; it wrote only ${generated.written.join(', ') || 'nothing'} there (${generated.out})`).not.toEqual([]);
    expect(generated.problems, 'the table this checkout holds is the one scripts/skill.mjs generates').toEqual([]);

    const planted = Raw.start('deep mcp with a planted tools.ts', [NODE, '--import', PLANT, CLI, 'mcp'], p.home, p.cwd, { PLANT_2898: JSON.stringify(PLANTED) });
    await planted.initialize();
    expect(drift(planted.name, await planted.tools()), 'the drift check fails the planted tools.ts, naming the tool and the hint it states that the table doesn\'t, and nothing else')
      .toEqual(['deep mcp with a planted tools.ts: deep_status destructiveHint lists true, the table false']);
    await p.close();
  }, TEST_MS);
});
