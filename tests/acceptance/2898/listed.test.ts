// AC1: each of the four servers answers tools/list with annotations on every tool, 22 entries in all (README).
import { afterAll, describe, expect, it } from 'vitest';
import { AC, TEST_MS, annotationProblems, cleanup, listings, plainHub } from './helpers.ts';

afterAll(cleanup, 60_000);

describe('every tool of the four servers lists its annotations', () => {
  it(`AC1 ${AC.listed} deep mcp, deep mcp actions in both its forms and the reading tools each answer tools/list with annotations on every tool: a title of at most 40 characters and the four hints as booleans, 22 entries in all`, async () => {
    const p = await plainHub();
    const lists = await listings(p);
    const missing: string[] = [];
    for (const l of lists) {
      const bad = l.tools.map((t) => ({ name: String(t.name), problems: annotationProblems(t) })).filter((t) => t.problems.length);
      if (bad.length) missing.push(`${l.server}: its first tool ${bad[0]!.name} has ${bad[0]!.problems.join(', ')}${bad.length > 1 ? `; ${bad.length - 1} more of its ${l.tools.length} tools miss them too` : ''}`);
    }
    expect(missing, 'each server lists annotations on every tool, a title and the four hints, none left to its default').toEqual([]);
    const entries = lists.map((l) => `${l.server}: ${l.tools.map((t) => String(t.name)).join(', ')}`);
    expect(lists.reduce((n, l) => n + l.tools.length, 0), `22 entries in all (${entries.join('; ')})`).toBe(22);
    await p.close();
  }, TEST_MS);
});
