// AC7: by the pinned tokenizer (gpt-tokenizer 4.0.0's o200k_base), deep_kinds' entry as deep mcp lists it is smaller
// than the merge base's (fixtures/base.json) by at least the tokens of the base's fetch fields (library, id, pack and
// asset, as its schema listed them), and the whole list, each tool counted whole and summed as #2688 counts it, is no
// larger than the base's. A planted move that copies the fields and leaves them in deep_kinds (fixtures/plant.mjs
// `leave`) fails, naming both counts. On the base the entry is the base's, so the test fails there.
import { afterAll, describe, expect, it } from 'vitest';
import { AC, TEST_MS, base, baseFetchFields, deepMcp, listed, plainHub, t26, tokens, wholeList, type Line } from './helpers.ts';

afterAll(t26.cleanup, 60_000);

/** The check: one line per count over its bound, naming the count and the merge base's. */
function tokenFailures(tools: readonly Line[]): string[] {
  const was = base().tools;
  const fields = tokens(baseFetchFields());
  const entry = tokens(listed(tools, 'deep_kinds'));
  const baseEntry = tokens(listed(was, 'deep_kinds'));
  const failures: string[] = [];
  if (entry > baseEntry - fields) failures.push(`deep_kinds' listed entry is ${entry} tokens; the merge base's is ${baseEntry}, and it must fall by at least the fetch fields' ${fields}, to at most ${baseEntry - fields}`);
  const whole = wholeList(tools);
  const baseWhole = wholeList(was);
  if (whole > baseWhole) failures.push(`the whole list is ${whole} tokens, larger than the merge base's ${baseWhole}`);
  return failures;
}

describe('the catalogue loads fewer tokens', () => {
  it(`AC7 ${AC.tokens} by the pinned tokenizer deep_kinds' listed entry is smaller than the merge base's by at least the fetch fields' tokens and the whole list is no larger; a planted move that copies the fields and leaves them fails, naming both counts`, async () => {
    const p = await plainHub();
    const server = await deepMcp('deep mcp', p.home, p.cwd);
    const tools = await server.tools();
    server.child.kill('SIGTERM');
    expect(tokenFailures(tools), 'deep mcp\'s tools/list, counted').toEqual([]);

    const planted = await deepMcp('deep mcp that leaves the fetch fields', p.home, p.cwd, { kind: 'leave', fields: baseFetchFields() });
    const left = tokenFailures(await planted.tools());
    planted.child.kill('SIGTERM');
    expect(left.filter((f) => /^deep_kinds' listed entry is \d+ tokens; the merge base's is \d+/.test(f)), `the same check fails the planted move that leaves the fields, naming both counts: ${left.join(' | ') || 'it passed'}`).not.toEqual([]);
  }, TEST_MS);
});
