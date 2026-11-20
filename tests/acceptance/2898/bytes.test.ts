// AC7: each tool's name, description and input schema are byte-equal to the merge base's (fixtures/base.json), so the
// tokens a session loads are unchanged. The merge base passes this test; its planted wrong program is the twin
// twins/description-reworded (README).
import { afterAll, describe, expect, it } from 'vitest';
import { AC, TEST_MS, base, cleanup, listings, plainHub } from './helpers.ts';

afterAll(cleanup, 60_000);

describe('what the model reads stays as it is', () => {
  it(`AC7 ${AC.bytes} each tool's name, description and input schema, as each of the four servers lists it, are byte-equal to the merge base's`, async () => {
    const p = await plainHub();
    const lists = await listings(p);
    const was = base().tools;
    const differ: string[] = [];
    for (const l of lists) {
      const before = was[l.server] ?? [];
      const names = l.tools.map((t) => String(t.name));
      if (JSON.stringify(names) !== JSON.stringify(before.map((t) => t.name))) differ.push(`${l.server} lists ${names.join(', ')}; the merge base ${before.map((t) => t.name).join(', ')}`);
      for (const tool of l.tools) {
        const old = before.find((t) => t.name === tool.name);
        if (!old) continue;
        for (const field of ['description', 'inputSchema'] as const) {
          if (JSON.stringify(tool[field]) !== JSON.stringify(old[field])) differ.push(`${l.server}: ${String(tool.name)}'s ${field} differs from the merge base's: ${JSON.stringify(tool[field]).slice(0, 300)}`);
        }
      }
    }
    expect(differ, 'every tool\'s name, description and input schema are the merge base\'s bytes').toEqual([]);
    await p.close();
  }, TEST_MS);
});
